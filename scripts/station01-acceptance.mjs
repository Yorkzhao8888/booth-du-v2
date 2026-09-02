// BOOTH-STATION-01 验收脚本 (工单验收5: 供主 Agent 线上复核)
// 用法: node -r dotenv/config scripts/station01-acceptance-seed.cjs && DEPLOY_RUN_PORT=<port> node scripts/station01-acceptance.mjs
// 需先启动冒烟实例: DEPLOY_RUN_PORT=<port> node dist/server/index.js (脚本自带幂等清理, 结束后请清理 ST01-* 测试数据)
// BOOTH-STATION-01 冒烟: 旧 dispatch 切换新状态机 + 回归
import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const setSt = async (id, sql) => pool.query(`UPDATE booth_stations SET ${sql}, updated_at=NOW() WHERE id=$1`, [id]);

const BASE = `http://localhost:${process.env.DEPLOY_RUN_PORT || 5101}/api/booth`;
let pass = 0, fail = 0;
function check(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail !== undefined && detail !== '' ? ' | ' + detail : ''));
}
async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json };
}
const login = async (phone) => (await api('/auth/login', { method: 'POST', body: { phone, password: '123456' } })).json?.data?.token;
const du = await login('13800000001');
const dexx = await login('13800000003');
check('登录 du/dexx', !!du && !!dexx);
const S = JSON.parse(readFileSync(new URL('./station01-seed-ids.json', import.meta.url), 'utf8'));
const st1 = Number(S.st1), st2 = Number(S.st2), st3 = Number(S.st3);
const D = (j, sid = st1) => api(`/job/jobs/${S.jobs[j]}/dispatch`, { method: 'POST', token: du, body: { station_id: sid } });

// S1: state=down → 409 blocked
await setSt(st1, `state='down'`);
let r = await D('J1');
check('S1 state=down 拒派 409', r.status === 409 && r.json?.code === 'E_409_STATION_BLOCKED', `${r.status} ${r.json?.code}`);

// S2: traffic_cap=0 (state=idle) → 409 at_cap
await setSt(st1, `state='idle', traffic_cap=0, offline_mode=false`);
r = await D('J1');
check('S2 traffic_cap=0 拒派 409', r.status === 409 && r.json?.code === 'E_409_STATION_AT_CAP' && r.json?.data?.capacity === 0, `${r.status} ${r.json?.code} ${JSON.stringify(r.json?.data)}`);

// S3: offline_mode=true → 423
await setSt(st1, `state='idle', traffic_cap=2, offline_mode=true`);
r = await D('J1');
check('S3 offline_mode 拒派 423', r.status === 423 && r.json?.code === 'E_423_STATION_OFFLINE_MODE', `${r.status} ${r.json?.code}`);

// S4: idle+cap=2 正常派单
await setSt(st1, `offline_mode=false`);
r = await D('J1');
check('S4 idle+cap 正常派 200', r.status === 200 && r.json?.data?.status === 'Dispatched', `${r.status} ${JSON.stringify(r.json?.error || '')}`);
const load1 = await pool.query(`SELECT current_load, status FROM booth_stations WHERE id=$1`, [st1]);
check('S4b current_load 兼容累加=1', Number(load1.rows[0].current_load) === 1, JSON.stringify(load1.rows[0]));

// S5: 满产能: 再派 J2 成功(active=2), J3 拒绝
r = await D('J2');
check('S5a 第2单 200 (active 1->2)', r.status === 200, `${r.status} ${r.json?.code || ''}`);
r = await D('J3');
check('S5b active>=cap 拒 409', r.status === 409 && r.json?.code === 'E_409_STATION_AT_CAP' && r.json?.data?.current === 2, `${r.status} ${r.json?.code} ${JSON.stringify(r.json?.data)}`);

// S6: fault stop_all → state=down/cap=0 → 拒 (验收3)
const f1 = await api(`/dexx/fab/station/${st1}/fault`, { method: 'POST', token: dexx, body: { reason: 'ST01 冒烟故障', strategy: 'stop_all' } });
check('S6a fault(stop_all) 200', f1.status === 200, `${f1.status} ${JSON.stringify(f1.json?.message || '')}`);
r = await D('J3');
check('S6b fault后旧dispatch拒派 409', r.status === 409 && r.json?.code === 'E_409_STATION_BLOCKED', `${r.status} ${r.json?.code}`);

// S6c: fault bypass 下调 cap → 容量判断立即反映
await setSt(st1, `state='idle', traffic_cap=3, offline_mode=false`);
await pool.query(`UPDATE booth_work_orders SET status='accepted', station_id=$1 WHERE job_id=$2`, [st1, S.jobs.J4]); // accepted 在途1
const f2 = await api(`/dexx/fab/station/${st1}/fault`, { method: 'POST', token: dexx, body: { reason: 'ST01 bypass', strategy: 'bypass' } });
const stAfter = await pool.query(`SELECT state, traffic_cap FROM booth_stations WHERE id=$1`, [st1]);
check('S6c bypass 下调 cap=2 (3-1)', Number(stAfter.rows[0].traffic_cap) === 2 && stAfter.rows[0].state === 'paused', JSON.stringify(stAfter.rows[0]));
// state 回置 idle(排除 blocked 干扰), 保留 bypass 下调后的 cap=2
await setSt(st1, `state='idle'`);
// active = J1,J2(Dispatched) + J4(accepted) = 3 >= cap 2 → 拒
r = await D('J5');
check('S6d bypass后容量判断立即生效 409', r.status === 409 && r.json?.data?.current === 2 && r.json?.data?.capacity === 2, `${r.status} ${JSON.stringify(r.json?.data)}`);

// S7: 老数据兼容回退 (显式 state NULL; state 列 DEFAULT provisioning)
await setSt(st2, `state=NULL, traffic_cap=5`);
await setSt(st3, `state=NULL`);
r = await D('J6', st2);
check('S7a 老 online→idle 可派 200', r.status === 200, `${r.status} ${r.json?.code || ''}`);
r = await D('J7', st3);
check('S7b 老 offline→down 拒 409', r.status === 409 && r.json?.code === 'E_409_STATION_BLOCKED', `${r.status} ${r.json?.code}`);

// S7c: 老数据 traffic_cap 默认 0 → 无产能拒 (存量老站需补配 cap)
await setSt(st2, `traffic_cap=0`);
r = await D('J7', st2);
check('S7c 老数据 cap=0 拒 409', r.status === 409 && r.json?.code === 'E_409_STATION_AT_CAP', `${r.status} ${r.json?.code}`);

// S8: batch-dispatch 同守卫
await setSt(st1, `state='down'`);
r = await api('/job/jobs/batch-dispatch', { method: 'POST', token: du, body: { job_ids: [S.jobs.J3], station_id: st1 } });
check('S8a batch state=down 拒 409', r.status === 409 && r.json?.code === 'E_409_STATION_BLOCKED', `${r.status} ${r.json?.code}`);
await setSt(st1, `state='idle', traffic_cap=10, offline_mode=false`);
r = await api('/job/jobs/batch-dispatch', { method: 'POST', token: du, body: { job_ids: [S.jobs.J3], station_id: st1 } });
check('S8b batch 正常 200', r.status === 200, `${r.status} ${JSON.stringify(r.json?.error || '')}`);

// S9: cancel 释放 → J5 可再派 (active 口径回落)
r = await api(`/job/jobs/${S.jobs.J1}/cancel`, { method: 'POST', token: du });
check('S9a cancel 200', r.status === 200, `${r.status} ${r.json?.error || ''}`);
r = await D('J5');
check('S9b 释放后可再派 200 (active 回落)', r.status === 200, `${r.status} ${JSON.stringify(r.json?.error || '')}`);

console.log(`\nTOTAL: ${pass} pass, ${fail} fail`);
await pool.end();
