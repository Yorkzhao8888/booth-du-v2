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
| 交付长 | dex | 工作台、拆单、BOM/SKU 管理 | ❌ 无价格 | /dex |
| 铺员 | exx | FAB 制作 + WH 仓储（帽子权限） | ❌ 无价格 | /exx |

## 测试账号
| 手机号 | 密码 | 角色 | 姓名 |
|--------|------|------|------|
| 13800000001 | 123456 | du | 店主 |
| 13800000004 | 123456 | dx | 店长 |
| 13800000002 | 123456 | dex | 交付长 |
| 13800000003 | 123456 | exx | 铺员 (FAB+WH) |

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
    dex.ts          # 交付工作台 (dex)
    exx.ts          # 执行端 FAB/WH (exx)
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
    dex/            # 交付长页面
    exx/           # 铺员页面
  components/
    AppLayout.tsx   # 桌面端布局
    MobileLayout.tsx # 移动端布局
    SSEListener.tsx # SSE 事件监听
```

## API 路径
- `/api/booth/auth/login` — 登录（[R7-01] 纯 OAS AMS 代理透传，无本地签发）
- `/api/booth/auth/oas-status` — OAS 配置状态（authReady/failClosed/signing）
- `/api/booth/du/*` — 经营端 (du+dx)
- `/api/booth/dex/*` — 交付端 (dex)
- `/api/booth/exx/*` — 执行端 (exx)
- `/api/booth/supply-orders/*` — [PK-02] SupplyOrder 显式契约（quote/confirm/settle 带审计+GMBS）
- `/api/booth/internal/events/*` — 内部事件
- `/api/booth/stream` — SSE 实时推送
- `/api/booth/health` — 健康检查
- `/events/*` — [LINK-01] 内部事件根级别名（与 `/api/booth/internal/events/*` 等价，Shop XBUS 直调）
- `PUT /api/booth/job/stations/:id/plaz-mapping` — [LINK-01 任务B] Booth↔X-Dyard(Plaz) 站位映射绑定/解绑（du/ex/dx）

## 订单族编码同步（ORDER-T，2026-09-05 定义 LOCKED）
六订单族统一编码：Order-C 对客经营 / Order-D 履约经营 / Order-Y 智场工程 / Order-H 人事伙伴 / Order-E 通货供给 / Order-T 技研支撑（技术订单已由 Order-D 重名修正为 **Order-T**，D 仅指履约）。
- **落点约定**：订单模型实施时预留 `order_family` 字段（枚举 C/D/Y/H/E/T），随订单模块迭代落地，验收=订单能正确标注归属族
- **Booth 归属预判**：`booth_fulfillments` 供给契约（Shop 供货履约）→ **Order-E 通货供给**；FAB/WH 内部工单为执行单，若构成对外技术支撑订单 → **Order-T**（实施时判定）；禁止再用 Order-D 表示技术订单

## 统一登录与事件契约（BOOTH-R7）
- **统一登录 [R7-01]**：Booth 仅信任 OAS AMS 签发的 RS256 JWT（iss=ziway-oas）。公钥来源两级：`OAS_PUBLIC_KEY`（SPKI PEM，支持 \n 转义）**显式配置优先**；未配置时启动自动从 `${OAS_BASE_URL}/.well-known/jwks.json` **JWKS 发现**（日志 `[AUTH] OAS public key discovered via JWKS`）。两者皆无 → **fail-closed**：启动 FATAL 日志 + 所有需登录接口 503 `AUTH_NOT_READY`（health 不受影响）。legacy 本地账号/jwt 自签/test-mode 全部移除，138 本地测试账号不可用（OAS AMS 未同步），验收口径为 OAS 五角色 admin/operator/customer/viewer/em × test123，映射 SU→du / AU→dx / CU→exx / GU→dxx / EM→em，exx 依赖角色默认帽子（CU→[FAB]）。登录返回 user 含 orgMode（du 价格可见性依赖）
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
