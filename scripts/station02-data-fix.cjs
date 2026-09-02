// BOOTH-STATION-02: station_type/编码数据修正 + traffic_cap/state/offline_mode 存量巡检
// 幂等可重跑; 执行前 dump 受影响行备份; 输出修正前后对照表
// 用法: NODE_PATH=node_modules node -r dotenv/config scripts/station02-data-fix.cjs
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const FAB_LINE_FIXES = [
  { id: 1, code: '1.FAB.LINE-001' }, // FAB产线1号: 1.FAB.MANUAL-001
  { id: 2, code: '1.FAB.LINE-002' }, // FAB产线2号: 1.FAB.MANUAL-002
];
const PROTECTED_IDS = [15]; // STATION-01 线上验收保留站, 不动

(async () => {
  const all = await pool.query(`SELECT * FROM booth_stations ORDER BY id`);
  const before = all.rows;

  // ---- 1. 备份: 修正目标行 + 全表快照 ----
  const targets = before.filter((r) => FAB_LINE_FIXES.some((f) => f.id === Number(r.id)));
  const backup = { at: new Date().toISOString(), targets, full: before };
  const backupPath = path.join(__dirname, 'station02-backup.json');
  const hasPreFixSnapshot = fs.existsSync(backupPath)
    && JSON.parse(fs.readFileSync(backupPath, 'utf8')).full?.some((r) => r.code && String(r.code).includes('.MANUAL-'));
  if (!hasPreFixSnapshot) {
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 1));
    console.log('BACKUP:', backupPath, `(targets=${targets.length}, full=${before.length})`);
  } else {
    console.log('BACKUP: kept existing pre-fix snapshot ->', backupPath);
  }

  // ---- 2. 修正: FAB 产线 1/2 号 station_type=line + code 改 LINE-* ----
  for (const f of FAB_LINE_FIXES) {
    const r = await pool.query(
      `UPDATE booth_stations SET station_type='line', code=$1, updated_at=NOW()
       WHERE id=$2 AND (code LIKE '%.MANUAL-%' OR station_type <> 'line') RETURNING id, code`,
      [f.code, f.id]);
    console.log(`FIX station#${f.id}: ${r.rowCount ? 'updated -> ' + f.code : 'already ok (idempotent)'}`);
  }

  // ---- 3. 巡检补配 (幂等, 跳过保留站): traffic_cap NULL/0, state NULL, offline_mode NULL ----
  const report = [];
  for (const row of before) {
    if (PROTECTED_IDS.includes(Number(row.id))) { report.push({ id: row.id, name: row.name, skip: 'protected(STATION-01 验收保留)' }); continue; }
    const patches = {};
    const wos = await pool.query(
      `SELECT COUNT(*)::int AS n FROM booth_work_orders WHERE station_id=$1 AND status IN ('Dispatched','Accepted','accepted','preparing')`, [row.id]);
    const active = Number(wos.rows[0].n);
    if (row.traffic_cap === null || Number(row.traffic_cap) === 0) patches.traffic_cap = active > 0 ? active : 5;
    if (row.state === null) patches.state = row.status === 'online' ? 'idle' : row.status === 'offline' ? 'down' : 'provisioning';
    if (row.offline_mode === null) patches.offline_mode = false;
    if (Object.keys(patches).length) {
      const sets = Object.keys(patches).map((k, i) => `${k}=$${i + 1}`).join(', ');
      await pool.query(`UPDATE booth_stations SET ${sets}, updated_at=NOW() WHERE id=$${Object.keys(patches).length + 1}`,
        [...Object.values(patches), row.id]);
    }
    report.push({ id: row.id, name: row.name, before: { traffic_cap: row.traffic_cap, state: row.state, offline_mode: row.offline_mode, station_type: row.station_type, code: row.code }, patched: Object.keys(patches).length ? patches : 'none', active_orders: active });
  }

  // ---- 4. 修正后全表 + 对照表 ----
  const after = (await pool.query(`SELECT id, name, code, station_type, state, status, traffic_cap, capacity, offline_mode FROM booth_stations ORDER BY id`)).rows;
  console.log('\n=== 修正前后对照表 ===');
  const preFixFull = hasPreFixSnapshot ? JSON.parse(fs.readFileSync(backupPath, 'utf8')).full : before;
  console.log('BEFORE:', JSON.stringify(preFixFull.filter((r) => FAB_LINE_FIXES.some((f) => f.id === Number(r.id))).map((r) => ({ id: r.id, code: r.code, station_type: r.station_type }))));
  console.log('AFTER :', JSON.stringify(after.filter((r) => FAB_LINE_FIXES.some((f) => f.id === Number(r.id)))));
  console.log('INSPECT:', JSON.stringify(report));
  const residual = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE traffic_cap IS NULL OR traffic_cap = 0) AS cap_bad,
       COUNT(*) FILTER (WHERE state IS NULL) AS state_null,
       COUNT(*) FILTER (WHERE offline_mode IS NULL) AS offline_null,
       COUNT(*) FILTER (WHERE id = 1 AND (station_type <> 'line' OR code <> '1.FAB.LINE-001')) AS s1_bad,
       COUNT(*) FILTER (WHERE id = 2 AND (station_type <> 'line' OR code <> '1.FAB.LINE-002')) AS s2_bad
     FROM booth_stations`);
  console.log('RESIDUAL CHECK:', JSON.stringify(residual.rows[0]));
  await pool.end();
})().catch((e) => { console.error('FIX_FAIL:', e.message); process.exit(1); });
