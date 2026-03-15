/**
 * Authorization and rate-limiting policy checks.
 */

import { reason } from './format.js';

/**
 * Parse SLASH_BRIDGE_ALLOWED_REPOS env value into a Map<repoFull, installationId|null>.
 * Format: "owner/repo:installationId,owner2/repo2"
 */
export function parseAllowedRepos(s) {
  const out = new Map();
  for (const part of String(s || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const [r, inst] = part.split(':').map((x) => x.trim());
    if (!r) continue;
    out.set(r, inst ? Number(inst) : null);
  }
  return out;
}

/**
 * Check if repo is in the allowlist and installationId matches (if configured).
 * Returns null on success, or a reason object on failure.
 */
export function checkRepoPolicy(allowedRepos, repoFull, installationId) {
  if (!allowedRepos.has(repoFull)) {
    return reason('REPO_NOT_ALLOWED', `repo not allowed: ${repoFull}`);
  }

  const expectedInst = allowedRepos.get(repoFull);
  if (expectedInst !== null && expectedInst !== undefined) {
    const instId = Number(installationId);
    if (!Number.isFinite(instId) || instId <= 0) {
      return reason('ARGS_INVALID', 'invalid installationId');
    }
    if (instId !== expectedInst) {
      return reason('INSTALLATION_MISMATCH', `installation mismatch: expected ${expectedInst} got ${instId}`);
    }
  }

  return null;
}

/**
 * Check if authorAssociation is in the allowed set.
 * Returns null on success, or a reason object on failure.
 */
export function checkAuthorPolicy(authorAssociation, { extraAllow = [] } = {}) {
  const allowed = new Set(['OWNER', 'MEMBER', 'COLLABORATOR', ...extraAllow.map((x) => String(x).toUpperCase())]);
  if (!allowed.has(String(authorAssociation || '').toUpperCase())) {
    return reason('AUTHOR_NOT_ALLOWED', `author_association=${authorAssociation}`);
  }
  return null;
}

/**
 * Check rate limit for a given key.
 * Returns null if allowed, or a reason object if rate-limited.
 * Side effect: updates rate_limits table.
 */
export async function checkRateLimit(db, rlKey, nowMs, { windowMs, maxCount }) {
  // HIGH-4 fix: wrap read-increment-write in BEGIN IMMEDIATE transaction to prevent TOCTOU
  await db.run('BEGIN IMMEDIATE');
  try {
    const row = await db.get('SELECT window_start_ms, count FROM rate_limits WHERE key=?', rlKey);
    const windowStart = row?.window_start_ms ?? nowMs;
    const count = row?.count ?? 0;

    let limited = false;
    if (nowMs - windowStart > windowMs) {
      // Window expired: reset
      await db.run('INSERT OR REPLACE INTO rate_limits(key, window_start_ms, count) VALUES(?,?,?)', rlKey, nowMs, 1);
    } else if (count + 1 > maxCount) {
      limited = true;
    } else {
      await db.run('INSERT OR REPLACE INTO rate_limits(key, window_start_ms, count) VALUES(?,?,?)', rlKey, windowStart, count + 1);
    }

    await db.run('COMMIT');
    return limited ? reason('RATE_LIMITED', `limit=${maxCount}/${windowMs}ms key=${rlKey}`) : null;
  } catch (e) {
    try { await db.run('ROLLBACK'); } catch {}
    throw e;
  }
}
