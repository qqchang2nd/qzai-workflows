import fs from 'node:fs';
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

async function ghFetchApp(path, { method = 'GET', body, headers = {} } = {}) {
  const resp = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!resp.ok) {
    const err = new Error(`GitHub API ${method} ${path} failed: HTTP ${resp.status}`);
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data;
}

// 缓存按 (agent/appId/installationId) 隔离，避免不同身份串号
const tokenCache = new Map(); // Map<string, { token: string, expiresAtMs: number }>

export async function getGitHubTokenFromEnv({ installationId, agentId } = {}) {
  // 基于 agentId 构造环境变量后缀（全大写），例如 "__LUXIAOFENG"
  const suffix = agentId ? `__${String(agentId).toUpperCase()}` : '';

  // 1) 先尝试 agent 专属 GITHUB_TOKEN（若无则 fallback 全局 GITHUB_TOKEN）
  const direct = String((suffix && process.env[`GITHUB_TOKEN${suffix}`]) || process.env.GITHUB_TOKEN || '').trim();
  if (direct) return direct;

  // 2) GitHub App：先尝试 agent 专属配置（若无则 fallback 全局配置）
  const appId = String((suffix && process.env[`SLASH_BRIDGE_GH_APP_ID${suffix}`]) || process.env.SLASH_BRIDGE_GH_APP_ID || '').trim();
  const keyPath = String(
    (suffix && process.env[`SLASH_BRIDGE_GH_APP_PRIVATE_KEY_PATH${suffix}`]) ||
      process.env.SLASH_BRIDGE_GH_APP_PRIVATE_KEY_PATH ||
      ''
  ).trim();

  const inst = String(
    installationId ||
      (suffix && process.env[`SLASH_BRIDGE_GH_APP_INSTALLATION_ID${suffix}`]) ||
      process.env.SLASH_BRIDGE_GH_APP_INSTALLATION_ID ||
      ''
  ).trim();

  if (!appId || !keyPath || !inst) {
    throw new Error(
      `Missing GitHub auth env for agent ${agentId || 'global'}: set either GITHUB_TOKEN or (SLASH_BRIDGE_GH_APP_ID + SLASH_BRIDGE_GH_APP_PRIVATE_KEY_PATH + installationId)`
    );
  }

  const cacheKey = `${agentId || 'global'}:${appId}:${inst}`;
  const now = Date.now();
  const cached = tokenCache.get(cacheKey);
  if (cached?.token && cached?.expiresAtMs && now < cached.expiresAtMs - 60_000) {
    return cached.token;
  }

  const privateKeyPem = fs.readFileSync(keyPath, 'utf8');
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

  const expiresAtMs = Date.parse(expiresAt);
  tokenCache.set(cacheKey, { token, expiresAtMs });
  return token;
}
