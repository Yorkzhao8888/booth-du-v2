import { Router } from 'express';
import { createFromOrderEvent, cancelFromOrderEvent } from '../services/fulfillment-service.js';

const router = Router();

const EVENT_KEY = process.env.BOOTH_EVENT_KEY || 'xbus-mvp-key-2024';

function validateEventKey(req: any, res: any, next: any) {
  const key = req.headers['x-event-key'];
  if (key !== EVENT_KEY) {
    return res.status(401).json({ success: false, error: 'Invalid event key', code: 'INVALID_EVENT_KEY' });
  }
  next();
}

// [BOOTH-LINK-01] XBUS 事件 handler (主挂载 /api/booth/internal/events/* 与根级别名 /events/* 复用)
async function orderConfirmedHandler(req: any, res: any, next: any) {
  try {
    const eventId = req.headers['x-event-id'] as string || req.body.eventId;
    const eventType = 'order.confirmed';

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
    const eventType = 'order.cancelled';

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

router.post('/events/order-confirmed', validateEventKey, orderConfirmedHandler);
router.post('/events/order-cancelled', validateEventKey, orderCancelledHandler);

// 根级别名 router: 挂载于 /events, 子路径即 /events/order-confirmed (Shop XBUS 直调口径)
const aliasRouter = Router();
aliasRouter.post('/order-confirmed', validateEventKey, orderConfirmedHandler);
aliasRouter.post('/order-cancelled', validateEventKey, orderCancelledHandler);

export { aliasRouter };
export default router;
