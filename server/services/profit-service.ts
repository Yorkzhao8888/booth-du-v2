import { pool } from '../db.js';
import { getUnitCost } from './purchase-service.js';

/**
 * Create or update profit snapshot for a fulfillment.
 * Called when all work orders for a fulfillment are completed + QC passed.
 * Idempotent via UNIQUE(org_id, fulfillment_id).
 */
export async function createProfitSnapshot(
  orgId: number,
  fulfillmentId: number,
  workOrderId: number
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check idempotency
    const existing = await client.query(
      'SELECT id FROM booth_profit_snapshots WHERE org_id = $1 AND fulfillment_id = $2',
      [orgId, fulfillmentId]
    );
    if (existing.rows.length > 0) {
      await client.query('COMMIT');
      return;
    }

    // Get fulfillment items for revenue calculation
    const fulRes = await client.query(
      'SELECT items FROM booth_fulfillments WHERE id = $1 AND org_id = $2',
      [fulfillmentId, orgId]
    );
    if (fulRes.rows.length === 0) {
      await client.query('COMMIT');
      return;
    }

    const items = fulRes.rows[0].items || [];
    let revenue = 0;
    for (const item of items) {
      const salePrice = parseFloat(item.salePrice || item.price || item.unitPrice || 0);
      const qty = parseInt(item.qty || 0);
      revenue += salePrice * qty;
    }

    // Get work order BOMs for material cost calculation
    const woRes = await client.query(
      'SELECT boms, qty FROM booth_work_orders WHERE id = $1 AND org_id = $2',
      [workOrderId, orgId]
    );
    if (woRes.rows.length === 0) {
      await client.query('COMMIT');
      return;
    }

    const boms = woRes.rows[0].boms || [];
    const woQty = woRes.rows[0].qty || 1;
    let materialCost = 0;
    const costDetail: any[] = [];

    for (const bom of boms) {
      const bomItems = bom.items || [];
      for (const bi of bomItems) {
        const skuId = bi.skuId || bi.sku_id;
        const qty = (bi.qty || 0) * woQty;
        const unit = bi.unit || 'g';
        const divisor = (unit === 'g' || unit === 'ml') ? 1000 : 1;
        const unitCost = await getUnitCost(orgId, skuId);
        const amount = (qty / divisor) * unitCost;
        materialCost += amount;
        costDetail.push({
          skuId,
          skuName: bi.skuName || bi.sku_name || '',
          qty,
          unitCost,
          amount: Math.round(amount * 100) / 100,
        });
      }
    }

    const grossProfit = revenue - materialCost;
    const margin = revenue > 0 ? Math.round((grossProfit / revenue) * 10000) / 100 : 0;

    await client.query(
      `INSERT INTO booth_profit_snapshots
       (org_id, fulfillment_id, work_order_id, revenue, material_cost, gross_profit, margin, cost_detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [orgId, fulfillmentId, workOrderId, revenue, materialCost, grossProfit, margin, JSON.stringify(costDetail)]
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
