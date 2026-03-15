import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultRoute, isAgentAllowed, resolveAgent } from '../src/router.js';

test('defaultRoute: plan -> lixunhuan', () => {
  assert.equal(defaultRoute('plan'), 'lixunhuan');
});

test('defaultRoute: plan-pr -> lixunhuan (backward compat)', () => {
  assert.equal(defaultRoute('plan-pr'), 'lixunhuan');
});

test('defaultRoute: implement -> lengyan', () => {
  assert.equal(defaultRoute('implement'), 'lengyan');
});

test('defaultRoute: impl-pr -> lengyan (backward compat)', () => {
  assert.equal(defaultRoute('impl-pr'), 'lengyan');
});

test('defaultRoute: review -> lixunhuan', () => {
  assert.equal(defaultRoute('review'), 'lixunhuan');
});

test('defaultRoute: followup -> lengyan', () => {
  assert.equal(defaultRoute('followup'), 'lengyan');
});

test('defaultRoute: security -> jingwuming', () => {
  assert.equal(defaultRoute('security'), 'jingwuming');
});

test('defaultRoute: unknown command -> null', () => {
  assert.equal(defaultRoute('ship'), null);
  assert.equal(defaultRoute(''), null);
  assert.equal(defaultRoute('hack'), null);
});

test('isAgentAllowed: known agents are allowed', () => {
  for (const agent of ['main', 'luxiaofeng', 'afei', 'jingwuming', 'lengyan', 'lixunhuan', 'aji']) {
    assert.equal(isAgentAllowed(agent), true, `${agent} should be allowed`);
  }
});

test('isAgentAllowed: unknown agents are not allowed', () => {
  assert.equal(isAgentAllowed('hacker'), false);
  assert.equal(isAgentAllowed(''), false);
  assert.equal(isAgentAllowed(null), false);
});

test('resolveAgent: no override uses default route', () => {
  const { agentId, error } = resolveAgent('review', null);
  assert.equal(agentId, 'lixunhuan');
  assert.equal(error, null);
});

test('resolveAgent: allowed override is applied', () => {
  const { agentId, error } = resolveAgent('review', 'jingwuming');
  assert.equal(agentId, 'jingwuming');
  assert.equal(error, null);
});

test('resolveAgent: disallowed override returns AGENT_NOT_ALLOWED', () => {
  const { agentId, error } = resolveAgent('review', 'hacker');
  assert.equal(agentId, null);
  assert.equal(error, 'AGENT_NOT_ALLOWED');
});

test('resolveAgent: unknown command returns ROUTE_NOT_FOUND', () => {
  const { agentId, error } = resolveAgent('unknown', null);
  assert.equal(agentId, null);
  assert.equal(error, 'ROUTE_NOT_FOUND');
});
