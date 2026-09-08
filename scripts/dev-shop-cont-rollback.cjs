// [SHOP-CONT-BOOTH] 回滚脚本: 生产单号列 + 波次列 (可逆)
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await pool.query("DROP INDEX IF EXISTS idx_work_orders_work_order_no;");
  await pool.query("ALTER TABLE booth_work_orders DROP COLUMN IF EXISTS work_order_no;");
  await pool.query("ALTER TABLE booth_fulfillments DROP COLUMN IF EXISTS wave_no;");
  console.log('[shop-cont-rollback] columns dropped.');
  await pool.end();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
