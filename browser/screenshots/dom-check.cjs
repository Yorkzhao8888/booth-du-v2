/* [Xfactory-BRAND] 运行时 DOM 文案验证: 用户可见文本零 Booth 残留 */
const { chromium } = require('playwright-core');

(async () => {
  const exec = '/root/.cache/ms-playwright/chromium-1161/chrome-linux/chrome';
  const base = process.env.BASE_URL || 'http://localhost:5000';
  const browser = await chromium.launch({ executablePath: exec, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();

  const check = async (path, name) => {
    await page.goto(`${base}${path}`, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(600);
    const text = await page.evaluate(() => document.body.innerText || '');
    const hasXf = /Xfactory/.test(text);
    const boothHits = (text.match(/Booth/g) || []).length;
    const lines = text.split('\n').filter((l) => /Booth/.test(l)).slice(0, 5);
    console.log(`[${name}] path=${path} Xfactory=${hasXf ? 'YES' : 'NO'} Booth残留=${boothHits}${lines.length ? '\n  -> ' + lines.join('\n  -> ') : ''}`);
    return boothHits;
  };

  let total = 0;
  total += await check('/login', '登录页');
  // 登录态后访问工作台/门户页
  const resp = await fetch(`${base}/api/booth/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: 'admin', password: 'test123' }) });
  const j = await resp.json();
  await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([t, u]) => { localStorage.setItem('booth_token', t); localStorage.setItem('booth_user', JSON.stringify(u)); }, [j.data.token, j.data.user]);
  total += await check('/du', '工作台');
  total += await check('/containers', '容器分流');
  total += await check('/xepz/hats', '帽选择');

  console.log(`\n=== 运行时 Booth 文本残留总计: ${total} ===`);
  await browser.close();
  process.exit(total === 0 ? 0 : 2);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
