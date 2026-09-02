// BOOTH-PK-05 业财闭环路由: 专案(xcase)/总账(vcase)/对账(reconcile)
// 红线: 全部 M 层(du/dx/em/dm); X 层(dex/exx/dxx)不挂载不可达; 价格字段只在 M 层响应
// 幂等: 凭证 uq(org, source_voucher); vcase 入账 uq(org, source_voucher); xcase uq(org, fulfillment_id)
import { Router } from 'express';
import { Request, Response, NextFunction } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { addVoucher, closeXCase, reconcile } from '../services/finance-service.js';

const router = Router();
const M_ONLY = [requireAuth, requireRole('du', 'dx', 'em', 'dm')];
const M_WRITE = [requireAuth, requireRole('du', 'dx', 'em')];

async function emitOutbox(orgId: number, eventType: string, payload: unknown) {
  await pool.query(
    `INSERT INTO booth_outbox (org_id, event_type, payload, status, created_at)
     VALUES ($1, $2, $3::jsonb, 'pending', NOW())`,
    [orgId, eventType, JSON.stringify(payload)],
  );
}

// GET /finance/reconcile —— 对账: sum(xcase 已结案凭证) vs vcase 总账, 收入/支出分别校验
router.get('/reconcile', M_ONLY, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const data = await reconcile(user.orgId);
    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

// GET /finance/xcases —— 专案列表(含凭证计数与 vcase 入账状态)
router.get('/xcases', M_ONLY, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const q = await pool.query(
      `SELECT x.*,
              (SELECT COUNT(*)::int FROM booth_vouchers v WHERE v.xcase_id = x.id) AS voucher_count,
              (SELECT COUNT(*)::int FROM booth_vcase_entries e WHERE e.xcase_id = x.id) AS entered_count
       FROM booth_xcases x WHERE x.org_id = $1
       ORDER BY x.id DESC LIMIT 200`,
      [user.orgId],
    );
    return res.json({ success: true, data: { xcases: q.rows, meta: { business_type: 'booth_fulfillment' } } });
  } catch (err) {
    next(err);
  }
});

// GET /finance/xcases/:id —— 专案明细 + 凭证
router.get('/xcases/:id', M_ONLY, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'INVALID_ID' });
    const x = await pool.query('SELECT * FROM booth_xcases WHERE id = $1 AND org_id = $2', [id, user.orgId]);
    if (!x.rows.length) return res.status(404).json({ success: false, error: 'XCASE_NOT_FOUND' });
    const v = await pool.query('SELECT * FROM booth_vouchers WHERE xcase_id = $1 ORDER BY id', [id]);
    return res.json({ success: true, data: { xcase: x.rows[0], vouchers: v.rows } });
  } catch (err) {
    next(err);
  }
});

// POST /finance/xcases/:id/vouchers —— M 层补录成本凭证(真实单据, source_voucher 幂等)
// 红线: 不做假数据填充 —— 补录凭证必须携带真实单据来源(source_voucher)与金额, 由运营对其真实性负责
router.post('/xcases/:id/vouchers', M_WRITE, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'INVALID_ID' });
    const body = (req.body || {}) as { direction?: string; category?: string; amount?: number; source_voucher?: string; summary?: string };
    const direction = body.direction === 'income' ? 'income' : 'expense';
    const cats = direction === 'expense' ? ['material', 'labor', 'intel', 'edge'] : ['income'];
    if (!cats.includes(String(body.category))) {
      return res.status(400).json({ success: false, error: 'INVALID_CATEGORY', message: `category 必须为 ${cats.join('/')}` });
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      return res.status(400).json({ success: false, error: 'INVALID_AMOUNT' });
    }
    const sourceVoucher = typeof body.source_voucher === 'string' ? body.source_voucher.trim() : '';
    if (!sourceVoucher || sourceVoucher.length > 80) {
      return res.status(400).json({ success: false, error: 'SOURCE_VOUCHER_REQUIRED', message: 'source_voucher 必填(真实单据来源, 幂等键)' });
    }
    try {
      const voucher = await addVoucher(user.orgId, id, { direction, category: body.category!, amount, summary: body.summary, sourceVoucher });
      return res.status(201).json({ success: true, data: { voucher } });
    } catch (err: any) {
      if (err?.message === 'XCASE_NOT_FOUND') return res.status(404).json({ success: false, error: 'XCASE_NOT_FOUND' });
      if (err?.message === 'XCASE_CLOSED') return res.status(409).json({ success: false, error: 'XCASE_CLOSED', message: '专案已结案, 凭证不可再补录' });
      if (err?.message === 'DUPLICATE_SOURCE_VOUCHER') return res.status(200).json({ success: true, data: { duplicated: true } });
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

// POST /finance/xcases/:id:close —— 结案: 凭证汇总入 vcase 总账(幂等: source_voucher 去重)
const closeHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'INVALID_ID' });
    try {
      const result = await closeXCase(user.orgId, id);
      // 幂等结案(entered=0)不重复发事件, 减少下游重复消费
      if (result.entered > 0 || result.skipped > 0) {
        await emitOutbox(user.orgId, 'Finance.XCaseClosed', {
          xcase_no: result.xcaseNo,
          entered: result.entered,
          skipped: result.skipped,
          income: result.income,
          expense: result.expense,
        });
      }
      return res.json({ success: true, data: result });
    } catch (err: any) {
      if (err?.message === 'XCASE_NOT_FOUND') return res.status(404).json({ success: false, error: 'XCASE_NOT_FOUND' });
      if (err?.message === 'ALREADY_CLOSED') return res.status(200).json({ success: true, data: { already_closed: true } });
      throw err;
    }
  } catch (err) {
    next(err);
  }
};
// Express 4 冒号自定义方法 + 斜杠别名双注册(与 supply-order 一致)
router.post('/xcases/:id\\:close', M_ONLY, closeHandler);
router.post('/xcases/:id/close', M_ONLY, closeHandler);

// GET /finance/vcase —— vcase 总账分录(含收支合计)
router.get('/vcase', M_ONLY, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const entries = await pool.query(
      `SELECT * FROM booth_vcase_entries WHERE org_id = $1 ORDER BY id DESC LIMIT 500`,
      [user.orgId],
    );
    const totals = await pool.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE direction = 'income'), 0) AS income,
              COALESCE(SUM(amount) FILTER (WHERE direction = 'expense'), 0) AS expense
       FROM booth_vcase_entries WHERE org_id = $1`,
      [user.orgId],
    );
    const income = Number(totals.rows[0].income);
    const expense = Number(totals.rows[0].expense);
    return res.json({
      success: true,
      data: {
        vcase_no: `VC-BOOTH-${user.orgId}`,
        entries: entries.rows,
        totals: { income, expense, balance: Number((income - expense).toFixed(2)) },
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;

// em 只读子集(em.ts 全局 EM_ONLY 已限定 em; 本子集不挂写路由)
export const financeReadonlyRouter = Router();
financeReadonlyRouter.get('/reconcile', requireAuth, M_ONLY, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    return res.json({ success: true, data: await reconcile(user.orgId) });
  } catch (err) {
    next(err);
  }
});
financeReadonlyRouter.get('/xcases', requireAuth, M_ONLY, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const q = await pool.query(
      `SELECT x.*,
              (SELECT COUNT(*)::int FROM booth_vouchers v WHERE v.xcase_id = x.id) AS voucher_count,
              (SELECT COUNT(*)::int FROM booth_vcase_entries e WHERE e.xcase_id = x.id) AS entered_count
       FROM booth_xcases x WHERE x.org_id = $1 ORDER BY x.id DESC LIMIT 200`,
      [user.orgId],
    );
    return res.json({ success: true, data: { xcases: q.rows } });
  } catch (err) {
    next(err);
  }
});
financeReadonlyRouter.get('/vcase', requireAuth, M_ONLY, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const entries = await pool.query(`SELECT * FROM booth_vcase_entries WHERE org_id = $1 ORDER BY id DESC LIMIT 500`, [user.orgId]);
    const totals = await pool.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE direction = 'income'), 0) AS income,
              COALESCE(SUM(amount) FILTER (WHERE direction = 'expense'), 0) AS expense
       FROM booth_vcase_entries WHERE org_id = $1`,
      [user.orgId],
    );
    const income = Number(totals.rows[0].income);
    const expense = Number(totals.rows[0].expense);
    return res.json({ success: true, data: { vcase_no: `VC-BOOTH-${user.orgId}`, entries: entries.rows, totals: { income, expense, balance: Number((income - expense).toFixed(2)) } } });
  } catch (err) {
    next(err);
  }
});
