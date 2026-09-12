/* Xfactory 生态版四主体 MVP 验收截图 (onboard-shot.cjs 同款链路) */
const { chromium } = require('playwright-core');
const CHROME = require('os').homedir() + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome';
const BASE = 'http://localhost:5000';
const OUT = __dirname;
const login = async (page, username) => {
  const resp = await fetch(BASE + '/api/booth/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'test123' }) });
  const j = await resp.json();
  if (!j.success) throw new Error('login failed: ' + JSON.stringify(j).slice(0, 200));
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([t, u]) => { localStorage.setItem('booth_token', t); localStorage.setItem('booth_user', JSON.stringify(u)); localStorage.setItem('booth_hat', 'FAB'); localStorage.removeItem('booth_container'); }, [j.data.token, j.data.user]);
};
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true });
  const page = await ctx.newPage();
  // 1 登录页 (四主体分流文案)
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.screenshot({ path: OUT + '/eco-login-375.png' });
  // 2 容器分流页 (admin=SU 四主体全可见)
  await login(page, 'admin');
  await page.goto(BASE + '/containers', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + '/eco-containers-375.png' });
  // 3 VEM 控制台 (铺位列表: 直营标+演示加盟标+费率)
  await page.goto(BASE + '/xvpz', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: OUT + '/eco-vem-shops-375.png' });
  // 4 VEM 入驻审核 Tab (演示待审申请)
  await page.locator('.ant-tabs-tab', { hasText: '入驻审核' }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '/eco-vem-review-375.png' });
  // 5 VEM 分成台账 Tab (结算流水×费率, 0 金额口径)
  await page.locator('.ant-tabs-tab', { hasText: '分成台账' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + '/eco-vem-ledger-375.png' });
  // 5b 台账空态 (演示加盟铺无结算流水 → 按铺过滤空态)
  await page.locator('.ant-select-selector').first().click();
  await page.waitForTimeout(400);
  await page.locator('.ant-select-item-option', { hasText: '演示·新味食品加盟铺' }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + '/eco-vem-ledger-empty-375.png' });
  // 6 经营户台 (#xdpz 铺位管理)
  await page.goto(BASE + '/xdpz', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + '/eco-xdpz-375.png' });
  // 7 企业台入驻卡 (#xepz 加盟入驻入口)
  await page.goto(BASE + '/xepz', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  await page.screenshot({ path: OUT + '/eco-xepz-join-375.png' });
  await browser.close();
  console.log('ECO SHOTS OK');
})().catch(e => { console.error(e.message); process.exit(1); });
