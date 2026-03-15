import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAllowedRepos, checkRepoPolicy, checkAuthorPolicy, checkRateLimit } from '../src/policy.js';
import { openDb } from '../src/db.js';

async function memDb() {
  return openDb(':memory:');
}

// parseAllowedRepos tests
test('parseAllowedRepos: parses repo with installationId', () => {
  const m = parseAllowedRepos('owner/repo:12345');
  assert.equal(m.get('owner/repo'), 12345);
});

test('parseAllowedRepos: parses repo without installationId (null)', () => {
  const m = parseAllowedRepos('owner/repo');
  assert.equal(m.get('owner/repo'), null);
});

test('parseAllowedRepos: parses multiple repos', () => {
  const m = parseAllowedRepos('a/b:100,c/d,e/f:200');
  assert.equal(m.get('a/b'), 100);
  assert.equal(m.get('c/d'), null);
  assert.equal(m.get('e/f'), 200);
});

test('parseAllowedRepos: empty string returns empty map', () => {
  const m = parseAllowedRepos('');
  assert.equal(m.size, 0);
});

// checkRepoPolicy tests
test('checkRepoPolicy: repo in allowlist returns null', () => {
  const repos = parseAllowedRepos('owner/repo:123');
  assert.equal(checkRepoPolicy(repos, 'owner/repo', '123'), null);
});

test('checkRepoPolicy: repo not in allowlist returns REPO_NOT_ALLOWED', () => {
  const repos = parseAllowedRepos('owner/repo:123');
  const result = checkRepoPolicy(repos, 'other/repo', '123');
  assert.equal(result?.reasonCode, 'REPO_NOT_ALLOWED');
});

test('checkRepoPolicy: installationId mismatch returns INSTALLATION_MISMATCH', () => {
  const repos = parseAllowedRepos('owner/repo:123');
  const result = checkRepoPolicy(repos, 'owner/repo', '999');
  assert.equal(result?.reasonCode, 'INSTALLATION_MISMATCH');
});

test('checkRepoPolicy: invalid installationId (NaN) returns ARGS_INVALID', () => {
  const repos = parseAllowedRepos('owner/repo:123');
  const result = checkRepoPolicy(repos, 'owner/repo', 'notanumber');
  assert.equal(result?.reasonCode, 'ARGS_INVALID');
});

test('checkRepoPolicy: allowlist without installationId skips install check', () => {
  const repos = parseAllowedRepos('owner/repo');
  assert.equal(checkRepoPolicy(repos, 'owner/repo', 'anything'), null);
});

// checkAuthorPolicy tests
test('checkAuthorPolicy: OWNER/MEMBER/COLLABORATOR are allowed', () => {
  for (const assoc of ['OWNER', 'MEMBER', 'COLLABORATOR']) {
    assert.equal(checkAuthorPolicy(assoc), null, `${assoc} should be allowed`);
  }
});

test('checkAuthorPolicy: NONE and CONTRIBUTOR are not allowed by default', () => {
  assert.equal(checkAuthorPolicy('NONE')?.reasonCode, 'AUTHOR_NOT_ALLOWED');
  assert.equal(checkAuthorPolicy('CONTRIBUTOR')?.reasonCode, 'AUTHOR_NOT_ALLOWED');
  assert.equal(checkAuthorPolicy('')?.reasonCode, 'AUTHOR_NOT_ALLOWED');
});

test('checkAuthorPolicy: extraAllow extends the allowed set', () => {
  assert.equal(checkAuthorPolicy('CONTRIBUTOR', { extraAllow: ['contributor'] }), null);
});

// checkRateLimit tests
test('checkRateLimit: first request is allowed', async () => {
  const db = await memDb();
  const result = await checkRateLimit(db, 'key1', Date.now(), { windowMs: 60_000, maxCount: 5 });
  assert.equal(result, null);
  await db.close();
});

test('checkRateLimit: up to maxCount requests are allowed', async () => {
  const db = await memDb();
  const now = Date.now();
  for (let i = 0; i < 5; i++) {
    const result = await checkRateLimit(db, 'key2', now, { windowMs: 60_000, maxCount: 5 });
    assert.equal(result, null, `request ${i + 1} should pass`);
  }
  await db.close();
});

test('checkRateLimit: request beyond maxCount returns RATE_LIMITED', async () => {
  const db = await memDb();
  const now = Date.now();
  for (let i = 0; i < 5; i++) {
    await checkRateLimit(db, 'key3', now, { windowMs: 60_000, maxCount: 5 });
  }
  const result = await checkRateLimit(db, 'key3', now, { windowMs: 60_000, maxCount: 5 });
  assert.equal(result?.reasonCode, 'RATE_LIMITED');
  await db.close();
});

test('checkRateLimit: window expiry resets counter', async () => {
  const db = await memDb();
  const now = Date.now();
  for (let i = 0; i < 5; i++) {
    await checkRateLimit(db, 'key4', now, { windowMs: 60_000, maxCount: 5 });
  }
  // Advance time past window
  const result = await checkRateLimit(db, 'key4', now + 61_000, { windowMs: 60_000, maxCount: 5 });
  assert.equal(result, null, 'request after window reset should pass');
  await db.close();
});
