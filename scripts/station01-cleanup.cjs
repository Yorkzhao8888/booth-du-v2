// ST01 回归数据清理 (固化): 删除回归产生的 ST01-* 工单 + 'ST01 冒烟%' 站点, 并将 station01-seed-ids.json 的 st1/st2/st3 重置为空
// 幂等可重跑; 保护站 id=1/2/15 不动 (按 name 匹配, 与 id 无关)
// 标准回归流程: node scripts/station01-acceptance-seed.cjs -> node scripts/station01-acceptance.mjs -> node scripts/station01-cleanup.cjs
// 用法: NODE_PATH=node_modules node -r dotenv/config scripts/station01-cleanup.cjs
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  // ---- 1. 引用检查: ST01 冒烟站上若有非 ST01-* 工单则 ABORT ----
  const stations = (await pool.query(`SELECT id, name FROM booth_stations WHERE org_id=1 AND name LIKE 'ST01 冒烟%' ORDER BY id`)).rows;
  if (stations.length) {
    const ids = stations.map((s) => s.id).join(',');
    const jobs = (await pool.query(`SELECT id, job_id FROM booth_work_orders WHERE station_id IN (${ids})`)).rows;
    const nonTest = jobs.filter((j) => !String(j.job_id).startsWith('ST01-'));
    if (nonTest.length) {
      console.error('ABORT: ST01 冒烟站存在非 ST01-* 工单引用, 需人工裁定:', JSON.stringify(nonTest));
      process.exit(1);
    }
  }

  // ---- 2. 删除 (顺序: 工单 -> 站) ----
  const rJobs = await pool.query(`DELETE FROM booth_work_orders WHERE org_id=1 AND job_id LIKE 'ST01-%' RETURNING id`);
  console.log('DELETE ST01-* work_orders:', rJobs.rowCount, rJobs.rowCount ? `(ids ${rJobs.rows.map((r) => r.id).join(',')})` : '(already clean)');
  const rSt = await pool.query(`DELETE FROM booth_stations WHERE org_id=1 AND name LIKE 'ST01 冒烟%' RETURNING id, name`);
  console.log('DELETE ST01 smoke stations:', rSt.rowCount, rSt.rowCount ? rSt.rows.map((r) => `#${r.id} ${r.name}`).join(', ') : '(already ok)');

  // ---- 3. seed-ids.json 重置 (st1/st2/st3 置空, jobs 固定前缀保留) ----
  const idsPath = path.join(__dirname, 'station01-seed-ids.json');
  if (fs.existsSync(idsPath)) {
    const j = JSON.parse(fs.readFileSync(idsPath, 'utf8'));
    if (j.st1 !== '' || j.st2 !== '' || j.st3 !== '') {
      j.st1 = ''; j.st2 = ''; j.st3 = '';
      fs.writeFileSync(idsPath, JSON.stringify(j));
      console.log('SEED-IDS: reset st1/st2/st3 -> ""');
    } else {
      console.log('SEED-IDS: already clean');
    }
  }

  // ---- 4. 残留检查 ----
  const left = (await pool.query(`SELECT id, name, code FROM booth_stations WHERE org_id=1 ORDER BY id`)).rows;
  const stLeft = (await pool.query(`SELECT COUNT(*)::int AS n FROM booth_stations WHERE org_id=1 AND name LIKE 'ST01 冒烟%'`)).rows[0].n;
  const jobLeft = (await pool.query(`SELECT COUNT(*)::int AS n FROM booth_work_orders WHERE org_id=1 AND job_id LIKE 'ST01-%'`)).rows[0].n;
  console.log('\n=== 清理后对照 ===');
  console.log('REMAINING STATIONS:', JSON.stringify(left));
  console.log('SMOKE STATION LEFT:', stLeft, '| ST01 JOB LEFT:', jobLeft);
  console.log('PROTECTED 1/2/15 intact:', left.map((r) => Number(r.id)).join(',') === '1,2,15');
  await pool.end();
})().catch((e) => { console.error('CLEANUP_FAIL:', e.message); process.exit(1); });
