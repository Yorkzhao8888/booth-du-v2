#!/usr/bin/env node
/**
 * DEV-P1-02 · 状态机双轨消除 —— 历史数据回填迁移 (可逆)
 *
 * 旧 status → 新 state 兼容映射 (固化, STATION-01 裁定):
 *   online → idle | offline → down | busy → busy | paused → paused
 *   maintenance → maintenance | decommissioned → decommissioned
 *   provisioning → provisioning | active → busy | disabled → down | scheduled → provisioning
 *   其余未知旧值 → provisioning (保守, 需人工裁定)
 *
 * 策略: 仅纠正 state 为默认值 'provisioning' 的行 (未被新状态机写过的历史行),
 *       显式 state 行一律不动; status 列保留 (仅下线读写, 不 DROP)。
 * 可逆: scripts/dev-p1-02-rollback.cjs 按备份恢复原 state。
 * 幂等: 二次运行输出 already migrated。
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const fs = require('fs');
const { Pool } = require('pg');

const LEGACY_STATUS_TO_STATE = {
  online: 'idle', offline: 'down', busy: 'busy', paused: 'paused',
  maintenance: 'maintenance', decommissioned: 'decommissioned',
  provisioning: 'provisioning', active: 'busy', disabled: 'down', scheduled: 'provisioning',
};
const BACKUP = path.join(__dirname, 'dev-p1-02-backup.json');
const PROTECTED_IDS = [1, 2, 15]; // 既有产线站保护 (与 STATION-02/04 对齐)

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const client = await pool.connect();
  try {
    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name='booth_stations' AND column_name IN ('status','state')`
    );
    if (cols.rowCount < 2) { console.log('ABORT: booth_stations 缺少 status/state 列 (先跑 DEV-P1-01/基础迁移)'); process.exit(1); }

    // 1) 巡检: 全部站的双轨现值
    const all = await client.query(`SELECT id, code, status, state FROM booth_stations ORDER BY id`);
    console.log('[inspect] before:', JSON.stringify(all.rows));

    // 2) 目标行: state 为默认 'provisioning' 且 status 有可映射值 (历史未迁移行)
    const targets = all.rows.filter(
      (r) => (r.state === 'provisioning' || r.state === null) && r.status && LEGACY_STATUS_TO_STATE[r.status] !== undefined && r.status !== 'provisioning'
    );
    const badUnknown = all.rows.filter((r) => (r.state === 'provisioning' || r.state === null) && r.status && LEGACY_STATUS_TO_STATE[r.status] === undefined);
    if (badUnknown.length) console.log(`[warn] ${badUnknown.length} 行存在未知旧 status, 保持 provisioning 需人工裁定:`, badUnknown.map((r) => `${r.id}:${r.status}`).join(','));

    // 3) 备份 (无条件先行: 可逆性前提, 即使无回填行也落快照; 不覆盖既有备份)
    if (!fs.existsSync(BACKUP)) {
      fs.writeFileSync(BACKUP, JSON.stringify({ migratedAt: new Date().toISOString(), LEGACY_STATUS_TO_STATE, rows: all.rows }, null, 2));
      console.log(`[backup] written -> ${BACKUP} (${all.rowCount} rows)`);
    } else console.log('[backup] exists, keep (不覆盖)');

    if (!targets.length) { console.log('already migrated: 无需回填的历史行'); return; }

    // 4) 回填
    let n = 0;
    for (const r of targets) {
      if (PROTECTED_IDS.includes(r.id)) { console.log(`[skip] id=${r.id} 在保护名单, 仅报告不改`); continue; }
      const to = LEGACY_STATUS_TO_STATE[r.status];
      const res = await client.query(`UPDATE booth_stations SET state=$1, updated_at=NOW() WHERE id=$2 AND state IN ('provisioning')`, [to, r.id]);
      n += res.rowCount;
      console.log(`[migrate] id=${r.id} ${r.code}: status '${r.status}' -> state '${to}'${res.rowCount ? '' : ' (skip: state 已变更)'}`);
    }
    const after = await client.query(`SELECT id, code, status, state FROM booth_stations ORDER BY id`);
    console.log(`[done] migrated rows: ${n}; [inspect] after: ${JSON.stringify(after.rows)}`);
  } finally { client.release(); await pool.end(); }
})().catch((e) => { console.error('MIGRATE-ERROR', e.message); process.exit(1); });
