# CORE_BASELINE.md — Booth 共享执行内核 v1.0

> 版本标识：`core-v1.0`
> 本文件列出 Booth 项目中与商业视角无关的"共享执行内核"文件清单。
> 复制项目搭建 Booth-EU 等新变体时，以内核文件为基线，仅替换/扩展"DU 专有"部分。

---

## 一、共享内核文件清单（booth-core v1.0）

### 1. 数据库层
| 文件 | 说明 |
|------|------|
| `server/db.ts` | PostgreSQL 连接池，`pool` / `query` 导出 |
| `server/migrate.ts` | DDL 建表框架 + 索引 + 迁移执行逻辑（种子数据为 DU 专有，DDL 部分属内核） |
| `db/schema.sql` | 参考 schema 文档 |

### 2. 认证中间件骨架
| 文件 | 说明 |
|------|------|
| `server/auth.ts` | `signToken` / `requireAuth` / `requireRole` / `requireHat` 中间件骨架；JWT payload 结构、token 解析逻辑属内核；具体角色值（du/dex/dexx）为变体配置 |

### 3. 工单状态机
| 文件 | 说明 |
|------|------|
| `server/services/work-order-service.ts` | 工单创建、接单（accept）、领料开工（start）、完工（complete）、取消（cancel）状态流转；事务完整性保障 |

### 4. 库存行锁事务
| 文件 | 说明 |
|------|------|
| `server/services/inventory-service.ts` | 入库（inbound）、出库（outbound）行锁事务；安全库存校验；库存流水记录 |

### 5. BOM 拆单 / 履约调度
| 文件 | 说明 |
|------|------|
| `server/services/fulfillment-service.ts` | 履约单创建、拆单（dispatch）→ 工单批量生成；`sanitizeFulfillment` 价格脱敏骨架 |

### 6. SSE 实时推送
| 文件 | 说明 |
|------|------|
| `server/sse.ts` | SSE 客户端管理：`addClient` / `removeClient` / `broadcast` / `startHeartbeat`；按 orgId 分组广播 |

### 7. Outbox 异步事件投递
| 文件 | 说明 |
|------|------|
| `server/services/outbox-service.ts` | Outbox 模式：定时轮询 `booth_outbox` 表，POST 回调投递，重试 + dead letter |

### 8. 内部事件接收
| 文件 | 说明 |
|------|------|
| `server/routes/internal.ts` | 内部事件接入口（`/api/booth/internal/events/*`），事件 key 校验，写入 outbox |

### 9. 应用入口
| 文件 | 说明 |
|------|------|
| `server/index.ts` | Express 应用入口：中间件注册、路由挂载、静态文件服务、错误处理、启动迁移 |

### 10. 前端基础设施
| 文件 | 说明 |
|------|------|
| `src/api.ts` | 统一 API 请求封装：token 注入、响应解包、401 拦截 |
| `src/store.ts` | Zustand 状态管理骨架：token/user 持久化、login/logout、hasHat/canSeePrice |
| `src/App.tsx` | React Router 路由骨架 + RequireAuth 守卫 + 角色重定向 |
| `src/components/SSEListener.tsx` | SSE 事件监听组件：连接管理、事件分发、自动重连 |
| `src/components/StatusTag.tsx` | 工单状态标签（通用） |
| `src/components/StatCard.tsx` | 统计卡片（通用） |
| `src/components/PriceText.tsx` | 价格文本组件（通用，配合 canSeePrice 控制可见性） |
| `src/components/WorkOrderCard.tsx` | 工单卡片（通用） |

**内核文件数量：22 个**

---

## 二、DU 专有文件清单（Booth-DU 经营版）

### 1. 角色 RBAC 配置
- 角色定义：`du`（店主）、`dx`（店长）、`dex`（交付长）、`dexx`（铺员）
- 价格可见性：du/dx 全可见；dex/dexx 零价格
- 路由权限：du+dx → `/du/*`；dex → `/dex/*`；dexx → `/dexx/*`

### 2. 后端路由（角色专属）
| 文件 | 说明 |
|------|------|
| `server/routes/du.ts` | 经营看板、订单、工单、库存（含成本价）、BOM（含售价/毛利） |
| `server/routes/dex.ts` | 交付工作台、拆单调度、BOM/SKU 管理（无价格） |
| `server/routes/dexx.ts` | FAB 制作队列/领料/完工 + WH 入库/出库/流水 |
| `server/routes/auth.ts` | 登录接口（DU 变体的用户种子数据） |

### 3. 前端页面（角色专属）
| 目录 | 说明 |
|------|------|
| `src/pages/du/` | Dashboard、Orders、WorkOrders、Inventory、Boms（含价格视图） |
| `src/pages/dex/` | Dashboard、WorkOrders、Boms、Skus、Inventory（无价格） |
| `src/pages/dexx/` | ModuleEntry、FabQueue、FabActive、FabHistory、WhInventory、WhInbound、WhOutbound、WhTxns |
| `src/pages/Login.tsx` | 登录页（DU 变体角色跳转映射） |
| `src/components/AppLayout.tsx` | 桌面端布局（du/dex 菜单） |
| `src/components/MobileLayout.tsx` | 移动端布局（dexx FAB/WH 切换） |

### 4. DU 专有业务逻辑
- Shop 事件适配：`order-confirmed` → 创建履约单 → 拆单 → 工单
- 价格矩阵：`sanitizeFulfillment` 按角色脱敏、`getInventory` 按角色含/隐 cost_price
- 经营看板：todayRevenue / grossMargin / BOM 毛利计算

---

## 三、变体复制指南

搭建 Booth-EU 等新变体时：
1. 复制全部 **22 个内核文件** 作为基线
2. 替换 DU 专有路由和页面为新变体的角色体系
3. 修改 `migrate.ts` 种子数据中的角色值和用户列表
4. 修改 `auth.ts` 中 `requireRole` 的角色白名单
5. 修改 `fulfillment-service.ts` / `inventory-service.ts` 中的价格可见性判断
6. 修改前端路由、菜单、角色跳转映射
