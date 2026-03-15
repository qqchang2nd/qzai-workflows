import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const API = 'https://api.github.com';

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt({ appId, privateKeyPem }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iat: now, exp: now + 600, iss: String(appId) };
  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(payload));
  const hp = `${h}.${p}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(hp);
  signer.end();
  const sig = signer.sign(privateKeyPem);
  return `${hp}.${base64url(sig)}`;
}

async function ghFetchApp(path_, { method = 'GET', body, headers = {} } = {}) {
  const resp = await fetch(`${API}${path_}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });

  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!resp.ok) {
    const err = new Error(`GitHub API ${method} ${path_} failed: HTTP ${resp.status}`);
    err.status = resp.status;
    err.data = data;
    throw err;
  }

  return data;
}

// --- Private key PEM cache (per resolved path) ---
const pemCache = new Map(); // Map<string, string>

function validateAndResolvePemPath(keyPath) {
  const raw = String(keyPath || '').trim();
  if (!raw) return null;

  // Path traversal guard: reject paths with '..' components
  const resolved = path.resolve(raw);
  if (resolved !== path.normalize(resolved) || raw.includes('..')) {
    throw new Error(`SLASH_BRIDGE_GH_APP_PRIVATE_KEY_PATH contains path traversal: ${raw}`);
  }
  if (!path.isAbsolute(resolved)) {
    throw new Error(`SLASH_BRIDGE_GH_APP_PRIVATE_KEY_PATH must be absolute: ${raw}`);
  }
  return resolved;
}

function getPrivateKeyPemForPath(keyPath) {
  const resolved = validateAndResolvePemPath(keyPath);
  if (!resolved) return null;
  if (pemCache.has(resolved)) return pemCache.get(resolved);
  const pem = fs.readFileSync(resolved, 'utf8');
  pemCache.set(resolved, pem);
  return pem;
}

// --- Token cache + singleflight (per identity key) ---
// cache key: agentKey:appId:installationId (or agentKey:GITHUB_TOKEN:direct)
const cache = new Map(); // Map<string, { token: string, expiresAtMs: number }>
const inflight = new Map(); // Map<string, Promise<string>>

async function mintInstallationToken({ appId, privateKeyPem, inst }) {
  const jwt = signJwt({ appId, privateKeyPem });

  const data = await ghFetchApp(`/app/installations/${inst}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: {},
  });

  const token = String(data?.token || '').trim();
  const expiresAt = String(data?.expires_at || '').trim();
  if (!token || !expiresAt) {
    throw new Error('Failed to obtain installation token from GitHub');
  }

  return { token, expiresAtMs: Date.parse(expiresAt) };
}

function suffixOf(agentId) {
  const a = String(agentId || '').trim();
  return a ? `__${a.toUpperCase()}` : '';
}

function pickEnv(base, suffix) {
  if (suffix && process.env[`${base}${suffix}`]) return process.env[`${base}${suffix}`];
  return process.env[base];
}

/**
 * Get a GitHub token for writebacks.
 *
 * 支持“按 agent 身份切换”：
 * - 专属覆盖：GITHUB_TOKEN__<AGENT> 或 SLASH_BRIDGE_GH_APP_*__<AGENT>
 * - fallback：全局 GITHUB_TOKEN 或全局 SLASH_BRIDGE_GH_APP_*
 *
 * CRIT-1 note: GITHUB_TOKEN env var is supported ONLY for local single-installation
 * debugging. It bypasses per-installation auth and MUST NOT be set in multi-tenant
 * deployments where requests span multiple installations.
 */
export async function getGitHubTokenFromEnv({ installationId, agentId } = {}) {
  const suffix = suffixOf(agentId);
  const agentKey = suffix ? suffix.slice(2) : 'GLOBAL';

  // 1) direct token
  const direct = String(pickEnv('GITHUB_TOKEN', suffix) || '').trim();
  if (direct) {
    if (installationId) {
      console.warn(
        '[token] WARNING: GITHUB_TOKEN is set (agent=%s); ignoring installationId=%s. Do not use GITHUB_TOKEN in multi-installation deployments.',
        agentKey,
        installationId
      );
    }
    return direct;
  }

  // 2) GitHub App
  const appId = String(pickEnv('SLASH_BRIDGE_GH_APP_ID', suffix) || '').trim();
  const keyPath = String(pickEnv('SLASH_BRIDGE_GH_APP_PRIVATE_KEY_PATH', suffix) || '').trim();

  const inst = String(
    installationId || pickEnv('SLASH_BRIDGE_GH_APP_INSTALLATION_ID', suffix) || process.env.SLASH_BRIDGE_GH_APP_INSTALLATION_ID || ''
  ).trim();

  const privateKeyPem = getPrivateKeyPemForPath(keyPath);

  if (!appId || !privateKeyPem || !inst) {
    throw new Error(
      `Missing GitHub auth env (agent=${agentKey}): set either GITHUB_TOKEN or (SLASH_BRIDGE_GH_APP_ID + SLASH_BRIDGE_GH_APP_PRIVATE_KEY_PATH + installationId)`
    );
  }

  const cacheKey = `${agentKey}:${appId}:${inst}`;
  const now = Date.now();

  const cached = cache.get(cacheKey);
  if (cached?.token && cached?.expiresAtMs && now < cached.expiresAtMs - 60_000) {
    return cached.token;
  }

  if (inflight.has(cacheKey)) {
    return await inflight.get(cacheKey);
  }

  const p = (async () => {
    const { token, expiresAtMs } = await mintInstallationToken({ appId, privateKeyPem, inst });
    cache.set(cacheKey, { token, expiresAtMs });
    return token;
  })();

  inflight.set(cacheKey, p);
  try {
    return await p;
  } finally {
    inflight.delete(cacheKey);
  }
}
