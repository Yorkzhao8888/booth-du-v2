import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, type JwtPayload } from '../auth.js';

const router = Router();

// Helper to get user from request
function getUser(req: any): JwtPayload {
  // @ts-ignore
  return req.user as JwtPayload;
}

// 价格字段列表（ex/exx 不可见）
const PRICE_FIELDS = ['payment_terms', 'settlement_amount', 'contract_value'];

// 脱敏中间件：ex/exx 角色剔除价格相关字段
function stripPriceFields(req: any, res: any, next: any) {
  const user = getUser(req);
  const role = user.role;

  // ex/exx 不可见价格
  if (role === 'ex' || role === 'exx') {
    // 拦截带有价格字段的请求
    const path = req.path;
    // 结算相关接口直接 403
    if (path.includes('/settlements')) {
      return res.status(403).json({ success: false, error: 'FORBIDDEN', code: 'PRICE_HIDDEN' });
    }
    // 其他接口在响应时脱敏（通过 response filter）
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

router.use(requireAuth, stripPriceFields);

// ============ 本店供应商档案 CRUD ============

// 获取本店供应商列表
router.get('/', async (req, res, next) => {
  try {
    const user = getUser(req);
    const orgId = user.orgId;
    const { admission_status, page = '1', pageSize = '20', keyword } = req.query;
    const offset = (Number(page) - 1) * Number(pageSize);
    const limit = Number(pageSize);

    let whereClause = 'WHERE org_id = $1';
    const params: any[] = [orgId];
    let paramIdx = 2;

    if (admission_status && admission_status !== 'all') {
      whereClause += ` AND admission_status = $${paramIdx}`;
      params.push(admission_status);
      paramIdx++;
    }

    if (keyword) {
      whereClause += ` AND (name ILIKE $${paramIdx} OR supplier_code ILIKE $${paramIdx} OR contact_person ILIKE $${paramIdx})`;
      params.push(`%${keyword}%`);
      paramIdx++;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM booth_suppliers ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT * FROM booth_suppliers ${whereClause}
       ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    res.json({ success: true, data: { items: dataResult.rows, total, page: Number(page), pageSize: limit } });
  } catch (err) {
    next(err);
  }
});

// 获取单个供应商详情
router.get('/:id', async (req, res, next) => {
  try {
    const user = getUser(req);
    const orgId = user.orgId;
    const { id } = req.params;

    const result = await pool.query(
      'SELECT * FROM booth_suppliers WHERE id = $1 AND org_id = $2',
      [id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '供应商不存在', code: 'NOT_FOUND' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// 创建本店供应商
router.post('/', async (req, res, next) => {
  try {
    const user = getUser(req);
    const orgId = user.orgId;
    const { name, contact_person, contact_phone, category, region, qualifications, business_license, payment_terms, remark } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: '供应商名称不能为空', code: 'MISSING_NAME' });
    }

    // 生成供应商编码
    const supplierCode = `LOC-${Date.now().toString(36).toUpperCase()}`;

    const result = await pool.query(
      `INSERT INTO booth_suppliers
       (org_id, supplier_code, name, contact_person, contact_phone, category, region, qualifications, business_license, payment_terms, remark, admission_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending')
       RETURNING *`,
      [orgId, supplierCode, name, contact_person, contact_phone, category, region, qualifications, business_license, payment_terms || 0, remark]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// 更新本店供应商
router.put('/:id', async (req, res, next) => {
  try {
    const user = getUser(req);
    const orgId = user.orgId;
    const { id } = req.params;
    const { name, contact_person, contact_phone, category, region, qualifications, business_license, payment_terms, remark } = req.body;

    const result = await pool.query(
      `UPDATE booth_suppliers
       SET name = COALESCE($1, name),
           contact_person = COALESCE($2, contact_person),
           contact_phone = COALESCE($3, contact_phone),
           category = COALESCE($4, category),
           region = COALESCE($5, region),
           qualifications = COALESCE($6, qualifications),
           business_license = COALESCE($7, business_license),
           payment_terms = COALESCE($8, payment_terms),
           remark = COALESCE($9, remark),
           updated_at = NOW()
       WHERE id = $10 AND org_id = $11
       RETURNING *`,
      [name, contact_person, contact_phone, category, region, qualifications, business_license, payment_terms, remark, id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '供应商不存在', code: 'NOT_FOUND' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// 删除本店供应商
router.delete('/:id', async (req, res, next) => {
  try {
    const user = getUser(req);
    const orgId = user.orgId;
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM booth_suppliers WHERE id = $1 AND org_id = $2 RETURNING id',
      [id, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '供应商不存在', code: 'NOT_FOUND' });
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ============ 本店准入审核 ============

// 更新准入状态
router.put('/:id/admission', async (req, res, next) => {
  try {
    const user = getUser(req);
    const orgId = user.orgId;
    const userId = user.userId;
    const { id } = req.params;
    const { admission_status, admission_remark } = req.body;

    // 验证状态流转
    const validTransitions: Record<string, string[]> = {
      pending: ['admitted', 'rejected'],
      admitted: ['exited'],
      rejected: ['pending'], // 可重新申请
      exited: [],
    };

    const current = await pool.query(
      'SELECT admission_status FROM booth_suppliers WHERE id = $1 AND org_id = $2',
      [id, orgId]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({ success: false, error: '供应商不存在', code: 'NOT_FOUND' });
    }

    const currentStatus = current.rows[0].admission_status || 'admitted';
    if (!validTransitions[currentStatus]?.includes(admission_status)) {
      return res.status(400).json({
        success: false,
        error: `不允许从 ${currentStatus} 转为 ${admission_status}`,
        code: 'INVALID_TRANSITION',
      });
    }

    let updateFields = ['admission_status = $1', 'updated_at = NOW()'];
    const params: any[] = [admission_status];
    let paramIdx = 2;

    if (admission_status === 'admitted' || admission_status === 'rejected') {
      updateFields.push(`admission_reviewed_at = NOW()`, `admission_reviewed_by = $${paramIdx}`);
      params.push(userId);
      paramIdx++;
    }
    if (admission_remark) {
      updateFields.push(`admission_remark = $${paramIdx}`);
      params.push(admission_remark);
      paramIdx++;
    }

    params.push(id, orgId);
    const result = await pool.query(
      `UPDATE booth_suppliers SET ${updateFields.join(', ')} WHERE id = $${paramIdx} AND org_id = $${paramIdx + 1} RETURNING *`,
      params
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ============ 合同管理 ============

// 获取供应商合同列表
router.get('/:supplierId/contracts', async (req, res, next) => {
  try {
    const user = getUser(req);
    const orgId = user.orgId;
    const { supplierId } = req.params;

    const result = await pool.query(
      `SELECT c.*, s.name as supplier_name
       FROM booth_du_supplier_contracts c
       JOIN booth_suppliers s ON s.id = c.supplier_id
       WHERE c.org_id = $1 AND c.supplier_id = $2
       ORDER BY c.end_date ASC`,
      [orgId, supplierId]
    );

    res.json({ success: true, data: { items: result.rows } });
  } catch (err) {
    next(err);
  }
});

// 获取即将到期合同（30天内）
router.get('/contracts/expiring', async (req, res, next) => {
  try {
    const user = getUser(req);
    const orgId = user.orgId;

    const result = await pool.query(
      `SELECT c.*, s.name as supplier_name
       FROM booth_du_supplier_contracts c
       JOIN booth_suppliers s ON s.id = c.supplier_id
       WHERE c.org_id = $1
         AND c.status = 'active'
         AND c.end_date <= CURRENT_DATE + INTERVAL '30 days'
         AND c.end_date >= CURRENT_DATE
       ORDER BY c.end_date ASC`,
      [orgId]
    );

    res.json({ success: true, data: { items: result.rows } });
  } catch (err) {
    next(err);
  }
});

// 创建合同
router.post('/:supplierId/contracts', async (req, res, next) => {
  try {
    const user = getUser(req);
    const orgId = user.orgId;
    const { supplierId } = req.params;
    const { contract_no, contract_name, start_date, end_date, terms_summary, status } = req.body;

    if (!contract_no) {
      return res.status(400).json({ success: false, error: '合同编号不能为空', code: 'MISSING_CONTRACT_NO' });
    }

    // 验证供应商存在
    const supplier = await pool.query(
      'SELECT id FROM booth_suppliers WHERE id = $1 AND org_id = $2',
      [supplierId, orgId]
    );
    if (supplier.rows.length === 0) {
      return res.status(404).json({ success: false, error: '供应商不存在', code: 'SUPPLIER_NOT_FOUND' });
    }

    const result = await pool.query(
      `INSERT INTO booth_du_supplier_contracts
       (org_id, supplier_id, contract_no, contract_name, start_date, end_date, terms_summary, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [orgId, supplierId, contract_no, contract_name, start_date, end_date, terms_summary, status || 'draft']
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// 更新合同
router.put('/contracts/:contractId', async (req, res, next) => {
  try {
    const user = getUser(req);
    const orgId = user.orgId;
    const { contractId } = req.params;
    const { contract_name, start_date, end_date, terms_summary, status } = req.body;

    const result = await pool.query(
      `UPDATE booth_du_supplier_contracts
       SET contract_name = COALESCE($1, contract_name),
           start_date = COALESCE($2, start_date),
           end_date = COALESCE($3, end_date),
           terms_summary = COALESCE($4, terms_summary),
           status = COALESCE($5, status),
           updated_at = NOW()
       WHERE id = $6 AND org_id = $7
       RETURNING *`,
      [contract_name, start_date, end_date, terms_summary, status, contractId, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '合同不存在', code: 'NOT_FOUND' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// 删除合同
router.delete('/contracts/:contractId', async (req, res, next) => {
  try {
    const user = getUser(req);
    const orgId = user.orgId;
    const { contractId } = req.params;

    const result = await pool.query(
      'DELETE FROM booth_du_supplier_contracts WHERE id = $1 AND org_id = $2 RETURNING id',
      [contractId, orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '合同不存在', code: 'NOT_FOUND' });
    }

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ============ 统计概览 ============
router.get('/overview/stats', async (req, res, next) => {
  try {
    const user = getUser(req);
    const orgId = user.orgId;

    const [supplierStats, contractStats, expiringContracts] = await Promise.all([
      pool.query(
        `SELECT admission_status, COUNT(*) as count
         FROM booth_suppliers WHERE org_id = $1
         GROUP BY admission_status`,
        [orgId]
      ),
      pool.query(
        `SELECT status, COUNT(*) as count
         FROM booth_du_supplier_contracts WHERE org_id = $1
         GROUP BY status`,
        [orgId]
      ),
      pool.query(
        `SELECT COUNT(*) as count
         FROM booth_du_supplier_contracts
         WHERE org_id = $1
           AND status = 'active'
           AND end_date <= CURRENT_DATE + INTERVAL '30 days'
           AND end_date >= CURRENT_DATE`,
        [orgId]
      ),
    ]);

    res.json({
      success: true,
      data: {
        suppliers: supplierStats.rows,
        contracts: contractStats.rows,
        expiring_contracts: parseInt(expiringContracts.rows[0].count),
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
