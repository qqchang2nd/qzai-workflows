import fs from 'node:fs';
import { openDb } from '../src/db.js';

const dbPath = process.env.SLASH_BRIDGE_DB_PATH || './slash-bridge-v1.sqlite';

const db = await openDb(dbPath);

const deadId = 'dead_test_' + Date.now();
await db.run(
  'INSERT INTO dead_letters(id, created_at_ms, kind, payload_json) VALUES(?,?,?,?)',
  deadId,
  Date.now(),
  'selftest',
  JSON.stringify({ ok: true })
);

const row = await db.get('SELECT id, kind, payload_json FROM dead_letters WHERE id=?', deadId);
if (!row) {
  console.error('dead_letters selftest FAILED: row missing');
  process.exit(2);
}
console.log('dead_letters selftest OK:', row.id, row.kind);
