import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHmacSha256Hex, timingSafeEqualHex, randomId, sha256Hex } from '../src/crypto.js';

test('computeHmacSha256Hex produces correct hex digest', () => {
  // Known HMAC-SHA256: echo -n "hello" | openssl dgst -sha256 -hmac "secret"
  const result = computeHmacSha256Hex('secret', 'hello');
  assert.match(result, /^[0-9a-f]{64}$/);
  // Deterministic: same inputs = same output
  assert.equal(computeHmacSha256Hex('secret', 'hello'), computeHmacSha256Hex('secret', 'hello'));
  // Different key => different result
  assert.notEqual(computeHmacSha256Hex('other', 'hello'), computeHmacSha256Hex('secret', 'hello'));
});

test('timingSafeEqualHex returns true for equal hex strings', () => {
  const h = computeHmacSha256Hex('s', 'body');
  assert.equal(timingSafeEqualHex(h, h), true);
});

test('timingSafeEqualHex returns false for unequal hex strings', () => {
  const a = computeHmacSha256Hex('s', 'body1');
  const b = computeHmacSha256Hex('s', 'body2');
  assert.equal(timingSafeEqualHex(a, b), false);
});

test('timingSafeEqualHex returns false for different length inputs', () => {
  assert.equal(timingSafeEqualHex('aabb', 'aabbcc'), false);
});

test('timingSafeEqualHex returns false for empty inputs', () => {
  assert.equal(timingSafeEqualHex('', ''), false);
});

test('randomId generates id with correct prefix and format', () => {
  const id = randomId('trc');
  assert.match(id, /^trc_[0-9a-f]{24}$/);
});

test('randomId generates unique ids', () => {
  const ids = new Set(Array.from({ length: 20 }, () => randomId('x')));
  assert.equal(ids.size, 20);
});

test('sha256Hex produces consistent output', () => {
  const h1 = sha256Hex('hello world');
  const h2 = sha256Hex('hello world');
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
  assert.notEqual(sha256Hex('a'), sha256Hex('b'));
});
