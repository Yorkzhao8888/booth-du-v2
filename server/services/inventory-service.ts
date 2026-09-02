import { pool } from '../db.js';

export interface InventoryItem {
  skuId: number;
  qty: number;
}

/**
 * Inbound: add stock, record transactions, create inbound order.
 */
export async function inbound(orgId: number, items: InventoryItem[], userId: number) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const item of items) {
      // Upsert inventory
      const invRes = await client.query(
        `SELECT id FROM booth_inventory WHERE org_id = $1 AND sku_id = $2`,
        [orgId, item.skuId]
      );

      if (invRes.rows.length === 0) {
        await client.query(
          `INSERT INTO booth_inventory (org_id, sku_id, qty_on_hand) VALUES ($1, $2, $3)`,
          [orgId, item.skuId, item.qty]
        );
      } else {
        await client.query(
          `UPDATE booth_inventory SET qty_on_hand = qty_on_hand + $1, updated_at = NOW()
           WHERE org_id = $2 AND sku_id = $3`,
          [item.qty, orgId, item.skuId]
        );
      }

      // Record transaction
      await client.query(
        `INSERT INTO booth_inventory_txn (org_id, sku_id, qty_change, type, operator_id)
         VALUES ($1, $2, $3, 'inbound', $4)`,
        [orgId, item.skuId, item.qty, userId]
      );
    }

    // Create inbound order record
    const orderRes = await client.query(
      `INSERT INTO booth_inbound_orders (org_id, items, status, operator_id)
       VALUES ($1, $2, 'posted', $3)
       RETURNING *`,
      [orgId, JSON.stringify(items), userId]
    );

    await client.query('COMMIT');
    return orderRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Outbound: deduct stock with row locks, record transactions, create outbound order.
 */
export async function outbound(orgId: number, items: InventoryItem[], userId: number) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const shortages: any[] = [];

    // Lock and validate
    for (const item of items) {
      const invRes = await client.query(
        `SELECT * FROM booth_inventory WHERE org_id = $1 AND sku_id = $2 FOR UPDATE`,
        [orgId, item.skuId]
      );
      if (invRes.rows.length === 0 || invRes.rows[0].qty_on_hand < item.qty) {
        shortages.push({
          skuId: item.skuId,
          required: item.qty,
          available: invRes.rows.length > 0 ? invRes.rows[0].qty_on_hand : 0,
        });
      }
    }

    if (shortages.length > 0) {
      throw { statusCode: 409, code: 'INSUFFICIENT_STOCK', error: 'Insufficient stock', shortages };
    }

    // Deduct
    for (const item of items) {
      await client.query(
        `UPDATE booth_inventory SET qty_on_hand = qty_on_hand - $1, updated_at = NOW()
         WHERE org_id = $2 AND sku_id = $3`,
        [item.qty, orgId, item.skuId]
      );

      await client.query(
        `INSERT INTO booth_inventory_txn (org_id, sku_id, qty_change, type, operator_id)
         VALUES ($1, $2, $3, 'outbound', $4)`,
        [orgId, item.skuId, -item.qty, userId]
      );
    }

    const orderRes = await client.query(
      `INSERT INTO booth_outbound_orders (org_id, items, status, operator_id)
       VALUES ($1, $2, 'posted', $3)
       RETURNING *`,
      [orgId, JSON.stringify(items), userId]
    );

    await client.query('COMMIT');
    return orderRes.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get inventory list. dex/exx roles do not see cost_price.
 * du/dx roles see full data including cost_price.
 */
export async function getInventory(orgId: number, role: string) {
  const includeCost = role === 'du' || role === 'dx';

  const sql = `
    SELECT i.id, i.org_id, i.sku_id, i.qty_on_hand, i.updated_at,
           s.sku_code, s.name, s.unit, s.safety_stock, s.is_active
           ${includeCost ? ', s.cost_price' : ''}
    FROM booth_inventory i
    JOIN booth_skus s ON s.id = i.sku_id
    WHERE i.org_id = $1 AND s.is_active = TRUE
    ORDER BY s.id
  `;

  const result = await pool.query(sql, [orgId]);
  return result.rows;
}
