import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, type JwtPayload } from '../auth.js';

const router = Router();

// EM 角色校验中间件：仅 em 角色可访问
function requireEM(req: any, res: any, next: any) {
  if (req.user?.role !== 'em') {
    return res.status(403).json({ success: false, error: 'FORBIDDEN', code: 'EM_ONLY' });
  }
  next();
}

router.use(requireAuth, requireEM);

// Helper to get user from request
function getUser(req: any): JwtPayload {
  // @ts-ignore
  return req.user as JwtPayload;
}

// ============ 供应商准入 ============

// 获取供应商准入列表
router.get('/admissions', async (req, res, next) => {
  try {
    const { status, page = '1', pageSize = '20' } = req.query;
    const user = getUser(req);
    const orgId = user.orgId;
    const offset = (Number(page) - 1) * Number(pageSize);
    const limit = Number(pageSize);

    let whereClause = 'WHERE org_id = $1';
    const params: any[] = [orgId];
    let paramIdx = 2;

    if (status && status !== 'all') {
      whereClause += ` AND status = $${paramIdx}`;
      params.push(status);
      paramIdx++;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM booth_em_supplier_admissions ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT * FROM booth_em_supplier_admissions ${whereClause}
       ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    res.json({ success: true, data: { items: dataResult.rows, total, page: Number(page), pageSize: limit } });
  } catch (err) {
    next(err);
  }
});

// 创建供应商准入申请
router.post('/admissions', async (req, res, next) => {
  try {
    const user = getUser(req);
    const orgId = user.orgId;
    const { supplier_name, contact_person, contact_phone, business_license, category, region, remark } = req.body;

    if (!supplier_name) {
      return res.status(400).json({ success: false, error: '供应商名称不能为空', code: 'MISSING_NAME' });
    }

    // 生成供应商编码
    const supplierCode = `SUP-${Date.now().toString(36).toUpperCase()}`;

    const result = await pool.query(
      `INSERT INTO booth_em_supplier_admissions
       (org_id, supplier_code, supplier_name, contact_person, contact_phone, business_license, category, region, remark)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [orgId, supplierCode, supplier_name, contact_person, contact_phone, business_license, category, region, remark]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// 更新供应商准入状态（审核/准入/拒绝/退出）
router.put('/admissions/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, reject_reason, exit_reason, score, level, remark } = req.body;
    const user = getUser(req);
    const userId = user.userId;

    // 验证状态流转合法性
    const validTransitions: Record<string, string[]> = {
      applied: ['reviewed', 'admitted', 'rejected'],
      reviewed: ['admitted', 'rejected'],
      admitted: ['exited'],
      rejected: ['applied'], // 可重新申请
      exited: [],
    };

    const current = await pool.query('SELECT status FROM booth_em_supplier_admissions WHERE id = $1', [id]);
    if (current.rows.length === 0) {
      return res.status(404).json({ success: false, error: '供应商不存在', code: 'NOT_FOUND' });
    }

    const currentStatus = current.rows[0].status;
    if (!validTransitions[currentStatus]?.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `不允许从 ${currentStatus} 转为 ${status}`,
        code: 'INVALID_TRANSITION',
      });
    }

    let updateFields = ['status = $1', 'updated_at = NOW()'];
    const params: any[] = [status];
    let paramIdx = 2;

    if (status === 'reviewed' || status === 'admitted') {
      updateFields.push(`reviewed_at = NOW()`, `reviewed_by = $${paramIdx}`);
      params.push(userId);
      paramIdx++;
    }
    if (status === 'admitted') {
      updateFields.push(`admitted_at = NOW()`);
    }
    if (status === 'rejected' && reject_reason) {
      updateFields.push(`reject_reason = $${paramIdx}`);
      params.push(reject_reason);
      paramIdx++;
    }
    if (status === 'exited' && exit_reason) {
      updateFields.push(`exited_at = NOW()`, `exit_reason = $${paramIdx}`);
      params.push(exit_reason);
      paramIdx++;
    }
    if (score !== undefined) {
      updateFields.push(`score = $${paramIdx}`);
      params.push(score);
      paramIdx++;
    }
    if (level !== undefined) {
      updateFields.push(`level = $${paramIdx}`);
      params.push(level);
      paramIdx++;
    }
    if (remark !== undefined) {
      updateFields.push(`remark = $${paramIdx}`);
      params.push(remark);
      paramIdx++;
    }

    params.push(id);
    const result = await pool.query(
      `UPDATE booth_em_supplier_admissions SET ${updateFields.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      params
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// 删除供应商准入
router.delete('/admissions/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM booth_em_supplier_admissions WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ============ 供给策略 ============

// 获取供给策略列表
router.get('/strategies', async (req, res, next) => {
  try {
    const user = getUser(req);
    const orgId = user.orgId;
    const { is_active } = req.query;

    let whereClause = 'WHERE org_id = $1';
    const params: any[] = [orgId];

    if (is_active !== undefined) {
      whereClause += ' AND is_active = $2';
      params.push(is_active === 'true');
    }

    const result = await pool.query(
      `SELECT * FROM booth_em_supply_strategies ${whereClause} ORDER BY created_at DESC`,
      params
    );

    res.json({ success: true, data: { items: result.rows } });
  } catch (err) {
    next(err);
  }
});

// 创建供给策略
router.post('/strategies', async (req, res, next) => {
  try {
    const user = getUser(req);
    const orgId = user.orgId;
    const { name, description, priority_mode, source_tier, quota_type, quota_value } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, error: '策略名称不能为空', code: 'MISSING_NAME' });
    }

    const result = await pool.query(
      `INSERT INTO booth_em_supply_strategies
       (org_id, name, description, priority_mode, source_tier, quota_type, quota_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [orgId, name, description, priority_mode || 'fifo', source_tier || 'tier1', quota_type || 'fixed', quota_value || 0]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// 更新供给策略
router.put('/strategies/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, priority_mode, source_tier, quota_type, quota_value, is_active } = req.body;

    const result = await pool.query(
      `UPDATE booth_em_supply_strategies
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           priority_mode = COALESCE($3, priority_mode),
           source_tier = COALESCE($4, source_tier),
           quota_type = COALESCE($5, quota_type),
           quota_value = COALESCE($6, quota_value),
           is_active = COALESCE($7, is_active),
           updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [name, description, priority_mode, source_tier, quota_type, quota_value, is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '策略不存在', code: 'NOT_FOUND' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// 删除供给策略
router.delete('/strategies/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM booth_em_supply_strategies WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ============ 产能规划 ============

// 获取产能规划列表
router.get('/capacity-plans', async (req, res, next) => {
  try {
    const user = getUser(req);
    const orgId = user.orgId;
    const { status, page = '1', pageSize = '20' } = req.query;
    const offset = (Number(page) - 1) * Number(pageSize);
    const limit = Number(pageSize);

    let whereClause = 'WHERE org_id = $1';
    const params: any[] = [orgId];
    let paramIdx = 2;

    if (status && status !== 'all') {
      whereClause += ` AND status = $${paramIdx}`;
      params.push(status);
      paramIdx++;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM booth_em_capacity_plans ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT * FROM booth_em_capacity_plans ${whereClause}
       ORDER BY created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    res.json({ success: true, data: { items: dataResult.rows, total, page: Number(page), pageSize: limit } });
  } catch (err) {
    next(err);
  }
});

// 创建产能规划
router.post('/capacity-plans', async (req, res, next) => {
  try {
    const user = getUser(req);
    const orgId = user.orgId;
    const { name, period_type, period_start, period_end, total_capacity } = req.body;

    if (!name || !period_start || !period_end) {
      return res.status(400).json({ success: false, error: '缺少必要参数', code: 'MISSING_FIELDS' });
    }

    const remaining = total_capacity || 0;

    const result = await pool.query(
      `INSERT INTO booth_em_capacity_plans
       (org_id, name, period_type, period_start, period_end, total_capacity, allocated_capacity, remaining_capacity)
       VALUES ($1, $2, $3, $4, $5, $6, 0, $7)
       RETURNING *`,
      [orgId, name, period_type || 'monthly', period_start, period_end, total_capacity || 0, remaining]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// 更新产能规划
router.put('/capacity-plans/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, period_type, period_start, period_end, total_capacity, status } = req.body;

    const result = await pool.query(
      `UPDATE booth_em_capacity_plans
       SET name = COALESCE($1, name),
           period_type = COALESCE($2, period_type),
           period_start = COALESCE($3, period_start),
           period_end = COALESCE($4, period_end),
           total_capacity = COALESCE($5, total_capacity),
           remaining_capacity = COALESCE($5, total_capacity) - allocated_capacity,
           status = COALESCE($6, status),
           updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [name, period_type, period_start, period_end, total_capacity, status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '产能规划不存在', code: 'NOT_FOUND' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// 删除产能规划
router.delete('/capacity-plans/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM booth_em_capacity_plans WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// 获取产能分配明细
router.get('/capacity-plans/:id/allocations', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT * FROM booth_em_capacity_allocations WHERE plan_id = $1 ORDER BY created_at DESC`,
      [id]
    );
    res.json({ success: true, data: { items: result.rows } });
  } catch (err) {
    next(err);
  }
});

// 添加产能分配
router.post('/capacity-plans/:id/allocations', async (req, res, next) => {
  try {
    const planId = Number(req.params.id);
    const { target_type, target_id, target_name, allocated_qty } = req.body;

    if (!target_type || !target_name || !allocated_qty) {
      return res.status(400).json({ success: false, error: '缺少必要参数', code: 'MISSING_FIELDS' });
    }

    // 检查剩余产能
    const plan = await pool.query('SELECT remaining_capacity FROM booth_em_capacity_plans WHERE id = $1', [planId]);
    if (plan.rows.length === 0) {
      return res.status(404).json({ success: false, error: '产能规划不存在', code: 'NOT_FOUND' });
    }

    const remaining = Number(plan.rows[0].remaining_capacity);
    if (remaining < allocated_qty) {
      return res.status(400).json({ success: false, error: `剩余产能不足，当前剩余 ${remaining}`, code: 'INSUFFICIENT_CAPACITY' });
    }

    // 插入分配记录
    const allocResult = await pool.query(
      `INSERT INTO booth_em_capacity_allocations (plan_id, target_type, target_id, target_name, allocated_qty)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [planId, target_type, target_id, target_name, allocated_qty]
    );

    // 更新产能规划的已分配和剩余产能
    await pool.query(
      `UPDATE booth_em_capacity_plans
       SET allocated_capacity = allocated_capacity + $1,
           remaining_capacity = remaining_capacity - $1,
           updated_at = NOW()
       WHERE id = $2`,
      [allocated_qty, planId]
    );

    res.json({ success: true, data: allocResult.rows[0] });
  } catch (err) {
    next(err);
  }
});

// 删除产能分配
router.delete('/capacity-plans/:planId/allocations/:allocId', async (req, res, next) => {
  try {
    const { planId, allocId } = req.params;

    // 获取分配数量以回滚产能
    const alloc = await pool.query(
      'SELECT allocated_qty FROM booth_em_capacity_allocations WHERE id = $1 AND plan_id = $2',
      [allocId, planId]
    );

    if (alloc.rows.length === 0) {
      return res.status(404).json({ success: false, error: '分配记录不存在', code: 'NOT_FOUND' });
    }

    const qty = Number(alloc.rows[0].allocated_qty);

    await pool.query('DELETE FROM booth_em_capacity_allocations WHERE id = $1 AND plan_id = $2', [allocId, planId]);

    // 回滚产能
    await pool.query(
      `UPDATE booth_em_capacity_plans
       SET allocated_capacity = allocated_capacity - $1,
           remaining_capacity = remaining_capacity + $1,
           updated_at = NOW()
       WHERE id = $2`,
      [qty, planId]
    );

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ============ EM 概览统计 ============
router.get('/overview', async (req, res, next) => {
  try {
    const user = getUser(req);
    const orgId = user.orgId;

    const [admissionStats, strategyCount, capacityStats] = await Promise.all([
      pool.query(
        `SELECT status, COUNT(*) as count FROM booth_em_supplier_admissions WHERE org_id = $1 GROUP BY status`,
        [orgId]
      ),
      pool.query(
        `SELECT COUNT(*) as total, SUM(CASE WHEN is_active THEN 1 ELSE 0 END) as active FROM booth_em_supply_strategies WHERE org_id = $1`,
        [orgId]
      ),
      pool.query(
        `SELECT status, COUNT(*) as count, SUM(total_capacity) as total_cap, SUM(allocated_capacity) as alloc_cap
         FROM booth_em_capacity_plans WHERE org_id = $1 GROUP BY status`,
        [orgId]
      ),
    ]);

    res.json({
      success: true,
      data: {
        admissions: admissionStats.rows,
        strategies: strategyCount.rows[0],
        capacity: capacityStats.rows,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
