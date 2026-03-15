import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

export async function openDb(dbPath) {
  const db = await open({ filename: dbPath, driver: sqlite3.Database });

  await db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA synchronous=NORMAL;

    CREATE TABLE IF NOT EXISTS nonces (
      nonce TEXT PRIMARY KEY,
      expires_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deliveries (
      delivery_id TEXT PRIMARY KEY,
      created_at_ms INTEGER NOT NULL,
      ack_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS commands (
      idempotency_key TEXT PRIMARY KEY,
      created_at_ms INTEGER NOT NULL,
      expires_at_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      trace_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      parent_run_id TEXT,
      ack_comment_id INTEGER,
      final_json TEXT
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      window_start_ms INTEGER NOT NULL,
      count INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dead_letters (
      id TEXT PRIMARY KEY,
      created_at_ms INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_rounds (
      pr_key        TEXT NOT NULL,
      round         INTEGER NOT NULL,
      head_sha      TEXT NOT NULL,
      status        TEXT NOT NULL,
      review_run_id TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (pr_key, round)
    );

    CREATE INDEX IF NOT EXISTS idx_nonces_expires ON nonces(expires_at_ms);
    CREATE INDEX IF NOT EXISTS idx_commands_expires ON commands(expires_at_ms);
    CREATE INDEX IF NOT EXISTS idx_dead_letters_created ON dead_letters(created_at_ms);
    CREATE INDEX IF NOT EXISTS idx_review_rounds_pr_key ON review_rounds(pr_key);
  `);

  // Backward-compatible migrations (best-effort)
  try { await db.exec('ALTER TABLE commands ADD COLUMN ack_comment_id INTEGER'); } catch {}

  return db;
}

export async function cleanupExpired(db, nowMs) {
  await db.run('DELETE FROM nonces WHERE expires_at_ms < ?', nowMs);
  await db.run('DELETE FROM commands WHERE expires_at_ms < ?', nowMs);
}

// Atomic nonce insert: returns true if inserted (first use), false if replay
export async function insertNonceAtomic(db, nonce, expiresAtMs) {
  const result = await db.run(
    'INSERT OR IGNORE INTO nonces(nonce, expires_at_ms) VALUES(?,?)',
    nonce,
    expiresAtMs
  );
  return result.changes === 1;
}

// Atomic delivery insert: returns true if inserted (first delivery), false if duplicate
export async function insertDeliveryAtomic(db, deliveryId, createdAtMs, ackJson) {
  const result = await db.run(
    'INSERT OR IGNORE INTO deliveries(delivery_id, created_at_ms, ack_json) VALUES(?,?,?)',
    deliveryId,
    createdAtMs,
    ackJson
  );
  return result.changes === 1;
}

// Review rounds CRUD

export async function getLatestReviewRound(db, prKey) {
  return db.get(
    'SELECT * FROM review_rounds WHERE pr_key = ? ORDER BY round DESC LIMIT 1',
    prKey
  );
}

export async function insertReviewRound(db, { prKey, round, headSha, status, reviewRunId, nowMs }) {
  await db.run(
    'INSERT INTO review_rounds(pr_key, round, head_sha, status, review_run_id, created_at_ms, updated_at_ms) VALUES(?,?,?,?,?,?,?)',
    prKey, round, headSha, status, reviewRunId ?? null, nowMs, nowMs
  );
}

export async function updateReviewRoundStatus(db, { prKey, round, status, nowMs }) {
  await db.run(
    'UPDATE review_rounds SET status = ?, updated_at_ms = ? WHERE pr_key = ? AND round = ?',
    status, nowMs, prKey, round
  );
}

export async function countReviewRounds(db, prKey) {
  const row = await db.get('SELECT COUNT(*) as cnt FROM review_rounds WHERE pr_key = ?', prKey);
  return row?.cnt ?? 0;
}
