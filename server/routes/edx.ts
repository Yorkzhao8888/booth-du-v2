/**
 * [XFACTORY-P1] EDX 业务执行线 - 交付回执管理
 *
 * 路径: /api/booth/edx/*（requireRole edx；DU 可经 X-Acting-As: edx 分身进入）
 * 价格红线: 本路由整体挂 stripXExecutorPrices（index.ts），执行层零价格
 *
 * 组合 1: 交付 DDU — 回执生成即责任转移至 DDU
 * 组合 2: 交付 XU — 经 X-Market 渠道回执，XU 收货确认后闭环
 */
import { Router, Request, Response, NextFunction } from 'express';
import { requireRole } from '../auth.js';
import {
  issueDeliveryReceipt,
  listDeliveryReceipts,
  listXfactoryProductionOrders,
  resendDeliveryReceipt,
} from '../services/xfactory-service.js';

const router = Router();

/* GET /production-orders — 组合 1/2 生产单列表（source ∈ SUPPLY/MARKET, 含回执状态） */
router.get('/production-orders', requireRole('edx'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = Number(((req as any).user)?.orgId ?? 1);
    const source = String(req.query.source || '');
    const rows = await listXfactoryProductionOrders(orgId, source);
    res.json({ success: true, data: rows });
  } catch (e) { next(e); }
});

/* POST /production-orders/:id/delivery-receipt — 生成交付回执（receiverType: DDU | XU） */
router.post('/production-orders/:id/delivery-receipt', requireRole('edx'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = Number(((req as any).user)?.orgId ?? 1);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, error: 'INVALID_ID' });
    }
    const receiverType = String(req.body?.receiverType || 'DDU').toUpperCase();
    if (receiverType !== 'DDU' && receiverType !== 'XU') {
      return res.status(400).json({ success: false, error: 'INVALID_RECEIVER_TYPE' });
    }
    const operator = {
      userId: ((req as any).user)?.userId ?? null,
      name: ((req as any).user)?.displayName || ((req as any).user)?.roleKey || 'EDX',
      actingAs: ((req as any).user)?.actingAs || null,
    };
    const result = await issueDeliveryReceipt(orgId, id, receiverType, operator);
    return res.json({ success: true, data: result });
  } catch (e: unknown) {
    const err = e as { statusCode?: number; code?: string };
    if (err?.statusCode === 404) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    if (err?.statusCode === 409) return res.status(409).json({ success: false, error: err.code || 'NOT_COMPLETED' });
    next(e);
  }
});

/* GET /delivery-receipts — 交付回执列表 */
router.get('/delivery-receipts', requireRole('edx'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = Number(((req as any).user)?.orgId ?? 1);
    const rows = await listDeliveryReceipts(orgId);
    res.json({ success: true, data: rows });
  } catch (e) { next(e); }
});

/* POST /delivery-receipts/:receiptNo/resend — F3 交付失败补偿：重建 outbox 投递事件 + 审计留痕 */
router.post('/delivery-receipts/:receiptNo/resend', requireRole('edx'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = Number(((req as any).user)?.orgId ?? 1);
    const receiptNo = String(req.params.receiptNo || '');
    if (!receiptNo) return res.status(400).json({ success: false, error: 'INVALID_RECEIPT_NO' });
    const operator = {
      userId: ((req as any).user)?.userId ?? null,
      name: ((req as any).user)?.displayName || ((req as any).user)?.roleKey || 'EDX',
      actingAs: ((req as any).user)?.actingAs || null,
    };
    const result = await resendDeliveryReceipt(orgId, receiptNo, operator);
    return res.json({ success: true, data: result });
  } catch (e: unknown) {
    const err = e as { statusCode?: number };
    if (err?.statusCode === 404) return res.status(404).json({ success: false, error: 'NOT_FOUND' });
    next(e);
  }
});

export default router;
