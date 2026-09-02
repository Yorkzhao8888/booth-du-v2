/**
 * exx WH 路由 (TECH-DEBT-1 从 exx-modules.ts 拆出)
 * 覆盖: 盘点 / 批次 / 供给单(WH-SUPPLY-01) / 设备管理 / 场地资源(Plaza)
 * 挂载: /api/booth/exx (见 exx-modules.ts 聚合)
 */
import { Router } from 'express';
import { pool } from '../db.js';
import { requireHat } from '../auth.js';
import type { JwtPayload } from '../auth.js';

const router = Router();

// ====== WH: Stocktake create ======
router.post('/wh/stocktakes', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { remark, skuIds } = req.body;
    const stNo = `ST${Date.now()}${Math.floor(Math.random() * 1000)}`;

    // Build initial lines from skuIds (enrich server-side)
    const initLines: any[] = [];
    if (Array.isArray(skuIds) && skuIds.length > 0) {
      const skuRows = await pool.query(
        `SELECT id, name FROM booth_skus WHERE id = ANY($1) AND org_id = $2`,
        [skuIds, user.orgId]
      );
      for (const sku of skuRows.rows) {
        // Get bookQty from inventory
        const invRow = await pool.query(
          `SELECT qty_on_hand FROM booth_inventory WHERE org_id = $1 AND sku_id = $2`,
          [user.orgId, sku.id]
        );
        const bookQty = invRow.rows[0] ? parseFloat(invRow.rows[0].qty_on_hand) : 0;
        initLines.push({ skuId: sku.id, skuName: sku.name, bookQty, actualQty: null, diffQty: null, batchNo: '' });
      }
    }

    const r = await pool.query(
      `INSERT INTO booth_stocktake_orders (org_id, st_no, status, lines, created_by, remark)
       VALUES ($1, $2, 'draft', $3, $4, $5) RETURNING *`,
      [user.orgId, stNo, JSON.stringify(initLines), user.userId!, remark]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== WH: Stocktake submit ======
router.post('/wh/stocktakes/:id/submit', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { lines } = req.body;

    // Validate lines
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ success: false, error: 'Submit failed: lines is empty', code: 'EMPTY_LINES' });
    }

    // Enrich each line server-side
    const enrichedLines: any[] = [];
    for (const line of lines) {
      const skuId = line.skuId || line.sku_id;
      if (!skuId) continue;

      // Get SKU name
      const skuRow = await pool.query(`SELECT name FROM booth_skus WHERE id = $1`, [skuId]);
      const skuName = skuRow.rows[0]?.name || '';

      // Get bookQty: if batchNo provided, sum from stock_batches; otherwise from inventory
      let bookQty: number;
      const batchNo = line.batchNo || '';
      if (batchNo) {
        const batchRow = await pool.query(
          `SELECT COALESCE(SUM(qty), 0) as total FROM booth_stock_batches WHERE org_id = $1 AND sku_id = $2 AND batch_no = $3`,
          [user.orgId, skuId, batchNo]
        );
        bookQty = parseFloat(batchRow.rows[0].total);
      } else {
        const invRow = await pool.query(
          `SELECT qty_on_hand FROM booth_inventory WHERE org_id = $1 AND sku_id = $2`,
          [user.orgId, skuId]
        );
        bookQty = invRow.rows[0] ? parseFloat(invRow.rows[0].qty_on_hand) : 0;
      }

      const actualQty = parseFloat(line.actualQty) || 0;
      const diffQty = actualQty - bookQty;

      enrichedLines.push({ skuId, skuName, bookQty, actualQty, diffQty, batchNo });
    }

    const r = await pool.query(
      `UPDATE booth_stocktake_orders SET lines = $1, status = 'submitted', submitted_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND org_id = $3 AND status = 'draft' RETURNING *`,
      [JSON.stringify(enrichedLines), req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot submit: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== WH: My stocktakes ======
router.get('/wh/stocktakes', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query('SELECT * FROM booth_stocktake_orders WHERE org_id = $1 ORDER BY created_at DESC', [user.orgId]);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== WH: Batches view ======
router.get('/wh/batches', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const skuId = req.query.skuId as string;
    let where = 'WHERE b.org_id = $1'; const params: any[] = [user.orgId]; let idx = 2;
    if (skuId) { where += ` AND b.sku_id = $${idx}`; params.push(skuId); idx++; }
    const r = await pool.query(
      `SELECT b.*, s.name as sku_name, s.sku_code
       FROM booth_stock_batches b
       JOIN booth_skus s ON s.id = b.sku_id
       ${where} ORDER BY b.expiry_date ASC NULLS LAST`,
      params
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== WH-SUPPLY-01: 供给单 ======

// 供给单列表
router.get('/wh/supply-orders', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { supply_type, status } = req.query;
    let sql = `SELECT * FROM booth_supply_orders WHERE org_id = $1`;
    const params: any[] = [user.orgId];
    let idx = 2;
    if (supply_type) { sql += ` AND supply_type = $${idx}`; params.push(supply_type); idx++; }
    if (status) { sql += ` AND status = $${idx}`; params.push(status); idx++; }
    sql += ` ORDER BY created_at DESC`;
    const r = await pool.query(sql, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// 创建供给单
router.post('/wh/supply-orders', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { supplyType, targetType, targetId, targetName, fromWarehouseType, skuId, skuName, qty, unit, deviceId, plazaResourceId, remark } = req.body;
    const supplyNo = `SUP${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const r = await pool.query(
      `INSERT INTO booth_supply_orders (org_id, supply_no, supply_type, target_type, target_id, target_name, from_warehouse_type, sku_id, sku_name, qty, unit, device_id, plaza_resource_id, remark, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [user.orgId, supplyNo, supplyType || 'material', targetType, targetId, targetName, fromWarehouseType || 'material', skuId, skuName, qty, unit, deviceId, plazaResourceId, remark, user.userId]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// 供给单详情
router.get('/wh/supply-orders/:id', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT * FROM booth_supply_orders WHERE id = $1 AND org_id = $2`,
      [req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// 执行供给（pending → supplied）
router.post('/wh/supply-orders/:id/supply', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `UPDATE booth_supply_orders SET status = 'supplied', supplied_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND status IN ('pending','dispatched') RETURNING *`,
      [req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot supply: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// 取消供给单
router.post('/wh/supply-orders/:id/cancel', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `UPDATE booth_supply_orders SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND status IN ('pending','dispatched') RETURNING *`,
      [req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot cancel: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== WH-SUPPLY-01: 设备管理 ======

// 设备列表
router.get('/wh/devices', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { status } = req.query;
    let sql = `SELECT * FROM booth_devices WHERE org_id = $1`;
    const params: any[] = [user.orgId];
    if (status) { sql += ` AND status = $2`; params.push(status); }
    sql += ` ORDER BY created_at DESC`;
    const r = await pool.query(sql, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// 创建设备
router.post('/wh/devices', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { deviceCode, deviceName, deviceType, serialNo, location, purchaseDate, warrantyUntil, remark } = req.body;
    const r = await pool.query(
      `INSERT INTO booth_devices (org_id, device_code, device_name, device_type, serial_no, location, purchase_date, warranty_until, remark)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [user.orgId, deviceCode, deviceName, deviceType, serialNo, location, purchaseDate, warrantyUntil, remark]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// 设备出库给产线（创建供给单 + 更新设备状态）
router.post('/wh/devices/:id/dispatch', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { targetType, targetId, targetName, remark } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // 获取设备信息
      const devR = await client.query('SELECT * FROM booth_devices WHERE id = $1 AND org_id = $2 AND status = $3', [req.params.id, user.orgId, 'idle']);
      if (!devR.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: '设备不可用或不存在', code: 'DEVICE_UNAVAILABLE' });
      }
      const device = devR.rows[0];
      // 创建供给单
      const supplyNo = `SUP${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const supR = await client.query(
        `INSERT INTO booth_supply_orders (org_id, supply_no, supply_type, target_type, target_id, target_name, from_warehouse_type, device_id, status, remark, created_by)
         VALUES ($1,$2,'device',$3,$4,$5,'device',$6,'supplied',$7,$8) RETURNING *`,
        [user.orgId, supplyNo, targetType, targetId, targetName, device.id, remark, user.userId]
      );
      // 更新设备状态
      await client.query(
        `UPDATE booth_devices SET status = 'in_use', assigned_line = $1, updated_at = NOW() WHERE id = $2`,
        [targetName || targetType, device.id]
      );
      await client.query('COMMIT');
      res.json({ success: true, data: supR.rows[0] });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});

// 设备维保记录
router.post('/wh/devices/:id/maintenance', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { maintenanceType, description, cost, remark } = req.body;
    // 更新设备状态为维保中
    await pool.query(
      `UPDATE booth_devices SET status = 'maintenance', updated_at = NOW() WHERE id = $1 AND org_id = $2`,
      [req.params.id, user.orgId]
    );
    const r = await pool.query(
      `INSERT INTO booth_device_maintenance_logs (org_id, device_id, maintenance_type, description, operator_id, started_at, cost, remark)
       VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7) RETURNING *`,
      [user.orgId, req.params.id, maintenanceType || 'routine', description, user.userId, cost || 0, remark]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// 维保完成（恢复设备状态）
router.post('/wh/devices/:id/maintenance/complete', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { logId } = req.body;
    await pool.query(
      `UPDATE booth_device_maintenance_logs SET completed_at = NOW() WHERE id = $1 AND org_id = $2`,
      [logId, user.orgId]
    );
    const r = await pool.query(
      `UPDATE booth_devices SET status = 'idle', updated_at = NOW() WHERE id = $1 AND org_id = $2 AND status = 'maintenance' RETURNING *`,
      [req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: '设备不在维保状态', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// 设备维保履历查询
router.get('/wh/devices/:id/maintenance', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT * FROM booth_device_maintenance_logs WHERE device_id = $1 AND org_id = $2 ORDER BY created_at DESC`,
      [req.params.id, user.orgId]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== WH-SUPPLY-01: 场地资源 (Plaza) ======

// 场地资源列表
router.get('/wh/plaza-resources', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT * FROM booth_plaza_resources WHERE org_id = $1 ORDER BY created_at DESC`,
      [user.orgId]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// 创建场地资源
router.post('/wh/plaza-resources', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { resourceCode, resourceName, plazaType, areaSq, capacity, location, remark } = req.body;
    const r = await pool.query(
      `INSERT INTO booth_plaza_resources (org_id, resource_code, resource_name, plaza_type, area_sqm, capacity, location, remark)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [user.orgId, resourceCode, resourceName, plazaType || 'standard', areaSq || 0, capacity || 0, location, remark]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// 场地预订
router.post('/wh/plaza-resources/:id/book', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { purpose, startAt, endAt, remark } = req.body;
    const bookingNo = `PB${Date.now()}${Math.floor(Math.random() * 1000)}`;
    // 检查资源可用
    const resCheck = await pool.query(
      `SELECT * FROM booth_plaza_resources WHERE id = $1 AND org_id = $2 AND status = 'available'`,
      [req.params.id, user.orgId]
    );
    if (!resCheck.rows.length) return res.status(400).json({ success: false, error: '资源不可用', code: 'RESOURCE_UNAVAILABLE' });
    // 创建预订
    const r = await pool.query(
      `INSERT INTO booth_plaza_bookings (org_id, resource_id, booking_no, booker_id, purpose, start_at, end_at, remark)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [user.orgId, req.params.id, bookingNo, user.userId, purpose, startAt, endAt, remark]
    );
    // 更新资源状态
    await pool.query(
      `UPDATE booth_plaza_resources SET status = 'booked', updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// 释放场地
router.post('/wh/plaza-bookings/:id/release', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const bookingR = await client.query(
        `SELECT * FROM booth_plaza_bookings WHERE id = $1 AND org_id = $2 AND status IN ('booked','checked_in')`,
        [req.params.id, user.orgId]
      );
      if (!bookingR.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: '预订不存在或已释放', code: 'INVALID_STATE' });
      }
      const booking = bookingR.rows[0];
      // 更新预订状态
      await client.query(
        `UPDATE booth_plaza_bookings SET status = 'released', updated_at = NOW() WHERE id = $1`,
        [req.params.id]
      );
      // 恢复资源状态
      await client.query(
        `UPDATE booth_plaza_resources SET status = 'available', updated_at = NOW() WHERE id = $1`,
        [booking.resource_id]
      );
      await client.query('COMMIT');
      res.json({ success: true, data: { released: true } });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});

// 场地预订列表
router.get('/wh/plaza-bookings', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT b.*, r.resource_name, r.resource_code FROM booth_plaza_bookings b
       JOIN booth_plaza_resources r ON r.id = b.resource_id
       WHERE b.org_id = $1 ORDER BY b.created_at DESC`,
      [user.orgId]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

export default router;
