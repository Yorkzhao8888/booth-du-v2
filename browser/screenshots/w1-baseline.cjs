// [W1] 基线实测: 菜单叶子数 / 三链路现状 / before 截图
const { chromium } = require('playwright-core');
const fs = require('fs');
const CHROME = require('os').homedir() + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome';
const BASE = 'http://localhost:5000';
const OUT = __dirname + '/w1-before';
fs.mkdirSync(OUT, { recursive: true });

async function login(page, username) {
  const r = await fetch(BASE + '/api/booth/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'test123' }) });
  const j = await r.json();
  if (!j?.data?.token) throw new Error('login failed: ' + JSON.stringify(j).slice(0, 150));
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([t, u]) => { localStorage.setItem('booth_token', t); localStorage.setItem('booth_user', JSON.stringify(u)); }, [j.data.token, j.data.user]);
  return j.data;
}
async function open(page, url, mobile = false) {
  await page.setViewportSize(mobile ? { width: 375, height: 812 } : { width: 1280, height: 900 });
  await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
}
async function countLeaves(page) {
  // 展开所有 submenu 后数叶子
  await page.evaluate(() => {
    document.querySelectorAll('.ant-menu-submenu-title').forEach((t) => { if (!t.closest('.ant-menu-submenu-open')) (t).click(); });
  });
  await page.waitForTimeout(600);
  return page.evaluate(() => document.querySelectorAll('.ant-menu-item:not(.ant-menu-item-only-child), .ant-menu-item').length);
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const out = [];

  // ===== admin: 菜单叶子基线 =====
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, 'admin');
  await open(page, '/du');
  const leafCount = await countLeaves(page);
  const labels = await page.evaluate(() => [...document.querySelectorAll('.ant-menu-item')].map((i) => i.textContent.trim()));
  out.push('BASELINE admin 菜单叶子数=' + leafCount);
  out.push('BASELINE labels=' + JSON.stringify(labels));

  // before 截图 (隐藏对象页)
  const shots = [
    ['/du', 'dashboard'], ['/du/profit', 'profit'], ['/du/replenishment', 'replenishment'],
    ['/du/fulfillment-track', 'fulfillment'], ['/du/realtime-dashboard', 'realtime'],
    ['/du/wh/warehouse-dashboard', 'wh-dashboard'], ['/du/batches', 'batches'],
    ['/du/fab/zone/production', 'zone-production'], ['/edxx/station', 'station-cu'],
  ];
  for (const [u, n] of shots) { await open(page, u); await page.screenshot({ path: `${OUT}/before-${n}-1280.png` }); }

  // ===== customer (CU→edxx): Station 链路 =====
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await login(p2, 'customer');
  await open(p2, '/containers');
  const custContainers = await p2.evaluate(() => document.body.innerText.slice(0, 200).replace(/\n+/g, '|'));
  out.push('CU containers=' + custContainers.slice(0, 150));
  await open(p2, '/edxx/station');
  out.push('CU /edxx/station final=' + p2.url());
  const stText = await p2.evaluate(() => document.body.innerText.slice(0, 300).replace(/\n+/g, '|'));
  out.push('CU station text=' + stText.slice(0, 200));
  await p2.screenshot({ path: `${OUT}/before-station-cu-1280.png` });
  await open(p2, '/xhpz');
  out.push('CU /xhpz final=' + p2.url());

  // ===== operator (AU→dx): 登录分流链路 =====
  const ctx3 = await browser.newContext();
  const p3 = await ctx3.newPage();
  await login(p3, 'operator');
  await open(p3, '/containers');
  await p3.screenshot({ path: `${OUT}/before-op-containers.png` });
  // 点 #xepz 卡
  const xepzClicked = await p3.evaluate(() => {
    const cards = [...document.querySelectorAll('div,button,a')].filter((el) => el.textContent.trim().startsWith('#xepz') && el.offsetHeight > 0);
    if (cards.length) { cards[cards.length - 1].click(); return true; } return false;
  });
  await p3.waitForTimeout(1500);
  out.push(`AU xepz card clicked=${xepzClicked} → ${p3.url()}`);
  // 若到帽页点 EDU 帽
  if (p3.url().includes('/hats')) {
    const hatClicked = await p3.evaluate(() => {
      const cards = [...document.querySelectorAll('div,button')].filter((el) => /EDU|经营帽/.test(el.textContent) && el.offsetHeight > 0 && el.offsetHeight < 300);
      if (cards.length) { cards[0].click(); return cards[0].textContent.trim().slice(0, 30); } return 'none';
    });
    await p3.waitForTimeout(1500);
    out.push(`AU hat clicked=${hatClicked} → final=${p3.url()}`);
  }
  await p3.screenshot({ path: `${OUT}/before-op-final.png` });

  await browser.close();
  console.log(out.join('\n'));
})().catch((e) => { console.error('FATAL:', String(e).slice(0, 400)); process.exit(1); });
