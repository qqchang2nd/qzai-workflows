/**
 * slash-bridge-v1 HTTP server entry point.
 * Thin bootstrap: wires dependencies and starts the HTTP server.
 */

import http from 'node:http';

import { openDb, cleanupExpired } from './db.js';
import { parseAllowedRepos } from './policy.js';
import { getGitHubTokenFromEnv } from './token.js';
import { createDispatcher } from './executor.js';
import { createHandler } from './handler.js';

const DEFAULT_PORT = 8787;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function main() {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const dbPath = process.env.SLASH_BRIDGE_DB_PATH || './slash-bridge-v1.sqlite';

  const secret = process.env.SLASH_BRIDGE_HOOK_SECRET || '';
  if (!secret) {
    console.error('[slash-bridge-v1] Missing env SLASH_BRIDGE_HOOK_SECRET');
    process.exit(1);
  }

  const allowedRepos = parseAllowedRepos(process.env.SLASH_BRIDGE_ALLOWED_REPOS || '');
  if (allowedRepos.size === 0) {
    console.error('[slash-bridge-v1] Missing/empty env SLASH_BRIDGE_ALLOWED_REPOS (fail-closed)');
    process.exit(1);
  }

  const authorAssocExtra = String(process.env.SLASH_BRIDGE_AUTHOR_ASSOC_EXTRA_ALLOW || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

  const rateLimitWindowMs = Number(process.env.SLASH_BRIDGE_RATE_WINDOW_MS || 60_000);
  const rateLimitMax = Number(process.env.SLASH_BRIDGE_RATE_MAX || 5);

  console.log('[slash-bridge-v1] config', {
    port,
    dbPath,
    allowedRepos: [...allowedRepos.entries()],
    rateLimitWindowMs,
    rateLimitMax,
    authorAssocExtra,
  });

  const db = await openDb(dbPath);

  // Periodic cleanup of expired nonces and commands
  const cleanupTimer = setInterval(async () => {
    try {
      await cleanupExpired(db, Date.now());
    } catch (e) {
      console.error('[slash-bridge-v1] cleanup error', e);
    }
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();

  const config = { secret, allowedRepos, authorAssocExtra, rateLimitWindowMs, rateLimitMax };

  // getToken: 支持按 agentId 切换 GitHub 身份（若 agentId 未配置专属身份则自动 fallback 到全局）
  const getToken = (installationId, agentId) => getGitHubTokenFromEnv({ installationId, agentId });

  const dispatch = createDispatcher({ db, config });
  const handler = createHandler({ db, config, getToken, dispatch });

  const server = http.createServer(async (req, res) => {
    try {
      await handler(req, res);
    } catch (e) {
      console.error('[slash-bridge-v1] handler error', e);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'INTERNAL_ERROR', detail: 'see server logs' }));
      }
    }
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    console.log(`[slash-bridge-v1] ${signal} received, shutting down...`);
    clearInterval(cleanupTimer);
    server.close(async () => {
      try {
        await db.close();
      } catch {}
      console.log('[slash-bridge-v1] shutdown complete');
      process.exit(0);
    });
    // Force exit after 10s if connections don't drain
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  server.listen(port, () => {
    console.log(`[slash-bridge-v1] listening on :${port}`);
  });
}

main().catch((e) => {
  console.error('[slash-bridge-v1] fatal', e);
  process.exit(1);
});
