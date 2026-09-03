import { pool } from '../db.js';

// [BOOTH-LINK-01] 多目标投递: 按事件类型路由
//   - mate.*        → MATE_DISPATCH_URL (Mate 任务接收端点, MATE-LINK-01 联测)
//   - 其余(Shop 类)  → SHOP_CALLBACK_URL (Shop 回写端点, SHOP-LINK-01 联测)
// URL 未配置时对应类别事件保留在 booth_outbox (pending), 不产生错误噪音。
const SHOP_CALLBACK_URL = process.env.SHOP_CALLBACK_URL || '';
const MATE_DISPATCH_URL = process.env.MATE_DISPATCH_URL || '';

const POLL_INTERVAL = 5000;
const MAX_RETRIES = 10;

function routeUrl(eventType: string): { url: string; kind: 'mate' | 'shop' } | null {
  if (eventType.startsWith('mate.')) {
    return MATE_DISPATCH_URL ? { url: MATE_DISPATCH_URL, kind: 'mate' } : null;
  }
  return SHOP_CALLBACK_URL ? { url: SHOP_CALLBACK_URL, kind: 'shop' } : null;
}

export function startOutboxPoller() {
  if (!SHOP_CALLBACK_URL && !MATE_DISPATCH_URL) {
    console.log('[outbox] SHOP_CALLBACK_URL / MATE_DISPATCH_URL not set — outbox poller disabled (events retained in booth_outbox).');
    return;
  }
  const targets = [
    SHOP_CALLBACK_URL ? `shop=${SHOP_CALLBACK_URL}` : null,
    MATE_DISPATCH_URL ? `mate=${MATE_DISPATCH_URL}` : null,
  ].filter(Boolean);
  setInterval(async () => {
    try {
      await processOutbox();
    } catch (err) {
      console.error('[outbox] Poll error:', err);
    }
  }, POLL_INTERVAL);
  console.log('[outbox] Poller started, interval:', POLL_INTERVAL, 'ms, targets:', targets.join(' | '));
}

async function processOutbox() {
  const client = await pool.connect();
  try {
    // [BOOTH-LINK-01] 按类别独立查询: 历史积压的未配置类别不阻塞新类别投递
    //   - mate 类 → MATE_DISPATCH_URL; shop 类 → SHOP_CALLBACK_URL; 未配置类别本轮不查(保留 pending)
    const batches: { rows: any[]; kind: 'mate' | 'shop' }[] = [];
    if (MATE_DISPATCH_URL) {
      const m = await client.query(
        `SELECT id, event_type, payload, retry_count FROM booth_outbox
         WHERE status = 'pending' AND event_type LIKE 'mate.%'
         ORDER BY created_at ASC LIMIT 10`
      );
      batches.push({ rows: m.rows, kind: 'mate' });
    }
    if (SHOP_CALLBACK_URL) {
      const sh = await client.query(
        `SELECT id, event_type, payload, retry_count FROM booth_outbox
         WHERE status = 'pending' AND event_type NOT LIKE 'mate.%'
         ORDER BY created_at ASC LIMIT 10`
      );
      batches.push({ rows: sh.rows, kind: 'shop' });
    }

    for (const batch of batches) {
      for (const row of batch.rows) {
        const route = { url: batch.kind === 'mate' ? MATE_DISPATCH_URL : SHOP_CALLBACK_URL, kind: batch.kind as 'mate' | 'shop' };

        try {
        const response = await fetch(route.url, {
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
          // [BOOTH-LINK-01 任务C] Mate 派单成功 → 回写供给单派单状态
          if (route.kind === 'mate') {
            const fulId = row.payload?.fulfillmentId;
            if (fulId) {
              await client.query(
                `UPDATE booth_fulfillments SET mate_dispatch_status = 'dispatched' WHERE id = $1`,
                [fulId]
              );
            }
          }
        } else {
          await markFailed(client, row.id, row.retry_count, `HTTP ${response.status}`, route.kind);
        }
        } catch (err: any) {
          await markFailed(client, row.id, row.retry_count, err?.message || 'fetch error', route.kind);
        }
      }
    }
  } finally {
    client.release();
  }
}

async function markFailed(client: any, id: number, retryCount: number, reason: string, kind?: 'mate' | 'shop') {
  const next = (retryCount || 0) + 1;
  if (next >= MAX_RETRIES) {
    await client.query(
      `UPDATE booth_outbox SET status = 'dead', retry_count = $1 WHERE id = $2`,
      [next, id]
    );
    // [BOOTH-LINK-01 任务C] 派单终败 → 供给单派单状态标记 failed (重试已尽, 可人工重派)
    if (kind === 'mate') {
      const row = await client.query(`SELECT payload FROM booth_outbox WHERE id = $1`, [id]);
      const fulId = row.rows[0]?.payload?.fulfillmentId;
      if (fulId) {
        await client.query(
          `UPDATE booth_fulfillments SET mate_dispatch_status = 'failed' WHERE id = $1`,
          [fulId]
        );
      }
    }
    console.error(`[outbox] Event ${id} marked DEAD after ${next} retries (${reason}).`);
  } else {
    await client.query(
      `UPDATE booth_outbox SET retry_count = $1 WHERE id = $2`,
      [next, id]
    );
    console.warn(`[outbox] Event ${id} failed (${reason}), retry ${next}/${MAX_RETRIES}`);
  }
}
