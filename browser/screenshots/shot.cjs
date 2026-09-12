/* [Xfactory-BRAND] 375px 移动端截图: 登录页 + 工作台 (验收第 5 项) */
const { chromium } = require('playwright-core');

(async () => {
  const exec = process.env.CHROME_PATH || '/root/.cache/ms-playwright/chromium-1161/chrome-linux/chrome';
  const base = process.env.BASE_URL || 'http://localhost:5000';
  const out = '/workspace/projects/browser/screenshots';
  const browser = await chromium.launch({ executablePath: exec, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();

  // 1) 登录页 375px
  await page.goto(`${base}/login`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/login-375.png`, fullPage: true });
  console.log('OK login-375.png');

  // 2) 工作台 375px (真实 OAS 登录态注入)
  const resp = await fetch(`${base}/api/booth/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: 'admin', password: 'test123' }),
  });
  const j = await resp.json();
  if (!j?.data?.token) throw new Error('login failed: ' + JSON.stringify(j).slice(0, 120));
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate(([t, u]) => {
    localStorage.setItem('booth_token', t);
    localStorage.setItem('booth_user', JSON.stringify(u));
  }, [j.data.token, j.data.user]);
  await page.goto(`${base}/du`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/workbench-375.png`, fullPage: true });
  console.log('OK workbench-375.png');

  await browser.close();
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
