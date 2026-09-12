const { chromium } = require('playwright-core');
const CHROME = require('os').homedir() + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome';
const BASE = 'http://localhost:5000';
const OUT = __dirname + '/after/w1';
const fs = require('fs');
fs.mkdirSync(OUT, { recursive: true });
const PAGES = [
  ['/du', '经营看板'], ['/du/orders', '订单管理'], ['/du/production-orders', '生产单全链路'],
  ['/du/crafts', '工艺管理'], ['/du/boms', '商品BOM'], ['/du/purchase-orders', '采购管理'],
  ['/du/suppliers', '供应商管理'], ['/du/supply-orders', '供给订单'], ['/du/work-orders', '工单管理'],
  ['/du/fab/flow', '作业流'], ['/du/station', 'Station 作业站'], ['/du/fab/equipment', '设备台账'],
  ['/du/batches', '批次库存'], ['/du/inventory', '库存总览'], ['/du/inventory-transfer', '库存调拨'],
  ['/au', 'AU 店长台'],
];
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const admin = await (await fetch(BASE + '/api/booth/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'test123' }) })).json();
  const setup = (t, u) => page.evaluate(([x, y]) => { localStorage.setItem('booth_token', x); localStorage.setItem('booth_user', JSON.stringify(y)); localStorage.setItem('booth_hat', 'FAB'); }, [t, u]);
  await page.setViewportSize({ width: 1280, height: 900 });
  let pass = 0, fail = [];
  const matrix = [];
  for (const [path, name] of PAGES) {
    // 正常态: 页面渲染成功(菜单+主内容, 无白屏无异常文案)
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
    await setup(admin.data.token, admin.data.user);
    await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(900);
    const ok = await page.evaluate(() => {
      const t = document.body.innerText;
      const menuOk = !!document.querySelector('.ant-menu');
      const broken = /Cannot read|undefined is not|NaN/.test(t);
      return { menuOk, broken, hasEmpty: /还没有|暂无|没有/.test(t), title: document.title };
    });
    // 错误态: 全 API 断网 → PageState error + 重试按钮
    await page.route('**/api/booth/**', (r) => r.abort('failed'));
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const err = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].map((b) => b.textContent || '');
      return { hasErr: /加载失败|重试|错误|出错/.test(document.body.innerText), retry: btns.some((t) => /重试|重新加载/.test(t)) };
    });
    await page.unroute('**/api/booth/**');
    const rowPass = ok.menuOk && !ok.broken && (err.hasErr || err.retry);
    if (rowPass) pass++; else fail.push(name);
    matrix.push({ name, path, menu: ok.menuOk, broken: ok.broken, emptyOrData: ok.hasEmpty, errorState: err.hasErr, retry: err.retry, title: ok.title.slice(0, 40) });
    console.log((rowPass ? 'PASS' : 'FAIL') + ' ' + name + ' | menu=' + ok.menuOk + ' broken=' + ok.broken + ' empty=' + ok.hasEmpty + ' err=' + err.hasErr + ' retry=' + err.retry);
  }
  fs.writeFileSync(OUT + '/threestate-matrix.json', JSON.stringify(matrix, null, 2));
  console.log('=== 三态矩阵: ' + pass + '/' + PAGES.length + ' PASS' + (fail.length ? ' | FAIL=' + fail.join(',') : ''));
  await browser.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
