/**
 * [BOOTH-PRD-003] 四铺拆单引擎（阶段一 P0 核心）
 *
 * 主链路: 订单下发 → 四铺拆单 → 工单执行 → 完成回传
 * 各铺拆单规则（BDD-02/09/10）:
 *   - 研发铺 RD-001: 匹配工艺拆单, N 工序 = N 工单 (工艺缺失回退单工序"通用研发")
 *   - 制造铺 MF-001/002/007: 双来源接单(自产+外发), 同工序多菜品合并为一张工单, 不设工序链
 *   - 配送铺 DL-001: 按配送点(路线) × 分拣员/配送员维度拆单
 *   - 供给铺 SP-001/002: 简化拆单(一任务一工单) + 按需登记出库单据(P2 边界仅登记)
 * 透传 (BDD-05): 工单经 production_task_id → 生产单, productionNo/dxCaseNo/waveNo 单源(生产单实体)不双写
 * 完成回传 (BDD-07/11): 工单状态流转复用 IMPL-001 work-order-service, packed.v1 由 completeWorkOrder emit
 */
import type { PoolClient } from 'pg';
import { TASK_STATUS } from './state-machine.js';

/** 工单号: PROD-<yyyyMMdd>-<4位流水>（与 IMPL-001 同序列, 当日全表计数, 唯一索引兜底防重） */
async function nextWorkOrderNo(client: PoolClient): Promise<string> {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const r = await client.query(
    `SELECT count(*)::int AS n FROM booth_work_orders WHERE work_order_no LIKE $1`,
    [`PROD-${ymd}-%`]
  );
  return `PROD-${ymd}-${String((r.rows[0]?.n ?? 0) + 1).padStart(4, '0')}`;
}

/** items 兼容归一: [{name|productName, qty, point|plazPoint}] → {name, qty, point} */
function normalizeItems(raw: unknown): Array<{ name: string; qty: number; point: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.map((it: any) => ({
    name: String(it?.name ?? it?.productName ?? it?.skuName ?? '未命名品项'),
    qty: Math.max(1, Number(it?.qty ?? 1) || 1),
    point: String(it?.point ?? it?.plazPoint ?? it?.route ?? '默认点'),
  }));
}

interface SplitWorkOrder {
  id: number;
  workOrderNo: string;
  productName: string;
  qty: number;
  stepName: string | null;
  dimension: string | null;
}

async function insertWorkOrder(
  client: PoolClient,
  orgId: number,
  taskId: number,
  wo: { workOrderNo: string; productName: string; qty: number; stepName: string | null; dimension: string | null; splitSource: string | null }
): Promise<SplitWorkOrder> {
  const ins = await client.query(
    `INSERT INTO booth_work_orders
       (org_id, work_order_no, product_name, qty, status, production_task_id, split_source, step_name, dimension)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7, $8)
     RETURNING id, work_order_no, product_name, qty, step_name, dimension`,
    [orgId, wo.workOrderNo, wo.productName.slice(0, 100), wo.qty, taskId, wo.splitSource, wo.stepName, wo.dimension]
  );
  const r = ins.rows[0];
  return { id: r.id, workOrderNo: r.work_order_no, productName: r.product_name, qty: r.qty, stepName: r.step_name, dimension: r.dimension };
}

/** 研发铺 RD-001: 匹配工艺 → N 工序=N 工单（BDD-09/10: 按工艺拆, 可含子项） */
async function splitRd(client: PoolClient, orgId: number, taskId: number, items: Array<{ name: string; qty: number }>): Promise<SplitWorkOrder[]> {
  const created: SplitWorkOrder[] = [];
  for (const item of items) {
    const craft = await client.query(
      `SELECT id, craft_name, steps FROM booth_crafts WHERE org_id = $1 AND product_name = $2 AND enabled = true ORDER BY id ASC LIMIT 1`,
      [orgId, item.name]
    );
    let steps: Array<{ seq: number; name: string }> = craft.rows[0]?.steps || [];
    if (craft.rows.length === 0 || !Array.isArray(steps) || steps.length === 0) {
      steps = [{ seq: 1, name: '通用研发' }]; // 无匹配工艺 → 单工序兜底（工单可挂接/重拆）
    }
    const sorted = [...steps].sort((a, b) => (Number(a?.seq) || 0) - (Number(b?.seq) || 0));
    for (const step of sorted) {
      created.push(await insertWorkOrder(client, orgId, taskId, {
        workOrderNo: await nextWorkOrderNo(client),
        productName: item.name,
        qty: item.qty,
        stepName: String(step?.name || '未命名工序'),
        dimension: null,
        splitSource: null,
      }));
    }
  }
  return created;
}

/** 制造铺 MF-001/002/007: 同工序多菜品合并一张工单（不设工序链）, 双来源 split_source 标记 */
async function splitManufacture(client: PoolClient, orgId: number, taskId: number, items: Array<{ name: string; qty: number }>, orderType: string): Promise<SplitWorkOrder[]> {
  const totalQty = items.reduce((s, it) => s + it.qty, 0);
  const mergedName = items.map((it) => `${it.name}×${it.qty}`).join('、') || '合并工单';
  return [await insertWorkOrder(client, orgId, taskId, {
    workOrderNo: await nextWorkOrderNo(client),
    productName: mergedName,
    qty: totalQty,
    stepName: null,
    dimension: null,
    splitSource: orderType === 'outsource' ? 'outsource' : 'self_made', // MF-002 双来源
  })];
}

/** 配送铺 DL-001: 按配送点(路线)分组 × 分拣/配送两维度拆单 */
async function splitDelivery(client: PoolClient, orgId: number, taskId: number, items: Array<{ name: string; qty: number; point: string }>): Promise<SplitWorkOrder[]> {
  const byPoint = new Map<string, Array<{ name: string; qty: number }>>();
  for (const it of items) {
    const list = byPoint.get(it.point) || [];
    list.push({ name: it.name, qty: it.qty });
    byPoint.set(it.point, list);
  }
  const created: SplitWorkOrder[] = [];
  for (const [point, pointItems] of byPoint) {
    const mergedName = `${point}:${pointItems.map((it) => `${it.name}×${it.qty}`).join('、')}`;
    const totalQty = pointItems.reduce((s, it) => s + it.qty, 0);
    for (const dimension of ['sorting', 'delivery']) {
      created.push(await insertWorkOrder(client, orgId, taskId, {
        workOrderNo: await nextWorkOrderNo(client),
        productName: mergedName,
        qty: totalQty,
        stepName: dimension === 'sorting' ? '分拣' : '配送',
        dimension,
        splitSource: null,
      }));
    }
  }
  return created;
}

/** 供给铺 SP-001/002: 简化拆单（一任务一工单）+ 按需登记出库单据骨架（P2 仅登记） */
async function splitSupply(client: PoolClient, orgId: number, taskId: number, items: Array<{ name: string; qty: number }>): Promise<SplitWorkOrder[]> {
  const mergedName = items.map((it) => `${it.name}×${it.qty}`).join('、') || '通货供给';
  const totalQty = items.reduce((s, it) => s + it.qty, 0);
  const wo = await insertWorkOrder(client, orgId, taskId, {
    workOrderNo: await nextWorkOrderNo(client),
    productName: mergedName,
    qty: totalQty,
    stepName: null,
    dimension: null,
    splitSource: 'outsource',
  });
  // SP-002 三类单据(出入库/调拨/盘点按需): 拆单即登记出库单骨架
  await client.query(
    `INSERT INTO booth_stock_docs (org_id, work_order_id, doc_type, payload, created_by)
     VALUES ($1, $2, 'outbound', $3::jsonb, 'split-engine')`,
    [orgId, wo.id, JSON.stringify({ source: 'PRD-003-split', items })]
  );
  return [wo];
}

/**
 * 四铺拆单统一入口: 按任务铺型路由规则, 在给定事务 client 内建工单并回写任务状态。
 * 幂等: 仅当任务下无既有工单时执行（重放 dispatch 安全）。
 */
export async function splitTaskToWorkOrders(
  client: PoolClient,
  orgId: number,
  task: { id: number; task_type: string; status: string },
  order: { items: unknown; order_type: string }
): Promise<SplitWorkOrder[]> {
  // 幂等: 任务已有挂接工单（反挂或单挂）不重复拆
  const existing = await client.query(
    `SELECT id FROM booth_work_orders WHERE org_id = $1 AND (production_task_id = $2 OR id = (SELECT work_order_id FROM booth_production_tasks WHERE id = $2)) LIMIT 1`,
    [orgId, task.id]
  );
  if (existing.rows.length > 0) return [];

  const items = normalizeItems(order.items);
  if (items.length === 0) return []; // 无品项不拆单（任务保持待拆分, 补 items 后重新 dispatch）
  let created: SplitWorkOrder[];
  switch (task.task_type) {
    case 'rd':
      created = await splitRd(client, orgId, task.id, items);
      break;
    case 'manufacture':
      created = await splitManufacture(client, orgId, task.id, items, order.order_type);
      break;
    case 'delivery':
      created = await splitDelivery(client, orgId, task.id, items);
      break;
    case 'supply':
    default:
      created = await splitSupply(client, orgId, task.id, items);
      break;
  }

  // 任务回写: 已拆分 → 执行中; work_order_no 记首张（溯源快捷列, 完整链路经 production_task_id 反查）
  if (created.length > 0 && task.status === TASK_STATUS.PENDING_SPLIT) {
    await client.query(
      `UPDATE booth_production_tasks SET status = $1, work_order_no = $2, updated_at = NOW() WHERE id = $3`,
      [TASK_STATUS.IN_PROGRESS, created[0].workOrderNo, task.id]
    );
  }
  return created;
}

/** 生产单全量拆单: 对生产单下全部任务执行拆单（dispatch 后自动触发） */
export async function splitAllTasksOfOrder(
  client: PoolClient,
  orgId: number,
  productionOrderId: number,
  order: { items: unknown; order_type: string }
): Promise<{ splitTaskIds: number[]; workOrders: SplitWorkOrder[] }> {
  const tasks = await client.query(
    `SELECT id, task_type, status FROM booth_production_tasks WHERE production_order_id = $1 AND org_id = $2 ORDER BY id ASC`,
    [productionOrderId, orgId]
  );
  const splitTaskIds: number[] = [];
  const workOrders: SplitWorkOrder[] = [];
  for (const t of tasks.rows) {
    const created = await splitTaskToWorkOrders(client, orgId, t, order);
    if (created.length > 0) {
      splitTaskIds.push(t.id);
      workOrders.push(...created);
    }
  }
  return { splitTaskIds, workOrders };
}
