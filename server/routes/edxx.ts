import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole, requireHat } from '../auth.js';
import type { JwtPayload } from '../auth.js';
import { acceptWorkOrder, startWorkOrder, completeWorkOrder } from '../services/work-order-service.js';
import { inbound, outbound } from '../services/inventory-service.js';
import { stripPriceFields } from '../services/fulfillment-service.js';
import { createAndonEvent } from '../services/andon-service.js';

const router = Router();

router.use(requireAuth, requireRole('edxx'));

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
      // 安灯联动：开始制作缺料(INSUFFICIENT_STOCK 409) → 自动落 shortage 安灯
      if (err.code === 'INSUFFICIENT_STOCK') {
        try {
          // @ts-ignore
          const user = req.user as JwtPayload;
          const woId = parseInt(req.params.id);
          const andon = await createAndonEvent({
            orgId: user.orgId as number,
            type: 'shortage',
            severity: (err.shortages?.length ?? 0) > 2 ? 'high' : 'medium',
            message: `开始制作缺料：${(err.shortages || []).map((s: any) => `${s.name || s.sku || s.item}缺${s.shortage ?? s.short ?? ''}`).join('；') || '物料不足'}`,
            workOrderId: woId,
            callerId: user.userId,
            auto: true,
          });
          return res.status(409).json({
            success: false,
            error: err.error,
            code: err.code,
            ...(err.shortages ? { shortages: err.shortages } : {}),
            andonId: andon.id,
            andonNo: `AND-${andon.id}`,
          });
        } catch (andonErr) {
          console.error('[andon] shortage auto-andon failed:', andonErr);
        }
      }
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

// ==================== G-005 凭证联动 (BOOTH-PRD-003) ====================

// GET /fab/work-orders/:id/evidences — 凭证列表
router.get('/fab/work-orders/:id/evidences', requireHat('FAB'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    const r = await pool.query(
      `SELECT id, work_order_id, evidence_type, url, note, uploaded_by, created_at
       FROM booth_work_order_evidences WHERE work_order_id = $1 ORDER BY id ASC`,
      [id]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    next(err);
  }
});

// POST /fab/work-orders/:id/evidences — 上传凭证 → 满足条件自动流转至 completed（无需人工二次确认）
// body: { url*, evidenceType?, note? }
router.post('/fab/work-orders/:id/evidences', requireHat('FAB'), async (req, res, next) => {
  try {
    // @ts-ignore
    const user = req.user as JwtPayload;
    const id = parseInt(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ success: false, error: 'invalid work order id', code: 'INVALID_ID' });
    }
    const body: any = req.body || {};
    const url = String(body.url || '').trim();
    if (!url) {
      return res.status(400).json({ success: false, error: 'url is required', code: 'MISSING_URL' });
    }
    const evidenceType = String(body.evidenceType || 'photo');

    const woRes = await pool.query(`SELECT * FROM booth_work_orders WHERE id = $1`, [id]);
    if (woRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Work order not found', code: 'NOT_FOUND' });
    }
    const wo = woRes.rows[0];
    if (wo.status === 'completed') {
      return res.status(400).json({ success: false, error: 'Work order already completed', code: 'INVALID_STATE' });
    }

    const ins = await pool.query(
      `INSERT INTO booth_work_order_evidences (org_id, work_order_id, evidence_type, url, note, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [wo.org_id, id, evidenceType, url, body.note ?? null, String(user.identity_id || user.userId || 'unknown')]
    );

    // [G-005 BDD-07] 凭证上传 → 状态自动推进: pending→accepted→preparing→completed (无需人工二次确认)
    // 轻量推进至 preparing（PRD-003 拆单工单无 BOM, 不触发库存扣减）, completed 经 completeWorkOrder 走完整回传链
    let completed: any = null;
    if (wo.status !== 'preparing') {
      await pool.query(
        `UPDATE booth_work_orders
         SET status = 'preparing',
             accepted_at = COALESCE(accepted_at, NOW()),
             started_at = COALESCE(started_at, NOW()),
             operator_id = CASE WHEN $1 > 0 AND EXISTS (SELECT 1 FROM booth_users WHERE id = $1) THEN COALESCE(operator_id, $1) ELSE operator_id END,
             progress = GREATEST(COALESCE(progress, 0), 10)
         WHERE id = $2`,
        [Number(user.userId) || 0, id]
      );
    }
    completed = await completeWorkOrder(id, user.userId);

    res.json({ success: true, data: { evidence: ins.rows[0], workOrder: completed, autoCompleted: true } });
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

// GET /dashboard - edxx dashboard stats
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
