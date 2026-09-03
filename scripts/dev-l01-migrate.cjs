#!/usr/bin/env node
// [四大APP打通 BOOTH-LINK-01] 迁移 (可逆, 幂等)
// 任务A: booth_fulfillments 即 supply-orders 契约载体, shop_order_id 唯一索引兜底幂等
// 任务C: mate_dispatch_status 派单状态标记 (pending/dispatched/failed)
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query('SELECT id, org_id, shop_order_id, contract_status FROM booth_fulfillments ORDER BY id DESC LIMIT 50');
    require('fs').writeFileSync(
      require('path').join(__dirname, 'dev-l01-prebackup.json'),
      JSON.stringify({ ts: new Date().toISOString(), rows: before.rows }, null, 2)
    );
    // 存量重复检查(唯一索引前置)
    const dup = await client.query(
      `SELECT org_id, shop_order_id, count(*)::int n FROM booth_fulfillments
       WHERE shop_order_id IS NOT NULL GROUP BY org_id, shop_order_id HAVING count(*) > 1`
    );
    if (dup.rows.length > 0) {
      throw new Error(`duplicate (org_id, shop_order_id) exists, cannot create unique index: ${JSON.stringify(dup.rows)}`);
    }
    await client.query(`
      ALTER TABLE booth_fulfillments ADD COLUMN IF NOT EXISTS mate_dispatch_status TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_fulfillments_org_shop_order
        ON booth_fulfillments (org_id, shop_order_id)
        WHERE shop_order_id IS NOT NULL;
    `);
    await client.query('COMMIT');
    const chk = await client.query(`SELECT indexname FROM pg_indexes WHERE tablename='booth_fulfillments' AND indexname='idx_fulfillments_org_shop_order'`);
    console.log('[l01-migrate] OK, unique index:', chk.rows.length === 1 ? 'present' : 'MISSING');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[l01-migrate] FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
