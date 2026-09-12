const { chromium } = require('playwright-core');
const CHROME = require('os').homedir() + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome';
const BASE = 'http://localhost:5000';
async function login(page, username, password) {
  const r = await fetch(BASE + '/api/booth/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const j = await r.json(); return j.data;
}
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const admin = await login(page, 'admin', 'test123');
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([t, u]) => { localStorage.setItem('booth_token', t); localStorage.setItem('booth_user', JSON.stringify(u)); localStorage.setItem('booth_hat', 'FAB'); }, [admin.token, admin.user]);

  // P1-c: 全文查「连接断开」+ 大屏 Tag 状态
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE + '/du/realtime-dashboard', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  const dash = await page.evaluate(() => {
    const text = document.body.innerText;
    const hasBroken = text.includes('连接断开');
    const tags = [...document.querySelectorAll('.ant-tag')].map((t) => t.textContent.trim()).filter((t) => /连接|实时/.test(t));
    const nums = [...document.querySelectorAll('.ant-statistic-content-value')].map((n) => ({ t: n.textContent, w: Math.round(n.getBoundingClientRect().width) }));
    return { hasBroken, tags, nums: nums.slice(0, 6) };
  });
  console.log('P1-c result:', JSON.stringify(dash));
  console.log((!dash.hasBroken && dash.tags.length > 0 ? 'PASS' : 'FAIL') + ' P1-c 大屏连接态 | tags=' + JSON.stringify(dash.tags));
  const clipped = dash.nums.filter((n) => n.w <= 0);
  console.log((clipped.length === 0 ? 'PASS' : 'FAIL') + ' P1-c 数字不截断 | ' + JSON.stringify(dash.nums));
  await page.screenshot({ path: 'browser/screenshots/after/realtime-1280.png' });

  // P2-1: steps active 判定
  await page.goto(BASE + '/du/onboarding?step=2', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  const wiz = await page.evaluate(() => {
    const active = document.querySelector('.ant-steps-item-active .ant-steps-item-title');
    const url = location.href;
    const body = document.body.innerText;
    return { active: active ? active.textContent.trim() : null, url, hasTemplate: /产能模板/.test(body) };
  });
  console.log('P2-1 result:', JSON.stringify(wiz));
  console.log((wiz.active && /模板|演示/.test(wiz.active) ? 'PASS' : 'FAIL') + ' P2-1 向导 ?step=2 直跳 | active=' + wiz.active + ' url=' + wiz.url);
  await page.screenshot({ path: 'browser/screenshots/after/wizard-step2-1280.png' });
  await browser.close();
})().catch((e) => { console.error('FATAL:', String(e).slice(0, 300)); process.exit(1); });
