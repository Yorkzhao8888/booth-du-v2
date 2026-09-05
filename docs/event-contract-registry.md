# Booth 事件契约登记表（BOOTH-R7-02）

> 命名规范：`cmd.<domain>.<action>.v1`（OAS EventBus 基座 §10）
> 消费方 DLQ：booth_event_dlq（入站验签失败隔离）｜outbox DLQ：status=dead（重试 10 次终败）

## 发布（Booth → 其他 APP）

| 主题全名 | 方向 | 语义说明 | 幂等键 | DLQ 策略 | 关联域 |
|----------|------|----------|--------|----------|--------|
| `cmd.booth.supply_order.created.v1` | pub | Shop 订单确认/代录后自动创建供给单（contract_status=Created），payload 含 shopOrderId/supplyOrderId/**boothWorkOrderId**（Shop 回写用） | supply_order_id（唯一索引 idx_fulfillments_org_shop_order） | outbox 重试 10 次 → dead | Shop（SHOP-LINK-01） |
| `cmd.booth.supply_order.cancelled.v1` | pub | Shop 取消事件触发的供给单契约取消回写 | supply_order_id | outbox 重试 10 次 → dead | Shop |
| `cmd.booth.mate.dispatch.v1` | pub | 供给单创建即派 Mate 工作者（HU）；契约：sourceOrderNo/description/expectedAt/reward/assigneeRole | fulfillment_id | outbox 重试 10 次 → dead + mate_dispatch_status=failed | Mate（MATE-LINK-01） |
| `cmd.booth.supply_order.confirmed.v1` | pub | 供给单审批确认（Quoted→Confirmed）；GMBS：涉及金额审批 | fulfillment_id | outbox 重试 10 次 → dead | Shop/内部 |
| `cmd.booth.delivery.confirmed.v1` | pub | 交付签收结算（→Settled）；GMBS：资金结算 | fulfillment_id | outbox 重试 10 次 → dead | Shop/内部 |
| `cmd.booth.finance.xcase_opened.v1` | pub | 业财 XCase 开立 | xcase_id | outbox 重试 10 次 → dead | 内部/财务 |
| `cmd.booth.finance.xcase_closed.v1` | pub | 业财 XCase 结案（收入/支出汇总入账）；GMBS | xcase_id | outbox 重试 10 次 → dead | 内部/财务 |
| `cmd.booth.audit.log.v1` | pub | OAS 审计上报（操作者/动作/对象/时间/结果五要素 + GMBS 标记），投递 OAS `POST /api/v1/admin/audit-logs` | actor+action+resource_id+occurred_at | outbox 重试 10 次 → dead | OAS（审计基座） |

## 订阅（其他 APP → Booth）

| 主题全名 | 方向 | 语义说明 | 幂等键 | DLQ 策略 | 关联域 |
|----------|------|----------|--------|----------|--------|
| `cmd.shop.order.confirmed.v1` | sub | Shop 订单确认 → 自动创建供给单 + Mate 派单；事件体 eventId/shopOrderId/items/requiredAt/totalAmount | booth_event_log(event_id) + shop_order_id 查重 + 唯一索引（三层） | 验签失败 → booth_event_dlq + 告警；业务失败返回 4xx 由发布方重投 | Shop（SHOP-LINK-01） |
| `cmd.shop.order.cancelled.v1` | sub | Shop 订单取消 → 供给单契约取消 + outbox 回写取消 | 同上 | 同上 | Shop |

## 兼容期与迁移说明
- **出站**：R7-02 起新消息只发 `cmd.booth.*.v1`，旧主题（supply_order.created / mate.dispatch / SupplyOrder.Confirmed / Delivery.Confirmed / Finance.XCaseOpened / Finance.XCaseClosed）**立即停发**
- **入站**：Booth 订阅端点 `/events/*`（根级别名）与 `/api/booth/internal/events/*` 并行开放至 **2026-09-05**；期间同时接受旧 payload.eventType（`order.confirmed`/`order.cancelled`）与 `cmd.shop.*.v1` 主题名，过期后仅接受 cmd 规范名
- **消费方适配依赖**：Mate 侧按 `cmd.booth.mate.dispatch.v1` 过滤（MATE-LINK-01 任务B）；Shop 侧回写消费 `cmd.booth.supply_order.created.v1`（SHOP-LINK-01）
- **签名**：`X-Event-Signature: sha256=<HMAC-SHA256(body)>`，密钥 OAS_EVENT_SIGNING_KEY；配置后入站强制验签（失败进 DLQ），出站自动附加

## SSE 实时通道（App 内部，非 XBUS，不入登记范围）
station.assigned / station.status / station.fault / fulfillment_created / supply_order_created（frontend via /api/booth/stream）
