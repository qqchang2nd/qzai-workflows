import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanTask } from '../src/task/plan.js';
import { buildReviewTask } from '../src/task/review.js';
import { buildImplementTask } from '../src/task/implement.js';
import { buildSecurityTask } from '../src/task/security.js';
import { buildFollowupTask } from '../src/task/followup.js';

test('buildPlanTask: returns correct structure with issue context', () => {
  const task = buildPlanTask({
    owner: 'acme', repo: 'app', issueNumber: 42,
    issueBody: 'Feature: add dark mode', requestedBy: 'alice',
  });
  assert.equal(task.type, 'plan');
  assert.equal(task.context.repo, 'acme/app');
  assert.equal(task.context.issueNumber, 42);
  assert.equal(task.context.issueBody, 'Feature: add dark mode');
  assert.ok(task.instructions.includes('#42'));
  assert.ok(task.instructions.includes('PLAN.md'));
  assert.ok(task.instructions.includes('Goals'));
  assert.ok(task.instructions.includes('DoD'));
  assert.ok(task.writeback.type === 'update-comment');
});

test('buildReviewTask: round=1 sets isIncremental=false', () => {
  const task = buildReviewTask({
    owner: 'acme', repo: 'app', prNumber: 10,
    headSha: 'abc123', baseSha: 'def456', round: 1, requestedBy: 'alice',
  });
  assert.equal(task.type, 'code-review');
  assert.equal(task.context.round, 1);
  assert.equal(task.context.isIncremental, false);
  assert.ok(task.instructions.includes('完整 diff'));
  assert.ok(!task.instructions.includes('新增部分'));
});

test('buildReviewTask: round=2 sets isIncremental=true', () => {
  const task = buildReviewTask({
    owner: 'acme', repo: 'app', prNumber: 10,
    headSha: 'new123', baseSha: 'old456', round: 2, requestedBy: 'alice',
  });
  assert.equal(task.context.round, 2);
  assert.equal(task.context.isIncremental, true);
  assert.ok(task.instructions.includes('新增部分') || task.instructions.includes('2 轮'));
});

test('buildImplementTask: includes plan file path in context', () => {
  const task = buildImplementTask({
    owner: 'acme', repo: 'app', issueNumber: 5,
    planPrNumber: 3, planFilePath: '.qzai/plans/issue-5/PLAN.md',
    requestedBy: 'bob',
  });
  assert.equal(task.type, 'implement');
  assert.ok(task.instructions.includes('.qzai/plans/issue-5/PLAN.md'));
  assert.ok(task.instructions.includes('Closes #5'));
  assert.ok(task.instructions.includes('DoD'));
});

test('buildImplementTask: uses default plan path when not provided', () => {
  const task = buildImplementTask({
    owner: 'acme', repo: 'app', issueNumber: 7,
    requestedBy: 'bob',
  });
  assert.ok(task.context.planFilePath.includes('issue-7'));
});

test('buildSecurityTask: includes OWASP reference and output format', () => {
  const task = buildSecurityTask({
    owner: 'acme', repo: 'app', prNumber: 10,
    headSha: 'abc', baseSha: 'def', requestedBy: 'carol',
  });
  assert.equal(task.type, 'security-review');
  assert.ok(task.instructions.includes('OWASP'));
  assert.ok(task.instructions.includes('critical|high|medium|low'));
  assert.ok(task.instructions.includes('Secrets'));
});

test('buildFollowupTask: notify mode includes blocking issues and @prAuthor', () => {
  const task = buildFollowupTask({
    owner: 'acme', repo: 'app', prNumber: 10, prAuthor: 'alice',
    mode: 'notify', round: 1,
    blockingIssues: ['Missing error handling in auth.js:42', 'SQL injection risk in db.js:10'],
    requestedBy: 'bot',
  });
  assert.equal(task.type, 'followup-notify');
  assert.ok(task.instructions.includes('@alice'));
  assert.ok(task.instructions.includes('Missing error handling'));
  assert.ok(task.instructions.includes('SQL injection'));
  assert.ok(task.instructions.includes('round 2') || task.instructions.includes('第 2 轮'));
});

test('buildFollowupTask: escalation mode includes all unresolved issues and reviewers', () => {
  const task = buildFollowupTask({
    owner: 'acme', repo: 'app', prNumber: 10, prAuthor: 'alice',
    originalReviewer: 'reviewer1',
    mode: 'escalation', maxRounds: 3,
    allUnresolvedIssues: ['Issue A', 'Issue B'],
    requestedBy: 'bot',
  });
  assert.equal(task.type, 'followup-escalation');
  assert.ok(task.instructions.includes('@alice'));
  assert.ok(task.instructions.includes('@reviewer1'));
  assert.ok(task.instructions.includes('Issue A'));
  assert.ok(task.instructions.includes('Issue B'));
  assert.ok(task.instructions.includes('3 轮') || task.instructions.includes('MAX_ROUNDS'));
  assert.ok(task.writeback.checkRun?.conclusion === 'failure');
});

test('buildFollowupTask: notify and escalation modes have different types', () => {
  const notify = buildFollowupTask({ mode: 'notify', owner: 'a', repo: 'b', prNumber: 1, prAuthor: 'x', blockingIssues: ['x'] });
  const escalation = buildFollowupTask({ mode: 'escalation', owner: 'a', repo: 'b', prNumber: 1, prAuthor: 'x', allUnresolvedIssues: [], maxRounds: 3 });
  assert.notEqual(notify.type, escalation.type);
});
