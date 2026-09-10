import { Router } from 'express';
import { addClient, removeClient, broadcast } from '../sse.js';
import { requireAuth, requireRole } from '../auth.js';
import { pool } from '../db.js';

const router = Router();

// ============ [BOOTH-CONN-01] Market 观察窗配套: SSE 履约推送 + 全链路时间线 ============

function resolveOrgId(user: unknown): number {
  const u = user as { orgId?: number | string; org_id?: number | string } | undefined;
  return Number(u?.orgId ?? u?.org_id ?? 1) || 1;
}

/** 容器号脱敏: XEPZ-****1234 (身份最小暴露) */
function maskContainer(user: unknown): string {
  const u = user as { identityId?: string | number; identity_id?: string | number; roleKey?: string; userId?: number } | undefined;
  const container = 'XEPZ';
  const raw = String(u?.identityId ?? u?.identity_id ?? u?.userId ?? '0000');
  const tail = raw.replace(/\D/g, '').slice(-4) || '0000';
  return `${container}-****${tail}`;
}

/**
 * V3: SSE 履约推送端点 (EventSource 协议)。
 * 复用全局 SSE 总线 (业务 broadcast 的履约/工单事件自动到达) + 本端点专属 15s 心跳保活;
 * 断线重连由 EventSource 原生机制承担, 服务端 close 事件清理连接与心跳。
 */
router.get('/stream', requireAuth, (req, res) => {
  const user = (req as unknown as { user?: unknown }).user;
  const orgId = resolveOrgId(user);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, orgId, at: new Date().toISOString() })}\n\n`);
  addClient(orgId, res);
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat-15s\n\n');
    } catch {
      // 写失败由 close 清理
    }
  }, 15000);
  req.on('close', () => {
    clearInterval(heartbeat);
    removeClient(orgId, res);
  });
});

interface TimelineNode {
  key: 'placed' | 'accepted' | 'fulfilling' | 'delivered';
  label: string;
  at: string | null;
  state: string;
  actor: string;
}

interface TimelineOrder {
  fulfillmentId: number;
  orderNo: string;
  waveNo: string | null;
  source: string;
  nodes: TimelineNode[];
}

/** 全链路时间线历史数据源: 契约单 v1.1 状态回写通道落库 (booth_fulfillments) → 四节点映射 */
router.get('/timeline', requireAuth, async (req, res, next) => {
  try {
    const user = (req as unknown as { user?: unknown }).user;
    const orgId = resolveOrgId(user);
    const actor = maskContainer(user);
    const r = await pool.query(
      `SELECT id, shop_order_id, status, contract_status, source, created_at, completed_at, wave_no
         FROM booth_fulfillments
        WHERE org_id = $1
        ORDER BY id DESC
        LIMIT 20`,
      [orgId],
    );
    const orders: TimelineOrder[] = r.rows.map((row: Record<string, unknown>) => {
      const contractStatus = String(row.contract_status ?? '');
      const status = String(row.status ?? '');
      const source = String(row.source ?? 'manual');
      const sourceActor = source === 'mall' ? 'MKT-****' + String(row.shop_order_id ?? '').replace(/\D/g, '').slice(-4) : actor;
      const nodes: TimelineNode[] = [
        { key: 'placed', label: 'Market 下单', at: row.created_at ? new Date(row.created_at as string).toISOString() : null, state: 'done', actor: sourceActor },
        {
          key: 'accepted',
          label: '供给铺接单 (Booth-E)',
          at: row.created_at ? new Date(row.created_at as string).toISOString() : null,
          state: contractStatus ? 'done' : 'pending',
          actor,
        },
        {
          key: 'fulfilling',
          label: 'DU 履约',
          at: ['dispatched', 'in_progress', 'completed'].includes(status) ? (row.completed_at ? new Date(row.completed_at as string).toISOString() : null) : null,
          state: ['dispatched', 'in_progress'].includes(status) ? 'doing' : status === 'completed' ? 'done' : 'pending',
          actor,
        },
        {
          key: 'delivered',
          label: '交付确认',
          at: row.completed_at ? new Date(row.completed_at as string).toISOString() : null,
          state: status === 'completed' ? 'done' : 'pending',
          actor,
        },
      ];
      return {
        fulfillmentId: Number(row.id),
        orderNo: String(row.shop_order_id ?? ''),
        waveNo: row.wave_no ? String(row.wave_no) : null,
        source,
        nodes,
      };
    });
    res.json({ success: true, data: { orders } });
  } catch (err) {
    next(err);
  }
});

/**
 * V3 验收辅助: 模拟订单状态事件广播 (仅 DU 系角色; 纯 SSE 通道测试, 不写业务表不改状态机)。
 * curl -X POST /api/booth/fulfillment/simulate-event -d '{"orderNo":"M-TEST-1","node":"fulfilling","state":"in_progress"}'
 */
router.post('/simulate-event', requireAuth, requireRole('du'), (req, res) => {
  const user = (req as unknown as { user?: unknown }).user;
  const orgId = resolveOrgId(user);
  const body = (req.body ?? {}) as { orderNo?: string; node?: string; state?: string };
  const evt = {
    eventId: `SIM-${Date.now()}`,
    orderNo: String(body.orderNo ?? `M-SIM-${Date.now()}`),
    node: String(body.node ?? 'fulfilling'),
    state: String(body.state ?? 'in_progress'),
    actor: maskContainer(user),
    at: new Date().toISOString(),
  };
  broadcast(orgId, 'fulfillment.event', evt);
  res.json({ success: true, data: evt });
});

export default router;
