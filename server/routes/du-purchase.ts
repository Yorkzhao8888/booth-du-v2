import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole, stripCostFields } from '../auth.js';
import type { JwtPayload } from '../auth.js';
import { recalcUnitCost, nextPoNo } from '../services/purchase-service.js';
import { stripPriceFields } from '../services/fulfillment-service.js';

const router = Router();

// 中间件：允许 du/dx/dm/dxx 访问（exx 不允许访问采购单）
router.use(requireAuth, (req, res, next) => {
  const user = (req as any).user as JwtPayload;
  if (!user) return next({ statusCode: 401, code: 'UNAUTHORIZED', error: 'No user' });
  
  // du-purchase.ts 处理的路径列表
  const purchasePaths = ['/purchase-orders'];
  const isPurchasePath = purchasePaths.some(p => req.path === p || req.path.startsWith(p + '/'));
  
  // EXX 不允许访问采购单（价格敏感）- 只拦截采购路径
  if (user.role === 'exx') {
    if (isPurchasePath) {
      return next({ statusCode: 403, code: 'FORBIDDEN', error: 'EXX 铺员无权访问采购单' });
    }
    // 非采购路径（如 /transfers），交给其他路由器处理
    return next();
  }
  
  // 非采购路径，交给其他路由器处理
  if (!isPurchasePath) {
    return next();
  }
  
  const allowedRoles = ['du', 'dx', 'dm', 'dxx'];
  if (!allowedRoles.includes(user.role)) {
    return next({ statusCode: 403, code: 'FORBIDDEN', error: 'Insufficient role' });
  }
  
  // DM 只读：写接口 403
  if (user.role === 'dm' && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    return next({ statusCode: 403, code: 'FORBIDDEN', error: 'DM 运营为只读角色，无写权限' });
  }
  
  // DXX：拦截 res.json 以 stripCostFields
  if (user.role === 'dxx') {
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      return originalJson(stripCostFields(body));
    };
  }
  
  next();
});

// GET /purchase-orders
router.get('/purchase-orders', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const offset = (page - 1) * pageSize;
    const status = req.query.status as string;

    let where = 'WHERE org_id = $1';
    const params: any[] = [user.orgId];
    let idx = 2;
    if (status) { where += ` AND status = $${idx}`; params.push(status); idx++; }

    const countRes = await pool.query(`SELECT COUNT(*) FROM booth_purchase_orders ${where}`, params);
    const dataRes = await pool.query(
      `SELECT * FROM booth_purchase_orders ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, pageSize, offset]
    );
    res.json({ success: true, data: { items: dataRes.rows, total: parseInt(countRes.rows[0].count), page, pageSize } });
  } catch (err) { next(err); }
});

// GET /purchase-orders/:id
router.get('/purchase-orders/:id', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query('SELECT * FROM booth_purchase_orders WHERE id = $1 AND org_id = $2', [req.params.id, user.orgId]);
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// POST /purchase-orders
router.post('/purchase-orders', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const user = (req as any).user as JwtPayload;
    const { supplier, items, remark } = req.body;
    const poNo = await nextPoNo(user.orgId);
    const totalAmount = (items || []).reduce((s: number, i: any) => s + (parseFloat(i.unitPrice || 0) * parseInt(i.qty || 0)), 0);

    const r = await client.query(
      `INSERT INTO booth_purchase_orders (org_id, po_no, supplier, total_amount, created_by, items, remark)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [user.orgId, poNo, supplier, totalAmount, user.userId, JSON.stringify(items || []), remark]
    );
    await client.query('COMMIT');
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// POST /purchase-orders/:id/submit
router.post('/purchase-orders/:id/submit', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `UPDATE booth_purchase_orders SET status = 'submitted', submitted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND status = 'draft' RETURNING *`,
      [req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot submit: invalid state (must be draft)', code: 'INVALID_TRANSITION' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// POST /purchase-orders/:id/approve (du only)
router.post('/purchase-orders/:id/approve', requireRole('du'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `UPDATE booth_purchase_orders SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND org_id = $3 AND status = 'submitted' RETURNING *`,
      [user.userId, req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot approve: invalid state', code: 'INVALID_TRANSITION' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// POST /purchase-orders/:id/reject (du only)
router.post('/purchase-orders/:id/reject', requireRole('du'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { rejection_reason } = req.body;
    const r = await pool.query(
      `UPDATE booth_purchase_orders SET status = 'rejected', rejection_reason = $1, updated_at = NOW()
       WHERE id = $2 AND org_id = $3 AND status = 'submitted' RETURNING *`,
      [rejection_reason, req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot reject: invalid state', code: 'INVALID_TRANSITION' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// POST /purchase-orders/:id/start (approved → in_progress)
router.post('/purchase-orders/:id/start', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `UPDATE booth_purchase_orders SET status = 'in_progress', updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND status = 'approved' RETURNING *`,
      [req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot start: invalid state (must be approved)', code: 'INVALID_TRANSITION' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// POST /purchase-orders/:id/receive
router.post('/purchase-orders/:id/receive', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const user = (req as any).user as JwtPayload;
    const { items: receiveItems } = req.body;
    const poId = req.params.id;

    await client.query('BEGIN');
    const poRes = await client.query(
      `SELECT * FROM booth_purchase_orders WHERE id = $1 AND org_id = $2 FOR UPDATE`,
      [poId, user.orgId]
    );
    if (!poRes.rows.length || !['approved', 'in_progress'].includes(poRes.rows[0].status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Cannot receive: invalid state (must be approved or in_progress)', code: 'INVALID_TRANSITION' });
    }

    for (const ri of receiveItems || []) {
      const skuId = ri.skuId;
      const receivedQty = parseFloat(ri.receivedQty || ri.qty || 0);
      const unitPrice = parseFloat(ri.unitPrice || 0);
      const batchNo = ri.batchNo || `B${Date.now()}`;
      const expiryDate = ri.expiryDate || null;

      // 1. Increase inventory
      await client.query(
        `INSERT INTO booth_inventory (org_id, sku_id, qty_on_hand) VALUES ($1, $2, $3)
         ON CONFLICT (org_id, sku_id) DO UPDATE SET qty_on_hand = booth_inventory.qty_on_hand + $3, updated_at = NOW()`,
        [user.orgId, skuId, receivedQty]
      );

      // 2. Write stock batch
      await client.query(
        `INSERT INTO booth_stock_batches (org_id, sku_id, batch_no, qty, expiry_date, source_type, source_id)
         VALUES ($1, $2, $3, $4, $5, 'purchase', $6)`,
        [user.orgId, skuId, batchNo, receivedQty, expiryDate, poId]
      );

      // 3. Inventory txn
      await client.query(
        `INSERT INTO booth_inventory_txn (org_id, sku_id, qty_change, type, ref_type, ref_id, operator_id)
         VALUES ($1, $2, $3, 'purchase_in', 'purchase_order', $4, $5)`,
        [user.orgId, skuId, receivedQty, poId, user.userId]
      );

      // 4. Recalc moving weighted avg cost
      await recalcUnitCost(client, user.orgId, skuId, receivedQty, unitPrice);
    }

    // Update PO status
    await client.query(
      `UPDATE booth_purchase_orders SET status = 'received', received_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [poId]
    );

    await client.query('COMMIT');
    const updated = await pool.query('SELECT * FROM booth_purchase_orders WHERE id = $1', [poId]);
    res.json({ success: true, data: updated.rows[0] });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

export default router;
