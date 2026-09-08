// [SHOP-CONT-BOOTH] 预订日配契约迁移 (幂等): 生产单号列 + 波次透传列
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await pool.query("ALTER TABLE booth_work_orders ADD COLUMN IF NOT EXISTS work_order_no TEXT;");
  console.log('[shop-cont-migrate] booth_work_orders.work_order_no ready.');
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_work_orders_work_order_no ON booth_work_orders (work_order_no) WHERE work_order_no IS NOT NULL;");
  console.log('[shop-cont-migrate] idx_work_orders_work_order_no (partial unique) ready.');
  await pool.query("ALTER TABLE booth_fulfillments ADD COLUMN IF NOT EXISTS wave_no TEXT;");
  console.log('[shop-cont-migrate] booth_fulfillments.wave_no ready.');
  await pool.end();
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
