/**
 * Review Loop state machine.
 * Manages multi-round code review state in SQLite.
 *
 * States: reviewing → pending_fix → reviewing (loop) → approved | max_reached
 */

import {
  getLatestReviewRound,
  insertReviewRound,
  updateReviewRoundStatus,
  countReviewRounds,
} from './db.js';

const DEFAULT_MAX_ROUNDS = 3;

function getMaxRounds() {
  return Number(process.env.QZAI_MAX_REVIEW_ROUNDS || DEFAULT_MAX_ROUNDS);
}

function prKey(owner, repo, prNumber) {
  return `${owner}/${repo}#${prNumber}`;
}

/**
 * Initialize or resume a review round for a PR.
 * Returns { round, status, isNew, alreadyReviewing } describing the current state.
 *
 * - First call: creates round=1, status=reviewing
 * - Subsequent calls after pending_fix: creates round=N, status=reviewing
 * - If current round is already 'reviewing' with same headSha: idempotent (no-op)
 * - If max_reached: does not create new round
 */
export async function startReviewRound(db, { owner, repo, prNumber, headSha, reviewRunId, nowMs }) {
  const key = prKey(owner, repo, prNumber);
  const latest = await getLatestReviewRound(db, key);

  // Idempotent: same headSha already in reviewing
  if (latest && latest.status === 'reviewing' && latest.head_sha === headSha) {
    return { round: latest.round, status: 'reviewing', isNew: false, alreadyReviewing: true };
  }

  // Max reached: do not start new round
  if (latest && latest.status === 'max_reached') {
    return { round: latest.round, status: 'max_reached', isNew: false, alreadyReviewing: false };
  }

  // Create new round
  const round = latest ? latest.round + 1 : 1;
  await insertReviewRound(db, { prKey: key, round, headSha, status: 'reviewing', reviewRunId, nowMs });
  return { round, status: 'reviewing', isNew: true, alreadyReviewing: false };
}

/**
 * Complete a review round with its result.
 * @param {object} opts
 * @param {string[]} opts.blockingIssues - List of blocking issue descriptions
 * @returns {{ status, needsFollowup, followupMode, round, isMaxReached }}
 */
export async function completeReviewRound(db, { owner, repo, prNumber, headSha, blockingIssues = [], nowMs }) {
  const key = prKey(owner, repo, prNumber);
  const latest = await getLatestReviewRound(db, key);

  if (!latest || latest.status !== 'reviewing') {
    throw new Error(`No active reviewing round for ${key}`);
  }

  const maxRounds = getMaxRounds();
  const hasBlocking = blockingIssues.length > 0;

  if (!hasBlocking) {
    // Approved
    await updateReviewRoundStatus(db, { prKey: key, round: latest.round, status: 'approved', nowMs });
    return {
      status: 'approved',
      round: latest.round,
      needsFollowup: false,
      followupMode: null,
      isMaxReached: false,
    };
  }

  // Has blocking issues
  if (latest.round >= maxRounds) {
    // Max rounds reached
    await updateReviewRoundStatus(db, { prKey: key, round: latest.round, status: 'max_reached', nowMs });
    return {
      status: 'max_reached',
      round: latest.round,
      needsFollowup: true,
      followupMode: 'escalation',
      isMaxReached: true,
    };
  }

  // Pending fix: author needs to push
  await updateReviewRoundStatus(db, { prKey: key, round: latest.round, status: 'pending_fix', nowMs });
  return {
    status: 'pending_fix',
    round: latest.round,
    needsFollowup: true,
    followupMode: 'notify',
    isMaxReached: false,
  };
}

/**
 * Handle a PR push (synchronize event).
 * If latest round is pending_fix, trigger next review round.
 * Returns { shouldTriggerReview, round } or null if no action needed.
 */
export async function handlePrPush(db, { owner, repo, prNumber, newHeadSha, nowMs }) {
  const key = prKey(owner, repo, prNumber);
  const latest = await getLatestReviewRound(db, key);

  if (!latest || latest.status !== 'pending_fix') {
    return { shouldTriggerReview: false, round: latest?.round ?? 0 };
  }

  // Create next round
  const nextRound = latest.round + 1;
  await insertReviewRound(db, {
    prKey: key,
    round: nextRound,
    headSha: newHeadSha,
    status: 'reviewing',
    reviewRunId: null,
    nowMs,
  });

  return { shouldTriggerReview: true, round: nextRound };
}

/**
 * Get current review status for a PR.
 */
export async function getReviewStatus(db, { owner, repo, prNumber }) {
  const key = prKey(owner, repo, prNumber);
  const latest = await getLatestReviewRound(db, key);
  const total = await countReviewRounds(db, key);
  return { latest, totalRounds: total, maxRounds: getMaxRounds() };
}
