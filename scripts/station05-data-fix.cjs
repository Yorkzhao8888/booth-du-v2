// BOOTH-STATION-05: 清理 ST01 回归重建冒烟站 id=19/20/21 (P2 数据清理, 补充 STATION-04 遗留)
// 幂等可重跑; 先备份后删除; 保护站 id=1/2/15 不动
// 用法: NODE_PATH=node_modules node -r dotenv/config scripts/station05-data-fix.cjs
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const TARGET_IDS = [19, 20, 21];
const PROTECTED_IDS = [1, 2, 15]; // 沿用 station02/04 模式: 产线1/2号 + ST01 验收保留站

(async () => {
  const ph = TARGET_IDS.join(',');
  const stations = (await pool.query(`SELECT * FROM booth_stations WHERE id IN (${ph}) ORDER BY id`)).rows;
  const jobs = (await pool.query(`SELECT * FROM booth_work_orders WHERE station_id IN (${ph}) ORDER BY id`)).rows;
  const nonTestJobs = jobs.filter((j) => !String(j.job_id).startsWith('ST01-'));
  if (nonTestJobs.length) {
    console.error('ABORT: 目标站存在非 ST01-* 前缀的工单引用, 需人工裁定:', JSON.stringify(nonTestJobs.map((j) => ({ id: j.id, job_id: j.job_id }))));
    process.exit(1);
  }

  // ---- 1. 备份 (站点完整行含 metadata + 关联工单完整行; 不覆盖既有备份) ----
  const backupPath = path.join(__dirname, 'station05-backup.json');
  if (!fs.existsSync(backupPath)) {
    fs.writeFileSync(backupPath, JSON.stringify({ at: new Date().toISOString(), stations, work_orders: jobs }, null, 1));
    console.log('BACKUP:', backupPath, `(stations=${stations.length}, work_orders=${jobs.length})`);
  } else {
    console.log('BACKUP: kept existing ->', backupPath);
  }

  // ---- 2. 删除 (顺序: 工单 -> 站) ----
  const rJobs = await pool.query(`DELETE FROM booth_work_orders WHERE station_id IN (${ph}) AND job_id LIKE 'ST01-%' RETURNING id`);
  console.log('DELETE work_orders:', rJobs.rowCount, rJobs.rowCount ? `(ids ${rJobs.rows.map((r) => r.id).join(',')})` : '(already clean)');
  const rSt = await pool.query(`DELETE FROM booth_stations WHERE id IN (${ph}) RETURNING id, name`);
  console.log('DELETE stations:', rSt.rowCount, rSt.rowCount ? rSt.rows.map((r) => `#${r.id} ${r.name}`).join(', ') : '(already ok)');

  // ---- 3. 残留与保护检查 ----
  const left = (await pool.query(`SELECT id, name, code, station_type, state, traffic_cap FROM booth_stations ORDER BY id`)).rows;
  const refLeft = (await pool.query(`SELECT COUNT(*)::int AS n FROM booth_work_orders WHERE station_id IN (${ph})`)).rows[0].n;
  console.log('\n=== 清理后对照 ===');
  console.log('REMAINING STATIONS:', JSON.stringify(left));
  console.log('PROTECTED 1/2/15 intact:', left.map((r) => Number(r.id)).join(',') === '1,2,15');
  console.log('STATION REF RESIDUAL:', refLeft);
  await pool.end();
})().catch((e) => { console.error('FIX_FAIL:', e.message); process.exit(1); });
