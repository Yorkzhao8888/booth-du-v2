/**
 * BOOTH-PK-02: SupplyOrder 显式契约（下单→报价→追踪→签收）
 *
 * 方案 A：不新建表，扩展 booth_fulfillments 为契约载体
 *   - contract_status: Created → Quoted → Confirmed → Planning → Scheduling → Executing → Delivered → Settled（确认前可取消 → Cancelled）
 *   - quote_snapshot: 报价快照（unit_price/total_amount/currency/quote_valid_until/quoted_by）
 *   - milestones: quoted_at/confirmed_at/planned_at/scheduled_at/executing_at/delivered_at/settled_at
 *
 * 路径风格：{id}:quote 为对外契约动作（Google AIP 自定义方法），Express 4 以 '\\:' 匹配字面冒号；
 *         同时注册 /:id/quote 斜杠别名便于常规客户端。
 *
 * 价格边界：M 层（du/dx/em/dm）知价；X 层（dex/exx）GET 状态仅暴露工单号与状态（剥离 quote_snapshot 与 items 价格）。
 * 事件：SupplyOrder.Confirmed / Delivery.Confirmed 走 booth_outbox（结算订阅可用）。
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { pool } from '../db.js';
import { requireRole, type JwtPayload } from '../auth.js';
import { openXCaseForFulfillment } from '../services/finance-service.js';

const M_ROLES = ['du', 'dx', 'em'];
const PRICE_ROLES = ['du', 'dx'];

type FulfillmentRow = {
  id: number;
  org_id: number;
  shop_order_id: string;
  status: string;
  items: any;
  required_at: string | null;
  contract_status: string | null;
  quote_snapshot: any;
  milestones: any;
  created_at: string;
};

/** 既有非契约单回填值映射（migrate 回填同规则） */
const STATUS_BACKFILL: Record<string, string> = {
  pending: 'Created',
  dispatched: 'Executing',
  completed: 'Settled',
  cancelled: 'Cancelled',
};

function normalizeContract(row: FulfillmentRow): FulfillmentRow {
  if (row.contract_status == null && row.milestones == null && row.quote_snapshot == null) {
    row.contract_status = STATUS_BACKFILL[row.status] ?? 'Settled';
    row.milestones = {};
  }
  return row;
}

/** M 层全量视图 */
function fullView(row: FulfillmentRow) {
  return {
    id: row.id,
    shop_order_id: row.shop_order_id,
    status: row.status,
    contract_status: row.contract_status,
    quote_snapshot: row.quote_snapshot,
    milestones: row.milestones,
    items: row.items,
    required_at: row.required_at,
    created_at: row.created_at,
  };
}

/** X 层脱敏视图：仅工单号与状态（红线：不暴露报价字段） */
function xlayerView(row: FulfillmentRow) {
  return {
    id: row.id,
    shop_order_id: row.shop_order_id,
    status: row.status,
    contract_status: row.contract_status,
    milestones: row.milestones,
    items: Array.isArray(row.items)
      ? row.items.map((it: any) => ({ productName: it.productName, qty: it.qty }))
      : row.items,
    required_at: row.required_at,
  };
}

/** X 层可读、M 层全量 */
function readView(user: JwtPayload, row: FulfillmentRow) {
  const isM = ['du', 'dx', 'em', 'dm'].includes(user.role);
  return isM ? fullView(row) : xlayerView(row);
}

function failure(res: Response, statusCode: number, code: string, error: string) {
  return res.status(statusCode).json({ success: false, error, code });
}

/** 契约状态机非法跳转守卫：返回行或写入错误响应 */
async function loadContract(id: number, orgId: number): Promise<FulfillmentRow | null> {
  const r = await pool.query(
    `SELECT * FROM booth_fulfillments WHERE id = $1 AND org_id = $2`,
    [id, orgId]
  );
  return r.rows[0] ?? null;
}

async function emitOutbox(orgId: number, eventType: string, payload: unknown) {
  await pool.query(
    `INSERT INTO booth_outbox (org_id, event_type, payload, status, created_at)
     VALUES ($1, $2, $3::jsonb, 'pending', NOW())`,
    [orgId, eventType, JSON.stringify(payload)]
  );
}

const M_ONLY = requireRole(...M_ROLES);
const PRICE_ONLY = requireRole(...PRICE_ROLES);

const supplyOrdersRouter = Router();
supplyOrdersRouter.use(requireRole('du', 'dx', 'em', 'dm', 'dex', 'exx'));

/**
 * shop 创建契约（M 层代录）：POST /supply-orders
 * body: { shop_order_id?, items: [{productName, qty, price?}], required_at?, remark? }
 */
supplyOrdersRouter.post('/', M_ONLY, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { shop_order_id, items, required_at, remark } = req.body ?? {};
    if (!Array.isArray(items) || items.length === 0) {
      return failure(res, 400, 'INVALID_BODY', 'items required');
    }
    if (!items.every((it: any) => it && typeof it.qty === 'number' && it.qty > 0)) {
      return failure(res, 400, 'INVALID_BODY', 'each item needs qty > 0');
    }
    const externalId =
      typeof shop_order_id === 'string' && shop_order_id.trim()
        ? shop_order_id.trim()
        : `SO-${Date.now().toString(36).toUpperCase()}`;

    const dup = await pool.query(
      `SELECT id FROM booth_fulfillments WHERE org_id = $1 AND shop_order_id = $2`,
      [user.orgId, externalId]
    );
    if (dup.rows.length) {
      return failure(res, 409, 'DUPLICATE_SHOP_ORDER', `shop_order_id already exists: ${externalId}`);
    }

    const ins = await pool.query(
      `INSERT INTO booth_fulfillments
         (org_id, shop_order_id, status, items, required_at, contract_status, milestones, quote_snapshot)
       VALUES ($1, $2, 'pending', $3::jsonb, $4, 'Created', '{}'::jsonb, NULL)
       RETURNING *`,
      [user.orgId, externalId, JSON.stringify(items), required_at ?? null]
    );
    return res.json({ success: true, data: fullView(normalizeContract(ins.rows[0])) });
  } catch (err) {
    next(err);
  }
});

/** 契约列表（M 层）：GET /supply-orders?contract_status= */
supplyOrdersRouter.get('/', M_ONLY, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user as JwtPayload;
    const cs = req.query.contract_status as string | undefined;
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    const r = cs
      ? await pool.query(
          `SELECT * FROM booth_fulfillments WHERE org_id = $1 AND contract_status = $2 ORDER BY id DESC LIMIT $3`,
          [user.orgId, cs, limit]
        )
      : await pool.query(
          `SELECT * FROM booth_fulfillments WHERE org_id = $1 ORDER BY id DESC LIMIT $2`,
          [user.orgId, limit]
        );
    return res.json({ success: true, data: r.rows.map((x) => fullView(normalizeContract(x))) });
  } catch (err) {
    next(err);
  }
});

/** 报价：POST /supply-orders/:id:quote（du/dx，M 层知价） */
async function quoteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user as JwtPayload;
    const id = Number(req.params.id);
    const { unit_price, total_amount, currency, valid_days } = req.body ?? {};
    if (typeof unit_price !== 'number' || unit_price < 0) {
      return failure(res, 400, 'INVALID_BODY', 'unit_price(number >= 0) required');
    }
    const row = await loadContract(id, user.orgId);
    if (!row) return failure(res, 404, 'NOT_FOUND', 'contract not found');
    if (row.contract_status !== 'Created') {
      return failure(res, 409, 'INVALID_STATE', `quote requires Created, current: ${row.contract_status}`);
    }
    const validUntil = new Date(Date.now() + (Number(valid_days) > 0 ? Number(valid_days) : 7) * 86400000).toISOString();
    const snapshot = {
      unit_price,
      total_amount: typeof total_amount === 'number' ? total_amount : unit_price * (Array.isArray(row.items) ? row.items.reduce((s: number, it: any) => s + (Number(it.qty) || 0), 0) : 0),
      currency: typeof currency === 'string' && currency ? currency : 'CNY',
      quote_valid_until: validUntil,
      quoted_by: user.userId,
    };
    const upd = await pool.query(
      `UPDATE booth_fulfillments
       SET contract_status = 'Quoted',
           quote_snapshot = $3::jsonb,
           milestones = COALESCE(milestones, '{}'::jsonb) || jsonb_build_object('quoted_at', to_jsonb(NOW()))
       WHERE id = $1 AND org_id = $2 AND contract_status = 'Created'
       RETURNING *`,
      [id, user.orgId, JSON.stringify(snapshot)]
    );
    return res.json({ success: true, data: fullView(normalizeContract(upd.rows[0])) });
  } catch (err) {
    next(err);
  }
}
supplyOrdersRouter.post('/:id\\:quote', PRICE_ONLY, quoteHandler);
supplyOrdersRouter.post('/:id/quote', PRICE_ONLY, quoteHandler);

/** shop 确认：POST /supply-orders/:id:confirm（Quoted → Confirmed） */
async function confirmHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user as JwtPayload;
    const id = Number(req.params.id);
    const row = await loadContract(id, user.orgId);
    if (!row) return failure(res, 404, 'NOT_FOUND', 'contract not found');
    if (row.contract_status !== 'Quoted') {
      return failure(res, 409, 'INVALID_STATE', `confirm requires Quoted, current: ${row.contract_status}`);
    }
    const upd = await pool.query(
      `UPDATE booth_fulfillments
       SET contract_status = 'Confirmed',
           milestones = COALESCE(milestones, '{}'::jsonb) || jsonb_build_object('confirmed_at', to_jsonb(NOW()))
       WHERE id = $1 AND org_id = $2 AND contract_status = 'Quoted'
       RETURNING *`,
      [id, user.orgId]
    );
    const data = fullView(normalizeContract(upd.rows[0]));
    await emitOutbox(user.orgId, 'SupplyOrder.Confirmed', {
      fulfillment_id: id,
      shop_order_id: row.shop_order_id,
      contract_status: 'Confirmed',
      confirmed_at: data.milestones?.confirmed_at ?? null,
    });
    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
supplyOrdersRouter.post('/:id\\:confirm', M_ONLY, confirmHandler);
supplyOrdersRouter.post('/:id/confirm', M_ONLY, confirmHandler);

/** 取消（确认前可取消）：POST /supply-orders/:id:cancel */
async function cancelHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user as JwtPayload;
    const id = Number(req.params.id);
    const row = await loadContract(id, user.orgId);
    if (!row) return failure(res, 404, 'NOT_FOUND', 'contract not found');
    if (!['Created', 'Quoted'].includes(row.contract_status ?? '')) {
      return failure(res, 409, 'INVALID_STATE', `cancel requires Created/Quoted, current: ${row.contract_status}`);
    }
    const upd = await pool.query(
      `UPDATE booth_fulfillments
       SET contract_status = 'Cancelled',
           milestones = COALESCE(milestones, '{}'::jsonb) || jsonb_build_object('cancelled_at', to_jsonb(NOW()))
       WHERE id = $1 AND org_id = $2 AND contract_status IN ('Created', 'Quoted')
       RETURNING *`,
      [id, user.orgId]
    );
    return res.json({ success: true, data: fullView(normalizeContract(upd.rows[0])) });
  } catch (err) {
    next(err);
  }
}
supplyOrdersRouter.post('/:id\\:cancel', M_ONLY, cancelHandler);
supplyOrdersRouter.post('/:id/cancel', M_ONLY, cancelHandler);

/**
 * 流式状态查询：GET /supply-orders/:id/status
 * M 层全量（含报价快照）；dex/exx 仅工单号与状态（红线）。
 * 事件侧实时推送经 booth_outbox + SSE；本接口为轮询式查询（前端 10s 轮询）。
 */
async function statusHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user as JwtPayload;
    const id = Number(req.params.id);
    const row = await loadContract(id, user.orgId);
    if (!row) return failure(res, 404, 'NOT_FOUND', 'contract not found');
    normalizeContract(row);
    const wos = await pool.query(
      `SELECT id, status, product_name FROM booth_work_orders WHERE org_id = $1 AND fulfillment_id = $2 ORDER BY id`,
      [user.orgId, id]
    );
    return res.json({
      success: true,
      data: { ...readView(user, row), work_orders: wos.rows },
    });
  } catch (err) {
    next(err);
  }
}
supplyOrdersRouter.get('/:id/status', statusHandler);

/** 交付签收：POST /deliveries/:id:confirm（Executing → Delivered → Settled，事件 Delivery.Confirmed） */
async function deliveryConfirmHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const user = (req as any).user as JwtPayload;
    const id = Number(req.params.id);
    const row = await loadContract(id, user.orgId);
    if (!row) return failure(res, 404, 'NOT_FOUND', 'contract not found');
    if (row.contract_status !== 'Executing') {
      return failure(res, 409, 'INVALID_STATE', `delivery confirm requires Executing, current: ${row.contract_status}`);
    }
    const upd = await pool.query(
      `UPDATE booth_fulfillments
       SET contract_status = 'Settled',
           milestones = COALESCE(milestones, '{}'::jsonb)
             || jsonb_build_object('delivered_at', to_jsonb(NOW()))
             || jsonb_build_object('settled_at', to_jsonb(NOW()))
       WHERE id = $1 AND org_id = $2 AND contract_status = 'Executing'
       RETURNING *`,
      [id, user.orgId]
    );
    const data = fullView(normalizeContract(upd.rows[0]));
    await emitOutbox(user.orgId, 'Delivery.Confirmed', {
      fulfillment_id: id,
      shop_order_id: row.shop_order_id,
      contract_status: 'Settled',
      delivered_at: data.milestones?.delivered_at ?? null,
      settled_at: data.milestones?.settled_at ?? null,
    });

    // [BOOTH-PK-05] 业财闭环: Settled 自动立 xcase(幂等, uq fulfillment_id) + 收入凭证(真实报价快照) + outbox 事件
    // 失败不阻断签收主流程(履约状态已落库); 幂等键防重复立案
    try {
      const fin = await openXCaseForFulfillment(user.orgId, upd.rows[0]);
      if (fin) {
        await emitOutbox(user.orgId, 'Finance.XCaseOpened', {
          xcase_no: fin.xcaseNo,
          fulfillment_id: id,
          income: fin.income,
          vouchers: fin.voucherNos,
        });
      }
    } catch (finErr: any) {
      console.error('[PK-05] openXCaseForFulfillment failed (confirm flow 不回滚):', finErr?.message);
    }

    return res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
const deliveriesRouter = Router();
deliveriesRouter.use(requireRole('du', 'dx', 'em', 'dm', 'dex', 'exx'));
deliveriesRouter.post('/:id\\:confirm', M_ONLY, deliveryConfirmHandler);
deliveriesRouter.post('/:id/confirm', M_ONLY, deliveryConfirmHandler);

export { supplyOrdersRouter, deliveriesRouter };
