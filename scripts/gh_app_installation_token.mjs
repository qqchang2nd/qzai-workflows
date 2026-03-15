#!/usr/bin/env node
/**
 * 输出 GitHub App Installation Token（仅 stdout 输出 token）。
 *
 * 依赖环境变量：
 * - SLASH_BRIDGE_GH_APP_ID
 * - SLASH_BRIDGE_GH_APP_PRIVATE_KEY_PATH
 *
 * Installation ID：
 * - 优先：CLI 第一个参数
 * - 其次：SLASH_BRIDGE_GH_APP_INSTALLATION_ID
 */

import fs from 'node:fs';
import crypto from 'node:crypto';

const appId = String(process.env.SLASH_BRIDGE_GH_APP_ID || '').trim();
const keyPath = String(process.env.SLASH_BRIDGE_GH_APP_PRIVATE_KEY_PATH || '').trim();
const installationId = String(process.argv[2] || process.env.SLASH_BRIDGE_GH_APP_INSTALLATION_ID || '').trim();

if (!appId || !keyPath || !installationId) {
  console.error('缺少参数/环境变量：需要 SLASH_BRIDGE_GH_APP_ID、SLASH_BRIDGE_GH_APP_PRIVATE_KEY_PATH，以及 installationId（CLI 参数或 SLASH_BRIDGE_GH_APP_INSTALLATION_ID）。');
  process.exit(1);
}

let privateKey;
try {
  privateKey = fs.readFileSync(keyPath, 'utf8');
} catch (e) {
  console.error(`无法读取私钥文件：${keyPath}`);
  console.error(String(e?.message || e));
  process.exit(1);
}

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function signJwt({ iss, privateKeyPem }) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60,
    exp: now + 10 * 60,
    iss,
  };

  const toSign = `${b64url(header)}.${b64url(payload)}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(toSign);
  const sig = signer.sign(privateKeyPem, 'base64url');
  return `${toSign}.${sig}`;
}

async function main() {
  const jwt = signJwt({ iss: appId, privateKeyPem: privateKey });
  const url = `https://api.github.com/app/installations/${installationId}/access_tokens`;

  let resp;
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'qzai-workflows/gh_app_installation_token',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
  } catch (e) {
    console.error('请求 GitHub API 失败：网络或 fetch 异常');
    console.error(String(e?.message || e));
    process.exit(1);
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    console.error(`GitHub API 返回失败：HTTP ${resp.status}`);
    if (text) console.error(text);
    process.exit(1);
  }

  const data = await resp.json();
  if (!data?.token) {
    console.error('GitHub API 响应中未包含 token 字段');
    process.exit(1);
  }

  process.stdout.write(`${data.token}\n`);
}

main().catch((e) => {
  console.error('脚本执行失败：');
  console.error(String(e?.message || e));
  process.exit(1);
});
