import { pool } from '../db.js';
import { broadcast } from '../sse.js';
import type { JwtPayload } from '../auth.js';

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

    // Insert fulfillment
    const fulRes = await client.query(
      `INSERT INTO booth_fulfillments (org_id, shop_order_id, status, items, required_at)
       VALUES ($1, $2, 'pending', $3, $4)
       RETURNING *`,
      [orgId, shopOrderId, JSON.stringify(items), requiredAt]
    );

    // Record event
    await client.query(
      `INSERT INTO booth_event_log (event_id, event_type, payload)
       VALUES ($1, $2, $3)`,
      [event.eventId, event.eventType, JSON.stringify(event.payload)]
    );

    await client.query('COMMIT');

    broadcast(orgId, 'fulfillment_created', fulRes.rows[0]);
    return { skipped: false, fulfillment: fulRes.rows[0] };
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
 * Sanitize fulfillment for EX/EXX roles: remove price and totalAmount from items.
 */
export function sanitizeFulfillment(fulfillment: any, user: JwtPayload) {
  if (user.role === 'eu') {
    return fulfillment;
  }

  const sanitized = { ...fulfillment };
  if (Array.isArray(sanitized.items)) {
    sanitized.items = sanitized.items.map((item: any) => {
      const { price, totalAmount, ...rest } = item;
      return rest;
    });
  }
  return sanitized;
}
