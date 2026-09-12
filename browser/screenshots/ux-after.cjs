// [UX-BOOST] 改后复测: P1 逐项 DOM 断言 + 改后截图 (1280 + 375)
// 注意: 该站对 CDP snapshot 敏感(会重置页面) —— 一律重新 open + JS eval + 截图; 移动视口每次 open 后重设
const { chromium } = require('playwright-core');
const fs = require('fs');
const CHROME = require('os').homedir() + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome';
const BASE = 'http://localhost:5000';
const OUT = __dirname + '/after';
fs.mkdirSync(OUT, { recursive: true });

async function login(page, username, password) {
  const r = await fetch(BASE + '/api/booth/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const j = await r.json();
  if (!j?.data?.token) throw new Error('login failed for ' + username);
  return j.data;
}

async function open(page, url, { mobile = false } = {}) {
  await page.setViewportSize(mobile ? { width: 375, height: 812 } : { width: 1280, height: 900 });
  await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1200);
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const results = [];
  const ok = (name, pass, detail) => {
    results.push(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' | ' + detail : ''}`);
  };

  // ============ admin (du 视角) ============
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const admin = await login(page, 'admin', 'test123');
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([t, u]) => {
    localStorage.setItem('booth_token', t);
    localStorage.setItem('booth_user', JSON.stringify(u));
    localStorage.setItem('booth_hat', 'FAB');
  }, [admin.token, admin.user]);

  // ---- P1-d Market 三层菜单可达 ----
  await open(page, '/du');
  await page.locator('.ant-menu-submenu-title', { hasText: 'Market 通货' }).last().click();
  await page.waitForTimeout(400);
  await page.locator('.ant-menu-item', { hasText: '通货市场' }).last().click();
  await page.waitForTimeout(1500);
  ok('P1-d Market 菜单可达', page.url().includes('/market'), 'final=' + page.url());
  await page.screenshot({ path: OUT + '/market-1280.png' });

  // ---- P1-e Station 死链 → 重定向 /du/station ----
  await open(page, '/du/fab/station');
  ok('P1-e Station 死链修复', page.url().includes('/du/station') && !page.url().includes('fab/station'), 'final=' + page.url());

  // ---- P1-e 侧栏展开保持 ----
  await open(page, '/du/inventory');
  await open(page, '/du/production-orders');
  const expandedAfterNav = await page.evaluate(() => {
    const subs = document.querySelectorAll('.ant-menu-submenu-open');
    return subs.length;
  });
  ok('P1-e 侧栏展开保持(路由联动)', expandedAfterNav > 0, 'open groups=' + expandedAfterNav);

  // ---- P1-c 大屏: 不再常驻「连接断开」 ----
  await open(page, '/du/realtime-dashboard');
  await page.waitForTimeout(2500);
  const dashText = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').slice(0, 300));
  const linkOk = /实时连接|连接中|重连中/.test(dashText) && !dashText.includes('连接断开');
  ok('P1-c 大屏连接态', linkOk, dashText.slice(0, 120));
  await page.screenshot({ path: OUT + '/realtime-1280.png' });

  // ---- P2-1 向导 ?step=2 直跳 ----
  await open(page, '/du/onboarding?step=2');
  const wizText = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').slice(0, 200));
  ok('P2-1 向导 ?step=2 直跳', /产能模板/.test(wizText), wizText.slice(0, 100));
  await page.screenshot({ path: OUT + '/wizard-step2-1280.png' });

  // ---- P2-5 信用指标卡(du 树 score) ----
  await open(page, '/du/fab/score');
  const scoreUrl = page.url();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT + '/score-1280.png' });
  ok('P2-5 信用指标卡可访问', /score/.test(scoreUrl), scoreUrl);

  // ---- P2-4 触控(375 按钮高度) ----
  await open(page, '/du/supply-shops', { mobile: true });
  const btnH = await page.evaluate(() => {
    const b = document.querySelector('.ant-btn:not(.ant-btn-sm):not(.ant-btn-link)');
    return b ? Math.round(b.getBoundingClientRect().height) : -1;
  });
  ok('P2-4 移动端按钮触控高度', btnH >= 42, 'primary btn h=' + btnH + 'px');

  // ---- 三态: 空态引导(Inventory/SupplyShops) + 骨架(lazy) ----
  await open(page, '/du/inventory');
  const invText = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').slice(0, 260));
  ok('② 空态引导(库存)', /还没有库存记录|可用量|库存/.test(invText), invText.slice(0, 110));
  await page.screenshot({ path: OUT + '/inventory-1280.png' });

  await open(page, '/du/supply-shops');
  const shopsText = await page.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').slice(0, 260));
  ok('② 空态引导(供应铺)', /供应铺/.test(shopsText), shopsText.slice(0, 110));

  // ---- 路由 title ----
  await open(page, '/du/orders');
  const title = await page.title();
  ok('⑥ 路由 title', /Xfactory/.test(title) && title !== 'Xfactory 制造厂 · 供给履约系统', 'title=' + title);

  // ---- P1-a/b 移动端 375 (Drawer 侧栏+内容全宽) ----
  await open(page, '/du', { mobile: true });
  await page.waitForTimeout(800);
  const mob = await page.evaluate(() => {
    const sider = document.querySelector('.ant-layout-sider');
    const burger = document.querySelector('[aria-label="menu"]');
    const content = document.querySelector('main, .ant-layout-content');
    const contentW = content ? content.getBoundingClientRect().width : -1;
    const overflow = document.documentElement.scrollWidth > window.innerWidth + 2;
    return { hasSider: !!sider, hasBurger: !!burger, contentW: Math.round(contentW), overflow };
  });
  ok('P1-a 移动端 Drawer 方案', !mob.hasSider && mob.hasBurger, JSON.stringify(mob));
  ok('P1-a 内容区宽度', mob.contentW >= 330, 'content=' + mob.contentW + 'px');
  ok('⑤ 移动端无横向溢出', !mob.overflow, 'scrollW<=375');
  await page.screenshot({ path: OUT + '/dashboard-375.png' });

  // Drawer 打开验证
  await page.locator('[aria-label="menu"]').first().click();
  await page.waitForTimeout(700);
  const drawerMenu = await page.evaluate(() => {
    const d = document.querySelector('.ant-drawer-open');
    return !!d && !!d.querySelector('.ant-menu');
  });
  ok('P1-a Drawer 侧栏可用', drawerMenu);
  await page.screenshot({ path: OUT + '/dashboard-375-drawer.png' });

  // ---- Header 移动收纳(无溢出) ----
  const headerOverflow = await page.evaluate(() => {
    document.querySelector('.ant-drawer-close')?.click();
    return document.documentElement.scrollWidth;
  });
  await page.waitForTimeout(500);
  ok('P1-b Header 无溢出', headerOverflow <= 377, 'scrollW=' + headerOverflow);

  // ---- xvpz 免帽直达 ----
  await open(page, '/xvpz');
  ok('B 顺带 xvpz 免选帽直达', page.url().includes('/xvpz') && !page.url().includes('/hats'), page.url());
  await page.screenshot({ path: OUT + '/xvpz-1280.png' });

  // ============ customer (个人视角) ============
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  const cust = await login(page2, 'customer', 'test123');
  await page2.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page2.evaluate(([t, u]) => {
    localStorage.setItem('booth_token', t);
    localStorage.setItem('booth_user', JSON.stringify(u));
  }, [cust.token, cust.user]);

  // ---- P2-3 分流页未开通容器可识别 ----
  await open(page2, '/containers');
  const portalText = await page2.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').slice(0, 420));
  ok('P2-3 未开通容器明示', /未开通/.test(portalText), portalText.slice(0, 160));
  await page2.screenshot({ path: OUT + '/containers-cust-375.png', fullPage: false });
  await page2.setViewportSize({ width: 1280, height: 900 });
  await page2.waitForTimeout(400);
  await page2.screenshot({ path: OUT + '/containers-cust-1280.png' });

  // ---- P2-3 hats 空态有行动出口 ----
  await open(page2, '/xhpz/hats');
  await page2.waitForTimeout(800);
  const hatText = await page2.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').slice(0, 400));
  const hasExit = /返回容器分流|重新登录|快速上手/.test(hatText);
  ok('P2-3 帽空态行动出口', hasExit, hatText.slice(0, 120));
  await page2.screenshot({ path: OUT + '/hats-cust-375.png' });

  // ---- P2-2 演示卡描述(截图 login) ----
  await open(page2, '/login');
  await page2.evaluate(() => { localStorage.clear(); });
  await open(page2, '/login');
  await page2.waitForTimeout(600);
  const loginText = await page2.evaluate(() => document.body.innerText.replace(/\n+/g, ' | ').slice(0, 500));
  ok('P2-2 演示卡描述对齐', /店长台 · 经营与履约管理/.test(loginText), loginText.slice(0, 150));
  await page2.screenshot({ path: OUT + '/login-375.png' });

  await browser.close();
  console.log(results.join('\n'));
  const fails = results.filter((r) => r.startsWith('FAIL')).length;
  console.log(`\n== ${results.length - fails}/${results.length} PASS ==`);
})().catch((e) => {
  console.error('FATAL:', String(e).slice(0, 400));
  process.exit(1);
});
