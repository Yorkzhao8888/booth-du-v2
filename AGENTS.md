# AGENTS.md — Booth-DU v4.0 经营版

## 项目概览
Booth-DU 铺子供给执行系统（经营版），单包全栈架构。

## 技术栈
- **前端**: React 18 + TypeScript + Vite 6 + Ant Design 5 + Zustand 5
- **后端**: Express 4 + TypeScript + pg (PostgreSQL)
- **构建**: `vite build` (前端) + `tsc -p tsconfig.server.json` (后端)

## 角色体系
| 角色 | 代号 | 说明 | 价格可见 | 路由前缀 |
|------|------|------|----------|----------|
| 店主 | du | 经营看板、订单、工单、库存、BOM | ✅ 全可见 | /du |
| 店长 | dx | 与 du 相同视图 | ✅ 全可见 | /du |
| 交付长 | edx | 工作台、拆单、BOM/SKU 管理 | ❌ 无价格 | /edx |
| 铺员 | edxx | FAB 制作 + WH 仓储（帽子权限） | ❌ 无价格 | /edxx |

## 测试账号
| 手机号 | 密码 | 角色 | 姓名 |
|--------|------|------|------|
| 13800000001 | 123456 | du | 店主 |
| 13800000004 | 123456 | dx | 店长 |
| 13800000002 | 123456 | edx | 交付长 |
| 13800000003 | 123456 | edxx | 铺员 (FAB+WH) |

## 构建命令
```bash
pnpm install
pnpm build        # vite build && tsc -p tsconfig.server.json
pnpm start        # node dist/server/index.js
```

## 目录结构
```
server/
  index.ts          # Express 入口 (rawBody 捕获 + 启动 fail-closed FATAL)
  auth.ts           # 认证中间件 ([R7-01] 仅 OAS RS256 验签, fail-closed 503)
  db.ts             # PostgreSQL 连接池
  migrate.ts        # DDL + 种子数据 + 角色迁移 (+ [R7] booth_event_dlq / last_error)
  sse.ts            # SSE 实时推送
  routes/
    auth.ts         # 登录 ([R7-01] 纯 OAS 代理) + oas-status
    du.ts           # 经营看板 (du+dx)
    edx.ts          # 交付工作台 (edx)
    edxx.ts          # 执行端 FAB/WH (edxx)
    internal.ts     # 内部事件接收 ([R7-DEF] 签名验证 + DLQ + 主题规范化)
    supply-order.ts # [PK-02] 契约 quote/confirm/settle ([R7-03] 审计+GMBS)
  services/
    oas-client.ts       # [R7-01] OAS AMS 客户端 (RS256 验签/角色映射/成本剥离)
    event-topics.ts     # [R7-02] cmd.<domain>.<action>.v1 主题常量
    audit-service.ts    # [R7-03] emitAudit 五要素 + GMBS
    event-signature.ts  # [R7-DEF] HMAC-SHA256 签名/验签
    fulfillment-service.ts  # 履约/拆单
    inventory-service.ts    # 库存事务
    work-order-service.ts   # 工单状态机
    outbox-service.ts       # Outbox 异步投递 (三目标路由 + 出站签名)
docs/
  event-contract-registry.md  # [R7-02] 事件契约登记表
scripts/
  dev-r7-migrate.cjs / rollback.cjs  # [R7] 迁移可逆脚本
src/
  App.tsx           # 路由 + 守卫
  api.ts            # API 请求封装
  store.ts          # Zustand 状态
  pages/
    du/             # 店主/店长页面
    edx/            # 交付长页面
    edxx/           # 铺员页面
  components/
    AppLayout.tsx   # 桌面端布局
    MobileLayout.tsx # 移动端布局
    SSEListener.tsx # SSE 事件监听
```

## API 路径
- `/api/booth/auth/login` — 登录（[R7-01] 纯 OAS AMS 代理透传，无本地签发）
- `/api/booth/auth/oas-status` — OAS 配置状态（authReady/failClosed/signing）
- `/api/booth/du/*` — 经营端 (du+dx)
- `/api/booth/edx/*` — 交付端 (edx)
- `/api/booth/edxx/*` — 执行端 (edxx)
- `/api/booth/supply-orders/*` — [PK-02] SupplyOrder 显式契约（quote/confirm/settle 带审计+GMBS）
- `/api/booth/internal/events/*` — 内部事件
- `/api/booth/stream` — SSE 实时推送
- `/api/booth/health` — 健康检查
- `/events/*` — [LINK-01] 内部事件根级别名（与 `/api/booth/internal/events/*` 等价，Shop XBUS 直调）
- `PUT /api/booth/job/stations/:id/plaz-mapping` — [LINK-01 任务B] Booth↔X-Dyard(Plaz) 站位映射绑定/解绑（du/ex/dx）
- `/api/booth/crafts` — [PRD-003 RD-005] 工艺管理 CRUD（du/dx/edx；前端 /du/crafts 与 /ex/crafts）
- `POST /api/booth/edxx/fab/work-orders/:id/evidences` — [PRD-003 G-005] 凭证上传→工单自动完成联动（FAB 帽）

## 订单族编码同步（ORDER-T，2026-09-05 定义 LOCKED）
六订单族统一编码：Order-C 对客经营 / Order-D 履约经营 / Order-Y 智场工程 / Order-H 人事伙伴 / Order-E 通货供给 / Order-T 技研支撑（技术订单已由 Order-D 重名修正为 **Order-T**，D 仅指履约）。
- **落点约定**：订单模型实施时预留 `order_family` 字段（枚举 C/D/Y/H/E/T），随订单模块迭代落地，验收=订单能正确标注归属族
- **Booth 归属预判**：`booth_fulfillments` 供给契约（Shop 供货履约）→ **Order-E 通货供给**；FAB/WH 内部工单为执行单，若构成对外技术支撑订单 → **Order-T**（实施时判定）；禁止再用 Order-D 表示技术订单

## 开发期认证开关（OAS-OPEN-DEV-01）
- **开关**：环境变量 `OAS_AUTH_ENABLED`——未配置/任何非 `false` 值 = **认证启用**（安全默认，漏配不裸奔）；仅显式 `OAS_AUTH_ENABLED=false` 时关闭
- **关闭态行为**：`requireAuth`/`requireRole`/`requireHat` 全部放行；无有效 token 的请求挂 `buildAnonymousUser()`（du 角色+全帽+orgMode='du'，`source:'oas'` 等价店主视图），带合法 OAS token 仍挂真实 user；fail-closed(503) 同步跳过
- **前端**：`App.tsx` RequireAuth 守卫无 token 时探测 `GET /api/booth/auth/oas-status`——`authOpen:true` 则以返回的 `anonymousUser` 建立匿名会话（token 哨兵 `dev-open`）进入页面；`authOpen:false` 跳登录页
- **恢复（内测）**：部署 env 移除 `OAS_AUTH_ENABLED=false`（或改 true）并重启即恢复 RS256 认证，前端匿名入口自动消失，零代码改动
- **PROD fail-safe [BOOTH-SEC-01]**：`COZE_PROJECT_ENV=PROD` 时 **AUTH_OPEN 无条件为 false**——部署 env 即使误带 `OAS_AUTH_ENABLED=false` 也强制 RS256 认证（部署侧漏配不裸奔，无需改 env 即可复验 401）；DEV 沙箱匿名预览不受影响
- **不受影响**：dev-token PROD 404 红线、`/events/*` 事件签名验签、SSE/health
- **SSE query token [BOOTH-SEC-01]**：EventSource 无法自定义 header——`server/routes/fulfillment.ts` `sseTokenBridge` 中间件将 `?token=` 透传至 Authorization Bearer 后统一走 requireAuth 验签（无效 token 401 不建立流）；前端 FulfillmentTimeline 已带 query token

## 铺面管理与权限（BOOTH-PRD-002，阶段一 P0）
- **四铺枚举（裁定）**：研发(rd)/制造(manufacture)/配送(delivery)/供给(supply)；供应铺表 `booth_supply_shops`（UNIQUE(org,shop_type,shop_name)+capabilities JSONB 为 PM-008 能力展示数据源，GET /:id/capabilities）
- **订单类型字典**：`booth_order_types`（type_code/type_name/default_target_shop_type/enabled，MVP 三类 outsource外发→supply / self_made自制→manufacture / rd_dev研发→rd）；BDD-01 类型驱动派发：dispatch 缺省 tasks 时按字典映射建主铺任务；`booth_production_orders.order_type` 列随单透传
- **角色口径（修正）**：链 dm→du→dx→ex(EDX 店-铺长)→edxx(EDXX 铺员)；**DEU=DU 履约铺分身**（非独立角色）：请求头 `X-Acting-As: deu` 且 roleKey=du 时挂 actingAs，requireRole('ex') 调用点放行（auth.ts），前端 DU 用户 Header「进入履约铺后台」切换（localStorage booth-acting-deu + api.ts 全链路带 X-Acting-As）
- **价格红线（BDD-17）**：M 层(dm/du)+X 层管理(dx) 可见价格；X 层执行（ex/edxx/emxx）不可见任何售价——`stripSalePriceFields`（oas-client，SALE_PRICE_FIELDS+COST_FIELDS 递归剥离）+ `stripXExecutorPrices` 中间件（index.ts 挂 /api/booth/ex、/api/booth/edxx 全部路由，DEU 分身豁免）+ 前端 store canSeeSalePrice=['du','dx','dm']（emxx 已移出）；EDX 建单价格硬编码 0（ex.ts 既有）；edxx 路由价格零输出
- **RBAC API**：GET /api/booth/rbac/roles（角色链+价格矩阵+DEU 说明）、GET /api/booth/rbac/me（roleKey/isDeuShadow/priceVisible/xExecutorStripped/menuScope）
- **G-006 三级状态筛选**：GET /api/booth/production-orders?status=&taskStatus=&workOrderStatus=（EXISTS 子查询）
- **前端**：/du/supply-shops（PM-001）、/du/order-types（PM-002）、/du/roles（PM-004 矩阵）+ ProductionOrders 增强（类型列+三级筛选）

## 四铺拆单闭环（BOOTH-PRD-003，阶段一 P0 核心）
- **主链路**：订单下发 → 四铺拆单（split-service 按任务铺型路由）→ 工单执行 → 完成回传（packed.v1+三级聚合），承接 PRD-001 生产单实体与 G-007 状态机
- **四铺规则（BDD-02/09/10）**：`server/services/split-service.ts`
  - **研发铺 RD-001**：菜品匹配 `booth_crafts`（org+product_name+enabled）→ N 工序=N 工单（steps JSONB 按 seq 升序，step_name=工序名）；无匹配工艺回退单工序「通用研发」
  - **制造铺 MF-001/002/007**：双来源（split_source=self_made/outsource）、同工序多菜品合并一张工单（product_name='菜B×1、菜C×2'、qty=Σ）、不设工序链
  - **配送铺 DL-001**：items[].point（缺省'默认点'）分组 × 分拣/配送两维度（dimension=sorting/delivery，step_name=分拣/配送）→ 每点 2 工单
  - **供给铺 SP-001/002**：简化拆单一任务一工单 + 拆单即登记出库单骨架（`booth_stock_docs` doc_type=outbound，P2 边界仅登记不开发流）
- **工单挂接**：`booth_work_orders` 新列 production_task_id（反挂多工单）/split_source/step_name/dimension；任务溯源快列 work_order_no=首张工单号；工单号 PROD-yyyyMMdd-NNNN 与 IMPL-001 同序列
- **G-005 凭证联动（BDD-07）**：`booth_work_order_evidences` 表 + `POST /api/booth/edxx/fab/work-orders/:id/evidences`（FAB 帽）→ 凭证入库后轻量推进 pending→preparing → `completeWorkOrder` 走完整回传链（completed+packed.v1+聚合刷新），**无需人工二次确认**；operator_id 带 EXISTS guard（匿名 userId=0 不写 FK）
- **完成回传（BDD-11/BDD-05）**：completeWorkOrder 双链路——fulfillment_id（IMPL-001 口径不变）/production_task_id（productionNo=生产单真实 production_no，dxCaseNo=dx_case_no||shop_order_id，waveNo 透传）+ workOrderId/workOrderNo/stepName/packedAt；COMMIT 后自动 `refreshAggregation`（工单→任务→生产单）
- **dispatch 增强**：POST /api/booth/production-orders/:id/dispatch 默认 autoSplit=true（新建任务按铺型规则自动拆单；重放幂等——任务 skipped 不重复拆）；详情 GET /:id 返回 workOrdersByTask 三级链路树
- **工艺管理 API**：/api/booth/crafts CRUD（GET 列表/POST 创建/PUT /:id/DELETE /:id 停用），角色 du/dx/edx；/du/crafts 与 /ex/crafts 双路由（EDX 工艺管理菜单）
- **前端**：/du/crafts（/ex/crafts）工艺管理（工序步骤编辑）；ProductionOrders 详情 Drawer 三级链路（订单→任务→工单树+凭证上传入口）
- **幂等三层**：dispatch 任务级幂等 → splitTaskToWorkOrders 任务已有工单跳过 → 工单号当日序列唯一索引兜底

## 统一登录与事件契约（BOOTH-R7）
- **统一登录 [R7-01]**：Booth 仅信任 OAS AMS 签发的 RS256 JWT（iss=ziway-oas）。公钥来源两级：`OAS_PUBLIC_KEY`（SPKI PEM，支持 \n 转义）**显式配置优先**；未配置时启动自动从 `${OAS_BASE_URL}/.well-known/jwks.json` **JWKS 发现**（日志 `[AUTH] OAS public key discovered via JWKS`）。两者皆无 → **fail-closed**：启动 FATAL 日志 + 所有需登录接口 503 `AUTH_NOT_READY`（health 不受影响）。legacy 本地账号/jwt 自签/test-mode 全部移除，138 本地测试账号不可用（OAS AMS 未同步），验收口径为 OAS 五角色 admin/operator/customer/viewer/em × test123，映射 SU→du / AU→dx / CU→edxx / GU→emxx / EM→em，edxx 依赖角色默认帽子（CU→[FAB]）。登录返回 user 含 orgMode（du 价格可见性依赖）
- **DEV 临时令牌 [AUTH-02]**：`POST /api/booth/auth/dev-token`（`COZE_PROJECT_ENV=PROD` 时 404）→ 代理 OAS `POST /api/v1/auth/dev-token`（body: username?/role?/expires_minutes?，默认 30min 上限 60）→ **生成立即本地 RS256 验签 + toBoothUser 角色映射** → 返回 `{token, user, expires_at, oas}`。前端 Login 页 DEV-only 入口（`import.meta.env.DEV`，生产构建 tree-shake 移除），生成成功写入本地登录态免复制。Booth 侧不自行实现签发逻辑。OAS 平台=62j75kfyn3.coze.site（`OAS_BASE_URL` 部署配置需同步）
- **事件契约 [R7-02]**：主题统一 `cmd.<domain>.<action>.v1`（常量见 `server/services/event-topics.ts`），登记表 `docs/event-contract-registry.md`；入站 Shop 事件规范化为 `cmd.shop.order.confirmed.v1` / `cmd.shop.order.cancelled.v1`
- **审计埋点 [R7-03]**：`emitAudit()`（audit-service.ts）五要素 actor/action/resource+resourceId/occurred_at/result + GMBS 标记（资金类操作 flag+category+amount），写入 outbox `cmd.booth.audit.log.v1` 投递至 `OAS_AUDIT_URL`
- **签名 [R7-DEF]**：出站消息统一附 `X-Event-Signature: sha256=HMAC(body)`（密钥 `OAS_EVENT_SIGNING_KEY`）；入站配置该密钥后强制验签（timingSafeEqual），失败 401 并写入死信表 `booth_event_dlq`；未配置为兼容期（signing=disabled 放行）
- **迁移**：`booth_event_dlq` 表 + `booth_outbox.last_error` 列（migrate.ts [BOOTH-R7] 块，可逆脚本 scripts/dev-r7-migrate.cjs / rollback.cjs）
- **curl 注意**：入站签名验签对原始字节敏感，测试时用 `--data-binary @file`（`-d` 会剥离尾换行导致 mismatch）

## 跨 APP 事件链路（BOOTH-LINK-01）
- **入站**：`POST /events/order-confirmed`（X-Event-Key 头 + eventId 幂等）→ 自动创建 supply-order 契约（booth_fulfillments, contract_status=Created, source=mall）→ outbox 回写 `cmd.booth.supply_order.created.v1`（Shop 将 `boothWorkOrderId` 写回订单）；取消事件同步回写 `cmd.booth.supply_order.cancelled.v1`
- **幂等三层**：booth_event_log(event_id) → shop_order_id 查重（skipped）→ 唯一索引 idx_fulfillments_org_shop_order
- **Mate 派单**（任务C）：供给单创建即写 outbox `cmd.booth.mate.dispatch.v1`，契约 payload：sourceOrderNo/description/expectedAt/reward/assigneeRole=HU；poller 投递至 `MATE_DISPATCH_URL`，成功回写 mate_dispatch_status=dispatched，终败=failed（outbox 重试 10 次后 dead + last_error 留痕）
- **环境变量**：`MATE_DISPATCH_URL`（Mate 接收端点）、`SHOP_CALLBACK_URL`（Shop 回写端点，既有）、`OAS_AUDIT_URL`（审计上报，[R7-03] 新增）；outbox 按 event_type 路由（含 `.mate.` → Mate / 含 `.audit.` → OAS，带服务账号登录态，401 自动重登一次 / 其余 → Shop），未配置的类别保留 pending 不阻塞

## Shop 生产单回执（SHOP-CONT-BOOTH，2026-09-08 发布）
- **issued**：供给单 dispatch 拆单（Confirmed→Planning）时点 emit `cmd.booth.prod_order.issued.v1`（Shop 侧 `PO_ISSUED`），落点 `work-order-service.ts` 拆单事务 COMMIT 前
- **packed**：FAB 工单完成（completeWorkOrder）时点 emit `cmd.booth.prod_order.packed.v1`（Shop 侧 `PROD_PACKED`）
- **payload 最小集**：productionNo / dxCaseNo（原样回传=shop_order_id）/ waveNo（透传不解析不生成，未传为 null）/ productRefs；扩展 supplyOrderId/issuedAt|packedAt/state
- **工单号**：`booth_work_orders.work_order_no` = `PROD-<yyyyMMdd>-<NNNN>`（事务内按日计数生成），部分唯一索引 `idx_work_orders_work_order_no`（NULL 不约束历史行）
- **波次**：`booth_fulfillments.wave_no` 入站建单透传落库，出站原样回传
- **幂等**：拆单/完成复用既有状态机（重复 complete 400 INVALID_STATE、重复 dispatch 不重复拆单）；Shop 按 productionNo 幂等
- **迁移**：老库增量跑 `scripts/dev-shop-cont-migrate.cjs`（回滚 `dev-shop-cont-rollback.cjs`）；migrate 主流程 DDL 块已同步（含 booth_stations 补列 type/capacity、booth_equipment 补列 station_id 三处历史存量修复）

## Xfactory(Booth-DE 供给版) P1（XFACTORY-P1，2026-09-10）
- **执行帽 v1.2 命名**：DEX→**EDX**、EXX→**EDXX**（业务执行线）、DXX→**EMXX**（运营线）、新增 **EMX**（运营线采购确认）；旧 D*X 系（DYX/DHX/DTX/DEX/DCX/DEXX/DXX）全量废弃 0 引用；OAS 五角色映射 SU→du/AU→dx/CU→edxx/GU→emxx/EM→em（OAS 平台角色名键不变仅映射值改）；`isXExecutor=['ex','edx','edxx','emx','emxx']` 执行线全量剥价（stripXExecutorPrices 挂 /api/booth/edx /emx /edxx）
- **新表**（migrate.ts [XFACTORY-P1] 块 + scripts/dev-xfactory-migrate.cjs / rollback.cjs）：`booth_supply_purchases`（event_id UNIQUE 幂等 + supply_purchase_no UNIQUE + wave_no + items JSONB + confirmed_by/at + production_order_id）、`booth_delivery_receipts`（receipt_no UNIQUE + production_order_id 可 NULL（存量 backfill 无 PO 实体）+ source SUPPLY/MARKET + evidence_nos JSONB + receiver_type DDU/XU + confirm_event_id UNIQUE + confirmed_by；UNIQUE(org,production_order_id) 一单一回执）、booth_production_orders 加 source/order_family 列
- **组合 1 供给主线**：`POST /events/supply-purchase`（X-Supply 入站，event_id 幂等，缺 waveNo 400）→ EMX 页可见（GET /api/booth/emx/purchase-requests）→ `POST /:id/confirm`（confirmSupplyPurchase 事务：建 PO(source=SUPPLY,order_family='T')→manufacture 任务→四铺拆单）→ 作业 G-005 凭证自动完成 → **完工入库**（completeWorkOrder 聚合后 hook：booth_stock_docs inbound + outbox `cmd.booth.stock.inbound.v1` → ERP，F4=outbox 重试）→ `POST /api/booth/edx/production-orders/:id/delivery-receipt` 交付 DDU 回执（productionNo+qty+G-005 凭证号+deliveredBy=EDX+receiver DDU，生成即责任转移）
- **组合 2 市场链路**：`POST /events/market-demand`（X-Market 入站，shop_order_id 幂等）→ 直接建单(source=MARKET)+拆单 → 交付 XU 回执（payload source=MARKET）→ `POST /events/receipt-confirmed`（confirm_event_id 幂等）confirmed 闭环
- **outbox 三渠扩展**（outbox-service.ts）：`.stock.`→ERP_CALLBACK_URL、`.receipt.`+payload source=MARKET→XMARKET_CALLBACK_URL、source=SUPPLY→DDU_CALLBACK_URL；未配置类别保留 pending 不阻塞
- **F1/F2/F3**：F1 入站失败→booth_event_dlq（internal.ts recordInboundDlq）+400；F2 回写失败→outbox 重试 10 次 dead+last_error；F3 交付失败→`POST /api/booth/edx/delivery-receipts/:receiptNo/resend` 重发+审计
- **响应映射**：xfactory-service.ts 全部出口 mapXxx snake→camel（幂等分支同样映射）
- **存量 1139 补发**：scripts/backfill-delivery-receipts.cjs（--limit/--dry-run；production_no 回退 COALESCE(work_order_no, shop_order_id)——存量 fulfillments 无 work_order_no 为 SHOP-CONT-BOOTH 前历史行）；已完成全量补发 1108 条 MARKET/XU 回执（outbox pending 待 XMARKET_CALLBACK_URL 配置后投递）
- **环境变量新增**：ERP_CALLBACK_URL / XMARKET_CALLBACK_URL / DDU_CALLBACK_URL
- **已知遗留**：edxx/ 前端 tsc 存量错误（res unknown，sed 改名暴露非本单引入）；Booth↔Market 契约单 v1.1 文件未获取（按工单正文落地）

## Booth 双端 P0（DUAL-PORTAL-P0，2026-09-10）
- **双端登入框架**：OAS 登录成功 → `navigate('/containers')` 容器分流页（4 卡：#xhpz 个人 / #xepz 企业可进，#xopz 生态主体 / #xgpz 政府置灰 Tooltip"预留"）→ 帽卡片选择页 `/xhpz/hats` `/xepz/hats`（GET /api/booth/auth/hats）→ 视角工作台 `/xhpz` `/xepz`
- **API**：GET /api/booth/auth/containers（token 重验 OAS 原角色→PERSONAL_ONLY_ROLES=[CUSTOMER,VIEWER,CU,GU] 仅 #xhpz，其余双容器；匿名态双容器演示）；GET /api/booth/auth/hats（oasCheckPower 候选端点探测优先 source=oas-checkpower，不可达降级登录态组装 source=session-fallback）
- **oas-client.ts**：新增 `oasCheckPower(token)`——OAS check-power 多候选端点（proxy/ams/auth/check-power → /api/v1/auth/check-power）×（Bearer/body）探测，3s 超时；端点契约待契约单校准
- **守卫**：RequireAuth 放行 /containers /xhpz /xepz 前缀（容器层路由不按 booth role 弹回）；RequireContainer（containers 数据判定+ForbiddenPage 友好页）→ RequireHat（无帽→重定向 /{container}/hats）→ 工作台
- **store 扩展**：container/hat/containers 状态（localStorage booth_container/booth_hat）+ setContainer/setHat/resetPerspective（切换角色=视角状态清空重建）；logout 同步清理
- **页面**：components/PortalShell.tsx（轻量顶栏：#容器徽标+帽徽章+切换角色/切换端/退出，375px 友好）、portal/ContainerPortal.tsx、portal/HatSelect.tsx、portal/ForbiddenPage.tsx、xhpz/PersonalWorkbench.tsx（我的消费/我的接单/我的小铺三模块骨架）、xepz/EnterpriseWorkbench.tsx（我的铺子卡片网格+ERP/Space/Station 经营入口占位+X-Supply 采购入口占位）
- **Login**：goHome → /containers；DEV-only 一键测试登录（dev-token 默认 admin）
- **已知缺口**：《Booth_双端定义_20260910_v1.0.md》未投递本窗口——容器判定规则/checkPower 端点契约按 P0 合理实现，待契约单校准；企业台铺子网格/个人台三模块为 P0 静态骨架，数据接口 P1 接六版本实例

## Booth↔Market 体验打通（BOOTH-CONN-01，2026-09-10）
- **容器身份贯穿**：PortalShell 身份卡升级（容器号 #XEPZ/#XHPZ+当前角色帽+产品定位"Booth 履约端"）；企业台=DU 经营视角（供给铺管理 /du/supply-shops、订单履约 /du/production-orders、Market 观察窗入口组）；个人台=CU 客户视图（逛集市内嵌 Market/新窗下单/我的交付）
- **Market 观察窗**：`/xepz/market-watch`（xepz/MarketWatch.tsx）——iframe 拉取 https://fhrrxb4t8g.coze.site（Tab 切集市首页/订单列表+oas_token 参数透传+新窗兜底），只读观察不改 Market
- **SSE 履约推送**（server/routes/fulfillment.ts，挂 /api/booth/fulfillment）：GET /stream（EventSource，复用 sse.ts org 总线，15s 专属心跳 : heartbeat-15s，query token 验签支持）+ GET /timeline（booth_fulfillments 回写数据→四节点时间线 Market 下单/供给铺接单(Booth-E)/DU 履约/交付确认，操作方容器号脱敏 XEPZ-****xxxx）+ POST /simulate-event（requireAuth du 系，V3 验收模拟事件源）
- **前端**：components/FulfillmentTimeline.tsx（EventSource 断线自动重连+初始 timeline 拉取+实时追加，variant enterprise/personal 双视角）；工作台嵌入时间线卡
- **红线遵守**：单向交易隔离未动；价格字段隔离保持（时间线/观察窗无价格字段）；契约单 v1.1 协议未改（本单仅体验层）
- **验证证据**：V3 SSE 连通+模拟事件 19ms 到达（<3s 阈值）+15s 心跳；timeline 真实回写数据渲染（M2026 订单四节点）；V4 观察窗 iframe 路由 200
- **timeline orderNo 过滤 [BOOTH-CONN-02]**：`GET /api/booth/fulfillment/timeline?orderNo=xxx` 精确过滤（Market 代理匹配规则 boothOrderNo===order.code，MARKET-CONN-01 消费侧），无参数保持全量向后兼容；新参数不绕过 requireAuth（PROD 模拟无 token 401 已验）
- **Market 单号对齐样板 [BOOTH-CONN-02]**：migrate 两分支（存量库 NOT EXISTS 幂等/新库初始化）seed `EX-2026-0020` 履约样板（status=in_progress fulfilling 态、contract_status=Created、source=mall），Market 订单详情 matched 端到端四节点；XBUS 真实入站同号单被 idx_fulfillments_org_shop_order 唯一索引+入站查重幂等承接不冲突

## 供给执行线冻结（BOOTH-FREEZE-01，2026-09-10 主人裁定）
- **约束**：Booth 供给执行线即日起**冻结新增强，只做 bug 修复**；供给类新需求一律转 ZiwayDS（ZDS-PH1-STRUCT-01 六铺分离体系，ZiwayDS 窗口 7683893594616348715）
- **背景**：供给执行成熟件已被 ZiwayDS 评估吸收——拆单引擎（split-service 四铺拆单）+ waveNo→productionNo 透传链路（outbox）代码平移至 ZiwayDS factory 模块；G-005 凭证/履约时间线由 ZiwayDS 按"回执=责任转移=Case结算触发"口径重写
- **冻结范围**：split-service / fulfillment-service / work-order-service / inventory-service / outbox-service 三渠路由 / supply-orders 契约 / delivery-receipts / stock 出入库 / edxx FAB+WH 执行端 / 波次与生产单回执
- **不受影响（照常迭代）**：双端工作台（#xhpz/#xepz 门户/帽/工作台）、Market 对接（观察窗/timeline/事件链路/XBUS 入站幂等承接）、双端帽权限基础层

## Xfactory 壳层重构换装（XFACTORY-BRAND，2026-09-12）
- **品牌定版**：产品名 **Xfactory**（无连字符；X-Factory/Ziway Factory 写法废止）。用户可见面 Booth 字样清零：index.html title/favicon、AppLayout/MobileLayout 品牌区、登录页、PortalShell/ContainerPortal/HatSelect/ForbiddenPage、FabSupplierScore（信用档案页）、RealtimeDashboard 大屏标题、fulfillment timeline 节点 label（供给铺接单 → (Xfactory)）、supplier-score 404 message、auth dev-token 错误文案；中文形态名「制造厂」保留用于副标题/身份卡场景；**内部工程标识一律不动**（booth_* / api/booth / BoothUser 类型 / 组件与 SQL 注释）；运行时 DOM 验证 4 页面（login /du /containers /xepz/hats）Booth 文本残留=0（browser/screenshots/dom-check.cjs）
- **favicon**：public/favicon.svg（深藏青底 XF 白字）+ index.html link icon
- **登录修信用 [Xfactory-B4]**：auth.ts `humanizeLoginError`——401 归一化「账号或密码不正确」；OAS 锁定类错误解析剩余秒数返回 `lockSeconds` 字段；前端 Login 页倒计时显示+禁用提交（固定秒数语义，不再"越试越锁顺延"提示）
- **演示账号 [Xfactory-B5]**：登录页三卡一键登录（admin=SU·经营者 / operator=AU·执行者 / customer=CU·铺员 × test123），走真实 OAS RS256 登录链；内测期全环境展示
- **路由 [Xfactory-B6/B7]**：`/exx`（含子路径）→ `/edxx` **301**；`/ex` `/exModules` `/em` `/job` 旧裸挂点补 `requireAuth`（PROD 无 token 401 实测通过）
- **菜单三层重组 [Xfactory-C8]**：26 菜单按 `wrapMenuGroups` 重组为 **经营/作业/台账** 三组（label 前缀归类：MKT/Market/EM/经营决策/一线经营→经营，FAB/DL/SVC/业务执行线/运营线→作业，WH→台账；菜单项文字措辞本轮不改，术语口径待拍板）+ Sider **身份帽卡**（EDU 经营帽/EDX 执行帽/DEU 分身，按 role+actingAs 判定显隐）；findOpenKeys 改递归支持三层展开链路
- **EMBED 免登钩子 [Xfactory-C9]**：Login 监听 `postMessage{source:'ziway-ds-embed',type:'auth:token'}` → `GET /api/booth/auth/me`（requireAuth，RS256 验签）拉身份 → applySession → 回执 `{source:'booth',type:'embed:ready'}`；origin 白名单 `EMBED_ORIGIN_WHITELIST=['*']`（联调期配置，上线收紧）
- **新增 GET /api/booth/auth/me**：requireAuth 后返回 req.user（EMBED 链路与调试用）
- **验收证据**：server tsc 0 错 + vite build 0 错；前端全量 tsc 80 错=存量基线（stash 前后等量，本单零新增）；/exx 301 实测（→/edxx、→/edxx/fab）；错密码返回「账号或密码不正确」；admin/test123 真实 OAS RS256 登录 200；375px 截图 browser/screenshots/{login-375,workbench-375}.png

## Xfactory 快速上手包（ONBOARDING-P0，2026-09-12）
- **后端**：`server/routes/onboarding.ts`（`router.use(requireEdu)`=du/dx/dm，index 挂载 requireAuth）——GET /status（isEdu/hasRealData/hasOrgProfile/demoActive/demoDataset）；POST /profile（booth_onboarding_profile upsert：厂名/简介/所在场地）；POST /apply-template（食品/服装/电子三模板→booth_crafts `DEMO-CRAFT-*` 幂等，steps 含产能示例）；POST /seed-demo 全闭环演示种子（booth_fulfillments `DEMO-SO-2026-0901` source=demo contract_status=Settled → booth_production_orders `DEMO-PO-0901` → task → 工单×2（生产+配送）→ G-005 凭证 → 入库单 → booth_demo_datasets 登记），幂等 409（dataset upsert 支持清后复灌）；POST /clear-demo 按 `DEMO-%` 前缀精确清除+cleared_at 留痕；migrate [ONBOARDING-P0] 两表 DDL（booth_demo_datasets/booth_onboarding_profile）
- **前端**：/du/onboarding 三步向导（Steps：①铺信息 ②产能模板卡 ③演示数据可选灌入；每步可跳过；完成写 localStorage booth_onboarding_done）；Dashboard 嵌 DemoDataCard（一键灌入/清空+「开通向导/补完成向导」入口）+首次使用横幅（EDU+无 profile+无真实数据+未标记才弹，可暂不）；PersonalGuideCard（`isPersonalOASRole` subRole CU/GU 判定；#xhpz 个人台顶部+帽选择页 compact 变体：「个人参与须经 X-Mate 人事铺派岗」+「想开厂请注册企业主体」）；/quickstart 三动线帮助页（免登路由：体验一键登录/企业三步开通/个人经 X-Mate 派岗）+Login 底部「快速上手」入口+AppLayout Header 帮助图标
- **红线遵守**：拆单/G-005/结算业务逻辑零改动（演示行=静态数据层快照，不走状态机）；演示数据三重标记（单号 `DEMO-` 前缀+source=demo+booth_demo_datasets 登记批次），清空仅按前缀绝不触碰真实账
- **验收证据**：向导 API 全流程（status→profile→apply-template→seed-demo→409 幂等→timeline DEMO-SO-2026-0901 四节点全 done→clear-demo→空态→复灌）；个人身份 seed 403；tsc 前端 80=基线零新增+server 0 错；截图 browser/screenshots/{onboarding-375,demo-375,guide-375,quickstart-375}.png

## Xfactory 生态版 MVP·四主体（XDP-ECO，2026-09-12）
- **四主体口径（主人 09-12 拍板）**：个人（#xhpz·消费与派岗）/企业（#xepz·开店经营）/经营户（#xdpz·铺位管理）/平台方（#xvpz·生态治理 VEM）。产品层映射不动 OAS：auth.ts `resolveContainers` 扩展四容器——xdpz=OAS subRole∈{SU,EM}、xvpz=subRole∈{SU,ADMIN}、xepz=非 personal-only、xhpz 全量；DEV 匿名（identity_id='dev-anonymous'）四容器全开演示。共享类型 `src/types/containers.ts`（ContainerKey/CONTAINER_META），store/PortalShell/HatSelect/ForbiddenPage/ContainerPortal/App 四键统一；ContainerPortal 四主体卡（无权限=「未开通」）；Login 登录页四主体分流文案卡
- **数据层（migrate [XDP-ECO] 两分支幂等）**：`booth_eco_applications`（入驻申请：org/applicant/contact/shop_name/category/status pending|approved|rejected/reject_reason/rate_bps/**is_demo**）；`booth_eco_shops`（生态铺位：eco_type direct|franchise/category/status active|suspended/**rate_bps 协议费率万分比**/source_application_id/**is_demo**）；种子：直营旗舰铺（Xfactory 旗舰制造厂 direct 300bps is_demo=false=总部配置）+演示加盟铺+演示待审申请（is_demo=true 隔离）
- **API（server/routes/eco.ts，挂 /api/booth/eco requireAuth）**：VEM 端（requireVem=subRole SU/ADMIN 或 dev-anon）GET /summary 多铺汇总（铺数/直营/加盟/在营/待审/台账条数）、GET /shops、PUT /shops/:id/rate 费率配置、POST /shops/:id/suspend|resume 治理、GET /applications、POST /applications/:id/review（approve 事务=申请 approved+开通 franchise 铺落 rate_bps；reject 带理由）、GET /ledger?shopId= 分成台账（**动态视图**：booth_fulfillments contract_status=Settled × 关联铺费率 LATERAL 直营优先，**0 金额**——应收说明「按协议费率应收 · 金额级分账随 ERP 账本线结算」）；XEPZ 端（requireEdu）POST /applications、GET /my-applications；经营户（requireXdpz=SU/EM）GET /my-shops、/my-applications（is_demo=false 过滤）
- **前端**：/xvpz VemConsole（汇总卡+Tabs 铺位列表[直营/加盟 Tag+费率+停铺/恢复+费率配置 Modal]/入驻审核[通过带费率/驳回带理由]/分成台账[铺位筛选→空态与流水两态展示]）；/xdpz ShopOwnerWorkbench 经营户台（我的铺列表+我的申请+入驻入口）；/xepz JoinApplyCard 入驻卡（提交申请 Modal+我的申请状态）；/xdpz /xvpz 路由（RequireAuth→RequireContainer→RequireHat→PortalShell）
- **修复（本单顺带）**：HatSelect/ContainerPortal 消费 apiGet 剥壳后 `resp.data.hats` 双层取空（有帽用户帽页恒空态）→ `unwrapData` 兼容直返/包壳（api.ts 导出，三新页统一走）；注意 5000 重启必须带 `NODE_ENV=production`（否则 static/SPA fallback 分支不激活，全路由 404）
- **红线遵守**：拆单/波次/履约/G-005/Case 结算事务零改动（台账=只读查询动态视图，不写结算流水表）；执行层 0 价格（全链路无金额计算，费率=协议参数非售价）；RS256/OAS 仓不动；演示数据 is_demo 标记隔离
- **验收证据**：containers 四主体显隐（匿名 4 容器/admin token summary 200）；入驻流全流程（申请 id2/id3→approve(rate 400)→开通铺 source_application_id=2→rate 420→suspend→resume→reject 带理由）；台账流水（1105 条 Settled×直营 300bps）+shopId=2 空态；tsc 前端 80=基线零新增+server 0 错+build OK；截图 browser/screenshots/eco-{login,containers,vem-shops,vem-review,vem-ledger,vem-ledger-empty,xdpz,xepz-join}-375.png（8 张）

## Xfactory 体验极大提升（UX-BOOST，2026-09-12）
- **六维度**：①main.tsx boothTheme token 精修+message.config(maxCount:3,duration:2.5) ②三态组件 `src/components/PageState.tsx`（loading 骨架/error Result+重试/empty=原因+数据价值+行动，文案范本=/du/fab/equipment）+TABLE_PROPS（`src/constants/table.ts`，Pick<TableProps<any>,'size'|'pagination'> 防 spread 泛型回退）+useAsyncData（`src/hooks/list.ts`）；代表页接入 du/SupplyShops、edxx/FabQueue、du/Inventory、du/Orders（全包裹）+ex/WorkOrders、em/SupplyQuotes（轻接入 message.error） ③App.tsx **83 页面 lazy 化**+Suspense（python 正则批量 `^import (\w+) from '(\./pages/[^']+)';$`）④AppLayout Outlet 包 `page-fade`（key=pathname 路由过渡）+global.css（触控 44px/focus-visible/tabular-nums） ⑤移动端响应式 ⑥useRouteTitle（`src/hooks/useRouteTitle.ts` 路由 title 映射「订单管理 · Xfactory」）
- **AppLayout 移动响应式（P1-a/b）**：Grid.useBreakpoint isMobile=!screens.md → Sider 换 Drawer(placement left width 264)+Header 汉堡收纳（icon-only+短文案）；顶层菜单组 submenu→`type:'group'`（**修 P1-d Market 三层菜单二级点击不可达**——220px Sider 内三层嵌套 submenu-title click 超时）；openKeys **受控**（manualOpenKeys∪routeOpenKeys(useMemo findOpenKeys(path))）+prop 名=**onOpenChange**（rc-menu 9.16.1 契约，onOpenKeys 不存在——曾致 Menu props 2322 多轮排障）→ **修 P1-e 侧栏展开被路由重置**
- **P1-c 大屏**：RealtimeDashboard WebSocket 连 SSE 端点必失败+token 读 'token'（实际 booth_token）→「连接断开」红标常驻；改 EventSource(`/api/booth/stream?token=${booth_token}`)+linkState 三态（连接中 amber/实时连接 green/重连中 red）+响应式栅格 xs/lg+clamp 字号+tabular-nums
- **P1-e Station 死链**：/du/fab/station 等无 id 死链重定向 ×4（du/ex/em/edxx 树 `<Route path="fab/station" element={<Navigate to="../station" replace/>}/>`）
- **P2**：OnboardingWizard ?step= URL 直跳（0-2 夹取）+免保存预览（空铺名跳转 message.info 不阻断）；Login 演示卡 desc 对齐（operator=「店长台 · 经营与履约管理」admin=「经营台 · 铺子与履约全量」）；HatSelect 空态行动引导卡（返回容器分流/重新登录/快速上手）；FabSupplierScore 响应式栅格+Statistic nowrap+ellipsis；RequireHat **xvpz/xdpz 豁免**（管理控制台无作业帽语义）
- **尾部核实（不修）**：/ex /exModules /em /job 页面路径 200=SPA fallback 架构必然（token 在 localStorage 服务端无法验页面请求，鉴权在前端 RequireAuth）；API 前缀已挂 requireAuth（PROD 模拟 401 E_NO_TOKEN 实测）——页面 200 与换装单 401 是两层口径不矛盾
- **验证**：build EXIT=0；前端 tsc 80=基线零新增；playwright 复测 21 项 PASS（移动 Drawer/汉堡/无溢出 375/Market 可达→/market/station 重定向/openKeys 保持/SSE 实时连接绿标/数字不截断/?step=2 直跳/hats 三出口/触控 44px/xvpz 直达/title 映射/断网 error 态+重试按钮）；对比截图 docs/ux_boost_20260912/shots/before-*.png ×13 vs browser/screenshots/after/ ×15（9 组）；复测注意不用 CDP snapshot（会重置页面），移动视口每次 open 后重设

## W1 极致主线收敛（W1-SIMPLIFY，2026-09-12）
- **菜单收敛 A**：admin/du 视角叶子 **40→13**（目标≤16 超额达成）；延后隐藏 14 项 toggle 化——`src/config/menuConfig.ts` MENU_TOGGLES（profit/replenishment/fulfillmentTrack/orderTypes/roles/realtime/orgChart/oee/telemetry/maintenance/andon/whBoard/whExpiry/whAlerts 全 false）+`isPathHidden(path)`+`MaybeHiddenRoute`（App.tsx 12 项路由包装，hidden→Navigate fallback 重定向 profit/roles/realtime/org-chart→/du、OEE/采集/保养/安灯→本树 equipment、四仓/效期/预警→/du/batches 对应 tab；**菜单过滤与路由重定向同源 flag=状态机原子**）；待契约隐藏 3 项=/market 整树+/du/supply-shops+/du /em supply-quotes；「MKT 铺子管理」submenu label→「铺子管理」消代号
- **合并视图 B**：FAB 四页→`/fab/flow` 作业流（FabFlow Tabs 四工序+?zone= 同步+ZonePanel 复用——FabZoneView 拆出 ZonePanel 导出 stage prop；zone/:stage 直连→`?zone=` 保位重定向×4 树）；库存调拨双入口→台账 1 处；采购+供应商+供给订单→侧栏「供应链」分组；Batches Tabs 收敛三页（四仓看板/效期/预警）+?tab= 同步
- **修通 C**：RequireAuth 根因修复——dx 被强制弹 /du（`(du||dx)&&!du&&!au&&!market` 放行 /au）；新 `/au` 店长台树（AUWorkbench 统计四卡 Card hoverable onClick+快捷入口+PageState）；operator 登录→#xepz→FAB→/au 不落 /du
- **三张面孔 D**：DemoDataCard demoActive 直达按钮（看订单拆成工单→生产单列表/看回执触发结算）；EDX 履约工作台拆单 0 跳（空态范本级）；**EDXX 3 步闭环补齐凭证 UI**——EvidenceUploadModal（FAB Queue 完工上报按钮+FabStationDetail 内嵌；POST evidences→G-005 轻推→completeWorkOrder 自动完成→timeline 四节点，前端首次补齐）
- **三态 E**：PageState 错误兜底批量接入 12 页（ProductionOrders/Boms/Crafts/PurchaseOrders/SupplierManagement/WorkOrders/InventoryTransfer/Dashboard/FabEquipment/FabStations/FabFlow/AUWorkbench）；**/du/suppliers 页面真身=SupplierManagement.tsx（Suppliers.tsx 未挂载旧文件勿改错）**；清空演示数据 Popconfirm→受控 Modal 强确认（输入「清空」+危险警示）
- **执行线唯一改动（报备）**：work-order-service accept/start accepted_by/operator_id FK guard（resolveOperatorId helper——OAS 用户未同步 booth_users 时 accept 500 FK violation 修复，与 G-005 EXISTS 同口径）；migrate 幂等修复（booth_maintenance_plans RENAME 存在性 guard——重启撞 legacy 表 FATAL）；契约线零 diff
- **验证**：build EXIT=0；tsc 前端 80=基线零新增+server 0；三态矩阵 16/16 PASS（browser/screenshots/after/w1/threestate-matrix.json）；主线 e2e 10/10 PASS（seed-demo 409 幂等→入站建单→dispatch→EDXX 接单/开工/凭证完工→timeline 四节点——脚本 browser/screenshots/w1-e2e.cjs）；菜单实测 40→13+0 泄漏+重定向全通（w1-after.cjs）；截图 before docs/ux_boost_20260912/shots ×13 vs after browser/screenshots/after/w1 ×16；报告 docs/w1_simplify_20260912/w1_report.md（含 7 标准闭环+门禁输出+遗留：13vs16 差额裁定/OAS dev-token 404→DEU 替代/Station 待真实站点/Suppliers.tsx 待清理）
