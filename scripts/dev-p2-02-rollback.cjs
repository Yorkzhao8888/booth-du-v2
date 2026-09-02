#!/usr/bin/env node
// [神域智场 DEV-P2-02] 回滚: 删除四类站位特有可选字段
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE booth_stations DROP COLUMN IF EXISTS batch;
      ALTER TABLE booth_stations DROP COLUMN IF EXISTS route;
      ALTER TABLE booth_stations DROP COLUMN IF EXISTS after_sales_type;
      ALTER TABLE booth_stations DROP COLUMN IF EXISTS lab_record;
    `);
    console.log('[p2-02-rollback] OK: 4 columns dropped');
  } catch (e) {
    console.error('[p2-02-rollback] FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
