/**
 * [XFACTORY-P1] EMX 运营线 - 采购商城一键下单桩接（R6 新增）
 *
 * 路径: /api/booth/emx/*（requireRole emx；DU 可经 X-Acting-As: emx 分身进入）
 * 价格红线: 本路由整体挂 stripXExecutorPrices（index.ts），执行层零价格
 * 边界: 仅登记+可见+可确认下单，不做撮合/合同/结算（P2/P3 边界）
 */
import { Router, Request, Response, NextFunction } from 'express';
import { requireRole } from '../auth.js';
import { confirmSupplyPurchase, listSupplyPurchases } from '../services/xfactory-service.js';

const router = Router();

/* GET /purchase-requests — X-Supply 采购请求列表（EMX 可见） */
router.get('/purchase-requests', requireRole('emx'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = Number(((req as any).user)?.orgId ?? 1);
    const status = String(req.query.status || '');
    const rows = await listSupplyPurchases(orgId, status);
    res.json({ success: true, data: rows });
  } catch (e) { next(e); }
});

/* GET /purchase-requests/:id — 单条详情 */
router.get('/purchase-requests/:id', requireRole('emx'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = Number(((req as any).user)?.orgId ?? 1);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, error: 'INVALID_ID' });
    }
    const rows = await listSupplyPurchases(orgId);
    const row = rows.find((x: { id: number }) => x.id === id);
    if (!row) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    res.json({ success: true, data: row });
  } catch (e) { next(e); }
});

/* POST /purchase-requests/:id/confirm — EMX 一键确认下单（桩接: 确认即建生产单+四铺拆单, 幂等） */
router.post('/purchase-requests/:id/confirm', requireRole('emx'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = Number(((req as any).user)?.orgId ?? 1);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, error: 'INVALID_ID' });
    }
    const operator = {
      userId: ((req as any).user)?.userId ?? null,
      name: ((req as any).user)?.displayName || ((req as any).user)?.roleKey || 'EMX',
      actingAs: ((req as any).user)?.actingAs || null,
    };
    const result = await confirmSupplyPurchase(orgId, id, operator);
    return res.json({ success: true, data: result });
  } catch (e: unknown) {
    const err = e as { statusCode?: number; code?: string; message?: string };
    if (err?.statusCode === 404) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    next(e);
  }
});

export default router;
