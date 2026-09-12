/**
 * UX-BOOST 改前基线截图（8 组 16 张）+ P1-d Market 实测
 * 用法: node browser/screenshots/ux-before.cjs
 * 注意: 不用 CDP snapshot（会重置页面）；每次 goto 后重设视口防 792px 漂移
 */
const { chromium } = require('playwright-core');
const os = require('os');
const path = require('path');
const fs = require('fs');

const CHROME = path.join(os.homedir(), '.cache/ms-playwright/chromium-1161/chrome-linux/chrome');
const BASE = 'http://localhost:5000';
const OUT = path.join(__dirname, '..', '..', 'docs', 'ux_boost_20260912', 'shots');
fs.mkdirSync(OUT, { recursive: true });

async function login(page, username) {
  const r = await fetch(BASE + '/api/booth/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'test123' }) });
  const j = await r.json();
  if (!j?.data?.token) throw new Error('login failed: ' + JSON.stringify(j).slice(0, 200));
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([t, u]) => {
    localStorage.setItem('booth_token', t);
    localStorage.setItem('booth_user', JSON.stringify(u));
  }, [j.data.token, j.data.user]);
  return j.data.user;
}

async function shoot(browser, user, routes) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 220)); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + String(e).slice(0, 220)));
  await login(page, user);
  for (const r of routes) {
    for (const vp of r.viewports) {
      const pg = await ctx.newPage();
      await pg.setViewportSize({ width: vp.w, height: vp.h });
      await pg.goto(BASE + r.path + (r.query || ''), { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
      await pg.waitForTimeout(1400);
      const name = `${r.name}-${vp.tag}`;
      await pg.screenshot({ path: path.join(OUT, `before-${name}.png`) });
      const url = pg.url();
      const text = await pg.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').slice(0, 150));
      console.log(`[before] ${name} | url=${url} | ${text}`);
      await pg.close();
    }
  }
  if (errors.length) console.log(`[console-errors user=${user}]`, errors.slice(0, 6).join(' || '));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const VP_D = { w: 1280, h: 800, tag: '1280' };
  const VP_M = { w: 375, h: 812, tag: '375' };

  // admin（du）组
  await shoot(browser, 'admin', [
    { name: 'dashboard', path: '/du', viewports: [VP_D, VP_M] },
    { name: 'realtime', path: '/du/realtime-dashboard', viewports: [VP_D, VP_M] },
    { name: 'wizard-step2', path: '/du/onboarding', query: '?step=2', viewports: [VP_D, VP_M] },
    { name: 'fab-score', path: '/du/fab/score', viewports: [VP_D] },
    { name: 'fab-station-link', path: '/du/fab/station', viewports: [VP_M] },
    { name: 'market', path: '/market', viewports: [VP_D, VP_M] },
    { name: 'vem', path: '/xvpz', viewports: [VP_D, VP_M] },
  ]);

  // customer（CU→edxx）帽选择空态
  await shoot(browser, 'customer', [
    { name: 'xepz-hats', path: '/xepz/hats', viewports: [VP_M] },
  ]);

  // P1-d 专项实测：admin 点击 Market 通货菜单
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    const errs = [];
    page.on('pageerror', e => errs.push('PAGEERROR: ' + String(e).slice(0, 300)));
    page.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text().slice(0, 300)); });
    await login(page, 'admin');
    await page.goto(BASE + '/du', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const before = page.url();
    await page.locator('.ant-menu li', { hasText: 'Market' }).first().click().catch(e => console.log('click-fail', String(e).slice(0, 120)));
    await page.waitForTimeout(1600);
    const after = page.url();
    const text = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').slice(0, 200));
    console.log(`[P1-d] url: ${before} -> ${after}`);
    console.log(`[P1-d] body: ${text}`);
    console.log(`[P1-d] errors: ${errs.length ? errs.slice(0, 5).join(' || ') : '(none)'}`);
    await ctx.close();
  }

  await browser.close();
  console.log('BEFORE DONE ->', OUT);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
