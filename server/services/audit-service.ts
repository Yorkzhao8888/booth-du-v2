/**
 * [BOOTH-R7-03] OAS 审计上报服务
 *
 * 权威审计源 = OAS audit-logs (POST /api/v1/admin/audit-logs); 本地表 (booth_supply_quote_audit 等) 仅作展示。
 * 通道: booth_outbox (event_type=cmd.booth.audit.log.v1) 异步投递 → outbox poller 路由 .audit. → OAS_AUDIT_URL;
 *       投递时以 OAS 服务账号登录态鉴权 (401 自动重登一次), 失败重试 10 次 → dead。
 * 五要素: 操作者(actor)/动作(action)/对象(resource+resource_id)/时间(occurred_at)/结果(result)。
 * GMBS: 资金/合规操作 payload.gmbs={flag:true, category, amount} 供 OAS 侧按域扫描。
 */
import { pool } from '../db.js';
import { TOPIC } from './event-topics.js';

export interface AuditEvent {
  actor: string;                 // 操作者 (identity_id / 登录名)
  action: string;                // 动作, 如 auth.login / supply_order.create / task.assign
  resource: string;              // 对象类型, 如 booth_session / supply_order / work_order
  resourceId?: string | number;  // 对象标识
  result: 'success' | 'failure'; // 结果
  detail?: Record<string, unknown>;
  gmbs?: { flag?: boolean; category: string; amount?: number }; // 资金/合规标记 (押金收付/涉及金额审批/结算/凭证)
}

/**
 * 写审计事件 → outbox (不阻塞主流程; outbox 不可用时降级 console 告警, 不抛出)
 */
export async function emitAudit(ev: AuditEvent, orgId = 1): Promise<void> {
  const payload = {
    operator: ev.actor,          // 五要素: 操作者
    action: ev.action,           // 五要素: 动作
    resource: ev.resource,       // 五要素: 对象
    resource_id: ev.resourceId != null ? String(ev.resourceId) : null,
    result: ev.result,           // 五要素: 结果
    occurred_at: new Date().toISOString(), // 五要素: 时间
    org: 'booth',
    app: 'booth',
    gmbs: ev.gmbs ? { flag: true, ...ev.gmbs } : { flag: false },
    detail: ev.detail ?? {},
  };
  try {
    await pool.query(
      `INSERT INTO booth_outbox (org_id, event_type, payload, status, created_at)
       VALUES ($1, $2, $3::jsonb, 'pending', NOW())`,
      [orgId, TOPIC.AUDIT_LOG, JSON.stringify(payload)]
    );
  } catch (err: any) {
    // 审计不可阻断业务; outbox 不可用属基础设施级故障
    console.error('[audit] outbox unavailable, audit event dropped:', err?.message || err, JSON.stringify(payload));
  }
}

/**
 * [R7-03] 资金/合规操作审计便捷封装 (GMBS 标记)
 */
export async function emitFinancialAudit(
  ev: Omit<AuditEvent, 'gmbs'> & { gmbsCategory: string; amount?: number },
  orgId = 1
): Promise<void> {
  const { gmbsCategory, amount, ...rest } = ev;
  await emitAudit({ ...rest, gmbs: { category: gmbsCategory, amount } }, orgId);
}
