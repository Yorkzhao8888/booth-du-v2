#!/usr/bin/env node
// [神域智场 DEV-P2-03] Booth 预留挂载位迁移 (可逆/幂等)
// plaz_id -> X-Plaz 智场点位; case_id -> X-Case 神案SYS 专案工位; lab -> X-Lab 研发作业位
// 字段预埋: TEXT NULL (默认 NULL), 挂接业务逻辑在 M3/M4 落地
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  await pool.query(`
    ALTER TABLE booth_stations ADD COLUMN IF NOT EXISTS plaz_id TEXT;
    ALTER TABLE booth_stations ADD COLUMN IF NOT EXISTS case_id TEXT;
    ALTER TABLE booth_stations ADD COLUMN IF NOT EXISTS lab TEXT;
  `);
  const cols = await pool.query(`
    SELECT column_name, data_type, column_default
    FROM information_schema.columns
    WHERE table_name = 'booth_stations' AND column_name IN ('plaz_id','case_id','lab')
    ORDER BY column_name;
  `);
  console.log('[DEV-P2-03] mount fields:', JSON.stringify(cols.rows));
  const stations = await pool.query('SELECT id, code, plaz_id, case_id, lab FROM booth_stations ORDER BY id');
  console.log('[巡检] stations:', JSON.stringify(stations.rows));
  const notNull = stations.rows.filter(r => r.plaz_id || r.case_id || r.lab);
  console.log(notNull.length ? `[巡检] 已挂载行: ${notNull.length} (预埋期应为 0)` : '[巡检] 全部 NULL (预埋期符合预期)');
  console.log('[migrate] DEV-P2-03 done (idempotent, rerun-safe).');
  await pool.end();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
