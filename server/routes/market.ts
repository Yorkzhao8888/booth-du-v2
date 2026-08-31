import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole, type JwtPayload } from '../auth.js';

const router = Router();

// Helper to get user from request
function getUser(req: any): JwtPayload {
  // @ts-ignore
  return req.user as JwtPayload;
}

// 价格字段列表（dex/dexx 不可见）
const PRICE_FIELDS = ['unit_price', 'total_amount', 'cost_price'];

// 脱敏中间件：dex/dexx 角色剔除价格相关字段
function stripPriceFields(req: any, res: any, next: any) {
  const user = getUser(req);
  const role = user.role;

  // dex/dexx 不可见价格
  if (role === 'dex' || role === 'dexx') {
    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      if (body && body.data) {
        body.data = stripFields(body.data);
      }
      return originalJson(body);
    };
  }
  next();
}

// 递归剔除价格字段
function stripFields(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(stripFields);
  }
  if (obj && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (!PRICE_FIELDS.includes(key)) {
        result[key] = stripFields(value);
      }
    }
    return result;
  }
  return obj;
}

// 中间件：允许 em/dm/du/dx 访问（dex/dexx 只读且脱敏）
router.use(requireAuth, stripPriceFields, (req, res, next) => {
  const user = getUser(req);
  const allowedRoles = ['em', 'dm', 'du', 'dx', 'dex', 'dexx'];
  
  if (!allowedRoles.includes(user.role)) {
    return next({ statusCode: 403, code: 'FORBIDDEN', error: 'MARKET_ACCESS_DENIED' });
  }
  
  // DM 只读
  if (user.role === 'dm' && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    return next({ statusCode: 403, code: 'FORBIDDEN', error: 'DM_READ_ONLY' });
  }
  
  // dex/dexx 只读
  if ((user.role === 'dex' || user.role === 'dexx') && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    return next({ statusCode: 403, code: 'FORBIDDEN', error: 'EXECUTION_ROLE_READ_ONLY' });
  }
  
  next();
});

// ============ Market 通货商品管理 ============

// 获取商品列表
router.get('/products', async (req, res, next) => {
  try {
    const user = getUser(req);
    const { status, page = '1', pageSize = '20', keyword } = req.query;
    const offset = (Number(page) - 1) * Number(pageSize);
    const limit = Number(pageSize);

    // EM 看所有，其他角色只看 active 商品
    let whereClause = user.role === 'em' ? 'WHERE 1=1' : "WHERE status = 'active'";
    const params: any[] = [];
    let paramIdx = 1;

    if (status && status !== 'all') {
      whereClause += ` AND status = $${paramIdx}`;
      params.push(status);
      paramIdx++;
    }

    if (keyword) {
      whereClause += ` AND (product_name ILIKE $${paramIdx} OR product_code ILIKE $${paramIdx})`;
      params.push(`%${keyword}%`);
      paramIdx++;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM booth_market_products ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT * FROM booth_market_products ${whereClause}
       ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    res.json({ success: true, data: { items: dataResult.rows, total, page: Number(page), pageSize: limit } });
  } catch (err) {
    next(err);
  }
});

// 获取单个商品详情
router.get('/products/:id', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM booth_market_products WHERE id = $1',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '商品不存在', code: 'NOT_FOUND' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// 创建商品（EM only）
router.post('/products', requireRole('em'), async (req, res, next) => {
  try {
    const user = getUser(req);
    const { product_name, product_code, specification, unit, unit_price, stock_qty, supplier_id, supplier_name, description, images } = req.body;

    if (!product_name) {
      return res.status(400).json({ success: false, error: '商品名称不能为空', code: 'MISSING_NAME' });
    }

    const result = await pool.query(
      `INSERT INTO booth_market_products
       (org_id, product_name, product_code, specification, unit, unit_price, stock_qty, supplier_id, supplier_name, description, images, created_by, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'draft')
       RETURNING *`,
      [user.orgId, product_name, product_code, specification, unit || '件', unit_price || 0, stock_qty || 0, supplier_id, supplier_name, description, images || [], user.userId]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// 更新商品
router.put('/products/:id', requireRole('em'), async (req, res, next) => {
  try {
    const { product_name, product_code, specification, unit, unit_price, stock_qty, supplier_id, supplier_name, description, images, status } = req.body;

    const result = await pool.query(
      `UPDATE booth_market_products
       SET product_name = COALESCE($1, product_name),
           product_code = COALESCE($2, product_code),
           specification = COALESCE($3, specification),
           unit = COALESCE($4, unit),
           unit_price = COALESCE($5, unit_price),
           stock_qty = COALESCE($6, stock_qty),
           supplier_id = COALESCE($7, supplier_id),
           supplier_name = COALESCE($8, supplier_name),
           description = COALESCE($9, description),
           images = COALESCE($10, images),
           status = COALESCE($11, status),
           updated_at = NOW()
       WHERE id = $12
       RETURNING *`,
      [product_name, product_code, specification, unit, unit_price, stock_qty, supplier_id, supplier_name, description, images ? JSON.stringify(images) : null, status, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '商品不存在', code: 'NOT_FOUND' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// 上架/下架商品
router.post('/products/:id/toggle', requireRole('em'), async (req, res, next) => {
  try {
    const { action } = req.body; // 'activate' or 'deactivate'
    
    const newStatus = action === 'activate' ? 'active' : 'inactive';
    const validFrom = action === 'activate' ? ['draft', 'inactive'] : ['active'];
    
    const current = await pool.query(
      'SELECT status FROM booth_market_products WHERE id = $1',
      [req.params.id]
    );
    
    if (current.rows.length === 0) {
      return res.status(404).json({ success: false, error: '商品不存在', code: 'NOT_FOUND' });
    }
    
    if (!validFrom.includes(current.rows[0].status)) {
      return res.status(400).json({ 
        success: false, 
        error: `无法${action === 'activate' ? '上架' : '下架'}：当前状态为 ${current.rows[0].status}`,
        code: 'INVALID_TRANSITION'
      });
    }

    const result = await pool.query(
      `UPDATE booth_market_products SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [newStatus, req.params.id]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// 删除商品
router.delete('/products/:id', requireRole('em'), async (req, res, next) => {
  try {
    const result = await pool.query(
      'DELETE FROM booth_market_products WHERE id = $1 AND status = \'draft\' RETURNING id',
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: '只能删除草稿状态的商品', code: 'INVALID_TRANSITION' });
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ============ Market 供应商准入 ============

// 获取 Market 供应商准入列表
router.get('/supplier-admissions', async (req, res, next) => {
  try {
    const user = getUser(req);
    const { status, page = '1', pageSize = '20' } = req.query;
    const offset = (Number(page) - 1) * Number(pageSize);
    const limit = Number(pageSize);

    let whereClause = 'WHERE org_id = $1';
    const params: any[] = [user.orgId];
    let paramIdx = 2;

    if (status && status !== 'all') {
      whereClause += ` AND status = $${paramIdx}`;
      params.push(status);
      paramIdx++;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM booth_market_supplier_admissions ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT * FROM booth_market_supplier_admissions ${whereClause}
       ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    res.json({ success: true, data: { items: dataResult.rows, total, page: Number(page), pageSize: limit } });
  } catch (err) {
    next(err);
  }
});

// 创建 Market 供应商准入申请
router.post('/supplier-admissions', async (req, res, next) => {
  try {
    const user = getUser(req);
    const { supplier_name, contact_person, contact_phone, business_license, qualifications, category, region } = req.body;

    if (!supplier_name) {
      return res.status(400).json({ success: false, error: '供应商名称不能为空', code: 'MISSING_NAME' });
    }

    const result = await pool.query(
      `INSERT INTO booth_market_supplier_admissions
       (org_id, supplier_name, contact_person, contact_phone, business_license, qualifications, category, region, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       RETURNING *`,
      [user.orgId, supplier_name, contact_person, contact_phone, business_license, qualifications, category, region]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// 审核 Market 供应商准入（EM only）
router.post('/supplier-admissions/:id/review', requireRole('em'), async (req, res, next) => {
  try {
    const user = getUser(req);
    const { status, review_remark } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, error: '状态必须为 approved 或 rejected', code: 'INVALID_STATUS' });
    }

    // 验证当前状态
    const current = await pool.query(
      'SELECT status FROM booth_market_supplier_admissions WHERE id = $1 AND org_id = $2',
      [req.params.id, user.orgId]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({ success: false, error: '申请不存在', code: 'NOT_FOUND' });
    }

    if (current.rows[0].status !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        error: `无法审核：当前状态为 ${current.rows[0].status}，只有 pending 状态可审核`,
        code: 'INVALID_TRANSITION'
      });
    }

    const result = await pool.query(
      `UPDATE booth_market_supplier_admissions
       SET status = $1, review_remark = $2, reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $4 AND org_id = $5
       RETURNING *`,
      [status, review_remark, user.userId, req.params.id, user.orgId]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ============ Market 订单 ============

// 获取订单列表
router.get('/orders', async (req, res, next) => {
  try {
    const user = getUser(req);
    const { status, page = '1', pageSize = '20' } = req.query;
    const offset = (Number(page) - 1) * Number(pageSize);
    const limit = Number(pageSize);

    let whereClause = 'WHERE org_id = $1';
    const params: any[] = [user.orgId];
    let paramIdx = 2;

    if (status && status !== 'all') {
      whereClause += ` AND status = $${paramIdx}`;
      params.push(status);
      paramIdx++;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM booth_market_orders ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT * FROM booth_market_orders ${whereClause}
       ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    res.json({ success: true, data: { items: dataResult.rows, total, page: Number(page), pageSize: limit } });
  } catch (err) {
    next(err);
  }
});

// 创建订单（顾客下单）
router.post('/orders', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const user = getUser(req);
    const { customer_name, customer_phone, customer_address, items, remark } = req.body;

    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, error: '订单明细不能为空', code: 'MISSING_ITEMS' });
    }

    await client.query('BEGIN');

    // 生成订单号
    const orderNo = `MKT-${Date.now().toString(36).toUpperCase()}`;
    
    // 计算总金额
    let totalAmount = 0;
    for (const item of items) {
      const productRes = await client.query(
        'SELECT unit_price, stock_qty, status FROM booth_market_products WHERE id = $1',
        [item.product_id]
      );
      
      if (productRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: `商品 ${item.product_id} 不存在`, code: 'PRODUCT_NOT_FOUND' });
      }
      
      const product = productRes.rows[0];
      if (product.status !== 'active') {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: `商品未上架`, code: 'PRODUCT_NOT_ACTIVE' });
      }
      
      if (product.stock_qty < item.qty) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: `商品库存不足`, code: 'INSUFFICIENT_STOCK' });
      }
      
      totalAmount += parseFloat(product.unit_price) * item.qty;
    }

    // 创建订单
    const orderResult = await client.query(
      `INSERT INTO booth_market_orders
       (org_id, order_no, customer_name, customer_phone, customer_address, items, total_amount, remark)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [user.orgId, orderNo, customer_name, customer_phone, customer_address, JSON.stringify(items), totalAmount, remark]
    );

    // 扣减库存
    for (const item of items) {
      await client.query(
        `UPDATE booth_market_products 
         SET stock_qty = stock_qty - $1, updated_at = NOW()
         WHERE id = $2`,
        [item.qty, item.product_id]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, data: orderResult.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// 更新订单状态
router.post('/orders/:id/status', async (req, res, next) => {
  try {
    const user = getUser(req);
    const { status } = req.body;

    // 状态机: pending → confirmed → fulfilling → completed / cancelled
    const validTransitions: Record<string, string[]> = {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['fulfilling', 'cancelled'],
      fulfilling: ['completed', 'cancelled'],
      completed: [],
      cancelled: [],
    };

    const current = await pool.query(
      'SELECT status FROM booth_market_orders WHERE id = $1 AND org_id = $2',
      [req.params.id, user.orgId]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({ success: false, error: '订单不存在', code: 'NOT_FOUND' });
    }

    const currentStatus = current.rows[0].status;
    if (!validTransitions[currentStatus]?.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `不允许从 ${currentStatus} 转为 ${status}`,
        code: 'INVALID_TRANSITION'
      });
    }

    const result = await pool.query(
      `UPDATE booth_market_orders SET status = $1, updated_at = NOW() WHERE id = $2 AND org_id = $3 RETURNING *`,
      [status, req.params.id, user.orgId]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ============ 统计概览 ============
router.get('/overview/stats', async (req, res, next) => {
  try {
    const user = getUser(req);

    const [productStats, admissionStats, orderStats] = await Promise.all([
      pool.query(
        `SELECT status, COUNT(*) as count FROM booth_market_products GROUP BY status`
      ),
      pool.query(
        `SELECT status, COUNT(*) as count FROM booth_market_supplier_admissions WHERE org_id = $1 GROUP BY status`,
        [user.orgId]
      ),
      pool.query(
        `SELECT status, COUNT(*) as count, SUM(total_amount) as total_amount FROM booth_market_orders WHERE org_id = $1 GROUP BY status`,
        [user.orgId]
      ),
    ]);

    res.json({
      success: true,
      data: {
        products: productStats.rows,
        admissions: admissionStats.rows,
        orders: orderStats.rows,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ============ BOOTH-OPT-01: MKT 接单 ATP 校验 ============

// QueryCapacity: 供 Market 检索可承诺量
router.get('/capacity/query', async (req, res, next) => {
  try {
    const user = getUser(req);
    const { start_date } = req.query;
    const dateStr = (start_date as string) || new Date().toISOString().slice(0, 10);

    const resources = await pool.query(
      `SELECT cr.id, cr.resource_code, cr.resource_name, cr.resource_type, cr.traffic_cap, cr.unit,
       cr.shift_hours_per_day, cr.efficiency_rate,
       COALESCE(
         (SELECT SUM(cl.occupied_qty) FROM booth_capacity_load cl
          WHERE cl.resource_id = cr.id AND cl.org_id = $1
          AND cl.slot_date >= $2::date AND cl.slot_date <= $2::date + INTERVAL '7 days'),
         0) as load_7d
       FROM booth_capacity_resources cr
       WHERE cr.org_id = $1 AND cr.status = 'active'
       ORDER BY cr.resource_type, cr.resource_code`,
      [user.orgId, dateStr]
    );

    const items = resources.rows.map((r: any) => {
      const dailyCap = Math.round(r.traffic_cap * (r.shift_hours_per_day || 8) * (r.efficiency_rate || 1));
      const load = parseFloat(r.load_7d) || 0;
      return {
        resource_id: r.id,
        resource_code: r.resource_code,
        resource_name: r.resource_name,
        resource_type: r.resource_type,
        daily_capacity: dailyCap,
        load_7d: Math.round(load),
        remaining_7d: Math.max(0, dailyCap * 7 - Math.round(load)),
        load_rate: dailyCap * 7 > 0 ? Math.min(100, Math.round((load / (dailyCap * 7)) * 100)) : 0,
      };
    });

    const totalCap7d = items.reduce((s: number, i: any) => s + i.daily_capacity * 7, 0);
    const totalLoad7d = items.reduce((s: number, i: any) => s + i.load_7d, 0);

    res.json({
      success: true,
      data: {
        query_date: dateStr,
        items,
        summary: {
          total_resources: items.length,
          total_capacity_7d: totalCap7d,
          total_load_7d: totalLoad7d,
          total_remaining_7d: Math.max(0, totalCap7d - totalLoad7d),
          overall_load_rate: totalCap7d > 0 ? Math.min(100, Math.round((totalLoad7d / totalCap7d) * 100)) : 0,
        },
      },
    });
  } catch (err) { next(err); }
});

// ATP 校验：MKT 接单前调用
router.post('/atp/check', async (req, res, next) => {
  try {
    const user = getUser(req);
    const { requestedQty, product, startDate } = req.body;
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

    // 创建 ATP 承诺记录
    let commitmentId: number | null = null;
    if (canFulfill) {
      const commitNo = `ATP${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const cR = await pool.query(
        `INSERT INTO booth_atp_commitments (org_id, commitment_no, source_type, requested_qty, requested_product, atp_qty, earliest_date, queue_position, status)
         VALUES ($1,$2,'market_order',$3,$4,$5,$6,$7,'pending') RETURNING id`,
        [user.orgId, commitNo, qty, product, remaining, earliestDate, 0]
      );
      commitmentId = cR.rows[0]?.id || null;
    }

    res.json({
      success: true,
      data: {
        requested_qty: qty,
        atp_qty: remaining,
        can_fulfill: canFulfill,
        earliest_date: earliestDate,
        queue_position: queuePosition,
        commitment_id: commitmentId,
        total_daily_capacity: totalDailyCap,
        current_load: Math.round(totalLoad),
        load_rate: totalDailyCap > 0 ? Math.min(100, Math.round((totalLoad / totalDailyCap) * 100)) : 0,
      },
    });
  } catch (err) { next(err); }
});

// ==================== SGU Listings (Market 可检索) ====================

// GET /sgu/listings - Market 检索挂牌的 SGU 目录（只读，不含价格）
router.get('/sgu/listings', async (req, res, next) => {
  try {
    const user = getUser(req);
    const { boothType, skuId, search } = req.query;
    let sql = `SELECT sl.id, sl.listing_no, sl.sgu_id, sl.status, sl.market_visible, sl.listed_at,
               sc.sgu_no, sc.booth_type, sc.traffic_cap, sc.lead_time_hours, sc.description,
               s.sku_code, s.name as sku_name, s.unit
               FROM booth_sgu_listings sl
               JOIN booth_sgu_catalog sc ON sc.id = sl.sgu_id
               JOIN booth_skus s ON s.id = sc.sku_id
               WHERE sl.org_id = $1 AND sl.status = 'listed' AND sl.market_visible = TRUE`;
    const params: any[] = [user.orgId];
    let idx = 2;
    if (boothType) { sql += ` AND sc.booth_type = $${idx++}`; params.push(boothType); }
    if (skuId) { sql += ` AND sc.sku_id = $${idx++}`; params.push(skuId); }
    if (search) { sql += ` AND (s.name ILIKE $${idx} OR s.sku_code ILIKE $${idx})`; params.push(`%${search}%`); idx++; }
    sql += ' ORDER BY sl.listed_at DESC';
    const r = await pool.query(sql, params);
    res.json({ success: true, data: r.rows });
  } catch (err) { next(err); }
});

export default router;
