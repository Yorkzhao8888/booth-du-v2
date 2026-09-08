/**
 * [BOOTH-PRD-003 / RD-004/005] 研发铺工艺管理 API
 * - 工艺 CRUD + 有序工序表（steps JSONB: [{seq, name}]）
 * - 拆单匹配依据: product_name 精确匹配生产单 items[].name（RD-001）
 * - GET /match?productName= 匹配预览（返回将拆出的工序链）
 */
import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { emitAudit } from '../services/audit-service.js';
import { broadcast } from '../sse.js';

const router = Router();

interface AuthedReq extends Request {
  user?: { orgId?: number; org_id?: number; identity_id?: string; role?: string };
}
function orgOf(req: AuthedReq): number {
  return Number(req.user?.orgId ?? req.user?.org_id ?? 1) || 1;
}

/** steps 归一校验: [{seq, name}] 非空且 seq/name 有效 */
function normalizeSteps(raw: unknown): Array<{ seq: number; name: string }> | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const steps = raw
    .map((s: any, i: number) => ({ seq: Number(s?.seq ?? i + 1) || i + 1, name: String(s?.name ?? '').trim() }))
    .filter((s) => s.name.length > 0);
  return steps.length > 0 ? steps : null;
}

// GET / — 工艺列表（含工序表）
router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = orgOf(req as AuthedReq);
    const r = await pool.query(
      `SELECT id, craft_code, craft_name, product_name, steps, enabled, created_at, updated_at
       FROM booth_crafts WHERE org_id = $1 ORDER BY id DESC`,
      [orgId]
    );
    return res.json({ success: true, data: r.rows });
  } catch (err) {
    return next(err);
  }
});

// GET /match?productName= — 工艺匹配预览（RD-001 拆单依据）
router.get('/match', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = orgOf(req as AuthedReq);
    const productName = String(req.query.productName || '').trim();
    if (!productName) {
      return res.status(400).json({ success: false, error: 'productName is required', code: 'MISSING_PRODUCT_NAME' });
    }
    const r = await pool.query(
      `SELECT id, craft_code, craft_name, steps FROM booth_crafts WHERE org_id = $1 AND product_name = $2 AND enabled = true ORDER BY id ASC LIMIT 1`,
      [orgId, productName]
    );
    if (r.rows.length === 0) {
      return res.json({ success: true, data: { matched: false, fallback: [{ seq: 1, name: '通用研发' }] } });
    }
    const steps = Array.isArray(r.rows[0].steps) ? r.rows[0].steps : [];
    return res.json({ success: true, data: { matched: true, craft: r.rows[0], steps: [...steps].sort((a: any, b: any) => (Number(a?.seq) || 0) - (Number(b?.seq) || 0)) } });
  } catch (err) {
    return next(err);
  }
});

// POST / — 新建工艺
router.post('/', requireAuth, requireRole('du', 'dx', 'dex'), async (req: Request, res: Response, next: NextFunction) => {
  const authed = req as AuthedReq;
  const orgId = orgOf(authed);
  const body: any = req.body || {};
  const craftCode = String(body.craftCode || '').trim();
  const craftName = String(body.craftName || '').trim();
  const productName = String(body.productName || '').trim();
  const steps = normalizeSteps(body.steps);
  if (!craftCode || !craftName || !productName || !steps) {
    return res.status(400).json({ success: false, error: 'craftCode/craftName/productName/steps are required (steps non-empty)', code: 'MISSING_FIELDS' });
  }
  try {
    const dup = await pool.query(`SELECT id FROM booth_crafts WHERE org_id = $1 AND craft_code = $2`, [orgId, craftCode]);
    if (dup.rows.length > 0) {
      return res.status(409).json({ success: false, error: `craft_code ${craftCode} already exists`, code: 'DUPLICATE_CRAFT_CODE' });
    }
    const ins = await pool.query(
      `INSERT INTO booth_crafts (org_id, craft_code, craft_name, product_name, steps)
       VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *`,
      [orgId, craftCode, craftName, productName, JSON.stringify(steps)]
    );
    emitAudit({ actor: authed.user?.identity_id || 'unknown', action: 'craft.create', resource: 'craft', resourceId: String(ins.rows[0].id), result: 'success', detail: { craftCode, productName, stepCount: steps.length } }, orgId);
    broadcast(orgId, 'craft_updated', { id: ins.rows[0].id });
    return res.json({ success: true, data: ins.rows[0] });
  } catch (err) {
    return next(err);
  }
});

// PUT /:id — 更新工艺（全量 steps）
router.put('/:id', requireAuth, requireRole('du', 'dx', 'dex'), async (req: Request, res: Response, next: NextFunction) => {
  const authed = req as AuthedReq;
  const orgId = orgOf(authed);
  const id = Number(req.params.id);
  const body: any = req.body || {};
  try {
    const cur = await pool.query(`SELECT * FROM booth_crafts WHERE id = $1 AND org_id = $2`, [id, orgId]);
    if (cur.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'craft not found', code: 'NOT_FOUND' });
    }
    const craftName = body.craftName !== undefined ? String(body.craftName).trim() : cur.rows[0].craft_name;
    const productName = body.productName !== undefined ? String(body.productName).trim() : cur.rows[0].product_name;
    const steps = body.steps !== undefined ? normalizeSteps(body.steps) : cur.rows[0].steps;
    const enabled = body.enabled !== undefined ? Boolean(body.enabled) : cur.rows[0].enabled;
    if (!craftName || !productName || !steps) {
      return res.status(400).json({ success: false, error: 'craftName/productName/steps cannot be empty', code: 'INVALID_FIELDS' });
    }
    const upd = await pool.query(
      `UPDATE booth_crafts SET craft_name = $1, product_name = $2, steps = $3::jsonb, enabled = $4, updated_at = NOW()
       WHERE id = $5 AND org_id = $6 RETURNING *`,
      [craftName, productName, JSON.stringify(steps), enabled, id, orgId]
    );
    emitAudit({ actor: authed.user?.identity_id || 'unknown', action: 'craft.update', resource: 'craft', resourceId: String(id), result: 'success', detail: { craftName, productName } }, orgId);
    broadcast(orgId, 'craft_updated', { id });
    return res.json({ success: true, data: upd.rows[0] });
  } catch (err) {
    return next(err);
  }
});

// DELETE /:id — 停用工艺（软删, 保拆单历史可溯）
router.delete('/:id', requireAuth, requireRole('du', 'dx', 'dex'), async (req: Request, res: Response, next: NextFunction) => {
  const authed = req as AuthedReq;
  const orgId = orgOf(authed);
  const id = Number(req.params.id);
  try {
    const upd = await pool.query(
      `UPDATE booth_crafts SET enabled = false, updated_at = NOW() WHERE id = $1 AND org_id = $2 RETURNING id`,
      [id, orgId]
    );
    if (upd.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'craft not found', code: 'NOT_FOUND' });
    }
    emitAudit({ actor: authed.user?.identity_id || 'unknown', action: 'craft.disable', resource: 'craft', resourceId: String(id), result: 'success' }, orgId);
    return res.json({ success: true, data: { id, enabled: false } });
  } catch (err) {
    return next(err);
  }
});

export default router;
