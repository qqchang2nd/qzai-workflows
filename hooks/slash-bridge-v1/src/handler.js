/**
 * Main request handler (dependency-injected).
 * Handles POST /hooks/slash-bridge-v1 requests.
 */

import { randomId, sha256Hex } from './crypto.js';
import { parseSigHeader, validateSignature, validateTimestamp, validateNonceFormat, consumeNonce, validateRequiredFields, MAX_BODY_BYTES } from './validate.js';
import { checkRepoPolicy, checkAuthorPolicy, checkRateLimit } from './policy.js';
import { resolveAgent } from './router.js';
import { formatAck, formatFinal } from './format.js';
import { insertDeliveryAtomic } from './db.js';
import * as defaultGithub from './github.js';

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Create the HTTP request handler with injected dependencies.
 * @param {object} deps
 * @param {object} deps.db - SQLite database handle
 * @param {object} deps.config - Server configuration
 * @param {function} deps.getToken - async (installationId) => string
 * @param {function} deps.dispatch - async (command, agentId, payload) => result
 * @param {object} [deps.githubClient] - GitHub API client (injectable for testing)
 */
export function createHandler({ db, config, getToken, dispatch, githubClient = defaultGithub }) {
  const {
    secret,
    allowedRepos,
    authorAssocExtra = [],
    rateLimitWindowMs = 60_000,
    rateLimitMax = 5,
  } = config;

  const { withRetry, createIssueComment, updateIssueComment } = githubClient;

  return async function handler(req, res) {
    // Health check
    if (req.method === 'GET' && new URL(req.url || '/', 'http://localhost').pathname === '/health') {
      return json(res, 200, { ok: true });
    }

    // Only accept POST to /hooks/slash-bridge-v1
    const u = new URL(req.url || '/', 'http://localhost');
    if (req.method !== 'POST' || u.pathname !== '/hooks/slash-bridge-v1') {
      return json(res, 404, { ok: false, error: 'NOT_FOUND' });
    }

    // Read body with size limit
    let buf = Buffer.alloc(0);
    for await (const chunk of req) {
      buf = Buffer.concat([buf, Buffer.from(chunk)]);
      if (buf.length > MAX_BODY_BYTES) {
        return json(res, 413, { ok: false, error: 'BODY_TOO_LARGE' });
      }
    }
    const rawBody = buf.toString('utf8');

    const sigHex = parseSigHeader(req.headers['x-hub-signature-256']);
    const ts = Number(req.headers['x-qzai-timestamp'] || 0);
    const nonce = String(req.headers['x-qzai-nonce'] || '');

    const traceId = randomId('trc');
    const runId = randomId('run');
    const ackBase = { schemaVersion: 1, traceId, runId };
    const now = Date.now();

    // --- Security validation (fail before DB if possible) ---
    const sigErr = validateSignature(secret, rawBody, sigHex);
    if (sigErr) return json(res, 401, { ok: false, ...ackBase, ...sigErr });

    const tsErr = validateTimestamp(ts, now);
    if (tsErr) return json(res, 401, { ok: false, ...ackBase, ...tsErr });

    const nonceFormatErr = validateNonceFormat(nonce);
    if (nonceFormatErr) return json(res, 401, { ok: false, ...ackBase, ...nonceFormatErr });

    // Atomic nonce consumption (TOCTOU-safe)
    const nonceErr = await consumeNonce(db, nonce, now);
    if (nonceErr) return json(res, 401, { ok: false, ...ackBase, ...nonceErr });

    // Parse JSON (after HMAC verification)
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return json(res, 400, { ok: false, ...ackBase, reasonCode: 'ARGS_INVALID', detail: 'invalid JSON body' });
    }

    // Delivery dedup (TOCTOU-safe: check existing first, then atomic insert below)
    const deliveryId = String(payload.deliveryId || '').trim();
    if (!deliveryId) {
      return json(res, 400, { ok: false, ...ackBase, reasonCode: 'ARGS_INVALID', detail: 'missing deliveryId' });
    }

    {
      const prev = await db.get('SELECT ack_json FROM deliveries WHERE delivery_id = ?', deliveryId);
      if (prev?.ack_json) {
        return json(res, 200, { ok: true, status: 'DELIVERY_DUP', ack: JSON.parse(prev.ack_json) });
      }
    }

    // --- Field validation ---
    const fieldsErr = validateRequiredFields(payload);
    if (fieldsErr) {
      return await rejectAndRespond(res, db, deliveryId, now, ackBase, fieldsErr, null, null, null, payload, 400, { withRetry, createIssueComment });
    }

    const repoFull = String(payload.repo);
    const [owner, repo_] = repoFull.split('/');
    const issueNumber = Number(payload.prNumber || payload.issueNumber || 0);
    if (!owner || !repo_ || !issueNumber) {
      return await rejectAndRespond(res, db, deliveryId, now, ackBase,
        { reasonCode: 'ARGS_INVALID', detail: 'invalid repo or issueNumber' },
        null, null, null, payload, 400, { withRetry, createIssueComment });
    }

    // --- Repo / installation policy ---
    const repoErr = checkRepoPolicy(allowedRepos, repoFull, payload.installationId);
    if (repoErr) {
      let ghToken = null;
      try { ghToken = await getToken(null); } catch {}
      return await rejectAndRespond(res, db, deliveryId, now, ackBase, repoErr,
        ghToken, owner, repo_, payload, 200, { withRetry, createIssueComment });
    }

    const expectedInst = allowedRepos.get(repoFull);
    const resolvedInstId = expectedInst ?? Number(payload.installationId);

    // --- GitHub auth ---
    let ghToken;
    try {
      ghToken = await getToken(resolvedInstId);
    } catch (e) {
      const err = { reasonCode: 'GH_AUTH_FAILED', detail: String(e?.message || e) };
      await insertDeliveryAtomic(db, deliveryId, now, JSON.stringify({ accepted: false, ...ackBase, ...err }));
      return json(res, 200, { ok: true, ack: { accepted: false, ...ackBase, ...err } });
    }

    // --- Author association policy ---
    const authorErr = checkAuthorPolicy(payload.authorAssociation, { extraAllow: authorAssocExtra });
    if (authorErr) {
      return await rejectAndRespond(res, db, deliveryId, now, ackBase, authorErr,
        ghToken, owner, repo_, payload, 200, { withRetry, createIssueComment });
    }

    // --- Rate limiting ---
    const rlKey = `${repoFull}#${payload.requestedBy}#${payload.command}`;
    const rlErr = await checkRateLimit(db, rlKey, now, { windowMs: rateLimitWindowMs, maxCount: rateLimitMax });
    if (rlErr) {
      return await rejectAndRespond(res, db, deliveryId, now, ackBase, rlErr,
        ghToken, owner, repo_, payload, 200, { withRetry, createIssueComment });
    }

    // --- Agent routing ---
    const command = String(payload.command).trim();
    const overrideAgent = String(payload.agentId || '').trim() || null;
    const { agentId, error: routeErr } = resolveAgent(command, overrideAgent);
    if (routeErr) {
      const err = {
        reasonCode: routeErr,
        detail: routeErr === 'AGENT_NOT_ALLOWED'
          ? `agentId not allowed: ${overrideAgent}`
          : `unknown command: ${command}`,
      };
      return await rejectAndRespond(res, db, deliveryId, now, ackBase, err,
        ghToken, owner, repo_, payload, 200, { withRetry, createIssueComment });
    }

    // --- Idempotency check ---
    // MED-7: enforce max length to prevent unbounded primary key attacks
    const idemKey = String(payload.idempotencyKey);
    if (idemKey.length > 512) {
      return await rejectAndRespond(res, db, deliveryId, now, ackBase,
        { reasonCode: 'ARGS_INVALID', detail: 'idempotencyKey exceeds 512 characters' },
        ghToken, owner, repo_, payload, 400, { withRetry, createIssueComment });
    }
    const prevCmd = await db.get(
      'SELECT status, run_id, final_json, ack_comment_id FROM commands WHERE idempotency_key = ?',
      idemKey
    );
    if (prevCmd) {
      const ack = {
        accepted: true,
        ...ackBase,
        status: prevCmd.status === 'completed' ? 'ALREADY_DONE' : 'IN_PROGRESS',
        parentRunId: prevCmd.run_id,
        agentId,
        nextAction: prevCmd.status === 'completed' ? '已完成（复用上次结果）' : '正在执行中（复用 runId）',
      };
      await insertDeliveryAtomic(db, deliveryId, now, JSON.stringify(ack));
      await withRetry(() => createIssueComment({ token: ghToken, owner, repo: repo_, issueNumber, body: formatAck(ack, payload) }));
      return json(res, 200, { ok: true, ack, final: prevCmd.final_json ? JSON.parse(prevCmd.final_json) : null });
    }

    // --- Accept and dispatch ---
    const args = String(payload.args || '').trim();
    const ack = {
      accepted: true,
      ...ackBase,
      command,
      args,
      agentId,
      nextAction: '等待执行完成（Final 回写）',
    };

    await insertDeliveryAtomic(db, deliveryId, now, JSON.stringify(ack));

    const ackComment = await withRetry(() =>
      createIssueComment({ token: ghToken, owner, repo: repo_, issueNumber, body: formatAck(ack, payload) })
    );
    const ackCommentId = ackComment?.id ? Number(ackComment.id) : null;

    await db.run(
      'INSERT INTO commands(idempotency_key, created_at_ms, expires_at_ms, status, trace_id, run_id, ack_comment_id) VALUES(?,?,?,?,?,?,?)',
      idemKey, now, now + 7 * 24 * 60 * 60 * 1000, 'in_progress', traceId, runId, ackCommentId
    );

    // Async dispatch to agent (non-blocking)
    dispatchAsync({ db, dispatch, ghToken, owner, repo: repo_, issueNumber, command, agentId, payload, ack, idemKey, traceId, runId, withRetry, createIssueComment, updateIssueComment });

    return json(res, 200, { ok: true, ack });
  };
}

/**
 * Fire-and-forget async dispatch.
 */
async function dispatchAsync({ db, dispatch, ghToken, owner, repo, issueNumber, command, agentId, payload, ack, idemKey, traceId, runId, withRetry, createIssueComment, updateIssueComment }) {
  try {
    const result = await dispatch(command, agentId, { ...payload, owner, repo, issueNumber });

    const final = {
      verdict: result?.verdict || 'success',
      summary: result?.summary || `dispatched to agentId=${agentId} command=${command}`,
      evidenceLinks: result?.evidenceLinks || [],
      traceId,
      runId,
    };

    const row = await db.get('SELECT ack_comment_id FROM commands WHERE idempotency_key=?', idemKey);
    if (row?.ack_comment_id) {
      await withRetry(() => updateIssueComment({
        token: ghToken, owner, repo, commentId: row.ack_comment_id,
        body: [formatAck(ack, payload), '', formatFinal(final, payload)].join('\n'),
      }));
    } else {
      await withRetry(() => createIssueComment({ token: ghToken, owner, repo, issueNumber, body: formatFinal(final, payload) }));
    }

    await db.run('UPDATE commands SET status=?, final_json=? WHERE idempotency_key=?',
      'completed', JSON.stringify(final), idemKey);
  } catch (e) {
    // HIGH-2: differentiate error types for operational visibility
    const isAuthError = e?.status === 401 || e?.status === 403;
    const errorCode = isAuthError ? 'GH_TOKEN_EXPIRED' : 'WRITEBACK_FAILED';
    const reasonCode = isAuthError ? 'GH_TOKEN_EXPIRED' : 'WRITEBACK_FAILED_RETRIES_EXHAUSTED';

    console.error('[slash-bridge-v1] dispatchAsync failed', {
      traceId, runId, idemKey, errorCode, message: e?.message, status: e?.status,
    });

    const errFinal = {
      verdict: 'failed',
      errorCode,
      reasonCode,
      summary: `dispatch/writeback failed: ${e.message}`,
      nextAction: '已重试耗尽：请检查 hook server 日志，并查看 SQLite dead_letters 记录（kind=writeback_failed）。',
      traceId,
      runId,
    };

    try {
      await withRetry(() => createIssueComment({ token: ghToken, owner, repo, issueNumber, body: formatFinal(errFinal, payload) }), { retries: 2, baseDelayMs: 800 });
    } catch (e2) {
      const deadId = sha256Hex(`${traceId}#${runId}#${Date.now()}`);
      await db.run(
        'INSERT INTO dead_letters(id, created_at_ms, kind, payload_json) VALUES(?,?,?,?)',
        deadId, Date.now(), 'writeback_failed',
        JSON.stringify({ errFinal, error: String(e2?.message || e2) })
      );
    }

    await db.run('UPDATE commands SET status=?, final_json=? WHERE idempotency_key=?',
      'failed', JSON.stringify(errFinal), idemKey);
  }
}

/**
 * Unified rejection helper.
 */
async function rejectAndRespond(res, db, deliveryId, now, ackBase, errReason, ghToken, owner, repo, payload, httpStatus, { withRetry, createIssueComment } = {}) {
  const ack = { accepted: false, ...ackBase, ...errReason };
  await insertDeliveryAtomic(db, deliveryId, now, JSON.stringify(ack));

  if (ghToken && owner && repo && payload && withRetry && createIssueComment) {
    const issueNumber = Number(payload.prNumber || payload.issueNumber || 0);
    if (issueNumber) {
      try {
        await withRetry(() => createIssueComment({ token: ghToken, owner, repo, issueNumber, body: formatAck(ack, payload) }));
      } catch (commentErr) {
        console.error('[slash-bridge-v1] rejectAndRespond: failed to post rejection comment', {
          reasonCode: errReason?.reasonCode, owner, repo, issueNumber, error: commentErr?.message,
        });
      }
    }
  }

  return json(res, httpStatus, { ok: httpStatus === 200, ack });
}
