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
    review: 'afei',
    security: 'jingwuming',
    plan: 'luxiaofeng',
  };
  return map[command] || null;
}

function formatAck(ack, payload) {
  const lines = [
    '### QZAI Slash Bridge v1 (ACK)',
    `- accepted: ${ack.accepted ? 'true' : 'false'}`,
    `- traceId: \`${ack.traceId}\``,
    `- runId: \`${ack.runId}\``,
    payload.idempotencyKey ? `- idempotencyKey: \`${payload.idempotencyKey}\`` : null,
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
    payload.idempotencyKey ? `- idempotencyKey: \`${payload.idempotencyKey}\`` : null,
    final.errorCode ? `- errorCode: \`${final.errorCode}\`` : null,
    final.summary ? `- summary: ${final.summary}` : null,
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
    console.error('[slash-bridge-v1] Missing env GITHUB_TOKEN (installation token recommended)');
    process.exit(1);
  }

  const db = await openDb(dbPath);

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url || '/', 'http://localhost');
      if (req.method !== 'POST' || u.pathname !== '/hooks/slash-bridge-v1') {
        return json(res, 404, { ok: false, error: 'NOT_FOUND' });
      }

      // Read raw body
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

      // Verify HMAC
      if (!sigHex) {
        return json(res, 401, { ok: false, ...ackBase, ...reason('SIG_INVALID', 'missing/invalid X-Hub-Signature-256') });
      }
      const expect = computeHmacSha256Hex(secret, rawBody);
      if (!timingSafeEqualHex(sigHex, expect)) {
        return json(res, 401, { ok: false, ...ackBase, ...reason('SIG_INVALID', 'signature mismatch') });
      }

      // Timestamp window ±5min
      const now = Date.now();
      if (!Number.isFinite(ts) || Math.abs(now - ts) > 5 * 60 * 1000) {
        return json(res, 401, { ok: false, ...ackBase, ...reason('TIMESTAMP_EXPIRED', 'timestamp outside ±5min window') });
      }

      // Nonce replay (TTL 10min)
      if (!nonce || nonce.length < 8) {
        return json(res, 401, { ok: false, ...ackBase, ...reason('NONCE_REPLAY', 'missing/invalid nonce') });
      }

      await cleanupExpired(db, now);
      const existingNonce = await db.get('SELECT nonce FROM nonces WHERE nonce = ?', nonce);
      if (existingNonce) {
        return json(res, 401, { ok: false, ...ackBase, ...reason('NONCE_REPLAY', 'nonce already used') });
      }
      await db.run('INSERT INTO nonces(nonce, expires_at_ms) VALUES(?,?)', nonce, now + 10 * 60 * 1000);

      // Parse payload
      let payload;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return json(res, 400, { ok: false, ...ackBase, ...reason('ARGS_INVALID', 'invalid JSON body') });
      }

      // Validate minimal payload
      const required = [
        'schemaVersion',
        'deliveryId',
        'command',
        'args',
        'repo',
        'installationId',
        'issueNumber',
        'prNumber',
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
        return json(res, 400, { ok: false, ...ackBase, ...reason('ARGS_INVALID', `missing required fields: ${missing.join(', ')}`) });
      }

      const [owner, repo] = String(payload.repo).split('/');
      if (!owner || !repo) {
        return json(res, 400, { ok: false, ...ackBase, ...reason('ARGS_INVALID', 'invalid repo format, expected owner/repo') });
      }

      const issueNumber = Number(payload.prNumber || payload.issueNumber || 0);
      if (!issueNumber) {
        return json(res, 400, { ok: false, ...ackBase, ...reason('ARGS_INVALID', 'missing issueNumber/prNumber') });
      }



      const repoFull = String(payload.repo);
      // Repo / installation allowlist (fail-closed)
      if (!allowedRepos.has(repoFull)) {
        const ack = { accepted: false, ...ackBase, ...reason('REPO_NOT_ALLOWED', `repo not allowed: ${repoFull}`) };
        await withRetry(() => createIssueComment({ token: ghToken, owner, repo, issueNumber, body: formatAck(ack, payload) }));
        await db.run('INSERT OR REPLACE INTO deliveries(delivery_id, created_at_ms, ack_json) VALUES(?,?,?)', payload.deliveryId, now, JSON.stringify(ack));
        return json(res, 200, { ok: true, ack });
      }
      const expectedInst = allowedRepos.get(repoFull);
      const instId = Number(payload.installationId);
      if (expectedInst && instId !== expectedInst) {
        const ack = { accepted: false, ...ackBase, ...reason('INSTALLATION_MISMATCH', `installation mismatch: expected ${expectedInst} got ${instId}`) };
        await withRetry(() => createIssueComment({ token: ghToken, owner, repo, issueNumber, body: formatAck(ack, payload) }));
        await db.run('INSERT OR REPLACE INTO deliveries(delivery_id, created_at_ms, ack_json) VALUES(?,?,?)', payload.deliveryId, now, JSON.stringify(ack));
        return json(res, 200, { ok: true, ack });
      }

      // Author policy (fail-closed)
      if (!isAuthorAllowed(payload.authorAssociation)) {
        const ack = { accepted: false, ...ackBase, ...reason('AUTHOR_NOT_ALLOWED', `author_association=${payload.authorAssociation}`) };
        await withRetry(() => createIssueComment({ token: ghToken, owner, repo, issueNumber, body: formatAck(ack, payload) }));
        await db.run('INSERT OR REPLACE INTO deliveries(delivery_id, created_at_ms, ack_json) VALUES(?,?,?)', payload.deliveryId, now, JSON.stringify(ack));
        return json(res, 200, { ok: true, ack });
      }

      // Rate limit (fail-closed): key = repo + actor + command
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
            await withRetry(() => createIssueComment({ token: ghToken, owner, repo, issueNumber, body: formatAck(ack, payload) }));
            await db.run('INSERT OR REPLACE INTO deliveries(delivery_id, created_at_ms, ack_json) VALUES(?,?,?)', payload.deliveryId, now, JSON.stringify(ack));
            return json(res, 200, { ok: true, ack });
          }
          await db.run('INSERT OR REPLACE INTO rate_limits(key, window_start_ms, count) VALUES(?,?,?)', rlKey, windowStart, count + 1);
        }
      }
      const command = String(payload.command).trim();
      const args = String(payload.args || '').trim();

      // Route
      const routedAgent = defaultRoute(command);
      if (!routedAgent) {
        const ack = { accepted: false, ...ackBase, ...reason('ROUTE_NOT_FOUND', `unknown command: ${command}`) };
        await withRetry(() => createIssueComment({ token: ghToken, owner, repo, issueNumber, body: formatAck(ack, payload) }));
        return json(res, 200, { ok: true, ack });
      }

      // Command idempotency
      const idemKey = String(payload.idempotencyKey);
      const prevCmd = await db.get('SELECT status, run_id FROM commands WHERE idempotency_key = ?', idemKey);
      if (prevCmd) {
        const ack = {
          accepted: true,
          ...ackBase,
          status: prevCmd.status === 'completed' ? 'ALREADY_DONE' : 'IN_PROGRESS',
          parentRunId: prevCmd.run_id,
        };
        await withRetry(() => createIssueComment({ token: ghToken, owner, repo, issueNumber, body: formatAck(ack, payload) }));
        return json(res, 200, { ok: true, ack });
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

      await withRetry(() => createIssueComment({ token: ghToken, owner, repo, issueNumber, body: formatAck(ack, payload) }));

      // v1 stub executor
      setTimeout(async () => {
        const final = {
          verdict: 'success',
          summary: `stub executor: routed to agentId=${routedAgent} command=${command}`,
          evidenceLinks: [],
          traceId,
          runId,
        };
        try {
          await withRetry(() => createIssueComment({ token: ghToken, owner, repo, issueNumber, body: formatFinal(final, payload) }));
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
          const errFinal = { verdict: 'failed', errorCode: 'WRITEBACK_FAILED', summary: String(e.message || e), traceId, runId };
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
