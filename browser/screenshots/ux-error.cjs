const { chromium } = require('playwright-core');
const CHROME = require('os').homedir() + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome';
const BASE = 'http://localhost:5000';
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const r = await fetch(BASE + '/api/booth/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'test123' }) });
  const j = await r.json();
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([t, u]) => { localStorage.setItem('booth_token', t); localStorage.setItem('booth_user', JSON.stringify(u)); localStorage.setItem('booth_hat', 'FAB'); }, [j.data.token, j.data.user]);
  // 拦截库存接口 → 模拟网络失败
  await page.route('**/api/booth/du/inventory*', (route) => route.abort('failed'));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE + '/du/inventory', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  const err = await page.evaluate(() => {
    const body = document.body.innerText;
    const retry = [...document.querySelectorAll('button')].some((b) => /重试|重新加载/.test(b.textContent));
    return { hasError: /加载失败|出错|错误/.test(body), retryBtn: retry };
  });
  console.log((err.hasError && err.retryBtn ? 'PASS' : 'FAIL') + ' ② 错误态+重试按钮 | ' + JSON.stringify(err));
  await page.screenshot({ path: 'browser/screenshots/after/inventory-error-1280.png' });
  // station 375 对比补拍
  await page.route('**/api/booth/du/inventory*', (route) => route.continue());
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(BASE + '/du/fab/station', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1200);
  console.log('P1-e station-375 final=' + page.url());
  await page.screenshot({ path: 'browser/screenshots/after/station-375.png' });
  await browser.close();
})().catch((e) => { console.error('FATAL:', String(e).slice(0, 300)); process.exit(1); });
// appended: station-375 补拍
