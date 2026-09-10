/**
 * [XFACTORY-P1] Xfactory (Booth-DE 供给版) 组合 1/2 核心服务
 *
 * 组合 1（供给主线）: X-Supply 采购登记 → EMX 确认下单（桩接） → 生产单(source=SUPPLY, Order-T)
 *   → 四铺拆单 → 作业系统 → G-005 凭证自动完成 → 完工入库(ERP 联动, F4 补偿) → 交付 DDU（回执生成即责任转移）
 * 组合 2（市场组合）: X-Market 需求入站 → 生产单(source=MARKET, Order-T) → 生产 → 交付 XU（经 X-Market 渠道回执）
 *   → XU 收货确认闭环
 *
 * 契约口径（Booth_Market 契约单 v1.1）:
 * - waveNo / productionNo 与 Order-T 一致透传；source ∈ {SUPPLY, MARKET}
 * - EMX 桩接仅登记+确认，不做撮合/合同/结算
 * - 合同/客户完整信息不落 Booth（数据最小化，仅保留必要业务键）
 * - F1 透传失败: 入站异常 → DLQ + 审计; F2 回写失败: outbox 重试→dead+last_error; F3 交付失败: 回执重发端点 + 审计
 */
import { pool } from '../db';
import { TOPIC } from './event-topics';
import { emitAudit } from './audit-service';

/* ---------- 内部工具 ---------- */

function prodSeqDate(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** 生产单号 PROD-YYYYMMDD-NNNN（与 PRD-001 同序列） */
export async function nextProductionNo(client: any, orgId: number): Promise<string> {
  const seq = `${prodSeqDate()}`;
  const r = await client.query(
    `SELECT COUNT(*)::int AS c FROM booth_production_orders
      WHERE org_id = $1 AND production_no LIKE $2`,
    [orgId, `PROD-${seq}-%`],
  );
  const n = (r.rows[0]?.c || 0) + 1;
  return `PROD-${seq}-${String(n).padStart(4, '0')}`;
}

/** 交付回执号 DLV-YYYYMMDD-NNNN */
async function nextReceiptNo(client: any, orgId: number): Promise<string> {
  const seq = `${prodSeqDate()}`;
  const r = await client.query(
    `SELECT COUNT(*)::int AS c FROM booth_delivery_receipts
      WHERE org_id = $1 AND receipt_no LIKE $2`,
    [orgId, `DLV-${seq}-%`],
  );
  const n = (r.rows[0]?.c || 0) + 1;
  return `DLV-${seq}-${String(n).padStart(4, '0')}`;
}

function sumQty(items: any[]): number {
  return (items || []).reduce((s: number, it: any) => s + (Number(it?.qty) || 0), 0);
}

function normalizeItems(raw: any): any[] {
  const arr = Array.isArray(raw) ? raw : [];
  // 数据最小化：仅保留 name/qty/point 业务键，合同与客户完整信息不落库
  return arr.map((it: any) => ({
    name: String(it?.name ?? it?.productName ?? '未命名项'),
    qty: Number(it?.qty) || 1,
    ...(it?.point ? { point: String(it.point) } : {}),
  }));
}

async function enqueueOutbox(client: any, orgId: number, eventType: string, payload: any): Promise<void> {
  await client.query(
    `INSERT INTO booth_outbox (org_id, event_type, payload)
     VALUES ($1, $2, $3::jsonb)`,
    [orgId, eventType, JSON.stringify(payload)],
  );
}

/** 为生产单建主铺任务并四铺拆单（manufacture 主体任务） */
async function createTaskAndSplit(client: any, orgId: number, poId: number, po: any): Promise<any> {
  const taskRes = await client.query(
    `INSERT INTO booth_production_tasks
       (org_id, production_order_id, task_type, status, work_order_id, work_order_no)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [orgId, poId, 'manufacture', 'in_progress', null, null],
  );
  const task = taskRes.rows[0];
  const { splitTaskToWorkOrders } = await import('./split-service');
  const workOrders = await splitTaskToWorkOrders(client, orgId, task, po);
  return { task, workOrders };
}

/* ---------- 组合 1: X-Supply 采购登记（EMX 桩接） ---------- */

export interface SupplyPurchasePayload {
  eventId?: string;
  supplyPurchaseNo: string;
  waveNo?: string | null;
  items: any[];
  supplier?: string | null;
}

export async function registerSupplyPurchase(
  orgId: number,
  payload: SupplyPurchasePayload,
): Promise<{ idempotent?: boolean; skipped?: string; purchase?: any }> {
  if (!payload?.eventId || !payload?.supplyPurchaseNo) {
    const err: any = new Error('eventId and supplyPurchaseNo are required');
    err.statusCode = 400;
    err.code = 'INVALID_PAYLOAD';
    throw err;
  }
  const items = normalizeItems(payload.items);
  const ins = await pool.query(
    `INSERT INTO booth_supply_purchases
       (org_id, event_id, supply_purchase_no, wave_no, items, status)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'registered')
     ON CONFLICT (event_id) DO NOTHING
     RETURNING *`,
    [orgId, payload.eventId, payload.supplyPurchaseNo, payload.waveNo ?? null, JSON.stringify(items)],
  );
  if (ins.rowCount && ins.rows[0]) {
    await enqueueOutbox(pool, orgId, TOPIC.SUPPLY_PURCHASE_REGISTERED, {
      supplyPurchaseNo: payload.supplyPurchaseNo,
      waveNo: payload.waveNo ?? null,
      items,
      state: 'registered',
    });
    await emitAudit(
      {
        actor: 'X-Supply',
        action: 'supply_purchase.registered',
        resource: 'booth_supply_purchases',
        resourceId: ins.rows[0].id,
        result: 'success',
        detail: { supplyPurchaseNo: payload.supplyPurchaseNo, waveNo: payload.waveNo ?? null },
      },
      orgId,
    );
    return { purchase: mapPurchase(ins.rows[0]) };
  }
  // event_id 幂等命中 → 返回既有（或单号重复的不同事件，同样收敛到既有单）
  const exist = await pool.query(
    `SELECT * FROM booth_supply_purchases
      WHERE org_id = $1 AND (event_id = $2 OR supply_purchase_no = $3)
      ORDER BY (event_id = $2) DESC LIMIT 1`,
    [orgId, payload.eventId, payload.supplyPurchaseNo],
  );
  return { idempotent: true, skipped: 'duplicate', purchase: exist.rows[0] ? mapPurchase(exist.rows[0]) : null };
}

/** EMX 确认采购（一键下单桩接）：登记单 → 生产单(source=SUPPLY, Order-T) → 主铺任务+四铺拆单 */
export async function confirmSupplyPurchase(
  orgId: number,
  purchaseId: number,
  operator: { userId?: number | null; username?: string | null },
): Promise<{ idempotent?: boolean; skipped?: string; purchase?: any; productionOrder?: any; workOrders?: any[] }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query(
      `SELECT * FROM booth_supply_purchases WHERE id = $1 AND org_id = $2 FOR UPDATE`,
      [purchaseId, orgId],
    );
    const row = lock.rows[0];
    if (!row) {
      const err: any = new Error('supply purchase not found');
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (row.status === 'confirmed') {
      await client.query('ROLLBACK');
      const po = row.production_order_id
        ? await pool.query(`SELECT * FROM booth_production_orders WHERE id = $1`, [row.production_order_id])
        : null;
      return {
        idempotent: true,
        skipped: 'already_confirmed',
        purchase: row,
        productionOrder: po?.rows[0] || null,
      };
    }
    const items = row.items || [];
    const productionNo = await nextProductionNo(client, orgId);
    const poRes = await client.query(
      `INSERT INTO booth_production_orders
         (org_id, production_no, shop_order_id, order_type, status, items, wave_no, source, order_family)
       VALUES ($1, $2, $3, 'outsource', 'dispatched', $4::jsonb, $5, 'SUPPLY', 'T')
       RETURNING *`,
      [orgId, productionNo, row.supply_purchase_no, JSON.stringify(items), row.wave_no],
    );
    const po = poRes.rows[0];
    const { task, workOrders } = await createTaskAndSplit(client, orgId, po.id, po);
    const upd = await client.query(
      `UPDATE booth_supply_purchases
          SET status = 'confirmed', confirmed_by = $2, confirmed_at = NOW(),
              production_order_id = $3, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [purchaseId, operator?.username || `u${operator?.userId ?? 0}`, po.id],
    );
    await enqueueOutbox(client, orgId, TOPIC.SUPPLY_PURCHASE_CONFIRMED, {
      supplyPurchaseNo: row.supply_purchase_no,
      waveNo: row.wave_no,
      productionNo: po.production_no,
      productionOrderId: po.id,
      qty: sumQty(items),
      confirmedBy: operator?.username || `u${operator?.userId ?? 0}`,
    });
    await client.query('COMMIT');
    await emitAudit(
      {
        actor: operator?.username || `u${operator?.userId ?? 0}`,
        action: 'supply_purchase.confirmed',
        resource: 'booth_supply_purchases',
        resourceId: purchaseId,
        result: 'success',
        detail: { productionNo: po.production_no, waveNo: row.wave_no },
      },
      orgId,
    );
    return { purchase: mapPurchase(upd.rows[0]), productionOrder: mapProduction(po), workOrders: (workOrders as Array<Record<string, unknown>>).map((w) => mapWorkOrder(w)) };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/* ---------- 组合 2: X-Market 需求入站 ---------- */

export interface MarketDemandPayload {
  eventId?: string;
  marketDemandNo: string;
  waveNo?: string | null;
  items: any[];
}

export async function registerMarketDemand(
  orgId: number,
  payload: MarketDemandPayload,
): Promise<{ idempotent?: boolean; skipped?: string; productionOrder?: any; workOrders?: any[] }> {
  if (!payload?.eventId || !payload?.marketDemandNo) {
    const err: any = new Error('eventId and marketDemandNo are required');
    err.statusCode = 400;
    err.code = 'INVALID_PAYLOAD';
    throw err;
  }
  // 幂等第一层: shop_order_id = marketDemandNo（生产单唯一键）
  const exist = await pool.query(
    `SELECT * FROM booth_production_orders WHERE org_id = $1 AND shop_order_id = $2`,
    [orgId, payload.marketDemandNo],
  );
  if (exist.rows[0]) {
    return { idempotent: true, skipped: 'duplicate_demand', productionOrder: mapProduction(exist.rows[0]) };
  }
  const items = normalizeItems(payload.items);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const productionNo = await nextProductionNo(client, orgId);
    const poRes = await client.query(
      `INSERT INTO booth_production_orders
         (org_id, production_no, shop_order_id, order_type, status, items, wave_no, source, order_family)
       VALUES ($1, $2, $3, 'rd_dev', 'dispatched', $4::jsonb, $5, 'MARKET', 'T')
       RETURNING *`,
      [orgId, productionNo, payload.marketDemandNo, JSON.stringify(items), payload.waveNo ?? null],
    );
    const po = poRes.rows[0];
    const { workOrders } = await createTaskAndSplit(client, orgId, po.id, po);
    await enqueueOutbox(client, orgId, TOPIC.MARKET_DEMAND_REGISTERED, {
      marketDemandNo: payload.marketDemandNo,
      waveNo: payload.waveNo ?? null,
      productionNo: po.production_no,
      items,
    });
    await client.query('COMMIT');
    await emitAudit(
      {
        actor: 'X-Market',
        action: 'market_demand.registered',
        resource: 'booth_production_orders',
        resourceId: po.id,
        result: 'success',
        detail: { marketDemandNo: payload.marketDemandNo, productionNo: po.production_no },
      },
      orgId,
    );
    return { productionOrder: mapProduction(po), workOrders: (workOrders as Array<Record<string, unknown>>).map((w) => mapWorkOrder(w)) };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    // 幂等兜底：并发重复入站撞唯一键 → 收敛为既有生产单
    if (String((e as any)?.code) === '23505') {
      const again = await pool.query(
        `SELECT * FROM booth_production_orders WHERE org_id = $1 AND shop_order_id = $2`,
        [orgId, payload.marketDemandNo],
      );
      return { idempotent: true, skipped: 'duplicate_demand', productionOrder: again.rows[0] ? mapProduction(again.rows[0]) : null };
    }
    throw e;
  } finally {
    client.release();
  }
}

/* ---------- 交付回执（组合 1 → DDU / 组合 2 → XU） ---------- */

/** 采集生产单关联的 G-005 凭证号集合（回执字段之一） */
async function collectEvidenceNos(client: any, orgId: number, poId: number): Promise<number[]> {
  const r = await client.query(
    `SELECT e.id FROM booth_work_order_evidences e
       JOIN booth_work_orders w ON w.id = e.work_order_id
      WHERE e.org_id = $1 AND w.production_task_id IN
            (SELECT id FROM booth_production_tasks WHERE production_order_id = $2)
      ORDER BY e.id`,
    [orgId, poId],
  );
  return r.rows.map((x: any) => x.id);
}

export async function issueDeliveryReceipt(
  orgId: number,
  productionOrderId: number,
  receiverType: 'DDU' | 'XU',
  operator: { userId?: number | null; username?: string | null },
): Promise<{ idempotent?: boolean; skipped?: string; receipt?: any }> {
  if (receiverType !== 'DDU' && receiverType !== 'XU') {
    const err: any = new Error('receiverType must be DDU or XU');
    err.statusCode = 400;
    err.code = 'INVALID_RECEIVER';
    throw err;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const poRes = await client.query(
      `SELECT * FROM booth_production_orders WHERE id = $1 AND org_id = $2 FOR UPDATE`,
      [productionOrderId, orgId],
    );
    const po = poRes.rows[0];
    if (!po) {
      const err: any = new Error('production order not found');
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }
    // 幂等: 一单一回执
    const exist = await client.query(
      `SELECT * FROM booth_delivery_receipts WHERE org_id = $1 AND production_order_id = $2`,
      [orgId, productionOrderId],
    );
    if (exist.rows[0]) {
      await client.query('ROLLBACK');
      return { idempotent: true, skipped: 'receipt_exists', receipt: exist.rows[0] };
    }
    if (po.status !== 'completed') {
      const err: any = new Error('production order not completed, cannot deliver');
      err.statusCode = 400;
      err.code = 'NOT_COMPLETED';
      throw err;
    }
    const evidenceNos = await collectEvidenceNos(client, orgId, productionOrderId);
    const receiptNo = await nextReceiptNo(client, orgId);
    const qty = (po.items || []).reduce((acc: number, it: { qty?: number }) => acc + (Number(it.qty) || 0), 0);
    const recRes = await client.query(
      `INSERT INTO booth_delivery_receipts
         (org_id, receipt_no, production_order_id, production_no, wave_no, source,
          qty, evidence_nos, delivered_at, delivered_by, receiver_type, receiver_name, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW(), 'EDX', $9, $10, 'delivered')
       RETURNING *`,
      [
        orgId, receiptNo, po.id, po.production_no, po.wave_no, po.source,
        qty, JSON.stringify(evidenceNos), receiverType,
        receiverType === 'DDU' ? 'DDU' : 'XU',
      ],
    );
    const receipt = recRes.rows[0];
    // 回执生成即责任转移至接收方（DDU/XU）
    await enqueueOutbox(client, orgId, TOPIC.DELIVERY_RECEIPT_ISSUED, {
      receiptNo,
      productionNo: po.production_no,
      waveNo: po.wave_no,
      source: po.source,
      qty,
      evidenceNos,
      deliveredAt: receipt.delivered_at,
      deliveredBy: 'EDX',
      receiver: { type: receiverType },
      responsibilityTransferred: true,
    });
    await client.query('COMMIT');
    await emitAudit(
      {
        actor: operator?.username || `u${operator?.userId ?? 0}`,
        action: 'delivery_receipt.issued',
        resource: 'booth_delivery_receipts',
        resourceId: receipt.id,
        result: 'success',
        detail: {
          receiptNo, productionNo: po.production_no, receiverType,
          responsibility: `transferred_to_${receiverType}`,
        },
      },
      orgId,
    );
    return { receipt: mapReceipt(receipt) };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** XU/DDU 收货确认（Xfactory 侧闭环；幂等） */
export async function confirmDeliveryReceipt(
  orgId: number,
  receiptNo: string,
  confirmer?: string,
): Promise<{ idempotent?: boolean; skipped?: string; receipt?: any }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `SELECT * FROM booth_delivery_receipts WHERE org_id = $1 AND receipt_no = $2 FOR UPDATE`,
      [orgId, receiptNo],
    );
    const receipt = res.rows[0];
    if (!receipt) {
      const err: any = new Error('receipt not found');
      err.statusCode = 404;
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (receipt.status === 'confirmed') {
      await client.query('ROLLBACK');
      return { idempotent: true, skipped: 'already_confirmed', receipt };
    }
    if (receipt.status !== 'delivered') {
      const err: any = new Error(`receipt status ${receipt.status} is not confirmable`);
      err.statusCode = 400;
      err.code = 'INVALID_STATE';
      throw err;
    }
    const upd = await client.query(
      `UPDATE booth_delivery_receipts
          SET status = 'confirmed', confirmed_at = NOW(), confirmed_by = $2
        WHERE id = $1 RETURNING *`,
      [receipt.id, confirmer],
    );
    await enqueueOutbox(client, orgId, TOPIC.DELIVERY_RECEIPT_CONFIRMED, {
      receiptNo,
      productionNo: receipt.production_no,
      waveNo: receipt.wave_no,
      source: receipt.source,
      confirmedBy: confirmer ?? 'system',
      confirmedAt: upd.rows[0].confirmed_at,
    });
    await client.query('COMMIT');
    await emitAudit(
      {
        actor: confirmer ?? 'system',
        action: 'delivery_receipt.confirmed',
        resource: 'booth_delivery_receipts',
        resourceId: receipt.id,
        result: 'success',
        detail: { receiptNo, receiverType: receipt.receiver_type },
      },
      orgId,
    );
    return { receipt: mapReceipt(upd.rows[0]) };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** F3 交付失败补偿：重发回执事件（重建 outbox pending + 审计留痕） */
export async function resendDeliveryReceipt(
  orgId: number,
  receiptNo: string,
  operator: { userId?: number | null; username?: string | null },
): Promise<{ receipt?: any }> {
  const r = await pool.query(
    `SELECT * FROM booth_delivery_receipts WHERE receipt_no = $1 AND org_id = $2`,
    [receiptNo, orgId],
  );
  const receipt = r.rows[0];
  if (!receipt) {
    const err: any = new Error('receipt not found');
    err.statusCode = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }
  await enqueueOutbox(pool, orgId, TOPIC.DELIVERY_RECEIPT_ISSUED, {
    receiptNo: receipt.receipt_no,
    productionNo: receipt.production_no,
    waveNo: receipt.wave_no,
    source: receipt.source,
    qty: receipt.qty,
    evidenceNos: receipt.evidence_nos || [],
    deliveredAt: receipt.delivered_at,
    deliveredBy: 'EDX',
    receiver: { type: receipt.receiver_type },
    responsibilityTransferred: true,
    resend: true,
  });
  await emitAudit(
    {
      actor: operator?.username || `u${operator?.userId ?? 0}`,
      action: 'delivery_receipt.resent',
      resource: 'booth_delivery_receipts',
      resourceId: receipt.id,
      result: 'success',
      detail: { receiptNo: receipt.receipt_no, reason: 'F3 delivery failure compensation' },
    },
    orgId,
  );
  return { receipt: mapReceipt(receipt) };
}

/**
 * [XFACTORY-P1] 列表：EMX 采购请求（组合 1 桩）
 */
export async function listSupplyPurchases(orgId: number, status?: string) {
  const stFilter = status ? `AND sp.status = $2` : '';
  const params: unknown[] = status ? [orgId, status] : [orgId];
  const { rows } = await pool.query(
    `SELECT sp.id, sp.supply_purchase_no, sp.wave_no, sp.items, sp.status,
            sp.confirmed_by, sp.confirmed_at, sp.production_order_id,
            po.production_no, po.status AS production_status
       FROM booth_supply_purchases sp
       LEFT JOIN booth_production_orders po ON po.id = sp.production_order_id
      WHERE sp.org_id = $1 ${stFilter}
      ORDER BY sp.id DESC LIMIT 200`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    supplyPurchaseNo: r.supply_purchase_no,
    waveNo: r.wave_no,
    items: r.items || [],
    status: r.status,
    confirmedBy: r.confirmed_by,
    confirmedAt: r.confirmed_at,
    productionOrderId: r.production_order_id,
    productionNo: r.production_no,
    productionStatus: r.production_status,
  }));
}

/**
 * [XFACTORY-P1] 列表：组合 1/2 生产单（EDX 交付视角，含回执状态）
 */
export async function listXfactoryProductionOrders(orgId: number, source?: string) {
  const sourceFilter = source ? `AND po.source = $2` : '';
  const params: unknown[] = source ? [orgId, source] : [orgId];
  const { rows } = await pool.query(
    `SELECT po.id, po.production_no, po.shop_order_id, po.wave_no, po.source,
            po.order_family, po.status, po.items,
            dr.receipt_no, dr.receiver_type, dr.status AS receipt_status
       FROM booth_production_orders po
       LEFT JOIN booth_delivery_receipts dr ON dr.production_order_id = po.id
      WHERE po.org_id = $1 AND po.source IN ('SUPPLY', 'MARKET') ${sourceFilter}
      ORDER BY po.id DESC LIMIT 200`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    productionNo: r.production_no,
    shopOrderId: r.shop_order_id,
    waveNo: r.wave_no,
    source: r.source,
    orderFamily: r.order_family,
    status: r.status,
    totalQty: ((r.items || []) as Array<{ qty?: number }>).reduce((a, it) => a + (Number(it.qty) || 0), 0),
    items: r.items || [],
    receipt: r.receipt_no
      ? { receiptNo: r.receipt_no, receiverType: r.receiver_type, status: r.receipt_status }
      : null,
  }));
}

/**
 * [XFACTORY-P1] 列表：交付回执
 */
export async function listDeliveryReceipts(orgId: number) {
  const { rows } = await pool.query(
    `SELECT id, receipt_no, production_no, wave_no, source, qty, evidence_nos,
            delivered_at, delivered_by, receiver_type, receiver_id, status,
            confirmed_at, confirm_event_id
       FROM booth_delivery_receipts
      WHERE org_id = $1
      ORDER BY id DESC LIMIT 200`,
    [orgId],
  );
  return rows.map((r) => ({
    id: r.id,
    receiptNo: r.receipt_no,
    productionNo: r.production_no,
    waveNo: r.wave_no,
    source: r.source,
    qty: r.qty,
    evidenceNos: r.evidence_nos || [],
    deliveredAt: r.delivered_at,
    deliveredBy: r.delivered_by,
    receiverType: r.receiver_type,
    receiverId: r.receiver_id,
    status: r.status,
    confirmedAt: r.confirmed_at,
    confirmEventId: r.confirm_event_id,
  }));
}

// ---------- [XFACTORY-P1] snake → camel 映射 ----------
function mapPurchase(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: r.id, supplyPurchaseNo: r.supply_purchase_no, waveNo: r.wave_no,
    items: r.items || [], status: r.status, source: r.source,
    confirmedBy: r.confirmed_by, confirmedAt: r.confirmed_at,
    productionOrderId: r.production_order_id,
  };
}
function mapProduction(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: r.id, productionNo: r.production_no, shopOrderId: r.shop_order_id,
    waveNo: r.wave_no, source: r.source, orderFamily: r.order_family,
    status: r.status, orderType: r.order_type, items: r.items || [],
    totalQty: ((r.items || []) as Array<{ qty?: number }>).reduce((a, it) => a + (Number(it.qty) || 0), 0),
  };
}
function mapWorkOrder(w: Record<string, unknown>): Record<string, unknown> {
  return {
    id: w.id, workOrderNo: w.work_order_no, productName: w.product_name,
    qty: w.qty, status: w.status, stepName: w.step_name, dimension: w.dimension,
  };
}

function mapReceipt(r: Record<string, unknown>): Record<string, unknown> {
  return {
    id: r.id, receiptNo: r.receipt_no, productionNo: r.production_no, waveNo: r.wave_no,
    source: r.source, qty: r.qty, evidenceNos: r.evidence_nos || [],
    deliveredAt: r.delivered_at, deliveredBy: r.delivered_by,
    receiverType: r.receiver_type, receiverId: r.receiver_id,
    status: r.status, confirmedAt: r.confirmed_at, confirmEventId: r.confirm_event_id,
  };
}
