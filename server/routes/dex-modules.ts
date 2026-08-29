import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import type { JwtPayload } from '../auth.js';

const router = Router();
router.use(requireAuth, requireRole('dex'));

// ====== DL Tasks: Dispatch & view ======
router.get('/dl/tasks', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const status = req.query.status as string;
    let where = 'WHERE org_id = $1'; const params: any[] = [user.orgId]; let idx = 2;
    if (status) { where += ` AND status = $${idx}`; params.push(status); idx++; }
    const r = await pool.query(`SELECT * FROM booth_dl_tasks ${where} ORDER BY created_at DESC`, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

router.post('/dl/tasks', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { fulfillmentId, pickupAddr, deliveryAddr, customerName, customerPhone, assigneeId, remark } = req.body;
    const taskNo = `DL${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const r = await pool.query(
      `INSERT INTO booth_dl_tasks (org_id, task_no, fulfillment_id, pickup_addr, delivery_addr, customer_name, customer_phone, assignee_id, assigned_at, remark)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,${assigneeId ? 'NOW()' : 'NULL'},$9) RETURNING *`,
      [user.orgId, taskNo, fulfillmentId, pickupAddr, deliveryAddr, customerName, customerPhone, assigneeId || null, remark]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

router.post('/dl/tasks/:id/assign', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { assigneeId } = req.body;
    const r = await pool.query(
      `UPDATE booth_dl_tasks SET assignee_id = $1, assigned_at = NOW(), status = CASE WHEN status = 'pending' THEN 'assigned' ELSE status END, updated_at = NOW()
       WHERE id = $2 AND org_id = $3 RETURNING *`,
      [assigneeId, req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== SVC Tasks: Dispatch & view ======
router.get('/svc/tasks', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const status = req.query.status as string;
    let where = 'WHERE org_id = $1'; const params: any[] = [user.orgId]; let idx = 2;
    if (status) { where += ` AND status = $${idx}`; params.push(status); idx++; }
    const r = await pool.query(`SELECT * FROM booth_svc_tasks ${where} ORDER BY created_at DESC`, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

router.post('/svc/tasks', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { fulfillmentId, serviceContent, customerName, customerPhone, assigneeId, requiredAt, remark } = req.body;
    const taskNo = `SVC${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const r = await pool.query(
      `INSERT INTO booth_svc_tasks (org_id, task_no, fulfillment_id, service_content, customer_name, customer_phone, assignee_id, assigned_at, required_at, remark)
       VALUES ($1,$2,$3,$4,$5,$6,$7,${assigneeId ? 'NOW()' : 'NULL'},$8,$9) RETURNING *`,
      [user.orgId, taskNo, fulfillmentId, serviceContent, customerName, customerPhone, assigneeId || null, requiredAt, remark]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

router.post('/svc/tasks/:id/assign', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { assigneeId } = req.body;
    const r = await pool.query(
      `UPDATE booth_svc_tasks SET assignee_id = $1, assigned_at = NOW(), status = CASE WHEN status = 'pending' THEN 'assigned' ELSE status END, updated_at = NOW()
       WHERE id = $2 AND org_id = $3 RETURNING *`,
      [assigneeId, req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== WH Stocktake: Approve ======
router.get('/wh/stocktakes', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query('SELECT * FROM booth_stocktake_orders WHERE org_id = $1 ORDER BY created_at DESC', [user.orgId]);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

router.post('/wh/stocktakes/:id/approve', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const user = (req as any).user as JwtPayload;
    await client.query('BEGIN');

    const r = await client.query(
      `UPDATE booth_stocktake_orders SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND org_id = $3 AND status = 'submitted' RETURNING *`,
      [user.userId, req.params.id, user.orgId]
    );
    if (!r.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Cannot approve: invalid state', code: 'INVALID_STATE' });
    }

    const so = r.rows[0];
    const items = so.items || [];
    for (const item of items) {
      const skuId = item.skuId || item.sku_id;
      const systemQty = parseFloat(item.systemQty || 0);
      const actualQty = parseFloat(item.actualQty || 0);
      const diff = actualQty - systemQty;
      if (Math.abs(diff) > 0.001) {
        // Apply adjustment
        await client.query(
          `INSERT INTO booth_inventory (org_id, sku_id, qty_on_hand) VALUES ($1, $2, $3)
           ON CONFLICT (org_id, sku_id) DO UPDATE SET qty_on_hand = booth_inventory.qty_on_hand + $3, updated_at = NOW()`,
          [user.orgId, skuId, diff]
        );
        await client.query(
          `INSERT INTO booth_inventory_txn (org_id, sku_id, qty_change, type, ref_type, ref_id, operator_id)
           VALUES ($1, $2, $3, 'stocktake_adjust', 'stocktake_order', $4, $5)`,
          [user.orgId, skuId, diff, so.id, user.userId]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

router.post('/wh/stocktakes/:id/reject', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `UPDATE booth_stocktake_orders SET status = 'draft', updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND status = 'submitted' RETURNING *`,
      [req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot reject: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== WH Batches ======
router.get('/wh/batches', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const skuId = req.query.skuId as string;
    let where = 'WHERE b.org_id = $1'; const params: any[] = [user.orgId]; let idx = 2;
    if (skuId) { where += ` AND b.sku_id = $${idx}`; params.push(skuId); idx++; }
    const r = await pool.query(
      `SELECT b.*, s.name as sku_name, s.sku_code
       FROM booth_stock_batches b
       JOIN booth_skus s ON s.id = b.sku_id
       ${where} ORDER BY b.expiry_date ASC`,
      params
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== FAB Operations view ======
router.get('/fab/operations', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const woId = req.query.workOrderId as string;
    let where = 'WHERE fo.org_id = $1'; const params: any[] = [user.orgId]; let idx = 2;
    if (woId) { where += ` AND fo.work_order_id = $${idx}`; params.push(woId); idx++; }
    const r = await pool.query(
      `SELECT fo.*, wo.product_name
       FROM booth_fab_operations fo
       JOIN booth_work_orders wo ON wo.id = fo.work_order_id
       ${where} ORDER BY fo.seq, fo.created_at`,
      params
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== QC view ======
router.get('/fab/qc', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT qc.*, wo.product_name, wo.qty as wo_qty
       FROM booth_quality_checks qc
       JOIN booth_work_orders wo ON wo.id = qc.work_order_id
       WHERE qc.org_id = $1 ORDER BY qc.created_at DESC`,
      [user.orgId]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== Inventory alerts ======
router.get('/inventory/alerts', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT i.*, s.sku_code, s.name, s.safety_stock, s.unit,
              CASE WHEN s.safety_stock > i.qty_on_hand THEN s.safety_stock - i.qty_on_hand ELSE 0 END as gap
       FROM booth_inventory i
       JOIN booth_skus s ON s.id = i.sku_id
       WHERE i.org_id = $1 AND i.qty_on_hand <= s.safety_stock
       ORDER BY s.name`,
      [user.orgId]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== Users list (for dispatch assignment) ======
router.get('/users', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT id, name, phone, hats, role FROM booth_users WHERE org_id = $1 AND role = 'dexx' AND is_active = true ORDER BY name`,
      [user.orgId]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== Restock request ======
router.post('/restock/request', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'items required', code: 'INVALID_PARAMS' });
    }
    // Write to outbox
    for (const item of items) {
      await pool.query(
        `INSERT INTO booth_outbox (org_id, event_type, payload) VALUES ($1, 'restock.requested', $2)`,
        [user.orgId, JSON.stringify({ skuId: item.skuId, skuName: item.skuName || '', qty: item.qty, orgId: user.orgId })]
      );
    }
    res.json({ success: true, data: { count: items.length } });
  } catch (err) { next(err); }
});

export default router;
