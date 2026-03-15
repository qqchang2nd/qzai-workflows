import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatAck, formatFinal, reason } from '../src/format.js';

test('reason() returns correct shape', () => {
  const r = reason('SIG_INVALID', 'bad sig');
  assert.deepEqual(r, { reasonCode: 'SIG_INVALID', detail: 'bad sig' });
});

test('formatAck with accepted=true includes all fields', () => {
  const ack = {
    accepted: true,
    traceId: 'trc_abc',
    runId: 'run_def',
    agentId: 'afei',
    nextAction: 'waiting',
  };
  const payload = { deliveryId: 'del1', idempotencyKey: 'idem1' };
  const result = formatAck(ack, payload);
  assert.ok(result.includes('ACK'));
  assert.ok(result.includes('accepted: true'));
  assert.ok(result.includes('trc_abc'));
  assert.ok(result.includes('run_def'));
  assert.ok(result.includes('del1'));
  assert.ok(result.includes('idem1'));
  assert.ok(result.includes('afei'));
  assert.ok(result.includes('waiting'));
});

test('formatAck with accepted=false includes reasonCode', () => {
  const ack = {
    accepted: false,
    traceId: 'trc_1',
    runId: 'run_1',
    reasonCode: 'SIG_INVALID',
    detail: 'signature mismatch',
  };
  const result = formatAck(ack, {});
  assert.ok(result.includes('accepted: false'));
  assert.ok(result.includes('SIG_INVALID'));
  assert.ok(result.includes('signature mismatch'));
});

test('formatAck output does not contain literal backslash-n', () => {
  const ack = { accepted: true, traceId: 't', runId: 'r' };
  const result = formatAck(ack, {});
  assert.ok(!result.includes('\\n'), 'should not contain literal \\n');
});

test('formatFinal with success verdict includes all fields', () => {
  const final = {
    verdict: 'success',
    traceId: 'trc_x',
    runId: 'run_x',
    summary: 'all good',
    nextAction: 'merge it',
  };
  const result = formatFinal(final, { deliveryId: 'del2', idempotencyKey: 'idem2' });
  assert.ok(result.includes('Final'));
  assert.ok(result.includes('verdict: `success`'));
  assert.ok(result.includes('all good'));
  assert.ok(result.includes('merge it'));
  assert.ok(result.includes('del2'));
});

test('formatFinal with failed verdict includes errorCode', () => {
  const final = {
    verdict: 'failed',
    traceId: 't',
    runId: 'r',
    errorCode: 'WRITEBACK_FAILED',
    reasonCode: 'RETRIES_EXHAUSTED',
    summary: 'failed after 3 retries',
  };
  const result = formatFinal(final, {});
  assert.ok(result.includes('verdict: `failed`'));
  assert.ok(result.includes('WRITEBACK_FAILED'));
  assert.ok(result.includes('RETRIES_EXHAUSTED'));
});

test('formatFinal output does not contain literal backslash-n', () => {
  const final = { verdict: 'success', traceId: 't', runId: 'r' };
  const result = formatFinal(final, {});
  assert.ok(!result.includes('\\n'), 'should not contain literal \\n');
});

test('formatAck omits null/undefined optional fields', () => {
  const ack = { accepted: true, traceId: 't', runId: 'r' };
  const result = formatAck(ack, {});
  assert.ok(!result.includes('agentId'));
  assert.ok(!result.includes('reasonCode'));
  assert.ok(!result.includes('nextAction'));
});
