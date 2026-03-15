import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { openDb } from '../src/db.js';
import { startReviewRound, completeReviewRound, handlePrPush, getReviewStatus } from '../src/review.js';

async function memDb() {
  return openDb(':memory:');
}

const ctx = { owner: 'acme', repo: 'app', prNumber: 42 };

test('UC-C: first /qzai review creates round=1, status=reviewing', async () => {
  const db = await memDb();
  const now = Date.now();
  const result = await startReviewRound(db, { ...ctx, headSha: 'sha1', nowMs: now });
  assert.equal(result.round, 1);
  assert.equal(result.status, 'reviewing');
  assert.equal(result.isNew, true);
  assert.equal(result.alreadyReviewing, false);
  await db.close();
});

test('UC-C: same headSha + reviewing is idempotent (no new round)', async () => {
  const db = await memDb();
  const now = Date.now();
  await startReviewRound(db, { ...ctx, headSha: 'sha1', nowMs: now });
  const result = await startReviewRound(db, { ...ctx, headSha: 'sha1', nowMs: now });
  assert.equal(result.isNew, false);
  assert.equal(result.alreadyReviewing, true);
  await db.close();
});

test('UC-C: review with no blocking issues -> status=approved, no followup', async () => {
  const db = await memDb();
  const now = Date.now();
  await startReviewRound(db, { ...ctx, headSha: 'sha1', nowMs: now });
  const result = await completeReviewRound(db, { ...ctx, headSha: 'sha1', blockingIssues: [], nowMs: now + 1000 });
  assert.equal(result.status, 'approved');
  assert.equal(result.needsFollowup, false);
  assert.equal(result.followupMode, null);
  await db.close();
});

test('UC-C: review with blocking issues -> status=pending_fix, followup mode=notify', async () => {
  const db = await memDb();
  const now = Date.now();
  await startReviewRound(db, { ...ctx, headSha: 'sha1', nowMs: now });
  const result = await completeReviewRound(db, {
    ...ctx, headSha: 'sha1',
    blockingIssues: ['Missing error handling at auth.js:42'],
    nowMs: now + 1000,
  });
  assert.equal(result.status, 'pending_fix');
  assert.equal(result.needsFollowup, true);
  assert.equal(result.followupMode, 'notify');
  assert.equal(result.isMaxReached, false);
  await db.close();
});

test('UC-C: PR push with pending_fix creates next round', async () => {
  const db = await memDb();
  const now = Date.now();
  await startReviewRound(db, { ...ctx, headSha: 'sha1', nowMs: now });
  await completeReviewRound(db, { ...ctx, headSha: 'sha1', blockingIssues: ['issue'], nowMs: now + 1000 });

  const result = await handlePrPush(db, { ...ctx, newHeadSha: 'sha2', nowMs: now + 2000 });
  assert.equal(result.shouldTriggerReview, true);
  assert.equal(result.round, 2);
  await db.close();
});

test('UC-C: second review with no blocking issues -> approved', async () => {
  const db = await memDb();
  const now = Date.now();
  // Round 1: blocking
  await startReviewRound(db, { ...ctx, headSha: 'sha1', nowMs: now });
  await completeReviewRound(db, { ...ctx, headSha: 'sha1', blockingIssues: ['issue'], nowMs: now + 1000 });
  // Push
  await handlePrPush(db, { ...ctx, newHeadSha: 'sha2', nowMs: now + 2000 });
  // Round 2: no blocking
  const result = await completeReviewRound(db, { ...ctx, blockingIssues: [], nowMs: now + 3000 });
  assert.equal(result.status, 'approved');
  assert.equal(result.needsFollowup, false);
  await db.close();
});

test('UC-C: max rounds (3) with blocking -> max_reached, escalation followup', async () => {
  // Force max rounds to 2 for this test
  process.env.QZAI_MAX_REVIEW_ROUNDS = '2';
  try {
    const db = await memDb();
    const now = Date.now();
    const issues = ['Critical bug'];

    // Round 1
    await startReviewRound(db, { ...ctx, headSha: 'sha1', nowMs: now });
    await completeReviewRound(db, { ...ctx, headSha: 'sha1', blockingIssues: issues, nowMs: now + 1000 });
    await handlePrPush(db, { ...ctx, newHeadSha: 'sha2', nowMs: now + 2000 });

    // Round 2 (max)
    const result = await completeReviewRound(db, { ...ctx, blockingIssues: issues, nowMs: now + 3000 });
    assert.equal(result.status, 'max_reached');
    assert.equal(result.needsFollowup, true);
    assert.equal(result.followupMode, 'escalation');
    assert.equal(result.isMaxReached, true);
    await db.close();
  } finally {
    delete process.env.QZAI_MAX_REVIEW_ROUNDS;
  }
});

test('UC-C: push after max_reached does not trigger new round', async () => {
  process.env.QZAI_MAX_REVIEW_ROUNDS = '1';
  try {
    const db = await memDb();
    const now = Date.now();
    await startReviewRound(db, { ...ctx, headSha: 'sha1', nowMs: now });
    await completeReviewRound(db, { ...ctx, headSha: 'sha1', blockingIssues: ['issue'], nowMs: now + 1000 });

    const result = await handlePrPush(db, { ...ctx, newHeadSha: 'sha2', nowMs: now + 2000 });
    assert.equal(result.shouldTriggerReview, false);
    await db.close();
  } finally {
    delete process.env.QZAI_MAX_REVIEW_ROUNDS;
  }
});

test('getReviewStatus: returns correct status and round info', async () => {
  const db = await memDb();
  const now = Date.now();
  await startReviewRound(db, { ...ctx, headSha: 'sha1', nowMs: now });
  const status = await getReviewStatus(db, ctx);
  assert.equal(status.totalRounds, 1);
  assert.equal(status.latest.status, 'reviewing');
  assert.ok(status.maxRounds > 0);
  await db.close();
});
