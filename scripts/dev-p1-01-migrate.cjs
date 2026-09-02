#!/usr/bin/env node
/**
 * [神域智场 DEV-P1-01] dimension × business_type — 独立迁移脚本（幂等）
 *
 * 枚举:
 *   dimension     = point(智场点位) / workstation(作业位) / case_station(专案工位)
 *   business_type = shop / booth / lab / plaz / case
 * 约束映射:
 *   workstation <-> shop/booth/lab ; point <-> plaz ; case_station <-> case
 *
 * 用法: NODE_PATH=/workspace/projects/node_modules node -r dotenv/config scripts/dev-p1-01-migrate.cjs
 * 回滚: scripts/dev-p1-01-rollback.cjs
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const client = await pool.connect();
  try {
    // 1. 加列（幂等）
    await client.query(`
      ALTER TABLE booth_stations ADD COLUMN IF NOT EXISTS dimension TEXT DEFAULT 'workstation';
      ALTER TABLE booth_stations ADD COLUMN IF NOT EXISTS business_type TEXT DEFAULT 'shop';
    `);
    // 2. 历史回填（仅补 NULL，不覆盖已显式设置的值）
    await client.query(`
      UPDATE booth_stations SET dimension = 'workstation' WHERE dimension IS NULL;
      UPDATE booth_stations SET business_type = 'shop'
        WHERE business_type IS NULL AND (code ILIKE '%.FAB.%' OR type = 'FAB' OR zone_type ILIKE 'fab%');
      UPDATE booth_stations SET business_type = 'booth'
        WHERE business_type IS NULL AND (code ILIKE '%.WH.%' OR code ILIKE '%.SVC.%' OR code ILIKE '%.DL.%'
          OR type IN ('WH','SVC','DL') OR zone_type IN ('WH','SVC','DL'));
      UPDATE booth_stations SET business_type = 'shop' WHERE business_type IS NULL;
    `);
    // 3. CHECK 约束（先删后建保证幂等）
    await client.query(`ALTER TABLE booth_stations DROP CONSTRAINT IF EXISTS chk_stations_dimension_business;`);
    await client.query(`
      ALTER TABLE booth_stations ADD CONSTRAINT chk_stations_dimension_business CHECK (
        (dimension = 'workstation' AND business_type IN ('shop','booth','lab'))
     OR (dimension = 'point' AND business_type = 'plaz')
     OR (dimension = 'case_station' AND business_type = 'case')
      );
    `);
    // 4. 巡检输出
    const { rows } = await client.query(
      `SELECT id, code, dimension, business_type FROM booth_stations ORDER BY id`
    );
    console.log('[DEV-P1-01] migrate done. stations:');
    for (const r of rows) console.log(`  id=${r.id} ${r.code} dim=${r.dimension} biz=${r.business_type}`);
    const ok = await client.query(`SELECT conname FROM pg_constraint WHERE conname = 'chk_stations_dimension_business'`);
    console.log(`[DEV-P1-01] constraint present: ${ok.rowCount === 1}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error('[DEV-P1-01] migrate FAILED:', e.message); process.exit(1); });
