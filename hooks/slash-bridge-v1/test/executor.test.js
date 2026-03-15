import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTask, createDispatcher } from '../src/executor.js';

// --- buildTask tests ---

test('buildTask: plan command returns plan task structure', () => {
  const payload = { owner: 'acme', repo: 'app', issueNumber: 42, issueBody: 'Feature desc', requestedBy: 'alice' };
  const task = buildTask('plan', payload);
  assert.equal(task.type, 'plan');
  assert.equal(task.context.issueNumber, 42);
  assert.ok(task.instructions.includes('PLAN.md'));
});

test('buildTask: plan-pr alias returns same as plan', () => {
  const payload = { owner: 'acme', repo: 'app', issueNumber: 42, issueBody: 'desc', requestedBy: 'alice' };
  const taskPlan = buildTask('plan', payload);
  const taskAlias = buildTask('plan-pr', payload);
  assert.equal(taskPlan.type, taskAlias.type);
});

test('buildTask: implement command returns implement task structure', () => {
  const payload = {
    owner: 'acme', repo: 'app', issueNumber: 5,
    planPrNumber: 3, planFilePath: '.qzai/plans/issue-5/PLAN.md',
    requestedBy: 'bob',
  };
  const task = buildTask('implement', payload);
  assert.equal(task.type, 'implement');
  assert.ok(task.instructions.includes('PLAN.md'));
  assert.ok(task.instructions.includes('Closes #5'));
});

test('buildTask: impl-pr alias returns same as implement', () => {
  const payload = { owner: 'acme', repo: 'app', issueNumber: 5, requestedBy: 'bob' };
  const a = buildTask('implement', payload);
  const b = buildTask('impl-pr', payload);
  assert.equal(a.type, b.type);
});

test('buildTask: review command returns code-review task structure', () => {
  const payload = {
    owner: 'acme', repo: 'app', prNumber: 10,
    headSha: 'abc', baseSha: 'def', round: 1, requestedBy: 'alice',
  };
  const task = buildTask('review', payload);
  assert.equal(task.type, 'code-review');
  assert.equal(task.context.round, 1);
  assert.equal(task.context.isIncremental, false);
});

test('buildTask: review round=2 sets isIncremental=true', () => {
  const payload = {
    owner: 'acme', repo: 'app', prNumber: 10,
    headSha: 'abc', baseSha: 'def', round: 2, requestedBy: 'alice',
  };
  const task = buildTask('review', payload);
  assert.equal(task.context.isIncremental, true);
});

test('buildTask: security command returns security-review task structure', () => {
  const payload = {
    owner: 'acme', repo: 'app', prNumber: 10,
    headSha: 'abc', baseSha: 'def', requestedBy: 'carol',
  };
  const task = buildTask('security', payload);
  assert.equal(task.type, 'security-review');
  assert.ok(task.instructions.includes('OWASP'));
});

test('buildTask: followup command returns followup task', () => {
  const payload = {
    owner: 'acme', repo: 'app', prNumber: 10,
    prAuthor: 'alice', requestedBy: 'bot',
    followupMode: 'notify', round: 1,
    blockingIssues: ['issue A'],
  };
  const task = buildTask('followup', payload);
  assert.ok(task.type.startsWith('followup'));
  assert.ok(task.instructions.includes('@alice'));
});

test('buildTask: pr-desc command returns implement-like task', () => {
  const payload = {
    owner: 'acme', repo: 'app', prNumber: 10, issueNumber: 5,
    planPrNumber: 3, planFilePath: '.qzai/plans/issue-5/PLAN.md',
    requestedBy: 'bob',
  };
  const task = buildTask('pr-desc', payload);
  assert.equal(task.type, 'implement');
});

test('buildTask: unknown command throws', () => {
  assert.throws(
    () => buildTask('unknown-command', {}),
    /Unknown command/,
  );
});

test('buildTask: uses prNumber OR issueNumber as num', () => {
  const withPr = buildTask('review', {
    owner: 'a', repo: 'b', prNumber: 7, issueNumber: 3,
    headSha: 'x', baseSha: 'y', round: 1, requestedBy: 'u',
  });
  assert.equal(withPr.context.prNumber, 7);

  const withIssue = buildTask('review', {
    owner: 'a', repo: 'b', prNumber: undefined, issueNumber: 3,
    headSha: 'x', baseSha: 'y', round: 1, requestedBy: 'u',
  });
  assert.equal(withIssue.context.prNumber, 3);
});

// --- createDispatcher tests ---

test('createDispatcher: calls a2aDispatch with agentId and task', async () => {
  const calls = [];
  const mockA2a = async (agentId, task) => {
    calls.push({ agentId, task });
    return { verdict: 'success', summary: 'ok', evidenceLinks: [] };
  };

  const dispatch = createDispatcher({ a2aDispatch: mockA2a });
  const payload = {
    owner: 'acme', repo: 'app', issueNumber: 1,
    issueBody: 'body', requestedBy: 'alice',
  };

  const result = await dispatch('plan', 'lixunhuan', payload);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].agentId, 'lixunhuan');
  assert.equal(calls[0].task.type, 'plan');
  assert.equal(result.verdict, 'success');
});

test('createDispatcher: propagates a2aDispatch errors', async () => {
  const failA2a = async () => { throw new Error('A2A connection refused'); };
  const dispatch = createDispatcher({ a2aDispatch: failA2a });

  await assert.rejects(
    () => dispatch('review', 'lixunhuan', {
      owner: 'a', repo: 'b', prNumber: 1,
      headSha: 'x', baseSha: 'y', round: 1, requestedBy: 'u',
    }),
    /A2A connection refused/,
  );
});

test('createDispatcher: passes full payload to task builder', async () => {
  let capturedTask = null;
  const mockA2a = async (_agentId, task) => {
    capturedTask = task;
    return { verdict: 'success', summary: 'ok', evidenceLinks: [] };
  };

  const dispatch = createDispatcher({ a2aDispatch: mockA2a });
  await dispatch('security', 'jingwuming', {
    owner: 'sec', repo: 'audit', prNumber: 99,
    headSha: 'h1', baseSha: 'b1', requestedBy: 'carol',
  });

  assert.equal(capturedTask.type, 'security-review');
  assert.equal(capturedTask.context.prNumber, 99);
});
