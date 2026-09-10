/**
 * [BOOTH-PRD-001] 生产单契约地基 API（阶段零）
 * - 幂等创建: 同 shop_order_id 重复创建仅返回既有 productionNo（BDD-19）
 * - 四铺拆单挂接点: POST /:id/dispatch 创建任务并预留工单挂接
 * - 三级状态联动/超期自动判定: state-machine.ts (G-007/BDD-18)
 * - 事件触发点归 IMPL-001（不在此重复 emit）, 状态↔事件映射见 STATUS_EVENT_WIRING
 */
import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { emitAudit } from '../services/audit-service.js';
import { broadcast } from '../sse.js';
import {
  PROD_STATUS,
  TASK_STATUS,
  canTransition,
  refreshAggregation,
  evaluateOverdue,
  STATUS_EVENT_WIRING,
} from '../services/state-machine.js';

const router = Router();

// 四铺铺型枚举（PRD v1.0 四铺; 制造铺默认进行中）
// [BOOTH-PRD-002 裁定] 四铺 = 研发(rd)/制造(manufacture)/配送(delivery)/供给(supply)
const TASK_TYPES = ['rd', 'manufacture', 'delivery', 'supply'] as const;
const MANUFACTURE_DEFAULT_STATUS = TASK_STATUS.IN_PROGRESS; // 制造铺默认进行中
const DEFAULT_TASK_TYPE_BY_ORDER: Record<string, string> = { outsource: 'supply', self_made: 'manufacture', rd_dev: 'rd' }; // BDD-01 类型驱动派发
const ORDER_TYPES = ['outsource', 'self_made', 'rd_dev'] as const; // [PM-002] MVP 三类=外发/自制/研发 (字典化扩展预留)

/** 生产单编号: PROD-<yyyyMMdd>-<4位流水> (表内按日独立序列, 唯一索引兜底) */
async function nextProductionOrderNo(client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }): Promise<string> {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const r = await client.query(
    `SELECT count(*)::int AS n FROM booth_production_orders WHERE production_no LIKE $1`,
    [`PROD-${ymd}-%`]
  );
  return `PROD-${ymd}-${String((r.rows[0]?.n ?? 0) + 1).padStart(4, '0')}`;
}

interface AuthedReq extends Request {
  user?: { orgId?: number; org_id?: number; identity_id?: string; role?: string };
}

function orgOf(req: AuthedReq): number {
  return Number(req.user?.orgId ?? req.user?.org_id ?? 1) || 1;
}

// ---------------------------------------------------------------------------
// POST / — 生产单幂等创建 (BDD-19: Shop 订单进入 → 生产单实体)
// body: { shopOrderId*, orderNo?, dxCaseNo?, waveNo?, expectedDeliveryAt?, plazPoint?, items? }
// 同 shop_order_id 重复创建仅返回既有 productionNo
// ---------------------------------------------------------------------------
router.post('/', requireAuth, requireRole('du', 'dx', 'edx'), async (req: Request, res: Response, next: NextFunction) => {
  const authed = req as AuthedReq;
  const orgId = orgOf(authed);
  const body: any = req.body || {};
  const shopOrderId = String(body.shopOrderId || '').trim();
  if (!shopOrderId) {
    return res.status(400).json({ success: false, error: 'shopOrderId is required', code: 'MISSING_SHOP_ORDER_ID' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 幂等键: UNIQUE(org_id, shop_order_id)
    const dup = await client.query(
      `SELECT id, production_no, status FROM booth_production_orders WHERE org_id = $1 AND shop_order_id = $2`,
      [orgId, shopOrderId]
    );
    if (dup.rows.length > 0) {
      await client.query('COMMIT');
      return res.json({ success: true, data: { idempotent: true, id: dup.rows[0].id, productionNo: dup.rows[0].production_no, status: dup.rows[0].status } });
    }
    const productionNo = await nextProductionOrderNo(client);
    const ins = await client.query(
      `INSERT INTO booth_production_orders
         (org_id, production_no, shop_order_id, dx_case_no, wave_no, order_no, status, order_type, expected_delivery_at, plaz_point, items)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       RETURNING *`,
      [
        orgId,
        productionNo,
        shopOrderId,
        body.dxCaseNo ?? null,
        body.waveNo ?? null, // waveNo 透传不双源: 原样落库原样回传, 不解析不生成
        body.orderNo ?? null,
        PROD_STATUS.PENDING_DISPATCH,
        ORDER_TYPES.includes(body.orderType) ? body.orderType : 'self_made', // [PM-002] MVP 三类, 字典化预留
        body.expectedDeliveryAt ? new Date(body.expectedDeliveryAt) : null,
        body.plazPoint ?? null,
        JSON.stringify(Array.isArray(body.items) ? body.items : []),
      ]
    );
    await client.query('COMMIT');
    const po = ins.rows[0];
    emitAudit({ actor: authed.user?.identity_id || 'unknown', action: 'production_order.create', resource: 'production_order', resourceId: String(po.id), result: 'success', detail: { productionNo: po.production_no, shop_order_id: shopOrderId } }, orgId);
    broadcast(orgId, 'production_order_created', { id: po.id, productionNo: po.production_no, status: po.status });
    return res.json({ success: true, data: { idempotent: false, productionOrder: po } });
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// GET / — 生产单列表 (含任务/工单聚合视图 + 超期标识)
// ---------------------------------------------------------------------------
router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = orgOf(req as AuthedReq);
    const status = String((req.query.status as string) || '');
    const params: unknown[] = [orgId];
    let cond = '';
    if (status) {
      params.push(status);
      cond = `AND po.status = $2`;
    }
    // [G-006] 三级状态筛选: 订单(status) / 任务(taskStatus) / 工单(workOrderStatus)
    let extra = '';
    const taskStatus = String((req.query.taskStatus as string) || '');
    const woStatus = String((req.query.workOrderStatus as string) || '');
    if (taskStatus) {
      params.push(taskStatus);
      extra += ` AND EXISTS (SELECT 1 FROM booth_production_tasks tt WHERE tt.production_order_id = po.id AND tt.status = $${params.length})`;
    }
    if (woStatus) {
      params.push(woStatus);
      extra += ` AND EXISTS (SELECT 1 FROM booth_production_tasks tt2 JOIN booth_work_orders ww ON ww.id = tt2.work_order_id WHERE tt2.production_order_id = po.id AND ww.status = $${params.length})`;
    }
    const r = await pool.query(
      `SELECT po.*,
              (SELECT count(*)::int FROM booth_production_tasks t WHERE t.production_order_id = po.id) AS task_count,
              (SELECT count(*)::int FROM booth_production_tasks t WHERE t.production_order_id = po.id AND t.status = 'completed') AS task_done,
              (SELECT count(*)::int FROM booth_production_tasks t WHERE t.production_order_id = po.id AND t.status = 'exception') AS task_exception,
              (expected_delivery_at IS NOT NULL AND expected_delivery_at < NOW() AND status NOT IN ('completed','exception')) AS overdue
       FROM booth_production_orders po
       WHERE po.org_id = $1 ${cond}${extra}
       ORDER BY po.id DESC
       LIMIT 200`,
      params
    );
    return res.json({ success: true, data: r.rows });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /:id — 生产单详情 (三级状态联动视图: 生产单→任务→工单)
// ---------------------------------------------------------------------------
router.get('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = orgOf(req as AuthedReq);
    const id = Number(req.params.id);
    const po = await pool.query(`SELECT * FROM booth_production_orders WHERE id = $1 AND org_id = $2`, [id, orgId]);
    if (po.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'production order not found', code: 'NOT_FOUND' });
    }
    const tasks = await pool.query(
      `SELECT t.*, w.status AS work_order_status, w.progress AS work_order_progress
       FROM booth_production_tasks t
       LEFT JOIN booth_work_orders w ON w.id = t.work_order_id
       WHERE t.production_order_id = $1 AND t.org_id = $2
       ORDER BY t.id`,
      [id, orgId]
    );
    // [BOOTH-PRD-003] 三级链路溯源: 任务 → 全部反挂工单（含凭证计数, BDD-02/05/09/10 链路视图）
    const taskIds = tasks.rows.map((t: any) => t.id);
    let workOrdersByTask: Record<number, any[]> = {};
    if (taskIds.length > 0) {
      const wos = await pool.query(
        `SELECT w.id, w.work_order_no, w.product_name, w.qty, w.status, w.progress, w.step_name, w.dimension, w.split_source,
                w.production_task_id, w.completed_at, w.created_at,
                (SELECT count(*)::int FROM booth_work_order_evidences e WHERE e.work_order_id = w.id) AS evidence_count
         FROM booth_work_orders w
         WHERE w.org_id = $1 AND (w.production_task_id = ANY($2::int[]) OR w.id IN (SELECT work_order_id FROM booth_production_tasks WHERE production_order_id = $3 AND org_id = $1 AND work_order_id IS NOT NULL))
         ORDER BY w.id`,
        [orgId, taskIds, id]
      );
      for (const w of wos.rows) {
        const tid = w.production_task_id ?? (tasks.rows.find((t: any) => t.work_order_id === w.id)?.id ?? 0);
        (workOrdersByTask[tid] = workOrdersByTask[tid] || []).push(w);
      }
    }
    return res.json({ success: true, data: { productionOrder: po.rows[0], tasks: tasks.rows, workOrdersByTask, eventWiring: STATUS_EVENT_WIRING } });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /:id/dispatch — 四铺拆单挂接点 (BDD-19 骨架预留)
// body: { tasks: [{ taskType*, workOrderId?, workOrderNo?, expectedDeliveryAt? }] }
// 幂等: 同 (production_order_id, task_type) 已有活跃任务不重复创建
// 工单实际创建归 IMPL-001 dispatchFulfillment; 任务经 work_order_id 挂接既有工单
// ---------------------------------------------------------------------------
router.post('/:id/dispatch', requireAuth, requireRole('du', 'dx', 'edx'), async (req: Request, res: Response, next: NextFunction) => {
  const authed = req as AuthedReq;
  const orgId = orgOf(authed);
  const id = Number(req.params.id);
  let tasks: any[] = Array.isArray((req.body as any)?.tasks) ? (req.body as any).tasks : [];
  if (tasks.length === 0) {
    // [BOOTH-PRD-002 BDD-01] 类型驱动派发: 订单类型 → 字典 default_target_shop_type → 默认主铺任务
    const poRow = await pool.query('SELECT order_type FROM booth_production_orders WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (poRow.rows.length === 0) return res.status(404).json({ success: false, error: 'production order not found', code: 'NOT_FOUND' });
    const ot = String(poRow.rows[0].order_type || 'self_made');
    const dict = await pool.query('SELECT default_target_shop_type FROM booth_order_types WHERE type_code = $1 AND enabled = true', [ot]);
    const target = String(dict.rows[0]?.default_target_shop_type || DEFAULT_TASK_TYPE_BY_ORDER[ot] || 'manufacture');
    tasks = [{ taskType: target }];
  }
  for (const t of tasks) {
    const taskType = String(t.taskType);
    if (!(TASK_TYPES as readonly string[]).includes(taskType)) {
      return res.status(400).json({ success: false, error: `taskType must be one of ${TASK_TYPES.join('/')}`, code: 'INVALID_TASK_TYPE' });
    }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const po = await client.query(
      `SELECT * FROM booth_production_orders WHERE id = $1 AND org_id = $2 FOR UPDATE`,
      [id, orgId]
    );
    if (po.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'production order not found', code: 'NOT_FOUND' });
    }
    const order = po.rows[0];

    // 幂等: 已有同铺型任务不重复创建
    const existing = await client.query(
      `SELECT task_type, id FROM booth_production_tasks WHERE production_order_id = $1 AND org_id = $2`,
      [id, orgId]
    );
    const existingTypes = new Set(existing.rows.map((r: any) => r.task_type));

    const created: any[] = [];
    for (const t of tasks) {
      if (existingTypes.has(String(t.taskType))) continue; // 幂等跳过
      const status = String(t.taskType) === 'manufacture' ? MANUFACTURE_DEFAULT_STATUS : TASK_STATUS.PENDING_SPLIT;
      const ins = await client.query(
        `INSERT INTO booth_production_tasks
           (org_id, production_order_id, task_type, status, work_order_id, work_order_no, expected_delivery_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          orgId,
          id,
          String(t.taskType),
          status,
          t.workOrderId ? Number(t.workOrderId) : null,
          t.workOrderNo ?? null,
          t.expectedDeliveryAt ? new Date(t.expectedDeliveryAt) : (order.expected_delivery_at ?? null),
        ]
      );
      created.push(ins.rows[0]);
    }

    // [BOOTH-PRD-003] 四铺拆单引擎: 新建任务按铺型规则自动拆工单（RD N工序=N工单 / MF 合并 / DL 按点×维度 / SP 简化+单据登记）
    // 幂等: 仅对本次新建任务拆（重放 dispatch 任务 skipped → 不重复拆）; splitTaskToWorkOrders 内部再兜底幂等
    let workOrders: any[] = [];
    const autoSplit = (req.body as any)?.autoSplit !== false; // 默认 true
    if (autoSplit && created.length > 0) {
      const { splitTaskToWorkOrders } = await import('../services/split-service.js');
      for (const t of created) {
        const wos = await splitTaskToWorkOrders(client, orgId, t, order);
        workOrders.push(...wos);
      }
    }

    // 生产单状态推进: 待下发/已下发 → 已下发; [BOOTH-PRD-003] 已拆出工单(执行中) → 进行中 (canTransition 校验)
    const nextStatus = workOrders.length > 0 ? PROD_STATUS.IN_PROGRESS : PROD_STATUS.DISPATCHED;
    if (canTransition('order', order.status, nextStatus) && order.status !== nextStatus) {
      await client.query(
        `UPDATE booth_production_orders SET status = $1, updated_at = NOW() WHERE id = $2`,
        [nextStatus, id]
      );
    }
    await client.query('COMMIT');

    if (created.length > 0) {
      emitAudit({ actor: authed.user?.identity_id || 'unknown', action: 'production_order.dispatch', resource: 'production_order', resourceId: String(id), result: 'success', detail: { createdTasks: created.length, taskTypes: created.map((c) => c.task_type), splitWorkOrders: workOrders.length } }, orgId);
      broadcast(orgId, 'production_order_dispatched', { id, createdTasks: created.length, splitWorkOrders: workOrders.length });
    }
    return res.json({ success: true, data: { createdTasks: created.length, tasks: created, skippedTypes: tasks.map((t) => String(t.taskType)).filter((ty) => existingTypes.has(ty)), workOrders, splitTaskIds: created.filter((c) => workOrders.some((w: any) => w.id && c.id)).map((c) => c.id) } });
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// POST /:id/status — 生产单状态流转 (canTransition 校验 + 自动聚合刷新)
// body: { status*, exceptionReason? }
// ---------------------------------------------------------------------------
router.post('/:id/status', requireAuth, requireRole('du', 'dx', 'edx'), async (req: Request, res: Response, next: NextFunction) => {
  const authed = req as AuthedReq;
  const orgId = orgOf(authed);
  const id = Number(req.params.id);
  const to = String((req.body as any)?.status || '');
  const reason = (req.body as any)?.exceptionReason ?? null;
  if (!to) {
    return res.status(400).json({ success: false, error: 'status is required', code: 'MISSING_STATUS' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const po = await client.query(
      `SELECT status FROM booth_production_orders WHERE id = $1 AND org_id = $2 FOR UPDATE`,
      [id, orgId]
    );
    if (po.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'production order not found', code: 'NOT_FOUND' });
    }
    const from = po.rows[0].status;
    if (!canTransition('order', from, to)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: `invalid transition ${from} -> ${to}`, code: 'INVALID_TRANSITION' });
    }
    if (from !== to) {
      await client.query(
        `UPDATE booth_production_orders SET status = $1, exception_reason = $2, updated_at = NOW() WHERE id = $3`,
        [to, to === PROD_STATUS.EXCEPTION ? (reason || '手动标记异常') : null, id]
      );
    }
    await client.query('COMMIT');
    emitAudit({ actor: authed.user?.identity_id || 'unknown', action: 'production_order.status', resource: 'production_order', resourceId: String(id), result: 'success', detail: { from, to } }, orgId);
    broadcast(orgId, 'production_order_updated', { id, from, to });
    return res.json({ success: true, data: { id, from, to } });
  } catch (err) {
    await client.query('ROLLBACK');
    return next(err);
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------------------
// POST /tasks/:id/link-work-order — 任务↔工单挂接 (BDD-19 拆单挂接点)
// body: { workOrderId*, workOrderNo? }
// ---------------------------------------------------------------------------
router.post('/tasks/:id/link-work-order', requireAuth, requireRole('du', 'dx', 'edx'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = orgOf(req as AuthedReq);
    const id = Number(req.params.id);
    const workOrderId = Number((req.body as any)?.workOrderId);
    if (!workOrderId) {
      return res.status(400).json({ success: false, error: 'workOrderId is required', code: 'MISSING_WORK_ORDER_ID' });
    }
    const wo = await pool.query(`SELECT id, work_order_no FROM booth_work_orders WHERE id = $1`, [workOrderId]);
    if (wo.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'work order not found', code: 'WORK_ORDER_NOT_FOUND' });
    }
    const r = await pool.query(
      `UPDATE booth_production_tasks
       SET work_order_id = $1, work_order_no = $2, updated_at = NOW()
       WHERE id = $3 AND org_id = $4
       RETURNING *`,
      [workOrderId, wo.rows[0].work_order_no ?? (req.body as any)?.workOrderNo ?? null, id, orgId]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'task not found', code: 'NOT_FOUND' });
    }
    const task = r.rows[0];
    const orderStatus = await refreshAggregation(orgId, task.production_order_id);
    return res.json({ success: true, data: { task, aggregatedOrderStatus: orderStatus } });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /evaluate — 全量超期自动判定 + 三级聚合刷新 (BDD-18)
// ---------------------------------------------------------------------------
router.post('/evaluate', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orgId = orgOf(req as AuthedReq);
    const result = await evaluateOverdue(orgId);
    // 全量聚合刷新（超期判定后）
    const pos = await pool.query(`SELECT id FROM booth_production_orders WHERE org_id = $1`, [orgId]);
    let refreshed = 0;
    for (const row of pos.rows) {
      await refreshAggregation(orgId, row.id);
      refreshed += 1;
    }
    return res.json({ success: true, data: { ...result, ordersRefreshed: refreshed } });
  } catch (err) {
    return next(err);
  }
});

export default router;
