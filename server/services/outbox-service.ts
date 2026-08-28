import { pool } from '../db.js';

// Callback URL must be explicitly configured. In production Booth will POST
// completion events back to Shop. When not configured, the poller stays off
// (events accumulate in booth_outbox without error noise).
const CALLBACK_URL = process.env.SHOP_CALLBACK_URL || '';

const POLL_INTERVAL = 5000;
const MAX_RETRIES = 10;

export function startOutboxPoller() {
  if (!CALLBACK_URL) {
    console.log('[outbox] SHOP_CALLBACK_URL not set — outbox poller disabled (events retained in booth_outbox).');
    return;
  }
  setInterval(async () => {
    try {
      await processOutbox();
    } catch (err) {
      console.error('[outbox] Poll error:', err);
    }
  }, POLL_INTERVAL);
  console.log('[outbox] Poller started, interval:', POLL_INTERVAL, 'ms, callback:', CALLBACK_URL);
}

async function processOutbox() {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT id, event_type, payload, retry_count
       FROM booth_outbox
       WHERE status = 'pending'
       ORDER BY created_at ASC
       LIMIT 10`
    );

    for (const row of res.rows) {
      try {
        const response = await fetch(CALLBACK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Event-Key': process.env.BOOTH_EVENT_KEY || 'xbus-mvp-key-2024',
          },
          body: JSON.stringify({
            eventType: row.event_type,
            payload: row.payload,
          }),
        });

        if (response.ok) {
          await client.query(
            `UPDATE booth_outbox SET status = 'sent', sent_at = NOW() WHERE id = $1`,
            [row.id]
          );
        } else {
          await markFailed(client, row.id, row.retry_count, `HTTP ${response.status}`);
        }
      } catch (err: any) {
        await markFailed(client, row.id, row.retry_count, err?.message || 'fetch error');
      }
    }
  } finally {
    client.release();
  }
}

async function markFailed(client: any, id: number, retryCount: number, reason: string) {
  const next = (retryCount || 0) + 1;
  if (next >= MAX_RETRIES) {
    await client.query(
      `UPDATE booth_outbox SET status = 'dead', retry_count = $1 WHERE id = $2`,
      [next, id]
    );
    console.error(`[outbox] Event ${id} marked DEAD after ${next} retries (${reason}).`);
  } else {
    await client.query(
      `UPDATE booth_outbox SET retry_count = $1 WHERE id = $2`,
      [next, id]
    );
    console.warn(`[outbox] Event ${id} failed (${reason}), retry ${next}/${MAX_RETRIES}`);
  }
}
