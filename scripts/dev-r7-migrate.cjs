// [BOOTH-R7-DEF-3] DLQ 表迁移 (幂等)
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await pool.query(`CREATE TABLE IF NOT EXISTS booth_event_dlq (
    id SERIAL PRIMARY KEY, event_id TEXT NOT NULL, event_type TEXT, reason TEXT,
    payload JSONB, headers JSONB, received_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
    CREATE INDEX IF NOT EXISTS idx_event_dlq_event_id ON booth_event_dlq (event_id);`);
  console.log('[r7-migrate] booth_event_dlq ready.');
  await pool.query("ALTER TABLE booth_outbox ADD COLUMN IF NOT EXISTS last_error TEXT;");
  console.log('[r7-migrate] booth_outbox.last_error ready.');
  await pool.end();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
