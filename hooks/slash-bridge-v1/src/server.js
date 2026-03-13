import http from 'node:http';
import { URL } from 'node:url';

import { openDb, cleanupExpired } from './db.js';
import { computeHmacSha256Hex, timingSafeEqualHex, randomId, sha256Hex } from './crypto.js';
import { createIssueComment, createCheckRun, withRetry } from './github.js';

const DEFAULT_PORT = 8787;
const MAX_BODY_BYTES = 1024 * 1024; // 1MB

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function parseSigHeader(h) {
  // Expect: sha256=<hex>
  if (!h) return null;
  const m = String(h).match(/^sha256=([0-9a-f]{64})$/i);
  return m ? m[1].toLowerCase() : null;
}

function reason(reasonCode, detail) {
  return { reasonCode, detail };
}

function defaultRoute(command) {
  const map = {
    'plan-pr': 'luxiaofeng',
    // Backward-compatible alias (v1): treat `plan` as `plan-pr`.
    plan: 'luxiaofeng',
    review: 'afei',
    security: 'jingwuming',
  };
  return map[String(command || '').trim()] || null;
}

function parseAllowedRepos(s) {
  // Format: "owner/repo:installationId,owner2/repo2:installationId"
  // installationId optional; if omitted, only repo allowlist is enforced.
  const out = new Map();
  for (const part of String(s || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const [r, inst] = part.split(':').map((x) => x.trim());
    if (!r) continue;
    out.set(r, inst ? Number(inst) : null);
  }
  return out;
}

function isAuthorAllowed(authorAssociation, { extraAllow = [] } = {}) {
  const allowed = new Set(['OWNER', 'MEMBER', 'COLLABORATOR', ...extraAllow.map((x) => String(x).toUpperCase())]);
  return allowed.has(String(authorAssociation || '').toUpperCase());
}

function formatAck(ack, payload) {
  const lines = [
    '### QZAI Slash Bridge v1 (ACK)',
    `- accepted: ${ack.accepted ? 'true' : 'false'}`,
    `- traceId: \`${ack.traceId}\``,
    `- runId: \`${ack.runId}\``,
    payload?.deliveryId ? `- deliveryId: \`${payload.deliveryId}\`` : null,
    payload?.idempotencyKey ? `- idempotencyKey: \`${payload.idempotencyKey}\`` : null,
    ack.reasonCode ? `- reasonCode: \`${ack.reasonCode}\`` : null,
    ack.detail ? `- detail: ${ack.detail}` : null,
    ack.agentId ? `- agentId: \`${ack.agentId}\`` : null,
    ack.nextAction ? `- nextAction: ${ack.nextAction}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

function formatFinal(final, payload) {
  const lines = [
    '### QZAI Slash Bridge v1 (Final)',
    `- verdict: \`${final.verdict}\``,
    `- traceId: \`${final.traceId}\``,
    `- runId: \`${final.runId}\``,
    payload?.deliveryId ? `- deliveryId: \`${payload.deliveryId}\`` : null,
    payload?.idempotencyKey ? `- idempotencyKey: \`${payload.idempotencyKey}\`` : null,
    final.errorCode ? `- errorCode: \`${final.errorCode}\`` : null,
    final.reasonCode ? `- reasonCode: \`${final.reasonCode}\`` : null,
    final.summary ? `- summary: ${final.summary}` : null,
    final.nextAction ? `- nextAction: ${final.nextAction}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

async function main() {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const dbPath = process.env.SLASH_BRIDGE_DB_PATH || './slash-bridge-v1.sqlite';

  const secret = process.env.SLASH_BRIDGE_HOOK_SECRET || '';
  if (!secret) {
    console.error('[slash-bridge-v1] Missing env SLASH_BRIDGE_HOOK_SECRET');
    process.exit(1);
  }

  const ghToken = process.env.GITHUB_TOKEN || '';
  if (!ghToken) {
    console.error('[slash-bridge-v1] Missing env GITHUB_TOKEN (MUST be GitHub App installation token; do NOT use PAT)');
    process.exit(1);
  }

  const allowedRepos = parseAllowedRepos(process.env.SLASH_BRIDGE_ALLOWED_REPOS || '');
  if (allowedRepos.size == 0) {
    console.error('[slash-bridge-v1] Missing/empty env SLASH_BRIDGE_ALLOWED_REPOS (fail-closed)');
    process.exit(1);
  }

  const authorAssocExtra = String(process.env.SLASH_BRIDGE_AUTHOR_ASSOC_EXTRA_ALLOW || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

  const rateLimitWindowMs = Number(process.env.SLASH_BRIDGE_RATE_WINDOW_MS || 60_000);
  const rateLimitMax = Number(process.env.SLASH_BRIDGE_RATE_MAX || 5);

  // Startup self-check for audit + to prevent ReferenceError.
  console.log('[slash-bridge-v1] config', {
    port,
    dbPath,
    allowedRepos: [...allowedRepos.entries()],
    rateLimitWindowMs,
    rateLimitMax,
    authorAssocExtra,
  });

  const db = await openDb(dbPath);

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url || '/', 'http://localhost');
      if (req.method !== 'POST' || u.pathname !== '/hooks/slash-bridge-v1') {
        return json(res, 404, { ok: false, error: 'NOT_FOUND' });
      }

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

      if (!sigHex) {
        return json(res, 401, { ok: false, ...ackBase, ...reason('SIG_INVALID', 'missing/invalid X-Hub-Signature-256') });
      }
      const expect = computeHmacSha256Hex(secret, rawBody);
      if (!timingSafeEqualHex(sigHex, expect)) {
        return json(res, 401, { ok: false, ...ackBase, ...reason('SIG_INVALID', 'signature mismatch') });
      }

      const now = Date.now();
      if (!Number.isFinite(ts) || Math.abs(now - ts) > 5 * 60 * 1000) {
        return json(res, 401, { ok: false, ...ackBase, ...reason('TIMESTAMP_EXPIRED', 'timestamp outside ±5min window') });
      }

      if (!nonce || nonce.length < 8) {
        return json(res, 401, { ok: false, ...ackBase, ...reason('NONCE_REPLAY', 'missing/invalid nonce') });
      }

      await cleanupExpired(db, now);
      const existingNonce = await db.get('SELECT nonce FROM nonces WHERE nonce = ?', nonce);
      if (existingNonce) {
        return json(res, 401, { ok: false, ...ackBase, ...reason('NONCE_REPLAY', 'nonce already used') });
      }
      await db.run('INSERT INTO nonces(nonce, expires_at_ms) VALUES(?,?)', nonce, now + 10 * 60 * 1000);

      let payload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return json(res, 400, { ok: false, ...ackBase, ...reason('ARGS_INVALID', 'invalid JSON body') });
      }

      // P0-1: deliveryId dedupe MAIN PATH
      const deliveryId = String(payload.deliveryId || '').trim();
      if (!deliveryId) {
        return json(res, 400, { ok: false, ...ackBase, ...reason('ARGS_INVALID', 'missing deliveryId') });
      }
      {
        const prev = await db.get('SELECT ack_json FROM deliveries WHERE delivery_id = ?', deliveryId);
        if (prev?.ack_json) {
          return json(res, 200, { ok: true, status: 'DELIVERY_DUP', ack: JSON.parse(prev.ack_json) });
        }
      }

      const required = [
        'schemaVersion',
        'deliveryId',
        'command',
        'args',
        'repo',
        'installationId',
        'issueNumber',
        'commentId',
        'commentUrl',
        'headSha',
        'baseSha',
        'requestedBy',
        'requestedAt',
        'authorAssociation',
        'idempotencyKey',
      ];
      const missing = required.filter((k) => payload[k] === undefined || payload[k] === null || payload[k] === '');
      if (missing.length) {
        const ack = { accepted: false, ...ackBase, ...reason('ARGS_INVALID', `missing required fields: ${missing.join(', ')}`) };
        await db.run('INSERT INTO deliveries(delivery_id, created_at_ms, ack_json) VALUES(?,?,?)', deliveryId, now, JSON.stringify(ack));
        return json(res, 400, { ok: false, ...ack });
      }

      const repoFull = String(payload.repo);
      const [owner, repo] = repoFull.split('/');
      const issueNumber = Number(payload.prNumber || payload.issueNumber || 0);
      if (!owner || !repo || !issueNumber) {
        const ack = { accepted: false, ...ackBase, ...reason('ARGS_INVALID', 'invalid repo or issueNumber') };
        await db.run('INSERT INTO deliveries(delivery_id, created_at_ms, ack_json) VALUES(?,?,?)', deliveryId, now, JSON.stringify(ack));
        return json(res, 400, { ok: false, ...ack });
      }

      if (!allowedRepos.has(repoFull)) {
        const ack = { accepted: false, ...ackBase, ...reason('REPO_NOT_ALLOWED', `repo not allowed: ${repoFull}`) };
        await db.run('INSERT INTO deliveries(delivery_id, created_at_ms, ack_json) VALUES(?,?,?)', deliveryId, now, JSON.stringify(ack));
        await withRetry(() => createIssueComment({ token: ghToken, owner, repo, issueNumber, body: formatAck(ack, payload) }));
        return json(res, 200, { ok: true, ack });
      }

      const expectedInst = allowedRepos.get(repoFull);
      const instId = Number(payload.installationId);
      if (!Number.isFinite(instId) || instId <= 0) {
        const ack = { accepted: false, ...ackBase, ...reason('ARGS_INVALID', 'invalid installationId') };
        await db.run('INSERT INTO deliveries(delivery_id, created_at_ms, ack_json) VALUES(?,?,?)', deliveryId, now, JSON.stringify(ack));
        await withRetry(() => createIssueComment({ token: ghToken, owner, repo, issueNumber, body: formatAck(ack, payload) }));
        return json(res, 200, { ok: true, ack });
      }
      if (expectedInst && instId !== expectedInst) {
        const ack = { accepted: false, ...ackBase, ...reason('INSTALLATION_MISMATCH', `installation mismatch: expected ${expectedInst} got ${instId}`) };
        await db.run('INSERT INTO deliveries(delivery_id, created_at_ms, ack_json) VALUES(?,?,?)', deliveryId, now, JSON.stringify(ack));
        await withRetry(() => createIssueComment({ token: ghToken, owner, repo, issueNumber, body: formatAck(ack, payload) }));
        return json(res, 200, { ok: true, ack });
      }

      if (!isAuthorAllowed(payload.authorAssociation, { extraAllow: authorAssocExtra })) {
        const ack = { accepted: false, ...ackBase, ...reason('AUTHOR_NOT_ALLOWED', `author_association=${payload.authorAssociation}`) };
        await db.run('INSERT INTO deliveries(delivery_id, created_at_ms, ack_json) VALUES(?,?,?)', deliveryId, now, JSON.stringify(ack));
        await withRetry(() => createIssueComment({ token: ghToken, owner, repo, issueNumber, body: formatAck(ack, payload) }));
        return json(res, 200, { ok: true, ack });
      }

      const rlKey = `${repoFull}#${payload.requestedBy}#${payload.command}`;
      {
        const row = await db.get('SELECT window_start_ms, count FROM rate_limits WHERE key=?', rlKey);
        const windowStart = row?.window_start_ms ?? now;
        const count = row?.count ?? 0;
        if (now - windowStart > rateLimitWindowMs) {
          await db.run('INSERT OR REPLACE INTO rate_limits(key, window_start_ms, count) VALUES(?,?,?)', rlKey, now, 1);
        } else {
          if (count + 1 > rateLimitMax) {
            const ack = { accepted: false, ...ackBase, ...reason('RATE_LIMITED', `limit=${rateLimitMax}/${rateLimitWindowMs}ms key=${rlKey}`) };
            await db.run('INSERT INTO deliveries(delivery_id, created_at_ms, ack_json) VALUES(?,?,?)', deliveryId, now, JSON.stringify(ack));
            await withRetry(() => createIssueComment({ token: ghToken, owner, repo, issueNumber, body: formatAck(ack, payload) }));
            return json(res, 200, { ok: true, ack });
          }
          await db.run('INSERT OR REPLACE INTO rate_limits(key, window_start_ms, count) VALUES(?,?,?)', rlKey, windowStart, count + 1);
        }
      }

      const command = String(payload.command).trim();
      const args = String(payload.args || '').trim();

      const routedAgent = defaultRoute(command);
      if (!routedAgent) {
        const ack = { accepted: false, ...ackBase, ...reason('ROUTE_NOT_FOUND', `unknown command: ${command}`) };
        await db.run('INSERT INTO deliveries(delivery_id, created_at_ms, ack_json) VALUES(?,?,?)', deliveryId, now, JSON.stringify(ack));
        await withRetry(() => createIssueComment({ token: ghToken, owner, repo, issueNumber, body: formatAck(ack, payload) }));
        return json(res, 200, { ok: true, ack });
      }

      const idemKey = String(payload.idempotencyKey);
      const prevCmd = await db.get('SELECT status, run_id, final_json FROM commands WHERE idempotency_key = ?', idemKey);
      if (prevCmd) {
        const ack = {
          accepted: true,
          ...ackBase,
          status: prevCmd.status === 'completed' ? 'ALREADY_DONE' : 'IN_PROGRESS',
          parentRunId: prevCmd.run_id,
          agentId: routedAgent,
          nextAction: prevCmd.status === 'completed' ? '已完成（复用上次结果）' : '正在执行中（复用 runId）',
        };
        await db.run('INSERT INTO deliveries(delivery_id, created_at_ms, ack_json) VALUES(?,?,?)', deliveryId, now, JSON.stringify(ack));
        await withRetry(() => createIssueComment({ token: ghToken, owner, repo, issueNumber, body: formatAck(ack, payload) }));
        return json(res, 200, { ok: true, ack, final: prevCmd.final_json ? JSON.parse(prevCmd.final_json) : null });
      }

      await db.run(
        'INSERT INTO commands(idempotency_key, created_at_ms, expires_at_ms, status, trace_id, run_id) VALUES(?,?,?,?,?,?)',
        idemKey,
        now,
        now + 7 * 24 * 60 * 60 * 1000,
        'in_progress',
        traceId,
        runId
      );

      const ack = {
        accepted: true,
        ...ackBase,
        command,
        args,
        agentId: routedAgent,
        nextAction: '等待执行完成（Final 回写）',
      };

      // Normal path MUST store deliveryId -> ack_json before returning.
      await db.run('INSERT INTO deliveries(delivery_id, created_at_ms, ack_json) VALUES(?,?,?)', deliveryId, now, JSON.stringify(ack));

      await withRetry(() => createIssueComment({ token: ghToken, owner, repo, issueNumber, body: formatAck(ack, payload) }));

      setTimeout(async () => {
        const final = {
          verdict: 'success',
          summary: `stub executor: routed to agentId=${routedAgent} command=${command}`,
          evidenceLinks: [],
          traceId,
          runId,
        };

        try {
          await withRetry(() => createIssueComment({
            token: ghToken,
            owner,
            repo,
            issueNumber,
            body: formatFinal(final, payload),
          }));

          if (payload.headSha) {
            await withRetry(() => createCheckRun({
              token: ghToken,
              owner,
              repo,
              headSha: payload.headSha,
              name: 'slash-bridge-v1/final',
              title: 'Slash Bridge v1 Final',
              summary: formatFinal(final, payload),
              conclusion: 'success',
            }));
          }

          await db.run('UPDATE commands SET status=?, final_json=? WHERE idempotency_key=?', 'completed', JSON.stringify(final), idemKey);
        } catch (e) {
          const errFinal = {
            verdict: 'failed',
            errorCode: 'WRITEBACK_FAILED',
            reasonCode: 'WRITEBACK_FAILED_RETRIES_EXHAUSTED',
            summary: `final writeback failed: ${e.message}`,
            nextAction: '已重试耗尽：请检查 hook server 日志，并查看 SQLite dead_letters 记录（kind=writeback_failed）。',
            traceId,
            runId,
          };

          // Ensure GitHub-visible failure best-effort; if still fails, persist dead-letter.
          try {
            await withRetry(() => createIssueComment({
              token: ghToken,
              owner,
              repo,
              issueNumber,
              body: formatFinal(errFinal, payload),
            }), { retries: 2, baseDelayMs: 800 });

            if (payload.headSha) {
              await withRetry(() => createCheckRun({
                token: ghToken,
                owner,
                repo,
                headSha: payload.headSha,
                name: 'slash-bridge-v1/final',
                title: 'Slash Bridge v1 Final (failed)',
                summary: formatFinal(errFinal, payload),
                conclusion: 'failure',
              }), { retries: 2, baseDelayMs: 800 });
            }
          } catch (e2) {
            const deadId = sha256Hex(`${traceId}#${runId}#${Date.now()}`);
            await db.run(
              'INSERT INTO dead_letters(id, created_at_ms, kind, payload_json) VALUES(?,?,?,?)',
              deadId,
              Date.now(),
              'writeback_failed',
              JSON.stringify({ errFinal, error: String(e2?.message || e2) })
            );
          }

          await db.run('UPDATE commands SET status=?, final_json=? WHERE idempotency_key=?', 'failed', JSON.stringify(errFinal), idemKey);
        }
      }, 1000);

      return json(res, 200, { ok: true, ack });
    } catch (e) {
      console.error('[slash-bridge-v1] handler error', e);
      return json(res, 500, { ok: false, error: 'INTERNAL_ERROR', detail: e.message });
    }
  });

  server.listen(port, () => {
    console.log(`[slash-bridge-v1] listening on :${port}`);
  });
}

main().catch((e) => {
  console.error('[slash-bridge-v1] fatal', e);
  process.exit(1);
});
