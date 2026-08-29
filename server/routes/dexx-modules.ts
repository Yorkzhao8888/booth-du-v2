import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole, requireHat } from '../auth.js';
import type { JwtPayload } from '../auth.js';
import { createProfitSnapshot } from '../services/profit-service.js';

const router = Router();

// ====== FAB: Report work (工序报工) ======
router.post('/fab/report', requireHat('FAB'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const user = (req as any).user as JwtPayload;
    const { workOrderId, seq, opName, qtyCompleted, remark } = req.body;

    await client.query('BEGIN');

    // Verify work order is in_progress
    const woRes = await client.query(
      'SELECT * FROM booth_work_orders WHERE id = $1 AND org_id = $2 FOR UPDATE',
      [workOrderId, user.orgId]
    );
    if (!woRes.rows.length || woRes.rows[0].status !== 'in_progress') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Work order not in progress', code: 'INVALID_STATE' });
    }

    // Check if this op already reported
    const existing = await client.query(
      'SELECT id FROM booth_fab_operations WHERE org_id = $1 AND work_order_id = $2 AND seq = $3',
      [user.orgId, workOrderId, seq]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Operation already reported', code: 'DUPLICATE' });
    }

    // Insert fab operation
    const foRes = await client.query(
      `INSERT INTO booth_fab_operations (org_id, work_order_id, seq, op_name, qty_completed, operator_id, remark)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [user.orgId, workOrderId, seq, opName, qtyCompleted, user.userId!, remark]
    );

    await client.query('COMMIT');
    res.json({ success: true, data: foRes.rows[0] });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// ====== FAB: Complete work order (triggers QC) ======
router.post('/fab/complete', requireHat('FAB'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const user = (req as any).user as JwtPayload;
    const { workOrderId } = req.body;

    await client.query('BEGIN');

    const woRes = await client.query(
      'SELECT * FROM booth_work_orders WHERE id = $1 AND org_id = $2 FOR UPDATE',
      [workOrderId, user.orgId]
    );
    if (!woRes.rows.length || woRes.rows[0].status !== 'in_progress') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Work order not in progress', code: 'INVALID_STATE' });
    }

    // Update work order status
    await client.query(
      `UPDATE booth_work_orders SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [workOrderId]
    );

    // Auto-create QC task
    await client.query(
      `INSERT INTO booth_quality_checks (org_id, work_order_id, qc_type, status)
       VALUES ($1, $2, 'final', 'pending')`,
      [user.orgId, workOrderId]
    );

    await client.query('COMMIT');
    res.json({ success: true, data: { workOrderId, message: 'Work order completed, QC task created' } });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// ====== FAB: QC execute ======
router.post('/fab/qc/execute', requireHat('FAB'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const user = (req as any).user as JwtPayload;
    const { qcId, passed, passedQty, failedQty, remark, detail } = req.body;

    await client.query('BEGIN');

    const qcRes = await client.query(
      'SELECT * FROM booth_quality_checks WHERE id = $1 AND org_id = $2 FOR UPDATE',
      [qcId, user.orgId]
    );
    if (!qcRes.rows.length || qcRes.rows[0].status !== 'pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'QC not pending', code: 'INVALID_STATE' });
    }

    const newStatus = passed ? 'passed' : 'failed';
    await client.query(
      `UPDATE booth_quality_checks SET status = $1, passed_qty = $2, failed_qty = $3, remark = $4, detail = $5, checked_at = NOW(), updated_at = NOW()
       WHERE id = $6`,
      [newStatus, passedQty || 0, failedQty || 0, remark, JSON.stringify(detail || {}), qcId]
    );

    // If QC passed, create profit snapshot
    if (passed) {
      const wo = qcRes.rows[0];
      const fulRes = await client.query(
        'SELECT id FROM booth_fulfillments WHERE work_order_id = $1 AND org_id = $2',
        [wo.work_order_id, user.orgId]
      );
      if (fulRes.rows.length > 0) {
        await createProfitSnapshot(user.orgId, fulRes.rows[0].id, wo.work_order_id);
      }
    }

    await client.query('COMMIT');
    const updated = await pool.query('SELECT * FROM booth_quality_checks WHERE id = $1', [qcId]);
    res.json({ success: true, data: updated.rows[0] });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// ====== FAB: Get my QC pending ======
router.get('/fab/qc/pending', requireHat('FAB'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT qc.*, wo.product_name, wo.qty as wo_qty
       FROM booth_quality_checks qc
       JOIN booth_work_orders wo ON wo.id = qc.work_order_id
       WHERE qc.org_id = $1 AND qc.status = 'pending'
       ORDER BY qc.created_at`,
      [user.orgId]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== WH: Stocktake create ======
router.post('/wh/stocktakes', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { items, remark } = req.body;
    const soNo = `ST${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const r = await pool.query(
      `INSERT INTO booth_stocktake_orders (org_id, so_no, status, items, created_by, remark)
       VALUES ($1, $2, 'draft', $3, $4, $5) RETURNING *`,
      [user.orgId, soNo, JSON.stringify(items || []), user.userId!, remark]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== WH: Stocktake submit ======
router.post('/wh/stocktakes/:id/submit', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { items } = req.body; // Updated items with actualQty
    const r = await pool.query(
      `UPDATE booth_stocktake_orders SET items = $1, status = 'submitted', submitted_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND org_id = $3 AND status IN ('draft', 'counting') RETURNING *`,
      [JSON.stringify(items || []), req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot submit: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== WH: My stocktakes ======
router.get('/wh/stocktakes', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query('SELECT * FROM booth_stocktake_orders WHERE org_id = $1 ORDER BY created_at DESC', [user.orgId]);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== WH: Batches view ======
router.get('/wh/batches', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const skuId = req.query.skuId as string;
    let where = 'WHERE b.org_id = $1'; const params: any[] = [user.orgId]; let idx = 2;
    if (skuId) { where += ` AND b.sku_id = $${idx}`; params.push(skuId); idx++; }
    const r = await pool.query(
      `SELECT b.*, s.name as sku_name, s.sku_code
       FROM booth_stock_batches b
       JOIN booth_skus s ON s.id = b.sku_id
       ${where} ORDER BY b.expiry_date ASC NULLS LAST`,
      params
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== DL: Queue (assigned tasks waiting to accept) ======
router.get('/dl/queue', requireHat('DL'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT * FROM booth_dl_tasks WHERE org_id = $1 AND assignee_id = $2 AND status = 'assigned' ORDER BY created_at`,
      [user.orgId, user.userId!]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== DL: Active (accepted/picked/delivering) ======
router.get('/dl/active', requireHat('DL'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT * FROM booth_dl_tasks WHERE org_id = $1 AND assignee_id = $2 AND status IN ('accepted','picked','delivering') ORDER BY updated_at DESC`,
      [user.orgId, user.userId!]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== DL: History (signed/exception/cancelled) ======
router.get('/dl/history', requireHat('DL'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT * FROM booth_dl_tasks WHERE org_id = $1 AND assignee_id = $2 AND status IN ('signed','exception','cancelled') ORDER BY updated_at DESC`,
      [user.orgId, user.userId!]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== DL: Get my tasks (all) ======
router.get('/dl/tasks', requireHat('DL'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT * FROM booth_dl_tasks WHERE org_id = $1 AND assignee_id = $2 ORDER BY created_at DESC`,
      [user.orgId, user.userId!]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// Helper: verify ownership
async function verifyDlOwnership(pool: any, taskId: string, orgId: number, userId: number | undefined) {
  if (!userId) return { error: 'UNAUTHORIZED', status: 401 };
  const r = await pool.query('SELECT * FROM booth_dl_tasks WHERE id = $1 AND org_id = $2', [taskId, orgId]);
  if (!r.rows.length) return { error: 'NOT_FOUND', status: 404 };
  if (r.rows[0].assignee_id !== userId) return { error: 'Not your task', status: 403 };
  return { task: r.rows[0] };
}

// ====== DL: Accept ======
router.post('/dl/tasks/:id/accept', requireHat('DL'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const check = await verifyDlOwnership(pool, req.params.id, user.orgId, user.userId);
    if ('error' in check) return res.status(check.status || 400).json({ success: false, error: check.error, code: check.error });
    const r = await pool.query(
      `UPDATE booth_dl_tasks SET status = 'accepted', accepted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND assignee_id = $3 AND status = 'assigned' RETURNING *`,
      [req.params.id, user.orgId, user.userId!]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot accept: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== DL: Pick ======
router.post('/dl/tasks/:id/pick', requireHat('DL'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const check = await verifyDlOwnership(pool, req.params.id, user.orgId, user.userId);
    if ('error' in check) return res.status(check.status || 400).json({ success: false, error: check.error, code: check.error });
    const r = await pool.query(
      `UPDATE booth_dl_tasks SET status = 'picked', picked_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND assignee_id = $3 AND status = 'accepted' RETURNING *`,
      [req.params.id, user.orgId, user.userId!]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot pick: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== DL: Deliver ======
router.post('/dl/tasks/:id/deliver', requireHat('DL'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const check = await verifyDlOwnership(pool, req.params.id, user.orgId, user.userId);
    if ('error' in check) return res.status(check.status || 400).json({ success: false, error: check.error, code: check.error });
    const r = await pool.query(
      `UPDATE booth_dl_tasks SET status = 'delivering', started_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND assignee_id = $3 AND status = 'picked' RETURNING *`,
      [req.params.id, user.orgId, user.userId!]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot deliver: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== DL: Sign ======
router.post('/dl/tasks/:id/sign', requireHat('DL'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const check = await verifyDlOwnership(pool, req.params.id, user.orgId, user.userId);
    if ('error' in check) return res.status(check.status || 400).json({ success: false, error: check.error, code: check.error });
    const { signer } = req.body;
    const r = await pool.query(
      `UPDATE booth_dl_tasks SET status = 'signed', signer = $1, signed_at = NOW(), completed_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND org_id = $3 AND assignee_id = $4 AND status = 'delivering' RETURNING *`,
      [signer || user.userId!, req.params.id, user.orgId, user.userId!]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot sign: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== DL: start (alias for accept, backward compat) ======
router.post('/dl/tasks/:id/start', requireHat('DL'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `UPDATE booth_dl_tasks SET status = 'accepted', accepted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND assignee_id = $3 AND status = 'assigned' RETURNING *`,
      [req.params.id, user.orgId, user.userId!]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot start: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== DL: Complete (alias for sign, backward compat) ======
router.post('/dl/tasks/:id/complete', requireHat('DL'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { signedBy, signTime } = req.body;
    const r = await pool.query(
      `UPDATE booth_dl_tasks SET status = 'signed', signer = $1, signed_at = $2, completed_at = NOW(), updated_at = NOW()
       WHERE id = $3 AND org_id = $4 AND assignee_id = $5 AND status IN ('delivering','picked','accepted') RETURNING *`,
      [signedBy || user.userId!, signTime || new Date(), req.params.id, user.orgId, user.userId!]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot complete: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== DL: Report exception ======
router.post('/dl/tasks/:id/exception', requireHat('DL'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const check = await verifyDlOwnership(pool, req.params.id, user.orgId, user.userId);
    if ('error' in check) return res.status(check.status || 400).json({ success: false, error: check.error, code: check.error });
    const { reason, detail } = req.body;
    const r = await pool.query(
      `UPDATE booth_dl_tasks SET status = 'exception', exception_reason = $1, remark = $2, updated_at = NOW()
       WHERE id = $3 AND org_id = $4 AND assignee_id = $5 AND status IN ('assigned','accepted','picked','delivering') RETURNING *`,
      [reason, detail, req.params.id, user.orgId, user.userId!]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot report exception: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== SVC: Queue (assigned tasks waiting to accept) ======
router.get('/svc/queue', requireHat('SVC'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT * FROM booth_svc_tasks WHERE org_id = $1 AND assignee_id = $2 AND status = 'assigned' ORDER BY created_at`,
      [user.orgId, user.userId!]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== SVC: Active (accepted/in_service) ======
router.get('/svc/active', requireHat('SVC'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT * FROM booth_svc_tasks WHERE org_id = $1 AND assignee_id = $2 AND status IN ('accepted','in_service') ORDER BY updated_at DESC`,
      [user.orgId, user.userId!]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== SVC: History ======
router.get('/svc/history', requireHat('SVC'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT * FROM booth_svc_tasks WHERE org_id = $1 AND assignee_id = $2 AND status IN ('completed','exception','cancelled') ORDER BY updated_at DESC`,
      [user.orgId, user.userId!]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== SVC: Get my tasks (all) ======
router.get('/svc/tasks', requireHat('SVC'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT * FROM booth_svc_tasks WHERE org_id = $1 AND assignee_id = $2 ORDER BY created_at DESC`,
      [user.orgId, user.userId!]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== SVC: Accept ======
router.post('/svc/tasks/:id/accept', requireHat('SVC'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `UPDATE booth_svc_tasks SET status = 'accepted', accepted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND assignee_id = $3 AND status = 'assigned' RETURNING *`,
      [req.params.id, user.orgId, user.userId!]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot accept: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== SVC: Start (accepted → in_service) ======
router.post('/svc/tasks/:id/start', requireHat('SVC'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `UPDATE booth_svc_tasks SET status = 'in_service', started_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND assignee_id = $3 AND status = 'accepted' RETURNING *`,
      [req.params.id, user.orgId, user.userId!]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot start: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== SVC: Complete (in_service → completed) ======
router.post('/svc/tasks/:id/complete', requireHat('SVC'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { result, remark } = req.body;
    const r = await pool.query(
      `UPDATE booth_svc_tasks SET status = 'completed', result = $1, remark = COALESCE($2, remark), completed_at = NOW(), updated_at = NOW()
       WHERE id = $3 AND org_id = $4 AND assignee_id = $5 AND status = 'in_service' RETURNING *`,
      [result, remark, req.params.id, user.orgId, user.userId!]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot complete: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== SVC: Report exception ======
router.post('/svc/tasks/:id/exception', requireHat('SVC'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { reason, detail } = req.body;
    const r = await pool.query(
      `UPDATE booth_svc_tasks SET status = 'exception', exception_reason = $1, remark = $2, updated_at = NOW()
       WHERE id = $3 AND org_id = $4 AND assignee_id = $5 AND status IN ('assigned','accepted','in_service') RETURNING *`,
      [reason, detail, req.params.id, user.orgId, user.userId!]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot report exception: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

export default router;
