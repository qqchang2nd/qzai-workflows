import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHmacSha256Hex } from '../src/crypto.js';
import {
  parseSigHeader,
  validateSignature,
  validateTimestamp,
  validateNonceFormat,
  consumeNonce,
  validateRequiredFields,
} from '../src/validate.js';
import { openDb } from '../src/db.js';

async function memDb() {
  return openDb(':memory:');
}

// parseSigHeader tests
test('parseSigHeader: returns null for missing header', () => {
  assert.equal(parseSigHeader(undefined), null);
  assert.equal(parseSigHeader(null), null);
  assert.equal(parseSigHeader(''), null);
});

test('parseSigHeader: returns null for wrong format', () => {
  assert.equal(parseSigHeader('sha1=abc'), null);
  assert.equal(parseSigHeader('sha256=tooshort'), null);
  assert.equal(parseSigHeader('abc'), null);
});

test('parseSigHeader: returns hex for valid sha256= header', () => {
  const h = 'a'.repeat(64);
  assert.equal(parseSigHeader(`sha256=${h}`), h);
});

// validateSignature tests
test('validateSignature: returns null for correct signature', () => {
  const sig = computeHmacSha256Hex('secret', 'body');
  const result = validateSignature('secret', 'body', sig);
  assert.equal(result, null);
});

test('validateSignature: returns SIG_INVALID for missing sig', () => {
  const result = validateSignature('secret', 'body', null);
  assert.equal(result.reasonCode, 'SIG_INVALID');
});

test('validateSignature: returns SIG_INVALID for wrong sig', () => {
  const result = validateSignature('secret', 'body', 'a'.repeat(64));
  assert.equal(result.reasonCode, 'SIG_INVALID');
});

// validateTimestamp tests
test('validateTimestamp: returns null for timestamp within ±5min', () => {
  const now = Date.now();
  assert.equal(validateTimestamp(now, now), null);
  assert.equal(validateTimestamp(now - 4 * 60 * 1000, now), null);
  assert.equal(validateTimestamp(now + 4 * 60 * 1000, now), null);
});

test('validateTimestamp: returns TIMESTAMP_EXPIRED for ts outside ±5min', () => {
  const now = Date.now();
  assert.equal(validateTimestamp(now - 6 * 60 * 1000, now)?.reasonCode, 'TIMESTAMP_EXPIRED');
  assert.equal(validateTimestamp(now + 6 * 60 * 1000, now)?.reasonCode, 'TIMESTAMP_EXPIRED');
  assert.equal(validateTimestamp(0, now)?.reasonCode, 'TIMESTAMP_EXPIRED');
  assert.equal(validateTimestamp(NaN, now)?.reasonCode, 'TIMESTAMP_EXPIRED');
});

test('validateTimestamp: boundary - exactly ±5min returns null', () => {
  const now = Date.now();
  // At exactly 5 minutes, abs diff = 300000 which is NOT > 300000, so should pass
  assert.equal(validateTimestamp(now - 5 * 60 * 1000, now), null);
  assert.equal(validateTimestamp(now + 5 * 60 * 1000, now), null);
});

// validateNonceFormat tests
test('validateNonceFormat: returns null for valid nonce (≥8 chars)', () => {
  assert.equal(validateNonceFormat('12345678'), null);
  assert.equal(validateNonceFormat('abcdefghij'), null);
});

test('validateNonceFormat: returns NONCE_REPLAY for missing nonce', () => {
  assert.equal(validateNonceFormat('')?.reasonCode, 'NONCE_REPLAY');
  assert.equal(validateNonceFormat(null)?.reasonCode, 'NONCE_REPLAY');
  assert.equal(validateNonceFormat(undefined)?.reasonCode, 'NONCE_REPLAY');
});

test('validateNonceFormat: returns NONCE_REPLAY for nonce < 8 chars', () => {
  assert.equal(validateNonceFormat('1234567')?.reasonCode, 'NONCE_REPLAY');
  assert.equal(validateNonceFormat('abc')?.reasonCode, 'NONCE_REPLAY');
});

// consumeNonce tests
test('consumeNonce: returns null on first use', async () => {
  const db = await memDb();
  const result = await consumeNonce(db, 'nonce12345', Date.now());
  assert.equal(result, null);
  await db.close();
});

test('consumeNonce: returns NONCE_REPLAY on second use', async () => {
  const db = await memDb();
  const nonce = 'nonce12345';
  await consumeNonce(db, nonce, Date.now());
  const result = await consumeNonce(db, nonce, Date.now());
  assert.equal(result?.reasonCode, 'NONCE_REPLAY');
  await db.close();
});

// validateRequiredFields tests
test('validateRequiredFields: returns null for complete payload', () => {
  const payload = {
    schemaVersion: 1, deliveryId: 'd1', command: 'review', repo: 'owner/repo',
    installationId: '123', issueNumber: 1, commentId: '456', commentUrl: 'http://x',
    headSha: 'abc', baseSha: 'def', requestedBy: 'alice', requestedAt: '2024-01-01',
    authorAssociation: 'MEMBER', idempotencyKey: 'key1',
  };
  assert.equal(validateRequiredFields(payload), null);
});

test('validateRequiredFields: returns ARGS_INVALID for missing fields', () => {
  const result = validateRequiredFields({ deliveryId: 'd1' });
  assert.equal(result?.reasonCode, 'ARGS_INVALID');
  assert.ok(result?.detail.includes('command'));
});
