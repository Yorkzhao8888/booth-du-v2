import { pool } from '../db.js';

/**
 * Recalculate moving weighted average cost for a SKU after purchase receipt.
 * Must be called within a transaction with FOR UPDATE lock on booth_sku_cost.
 */
export async function recalcUnitCost(
  client: any,
  orgId: number,
  skuId: number,
  receivedQty: number,
  unitPrice: number
): Promise<number> {
  const lockRes = await client.query(
    `SELECT unit_cost, total_qty FROM booth_sku_cost
     WHERE org_id = $1 AND sku_id = $2 FOR UPDATE`,
    [orgId, skuId]
  );

  let oldUnit = 0;
  let oldQty = 0;
  if (lockRes.rows.length > 0) {
    oldUnit = parseFloat(lockRes.rows[0].unit_cost) || 0;
    oldQty = parseFloat(lockRes.rows[0].total_qty) || 0;
  }

  const newQty = oldQty + receivedQty;
  const newUnit = newQty > 0 ? (oldUnit * oldQty + unitPrice * receivedQty) / newQty : 0;

  if (lockRes.rows.length > 0) {
    await client.query(
      `UPDATE booth_sku_cost SET unit_cost = $1, total_qty = $2, updated_at = NOW()
       WHERE org_id = $3 AND sku_id = $4`,
      [newUnit, newQty, orgId, skuId]
    );
  } else {
    await client.query(
      `INSERT INTO booth_sku_cost (org_id, sku_id, unit_cost, total_qty)
       VALUES ($1, $2, $3, $4)`,
      [orgId, skuId, newUnit, newQty]
    );
  }

  return newUnit;
}

/**
 * Get unit cost for a SKU.
 */
export async function getUnitCost(orgId: number, skuId: number): Promise<number> {
  const res = await pool.query(
    'SELECT unit_cost FROM booth_sku_cost WHERE org_id = $1 AND sku_id = $2',
    [orgId, skuId]
  );
  return res.rows.length > 0 ? parseFloat(res.rows[0].unit_cost) || 0 : 0;
}

/**
 * Generate next PO number.
 */
export async function nextPoNo(orgId: number): Promise<string> {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const res = await pool.query(
    `SELECT po_no FROM booth_purchase_orders
     WHERE org_id = $1 AND po_no LIKE $2
     ORDER BY id DESC LIMIT 1`,
    [orgId, `PO${today}%`]
  );
  const seq = res.rows.length > 0
    ? parseInt(res.rows[0].po_no.slice(-4)) + 1
    : 1;
  return `PO${today}${String(seq).padStart(4, '0')}`;
}
