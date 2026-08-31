import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole, requireHat } from '../auth.js';
import type { JwtPayload } from '../auth.js';
import { acceptWorkOrder, startWorkOrder, completeWorkOrder } from '../services/work-order-service.js';
import { inbound, outbound } from '../services/inventory-service.js';
import { stripPriceFields } from '../services/fulfillment-service.js';

const router = Router();

router.use(requireAuth, requireRole('dexx'));

// ==================== FAB Routes (require FAB hat) ====================

// GET /fab/queue - pending work orders
router.get('/fab/queue', requireHat('FAB'), async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;

    const result = await pool.query(
      `SELECT wo.*, f.shop_order_id, st.name as station_name
       FROM booth_work_orders wo
       LEFT JOIN booth_fulfillments f ON f.id = wo.fulfillment_id
       LEFT JOIN booth_stations st ON st.id = wo.station_id
       WHERE wo.org_id = $1 AND wo.status IN ('pending', 'Pending', 'Dispatched')
       ORDER BY wo.priority DESC NULLS LAST, wo.created_at ASC`,
      [orgId]
    );

    res.json({ success: true, data: { items: stripPriceFields(result.rows), total: result.rows.length } });
  } catch (err) {
    next(err);
  }
});

// GET /fab/active - accepted or preparing
router.get('/fab/active', requireHat('FAB'), async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;

    const result = await pool.query(
      `SELECT wo.*, u.name as operator_name, a.name as accepted_by_name, f.shop_order_id, st.name as station_name
       FROM booth_work_orders wo
       LEFT JOIN booth_users u ON u.id = wo.operator_id
       LEFT JOIN booth_users a ON a.id = wo.accepted_by
       LEFT JOIN booth_fulfillments f ON f.id = wo.fulfillment_id
       LEFT JOIN booth_stations st ON st.id = wo.station_id
       WHERE wo.org_id = $1 AND wo.status IN ('accepted', 'preparing', 'Accepted', 'Running')
       ORDER BY wo.priority DESC NULLS LAST, wo.created_at ASC`,
      [orgId]
    );

    res.json({ success: true, data: { items: stripPriceFields(result.rows), total: result.rows.length } });
  } catch (err) {
    next(err);
  }
});

// GET /fab/history - completed/cancelled with pagination
router.get('/fab/history', requireHat('FAB'), async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const offset = (page - 1) * pageSize;

    const countRes = await pool.query(
      `SELECT COUNT(*) as cnt FROM booth_work_orders
       WHERE org_id = $1 AND status IN ('completed', 'cancelled', 'Completed', 'Cancelled', 'Failed', 'Archived')`,
      [orgId]
    );
    const total = parseInt(countRes.rows[0].cnt);

    const dataRes = await pool.query(
      `SELECT wo.*, u.name as operator_name, a.name as accepted_by_name, f.shop_order_id, st.name as station_name
       FROM booth_work_orders wo
       LEFT JOIN booth_users u ON u.id = wo.operator_id
       LEFT JOIN booth_users a ON a.id = wo.accepted_by
       LEFT JOIN booth_fulfillments f ON f.id = wo.fulfillment_id
       LEFT JOIN booth_stations st ON st.id = wo.station_id
       WHERE wo.org_id = $1 AND wo.status IN ('completed', 'cancelled', 'Completed', 'Cancelled', 'Failed', 'Archived')
       ORDER BY wo.created_at DESC
       LIMIT $2 OFFSET $3`,
      [orgId, pageSize, offset]
    );

    res.json({
      success: true,
      data: { items: stripPriceFields(dataRes.rows), total, page, pageSize },
    });
  } catch (err) {
    next(err);
  }
});

// POST /fab/work-orders/:id/accept
router.post('/fab/work-orders/:id/accept', requireHat('FAB'), async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const id = parseInt(req.params.id);

    const result = await acceptWorkOrder(id, user.userId);
    res.json({ success: true, data: result });
  } catch (err: any) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, error: err.error, code: err.code });
    }
    next(err);
  }
});

// POST /fab/work-orders/:id/start
router.post('/fab/work-orders/:id/start', requireHat('FAB'), async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const id = parseInt(req.params.id);

    const result = await startWorkOrder(id, user.userId);
    res.json({ success: true, data: result });
  } catch (err: any) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        success: false,
        error: err.error,
        code: err.code,
        ...(err.shortages ? { shortages: err.shortages } : {}),
      });
    }
    next(err);
  }
});

// POST /fab/work-orders/:id/complete
router.post('/fab/work-orders/:id/complete', requireHat('FAB'), async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const id = parseInt(req.params.id);

    const result = await completeWorkOrder(id, user.userId);
    res.json({ success: true, data: result });
  } catch (err: any) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, error: err.error, code: err.code });
    }
    next(err);
  }
});

// ==================== WH Routes (require WH hat) ====================

// GET /wh/inventory - minimal fields
router.get('/wh/inventory', requireHat('WH'), async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;

    const result = await pool.query(
      `SELECT s.id, s.name, s.unit, i.qty_on_hand as "qtyOnHand", s.safety_stock as "safetyStock"
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

// POST /wh/inbound
router.post('/wh/inbound', requireHat('WH'), async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'items array is required', code: 'MISSING_FIELDS' });
    }

    const result = await inbound(user.orgId, items, user.userId);
    res.json({ success: true, data: result });
  } catch (err: any) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ success: false, error: err.error, code: err.code });
    }
    next(err);
  }
});

// POST /wh/outbound
router.post('/wh/outbound', requireHat('WH'), async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'items array is required', code: 'MISSING_FIELDS' });
    }

    const result = await outbound(user.orgId, items, user.userId);
    res.json({ success: true, data: result });
  } catch (err: any) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        success: false,
        error: err.error,
        code: err.code,
        ...(err.shortages ? { shortages: err.shortages } : {}),
      });
    }
    next(err);
  }
});

// GET /wh/txns - paginated
router.get('/wh/txns', requireHat('WH'), async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const orgId = user.orgId;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const offset = (page - 1) * pageSize;

    const countRes = await pool.query(
      'SELECT COUNT(*) as cnt FROM booth_inventory_txn WHERE org_id = $1',
      [orgId]
    );
    const total = parseInt(countRes.rows[0].cnt);

    const dataRes = await pool.query(
      `SELECT t.*, s.name as sku_name, s.sku_code, s.unit
       FROM booth_inventory_txn t
       JOIN booth_skus s ON s.id = t.sku_id
       WHERE t.org_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [orgId, pageSize, offset]
    );

    res.json({
      success: true,
      data: { items: dataRes.rows, total, page, pageSize },
    });
  } catch (err) {
    next(err);
  }
});

// GET /dashboard - dexx dashboard stats
router.get('/dashboard', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const orgId = user.orgId;
    const userId = user.userId!;
    const hats = user.hats || [];

    const stats: any = {};

    if (hats.includes('FAB')) {
      const queueRes = await pool.query(
        "SELECT COUNT(*) as cnt FROM booth_work_orders WHERE org_id = $1 AND status = 'pending'",
        [orgId]
      );
      const activeRes = await pool.query(
        "SELECT COUNT(*) as cnt FROM booth_work_orders WHERE org_id = $1 AND status IN ('accepted','preparing') AND operator_id = $2",
        [orgId, userId]
      );
      const historyRes = await pool.query(
        "SELECT COUNT(*) as cnt FROM booth_work_orders WHERE org_id = $1 AND status = 'completed' AND operator_id = $2",
        [orgId, userId]
      );
      stats.fabQueue = parseInt(queueRes.rows[0].cnt);
      stats.fabActive = parseInt(activeRes.rows[0].cnt);
      stats.fabHistory = parseInt(historyRes.rows[0].cnt);
    }

    if (hats.includes('WH')) {
      const invRes = await pool.query(
        'SELECT COUNT(*) as cnt FROM booth_inventory WHERE org_id = $1',
        [orgId]
      );
      const lowStockRes = await pool.query(
        `SELECT COUNT(*) as cnt FROM booth_inventory i
         JOIN booth_skus s ON s.id = i.sku_id
         WHERE i.org_id = $1 AND i.qty_on_hand <= s.safety_stock`,
        [orgId]
      );
      stats.whSkuCount = parseInt(invRes.rows[0].cnt);
      stats.whLowStock = parseInt(lowStockRes.rows[0].cnt);
    }

    if (hats.includes('DL')) {
      const dlRes = await pool.query(
        "SELECT COUNT(*) as cnt FROM booth_dl_tasks WHERE org_id = $1 AND assignee_id = $2 AND status IN ('assigned','accepted','picked','delivering')",
        [orgId, userId]
      );
      stats.dlActive = parseInt(dlRes.rows[0].cnt);
    }

    if (hats.includes('SVC')) {
      const svcRes = await pool.query(
        "SELECT COUNT(*) as cnt FROM booth_svc_tasks WHERE org_id = $1 AND assignee_id = $2 AND status IN ('assigned','accepted','in_service')",
        [orgId, userId]
      );
      stats.svcActive = parseInt(svcRes.rows[0].cnt);
    }

    res.json({ success: true, data: stats });
  } catch (err) {
    next(err);
  }
});

export default router;
