/**
 * [BOOTH-LINK-01 / R7-02 / R7-03 / R7-DEF-3] Outbox 异步投递服务
 *
 * 目标路由 (按 cmd.<domain>.<action>.v1 主题的域段):
 *   .mate.  → MATE_DISPATCH_URL   (Mate 派单)
 *   .audit. → OAS_AUDIT_URL       (OAS 审计, 服务账号登录态, 401 自动重登)
 *   其余    → SHOP_CALLBACK_URL   (Shop 回写)
 *
 * 可靠性: pending → sent / dead; 失败重试 MAX_RETRIES=10 次, 终败 dead (DLQ 语义)。
 * 签名 [R7-DEF-3]: 配置 OAS_EVENT_SIGNING_KEY 后, 出站消息附 X-Event-Signature: sha256=HMAC(body)。
 * mate.dispatch 投递成功/终败回写 booth_fulfillments.mate_dispatch_status。
 */
import crypto from 'crypto';
import { pool } from '../db.js';
import { OAS_BASE_URL } from './oas-client.js';

const MATE_DISPATCH_URL = process.env.MATE_DISPATCH_URL || '';
const SHOP_CALLBACK_URL = process.env.SHOP_CALLBACK_URL || '';
const OAS_AUDIT_URL = process.env.OAS_AUDIT_URL || (OAS_BASE_URL ? `${OAS_BASE_URL}/api/v1/admin/audit-logs` : '');
// OAS 服务账号 (审计上报登录态; 401 自动刷新)
const OAS_SERVICE_USER = process.env.OAS_SERVICE_USER || 'admin';
const OAS_SERVICE_PASS = process.env.OAS_SERVICE_PASS || 'test123';
const OAS_EVENT_SIGNING_KEY = process.env.OAS_EVENT_SIGNING_KEY || '';
const MAX_RETRIES = 10;
const POLL_MS = 5000;

type TargetKind = 'mate' | 'audit' | 'shop';

function routeUrl(kind: TargetKind): string {
  if (kind === 'mate') return MATE_DISPATCH_URL;
  if (kind === 'audit') return OAS_AUDIT_URL;
  return SHOP_CALLBACK_URL;
}

/* ───────────── OAS 服务账号登录态 (审计投递用) ───────────── */

let svcToken: { value: string; expiresAt: number } | null = null;

async function acquireServiceToken(force = false): Promise<string | null> {
  if (!force && svcToken && Date.now() < svcToken.expiresAt) return svcToken.value;
  if (!OAS_BASE_URL) return null;
  try {
    const resp = await fetch(`${OAS_BASE_URL}/api/v1/os/booth/proxy/ams/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: OAS_SERVICE_USER, password: OAS_SERVICE_PASS }),
      signal: AbortSignal.timeout(8000),
    });
    const body: any = await resp.json().catch(() => ({}));
    const token = body?.data?.access_token;
    if (!resp.ok || !token) {
      console.error('[outbox][audit] service login failed:', resp.status, body?.message || body?.error || '');
      return null;
    }
    // exp 15min; 提前 120s 刷新
    let expMs = Date.now() + 13 * 60 * 1000;
    try {
      const p = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
      if (p?.exp) expMs = (p.exp - 120) * 1000;
    } catch { /* keep default */ }
    svcToken = { value: token, expiresAt: expMs };
    return token;
  } catch (err: any) {
    console.error('[outbox][audit] service login error:', err?.message || err);
    return null;
  }
}

/* ───────────── 投递 ───────────── */

function signBody(body: string): Record<string, string> {
  // [R7-DEF-3] OAS_EVENT_SIGNING_KEY 配置后出站统一 HMAC-SHA256 签名
  if (!OAS_EVENT_SIGNING_KEY) return {};
  const sig = crypto.createHmac('sha256', OAS_EVENT_SIGNING_KEY).update(body).digest('hex');
  return { 'X-Event-Signature': `sha256=${sig}` };
}

async function deliver(row: any, url: string, kind: TargetKind): Promise<{ ok: boolean; status?: number; error?: string }> {
  const body = JSON.stringify(row.payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Event-Key': row.event_type,
    ...signBody(body),
  };
  // [R7-03] audit 类别带 OAS 服务账号登录态
  if (kind === 'audit') {
    let token = await acquireServiceToken();
    const attempt = async (tk: string | null) =>
      fetch(url, {
        method: 'POST',
        headers: tk ? { ...headers, Authorization: `Bearer ${tk}` } : headers,
        body,
        signal: AbortSignal.timeout(8000),
      });
    let resp = await attempt(token);
    if (resp.status === 401) {
      token = await acquireServiceToken(true); // 401 → 服务账号重登一次
      if (!token) return { ok: false, status: 401, error: 'audit service login failed' };
      resp = await attempt(token);
    }
    return resp.ok ? { ok: true, status: resp.status } : { ok: false, status: resp.status, error: `HTTP ${resp.status}` };
  }
  // mate / shop: 直投
  const resp = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(8000) });
  return resp.ok ? { ok: true, status: resp.status } : { ok: false, status: resp.status, error: `HTTP ${resp.status}` };
}

async function markSent(client: any, row: any): Promise<void> {
  await client.query(`UPDATE booth_outbox SET status = 'sent', sent_at = NOW(), last_error = NULL WHERE id = $1`, [row.id]);
  // [LINK-01 任务C] mate.dispatch 终态回写
  if (String(row.event_type).includes('.mate.')) {
    const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    if (payload?.fulfillmentId) {
      await client.query(`UPDATE booth_fulfillments SET mate_dispatch_status = 'dispatched' WHERE id = $1`, [payload.fulfillmentId]);
    }
  }
}

async function markFailed(client: any, row: any, errMsg: string, kind: TargetKind): Promise<void> {
  const retryCount = Number(row.retry_count) || 0;
  const nextRetry = retryCount + 1;
  if (nextRetry >= MAX_RETRIES) {
    await client.query(`UPDATE booth_outbox SET status = 'dead', retry_count = $2, last_error = $3 WHERE id = $1`, [row.id, nextRetry, errMsg]);
    if (kind === 'mate') {
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      if (payload?.fulfillmentId) {
        await client.query(`UPDATE booth_fulfillments SET mate_dispatch_status = 'failed' WHERE id = $1`, [payload.fulfillmentId]);
      }
    }
    console.error(`[outbox] event ${row.id} (${row.event_type}) moved to DLQ (dead) after ${nextRetry} retries: ${errMsg}`);
  } else {
    await client.query(`UPDATE booth_outbox SET retry_count = $2, last_error = $3 WHERE id = $1`, [row.id, nextRetry, errMsg]);
  }
}

async function processOutbox() {
  const client = await pool.connect();
  try {
    // [LINK-01] 按类别独立查询: 未配置目标的类别本轮不查 (保留 pending), 历史积压不阻塞新类别
    const batches: { rows: any[]; kind: TargetKind }[] = [];
    if (MATE_DISPATCH_URL) {
      const m = await client.query(
        `SELECT id, event_type, payload, retry_count FROM booth_outbox
         WHERE status = 'pending' AND event_type LIKE '%.mate.%.v1'
         ORDER BY created_at ASC LIMIT 10`
      );
      batches.push({ rows: m.rows, kind: 'mate' });
    }
    if (OAS_AUDIT_URL) {
      const a = await client.query(
        `SELECT id, event_type, payload, retry_count FROM booth_outbox
         WHERE status = 'pending' AND event_type LIKE '%.audit.%.v1'
         ORDER BY created_at ASC LIMIT 10`
      );
      batches.push({ rows: a.rows, kind: 'audit' });
    }
    if (SHOP_CALLBACK_URL) {
      const sh = await client.query(
        `SELECT id, event_type, payload, retry_count FROM booth_outbox
         WHERE status = 'pending' AND event_type NOT LIKE '%.mate.%.v1' AND event_type NOT LIKE '%.audit.%.v1'
         ORDER BY created_at ASC LIMIT 10`
      );
      batches.push({ rows: sh.rows, kind: 'shop' });
    }

    for (const batch of batches) {
      for (const row of batch.rows) {
        const url = routeUrl(batch.kind);
        if (!url) continue;
        try {
          const r = await deliver(row, url, batch.kind);
          if (r.ok) {
            await markSent(client, row);
          } else {
            await markFailed(client, row, r.error || `HTTP ${r.status}`, batch.kind);
          }
        } catch (err: any) {
          await markFailed(client, row, err?.message || 'fetch error', batch.kind);
        }
      }
    }
  } finally {
    client.release();
  }
}

export function startOutboxPoller() {
  const targets = [
    MATE_DISPATCH_URL && `mate→${MATE_DISPATCH_URL}`,
    OAS_AUDIT_URL && `audit→${OAS_AUDIT_URL}`,
    SHOP_CALLBACK_URL && `shop→${SHOP_CALLBACK_URL}`,
  ].filter(Boolean);
  if (targets.length === 0) {
    console.log('[outbox] no outbound targets configured — poller idle (events stay pending)');
    return;
  }
  console.log(`[outbox] poller started (every ${POLL_MS}ms) targets: ${targets.join(' | ')}${OAS_EVENT_SIGNING_KEY ? ' | signing=HMAC-SHA256' : ''}`);
  setInterval(() => {
    processOutbox().catch((err) => console.error('[outbox] poll error:', err?.message || err));
  }, POLL_MS);
}
