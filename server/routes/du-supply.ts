import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, stripCostFields } from '../auth.js';
import type { JwtPayload } from '../auth.js';

const router = Router();

// ====== DU/DX/DM/DXX: 按角色权限访问 ======
const supplyRouter = Router();
supplyRouter.use(requireAuth, (req, res, next) => {
  const user = (req as any).user as JwtPayload;
  if (!user) return next({ statusCode: 401, code: 'UNAUTHORIZED', error: 'No user' });
  
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

// ====== 1. 智能补货 ======
// GET /replenish/suggestions - 补货建议清单
supplyRouter.get('/replenish/suggestions', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const warehouseType = req.query.warehouse_type as string;
    
    let where = 'WHERE i.org_id = $1';
    const params: any[] = [user.orgId];
    let idx = 2;
    
    if (warehouseType) {
      where += ` AND i.warehouse_type = $${idx}`;
      params.push(warehouseType);
      idx++;
    }
    
    // 查询库存低于安全库存的 SKU
    const r = await pool.query(`
      SELECT 
        i.id as inventory_id,
        i.sku_id,
        i.qty_on_hand,
        i.warehouse_type,
        s.name as sku_name,
        s.safety_stock,
        COALESCE(s.safety_stock, 0) as safety_stock_value,
        CASE 
          WHEN i.qty_on_hand < COALESCE(s.safety_stock, 0) 
          THEN COALESCE(s.safety_stock, 0) - i.qty_on_hand 
          ELSE 0 
        END as suggested_qty
      FROM booth_inventory i
      JOIN booth_skus s ON i.sku_id = s.id
      ${where}
      AND i.qty_on_hand < COALESCE(s.safety_stock, 0)
      ORDER BY suggested_qty DESC
    `, params);
    
    res.json({ 
      success: true, 
      data: { 
        items: r.rows, 
        total: r.rows.length 
      } 
    });
  } catch (err) {
    next(err);
  }
});

// POST /replenish/to-po - 一键转采购单
supplyRouter.post('/replenish/to-po', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { items, supplierId } = req.body;
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: '补货项不能为空' });
    }
    
    // 生成采购单号
    const poNoRes = await pool.query(
      `SELECT 'PO-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(COALESCE(MAX(CAST(SUBSTRING(po_no FROM '...$') AS INT)), 0) + 1, 4, '0') as po_no 
       FROM booth_purchase_orders 
       WHERE po_no LIKE $1`,
      [`PO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}%`]
    );
    const poNo = poNoRes.rows[0].po_no;
    
    // 计算总金额
    let totalAmount = 0;
    const poItems = items.map((item: any) => {
      const amount = (item.unitCost || 0) * item.qty;
      totalAmount += amount;
      return {
        skuId: item.skuId,
        skuName: item.skuName,
        qty: item.qty,
        unitCost: item.unitCost || 0,
        amount
      };
    });
    
    // 创建采购单
    const r = await pool.query(`
      INSERT INTO booth_purchase_orders (org_id, po_no, supplier, status, total_amount, items, created_by)
      VALUES ($1, $2, $3, 'draft', $4, $5, $6)
      RETURNING *
    `, [
      user.orgId,
      poNo,
      supplierId || '待指定',
      totalAmount,
      JSON.stringify(poItems),
      user.userId
    ]);
    
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ====== 2. 供应商管理 ======
// GET /suppliers - 供应商列表
supplyRouter.get('/suppliers', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    
    // 查询供应商及其结算信息
    const r = await pool.query(`
      SELECT 
        po.supplier,
        COUNT(DISTINCT po.id) as po_count,
        SUM(CASE WHEN po.status IN ('approved', 'received') THEN po.total_amount ELSE 0 END) as total_settled,
        SUM(CASE WHEN po.status = 'approved' THEN po.total_amount ELSE 0 END) as pending_settlement
      FROM booth_purchase_orders po
      WHERE po.org_id = $1
      GROUP BY po.supplier
      ORDER BY po.supplier
    `, [user.orgId]);
    
    res.json({ 
      success: true, 
      data: { 
        items: r.rows, 
        total: r.rows.length 
      } 
    });
  } catch (err) {
    next(err);
  }
});

// GET /suppliers/:supplier/settlements - 供应商结算单列表
supplyRouter.get('/suppliers/:supplier/settlements', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { supplier } = req.params;
    
    const r = await pool.query(`
      SELECT 
        id,
        po_no,
        supplier,
        total_amount,
        status,
        approved_at,
        received_at,
        created_at
      FROM booth_purchase_orders
      WHERE org_id = $1 AND supplier = $2
      ORDER BY created_at DESC
    `, [user.orgId, supplier]);
    
    res.json({ 
      success: true, 
      data: { 
        items: r.rows, 
        total: r.rows.length 
      } 
    });
  } catch (err) {
    next(err);
  }
});

// POST /suppliers/:supplier/settlements/:id/settle - 结算确认
supplyRouter.post('/suppliers/:supplier/settlements/:id/settle', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { id } = req.params;
    
    const r = await pool.query(`
      UPDATE booth_purchase_orders
      SET status = 'received', received_at = NOW()
      WHERE id = $1 AND org_id = $2 AND status = 'approved'
      RETURNING *
    `, [id, user.orgId]);
    
    if (r.rows.length === 0) {
      return res.status(400).json({ success: false, error: '结算单不存在或状态不正确' });
    }
    
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ====== 3. 效期管控 / 临期预警 ======
// GET /batches/expiring - 临期批次列表
supplyRouter.get('/batches/expiring', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const days = parseInt(req.query.days as string) || 30;
    const warehouseType = req.query.warehouse_type as string;
    
    let where = 'WHERE b.org_id = $1 AND b.expiry_date IS NOT NULL AND b.expiry_date <= CURRENT_DATE + $2';
    const params: any[] = [user.orgId, days];
    let idx = 3;
    
    if (warehouseType) {
      where += ` AND b.warehouse_type = $${idx}`;
      params.push(warehouseType);
      idx++;
    }
    
    const r = await pool.query(`
      SELECT 
        b.id,
        b.sku_id,
        b.batch_no,
        b.qty,
        b.expiry_date,
        b.warehouse_type,
        s.name as sku_name,
        CASE 
          WHEN b.expiry_date <= CURRENT_DATE THEN 'expired'
          WHEN b.expiry_date <= CURRENT_DATE + 7 THEN 'critical'
          WHEN b.expiry_date <= CURRENT_DATE + 30 THEN 'warning'
          ELSE 'normal'
        END as expiry_status,
        b.expiry_date - CURRENT_DATE as days_remaining
      FROM booth_stock_batches b
      JOIN booth_skus s ON b.sku_id = s.id
      ${where}
      ORDER BY b.expiry_date ASC
    `, params);
    
    res.json({ 
      success: true, 
      data: { 
        items: r.rows, 
        total: r.rows.length 
      } 
    });
  } catch (err) {
    next(err);
  }
});

// ====== 4. 库存预警（缺货/呆滞）======
// GET /inventory/alerts - 库存预警列表
supplyRouter.get('/inventory/alerts', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const type = req.query.type as string; // 'stockout' | 'stagnant'
    const warehouseType = req.query.warehouse_type as string;
    const stagnantDays = parseInt(req.query.stagnant_days as string) || 30;
    
    let where = 'WHERE i.org_id = $1';
    const params: any[] = [user.orgId];
    let idx = 2;
    
    if (warehouseType) {
      where += ` AND i.warehouse_type = $${idx}`;
      params.push(warehouseType);
      idx++;
    }
    
    if (type === 'stockout') {
      // 缺货预警：库存 < 安全库存
      where += ` AND i.qty_on_hand < COALESCE(s.safety_stock, 0)`;
    } else if (type === 'stagnant') {
      // 呆滞预警：近 N 天无出入库记录
      where += ` AND NOT EXISTS (
        SELECT 1 FROM booth_inventory_txn t 
        WHERE t.sku_id = i.sku_id 
        AND t.org_id = i.org_id 
        AND t.created_at > CURRENT_DATE - $${idx}
      )`;
      params.push(stagnantDays);
      idx++;
    }
    
    const r = await pool.query(`
      SELECT 
        i.id as inventory_id,
        i.sku_id,
        i.qty_on_hand,
        i.warehouse_type,
        s.name as sku_name,
        s.safety_stock,
        CASE 
          WHEN i.qty_on_hand < COALESCE(s.safety_stock, 0) THEN 'stockout'
          ELSE 'stagnant'
        END as alert_type
      FROM booth_inventory i
      JOIN booth_skus s ON i.sku_id = s.id
      ${where}
      ORDER BY i.qty_on_hand ASC
    `, params);
    
    res.json({ 
      success: true, 
      data: { 
        items: r.rows, 
        total: r.rows.length 
      } 
    });
  } catch (err) {
    next(err);
  }
});

// ====== 5. 履约追踪 ======
// GET /orders/:id/track - 订单履约追踪
supplyRouter.get('/orders/:id/track', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { id } = req.params;
    
    // 查询订单及其履约链路
    const orderRes = await pool.query(`
      SELECT * FROM booth_fulfillments 
      WHERE id = $1 AND org_id = $2
    `, [id, user.orgId]);
    
    if (orderRes.rows.length === 0) {
      return res.status(404).json({ success: false, error: '订单不存在' });
    }
    
    const order = orderRes.rows[0];
    
    // 查询关联的工作单
    const woRes = await pool.query(`
      SELECT 
        wo.id,
        wo.fulfillment_id,
        wo.product_name,
        wo.status,
        wo.created_at,
        wo.started_at,
        wo.completed_at,
        'FAB' as domain
      FROM booth_work_orders wo
      WHERE wo.fulfillment_id = $1
      ORDER BY wo.created_at ASC
    `, [id]);
    
    // 查询关联的配送任务
    const dlRes = await pool.query(`
      SELECT 
        id,
        fulfillment_id,
        status,
        assigned_at,
        accepted_at,
        picked_at,
        delivering_at,
        signed_at,
        'DL' as domain
      FROM booth_dl_tasks
      WHERE fulfillment_id = $1
      ORDER BY created_at ASC
    `, [id]);
    
    // 查询关联的服务任务
    const svcRes = await pool.query(`
      SELECT 
        id,
        fulfillment_id,
        status,
        assigned_at,
        accepted_at,
        started_at,
        completed_at,
        'SVC' as domain
      FROM booth_svc_tasks
      WHERE fulfillment_id = $1
      ORDER BY created_at ASC
    `, [id]);
    
    // 构建追踪链路
    const trackNodes = [
      {
        domain: 'ORDER',
        status: order.status,
        createdAt: order.created_at,
        completedAt: order.status === 'completed' ? order.created_at : null
      },
      ...woRes.rows.map(wo => ({
        domain: wo.domain,
        nodeId: wo.id,
        productName: wo.product_name,
        status: wo.status,
        createdAt: wo.created_at,
        startedAt: wo.started_at,
        completedAt: wo.completed_at
      })),
      ...dlRes.rows.map(dl => ({
        domain: dl.domain,
        nodeId: dl.id,
        status: dl.status,
        createdAt: dl.assigned_at,
        startedAt: dl.accepted_at,
        completedAt: dl.signed_at
      })),
      ...svcRes.rows.map(svc => ({
        domain: svc.domain,
        nodeId: svc.id,
        status: svc.status,
        createdAt: svc.assigned_at,
        startedAt: svc.started_at,
        completedAt: svc.completed_at
      }))
    ];
    
    res.json({ 
      success: true, 
      data: { 
        orderId: order.id,
        orderNo: order.shop_order_id,
        status: order.status,
        trackNodes 
      } 
    });
  } catch (err) {
    next(err);
  }
});

router.use('/supply', supplyRouter);

export default router;
