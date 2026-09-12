const { chromium } = require('playwright-core');
const CHROME = require('os').homedir() + '/.cache/ms-playwright/chromium-1161/chrome-linux/chrome';
const BASE = 'http://localhost:5000';
const OUT = __dirname + '/after/w1';
const fs = require('fs');
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const admin = await (await fetch(BASE + '/api/booth/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'test123' }) })).json();
  const setup = (p, t, u, hat) => p.evaluate(([x, y, h]) => { localStorage.setItem('booth_token', x); localStorage.setItem('booth_user', JSON.stringify(y)); localStorage.setItem('booth_hat', h || 'FAB'); }, [t, u, hat]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await setup(page, admin.data.token, admin.data.user);

  // 菜单收敛实测: 展开全部 submenu → 数叶子 + 隐藏项断言
  await page.goto(BASE + '/du', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);
  const menu = await page.evaluate(async () => {
    const subs = [...document.querySelectorAll('.ant-menu-submenu-title')];
    for (const s of subs) { s.click(); await new Promise((r) => setTimeout(r, 120)); }
    await new Promise((r) => setTimeout(r, 500));
    const leaves = [...document.querySelectorAll('.ant-menu-item')].map((el) => el.textContent.trim()).filter((t) => t && !/创建|导航/.test(t));
    const labels = [...document.querySelectorAll('.ant-menu-submenu-title,.ant-menu-item-group-title')].map((el) => el.textContent.trim());
    return { leafCount: leaves.length, leaves, groups: labels };
  });
  const hiddenExpect = ['毛利核算', '智能补货', '履约追踪', '订单类型', '角色权限', '实时大屏', '组织架构', 'OEE', '采集', '保养日历', '安灯', '效期', '四仓', '库存预警', '通货市场', '供应铺', '供给报价'];
  const leaked = menu.leaves.filter((l) => hiddenExpect.some((h) => l.includes(h)));
  console.log('收敛后叶子数:', menu.leafCount);
  console.log('分组:', JSON.stringify(menu.groups));
  console.log('隐藏泄漏项:', JSON.stringify(leaked));
  console.log((leaked.length === 0 ? 'PASS' : 'FAIL') + ' A 菜单收敛（隐藏项 0 泄漏）');
  fs.writeFileSync(OUT + '/menu-after.json', JSON.stringify(menu, null, 2));

  // 对比截图（同 before 路径）
  const shots = [
    ['/du', 'dashboard-1280'], ['/du/orders', 'orders-1280'], ['/du/batches', 'batches-1280'],
    ['/du/fab/flow?zone=production', 'flow-1280'], ['/du/station', 'station-1280'],
    ['/du/purchase-orders', 'purchase-1280'], ['/du/work-orders', 'workorders-1280'],
    ['/du/profit', 'profit-redirect-1280'], ['/du/realtime-dashboard', 'realtime-redirect-1280'],
    ['/market', 'market-redirect-1280'], ['/du/inventory', 'inventory-1280'], ['/au', 'au-1280'],
  ];
  for (const [path, name] of shots) {
    await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log('shot', name, '->', page.url().replace(BASE, ''));
  }
  // 375 移动复验（Drawer）
  await page.setViewportSize({ width: 375, height: 812 });
  for (const [path, name] of [['/du', 'dashboard-375'], ['/du/fab/flow', 'flow-375'], ['/du/batches', 'batches-375'], ['/au', 'au-375']]) {
    await page.goto(BASE + path, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(800);
    await page.evaluate(() => { const b = document.querySelector('.ant-layout-header .ant-btn:first-child'); if (b) b.click(); });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log('shot375', name);
  }
  await browser.close();
  console.log('=== after 截图完成');
})().catch((e) => { console.error('FATAL', String(e).slice(0, 200)); process.exit(1); });
