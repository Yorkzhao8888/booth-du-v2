#!/usr/bin/env node
/**
 * [神域智场 DEV-P1-01] dimension × business_type — 回滚脚本（可逆迁移）
 *
 * 动作:
 *   1. DROP CHECK 约束 chk_stations_dimension_business
 *   2. DROP COLUMN dimension / business_type（两列为本单新增，删除即回到迁移前形态）
 *
 * 用法: NODE_PATH=/workspace/projects/node_modules node -r dotenv/config scripts/dev-p1-01-rollback.cjs
 * 幂等: 可重复执行，二次运行输出 already rolled back
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE booth_stations DROP CONSTRAINT IF EXISTS chk_stations_dimension_business;`);
    const col = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'booth_stations' AND column_name IN ('dimension','business_type')
    `);
    if (col.rowCount === 0) {
      console.log('[DEV-P1-01] rollback: already rolled back (no columns present).');
      return;
    }
    await client.query(`
      ALTER TABLE booth_stations DROP COLUMN IF EXISTS dimension;
      ALTER TABLE booth_stations DROP COLUMN IF EXISTS business_type;
    `);
    const after = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'booth_stations' AND column_name IN ('dimension','business_type')
    `);
    console.log(`[DEV-P1-01] rollback done. dropped columns; remaining=${after.rowCount}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error('[DEV-P1-01] rollback FAILED:', e.message); process.exit(1); });
