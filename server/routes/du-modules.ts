import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { requireAuth, requireRole, stripCostFields } from '../auth.js';
import type { JwtPayload } from '../auth.js';
import { stripPriceFields } from '../services/fulfillment-service.js';

const router = Router();

// ====== DU/DX/DM/DXX: 按角色权限访问 ======
const duRouter = Router();
duRouter.use(requireAuth, (req, res, next) => {
  const user = (req as any).user as JwtPayload;
  if (!user) return next({ statusCode: 401, code: 'UNAUTHORIZED', error: 'No user' });
  
  // dexx 可以查看调拨列表（只读），但不能创建/审批/完成
  const isTransferRead = req.path.startsWith('/transfers') && req.method === 'GET';
  const allowedRoles = ['du', 'dx', 'dm', 'dxx'];
  if (isTransferRead && user.role === 'dexx') {
    // dexx can read transfers
  } else if (!allowedRoles.includes(user.role)) {
    return next({ statusCode: 403, code: 'FORBIDDEN', error: 'Insufficient role' });
  }
  
  // DM 只读：写接口 403
  if (user.role === 'dm' && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    return next({ statusCode: 403, code: 'FORBIDDEN', error: 'DM 运营为只读角色，无写权限' });
  }
  
  // DEXX 只读：调拨相关写接口 403
  if (user.role === 'dexx' && req.path.startsWith('/transfers') && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    return next({ statusCode: 403, code: 'FORBIDDEN', error: 'DEXX 铺员为只读角色，无调拨写权限' });
  }
  
  // DXX/DEXX：拦截 res.json 以 stripCostFields（价格隔离）
  if (user.role === 'dxx' || user.role === 'dexx') {
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      return originalJson(stripCostFields(body));
    };
  }
  
  next();
});

duRouter.get('/dl/tasks', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const status = req.query.status as string;
    let where = 'WHERE org_id = $1'; const params: any[] = [user.orgId]; let idx = 2;
    if (status) { where += ` AND status = $${idx}`; params.push(status); idx++; }
    const r = await pool.query(`SELECT * FROM booth_dl_tasks ${where} ORDER BY created_at DESC`, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

duRouter.post('/dl/tasks', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { fulfillmentId, pickupAddr, deliveryAddr, customerName, customerPhone, remark } = req.body;
    const taskNo = `DL${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const r = await pool.query(
      `INSERT INTO booth_dl_tasks (org_id, task_no, fulfillment_id, pickup_addr, delivery_addr, customer_name, customer_phone, remark)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [user.orgId, taskNo, fulfillmentId, pickupAddr, deliveryAddr, customerName, customerPhone, remark]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

duRouter.post('/dl/tasks/:id/reassign', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { assigneeId } = req.body;
    const r = await pool.query(
      `UPDATE booth_dl_tasks SET assignee_id = $1, assigned_at = NOW(), status = CASE WHEN status = 'exception' THEN 'assigned' ELSE status END, updated_at = NOW()
       WHERE id = $2 AND org_id = $3 RETURNING *`,
      [assigneeId, req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

duRouter.post('/dl/tasks/:id/close', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `UPDATE booth_dl_tasks SET status = 'signed', updated_at = NOW() WHERE id = $1 AND org_id = $2 AND status = 'exception' RETURNING *`,
      [req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot close: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

duRouter.get('/svc/tasks', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const status = req.query.status as string;
    let where = 'WHERE org_id = $1'; const params: any[] = [user.orgId]; let idx = 2;
    if (status) { where += ` AND status = $${idx}`; params.push(status); idx++; }
    const r = await pool.query(`SELECT * FROM booth_svc_tasks ${where} ORDER BY created_at DESC`, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

duRouter.post('/svc/tasks', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { fulfillmentId, serviceContent, customerName, customerPhone, requiredAt, remark } = req.body;
    const taskNo = `SVC${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const r = await pool.query(
      `INSERT INTO booth_svc_tasks (org_id, task_no, fulfillment_id, service_content, customer_name, customer_phone, required_at, remark)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [user.orgId, taskNo, fulfillmentId, serviceContent, customerName, customerPhone, requiredAt, remark]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// Profit endpoints
duRouter.get('/fulfillments/:id/profit', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      'SELECT * FROM booth_profit_snapshots WHERE fulfillment_id = $1 AND org_id = $2',
      [req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.json({ success: true, data: { status: 'pending' } });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

duRouter.get('/profit', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const from = req.query.from as string;
    const to = req.query.to as string;
    let where = 'WHERE org_id = $1'; const params: any[] = [user.orgId]; let idx = 2;
    if (from) { where += ` AND created_at >= $${idx}`; params.push(from); idx++; }
    if (to) { where += ` AND created_at <= $${idx}`; params.push(to); idx++; }
    const r = await pool.query(`SELECT * FROM booth_profit_snapshots ${where} ORDER BY created_at DESC`, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// Inventory alerts (with unitCost for du/dx)
duRouter.get('/inventory/alerts', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT i.*, s.sku_code, s.name, s.safety_stock, s.unit, sc.unit_cost,
              CASE WHEN s.safety_stock > i.qty_on_hand THEN s.safety_stock - i.qty_on_hand ELSE 0 END as gap
       FROM booth_inventory i
       JOIN booth_skus s ON s.id = i.sku_id
       LEFT JOIN booth_sku_cost sc ON sc.org_id = i.org_id AND sc.sku_id = i.sku_id
       WHERE i.org_id = $1 AND i.qty_on_hand <= s.safety_stock
       ORDER BY s.name`,
      [user.orgId]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// WH stocktakes (view all)
duRouter.get('/wh/stocktakes', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query('SELECT * FROM booth_stocktake_orders WHERE org_id = $1 ORDER BY created_at DESC', [user.orgId]);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// WH batches
duRouter.get('/wh/batches', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const skuId = req.query.skuId as string;
    const warehouseType = req.query.warehouse_type as string;
    let where = 'WHERE b.org_id = $1'; const params: any[] = [user.orgId]; let idx = 2;
    if (skuId) { where += ` AND b.sku_id = $${idx}`; params.push(skuId); idx++; }
    if (warehouseType) { where += ` AND b.warehouse_type = $${idx}`; params.push(warehouseType); idx++; }
    const r = await pool.query(
      `SELECT b.*, s.name as sku_name, s.sku_code, sc.unit_cost
       FROM booth_stock_batches b
       JOIN booth_skus s ON s.id = b.sku_id
       LEFT JOIN booth_sku_cost sc ON sc.org_id = b.org_id AND sc.sku_id = b.sku_id
       ${where} ORDER BY b.expiry_date ASC`,
      params
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// FAB QC view
duRouter.get('/fab/qc', async (req, res, next) => {
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

// ====== Users list (for dispatch / employee management) ======
duRouter.get('/users', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const roleFilter = req.query.role as string;
    let query = `SELECT id, name, phone, hats, role, created_at FROM booth_users WHERE org_id = $1`;
    const params: unknown[] = [user.orgId];
    
    if (roleFilter) {
      query += ` AND role = $2`;
      params.push(roleFilter);
    }
    query += ` ORDER BY created_at DESC`;
    
    const r = await pool.query(query, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== Add employee (DM/DU only) ======
duRouter.post('/users', requireRole('dm', 'du'), async (req, res, next) => {
  try {
    const { name, phone, password, role, hats } = req.body;
    if (!name || !phone || !password || !role) {
      return res.status(400).json({ success: false, error: '缺少必填字段' });
    }
    
    // Check if phone already exists
    const existing = await pool.query(`SELECT id FROM booth_users WHERE phone = $1`, [phone]);
    if (existing.rowCount && existing.rowCount > 0) {
      return res.status(400).json({ success: false, error: '手机号已存在' });
    }
    
    const passwordHash = bcrypt.hashSync(password, 10);
    const hatsArray = hats || [];
    
    const r = await pool.query(
      `INSERT INTO booth_users (org_id, name, phone, password_hash, role, hats)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, phone, role, hats`,
      [1, name, phone, passwordHash, role, `{${hatsArray.join(',')}}`]
    );
    
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== Reset password (DM/DU only) ======
duRouter.post('/users/:id/reset-password', requireRole('dm', 'du'), async (req, res, next) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    const newPassword = password || '123456';
    const passwordHash = bcrypt.hashSync(newPassword, 10);
    
    await pool.query(
      `UPDATE booth_users SET password_hash = $1 WHERE id = $2 AND org_id = $3`,
      [passwordHash, id, 1]
    );
    
    res.json({ success: true, message: '密码已重置' });
  } catch (err) { next(err); }
});

// ====== 库存调拨 ======
// 获取调拨单列表
duRouter.get('/transfers', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { status, page = 1, pageSize = 20 } = req.query;

    let where = 'WHERE t.org_id = $1';
    const params: any[] = [user.orgId];
    let paramIdx = 2;

    if (status && status !== 'all') {
      where += ` AND t.status = $${paramIdx}`;
      params.push(status);
      paramIdx++;
    }

    const offset = (Number(page) - 1) * Number(pageSize);

    const countRes = await pool.query(`SELECT COUNT(*) FROM booth_transfer_orders t ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const result = await pool.query(
      `SELECT t.*, u.name as creator_name
       FROM booth_transfer_orders t
       LEFT JOIN booth_users u ON t.created_by = u.id
       ${where}
       ORDER BY t.created_at DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, Number(pageSize), offset]
    );

    // Get items for each transfer
    const transfers = await Promise.all(
      result.rows.map(async (t) => {
        const itemsRes = await pool.query(
          `SELECT * FROM booth_transfer_items WHERE transfer_id = $1`,
          [t.id]
        );
        return { ...t, items: itemsRes.rows };
      })
    );

    res.json({ success: true, data: { items: transfers, total, page: Number(page), pageSize: Number(pageSize) } });
  } catch (err) { next(err); }
});

// 创建调拨单
duRouter.post('/transfers', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const user = (req as any).user as JwtPayload;
    const { fromWarehouseType, toWarehouseType, items, remark } = req.body;

    if (!fromWarehouseType || !toWarehouseType || !items?.length) {
      return res.status(400).json({ success: false, error: '缺少必要参数', code: 'MISSING_PARAMS' });
    }

    if (fromWarehouseType === toWarehouseType) {
      return res.status(400).json({ success: false, error: '源仓库和目标仓库不能相同', code: 'SAME_WAREHOUSE' });
    }

    await client.query('BEGIN');

    // Generate transfer number
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const seqRes = await client.query(
      `SELECT COUNT(*) FROM booth_transfer_orders WHERE transfer_no LIKE $1`,
      [`TR${today}%`]
    );
    const seq = parseInt(seqRes.rows[0].count) + 1;
    const transferNo = `TR${today}${String(seq).padStart(4, '0')}`;

    const transferRes = await client.query(
      `INSERT INTO booth_transfer_orders (org_id, transfer_no, from_warehouse_type, to_warehouse_type, remark, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [user.orgId, transferNo, fromWarehouseType, toWarehouseType, remark, user.userId]
    );

    const transferId = transferRes.rows[0].id;

    // Insert items
    for (const item of items) {
      await client.query(
        `INSERT INTO booth_transfer_items (transfer_id, sku_id, sku_name, qty, batch_id, remark)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [transferId, item.skuId, item.skuName, item.qty, item.batchId, item.remark]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, data: { id: transferId, transfer_no: transferNo } });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// 审批调拨单
duRouter.post('/transfers/:id/approve', requireRole('dm', 'du', 'dx'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const user = (req as any).user as JwtPayload;
    const { id } = req.params;
    const { action } = req.body; // approve / reject

    await client.query('BEGIN');

    const transferRes = await client.query(
      `SELECT * FROM booth_transfer_orders WHERE id = $1 AND org_id = $2 FOR UPDATE`,
      [id, user.orgId]
    );

    if (!transferRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: '调拨单不存在', code: 'NOT_FOUND' });
    }

    const transfer = transferRes.rows[0];
    if (transfer.status !== 'draft') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: '只能审批草稿状态的调拨单', code: 'INVALID_STATE' });
    }

    const newStatus = action === 'reject' ? 'rejected' : 'approved';
    await client.query(
      `UPDATE booth_transfer_orders SET status = $1, approved_by = $2, approved_at = NOW(), updated_at = NOW() WHERE id = $3`,
      [newStatus, user.userId, id]
    );

    await client.query('COMMIT');
    res.json({ success: true, data: { status: newStatus } });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// 完成调拨（执行库存转移）
duRouter.post('/transfers/:id/complete', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const user = (req as any).user as JwtPayload;
    const { id } = req.params;

    await client.query('BEGIN');

    const transferRes = await client.query(
      `SELECT * FROM booth_transfer_orders WHERE id = $1 AND org_id = $2 FOR UPDATE`,
      [id, user.orgId]
    );

    if (!transferRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: '调拨单不存在', code: 'NOT_FOUND' });
    }

    const transfer = transferRes.rows[0];
    if (transfer.status !== 'approved') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: '只能完成已审批的调拨单', code: 'INVALID_STATE' });
    }

    // Get items
    const itemsRes = await client.query(
      `SELECT * FROM booth_transfer_items WHERE transfer_id = $1`,
      [id]
    );

    // Execute inventory transfer for each item
    for (const item of itemsRes.rows) {
      // Decrease from source warehouse
      await client.query(
        `UPDATE booth_inventory 
         SET qty_on_hand = qty_on_hand - $1, updated_at = NOW()
         WHERE org_id = $2 AND sku_id = $3 AND warehouse_type = $4`,
        [item.qty, user.orgId, item.sku_id, transfer.from_warehouse_type]
      );

      // Increase to target warehouse
      const existing = await client.query(
        `SELECT id FROM booth_inventory WHERE org_id = $1 AND sku_id = $2 AND warehouse_type = $3`,
        [user.orgId, item.sku_id, transfer.to_warehouse_type]
      );

      if (existing.rows.length > 0) {
        await client.query(
          `UPDATE booth_inventory SET qty_on_hand = qty_on_hand + $1, updated_at = NOW() WHERE id = $2`,
          [item.qty, existing.rows[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO booth_inventory (org_id, sku_id, warehouse_type, qty_on_hand, qty_reserved)
           VALUES ($1, $2, $3, $4, 0)`,
          [user.orgId, item.sku_id, transfer.to_warehouse_type, item.qty]
        );
      }

      // Record transaction
      await client.query(
        `INSERT INTO booth_inventory_txn (org_id, sku_id, warehouse_type, txn_type, qty_delta, ref_type, ref_id, remark)
         VALUES ($1, $2, $3, 'transfer_out', $4, 'transfer', $5, $6)`,
        [user.orgId, item.sku_id, transfer.from_warehouse_type, -item.qty, id, `调拨出: ${transfer.transfer_no}`]
      );
      await client.query(
        `INSERT INTO booth_inventory_txn (org_id, sku_id, warehouse_type, txn_type, qty_delta, ref_type, ref_id, remark)
         VALUES ($1, $2, $3, 'transfer_in', $4, 'transfer', $5, $6)`,
        [user.orgId, item.sku_id, transfer.to_warehouse_type, item.qty, id, `调拨入: ${transfer.transfer_no}`]
      );
    }

    // Update transfer status
    await client.query(
      `UPDATE booth_transfer_orders SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id]
    );

    await client.query('COMMIT');
    res.json({ success: true, data: { status: 'completed' } });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

export default duRouter;
