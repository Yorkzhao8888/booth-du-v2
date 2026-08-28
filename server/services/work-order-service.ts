import { pool } from '../db.js';
import { broadcast } from '../sse.js';

export interface BomItem {
  skuId: number;
  skuName?: string;
  qty: number;
  unit: string;
}

export interface WorkOrderBom {
  bomId?: number;
  productName: string;
  items: BomItem[];
}

/**
 * Accept a work order: pending -> accepted
 */
export async function acceptWorkOrder(id: number, userId: number) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const woRes = await client.query(
      'SELECT * FROM booth_work_orders WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (woRes.rows.length === 0) {
      throw { statusCode: 404, code: 'NOT_FOUND', error: 'Work order not found' };
    }
    const wo = woRes.rows[0];
    if (wo.status !== 'pending') {
      throw { statusCode: 400, code: 'INVALID_STATE', error: `Cannot accept work order in ${wo.status} state` };
    }

    const updated = await client.query(
      `UPDATE booth_work_orders
       SET status = 'accepted', accepted_by = $1, accepted_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [userId, id]
    );

    await client.query('COMMIT');

    broadcast(wo.org_id, 'work_order_updated', updated.rows[0]);
    return updated.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Start a work order: accepted -> preparing
 * Transaction: lock inventory rows, check stock, deduct, record txns.
 */
export async function startWorkOrder(id: number, userId: number) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const woRes = await client.query(
      'SELECT * FROM booth_work_orders WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (woRes.rows.length === 0) {
      throw { statusCode: 404, code: 'NOT_FOUND', error: 'Work order not found' };
    }
    const wo = woRes.rows[0];
    if (wo.status !== 'accepted') {
      throw { statusCode: 400, code: 'INVALID_STATE', error: `Cannot start work order in ${wo.status} state` };
    }

    const boms: WorkOrderBom[] = wo.boms || [];
    const shortages: any[] = [];

    // Collect all required quantities per SKU
    const requiredMap = new Map<number, { qty: number; skuName: string }>();
    for (const bom of boms) {
      for (const item of bom.items) {
        const totalQty = item.qty * wo.qty;
        const existing = requiredMap.get(item.skuId);
        if (existing) {
          existing.qty += totalQty;
        } else {
          requiredMap.set(item.skuId, { qty: totalQty, skuName: item.skuName || `SKU-${item.skuId}` });
        }
      }
    }

    // Lock and check inventory
    const inventoryMap = new Map<number, any>();
    for (const [skuId] of requiredMap) {
      const invRes = await client.query(
        'SELECT * FROM booth_inventory WHERE org_id = $1 AND sku_id = $2 FOR UPDATE',
        [wo.org_id, skuId]
      );
      if (invRes.rows.length === 0) {
        shortages.push({ skuId, required: requiredMap.get(skuId)!.qty, available: 0 });
      } else {
        inventoryMap.set(skuId, invRes.rows[0]);
      }
    }

    // Check for shortages
    for (const [skuId, req] of requiredMap) {
      const inv = inventoryMap.get(skuId);
      if (!inv || inv.qty_on_hand < req.qty) {
        shortages.push({
          skuId,
          skuName: req.skuName,
          required: req.qty,
          available: inv ? inv.qty_on_hand : 0,
        });
      }
    }

    if (shortages.length > 0) {
      throw { statusCode: 409, code: 'INSUFFICIENT_STOCK', error: 'Insufficient stock', shortages };
    }

    // Deduct inventory and record transactions
    for (const [skuId, req] of requiredMap) {
      await client.query(
        `UPDATE booth_inventory
         SET qty_on_hand = qty_on_hand - $1, updated_at = NOW()
         WHERE org_id = $2 AND sku_id = $3`,
        [req.qty, wo.org_id, skuId]
      );
      await client.query(
        `INSERT INTO booth_inventory_txn (org_id, sku_id, qty_change, type, ref_type, ref_id, operator_id)
         VALUES ($1, $2, $3, 'consume', 'work_order', $4, $5)`,
        [wo.org_id, skuId, -req.qty, id, userId]
      );
    }

    // Update work order
    const updated = await client.query(
      `UPDATE booth_work_orders
       SET status = 'preparing', started_at = NOW(), operator_id = $1, progress = 10
       WHERE id = $2
       RETURNING *`,
      [userId, id]
    );

    await client.query('COMMIT');

    broadcast(wo.org_id, 'work_order_updated', updated.rows[0]);
    return updated.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Complete a work order: preparing -> completed
 */
export async function completeWorkOrder(id: number, userId: number) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const woRes = await client.query(
      'SELECT * FROM booth_work_orders WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (woRes.rows.length === 0) {
      throw { statusCode: 404, code: 'NOT_FOUND', error: 'Work order not found' };
    }
    const wo = woRes.rows[0];
    if (wo.status !== 'preparing') {
      throw { statusCode: 400, code: 'INVALID_STATE', error: `Cannot complete work order in ${wo.status} state` };
    }

    const updated = await client.query(
      `UPDATE booth_work_orders
       SET status = 'completed', progress = 100, completed_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [id]
    );

    // Get fulfillment for shop_order_id
    let shopOrderId: string | null = null;
    if (wo.fulfillment_id) {
      const fulRes = await client.query(
        'SELECT shop_order_id FROM booth_fulfillments WHERE id = $1',
        [wo.fulfillment_id]
      );
      if (fulRes.rows.length > 0) {
        shopOrderId = fulRes.rows[0].shop_order_id;
      }
    }

    // Write outbox event
    await client.query(
      `INSERT INTO booth_outbox (event_type, payload)
       VALUES ('fab.workorder.completed', $1)`,
      [JSON.stringify({
        workOrderId: id,
        shopOrderId,
        completedAt: new Date().toISOString(),
      })]
    );

    await client.query('COMMIT');

    broadcast(wo.org_id, 'work_order_updated', updated.rows[0]);
    return updated.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Cancel a work order: pending/accepted -> cancelled
 */
export async function cancelWorkOrder(id: number, reason: string, userId: number) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const woRes = await client.query(
      'SELECT * FROM booth_work_orders WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (woRes.rows.length === 0) {
      throw { statusCode: 404, code: 'NOT_FOUND', error: 'Work order not found' };
    }
    const wo = woRes.rows[0];
    if (wo.status === 'preparing') {
      throw { statusCode: 400, code: 'INVALID_STATE', error: 'Cannot cancel a preparing work order' };
    }
    if (wo.status === 'completed' || wo.status === 'cancelled') {
      throw { statusCode: 400, code: 'INVALID_STATE', error: `Work order is already ${wo.status}` };
    }

    const updated = await client.query(
      `UPDATE booth_work_orders
       SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = $1
       WHERE id = $2
       RETURNING *`,
      [reason, id]
    );

    await client.query('COMMIT');

    broadcast(wo.org_id, 'work_order_updated', updated.rows[0]);
    return updated.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Dispatch a fulfillment into work orders.
 * workOrders: array of { productName, qty, bomId?, boms? }
 */
export async function dispatchFulfillment(
  fulfillmentId: number,
  workOrders: Array<{ productName: string; qty: number; bomId?: number; boms?: WorkOrderBom[] }>,
  orgId: number
) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const created: any[] = [];

    for (const wo of workOrders) {
      let bomsData: WorkOrderBom[] = wo.boms || [];

      // If bomId is provided but boms snapshot not included, fetch it
      if (wo.bomId && bomsData.length === 0) {
        const bomRes = await client.query(
          `SELECT b.id, b.product_name, b.product_code,
                  bi.sku_id, bi.qty, bi.unit,
                  s.name as sku_name
           FROM booth_boms b
           JOIN booth_bom_items bi ON bi.bom_id = b.id
           JOIN booth_skus s ON s.id = bi.sku_id
           WHERE b.id = $1 AND b.org_id = $2 AND b.is_active = TRUE`,
          [wo.bomId, orgId]
        );

        if (bomRes.rows.length > 0) {
          const items: BomItem[] = bomRes.rows.map((r: any) => ({
            skuId: r.sku_id,
            skuName: r.sku_name,
            qty: r.qty,
            unit: r.unit,
          }));
          bomsData = [{
            bomId: wo.bomId,
            productName: bomRes.rows[0].product_name,
            items,
          }];
        }
      }

      const result = await client.query(
        `INSERT INTO booth_work_orders (org_id, fulfillment_id, product_name, qty, status, boms, progress)
         VALUES ($1, $2, $3, $4, 'pending', $5, 0)
         RETURNING *`,
        [orgId, fulfillmentId, wo.productName, wo.qty, JSON.stringify(bomsData)]
      );
      created.push(result.rows[0]);
    }

    // Update fulfillment status
    await client.query(
      `UPDATE booth_fulfillments SET status = 'dispatched' WHERE id = $1 AND org_id = $2`,
      [fulfillmentId, orgId]
    );

    await client.query('COMMIT');

    // Broadcast each new work order
    for (const wo of created) {
      broadcast(orgId, 'work_order_updated', wo);
    }

    return created;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
