/**
 * [BOOTH-PRD-001 / G-007] 全链路状态机引擎（骨架）
 *
 * 三级联动: 生产单(订单聚合载体) → 任务(四铺拆分) → 工单(IMPL-001 booth_work_orders)
 * - 状态实时同步: 任务状态由其挂接工单自动聚合; 生产单状态由其任务自动聚合
 * - 异常自动判定: 超约定交付日期且未全部办结 = 异常 (BDD-18)
 * - 事件接线 [SHOP-CONT-BOOTH 对齐]: issued.v1 / packed.v1 的实际 emit 归 IMPL-001
 *   (work-order-service.ts), 本引擎仅登记触发点映射, 不重复触发事件。
 */
import { pool } from '../db.js';
import { TOPIC } from './event-topics.js';

// ---------------------------------------------------------------------------
// 状态定义（英文枚举落库, 前端负责中文映射展示）
// ---------------------------------------------------------------------------

/** 生产单(订单级)状态: 待下发→已下发→进行中→已完成 ⇄ 异常 */
export const PROD_STATUS = {
  PENDING_DISPATCH: 'pending_dispatch', // 待下发
  DISPATCHED: 'dispatched',             // 已下发
  IN_PROGRESS: 'in_progress',           // 进行中
  COMPLETED: 'completed',               // 已完成
  EXCEPTION: 'exception',               // 异常
} as const;

/** 任务状态: 待拆分→执行中→已完成 ⇄ 异常 (制造铺默认进行中) */
export const TASK_STATUS = {
  PENDING_SPLIT: 'pending_split', // 待拆分
  IN_PROGRESS: 'in_progress',     // 执行中
  COMPLETED: 'completed',         // 已完成
  EXCEPTION: 'exception',         // 异常
} as const;

/** 工单级状态域: IMPL-001 既有状态(pending/accepted/preparing/completed)映射到 G-007 视角 */
export const WO_STATUS = {
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  EXCEPTION: 'exception',
} as const;

/** IMPL-001 工单状态 → G-007 工单视角归一化 */
export function normalizeWorkOrderStatus(raw: string | null | undefined): string {
  const s = String(raw || '').toLowerCase();
  if (s === 'completed') return WO_STATUS.COMPLETED;
  if (s === 'cancelled') return WO_STATUS.EXCEPTION; // 取消视为异常终态(可恢复重建)
  return WO_STATUS.IN_PROGRESS; // pending/accepted/preparing/in_progress 等活跃态
}

// ---------------------------------------------------------------------------
// 合法流转表 (canTransition)
// ---------------------------------------------------------------------------

const PROD_TRANSITIONS: Record<string, string[]> = {
  [PROD_STATUS.PENDING_DISPATCH]: [PROD_STATUS.DISPATCHED, PROD_STATUS.EXCEPTION],
  [PROD_STATUS.DISPATCHED]: [PROD_STATUS.IN_PROGRESS, PROD_STATUS.EXCEPTION, PROD_STATUS.PENDING_DISPATCH],
  [PROD_STATUS.IN_PROGRESS]: [PROD_STATUS.COMPLETED, PROD_STATUS.EXCEPTION],
  [PROD_STATUS.COMPLETED]: [PROD_STATUS.EXCEPTION], // 已完成 ⇄ 异常(返工)
  [PROD_STATUS.EXCEPTION]: [PROD_STATUS.IN_PROGRESS, PROD_STATUS.COMPLETED], // 异常恢复
};

const TASK_TRANSITIONS: Record<string, string[]> = {
  [TASK_STATUS.PENDING_SPLIT]: [TASK_STATUS.IN_PROGRESS, TASK_STATUS.EXCEPTION],
  [TASK_STATUS.IN_PROGRESS]: [TASK_STATUS.COMPLETED, TASK_STATUS.EXCEPTION, TASK_STATUS.PENDING_SPLIT],
  [TASK_STATUS.COMPLETED]: [TASK_STATUS.EXCEPTION],
  [TASK_STATUS.EXCEPTION]: [TASK_STATUS.IN_PROGRESS, TASK_STATUS.COMPLETED],
};

export type StateLevel = 'order' | 'task';

export function canTransition(level: StateLevel, from: string, to: string): boolean {
  if (from === to) return true; // 幂等自环
  const table = level === 'order' ? PROD_TRANSITIONS : TASK_TRANSITIONS;
  return (table[from] || []).includes(to);
}

// ---------------------------------------------------------------------------
// 自动聚合 (BDD-18: 三级状态自动聚合)
// ---------------------------------------------------------------------------

/** 任务状态 ← 挂接工单聚合: 全完成=已完成; 任一异常=异常; 其余=执行中 */
export function aggregateTaskFromWorkOrders(woStatuses: string[]): string {
  if (woStatuses.length === 0) return TASK_STATUS.PENDING_SPLIT;
  const norm = woStatuses.map(normalizeWorkOrderStatus);
  if (norm.every((s) => s === WO_STATUS.COMPLETED)) return TASK_STATUS.COMPLETED;
  if (norm.some((s) => s === WO_STATUS.EXCEPTION)) return TASK_STATUS.EXCEPTION;
  return TASK_STATUS.IN_PROGRESS;
}

/** 生产单状态 ← 任务聚合: 有执行中=进行中; 有异常=异常; 全完成=已完成; 全待拆分=已下发; 无任务=已下发 */
export function aggregateOrderFromTasks(taskStatuses: string[]): string {
  if (taskStatuses.length === 0) return PROD_STATUS.DISPATCHED;
  if (taskStatuses.some((s) => s === TASK_STATUS.IN_PROGRESS)) return PROD_STATUS.IN_PROGRESS;
  if (taskStatuses.some((s) => s === TASK_STATUS.EXCEPTION)) return PROD_STATUS.EXCEPTION;
  if (taskStatuses.every((s) => s === TASK_STATUS.COMPLETED)) return PROD_STATUS.COMPLETED;
  return PROD_STATUS.DISPATCHED;
}

// ---------------------------------------------------------------------------
// 异常自动判定: 超约定交付日期且未全部办结 = 异常 (BDD-18)
// ---------------------------------------------------------------------------

/** 终态(已完成)不算超期; 活跃态超过约定交付时间即异常 */
export function isOverdue(expectedDeliveryAt: Date | string | null, status: string): boolean {
  if (!expectedDeliveryAt) return false;
  if (status === PROD_STATUS.COMPLETED || status === TASK_STATUS.COMPLETED) return false;
  const t = typeof expectedDeliveryAt === 'string' ? new Date(expectedDeliveryAt) : expectedDeliveryAt;
  if (Number.isNaN(t.getTime())) return false;
  return Date.now() > t.getTime();
}

// ---------------------------------------------------------------------------
// 事件接线映射 [SHOP-CONT-BOOTH 对齐] —— 仅预留, 不重复 emit
// ---------------------------------------------------------------------------

/**
 * 生产单状态节点 ↔ IMPL-001 事件触发点映射。
 * 事件实际实现在 work-order-service.ts (SHOP-CONT-BOOTH-IMPL-001):
 *   - issued.v1: dispatch 拆单事务 COMMIT 前, Confirmed→Planning 时点
 *   - packed.v1: completeWorkOrder 工单完成时点
 * payload 契约字段: productionNo / dxCaseNo(=shop_order_id) / waveNo(透传) / productRefs
 * 本生产单实体的关联字段: production_no / shop_order_id(→dx_case_no) / wave_no / items
 */
export const STATUS_EVENT_WIRING = {
  orderDispatched: {
    topic: TOPIC.PROD_ORDER_ISSUED,
    shopEvent: 'PO_ISSUED',
    triggerPoint: 'IMPL-001 dispatchFulfillment 拆单 (Confirmed→Planning)',
    payloadFields: ['productionNo', 'dxCaseNo', 'waveNo', 'productRefs'],
  },
  orderPacked: {
    topic: TOPIC.PROD_ORDER_PACKED,
    shopEvent: 'PROD_PACKED',
    triggerPoint: 'IMPL-001 completeWorkOrder 打包完成',
    payloadFields: ['productionNo', 'dxCaseNo', 'waveNo', 'productRefs'],
  },
} as const;

// ---------------------------------------------------------------------------
// DB 层: 三级聚合刷新 + 超期自动判定
// ---------------------------------------------------------------------------

const OVERDUE_REASON = '超约定交付日期且未全部办结';

/** 刷新单个生产单的三级聚合: 工单→任务→生产单 (自底向上), 返回生产单最新状态 */
export async function refreshAggregation(orgId: number, productionOrderId: number): Promise<string | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const poRes = await client.query(
      `SELECT id, status, expected_delivery_at FROM booth_production_orders WHERE id = $1 AND org_id = $2 FOR UPDATE`,
      [productionOrderId, orgId]
    );
    if (poRes.rows.length === 0) {
      await client.query('COMMIT');
      return null;
    }
    const po = poRes.rows[0];

    // 工单 → 任务 (每个任务按其挂接工单聚合)
    const tasksRes = await client.query(
      `SELECT t.id, t.status, t.work_order_id,
              COALESCE((SELECT json_agg(w.status) FROM booth_work_orders w WHERE w.id = t.work_order_id), '[]'::json) AS wo_statuses
       FROM booth_production_tasks t
       WHERE t.production_order_id = $1 AND t.org_id = $2`,
      [productionOrderId, orgId]
    );

    for (const t of tasksRes.rows) {
      const woStatuses: string[] = Array.isArray(t.wo_statuses) ? t.wo_statuses : [];
      const nextTaskStatus = woStatuses.length > 0 ? aggregateTaskFromWorkOrders(woStatuses) : t.status;
      const overdueTask = isOverdue(t.expected_delivery_at ?? po.expected_delivery_at, nextTaskStatus);
      const finalTaskStatus = overdueTask && nextTaskStatus !== TASK_STATUS.EXCEPTION ? TASK_STATUS.EXCEPTION : nextTaskStatus;
      const taskReason = finalTaskStatus === TASK_STATUS.EXCEPTION && t.status !== TASK_STATUS.EXCEPTION
        ? (overdueTask ? OVERDUE_REASON : '挂接工单异常')
        : t.exception_reason;
      if (finalTaskStatus !== t.status || taskReason !== t.exception_reason) {
        await client.query(
          `UPDATE booth_production_tasks SET status = $1, exception_reason = $2, updated_at = NOW() WHERE id = $3`,
          [finalTaskStatus, taskReason, t.id]
        );
      }
    }

    // 任务 → 生产单
    const taskStatuses = tasksRes.rows.map((t: any) => {
      const woStatuses: string[] = Array.isArray(t.wo_statuses) ? t.wo_statuses : [];
      return woStatuses.length > 0 ? aggregateTaskFromWorkOrders(woStatuses) : t.status;
    });
    let nextOrderStatus = aggregateOrderFromTasks(taskStatuses);
    const overdueOrder = isOverdue(po.expected_delivery_at, nextOrderStatus);
    let orderReason = po.exception_reason;
    if (overdueOrder && nextOrderStatus !== PROD_STATUS.EXCEPTION) {
      nextOrderStatus = PROD_STATUS.EXCEPTION;
      orderReason = OVERDUE_REASON;
    } else if (nextOrderStatus !== PROD_STATUS.EXCEPTION && po.status === PROD_STATUS.EXCEPTION && po.exception_reason === OVERDUE_REASON) {
      orderReason = null; // 聚合恢复正常, 清除超期异常原因
    }
    if (nextOrderStatus !== po.status || orderReason !== po.exception_reason) {
      await client.query(
        `UPDATE booth_production_orders SET status = $1, exception_reason = $2, updated_at = NOW() WHERE id = $3`,
        [nextOrderStatus, orderReason, po.id]
      );
    }

    await client.query('COMMIT');
    return nextOrderStatus;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** 全量超期自动判定 (BDD-18): 扫描活跃生产单/任务, 超约定交付日期且未办结 → 异常; 返回判定异常数量 */
export async function evaluateOverdue(orgId?: number): Promise<{ ordersMarked: number; tasksMarked: number; evaluatedAt: string }> {
  const client = await pool.connect();
  try {
    const orgFilter = orgId ? [orgId] : [];
    const orgCond = orgId ? 'AND org_id = $1' : '';

    const ordRes = await client.query(
      `UPDATE booth_production_orders
       SET status = '${PROD_STATUS.EXCEPTION}', exception_reason = $2, updated_at = NOW()
       WHERE status NOT IN ('${PROD_STATUS.COMPLETED}', '${PROD_STATUS.EXCEPTION}')
         AND expected_delivery_at IS NOT NULL AND expected_delivery_at < NOW()
         ${orgCond}
       RETURNING id`,
      orgId ? [orgId, OVERDUE_REASON] : [OVERDUE_REASON]
    );

    const taskRes = await client.query(
      `UPDATE booth_production_tasks
       SET status = '${TASK_STATUS.EXCEPTION}', exception_reason = $2, updated_at = NOW()
       WHERE status NOT IN ('${TASK_STATUS.COMPLETED}', '${TASK_STATUS.EXCEPTION}')
         AND expected_delivery_at IS NOT NULL AND expected_delivery_at < NOW()
         ${orgCond}
       RETURNING id`,
      orgId ? [orgId, OVERDUE_REASON] : [OVERDUE_REASON]
    );

    return {
      ordersMarked: ordRes.rowCount ?? 0,
      tasksMarked: taskRes.rowCount ?? 0,
      evaluatedAt: new Date().toISOString(),
    };
  } finally {
    client.release();
  }
}
