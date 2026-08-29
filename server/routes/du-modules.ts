import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import type { JwtPayload } from '../auth.js';
import { stripPriceFields } from '../services/fulfillment-service.js';

const router = Router();

// ====== DU/DX: Full visibility ======
const duRouter = Router();
duRouter.use(requireAuth, requireRole('du', 'dx'));

duRouter.get('/dl/tasks', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const status = req.query.status as string;
    let where = 'WHERE org_id = $1'; const params: any[] = [user.orgId]; let idx = 2;
    if (status) { where += ` AND status = $${idx}`; params.push(status); idx++; }
    const r = await pool.query(`SELECT * FROM booth_dl_tasks ${where} ORDER BY created_at DESC`, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

duRouter.post('/dl/tasks', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { fulfillmentId, pickupAddr, deliveryAddr, customerName, customerPhone, remark } = req.body;
    const taskNo = `DL${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const r = await pool.query(
      `INSERT INTO booth_dl_tasks (org_id, task_no, fulfillment_id, pickup_addr, delivery_addr, customer_name, customer_phone, remark)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [user.orgId, taskNo, fulfillmentId, pickupAddr, deliveryAddr, customerName, customerPhone, remark]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

duRouter.post('/dl/tasks/:id/reassign', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { assigneeId } = req.body;
    const r = await pool.query(
      `UPDATE booth_dl_tasks SET assignee_id = $1, assigned_at = NOW(), status = CASE WHEN status = 'exception' THEN 'assigned' ELSE status END, updated_at = NOW()
       WHERE id = $2 AND org_id = $3 RETURNING *`,
      [assigneeId, req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

duRouter.post('/dl/tasks/:id/close', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `UPDATE booth_dl_tasks SET status = 'signed', updated_at = NOW() WHERE id = $1 AND org_id = $2 AND status = 'exception' RETURNING *`,
      [req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot close: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

duRouter.get('/svc/tasks', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const status = req.query.status as string;
    let where = 'WHERE org_id = $1'; const params: any[] = [user.orgId]; let idx = 2;
    if (status) { where += ` AND status = $${idx}`; params.push(status); idx++; }
    const r = await pool.query(`SELECT * FROM booth_svc_tasks ${where} ORDER BY created_at DESC`, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

duRouter.post('/svc/tasks', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { fulfillmentId, serviceContent, customerName, customerPhone, requiredAt, remark } = req.body;
    const taskNo = `SVC${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const r = await pool.query(
      `INSERT INTO booth_svc_tasks (org_id, task_no, fulfillment_id, service_content, customer_name, customer_phone, required_at, remark)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [user.orgId, taskNo, fulfillmentId, serviceContent, customerName, customerPhone, requiredAt, remark]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// Profit endpoints
duRouter.get('/fulfillments/:id/profit', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      'SELECT * FROM booth_profit_snapshots WHERE fulfillment_id = $1 AND org_id = $2',
      [req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.json({ success: true, data: { status: 'pending' } });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

duRouter.get('/profit', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const from = req.query.from as string;
    const to = req.query.to as string;
    let where = 'WHERE org_id = $1'; const params: any[] = [user.orgId]; let idx = 2;
    if (from) { where += ` AND created_at >= $${idx}`; params.push(from); idx++; }
    if (to) { where += ` AND created_at <= $${idx}`; params.push(to); idx++; }
    const r = await pool.query(`SELECT * FROM booth_profit_snapshots ${where} ORDER BY created_at DESC`, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// Inventory alerts (with unitCost for du/dx)
duRouter.get('/inventory/alerts', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT i.*, s.sku_code, s.name, s.safety_stock, s.unit, sc.unit_cost,
              CASE WHEN s.safety_stock > i.qty_on_hand THEN s.safety_stock - i.qty_on_hand ELSE 0 END as gap
       FROM booth_inventory i
       JOIN booth_skus s ON s.id = i.sku_id
       LEFT JOIN booth_sku_cost sc ON sc.org_id = i.org_id AND sc.sku_id = i.sku_id
       WHERE i.org_id = $1 AND i.qty_on_hand <= s.safety_stock
       ORDER BY s.name`,
      [user.orgId]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// WH stocktakes (view all)
duRouter.get('/wh/stocktakes', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query('SELECT * FROM booth_stocktake_orders WHERE org_id = $1 ORDER BY created_at DESC', [user.orgId]);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// WH batches
duRouter.get('/wh/batches', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const skuId = req.query.skuId as string;
    let where = 'WHERE b.org_id = $1'; const params: any[] = [user.orgId]; let idx = 2;
    if (skuId) { where += ` AND b.sku_id = $${idx}`; params.push(skuId); idx++; }
    const r = await pool.query(
      `SELECT b.*, s.name as sku_name, s.sku_code, sc.unit_cost
       FROM booth_stock_batches b
       JOIN booth_skus s ON s.id = b.sku_id
       LEFT JOIN booth_sku_cost sc ON sc.org_id = b.org_id AND sc.sku_id = b.sku_id
       ${where} ORDER BY b.expiry_date ASC`,
      params
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// FAB QC view
duRouter.get('/fab/qc', async (req, res, next) => {
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

// ====== Users list (for dispatch) ======
duRouter.get('/users', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT id, name, phone, hats, role FROM booth_users WHERE org_id = $1 AND role = 'dexx' AND is_active = true ORDER BY name`,
      [user.orgId]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

export default duRouter;
