#!/usr/bin/env node
/**
 * DEV-P1-02 · 状态机双轨消除 —— 回滚脚本 (可逆)
 * 按 scripts/dev-p1-02-backup.json 恢复回填前的 state 值。
 * status 列迁移中未改动 (仅代码层下线读写), 无需恢复。
 * 幂等: 二次运行输出 already rolled back / 恢复行 0。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const { Pool } = require('pg');

const BACKUP = path.join(__dirname, 'dev-p1-02-backup.json');

(async () => {
  if (!fs.existsSync(BACKUP)) { console.log('ABORT: 未找到备份', BACKUP); process.exit(1); }
  const bak = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    let n = 0;
    for (const r of bak.rows) {
      const res = await client.query(`UPDATE booth_stations SET state=$1, updated_at=NOW() WHERE id=$2 AND state IS DISTINCT FROM $1`, [r.state, r.id]);
      n += res.rowCount;
    }
    const after = await client.query(`SELECT id, code, status, state FROM booth_stations ORDER BY id`);
    console.log(`[rollback] restored rows: ${n}; [inspect] after: ${JSON.stringify(after.rows)}`);
    if (n === 0) console.log('already rolled back: 与备份一致');
  } finally { client.release(); await pool.end(); }
})().catch((e) => { console.error('ROLLBACK-ERROR', e.message); process.exit(1); });
