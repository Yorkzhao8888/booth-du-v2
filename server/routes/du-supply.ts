import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, stripCostFields } from '../auth.js';
import type { JwtPayload } from '../auth.js';

const router = Router();

// ====== DU/DX/DM/DXX/DEXX: 按角色权限访问 ======
const supplyRouter = Router();
supplyRouter.use(requireAuth, (req, res, next) => {
  const user = (req as any).user as JwtPayload;
  if (!user) return next({ statusCode: 401, code: 'UNAUTHORIZED', error: 'No user' });
  
  // DEXX 特殊处理：只能 GET 访问（只读），写操作 403
  if (user.role === 'dexx') {
    if (req.method !== 'GET') {
      return next({ statusCode: 403, code: 'FORBIDDEN', error: 'DEXX 铺员只能查看调拨列表' });
    }
    // dexx 可以 GET 访问，strip cost fields
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      return originalJson(stripCostFields(body));
    };
    return next();
  }
  
  const allowedRoles = ['du', 'dx', 'dm', 'dxx', 'dexx'];
  if (!allowedRoles.includes(user.role)) {
    return next({ statusCode: 403, code: 'FORBIDDEN', error: 'Insufficient role' });
  }
  
  // DM 只读：写接口 403
  if (user.role === 'dm' && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    return next({ statusCode: 403, code: 'FORBIDDEN', error: 'DM 运营为只读角色，无写权限' });
  }
  
  // DXX：拦截 res.json 以 stripCostFields + 结算字段
  if (user.role === 'dxx') {
    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      // 递归剔除结算相关字段
      const stripSettlementFields = (obj: any): any => {
        if (obj === null || obj === undefined) return obj;
        if (Array.isArray(obj)) return obj.map(stripSettlementFields);
        if (typeof obj === 'object') {
          const result: any = {};
          for (const [key, value] of Object.entries(obj)) {
            // 隐藏结算金额相关字段
            if (['total_settled', 'pending_settlement', 'settled_at', 'settle_amount', 
                 'totalSettled', 'pendingSettlement', 'settledAt', 'settleAmount',
                 'cost_price', 'costPrice', 'unit_cost', 'unitCost', 'gross_margin', 'grossMargin',
                 'material_cost', 'materialCost', 'revenue', 'gross_profit', 'grossProfit'].includes(key)) {
              continue;
            }
            result[key] = stripSettlementFields(value);
          }
          return result;
        }
        return obj;
      };
      return originalJson(stripSettlementFields(body));
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
    const { items, supplierId, supplier_id } = req.body;
    
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: '补货项不能为空' });
    }
    
    // 生成采购单号 - 修复 LPAD 类型问题
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const poNoRes = await pool.query(
      `SELECT 'PO-' || $1 || '-' || LPAD(CAST(COALESCE(MAX(CAST(SUBSTRING(po_no FROM '...$') AS INT)), 0) + 1 AS TEXT), 4, '0') as po_no 
       FROM booth_purchase_orders 
       WHERE po_no LIKE $2`,
      [today, `PO-${today}%`]
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
    
    // 查找供应商名称
    let supplierName = '待指定';
    if (supplier_id || supplierId) {
      const supRes = await pool.query(
        'SELECT name FROM booth_suppliers WHERE id = $1 AND org_id = $2',
        [supplier_id || supplierId, user.orgId]
      );
      if (supRes.rows.length > 0) {
        supplierName = supRes.rows[0].name;
      }
    }
    
    // 创建采购单
    const r = await pool.query(`
      INSERT INTO booth_purchase_orders (org_id, po_no, supplier, status, total_amount, items, created_by)
      VALUES ($1, $2, $3, 'draft', $4, $5, $6)
      RETURNING *
    `, [
      user.orgId,
      poNo,
      supplierName,
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
        s.id,
        s.name,
        s.contact_person,
        s.contact_phone,
        s.payment_terms,
        s.remark,
        s.created_at,
        COALESCE(SUM(CASE WHEN st.status = 'settled' THEN st.amount ELSE 0 END), 0) as total_settled,
        COALESCE(SUM(CASE WHEN st.status = 'pending' THEN st.amount ELSE 0 END), 0) as pending_settlement,
        COUNT(DISTINCT st.id) as settlement_count
      FROM booth_suppliers s
      LEFT JOIN booth_supplier_settlements st ON s.id = st.supplier_id AND s.org_id = st.org_id
      WHERE s.org_id = $1
      GROUP BY s.id, s.name, s.contact_person, s.contact_phone, s.payment_terms, s.remark, s.created_at
      ORDER BY s.name
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

// POST /suppliers - 创建供应商
supplyRouter.post('/suppliers', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { name, contact_person, contact_phone, payment_terms, remark } = req.body;
    
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ success: false, error: '供应商名称不能为空' });
    }
    
    const r = await pool.query(`
      INSERT INTO booth_suppliers (org_id, name, contact_person, contact_phone, payment_terms, remark)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [
      user.orgId,
      name.trim(),
      contact_person || null,
      contact_phone || null,
      payment_terms || 0,
      remark || null
    ]);
    
    res.json({ success: true, data: r.rows[0] });
  } catch (err: any) {
    // 处理唯一约束冲突
    if (err.code === '23505') {
      return res.status(400).json({ success: false, error: '供应商名称已存在' });
    }
    next(err);
  }
});

// PUT /suppliers/:id - 更新供应商
supplyRouter.put('/suppliers/:id', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { id } = req.params;
    const { name, contact_person, contact_phone, payment_terms, remark } = req.body;
    
    const r = await pool.query(`
      UPDATE booth_suppliers
      SET name = COALESCE($3, name),
          contact_person = COALESCE($4, contact_person),
          contact_phone = COALESCE($5, contact_phone),
          payment_terms = COALESCE($6, payment_terms),
          remark = COALESCE($7, remark),
          updated_at = NOW()
      WHERE id = $1 AND org_id = $2
      RETURNING *
    `, [id, user.orgId, name, contact_person, contact_phone, payment_terms, remark]);
    
    if (r.rows.length === 0) {
      return res.status(404).json({ success: false, error: '供应商不存在' });
    }
    
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE /suppliers/:id - 删除供应商
supplyRouter.delete('/suppliers/:id', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { id } = req.params;
    
    const r = await pool.query(`
      DELETE FROM booth_suppliers
      WHERE id = $1 AND org_id = $2
      RETURNING *
    `, [id, user.orgId]);
    
    if (r.rows.length === 0) {
      return res.status(404).json({ success: false, error: '供应商不存在' });
    }
    
    res.json({ success: true, data: { id: parseInt(id) } });
  } catch (err) {
    next(err);
  }
});

// GET /suppliers/:supplierId/settlements - 供应商结算单列表
supplyRouter.get('/suppliers/:supplierId/settlements', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { supplierId } = req.params;
    
    const r = await pool.query(`
      SELECT 
        st.id,
        st.supplier_id,
        st.po_id,
        st.amount,
        st.status,
        st.settled_at,
        st.remark,
        st.created_at,
        po.po_no
      FROM booth_supplier_settlements st
      LEFT JOIN booth_purchase_orders po ON st.po_id = po.id
      WHERE st.org_id = $1 AND st.supplier_id = $2
      ORDER BY st.created_at DESC
    `, [user.orgId, supplierId]);
    
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

// POST /suppliers/:supplierId/settlements - 创建结算单（从 received 采购单）
supplyRouter.post('/suppliers/:supplierId/settlements', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { supplierId } = req.params;
    const { po_id, amount, remark } = req.body;
    
    if (!po_id || !amount) {
      return res.status(400).json({ success: false, error: '缺少采购单ID或金额' });
    }
    
    // 验证采购单存在且状态为 received
    const poRes = await pool.query(`
      SELECT * FROM booth_purchase_orders 
      WHERE id = $1 AND org_id = $2 AND status = 'received'
    `, [po_id, user.orgId]);
    
    if (poRes.rows.length === 0) {
      return res.status(400).json({ success: false, error: '采购单不存在或状态不是已收货' });
    }
    
    // 检查是否已有结算单
    const existRes = await pool.query(`
      SELECT id FROM booth_supplier_settlements 
      WHERE po_id = $1 AND org_id = $2
    `, [po_id, user.orgId]);
    
    if (existRes.rows.length > 0) {
      return res.status(400).json({ success: false, error: '该采购单已创建结算单' });
    }
    
    const r = await pool.query(`
      INSERT INTO booth_supplier_settlements (org_id, supplier_id, po_id, amount, status, remark)
      VALUES ($1, $2, $3, $4, 'pending', $5)
      RETURNING *
    `, [user.orgId, supplierId, po_id, amount, remark]);
    
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    next(err);
  }
});

// POST /suppliers/:supplierId/settlements/:id/settle - 结算确认
supplyRouter.post('/suppliers/:supplierId/settlements/:id/settle', async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { id } = req.params;
    
    const r = await pool.query(`
      UPDATE booth_supplier_settlements
      SET status = 'settled', settled_at = NOW()
      WHERE id = $1 AND org_id = $2 AND status = 'pending'
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
    
    // 修复 date 类型算术歧义：使用 make_interval
    let where = 'WHERE b.org_id = $1 AND b.expiry_date IS NOT NULL AND b.expiry_date <= CURRENT_DATE + make_interval(days => $2)';
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
        (b.expiry_date - CURRENT_DATE) as days_remaining
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
      // 呆滞预警：库存 >= 安全库存（有库存但不动销）
      where += ` AND i.qty_on_hand >= COALESCE(s.safety_stock, 0) AND i.qty_on_hand > 0`;
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
