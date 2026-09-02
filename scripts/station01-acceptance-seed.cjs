const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  // 清理旧 ST01 残留
  await pool.query(`DELETE FROM booth_work_orders WHERE org_id=1 AND job_id LIKE 'ST01-%'`);
  await pool.query(`DELETE FROM booth_stations WHERE org_id=1 AND name LIKE 'ST01 冒烟%'`);
  const mkStation = async (extra) => {
    const r = await pool.query(
      `INSERT INTO booth_stations (org_id, type, name, status, capacity, current_load, fault_strategy, created_at, updated_at${extra.cols ? ', ' + extra.cols : ''})
       VALUES (1, 'FAB', $1, $2, 5, 0, 'bypass', NOW(), NOW()${extra.vals ? ', ' + extra.vals : ''}) RETURNING id, name`,
      [extra.name, extra.status, ...(extra.params || [])]);
    return r.rows[0];
  };
  const st1 = await mkStation({ name: 'ST01 冒烟站1', status: 'online', cols: 'state, traffic_cap, offline_mode', vals: '$3, $4, $5', params: ['idle', 2, false] });
  const st2 = await mkStation({ name: 'ST01 冒烟站2-老数据', status: 'online' }); // state NULL → 回退映射 idle
  const st3 = await mkStation({ name: 'ST01 冒烟站3-老数据', status: 'offline' }); // state NULL → 回退映射 down
  const mkJob = async (jid) => {
    const r = await pool.query(
      `INSERT INTO booth_work_orders (org_id, job_id, job_type, product_name, qty, boms, payload, priority, status, created_at)
       VALUES (1, $1, 'PRODUCE', 'ST01 冒烟品', 1, '[]'::jsonb, '{}'::jsonb, 5, 'Pending', NOW()) RETURNING job_id`,
      [jid]);
    return r.rows[0].job_id;
  };
  const jobs = {};
  for (const j of ['J1','J2','J3','J4','J5','J6','J7']) jobs[j] = await mkJob('ST01-' + j);
  const out = { st1: st1.id, st2: st2.id, st3: st3.id, jobs };
  console.log('seeded:', JSON.stringify(out));
  require('fs').writeFileSync(require('path').join(__dirname, 'station01-seed-ids.json'), JSON.stringify(out));
  await pool.end();
})().catch((e) => { console.error('SEED_FAIL:', e.message); process.exit(1); });
