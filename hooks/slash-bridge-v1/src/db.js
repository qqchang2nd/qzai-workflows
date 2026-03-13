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
      final_json TEXT
    );

    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      window_start_ms INTEGER NOT NULL,
      count INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS dead_letters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT,
      trace_id TEXT,
      stage TEXT,
      error TEXT,
      created_at_ms INTEGER NOT NULL
    );


    CREATE INDEX IF NOT EXISTS idx_nonces_expires ON nonces(expires_at_ms);
    CREATE INDEX IF NOT EXISTS idx_commands_expires ON commands(expires_at_ms);
    CREATE INDEX IF NOT EXISTS idx_dead_letters_created ON dead_letters(created_at_ms);
  `);

  return db;
}

export async function cleanupExpired(db, nowMs) {
  await db.run('DELETE FROM nonces WHERE expires_at_ms < ?', nowMs);
  await db.run('DELETE FROM commands WHERE expires_at_ms < ?', nowMs);
}
