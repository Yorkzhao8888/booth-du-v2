/**
 * exx DL 配送路由 (TECH-DEBT-1 从 exx-modules.ts 拆出)
 * 覆盖: 配送队列 / 进行中 / 历史 / 任务接取 / 拣货 / 配送中 / 签收 / 异常上报
 * 挂载: /api/booth/exx (见 exx-modules.ts 聚合)
 */
import { Router } from 'express';
import { pool } from '../db.js';
import { requireHat } from '../auth.js';
import type { JwtPayload } from '../auth.js';

const router = Router();

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
      `UPDATE booth_dl_tasks SET status = 'delivering', delivering_at = NOW(), updated_at = NOW()
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
      `UPDATE booth_dl_tasks SET status = 'signed', signer = $1, signed_at = NOW(), updated_at = NOW()
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
      `UPDATE booth_dl_tasks SET status = 'signed', signer = $1, signed_at = $2, updated_at = NOW()
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

export default router;
