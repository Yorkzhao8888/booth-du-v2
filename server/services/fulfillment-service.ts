import { pool } from '../db.js';
import { broadcast } from '../sse.js';
import type { JwtPayload } from '../auth.js';

/** [BOOTH-LINK-01] items 摘要: '面粉x50kg; 糖x2kg' */
function summarizeItems(items: any[]): string {
  if (!Array.isArray(items) || items.length === 0) return '';
  return items
    .map((it: any) => `${it.productName || it.name || 'item'}x${it.qty ?? '?'}`)
    .join('; ');
}

/** [BOOTH-LINK-01 任务C] 报酬: 事件 payload 金额优先, 兜底 items price 合计 */
function calcReward(payload: any, items: any[]): number {
  const direct = Number(payload?.totalAmount ?? payload?.amount ?? payload?.orderAmount);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  if (Array.isArray(items)) {
    return items.reduce((s: number, it: any) => s + (Number(it.price) || 0) * (Number(it.qty) || 0), 0);
  }
  return 0;
}

/**
 * Create a fulfillment from an order-confirmed event.
 * Idempotent via booth_event_log.
 */
export async function createFromOrderEvent(event: {
  eventId: string;
  eventType: string;
  payload: any;
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Idempotency check
    const existing = await client.query(
      'SELECT id FROM booth_event_log WHERE event_id = $1',
      [event.eventId]
    );
    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      return { skipped: true, reason: 'duplicate_event' };
    }

    const order = event.payload;
    const orgId = order.orgId || order.shopId || 1;
    const shopOrderId = String(order.shopOrderId || order.orderId || order.id);
    const items = order.items || [];
    const requiredAt = order.requiredAt || order.expectedAt || null;

    // [BOOTH-LINK-01] 幂等第二层: 同 shop_order_id 已建单则不重复(不同 event_id 的重复事件)
    const dup = await client.query(
      `SELECT id, contract_status FROM booth_fulfillments WHERE org_id = $1 AND shop_order_id = $2`,
      [orgId, shopOrderId]
    );
    if (dup.rows.length > 0) {
      await client.query(
        `INSERT INTO booth_event_log (event_id, event_type, payload)
         VALUES ($1, $2, $3)`,
        [event.eventId, event.eventType, JSON.stringify(event.payload)]
      );
      await client.query('COMMIT');
      return { skipped: true, reason: 'duplicate_shop_order', fulfillment: dup.rows[0] };
    }

    // [BOOTH-LINK-01] 供给单契约口径: contract_status='Created' + source='mall', 与 POST /supply-orders 代录链路一致
    const fulRes = await client.query(
      `INSERT INTO booth_fulfillments (org_id, shop_order_id, status, items, required_at, contract_status, milestones, quote_snapshot, source, mate_dispatch_status)
       VALUES ($1, $2, 'pending', $3::jsonb, $4, 'Created', '{}'::jsonb, NULL, 'mall', 'pending')
       RETURNING *`,
      [orgId, shopOrderId, JSON.stringify(items), requiredAt]
    );
    const ful = fulRes.rows[0];

    // [BOOTH-LINK-01 任务A] 回写 Shop: outbox 投递 supply_order.created, Shop 将 boothWorkOrderId 写回订单
    await client.query(
      `INSERT INTO booth_outbox (org_id, event_type, payload, status, created_at)
       VALUES ($1, 'supply_order.created', $2::jsonb, 'pending', NOW())`,
      [orgId, JSON.stringify({
        shopOrderId,
        supplyOrderId: ful.id,
        boothWorkOrderId: String(ful.id),
        contractStatus: 'Created',
        requiredAt,
      })]
    );

    // [BOOTH-LINK-01 任务C] Mate 派单: 供给单创建即派 HU 工作者 (契约: 来源工单号/需求描述/期望执行时间/报酬/指派角色)
    await client.query(
      `INSERT INTO booth_outbox (org_id, event_type, payload, status, created_at)
       VALUES ($1, 'mate.dispatch', $2::jsonb, 'pending', NOW())`,
      [orgId, JSON.stringify({
        sourceOrderId: ful.id,
        sourceOrderNo: `BOOTH-SUP-${ful.id}`,
        shopOrderId,
        description: summarizeItems(items) || `Shop order ${shopOrderId} fulfillment`,
        expectedAt: requiredAt,
        reward: calcReward(order, items),
        assigneeRole: 'HU',
        fulfillmentId: ful.id,
      })]
    );

    // Record event
    await client.query(
      `INSERT INTO booth_event_log (event_id, event_type, payload)
       VALUES ($1, $2, $3)`,
      [event.eventId, event.eventType, JSON.stringify(event.payload)]
    );

    await client.query('COMMIT');

    broadcast(orgId, 'fulfillment_created', ful);
    broadcast(orgId, 'supply_order_created', { id: ful.id, shop_order_id: shopOrderId, contract_status: 'Created' });
    return { skipped: false, fulfillment: ful };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Cancel a fulfillment from an order-cancelled event.
 * Idempotent via booth_event_log.
 */
export async function cancelFromOrderEvent(event: {
  eventId: string;
  eventType: string;
  payload: any;
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT id FROM booth_event_log WHERE event_id = $1',
      [event.eventId]
    );
    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      return { skipped: true, reason: 'duplicate_event' };
    }

    const order = event.payload;
    const orgId = order.orgId || order.shopId || 1;
    const shopOrderId = String(order.shopOrderId || order.orderId || order.id);

    // Find fulfillment
    const fulRes = await pool.query(
      'SELECT * FROM booth_fulfillments WHERE org_id = $1 AND shop_order_id = $2',
      [orgId, shopOrderId]
    );

    if (fulRes.rows.length === 0) {
      // Record event anyway to avoid reprocessing
      await client.query(
        `INSERT INTO booth_event_log (event_id, event_type, payload)
         VALUES ($1, $2, $3)`,
        [event.eventId, event.eventType, JSON.stringify(event.payload)]
      );
      await client.query('COMMIT');
      return { skipped: true, reason: 'fulfillment_not_found' };
    }

    const fulfillment = fulRes.rows[0];

    // Cancel pending/accepted work orders
    await client.query(
      `UPDATE booth_work_orders
       SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = 'Order cancelled'
       WHERE fulfillment_id = $1 AND status IN ('pending', 'accepted')`,
      [fulfillment.id]
    );

    // Update fulfillment status
    const updated = await client.query(
      `UPDATE booth_fulfillments SET status = 'cancelled' WHERE id = $1 RETURNING *`,
      [fulfillment.id]
    );

    // [BOOTH-LINK-01 任务A] 取消事件同步回写 Shop
    await client.query(
      `INSERT INTO booth_outbox (org_id, event_type, payload, status, created_at)
       VALUES ($1, 'supply_order.cancelled', $2::jsonb, 'pending', NOW())`,
      [orgId, JSON.stringify({ shopOrderId, supplyOrderId: fulfillment.id, boothWorkOrderId: String(fulfillment.id), contractStatus: 'Cancelled' })]
    );

    // Record event
    await client.query(
      `INSERT INTO booth_event_log (event_id, event_type, payload)
       VALUES ($1, $2, $3)`,
      [event.eventId, event.eventType, JSON.stringify(event.payload)]
    );

    await client.query('COMMIT');

    broadcast(orgId, 'fulfillment_cancelled', updated.rows[0]);
    return { skipped: false, fulfillment: updated.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Recursively strip all price/money/amount fields from an object or array.
 * Covers camelCase and snake_case variants.
 */
const PRICE_KEYS = new Set([
  'price', 'salePrice', 'sale_price', 'costPrice', 'cost_price',
  'unitPrice', 'unit_price', 'totalAmount', 'total_amount', 'amount',
  'grossProfit', 'gross_profit', 'grossMargin', 'gross_margin',
  'margin', 'revenue', 'totalCost', 'total_cost',
  // Supply quote price fields (BOOTH-OPT-03)
  'supplyPrice', 'supply_price', 'totalPrice', 'total_price',
  'bomMaterialCost', 'bom_material_cost', 'laborCost', 'labor_cost',
  'manufacturingFee', 'manufacturing_fee', 'marginRate', 'margin_rate',
]);

export function stripPriceFields<T = any>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => stripPriceFields(item)) as unknown as T;
  }
  if (typeof obj === 'object') {
    // Only recurse into plain objects; pass through class instances (Date, Buffer, etc.)
    const proto = Object.getPrototypeOf(obj);
    if (proto !== Object.prototype && proto !== null) {
      return obj;
    }
    const result: any = {};
    for (const [key, value] of Object.entries(obj as any)) {
      if (PRICE_KEYS.has(key)) continue;
      result[key] = stripPriceFields(value);
    }
    return result as T;
  }
  return obj;
}

/**
 * Sanitize fulfillment for dex/exx roles: recursively remove all price fields.
 * du/dx roles see full data including prices.
 */
export function sanitizeFulfillment(fulfillment: any, user: JwtPayload) {
  if (user.role === 'du' || user.role === 'dx') {
    return fulfillment;
  }
  return stripPriceFields(fulfillment);
}
