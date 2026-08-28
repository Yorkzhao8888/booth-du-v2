import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import type { JwtPayload } from '../auth.js';
import { orgModes } from '../migrate.js';

const router = Router();

router.use(requireAuth, requireRole('du', 'dx'));

// Helper to get org mode
function getOrgMode(orgId: number): string {
  return orgModes.get(orgId) || 'du';
}

// GET /dashboard
router.get('/dashboard', async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;
    const orgMode = getOrgMode(orgId);

    // Today's orders
    const todayOrdersRes = await pool.query(
      `SELECT COUNT(*) as cnt FROM booth_fulfillments
       WHERE org_id = $1 AND created_at >= CURRENT_DATE`,
      [orgId]
    );
    const todayOrders = parseInt(todayOrdersRes.rows[0].cnt);

    let todayRevenue = 0;
    let todayGrossProfit = 0;
    let grossMargin = 0;

    if (orgMode === 'du') {
      // Revenue from fulfillments today
      const revRes = await pool.query(
        `SELECT COALESCE(SUM(
           (SELECT COALESCE(SUM((item->>'price')::int * (item->>'qty')::int), 0)
            FROM jsonb_array_elements(items) AS item)
         ), 0) as revenue
         FROM booth_fulfillments
         WHERE org_id = $1 AND created_at >= CURRENT_DATE AND status != 'cancelled'`,
        [orgId]
      );
      todayRevenue = parseInt(revRes.rows[0].revenue) || 0;

      // Calculate cost of goods sold from completed work orders today
      // For each completed work order, sum up the BOM item costs
      const costRes = await pool.query(
        `SELECT COALESCE(SUM(wo_cost.total_cost), 0) as total_cost
         FROM booth_work_orders wo
         CROSS JOIN LATERAL (
           SELECT COALESCE(SUM(item_cost.cost), 0) as total_cost
           FROM jsonb_array_elements(wo.boms) AS bom,
           LATERAL (
             SELECT COALESCE(SUM(
               (bi->>'qty')::int * wo.qty *
               (SELECT CASE s.unit WHEN 'g' THEN s.cost_price/1000 WHEN 'kg' THEN s.cost_price WHEN 'ml' THEN s.cost_price/1000 WHEN 'L' THEN s.cost_price ELSE s.cost_price END FROM booth_skus s WHERE s.id = (bi->>'skuId')::int)
             ), 0) as cost
             FROM jsonb_array_elements(bom->'items') AS bi
           ) AS item_cost
         ) AS wo_cost
         WHERE wo.org_id = $1 AND wo.status = 'completed' AND wo.completed_at >= CURRENT_DATE`,
        [orgId]
      );
      const totalCost = parseInt(costRes.rows[0].total_cost) || 0;

      todayGrossProfit = todayRevenue - totalCost;
      grossMargin = todayRevenue > 0 ? Math.round((todayGrossProfit / todayRevenue) * 10000) / 100 : 0;
    }

    // Pending and preparing work orders
    const woStatsRes = await pool.query(
      `SELECT status, COUNT(*) as cnt
       FROM booth_work_orders
       WHERE org_id = $1
       GROUP BY status`,
      [orgId]
    );
    const workOrderStats: Record<string, number> = {};
    for (const row of woStatsRes.rows) {
      workOrderStats[row.status] = parseInt(row.cnt);
    }

    // Low stock count
    const lowStockRes = await pool.query(
      `SELECT COUNT(*) as cnt
       FROM booth_inventory i
       JOIN booth_skus s ON s.id = i.sku_id
       WHERE i.org_id = $1 AND i.qty_on_hand < s.safety_stock`,
      [orgId]
    );
    const lowStockCount = parseInt(lowStockRes.rows[0].cnt);

    res.json({
      success: true,
      data: {
        todayOrders,
        ...(orgMode === 'du' ? { todayRevenue, todayGrossProfit, grossMargin } : {}),
        pendingWorkOrders: workOrderStats['pending'] || 0,
        preparingWorkOrders: workOrderStats['preparing'] || 0,
        lowStockCount,
        workOrderStats,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /orders - fulfillment list with pagination
router.get('/orders', async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const offset = (page - 1) * pageSize;
    const status = req.query.status as string;

    let whereClause = 'WHERE org_id = $1';
    const params: any[] = [orgId];
    let paramIdx = 2;

    if (status) {
      whereClause += ` AND status = $${paramIdx}`;
      params.push(status);
      paramIdx++;
    }

    const countRes = await pool.query(
      `SELECT COUNT(*) as cnt FROM booth_fulfillments ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0].cnt);

    const dataRes = await pool.query(
      `SELECT * FROM booth_fulfillments ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, pageSize, offset]
    );

    res.json({
      success: true,
      data: {
        items: dataRes.rows,
        total,
        page,
        pageSize,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /work-orders
router.get('/work-orders', async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const offset = (page - 1) * pageSize;
    const status = req.query.status as string;

    let whereClause = 'WHERE wo.org_id = $1';
    const params: any[] = [orgId];
    let paramIdx = 2;

    if (status) {
      whereClause += ` AND wo.status = $${paramIdx}`;
      params.push(status);
      paramIdx++;
    }

    const countRes = await pool.query(
      `SELECT COUNT(*) as cnt FROM booth_work_orders wo ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0].cnt);

    const dataRes = await pool.query(
      `SELECT wo.*, u.name as operator_name, a.name as accepted_by_name
       FROM booth_work_orders wo
       LEFT JOIN booth_users u ON u.id = wo.operator_id
       LEFT JOIN booth_users a ON a.id = wo.accepted_by
       ${whereClause}
       ORDER BY wo.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, pageSize, offset]
    );

    res.json({
      success: true,
      data: {
        items: dataRes.rows,
        total,
        page,
        pageSize,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /inventory
router.get('/inventory', async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;

    const result = await pool.query(
      `SELECT i.id, i.org_id, i.sku_id, i.qty_on_hand, i.updated_at,
              s.sku_code, s.name, s.unit, s.safety_stock, s.cost_price, s.is_active
       FROM booth_inventory i
       JOIN booth_skus s ON s.id = i.sku_id
       WHERE i.org_id = $1 AND s.is_active = TRUE
       ORDER BY s.id`,
      [orgId]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

// GET /boms
router.get('/boms', async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;
    const orgMode = getOrgMode(orgId);

    const bomsRes = await pool.query(
      `SELECT b.* FROM booth_boms b
       WHERE b.org_id = $1 AND b.is_active = TRUE
       ORDER BY b.id`,
      [orgId]
    );

    const boms = [];
    for (const bom of bomsRes.rows) {
      const itemsRes = await pool.query(
        `SELECT bi.id, bi.bom_id, bi.sku_id, bi.qty, bi.unit,
                s.name as sku_name, s.sku_code, s.cost_price
         FROM booth_bom_items bi
         JOIN booth_skus s ON s.id = bi.sku_id
         WHERE bi.bom_id = $1
         ORDER BY bi.id`,
        [bom.id]
      );

      const items = itemsRes.rows;
      let totalCost = 0;

      for (const item of items) {
        const divisor = item.unit === 'g' || item.unit === 'ml' ? 1000 : 1;
        totalCost += (item.qty * item.cost_price) / divisor;
      }

      const bomData: any = {
        ...bom,
        items,
        totalCost: Math.round(totalCost),
      };

      if (orgMode === 'du') {
        bomData.sale_price = bom.sale_price;
        bomData.grossMargin = bom.sale_price > 0
          ? Math.round(((bom.sale_price - totalCost) / bom.sale_price) * 10000) / 100
          : 0;
      }

      boms.push(bomData);
    }

    res.json({ success: true, data: boms });
  } catch (err) {
    next(err);
  }
});

export default router;
