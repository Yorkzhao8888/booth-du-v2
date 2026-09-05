/**
 * [BOOTH-R7-02] Booth 事件主题契约 —— cmd.<domain>.<action>.v1 统一命名
 *
 * 发布 (pub, 经 booth_outbox 投递):
 *   cmd.booth.supply_order.created.v1    供给单契约创建 (事件链路+代录链路)
 *   cmd.booth.supply_order.cancelled.v1  供给单取消 (Shop 取消事件联动)
 *   cmd.booth.mate.dispatch.v1           Mate 派单 (HU 工作者)
 *   cmd.booth.audit.log.v1               OAS 审计上报 (R7-03)
 * 订阅 (sub, /events/* 入站, Shop 域发布):
 *   cmd.shop.order.confirmed.v1          Shop 订单确认
 *   cmd.shop.order.cancelled.v1          Shop 订单取消
 *
 * 兼容期: 入站旧名 (order.confirmed/order.cancelled) 兼容至 2026-09-05; 出站旧主题立即停发。
 * 幂等: booth_event_log(event_id) + shop_order_id 查重 + 唯一索引 (入站); outbox 幂等键见登记表。
 * DLQ: 入站验签失败 → booth_event_dlq; 出站重试 10 次终败 → outbox.status=dead。
 */
export const TOPIC = {
  // pub
  SUPPLY_ORDER_CREATED: 'cmd.booth.supply_order.created.v1',
  SUPPLY_ORDER_CANCELLED: 'cmd.booth.supply_order.cancelled.v1',
  MATE_DISPATCH: 'cmd.booth.mate.dispatch.v1',
  AUDIT_LOG: 'cmd.booth.audit.log.v1',
  SUPPLY_ORDER_CONFIRMED: 'cmd.booth.supply_order.confirmed.v1',
  DELIVERY_CONFIRMED: 'cmd.booth.delivery.confirmed.v1',
  FINANCE_XCASE_OPENED: 'cmd.booth.finance.xcase_opened.v1',
  FINANCE_XCASE_CLOSED: 'cmd.booth.finance.xcase_closed.v1',
  // sub (Shop 域)
  SHOP_ORDER_CONFIRMED: 'cmd.shop.order.confirmed.v1',
  SHOP_ORDER_CANCELLED: 'cmd.shop.order.cancelled.v1',
} as const;

/** 旧主题 (兼容期仅入站识别, 不再发布) */
export const LEGACY_TOPICS = {
  ORDER_CONFIRMED: 'order.confirmed',
  ORDER_CANCELLED: 'order.cancelled',
} as const;

/** 入站主题合法集合 (新名 + 兼容旧名) */
export const INBOUND_TOPICS = new Set<string>([
  TOPIC.SHOP_ORDER_CONFIRMED,
  TOPIC.SHOP_ORDER_CANCELLED,
  LEGACY_TOPICS.ORDER_CONFIRMED,
  LEGACY_TOPICS.ORDER_CANCELLED,
]);

/** 出站主题 → 投递目标域路由: mate → Mate, audit → OAS 审计, 其余 → Shop */
export type OutboundTarget = 'mate' | 'audit' | 'shop';

export function routeOfTopic(topic: string): OutboundTarget {
  if (topic.includes('.mate.')) return 'mate';
  if (topic.includes('.audit.')) return 'audit';
  return 'shop';
}

/** 入站事件类型规范化: 旧名 → 新名 (契约登记以新名为准) */
export function normalizeInboundTopic(raw: string): string {
  if (raw === LEGACY_TOPICS.ORDER_CONFIRMED) return TOPIC.SHOP_ORDER_CONFIRMED;
  if (raw === LEGACY_TOPICS.ORDER_CANCELLED) return TOPIC.SHOP_ORDER_CANCELLED;
  return raw;
}
