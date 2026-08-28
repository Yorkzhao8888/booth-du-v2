import { pool } from '../db.js';

const CALLBACK_URL =
  process.env.SHOP_CALLBACK_URL ||
  'http://localhost:5173/api/shop/internal/events/fab-workorder-completed';

const POLL_INTERVAL = 5000;

export function startOutboxPoller() {
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
          headers: { 'Content-Type': 'application/json' },
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
          await client.query(
            `UPDATE booth_outbox SET retry_count = retry_count + 1 WHERE id = $1`,
            [row.id]
          );
          console.warn(`[outbox] Failed to send event ${row.id}, status: ${response.status}`);
        }
      } catch (err) {
        await client.query(
          `UPDATE booth_outbox SET retry_count = retry_count + 1 WHERE id = $1`,
          [row.id]
        );
        console.error(`[outbox] Error sending event ${row.id}:`, err);
      }
    }
  } finally {
    client.release();
  }
}
