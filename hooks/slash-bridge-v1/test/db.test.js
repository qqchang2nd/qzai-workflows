import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, cleanupExpired, insertNonceAtomic, insertDeliveryAtomic, getLatestReviewRound, insertReviewRound, updateReviewRoundStatus, countReviewRounds } from '../src/db.js';

async function memDb() {
  return openDb(':memory:');
}

test('openDb creates all tables', async () => {
  const db = await memDb();
  const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
  const names = tables.map((r) => r.name);
  assert.ok(names.includes('nonces'));
  assert.ok(names.includes('deliveries'));
  assert.ok(names.includes('commands'));
  assert.ok(names.includes('rate_limits'));
  assert.ok(names.includes('dead_letters'));
  assert.ok(names.includes('review_rounds'));
  await db.close();
});

test('cleanupExpired removes only expired nonces and commands', async () => {
  const db = await memDb();
  const now = Date.now();
  await db.run('INSERT INTO nonces(nonce, expires_at_ms) VALUES(?,?)', 'old', now - 1000);
  await db.run('INSERT INTO nonces(nonce, expires_at_ms) VALUES(?,?)', 'fresh', now + 60_000);
  await db.run('INSERT INTO commands(idempotency_key, created_at_ms, expires_at_ms, status, trace_id, run_id) VALUES(?,?,?,?,?,?)',
    'old_cmd', now, now - 1, 'completed', 't', 'r');
  await db.run('INSERT INTO commands(idempotency_key, created_at_ms, expires_at_ms, status, trace_id, run_id) VALUES(?,?,?,?,?,?)',
    'new_cmd', now, now + 60_000, 'in_progress', 't2', 'r2');

  await cleanupExpired(db, now);

  const nonces = await db.all('SELECT nonce FROM nonces');
  assert.equal(nonces.length, 1);
  assert.equal(nonces[0].nonce, 'fresh');

  const cmds = await db.all('SELECT idempotency_key FROM commands');
  assert.equal(cmds.length, 1);
  assert.equal(cmds[0].idempotency_key, 'new_cmd');
  await db.close();
});

test('insertNonceAtomic: first insert returns true', async () => {
  const db = await memDb();
  const result = await insertNonceAtomic(db, 'mynonce', Date.now() + 60_000);
  assert.equal(result, true);
  await db.close();
});

test('insertNonceAtomic: duplicate insert returns false (TOCTOU-safe)', async () => {
  const db = await memDb();
  await insertNonceAtomic(db, 'mynonce', Date.now() + 60_000);
  const result = await insertNonceAtomic(db, 'mynonce', Date.now() + 60_000);
  assert.equal(result, false);
  await db.close();
});

test('insertNonceAtomic: concurrent inserts - only one succeeds', async () => {
  const db = await memDb();
  const nonce = 'concurrent_nonce';
  const exp = Date.now() + 60_000;
  const results = await Promise.all([
    insertNonceAtomic(db, nonce, exp),
    insertNonceAtomic(db, nonce, exp),
    insertNonceAtomic(db, nonce, exp),
  ]);
  const successCount = results.filter(Boolean).length;
  assert.equal(successCount, 1, 'exactly one insert should succeed');
  await db.close();
});

test('insertDeliveryAtomic: first insert returns true', async () => {
  const db = await memDb();
  const result = await insertDeliveryAtomic(db, 'del1', Date.now(), '{}');
  assert.equal(result, true);
  await db.close();
});

test('insertDeliveryAtomic: duplicate returns false (idempotent)', async () => {
  const db = await memDb();
  await insertDeliveryAtomic(db, 'del1', Date.now(), '{"first": true}');
  const result = await insertDeliveryAtomic(db, 'del1', Date.now(), '{"second": true}');
  assert.equal(result, false);
  // Original value preserved
  const row = await db.get('SELECT ack_json FROM deliveries WHERE delivery_id = ?', 'del1');
  assert.equal(JSON.parse(row.ack_json).first, true);
  await db.close();
});

test('review_rounds: insert and retrieve latest round', async () => {
  const db = await memDb();
  const now = Date.now();
  await insertReviewRound(db, {
    prKey: 'owner/repo#1', round: 1, headSha: 'abc', status: 'reviewing',
    reviewRunId: null, nowMs: now,
  });
  const latest = await getLatestReviewRound(db, 'owner/repo#1');
  assert.equal(latest.round, 1);
  assert.equal(latest.status, 'reviewing');
  assert.equal(latest.head_sha, 'abc');
  await db.close();
});

test('review_rounds: updateReviewRoundStatus changes status', async () => {
  const db = await memDb();
  const now = Date.now();
  await insertReviewRound(db, {
    prKey: 'owner/repo#2', round: 1, headSha: 'abc', status: 'reviewing',
    reviewRunId: null, nowMs: now,
  });
  await updateReviewRoundStatus(db, { prKey: 'owner/repo#2', round: 1, status: 'approved', nowMs: now + 1000 });
  const latest = await getLatestReviewRound(db, 'owner/repo#2');
  assert.equal(latest.status, 'approved');
  await db.close();
});

test('review_rounds: countReviewRounds returns correct count', async () => {
  const db = await memDb();
  const now = Date.now();
  const key = 'owner/repo#3';
  assert.equal(await countReviewRounds(db, key), 0);
  await insertReviewRound(db, { prKey: key, round: 1, headSha: 'a', status: 'reviewing', reviewRunId: null, nowMs: now });
  await insertReviewRound(db, { prKey: key, round: 2, headSha: 'b', status: 'pending_fix', reviewRunId: null, nowMs: now });
  assert.equal(await countReviewRounds(db, key), 2);
  await db.close();
});

test('review_rounds: getLatestReviewRound returns highest round', async () => {
  const db = await memDb();
  const now = Date.now();
  const key = 'owner/repo#4';
  await insertReviewRound(db, { prKey: key, round: 1, headSha: 'a', status: 'pending_fix', reviewRunId: null, nowMs: now });
  await insertReviewRound(db, { prKey: key, round: 2, headSha: 'b', status: 'reviewing', reviewRunId: null, nowMs: now });
  const latest = await getLatestReviewRound(db, key);
  assert.equal(latest.round, 2);
  await db.close();
});
