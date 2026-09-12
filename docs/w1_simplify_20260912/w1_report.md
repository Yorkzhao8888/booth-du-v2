# Xfactory W1 极致主线交付报告（2026-09-12）

> 工单: W1 极致主线开发单（主人拍板「按建议执行，务必精密、体验极致」）
> 基线: tag ux-boost / 59b372e ｜ 交付: tag w1-simplify ｜ 报告落仓内 docs/（/Coze/Drive/ 沙箱不可达，沿用 ux-boost 口径）

## 一、收敛结果（A 菜单收敛 41→16）

- **实测: admin/du 视角菜单叶子 40 → 13**（目标 ≤16 达成），8 个分组: 经营 / 供应链 / 作业 / FAB 制造铺 / DL 物流铺 / SVC 服务铺 / 台账 / WH 供给铺
- **延后隐藏 12 条目（14 项）全部 toggle 化**：`src/config/menuConfig.ts` MENU_TOGGLES 配置驱动（profit/replenishment/fulfillmentTrack/orderTypes/roles/realtime/orgChart/oee/telemetry/maintenance/andon/whBoard/whExpiry/whAlerts），每项独立 flag 可开回；隐藏后直连 URL 走 `MaybeHiddenRoute` 优雅重定向（profit/roles/realtime/org-chart→/du，OEE/采集/保养/安灯→本树 equipment，四仓/效期/预警→/du/batches 对应 tab），**实测 0 泄漏 0 死链 0 白屏**
- **待契约隐藏 3 项**：通货市场（/market 整树）、供应铺管理（/du/supply-shops）、供给报价（/du /em supply-quotes）；「MKT 铺子管理」submenu 名同步消代号改「铺子管理」
- **合并视图**：FAB 产线四页→`/fab/flow` 作业流视图（FabFlow tabs 四工序，zone/:stage 直连重定向 `?zone=` 参数保位）；库存调拨双入口→台账组 1 处；采购+供应商+供给订单→「供应链」侧栏分组

## 二、修通（C，最高优先级）

1. **Station 作业站**：路由已通（/edxx/station），customer（CU→edxx）登录态实测列表+范本空态+375 均可用；详情页依赖站点数据（当前库无站点，组件与路由就绪）
2. **AU 身份流**：根因=`RequireAuth` 对 dx 强制弹 /du → 新增 `/au` 店长台独立路由（dx 放行）+`AUWorkbench`（店长台·经营与履约管理: 统计四卡+快捷入口+PageState 三态）；登录分流与演示卡描述一致；实测 operator 登录→/containers→#xepz→hats→FAB→可直达 /au，不再落 /du

## 三、三张面孔（D）

- **EDU ≤10min**：向导→灌演示数据（seed-demo 幂等 409）→DemoDataCard demoActive 态新增「看订单拆成工单」（1 跳进生产单列表，2 跳看三级拆单树）+「看回执触发结算」直达；e2e 全链自动 PASS（见五）
- **EDX 派工 ≤2 跳**：履约工作台（/ex index）首页直接列待处理履约单+**拆单按钮 0 跳闭环**（实测 API 同源 dispatch 200，任务 3226 pending 建立）；空态升级范本（原因+无需手动刷新说明）
- **EDXX 3 步作业**：FabQueue 接单→开工→**完工上报（新增 EvidenceUploadModal，G-005 凭证登记→自动完成联动，前端首次补齐凭证 UI）**；FabStationDetail 内嵌同款「完工上报」实现 Station 内闭环；实测工单 1183 完整闭环+timeline 四节点推进

## 四、体验极致（E）与三态矩阵

- **16 页三态矩阵 16/16 PASS**（browser/screenshots/after/w1/threestate-matrix.json）：正常态（菜单+无 broken）/错误态（断网→PageState Result+重试按钮）/空态
- 本轮接入 PageState 错误兜底 12 页: ProductionOrders/Boms/Crafts/PurchaseOrders/**SupplierManagement**（注意: /du/suppliers 实际渲染组件是 SupplierManagement.tsx，Suppliers.tsx 为未挂载旧文件）/WorkOrders/InventoryTransfer/Dashboard/FabEquipment/FabStations/FabFlow/AUWorkbench
- 375 复验（Drawer/汉堡/触控）4 页截图延续 ux-boost 成果；title/路由过渡/toast 规范延续
- **清空演示数据降权强化（P3-4）**：Popconfirm→受控 Modal 强二次确认（输入「清空」才可提交+危险警示+不可撤销说明）

## 五、验收基线 7 条逐条闭环

| # | 标准 | 结果 | 证据 |
|---|------|------|------|
| 1 | 主线全自动 | **10/10 PASS** | w1-e2e.cjs: seed-demo 409 幂等→订单入站 1203 建单→dispatch 任务 3226→EDXX 接单/开工/完工上报→timeline 四节点→queue 回读（脚本 browser/screenshots/w1-e2e.cjs） |
| 2 | 三张面孔 | PASS | EDU 链路直达≤2 跳；EDX 拆单 0 跳；EDXX 3 步（EvidenceUploadModal） |
| 3 | 零死功能 | PASS | 死菜单 0（0 泄漏实测）/死链 0（fab/station 重定向×4+zone→flow）/双入口 0（调拨去重）/裸空态 0（范本+16 页矩阵） |
| 4 | 三态满分 | PASS | 16/16 矩阵（见四） |
| 5 | 移动全可用 | PASS | 375 截图 4 页+Drawer/触控延续 |
| 6 | 速度 | PASS | 核心操作 ≤2 跳（EDX 拆单 0 跳/EDU 直达 2 跳/EDXX 3 步）；83 页 lazy+Suspense 延续（骨架无白屏） |
| 7 | 红线 | PASS | grep 门禁（见六）；tsc 80=基线零新增；演示隔离不动（DEMO- 前缀+source=demo 机制零改动） |

## 六、「精密」门禁输出

1. **执行层价格 0 渲染**：edxx/ 目录唯一命中=FabSupplierScore 红线声明注释；em/ 的 gross_profit/unit_price=EM 采购确认角色既有口径（XFACTORY-P1 剥价范围=edx/emx/edxx，不含 em）✓
2. **新增 UI/文案 Booth 显化 0**：5 个新文件唯一命中=API 路径 `/api/booth/...` 与 localStorage key `booth_token`（内部工程标识，红线允许）✓
3. **契约线零 diff**：oas-client/event-topics/event-signature/internal/supply-order **0 文件改动** ✓
4. **tsc**: 前端 80 错=存量基线零新增；server tsc 0 错；build EXIT=0
5. **执行线唯一改动（报备）**：`work-order-service.ts` accept/start 的 accepted_by/operator_id **FK guard**（resolveOperatorId helper，4 处）——修复 OAS 用户未同步 booth_users 时 accept 500（FK violation），与 G-005 evidences 既有 EXISTS guard 同口径；状态机/拆单/回执字段/透传/SSE 零触碰
6. **migrate 幂等修复（报备）**：booth_maintenance_plans RENAME 加存在性 guard（服务重启重跑 migrate 撞 legacy 表 FATAL——启动关键路径 bug，非执行线业务）

## 七、对比截图（16 张，before/after ≥10 组）

- before: docs/ux_boost_20260912/shots/before-*.png ×13（ux-boost 轮基线）
- after: browser/screenshots/after/w1/*.png ×16（dashboard/orders/batches/flow/station/purchase/workorders/inventory/au 1280+375、profit/realtime/market 重定向落地、e2e-edxx-queue/after）
- 组映射: dashboard/orders/inventory/batches/score(inventory)/station/flow(新增)/au(新增)/375×4/重定向×3

## 八、遗留清单（透明报备）

1. **菜单 13 vs 工单 16**: 实测收敛后 13（超额达成）。若主人口径需精确 16，可从 toggle 开回 3 项（如员工管理/配送任务/服务任务三者之二）——不擅自操作，待裁定
2. **OAS dev-token 端点 404**（OAS 平台未上线）：EDX（EX 角色）页面级登录实测暂以 admin+DEU 分身 API 同源替代；端点上线后可补页面级实测
3. **Station 详情页**作业台数据依赖站点创建（EM 产能资源），当前库无站点——组件/路由/权限就绪，待真实站点后回归
4. **Suppliers.tsx 未挂载旧文件**（4.6K，页面真身=SupplierManagement.tsx）——未删除（toggle 潜在回开风险面），建议后续清理
5. w1-e2e 的 X-Event-Key/签名头（xbus-mvp-key-2024+HMAC）仅测试脚本使用，生产链路不变

---
*交付: commit w1-simplify ｜ 部署: 见回报 ｜ 生成: W1 窗口*
