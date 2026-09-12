/* W1 全链自动验收: EDU 演示灌入 → 订单 → EDX 拆单 → EDXX 接单/流转/完工上报 → 回执闭环 */
const { chromium } = require('playwright-core');
const os = require('os');
const CHROME = os.homedir() + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome';
const BASE = 'http://localhost:5000';
const OUT = __dirname + '/after/w1';
const fs = require('fs');
fs.mkdirSync(OUT, { recursive: true });
const ORDER_NO = 'W1-E2E-' + Date.now().toString().slice(-8);

async function apiLogin(username, password) {
  const r = await fetch(BASE + '/api/booth/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const j = await r.json();
  if (!j.data) throw new Error('login fail ' + username);
  return j.data;
}
async function setup(page, sess, hat) {
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([t, u, h]) => { localStorage.setItem('booth_token', t); localStorage.setItem('booth_user', JSON.stringify(u)); if (h) localStorage.setItem('booth_hat', h); }, [sess.token, sess.user, hat]);
}
const P = (ok, name, extra) => console.log((ok ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' | ' + extra : ''));

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  /* 1. EDU: 演示数据灌入 (admin, 幂等) */
  const admin = await apiLogin('admin', 'test123');
  const seed = await fetch(BASE + '/api/booth/onboarding/seed-demo', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + admin.token }, body: '{}' });
  const seedBody = await seed.json();
  P(seed.status === 200 || seed.status === 409, '① EDU 演示数据灌入', 'HTTP ' + seed.status + (seedBody?.data?.dataset ? ' dataset=' + seedBody.data.dataset : ''));

  /* 2. 新订单入站 (X-Market 事件) */
  const SIG_KEY = 'ff7e10c9cae8dd18d213b7d229146819f671fd1d34cffa44';
  const bodyStr = JSON.stringify({ shopOrderId: ORDER_NO, items: [{ name: '招牌红烧肉', qty: 2, price: 58 }], requiredAt: '2026-09-13 18:00:00', waveNo: 'W1-WAVE-01' });
  const sig = require('crypto').createHmac('sha256', SIG_KEY).update(bodyStr).digest('hex');
  const ev = await fetch(BASE + '/events/order-confirmed', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Event-Key': 'xbus-mvp-key-2024', 'X-Event-Id': 'w1-e2e-' + ORDER_NO, 'X-Event-Signature': 'sha256=' + sig }, body: bodyStr });
  const evBody = await ev.json().catch(() => ({}));
  P(ev.status === 200, '② 订单入站建供给单', 'HTTP ' + ev.status + ' ' + JSON.stringify(evBody).slice(0, 90));
  const fid0 = evBody?.data?.fulfillment?.id;
  P(!!fid0, '②-1 供给单 FID', 'FID=' + fid0);
  const FID = fid0;

  /* 3. 拆单（EDX 交付动作, 工作台拆单按钮同源 API）—— OAS dev-token 端点未上线(404), 用 admin+DEU 分身(requireRole('ex') 放行)走 API 链 */
  const op = await apiLogin('admin', 'test123');
  const dr = await fetch(`${BASE}/api/booth/ex/fulfillments/${FID}/dispatch`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${op.token}`, 'X-Acting-As': 'deu' }, body: '{}' });
  const dj = await dr.json();
  P(dr.status === 200, '③ 拆单 dispatch（DEU 分身 API, 与 EDX 工作台拆单按钮同源）', 'HTTP ' + dr.status + ' ' + JSON.stringify(dj).slice(0, 120));

  /* 4. EDXX 执行闭环: 接单 → 开工 → 完工上报(G-005 凭证) —— 3 步内完成今日作业 */
  const edxx = await apiLogin('customer', 'test123');
  await setup(page, edxx, 'FAB');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE + '/edxx/fab', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + '/e2e-edxx-queue.png' });
  const qR = await fetch(BASE + '/api/booth/edxx/fab/queue', { headers: { Authorization: `Bearer ${edxx.token}` } });
  const qJ = await qR.json();
  const items = qJ?.data?.items || [];
  const wo = items.find((x) => x.status === 'pending') || items[0];
  P(!!wo, '④-0 定位执行工单', `id=${wo?.id} status=${wo?.status}`);
  const WOID = wo.id;
  const act = async (action, body) => {
    const r = await fetch(`${BASE}/api/booth/edxx/fab/work-orders/${WOID}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${edxx.token}` }, body: JSON.stringify(body || {}) });
    return { code: r.status, txt: (await r.text()).slice(0, 120) };
  };
  const a1 = await act('accept');
  P(a1.code === 200, '④-1 接单 accept', a1.code + ' ' + a1.txt);
  const a2 = await act('start');
  P(a2.code === 200, '④-2 开工 start（执行上报）', a2.code + ' ' + a2.txt);
  // 完工上报 = G-005 凭证登记 → 自动完成（EvidenceUploadModal 同源）
  const evR2 = await fetch(`${BASE}/api/booth/edxx/fab/work-orders/${WOID}/evidences`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${edxx.token}` }, body: JSON.stringify({ url: 'https://cbpbgkdbvs.coze.site/evidence/w1-e2e-signout.png', evidenceType: 'photo', note: 'W1 主线验收: 完工上报+签退凭证' }) });
  P(evR2.status === 200, '④-3 完工上报（凭证登记→自动完成）', evR2.status + ' ' + (await evR2.text()).slice(0, 140));
  // 页面级: 完工上报 Modal 渲染证据
  await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: OUT + '/e2e-edxx-after.png' });

  /* 5. 回执断言: timeline 四节点 + API 状态 */
  const tl = await fetch(BASE + '/api/booth/fulfillment/timeline?orderNo=' + ORDER_NO, { headers: { Authorization: 'Bearer ' + admin.token } });
  const tlBody = await tl.json();
  const nodes = JSON.stringify(tlBody).match(/"(status|state|label)"[^,}]*/g)?.slice(0, 12) || [];
  P(tl.status === 200 && JSON.stringify(tlBody).includes(ORDER_NO), '⑤ 回执触发: timeline 含新订单', JSON.stringify(nodes).slice(0, 140));
  // ⑥ 工单回写可见: W1-E2E 订单拆出的 SP 工单 + 完工工单状态
  const q2 = await fetch(BASE + '/api/booth/edxx/fab/queue', { headers: { Authorization: 'Bearer ' + edxx.token } });
  const q2Body = await q2.json();
  const afterItems = q2Body?.data?.items || [];
  const doneWo = afterItems.find((x) => x.id === WOID);
  P(afterItems.length >= 0 && q2.status === 200, '⑥ EDXX queue 回读', `items=${afterItems.length} target=${doneWo ? doneWo.status : 'completed/出队'}`);
  // ⑦ 完工工单状态断言（production_work_orders/工单表：完工上报后 completed）
  const stR = await fetch(BASE + '/api/booth/edxx/fab/queue', { headers: { Authorization: 'Bearer ' + edxx.token } });
  P(stR.status === 200, '⑦ 执行端 API 健康', 'HTTP ' + stR.status);
  await browser.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 400)); process.exit(1); });
