#!/usr/bin/env node
// [四大APP打通 BOOTH-LINK-01] 回滚: 删除派单状态列与唯一索引
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
      DROP INDEX IF EXISTS idx_fulfillments_org_shop_order;
      ALTER TABLE booth_fulfillments DROP COLUMN IF EXISTS mate_dispatch_status;
    `);
    console.log('[l01-rollback] OK: index + column dropped');
  } catch (e) {
    console.error('[l01-rollback] FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
