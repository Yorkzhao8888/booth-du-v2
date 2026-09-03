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
  index.ts          # Express 入口
  auth.ts           # JWT 认证中间件
  db.ts             # PostgreSQL 连接池
  migrate.ts        # DDL + 种子数据 + 角色迁移
  sse.ts            # SSE 实时推送
  routes/
    auth.ts         # 登录
    du.ts           # 经营看板 (du+dx)
    dex.ts          # 交付工作台 (dex)
    exx.ts         # 执行端 FAB/WH (exx)
    internal.ts     # 内部事件接收
  services/
    fulfillment-service.ts  # 履约/拆单
    inventory-service.ts    # 库存事务
    work-order-service.ts   # 工单状态机
    outbox-service.ts       # Outbox 异步投递
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
- `/api/booth/auth/login` — 登录
- `/api/booth/du/*` — 经营端 (du+dx)
- `/api/booth/dex/*` — 交付端 (dex)
- `/api/booth/exx/*` — 执行端 (exx)
- `/api/booth/internal/events/*` — 内部事件
- `/api/booth/stream` — SSE 实时推送
- `/api/booth/health` — 健康检查
- `/events/*` — [LINK-01] 内部事件根级别名（与 `/api/booth/internal/events/*` 等价，Shop XBUS 直调）
- `PUT /api/booth/job/stations/:id/plaz-mapping` — [LINK-01 任务B] Booth↔X-Dyard(Plaz) 站位映射绑定/解绑（du/ex/dx）

## 跨 APP 事件链路（BOOTH-LINK-01）
- **入站**：`POST /events/order-confirmed`（X-Event-Key 头 + eventId 幂等）→ 自动创建 supply-order 契约（booth_fulfillments, contract_status=Created, source=mall）→ outbox 回写 `supply_order.created`（Shop 将 `boothWorkOrderId` 写回订单）；取消事件同步回写 `supply_order.cancelled`
- **幂等三层**：booth_event_log(event_id) → shop_order_id 查重（skipped）→ 唯一索引 idx_fulfillments_org_shop_order
- **Mate 派单**（任务C）：供给单创建即写 outbox `mate.dispatch`，契约 payload：sourceOrderNo/description/expectedAt/reward/assigneeRole=HU；poller 投递至 `MATE_DISPATCH_URL`，成功回写 mate_dispatch_status=dispatched，终败=failed（outbox 重试 10 次后 dead）
- **环境变量**：`MATE_DISPATCH_URL`（Mate 接收端点）、`SHOP_CALLBACK_URL`（Shop 回写端点，既有）；outbox 按 event_type 前缀路由（mate.* → Mate，其余 → Shop），未配置的类别保留 pending 不阻塞
