/* Xfactory 快速上手包 375px 验收截图 (brand 单 shot.cjs 同款) */
const { chromium } = require('playwright-core');
const CHROME = require('os').homedir() + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome';
const BASE = 'http://localhost:5000';
const OUT = __dirname;
const login = async (page, phone) => {
  const resp = await fetch(BASE + '/api/booth/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, password: 'test123' }) });
  const j = await resp.json();
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([t, u]) => { localStorage.setItem('booth_token', t); localStorage.setItem('booth_user', JSON.stringify(u)); }, [j.data.token, j.data.user]);
};
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true });
  const page = await ctx.newPage();
  // 1 登录页 (含快速上手入口)
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.screenshot({ path: OUT + '/login-375.png' });
  // 2 快速上手帮助页 (免登)
  await page.goto(BASE + '/quickstart', { waitUntil: 'networkidle' });
  await page.screenshot({ path: OUT + '/quickstart-375.png' });
  // 3 个人台引导卡 (customer 登录)
  await login(page, 'customer');
  await page.goto(BASE + '/xhpz', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '/xhpz-guide-375.png' });
  // 4 三步开通向导 (admin 登录)
  await login(page, 'admin');
  await page.goto(BASE + '/du/onboarding', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '/onboarding-375.png' });
  await browser.close();
  console.log('SHOTS OK');
})().catch(e => { console.error(e.message); process.exit(1); });
