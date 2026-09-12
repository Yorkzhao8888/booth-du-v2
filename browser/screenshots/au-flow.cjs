const { chromium } = require('playwright-core');
const CHROME = require('os').homedir() + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome';
const BASE = 'http://localhost:5000';
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('console', (m) => { if (/error|warn/i.test(m.type())) console.log('[console]', m.text().slice(0, 120)); });
  const r = await fetch(BASE + '/api/booth/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'operator', password: 'test123' }) });
  const j = await r.json();
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([t, u]) => { localStorage.setItem('booth_token', t); localStorage.setItem('booth_user', JSON.stringify(u)); }, [j.data.token, j.data.user]);
  await page.goto(BASE + '/xepz/hats', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1500);
  await page.locator('.ant-card', { hasText: '制作工坊' }).first().click();
  for (const ms of [500, 1500, 3000]) {
    await page.waitForTimeout(ms === 500 ? 500 : 1000);
    console.log('after click +' + ms + 'ms url=' + page.url() + ' h1=' + (await page.evaluate(() => document.querySelector('h1,h2,h4,.ant-typography')?.textContent?.slice(0, 30) || '')));
  }
  await browser.close();
})().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
