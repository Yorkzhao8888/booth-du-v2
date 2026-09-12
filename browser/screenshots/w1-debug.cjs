const { chromium } = require('playwright-core');
const CHROME = require('os').homedir() + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome';
const BASE = 'http://localhost:5000';
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', (m) => console.log('[c]', m.type(), m.text().slice(0, 100)));
  page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 120)));
  const admin = await (await fetch(BASE + '/api/booth/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'test123' }) })).json();
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([t, u]) => { localStorage.setItem('booth_token', t); localStorage.setItem('booth_user', JSON.stringify(u)); localStorage.setItem('booth_hat', 'FAB'); }, [admin.data.token, admin.data.user]);
  // 先正常打开一次
  await page.goto(BASE + '/du/suppliers', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(800);
  console.log('normal body head:', (await page.evaluate(() => document.body.innerText.slice(0, 150))).replace(/\n/g, '|'));
  // 断网 reload
  await page.route('**/api/booth/**', (r) => r.abort('failed'));
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(2000);
  const t = await page.evaluate(() => document.body.innerText.slice(0, 200));
  console.log('aborted body:', t.replace(/\n/g, '|'));
  console.log('hasRetry:', await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => /重试/.test(b.textContent))));
  await browser.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
