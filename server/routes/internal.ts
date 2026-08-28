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

router.post('/events/order-confirmed', validateEventKey, async (req, res, next) => {
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
});

router.post('/events/order-cancelled', validateEventKey, async (req, res, next) => {
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
});

export default router;
