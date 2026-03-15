import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock fetch for token tests
function makeMockFetch(responses) {
  let callIndex = 0;
  return async (url, opts) => {
    const resp = responses[callIndex++] || { ok: false, status: 500, text: async () => '{}' };
    return {
      ok: resp.ok,
      status: resp.status || 200,
      headers: { get: (h) => resp.headers?.[h] ?? null },
      text: async () => typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body || {}),
    };
  };
}

// We test token.js by dynamically importing with mocked env and fetch

test('GITHUB_TOKEN short-circuits app auth', async () => {
  process.env.GITHUB_TOKEN = 'ghp_direct';
  // Clear module cache to re-import fresh
  const { getGitHubTokenFromEnv } = await import('../src/token.js?t=1');
  const token = await getGitHubTokenFromEnv();
  assert.equal(token, 'ghp_direct');
  delete process.env.GITHUB_TOKEN;
});

test('missing all auth env vars throws', async () => {
  delete process.env.GITHUB_TOKEN;
  delete process.env.SLASH_BRIDGE_GH_APP_ID;
  delete process.env.SLASH_BRIDGE_GH_APP_PRIVATE_KEY_PATH;
  const { getGitHubTokenFromEnv } = await import('../src/token.js?t=2');
  await assert.rejects(() => getGitHubTokenFromEnv(), /Missing GitHub auth/);
});
