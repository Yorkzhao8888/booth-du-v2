#!/usr/bin/env node
// [神域智场 DEV-P2-03] 回滚: 移除预留挂载位字段 (幂等)
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const d = await pool.query(`
    ALTER TABLE booth_stations DROP COLUMN IF EXISTS plaz_id;
    ALTER TABLE booth_stations DROP COLUMN IF EXISTS case_id;
    ALTER TABLE booth_stations DROP COLUMN IF EXISTS lab;
  `);
  const cols = await pool.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'booth_stations' AND column_name IN ('plaz_id','case_id','lab')
  `);
  console.log(cols.rowCount === 0 ? '[rollback] DEV-P2-03 mount fields removed (already rolled back).' : `[X] residual: ${cols.rowCount}`);
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
