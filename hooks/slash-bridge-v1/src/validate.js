/**
 * Security validation pipeline.
 * All functions are pure or take explicit db/config parameters.
 */

import { computeHmacSha256Hex, timingSafeEqualHex } from './crypto.js';
import { insertNonceAtomic } from './db.js';
import { reason } from './format.js';

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

export function parseSigHeader(h) {
  if (!h) return null;
  const m = String(h).match(/^sha256=([0-9a-f]{64})$/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Validate HMAC signature.
 * Returns null on success, or a reason object on failure.
 */
export function validateSignature(secret, rawBody, sigHex) {
  if (!sigHex) return reason('SIG_INVALID', 'missing/invalid X-Hub-Signature-256');
  const expected = computeHmacSha256Hex(secret, rawBody);
  if (!timingSafeEqualHex(sigHex, expected)) return reason('SIG_INVALID', 'signature mismatch');
  return null;
}

/**
 * Validate timestamp is within ±5 minutes.
 * Returns null on success, or a reason object on failure.
 */
export function validateTimestamp(ts, nowMs) {
  if (!Number.isFinite(ts) || Math.abs(nowMs - ts) > 5 * 60 * 1000) {
    return reason('TIMESTAMP_EXPIRED', 'timestamp outside ±5min window');
  }
  return null;
}

/**
 * Validate nonce format (must be ≥8 chars).
 * Returns null on success, or a reason object on failure.
 */
export function validateNonceFormat(nonce) {
  if (!nonce || nonce.length < 8) {
    return reason('NONCE_REPLAY', 'missing/invalid nonce');
  }
  return null;
}

/**
 * Atomically insert nonce to prevent replay.
 * Returns null on success (first use), or a reason object if already used.
 */
export async function consumeNonce(db, nonce, nowMs) {
  const inserted = await insertNonceAtomic(db, nonce, nowMs + 10 * 60 * 1000);
  if (!inserted) return reason('NONCE_REPLAY', 'nonce already used');
  return null;
}

/**
 * Validate required fields are present and non-empty.
 * Returns null on success, or a reason object listing missing fields.
 */
export function validateRequiredFields(payload) {
  const required = [
    'schemaVersion',
    'deliveryId',
    'command',
    'repo',
    'installationId',
    'issueNumber',
    'commentId',
    'commentUrl',
    'headSha',
    'baseSha',
    'requestedBy',
    'requestedAt',
    'authorAssociation',
    'idempotencyKey',
  ];
  const missing = required.filter((k) => payload[k] === undefined || payload[k] === null || payload[k] === '');
  if (missing.length) {
    return reason('ARGS_INVALID', `missing required fields: ${missing.join(', ')}`);
  }
  return null;
}

export { MAX_BODY_BYTES };
