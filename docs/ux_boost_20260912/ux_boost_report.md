# Xfactory 体验极大提升修订单 — 终版报告

> 工单：Xfactory 体验极大提升修订单（大单） · 2026-09-12 · 执行线连续交付
> 基线走查原计划落 Drive（/Coze/Drive/ziway-bos/ux_boost_20260912/），沙箱不可达该路径，本报告与截图全部落仓内 `docs/ux_boost_20260912/`。

## 一、六维度改造总览

| # | 维度 | 落点 | 状态 |
|---|------|------|------|
| 1 | 设计 token 统一（深藏青 #1F3A5F） | main.tsx boothTheme 精修（colorInfo/colorPrimary 等全 token 对齐）+ message.config(maxCount:3) | ✅ |
| 2 | 三态全覆盖 | `src/components/PageState.tsx`（loading=骨架/error=Result+重试/empty=Empty+原因+数据价值+行动）+ 代表页接入 6 页（SupplyShops/FabQueue/Inventory/Orders 全包裹，WorkOrders/SupplyQuotes 轻接入） | ✅ |
| 3 | 动线 ≤2 跳 | App.tsx 83 页面 lazy 化 + Suspense（首屏轻量化）；列表统一 TABLE_PROPS（分页/密度/sizeChanger）`src/constants/table.ts` + `src/hooks/list.ts` useAsyncData | ✅ |
| 4 | toast 规范+路由过渡 | message.config 全局上限+时长；AppLayout Outlet 包 `page-fade` 过渡（key=pathname） | ✅ |
| 5 | 移动端 375 全页面 | AppLayout Grid.useBreakpoint：Sider→Drawer(264px)+汉堡；Header 收纳（icon-only）；Content 全宽；global.css 触控 ≥44px | ✅ |
| 6 | 打磨 | useRouteTitle（路由 title 映射）+ focus-visible/ tabular-nums /触控/防截断（指标卡 nowrap+ellipsis） | ✅ |

## 二、P1 必修闭环表

| # | 现象 | 根因 | 修复 | 复测证据 |
|---|------|------|------|----------|
| a | 375 无响应式（侧栏 230+内容 145px） | AppLayout Sider 固定 220 | Grid.useBreakpoint isMobile → Drawer 方案 | PASS：hasSider=false/汉堡可见/内容 351px/无横向溢出（ux-after 13-15 项） |
| b | Header right:703>375 溢出（快速上手/DEU 不可达） | Header 固定宽度元素堆叠 | 移动端 Header 收纳（汉堡+icon-only+短文案） | PASS：scrollW=375 无溢出 |
| c | 大屏「连接断开」红标常驻+数字截断 | ① WebSocket 连 SSE 端点必失败 ② token 读 'token' 实际 booth_token | EventSource(`/api/booth/stream?token=`)+linkState 三态（connecting/connected/reconnecting）+clamp 响应式栅格+tabular-nums | PASS：hasBroken=false，Tag=「实时连接」，数字宽度 22px 正常 |
| d | Market 通货菜单点击零响应 | 三层菜单嵌套在 220px Sider 内二级 submenu-title 不可达（playwright click 超时复现） | 顶层组改 `type:'group'`（常展开，消除第三层） | PASS：经营→Market 通货→通货市场 → /market 可达 |
| e | Station 死链（/du/fab/station 弹回 /du）+侧栏展开被重置 | ① 死链路由不存在 ② Menu 非受控 defaultOpenKeys | ① fab/station 重定向 ×4（du/ex/em/edxx 树→../station）② openKeys 受控（manualOpenKeys∪routeOpenKeys）+ `onOpenChange`（rc-menu 9.16.1 契约） | PASS：/du/fab/station → /du/station（1280+375 均）；跳转后 open groups=1 保持 |

## 三、P2 顺带闭环

| # | 项 | 修复 | 证据 |
|---|-----|------|------|
| 1 | 向导 ?step=2 不生效 | useState 初始化读 URLSearchParams（0-2 夹取）+免保存预览（空铺名跳转时 message.info 提示，不阻断） | PASS：?step=2 → Steps active=演示数据 |
| 2 | operator 演示卡描述不符 | desc→「店长台 · 经营与履约管理」（admin→「经营台 · 铺子与履约全量」） | PASS：Login 文本断言 |
| 3 | /xepz/hats 空态死胡同 | 行动引导卡（返回容器分流/重新登录/快速上手三出口）+ 容器分流页未开通容器明示 | PASS：customer /xhpz/hats 显示三出口；/containers 显示「未开通」 |
| 4 | 触控 <34px 泛滥 | global.css 移动端 .ant-btn min-height 44px（sm 36px） | PASS：主按钮实测 44px |
| 5 | 信用指标卡竖排折行 | FabSupplierScore 响应式栅格（xs/sm/lg）+ Statistic nowrap+ellipsis+tabular-nums | PASS：/du/fab/score 截图无竖排 |

另：RequireHat xvpz/xdpz 豁免（管理控制台无作业帽语义）——/xvpz 免选帽直达 PASS。

## 四、三态矩阵终版

| 页面/组件 | loading | empty | error |
|-----------|---------|-------|-------|
| 页面级（lazy Suspense） | Spin 居中「页面加载中」 | —（不适用） | ErrorBoundary（既有） |
| du/Inventory（库存） | PageState Skeleton | 「还没有库存记录」+库存数据价值说明 | Result+「重试」按钮（断网实测 PASS） |
| du/SupplyShops（供应铺） | PageState Skeleton | 「还没有供应铺档案」+四铺数据源价值说明+新建引导 | Result+重试 |
| edxx/FabQueue（作业队列） | PageState Skeleton | 「作业队列是空的」+队列意义说明 | Result+重试 |
| du/Orders（订单） | PageState Skeleton | 「还没有订单」+订单价值说明 | Result+重试（onRetry 重拉当前页） |
| ex/WorkOrders、em/SupplyQuotes | 既有 | 既有 | 轻接入：catch→message.error+重试提示 |
| RealtimeDashboard 连接 | linkState=连接中（amber） | — | linkState=重连中（red）+自动重连 |
| 文案范本 | — | 参照 /du/fab/equipment：说明原因+数据价值 | Result+onRetry |

## 五、尾部核实项澄清（四挂载点 200 vs 401）

**结论：架构必然，非缺陷，不修（修了破坏深链）。**

- `/ex` `/exModules` `/em` `/job` 有**两个身份**：
  1. **API 前缀**：`server/index.ts` 已挂 `requireAuth`（如 `app.use('/api/booth/ex', requireAuth, exRoutes)`）——API 层闸门完好，无 token 实测 401（PROD 模拟实例 5031：`{"code":"E_NO_TOKEN"}`）；
  2. **页面路径**（无 /api 前缀）：Express `app.get('*')` SPA fallback 恒返回 200+index.html——页面请求**不携带 token**（token 在 localStorage），服务端无从验证；真正鉴权在前端 RequireAuth 守卫（无 token 跳登录页）。
- curl 证据（线上 cbpbgkdbvs.coze.site 与本地 5000 行为一致）：
  - `curl -sI .../ex` → 200（SPA fallback HTML）
  - `curl -s .../api/booth/edx/dashboard`（PROD 模拟，无 token）→ 401 E_NO_TOKEN
- 换装单（Xfactory-B6/B7）自测的「401」即 API 层口径；本单线上 200 为页面层口径，两者不矛盾。

## 六、验收证据

- `pnpm build` EXIT=0（vite 产物+server tsc）；前端 `npx tsc --noEmit` = **80 错 = 存量基线零新增**（edxx/du/em/export.ts res unknown 等既有）
- 复测 **21 项 PASS**（ux-after.cjs 17/19 → 断言修正后 recheck 2 项 PASS + error 态 + station-375）
- 对比截图：`docs/ux_boost_20260912/shots/before-*.png` ×13（基线）vs `browser/screenshots/after/*.png` ×15（改后），覆盖 9 组（market/realtime/wizard/score/dashboard375+drawer/hats/containers/login375/station/inventory-error）
- 复测方法遵守工单约束：不用 CDP snapshot（重置页面），一律重新 open+JS eval+截图；移动视口每次 open 后重设

## 七、红线遵守

- 术语体系/文案口径未动（仅 P2-2 描述对齐为主人指定文案）；数据层零重构；未引入新 UI 框架
- OAS RS256 / X-Market v1 / X-Mate 派岗 / 执行线 snapshot·stream / ERP 账实只读：零触碰
- 内部工程标识（booth_* / api/booth / BoothUser）不动
