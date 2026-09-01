// FAB-MES-03 安灯异常中心 Service
// 异常秒级暴露 + 三级响应占位（声光→班组→管理层）+ 知识库联动
import { pool } from '../db.js';
import { broadcast, setAutoAndonHandler } from '../sse.js';

export interface AndonInput {
  orgId: number;
  type: 'shortage' | 'equipment' | 'quality' | 'overdue' | 'other';
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  workOrderId?: number | null;
  stationId?: number | null;
  equipmentId?: number | null;
  callerId?: number | null;
  auto?: boolean;
}

const ESCALATION_L2_MIN = 15; // 未响应 15 分钟 → L2 管理层
const ESCALATION_L3_MIN = 30; // 未响应 30 分钟 → L3 店主

/** 发起安灯事件（L1 升级同步落库并广播） */
export async function createAndonEvent(input: AndonInput): Promise<{ id: number }> {
  const r = await pool.query(
    `INSERT INTO booth_andon_events
       (org_id, work_order_id, station_id, equipment_id, type, severity, message, status, caller_id, auto_generated)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'open',$8,$9) RETURNING id, created_at`,
    [
      input.orgId,
      input.workOrderId ?? null,
      input.stationId ?? null,
      input.equipmentId ?? null,
      input.type,
      input.severity,
      input.message,
      input.callerId ?? null,
      input.auto === true,
    ]
  );
  const ev = r.rows[0];

  // L1 升级占位：班组级（FAB 帽子角色组）
  await pool.query(
    `INSERT INTO booth_andon_escalation (event_id, level, target) VALUES ($1,$2,$3)`,
    [ev.id, 1, 'FAB班组']
  );
  broadcast(input.orgId, 'andon_event', {
    id: ev.id,
    type: input.type,
    severity: input.severity,
    status: 'open',
    message: input.message,
    auto: input.auto === true,
  });
  return { id: ev.id };
}

/** 自动安灯：缺料（开始制作 409 联动） */
export async function autoAndonShortage(
  orgId: number,
  workOrderId: number | null,
  shortages: Array<Record<string, unknown>>,
  callerId?: number | null
): Promise<number> {
  const list = (shortages || [])
    .map((s: Record<string, unknown>) => `${s.name ?? s.material_name ?? s.id} 缺 ${s.shortage ?? s.qty ?? '?'}`)
    .join('；');
  const message = `开始制作缺料：${list || '物料不足'}`;
  const r = await createAndonEvent({
    orgId,
    type: 'shortage',
    severity: (shortages && shortages.length > 1) ? 'high' : 'medium',
    message,
    workOrderId,
    callerId: callerId ?? null,
    auto: true,
  });
  return r.id;
}

/** 自动安灯：SLA 超时（sse 心跳联动，item 为工单行，字段防御式读取） */
export async function autoAndonOverdue(orgId: number, item: Record<string, unknown>): Promise<void> {
  const woId = Number(item.id);
  if (!Number.isFinite(woId)) return;
  // 防重：同工单未关闭的 overdue 安灯只挂一条
  const dup = await pool.query(
    `SELECT 1 FROM booth_andon_events WHERE org_id=$1 AND type='overdue' AND work_order_id=$2 AND status IN ('open','processing') LIMIT 1`,
    [orgId, woId]
  );
  if (dup.rowCount && dup.rowCount > 0) return;
  const jobLabel = (item.job_id as string) || String(woId);
  await createAndonEvent({
    orgId,
    type: 'overdue',
    severity: 'high',
    message: `工单 ${jobLabel} 交付 SLA 超时，请立即跟进`,
    workOrderId: woId,
    auto: true,
  });
}

/** 三级响应升级扫描（声光→班组→管理层占位）：open 超 15/30 分钟未响应逐级升级 */
async function scanEscalations(): Promise<void> {
  try {
    const orgs = await pool.query(`SELECT DISTINCT org_id FROM booth_andon_events`);
    for (const o of orgs.rows) {
      const orgId = o.org_id;
      // L2：open 超 15 分钟
      const l2 = await pool.query(
        `SELECT e.id, e.type, e.severity, e.message FROM booth_andon_events e
         WHERE e.org_id=$1 AND e.status='open' AND e.created_at <= NOW() - ($2 || ' minutes')::interval
           AND NOT EXISTS (SELECT 1 FROM booth_andon_escalation x WHERE x.event_id=e.id AND x.level=2)`,
        [orgId, ESCALATION_L2_MIN]
      );
      for (const ev of l2.rows) {
        await pool.query(`INSERT INTO booth_andon_escalation (event_id, level, target) VALUES ($1,$2,$3)`, [ev.id, 2, '交付长/管理层']);
        broadcast(orgId, 'andon_escalation', { eventId: ev.id, level: 2, target: '交付长/管理层' });
      }
      // L3：open 超 30 分钟
      const l3 = await pool.query(
        `SELECT e.id, e.type, e.severity, e.message FROM booth_andon_events e
         WHERE e.org_id=$1 AND e.status='open' AND e.created_at <= NOW() - ($2 || ' minutes')::interval
           AND NOT EXISTS (SELECT 1 FROM booth_andon_escalation x WHERE x.event_id=e.id AND x.level=3)`,
        [orgId, ESCALATION_L3_MIN]
      );
      for (const ev of l3.rows) {
        await pool.query(`INSERT INTO booth_andon_escalation (event_id, level, target) VALUES ($1,$2,$3)`, [ev.id, 3, '店主']);
        broadcast(orgId, 'andon_escalation', { eventId: ev.id, level: 3, target: '店主' });
      }
    }
  } catch {
    // 升级扫描失败不影响主链路
  }
}

// 60s 心跳升级扫描（占位三级通知，不接短信/微信）
setInterval(scanEscalations, 60_000);

// 注册到 SSE 模块的 SLA 钩子（晚绑定，避免循环依赖；本模块随路由加载即生效）
setAutoAndonHandler(autoAndonOverdue);

/** 看板/历史统计：平均响应/解决时效 + 分级计数 */
export async function andonStats(orgId: number, window: string = '30 days') {
  const r = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status IN ('open','processing'))::int AS active,
       COUNT(*) FILTER (WHERE responded_at IS NOT NULL)::int AS responded_cnt,
       COUNT(*) FILTER (WHERE resolved_at IS NOT NULL)::int AS resolved_cnt,
       AVG(EXTRACT(EPOCH FROM (responded_at - created_at)) / 60)
         FILTER (WHERE responded_at IS NOT NULL)::numeric(10,1) AS avg_respond_min,
       AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 60)
         FILTER (WHERE resolved_at IS NOT NULL)::numeric(10,1) AS avg_resolve_min,
       COUNT(*) FILTER (WHERE severity='critical' AND status IN ('open','processing'))::int AS critical_open,
       COUNT(*) FILTER (WHERE severity='high' AND status IN ('open','processing'))::int AS high_open
     FROM booth_andon_events
     WHERE org_id=$1 AND created_at >= NOW() - ($2::text)::interval`,
    [orgId, window]
  );
  const s = r.rows[0] || {};
  return {
    total: s.total ?? 0,
    active: s.active ?? 0,
    responded_cnt: s.responded_cnt ?? 0,
    resolved_cnt: s.resolved_cnt ?? 0,
    avg_respond_min: s.avg_respond_min === null ? null : Number(s.avg_respond_min),
    avg_resolve_min: s.avg_resolve_min === null ? null : Number(s.avg_resolve_min),
    critical_open: s.critical_open ?? 0,
    high_open: s.high_open ?? 0,
  };
}
