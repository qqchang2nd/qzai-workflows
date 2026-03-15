import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const API = 'https://api.github.com';

// Cache per installationId: Map<string, { token, expiresAtMs }>
const cache = new Map();
// Singleflight per installationId: Map<string, Promise<string>>
const inflight = new Map();

// Read PEM once at first call to avoid per-request sync I/O.
// CRIT-3 fix: validate key path is absolute and contains no traversal sequences.
let _privateKeyPem = null;
function getPrivateKeyPem() {
  if (_privateKeyPem !== null) return _privateKeyPem;
  const keyPath = String(process.env.SLASH_BRIDGE_GH_APP_PRIVATE_KEY_PATH || '').trim();
  if (!keyPath) return null;

  // Path traversal guard: reject paths with '..' components
  const resolved = path.resolve(keyPath);
  if (resolved !== path.normalize(resolved) || keyPath.includes('..')) {
    throw new Error(`SLASH_BRIDGE_GH_APP_PRIVATE_KEY_PATH contains path traversal: ${keyPath}`);
  }
  // Must be an absolute path to a regular file
  if (!path.isAbsolute(resolved)) {
    throw new Error(`SLASH_BRIDGE_GH_APP_PRIVATE_KEY_PATH must be absolute: ${keyPath}`);
  }

  _privateKeyPem = fs.readFileSync(resolved, 'utf8');
  return _privateKeyPem;
}

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

async function mintToken({ appId, privateKeyPem, inst }) {
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

/**
 * Get a GitHub token for the given installationId.
 *
 * CRIT-1 note: GITHUB_TOKEN env var is supported ONLY for local single-installation
 * debugging. It bypasses per-installation auth and MUST NOT be set in multi-tenant
 * deployments where requests span multiple installations.
 */
export async function getGitHubTokenFromEnv({ installationId } = {}) {
  const direct = String(process.env.GITHUB_TOKEN || '').trim();
  if (direct) {
    // Warn if an installationId was provided but GITHUB_TOKEN overrides it — this
    // indicates a misconfigured multi-tenant deployment.
    if (installationId) {
      console.warn('[token] WARNING: GITHUB_TOKEN is set; ignoring installationId=%s. Do not use GITHUB_TOKEN in multi-installation deployments.', installationId);
    }
    return direct;
  }

  const appId = String(process.env.SLASH_BRIDGE_GH_APP_ID || '').trim();
  const inst = String(installationId || process.env.SLASH_BRIDGE_GH_APP_INSTALLATION_ID || '').trim();

  const privateKeyPem = getPrivateKeyPem();

  if (!appId || !privateKeyPem || !inst) {
    throw new Error('Missing GitHub auth env: set either GITHUB_TOKEN or (SLASH_BRIDGE_GH_APP_ID + SLASH_BRIDGE_GH_APP_PRIVATE_KEY_PATH + installationId)');
  }

  const cacheKey = String(inst);
  const now = Date.now();

  // Cache hit: 300s expiry margin
  const cached = cache.get(cacheKey);
  if (cached && cached.token && cached.expiresAtMs && now < cached.expiresAtMs - 300_000) {
    return cached.token;
  }

  // Singleflight: deduplicate concurrent requests for same installationId
  if (inflight.has(cacheKey)) {
    return inflight.get(cacheKey);
  }

  const promise = mintToken({ appId, privateKeyPem, inst }).then((result) => {
    cache.set(cacheKey, result);
    inflight.delete(cacheKey);
    return result.token;
  }).catch((err) => {
    inflight.delete(cacheKey);
    throw err;
  });

  inflight.set(cacheKey, promise);
  return promise;
}
