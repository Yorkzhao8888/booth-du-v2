// [BOOTH-R7-DEF-3] 回滚 DLQ 表
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await pool.query(`DROP TABLE IF EXISTS booth_event_dlq;`);
  console.log('[r7-rollback] booth_event_dlq dropped.');
  await pool.end();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
