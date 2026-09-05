import { Router, Request, Response, NextFunction } from 'express';
import { createFromOrderEvent, cancelFromOrderEvent } from '../services/fulfillment-service.js';
import { TOPIC } from '../services/event-topics.js';
import { pool } from '../db.js';
import { verifyEventSignature } from '../services/event-signature.js'; // [BOOTH-R7-DEF-3]

const router = Router();

const EVENT_KEY = process.env.BOOTH_EVENT_KEY || 'xbus-mvp-key-2024';

/**
 * [BOOTH-R7-DEF-3] 事件签名验签中间件:
 * - OAS_EVENT_SIGNING_KEY 配置后强制验签 (HMAC-SHA256, X-Event-Signature: sha256=<hex>, 原文=请求 body)
 * - 验签失败: 写 booth_event_dlq + console.error 告警 + 401, 不静默消费
 * - 未配置: 兼容期放行 (仅共享密钥), oas-status 暴露 signing=disabled
 */
function validateEventKey(req: Request, res: Response, next: NextFunction) {
  const key = req.headers['x-event-key'];
  if (key !== EVENT_KEY) {
    return res.status(401).json({ success: false, error: 'Invalid event key', code: 'INVALID_EVENT_KEY' });
  }
  next();
}

async function verifySignature(req: Request, res: Response, next: NextFunction) {
  const rawBody = (req as any).rawBody as string | undefined;
  const sig = req.headers['x-event-signature'] as string | undefined;
  const eventId = req.headers['x-event-id'] as string || (req.body && req.body.eventId) || 'unknown';

  const verdict = verifyEventSignature(rawBody ?? JSON.stringify(req.body ?? {}), sig);
  if (verdict.ok) return next();

  console.error('[event-signature] REJECTED event -> DLQ:', { eventId, path: req.path, reason: verdict.reason });
  try {
    await pool.query(
      `INSERT INTO booth_event_dlq (event_id, event_type, reason, payload, headers, received_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, NOW())`,
      [eventId, req.path, verdict.reason, JSON.stringify(req.body ?? {}), JSON.stringify({ signature: sig ?? null, has_event_key: !!req.headers['x-event-key'] })]
    );
  } catch (dlqErr) {
    console.error('[event-signature] DLQ write failed:', (dlqErr as Error).message);
  }
  return res.status(401).json({ success: false, error: 'Event signature verification failed', code: 'INVALID_EVENT_SIGNATURE' });
}

// [BOOTH-LINK-01] XBUS 事件 handler (主挂载 /api/booth/internal/events/* 与根级别名 /events/* 复用)
async function orderConfirmedHandler(req: any, res: any, next: any) {
  try {
    const eventId = req.headers['x-event-id'] as string || req.body.eventId;
    // [BOOTH-R7-02] XBUS 主题规范化: cmd.shop.order.confirmed.v1 (旧名兼容期至 2026-09-05, 见 docs/event-contract-registry.md)
    const eventType = 'cmd.shop.order.confirmed.v1';

    if (!eventId) {
      return res.status(400).json({ success: false, error: 'Missing event ID', code: 'MISSING_EVENT_ID' });
    }

    const result = await createFromOrderEvent({
      eventId,
      eventType,
      payload: req.body,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

async function orderCancelledHandler(req: any, res: any, next: any) {
  try {
    const eventId = req.headers['x-event-id'] as string || req.body.eventId;
    // [BOOTH-R7-02] XBUS 主题规范化: cmd.shop.order.cancelled.v1
    const eventType = 'cmd.shop.order.cancelled.v1';

    if (!eventId) {
      return res.status(400).json({ success: false, error: 'Missing event ID', code: 'MISSING_EVENT_ID' });
    }

    const result = await cancelFromOrderEvent({
      eventId,
      eventType,
      payload: req.body,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

router.post('/events/order-confirmed', validateEventKey, verifySignature, orderConfirmedHandler);
router.post('/events/order-cancelled', validateEventKey, orderCancelledHandler);

// 根级别名 router: 挂载于 /events, 子路径即 /events/order-confirmed (Shop XBUS 直调口径)
const aliasRouter = Router();
aliasRouter.post('/order-confirmed', validateEventKey, verifySignature, orderConfirmedHandler);
aliasRouter.post('/order-cancelled', validateEventKey, verifySignature, orderCancelledHandler);

export { aliasRouter };
export default router;
