#!/usr/bin/env node
// [神域智场 DEV-P2-02] 四类站位特有可选字段迁移 (可逆, 幂等)
// WH 仓储站: batch | DL 配送站: route,batch | SVC 服务站: after_sales_type | LAB 研发站: lab_record
// 依据 09-02 裁定: 可选字段进 Station 实体, 不新增独立实体
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
    // 迁移前备份(无条件先行)
    const before = await client.query('SELECT * FROM booth_stations ORDER BY id');
    require('fs').writeFileSync(
      require('path').join(__dirname, 'dev-p2-02-prebackup.json'),
      JSON.stringify({ ts: new Date().toISOString(), rows: before.rows }, null, 2)
    );
    await client.query(`
      ALTER TABLE booth_stations ADD COLUMN IF NOT EXISTS batch TEXT;
      ALTER TABLE booth_stations ADD COLUMN IF NOT EXISTS route TEXT;
      ALTER TABLE booth_stations ADD COLUMN IF NOT EXISTS after_sales_type TEXT;
      ALTER TABLE booth_stations ADD COLUMN IF NOT EXISTS lab_record TEXT;
    `);
    await client.query('COMMIT');
    const after = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='booth_stations' AND column_name IN ('batch','route','after_sales_type','lab_record') ORDER BY column_name`);
    console.log('[p2-02-migrate] OK, new columns:', after.rows.map((r) => r.column_name).join(', '));
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[p2-02-migrate] FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
})();
