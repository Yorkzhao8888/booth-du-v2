import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import type { JwtPayload } from '../auth.js';

const router = Router();
router.use(requireAuth, requireRole('dex'));

// ====== DL Tasks: Dispatch & view ======
router.get('/dl/tasks', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const status = req.query.status as string;
    let where = 'WHERE org_id = $1'; const params: any[] = [user.orgId]; let idx = 2;
    if (status) { where += ` AND status = $${idx}`; params.push(status); idx++; }
    const r = await pool.query(`SELECT * FROM booth_dl_tasks ${where} ORDER BY created_at DESC`, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

router.post('/dl/tasks', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { fulfillmentId, pickupAddr, deliveryAddr, customerName, customerPhone, assigneeId, remark } = req.body;
    const taskNo = `DL${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const r = await pool.query(
      `INSERT INTO booth_dl_tasks (org_id, task_no, fulfillment_id, pickup_addr, delivery_addr, customer_name, customer_phone, assignee_id, assigned_at, remark)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,${assigneeId ? 'NOW()' : 'NULL'},$9) RETURNING *`,
      [user.orgId, taskNo, fulfillmentId, pickupAddr, deliveryAddr, customerName, customerPhone, assigneeId || null, remark]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

router.post('/dl/tasks/:id/assign', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { assigneeId } = req.body;
    const r = await pool.query(
      `UPDATE booth_dl_tasks SET assignee_id = $1, assigned_at = NOW(), status = CASE WHEN status = 'pending' THEN 'assigned' ELSE status END, updated_at = NOW()
       WHERE id = $2 AND org_id = $3 RETURNING *`,
      [assigneeId, req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== SVC Tasks: Dispatch & view ======
router.get('/svc/tasks', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const status = req.query.status as string;
    const service_category = req.query.service_category as string;
    let where = 'WHERE org_id = $1'; const params: any[] = [user.orgId]; let idx = 2;
    if (status) { where += ` AND status = $${idx}`; params.push(status); idx++; }
    if (service_category) { where += ` AND service_category = $${idx}`; params.push(service_category); idx++; }
    const r = await pool.query(`SELECT * FROM booth_svc_tasks ${where} ORDER BY created_at DESC`, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

router.post('/svc/tasks', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { fulfillmentId, serviceContent, customerName, customerPhone, assigneeId, requiredAt, remark, serviceCategory, serviceType } = req.body;
    const taskNo = `SVC${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const r = await pool.query(
      `INSERT INTO booth_svc_tasks (org_id, task_no, fulfillment_id, service_content, customer_name, customer_phone, assignee_id, assigned_at, required_at, remark, service_category, service_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,${assigneeId ? 'NOW()' : 'NULL'},$8,$9,$10,$11) RETURNING *`,
      [user.orgId, taskNo, fulfillmentId, serviceContent, customerName, customerPhone, assigneeId || null, requiredAt, remark, serviceCategory || 'customer', serviceType || null]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

router.post('/svc/tasks/:id/assign', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { assigneeId } = req.body;
    const r = await pool.query(
      `UPDATE booth_svc_tasks SET assignee_id = $1, assigned_at = NOW(), status = CASE WHEN status = 'pending' THEN 'assigned' ELSE status END, updated_at = NOW()
       WHERE id = $2 AND org_id = $3 RETURNING *`,
      [assigneeId, req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== WH Stocktake: Approve ======
router.get('/wh/stocktakes', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query('SELECT * FROM booth_stocktake_orders WHERE org_id = $1 ORDER BY created_at DESC', [user.orgId]);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

router.post('/wh/stocktakes/:id/approve', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const user = (req as any).user as JwtPayload;
    await client.query('BEGIN');

    // First read the order (lock it)
    const readRes = await client.query(
      `SELECT * FROM booth_stocktake_orders WHERE id = $1 AND org_id = $2 FOR UPDATE`,
      [req.params.id, user.orgId]
    );
    if (!readRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Stocktake not found', code: 'NOT_FOUND' });
    }
    const so = readRes.rows[0];
    if (so.status !== 'submitted') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: `Cannot approve: status is ${so.status}`, code: 'INVALID_STATE' });
    }

    const lines = Array.isArray(so.lines) ? so.lines : [];
    if (lines.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Cannot approve: lines is empty', code: 'EMPTY_LINES' });
    }

    // Adjust inventory per line
    for (const line of lines) {
      const skuId = line.skuId || line.sku_id;
      const bookQty = parseFloat(line.bookQty ?? line.systemQty ?? 0);
      const actualQty = parseFloat(line.actualQty ?? 0);
      const diff = actualQty - bookQty;
      if (Math.abs(diff) < 0.001) continue;

      // Adjust booth_inventory
      await client.query(
        `INSERT INTO booth_inventory (org_id, sku_id, qty_on_hand) VALUES ($1, $2, $3)
         ON CONFLICT (org_id, sku_id) DO UPDATE SET qty_on_hand = booth_inventory.qty_on_hand + $3, updated_at = NOW()`,
        [user.orgId, skuId, diff]
      );

      // Adjust stock_batches if batchNo specified
      const batchNo = line.batchNo || '';
      if (batchNo) {
        const batchRes = await client.query(
          `SELECT id, qty FROM booth_stock_batches WHERE org_id = $1 AND sku_id = $2 AND batch_no = $3 ORDER BY expiry_date ASC NULLS LAST LIMIT 1`,
          [user.orgId, skuId, batchNo]
        );
        if (batchRes.rows.length > 0) {
          await client.query(
            `UPDATE booth_stock_batches SET qty = qty + $1 WHERE id = $2`,
            [diff, batchRes.rows[0].id]
          );
        }
      }

      // Write transaction log (booth_inventory_txn has no remark column)
      await client.query(
        `INSERT INTO booth_inventory_txn (org_id, sku_id, qty_change, type, ref_type, ref_id, operator_id)
         VALUES ($1, $2, $3, 'stocktake_adjust', 'stocktake', $4, $5)`,
        [user.orgId, skuId, diff, so.id, user.userId]
      );
    }

    // Update status to approved
    const updateRes = await client.query(
      `UPDATE booth_stocktake_orders SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND org_id = $3 RETURNING *`,
      [user.userId, req.params.id, user.orgId]
    );

    await client.query('COMMIT');
    res.json({ success: true, data: updateRes.rows[0] });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

router.post('/wh/stocktakes/:id/reject', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `UPDATE booth_stocktake_orders SET status = 'draft', updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND status = 'submitted' RETURNING *`,
      [req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot reject: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== WH Batches ======
router.get('/wh/batches', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const skuId = req.query.skuId as string;
    let where = 'WHERE b.org_id = $1'; const params: any[] = [user.orgId]; let idx = 2;
    if (skuId) { where += ` AND b.sku_id = $${idx}`; params.push(skuId); idx++; }
    const r = await pool.query(
      `SELECT b.*, s.name as sku_name, s.sku_code
       FROM booth_stock_batches b
       JOIN booth_skus s ON s.id = b.sku_id
       ${where} ORDER BY b.expiry_date ASC`,
      params
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== FAB Operations view ======
router.get('/fab/operations', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const woId = req.query.workOrderId as string;
    let where = 'WHERE fo.org_id = $1'; const params: any[] = [user.orgId]; let idx = 2;
    if (woId) { where += ` AND fo.work_order_id = $${idx}`; params.push(woId); idx++; }
    const r = await pool.query(
      `SELECT fo.*, wo.product_name
       FROM booth_fab_operations fo
       JOIN booth_work_orders wo ON wo.id = fo.work_order_id
       ${where} ORDER BY fo.seq, fo.created_at`,
      params
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== QC view ======
router.get('/fab/qc', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT qc.*, wo.product_name, wo.qty as wo_qty
       FROM booth_quality_checks qc
       JOIN booth_work_orders wo ON wo.id = qc.work_order_id
       WHERE qc.org_id = $1 ORDER BY qc.created_at DESC`,
      [user.orgId]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== Inventory alerts ======
router.get('/inventory/alerts', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT i.*, s.sku_code, s.name, s.safety_stock, s.unit,
              CASE WHEN s.safety_stock > i.qty_on_hand THEN s.safety_stock - i.qty_on_hand ELSE 0 END as gap
       FROM booth_inventory i
       JOIN booth_skus s ON s.id = i.sku_id
       WHERE i.org_id = $1 AND i.qty_on_hand <= s.safety_stock
       ORDER BY s.name`,
      [user.orgId]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== Users list (for dispatch assignment) ======
router.get('/users', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT id, name, phone, hats, role FROM booth_users WHERE org_id = $1 AND role = 'dexx' AND is_active = true ORDER BY name`,
      [user.orgId]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== Restock request ======
router.post('/restock/request', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'items required', code: 'INVALID_PARAMS' });
    }
    // Write to outbox
    for (const item of items) {
      await pool.query(
        `INSERT INTO booth_outbox (org_id, event_type, payload) VALUES ($1, 'restock.requested', $2)`,
        [user.orgId, JSON.stringify({ skuId: item.skuId, skuName: item.skuName || '', qty: item.qty, orgId: user.orgId })]
      );
    }
    res.json({ success: true, data: { count: items.length } });
  } catch (err) { next(err); }
});

// ====== BOOTH-OPT-01: QueryCapacity (EX 执行管理只读) ======

// 查询产能负荷概览（只读，不含价格）
router.get('/capacity/overview', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT cr.id, cr.resource_code, cr.resource_name, cr.resource_type, cr.traffic_cap, cr.unit,
       cr.shift_hours_per_day, cr.efficiency_rate, cr.status,
       COALESCE(
         (SELECT SUM(cl.occupied_qty) FROM booth_capacity_load cl
          WHERE cl.resource_id = cr.id AND cl.org_id = $1
          AND cl.slot_date >= CURRENT_DATE
          AND cl.slot_date <= CURRENT_DATE + INTERVAL '7 days'),
         0) as total_load_7d
       FROM booth_capacity_resources cr
       WHERE cr.org_id = $1 AND cr.status = 'active'
       ORDER BY cr.resource_type, cr.resource_code`,
      [user.orgId]
    );
    const items = r.rows.map((row: any) => {
      const dailyCap = Math.round(row.traffic_cap * (row.shift_hours_per_day || 8) * (row.efficiency_rate || 1));
      const load = parseFloat(row.total_load_7d) || 0;
      return {
        ...row,
        daily_capacity: dailyCap,
        total_load_7d: Math.round(load),
        remaining_7d: Math.max(0, dailyCap * 7 - Math.round(load)),
        load_rate_7d: dailyCap * 7 > 0 ? Math.min(100, Math.round((load / (dailyCap * 7)) * 100)) : 0,
      };
    });
    // 汇总
    const totalCap7d = items.reduce((s: number, i: any) => s + i.daily_capacity * 7, 0);
    const totalLoad7d = items.reduce((s: number, i: any) => s + i.total_load_7d, 0);
    res.json({
      success: true,
      data: {
        items,
        summary: {
          total_resources: items.length,
          total_capacity_7d: totalCap7d,
          total_load_7d: totalLoad7d,
          overall_load_rate: totalCap7d > 0 ? Math.min(100, Math.round((totalLoad7d / totalCap7d) * 100)) : 0,
        },
      },
    });
  } catch (err) { next(err); }
});

// ATP 快速查询（供 dex 调度时参考）
router.post('/capacity/atp-check', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { requestedQty, startDate } = req.body;
    const qty = requestedQty || 0;
    const dateStr = startDate || new Date().toISOString().slice(0, 10);

    const resources = await pool.query(
      `SELECT cr.id, cr.traffic_cap, cr.shift_hours_per_day, cr.efficiency_rate,
       COALESCE(
         (SELECT SUM(cl.occupied_qty) FROM booth_capacity_load cl
          WHERE cl.resource_id = cr.id AND cl.org_id = $1
          AND cl.slot_date = $2::date),
         0) as current_load
       FROM booth_capacity_resources cr
       WHERE cr.org_id = $1 AND cr.status = 'active'`,
      [user.orgId, dateStr]
    );

    let totalDailyCap = 0;
    let totalLoad = 0;
    for (const r of resources.rows) {
      const cap = Math.round(r.traffic_cap * (r.shift_hours_per_day || 8) * (r.efficiency_rate || 1));
      totalDailyCap += cap;
      totalLoad += parseFloat(r.current_load) || 0;
    }
    const remaining = Math.max(0, totalDailyCap - Math.round(totalLoad));
    const canFulfill = qty <= remaining;

    let earliestDate: string | null = canFulfill ? dateStr : null;
    let queuePosition = 0;
    if (!canFulfill && totalDailyCap > 0) {
      const overflow = qty - remaining;
      const daysNeeded = Math.ceil(overflow / totalDailyCap);
      const d = new Date(dateStr);
      d.setDate(d.getDate() + daysNeeded + 1);
      earliestDate = d.toISOString().slice(0, 10);
      queuePosition = Math.ceil(qty / totalDailyCap);
    }

    res.json({
      success: true,
      data: {
        requested_qty: qty,
        atp_qty: remaining,
        can_fulfill: canFulfill,
        earliest_date: earliestDate,
        queue_position: queuePosition,
      },
    });
  } catch (err) { next(err); }
});

export default router;
