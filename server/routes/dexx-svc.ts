/**
 * dexx SVC 服务路由 (TECH-DEBT-1 从 dexx-modules.ts 拆出)
 * 覆盖: 服务队列 / 进行中 / 历史 / 任务接取 / 开始服务 / 完成服务 / 异常上报
 * 挂载: /api/booth/dexx (见 dexx-modules.ts 聚合)
 */
import { Router } from 'express';
import { pool } from '../db.js';
import { requireHat } from '../auth.js';
import type { JwtPayload } from '../auth.js';

const router = Router();

// Helper: verify ownership
async function verifySvcOwnership(pool: any, taskId: string, orgId: number, userId: number | undefined) {
  if (!userId) return { error: 'UNAUTHORIZED', status: 401 };
  const r = await pool.query('SELECT * FROM booth_svc_tasks WHERE id = $1 AND org_id = $2', [taskId, orgId]);
  if (!r.rows.length) return { error: 'NOT_FOUND', status: 404 };
  if (r.rows[0].assignee_id !== userId) return { error: 'Not your task', status: 403 };
  return { task: r.rows[0] };
}

// ====== SVC: Queue (assigned tasks waiting to accept) ======
router.get('/svc/queue', requireHat('SVC'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { service_category } = req.query;
    let sql = `SELECT * FROM booth_svc_tasks WHERE org_id = $1 AND assignee_id = $2 AND status = 'assigned'`;
    const params: any[] = [user.orgId, user.userId!];
    if (service_category) { sql += ` AND service_category = $${params.length + 1}`; params.push(service_category); }
    sql += ` ORDER BY created_at`;
    const r = await pool.query(sql, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== SVC: Active (accepted/in_service) ======
router.get('/svc/active', requireHat('SVC'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { service_category } = req.query;
    let sql = `SELECT * FROM booth_svc_tasks WHERE org_id = $1 AND assignee_id = $2 AND status IN ('accepted','in_service')`;
    const params: any[] = [user.orgId, user.userId!];
    if (service_category) { sql += ` AND service_category = $${params.length + 1}`; params.push(service_category); }
    sql += ` ORDER BY updated_at DESC`;
    const r = await pool.query(sql, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== SVC: History ======
router.get('/svc/history', requireHat('SVC'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { service_category } = req.query;
    let sql = `SELECT * FROM booth_svc_tasks WHERE org_id = $1 AND assignee_id = $2 AND status IN ('completed','exception','cancelled')`;
    const params: any[] = [user.orgId, user.userId!];
    if (service_category) { sql += ` AND service_category = $${params.length + 1}`; params.push(service_category); }
    sql += ` ORDER BY updated_at DESC`;
    const r = await pool.query(sql, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== SVC: Get my tasks (all) ======
router.get('/svc/tasks', requireHat('SVC'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { service_category } = req.query;
    let sql = `SELECT * FROM booth_svc_tasks WHERE org_id = $1 AND assignee_id = $2`;
    const params: any[] = [user.orgId, user.userId!];
    if (service_category) { sql += ` AND service_category = $${params.length + 1}`; params.push(service_category); }
    sql += ` ORDER BY created_at DESC`;
    const r = await pool.query(sql, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== SVC: Accept ======
router.post('/svc/tasks/:id/accept', requireHat('SVC'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const check = await verifySvcOwnership(pool, req.params.id, user.orgId, user.userId);
    if ('error' in check) return res.status(check.status || 400).json({ success: false, error: check.error, code: check.error });
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
    const { remark } = req.body;
    const r = await pool.query(
      `UPDATE booth_svc_tasks SET status = 'completed', remark = COALESCE($1, remark), completed_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND org_id = $3 AND assignee_id = $4 AND status = 'in_service' RETURNING *`,
      [remark, req.params.id, user.orgId, user.userId!]
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
