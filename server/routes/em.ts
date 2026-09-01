import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, type JwtPayload } from '../auth.js';
import { broadcast } from '../sse.js';

const router = Router();

// EM 角色校验中间件：仅 em 角色可访问
function requireEM(req: any, res: any, next: any) {
  if (req.user?.role !== 'em') {
    return res.status(403).json({ success: false, error: 'FORBIDDEN', code: 'EM_ONLY' });
  }
  next();
}

router.use(requireAuth, requireEM);

// [BOOTH-PK-05] 业财闭环 em 只读接入: reconcile 对账 / xcase / vcase 总账(只读, 不挂 close/补录)
import { financeReadonlyRouter } from './finance.js';
router.use('/finance', financeReadonlyRouter);

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

// ============ BOOTH-OPT-01: 产能资源管理 (EM 策略) ============

// 产能资源列表
router.get('/capacity-resources', async (req, res, next) => {
  try {
    const user = getUser(req);
    const { resource_type, status } = req.query;
    let sql = `SELECT * FROM booth_capacity_resources WHERE org_id = $1`;
    const params: any[] = [user.orgId];
    let idx = 2;
    if (resource_type) { sql += ` AND resource_type = $${idx}`; params.push(resource_type); idx++; }
    if (status) { sql += ` AND status = $${idx}`; params.push(status); idx++; }
    sql += ` ORDER BY resource_type, resource_code`;
    const r = await pool.query(sql, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// 创建产能资源
router.post('/capacity-resources', async (req, res, next) => {
  try {
    const user = getUser(req);
    const { resourceCode, resourceName, resourceType, trafficCap, unit, shiftHoursPerDay, efficiencyRate, remark } = req.body;
    const r = await pool.query(
      `INSERT INTO booth_capacity_resources (org_id, resource_code, resource_name, resource_type, traffic_cap, unit, shift_hours_per_day, efficiency_rate, remark)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [user.orgId, resourceCode, resourceName, resourceType || 'line', trafficCap || 0, unit || '件/小时', shiftHoursPerDay || 8, efficiencyRate || 1.0, remark]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// 更新产能资源
router.put('/capacity-resources/:id', async (req, res, next) => {
  try {
    const user = getUser(req);
    const { resourceName, trafficCap, unit, shiftHoursPerDay, efficiencyRate, status, remark } = req.body;
    const r = await pool.query(
      `UPDATE booth_capacity_resources SET resource_name = COALESCE($1, resource_name),
       traffic_cap = COALESCE($2, traffic_cap), unit = COALESCE($3, unit),
       shift_hours_per_day = COALESCE($4, shift_hours_per_day),
       efficiency_rate = COALESCE($5, efficiency_rate), status = COALESCE($6, status),
       remark = COALESCE($7, remark), updated_at = NOW()
       WHERE id = $8 AND org_id = $9 RETURNING *`,
      [resourceName, trafficCap, unit, shiftHoursPerDay, efficiencyRate, status, remark, req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// 删除产能资源
router.delete('/capacity-resources/:id', async (req, res, next) => {
  try {
    const user = getUser(req);
    await pool.query('DELETE FROM booth_capacity_resources WHERE id = $1 AND org_id = $2', [req.params.id, user.orgId]);
    res.json({ success: true });
  } catch (err) { next(err); }
});

// ============ BOOTH-OPT-01: 负荷度计算 ============

// 查询资源负荷度（按资源+时段聚合）
router.get('/capacity-load', async (req, res, next) => {
  try {
    const user = getUser(req);
    const { resource_id, start_date, end_date } = req.query;
    let sql = `SELECT cr.id, cr.resource_code, cr.resource_name, cr.resource_type, cr.traffic_cap, cr.unit,
       cr.shift_hours_per_day, cr.efficiency_rate, cr.status,
       COALESCE(SUM(cl.occupied_qty), 0) as total_load,
       cr.traffic_cap * COALESCE(cr.shift_hours_per_day, 8) * COALESCE(cr.efficiency_rate, 1) as daily_capacity
       FROM booth_capacity_resources cr
       LEFT JOIN booth_capacity_load cl ON cl.resource_id = cr.id`;
    const params: any[] = [user.orgId];
    let idx = 2;
    sql += ` AND cl.org_id = $${idx}`; params.push(user.orgId); idx++;
    if (resource_id) { sql += ` AND cl.resource_id = $${idx}`; params.push(resource_id); idx++; }
    if (start_date) { sql += ` AND cl.slot_date >= $${idx}`; params.push(start_date); idx++; }
    if (end_date) { sql += ` AND cl.slot_date <= $${idx}`; params.push(end_date); idx++; }
    sql += ` WHERE cr.org_id = $1`;
    if (resource_id) { sql += ` AND cr.id = $${idx}`; params.push(resource_id); idx++; }
    sql += ` GROUP BY cr.id ORDER BY cr.resource_type, cr.resource_code`;
    const r = await pool.query(sql, params);
    // 计算负荷率
    const items = r.rows.map((row: any) => {
      const dailyCap = parseFloat(row.daily_capacity) || 1;
      const totalLoad = parseFloat(row.total_load) || 0;
      const loadRate = Math.min(100, Math.round((totalLoad / dailyCap) * 100));
      const remaining = Math.max(0, Math.round(dailyCap - totalLoad));
      return { ...row, load_rate: loadRate, remaining_capacity: remaining, daily_capacity: Math.round(dailyCap) };
    });
    res.json({ success: true, data: { items, total: items.length } });
  } catch (err) { next(err); }
});

// ============ BOOTH-OPT-01: ATP 可承诺量校验 ============

// ATP 校验：给定产品数量，返回可承诺量 + 最早可交付时点
router.post('/atp/check', async (req, res, next) => {
  try {
    const user = getUser(req);
    const { requestedQty, product, startDate } = req.body;
    const qty = requestedQty || 0;

    // 获取所有活跃产能资源的总可用产能
    const resources = await pool.query(
      `SELECT cr.*, COALESCE(
        (SELECT SUM(cl.occupied_qty) FROM booth_capacity_load cl
         WHERE cl.resource_id = cr.id AND cl.org_id = $1
         AND cl.slot_date >= COALESCE($2::date, CURRENT_DATE)
         AND cl.slot_date <= COALESCE($2::date, CURRENT_DATE) + INTERVAL '7 days'),
        0) as current_load
       FROM booth_capacity_resources cr
       WHERE cr.org_id = $1 AND cr.status = 'active'
       ORDER BY cr.resource_type, cr.resource_code`,
      [user.orgId, startDate || new Date().toISOString().slice(0, 10)]
    );

    let totalDailyCap = 0;
    let totalCurrentLoad = 0;
    const resourceDetails: any[] = [];

    for (const res of resources.rows) {
      const dailyCap = Math.round(res.traffic_cap * (res.shift_hours_per_day || 8) * (res.efficiency_rate || 1));
      const load = parseFloat(res.current_load) || 0;
      const remaining = Math.max(0, dailyCap - load);
      totalDailyCap += dailyCap;
      totalCurrentLoad += load;
      resourceDetails.push({
        resource_id: res.id,
        resource_code: res.resource_code,
        resource_name: res.resource_name,
        resource_type: res.resource_type,
        daily_capacity: dailyCap,
        current_load: Math.round(load),
        remaining,
        load_rate: dailyCap > 0 ? Math.min(100, Math.round((load / dailyCap) * 100)) : 0,
      });
    }

    const totalRemaining = Math.max(0, totalDailyCap - totalCurrentLoad);
    const canFulfill = qty <= totalRemaining;

    // 计算最早可交付时点
    let earliestDate: string | null = null;
    let queuePosition = 0;
    if (!canFulfill && totalDailyCap > 0) {
      // 需要排队：计算需要多少天才能完成
      const overflow = qty - totalRemaining;
      const daysNeeded = Math.ceil(overflow / totalDailyCap);
      const baseDate = new Date(startDate || new Date());
      baseDate.setDate(baseDate.getDate() + daysNeeded + 1);
      earliestDate = baseDate.toISOString().slice(0, 10);
      queuePosition = Math.ceil(qty / totalDailyCap);
    } else if (canFulfill) {
      earliestDate = (startDate || new Date().toISOString().slice(0, 10));
    }

    res.json({
      success: true,
      data: {
        requested_qty: qty,
        atp_qty: totalRemaining,
        can_fulfill: canFulfill,
        earliest_date: earliestDate,
        queue_position: queuePosition,
        total_daily_capacity: totalDailyCap,
        total_current_load: Math.round(totalCurrentLoad),
        overall_load_rate: totalDailyCap > 0 ? Math.min(100, Math.round((totalCurrentLoad / totalDailyCap) * 100)) : 0,
        resource_details: resourceDetails,
      },
    });
  } catch (err) { next(err); }
});

// 创建 ATP 承诺记录
router.post('/atp/commit', async (req, res, next) => {
  try {
    const user = getUser(req);
    const { sourceType, sourceId, requestedQty, requestedProduct, atpQty, earliestDate, queuePosition, remark } = req.body;
    const commitNo = `ATP${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const r = await pool.query(
      `INSERT INTO booth_atp_commitments (org_id, commitment_no, source_type, source_id, requested_qty, requested_product, atp_qty, earliest_date, queue_position, remark)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [user.orgId, commitNo, sourceType || 'market_order', sourceId, requestedQty, requestedProduct, atpQty, earliestDate, queuePosition || 0, remark]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ATP 承诺列表
router.get('/atp/commitments', async (req, res, next) => {
  try {
    const user = getUser(req);
    const { status } = req.query;
    let sql = `SELECT * FROM booth_atp_commitments WHERE org_id = $1`;
    const params: any[] = [user.orgId];
    let idx = 2;
    if (status) { sql += ` AND status = $${idx}`; params.push(status); idx++; }
    sql += ` ORDER BY created_at DESC`;
    const r = await pool.query(sql, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// 确认 ATP 承诺
router.post('/atp/commitments/:id/confirm', async (req, res, next) => {
  try {
    const user = getUser(req);
    const r = await pool.query(
      `UPDATE booth_atp_commitments SET status = 'confirmed', confirmed_at = NOW(), confirmed_by = $1, updated_at = NOW()
       WHERE id = $2 AND org_id = $3 AND status = 'pending' RETURNING *`,
      [user.userId, req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot confirm: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// 拒绝 ATP 承诺
router.post('/atp/commitments/:id/reject', async (req, res, next) => {
  try {
    const user = getUser(req);
    const { reason } = req.body;
    const r = await pool.query(
      `UPDATE booth_atp_commitments SET status = 'rejected', remark = COALESCE($1, remark), updated_at = NOW()
       WHERE id = $2 AND org_id = $3 AND status = 'pending' RETURNING *`,
      [reason, req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot reject: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ==================== SGU Catalog (供给目录) ====================

// GET /sgu/catalog - list SGU catalog entries
router.get('/sgu/catalog', async (req: any, res: any, next: any) => {
  try {
    const user = getUser(req);
    const { boothType, status, skuId } = req.query;
    let sql = `SELECT sc.*, s.sku_code, s.name as sku_name, s.unit
               FROM booth_sgu_catalog sc
               JOIN booth_skus s ON s.id = sc.sku_id
               WHERE sc.org_id = $1`;
    const params: any[] = [user.orgId];
    let idx = 2;
    if (boothType) { sql += ` AND sc.booth_type = $${idx++}`; params.push(boothType); }
    if (status) { sql += ` AND sc.status = $${idx++}`; params.push(status); }
    if (skuId) { sql += ` AND sc.sku_id = $${idx++}`; params.push(skuId); }
    sql += ' ORDER BY sc.created_at DESC';
    const r = await pool.query(sql, params);
    res.json({ success: true, data: r.rows });
  } catch (err) { next(err); }
});

// POST /sgu/catalog - create SGU catalog entry (CreateSGU)
router.post('/sgu/catalog', async (req: any, res: any, next: any) => {
  try {
    const user = getUser(req);
    const { skuId, boothType, trafficCap, leadTimeHours, unitPrice, description, capacityResourceId } = req.body;
    if (!skuId || !boothType) return res.status(400).json({ success: false, error: 'skuId and boothType required', code: 'MISSING_PARAM' });
    const sguNo = `SGU-${Date.now().toString(36).toUpperCase()}`;
    const r = await pool.query(
      `INSERT INTO booth_sgu_catalog (org_id, sgu_no, sku_id, booth_type, traffic_cap, lead_time_hours, unit_price, description, capacity_resource_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [user.orgId, sguNo, skuId, boothType, trafficCap || 0, leadTimeHours || 24, unitPrice || 0, description || null, capacityResourceId || null]
    );
    // Publish SGU-Created event
    broadcast(user.orgId, 'sgu.created', { sguId: r.rows[0].id, sguNo, boothType, skuId });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// PUT /sgu/catalog/:id - update SGU catalog entry
router.put('/sgu/catalog/:id', async (req: any, res: any, next: any) => {
  try {
    const user = getUser(req);
    const { trafficCap, leadTimeHours, unitPrice, description, status, capacityResourceId } = req.body;
    const r = await pool.query(
      `UPDATE booth_sgu_catalog SET traffic_cap = COALESCE($1, traffic_cap), lead_time_hours = COALESCE($2, lead_time_hours),
       unit_price = COALESCE($3, unit_price), description = COALESCE($4, description), status = COALESCE($5, status),
       capacity_resource_id = COALESCE($6, capacity_resource_id), updated_at = NOW()
       WHERE id = $7 AND org_id = $8 RETURNING *`,
      [trafficCap, leadTimeHours, unitPrice, description, status, capacityResourceId, req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ==================== SGU Listings (挂牌管理) ====================

// GET /sgu/listings - list listings
router.get('/sgu/listings', async (req: any, res: any, next: any) => {
  try {
    const user = getUser(req);
    const { status } = req.query;
    let sql = `SELECT sl.*, sc.sgu_no, sc.booth_type, s.sku_code, s.name as sku_name, s.unit, sc.unit_price
               FROM booth_sgu_listings sl
               JOIN booth_sgu_catalog sc ON sc.id = sl.sgu_id
               JOIN booth_skus s ON s.id = sc.sku_id
               WHERE sl.org_id = $1`;
    const params: any[] = [user.orgId];
    let idx = 2;
    if (status) { sql += ` AND sl.status = $${idx++}`; params.push(status); }
    sql += ' ORDER BY sl.created_at DESC';
    const r = await pool.query(sql, params);
    res.json({ success: true, data: r.rows });
  } catch (err) { next(err); }
});

// POST /sgu/listings - create listing (挂牌)
router.post('/sgu/listings', async (req: any, res: any, next: any) => {
  try {
    const user = getUser(req);
    const { sguId } = req.body;
    if (!sguId) return res.status(400).json({ success: false, error: 'sguId required', code: 'MISSING_PARAM' });
    const listingNo = `LST-${Date.now().toString(36).toUpperCase()}`;
    const r = await pool.query(
      `INSERT INTO booth_sgu_listings (org_id, sgu_id, listing_no, status, market_visible)
       VALUES ($1, $2, $3, 'pending', FALSE) RETURNING *`,
      [user.orgId, sguId, listingNo]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// PUT /sgu/listings/:id/list - list to market (上架)
router.put('/sgu/listings/:id/list', async (req: any, res: any, next: any) => {
  try {
    const user = getUser(req);
    const r = await pool.query(
      `UPDATE booth_sgu_listings SET status = 'listed', market_visible = TRUE, listed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND status IN ('pending', 'suspended') RETURNING *`,
      [req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot list: invalid state', code: 'INVALID_STATE' });
    // Publish event for Market
    const listing = r.rows[0];
    broadcast(user.orgId, 'sgu.listed', { listingId: listing.id, sguId: listing.sguId });
    res.json({ success: true, data: listing });
  } catch (err) { next(err); }
});

// PUT /sgu/listings/:id/delist - delist from market (下架)
router.put('/sgu/listings/:id/delist', async (req: any, res: any, next: any) => {
  try {
    const user = getUser(req);
    const r = await pool.query(
      `UPDATE booth_sgu_listings SET status = 'delisted', market_visible = FALSE, delisted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND status = 'listed' RETURNING *`,
      [req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot delist: invalid state', code: 'INVALID_STATE' });
    broadcast(user.orgId, 'sgu.delisted', { listingId: r.rows[0].id, sguId: r.rows[0].sguId });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ==================== SGU Pending (SKU-Created 触发待办) ====================

// GET /sgu/pending - list pending SGU creation tasks
router.get('/sgu/pending', async (req: any, res: any, next: any) => {
  try {
    const user = getUser(req);
    const r = await pool.query(
      `SELECT sp.*, s.sku_code, s.name as sku_name, s.unit
       FROM booth_sgu_pending sp
       JOIN booth_skus s ON s.id = sp.sku_id
       WHERE sp.org_id = $1 AND sp.status = 'pending'
       ORDER BY sp.created_at DESC`,
      [user.orgId]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { next(err); }
});

// POST /sgu/pending/:id/create - create SGU from pending task
router.post('/sgu/pending/:id/create', async (req: any, res: any, next: any) => {
  try {
    const user = getUser(req);
    const { boothType, trafficCap, leadTimeHours, unitPrice } = req.body;
    const pending = await pool.query(
      `SELECT * FROM booth_sgu_pending WHERE id = $1 AND org_id = $2 AND status = 'pending'`,
      [req.params.id, user.orgId]
    );
    if (!pending.rows.length) return res.status(400).json({ success: false, error: 'Not found or already resolved', code: 'INVALID_STATE' });
    const p = pending.rows[0];
    const sguNo = `SGU-${Date.now().toString(36).toUpperCase()}`;
    const sgu = await pool.query(
      `INSERT INTO booth_sgu_catalog (org_id, sgu_no, sku_id, booth_type, traffic_cap, lead_time_hours, unit_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [user.orgId, sguNo, p.skuId, boothType || p.suggestedBoothType || 'sundry', trafficCap || 0, leadTimeHours || 24, unitPrice || 0]
    );
    await pool.query(
      `UPDATE booth_sgu_pending SET status = 'created', resolved_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    broadcast(user.orgId, 'sgu.created', { sguId: sgu.rows[0].id, sguNo, skuId: p.skuId });
    res.json({ success: true, data: sgu.rows[0] });
  } catch (err) { next(err); }
});

// POST /sgu/pending/:id/ignore - ignore pending task
router.post('/sgu/pending/:id/ignore', async (req: any, res: any, next: any) => {
  try {
    const user = getUser(req);
    const r = await pool.query(
      `UPDATE booth_sgu_pending SET status = 'ignored', resolved_at = NOW() WHERE id = $1 AND org_id = $2 AND status = 'pending' RETURNING *`,
      [req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Not found or already resolved', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// POST /sgu/trigger-sku-created - simulate SKU-Created event (for testing)
router.post('/sgu/trigger-sku-created', async (req: any, res: any, next: any) => {
  try {
    const user = getUser(req);
    const { skuId, suggestedBoothType } = req.body;
    if (!skuId) return res.status(400).json({ success: false, error: 'skuId required', code: 'MISSING_PARAM' });
    const r = await pool.query(
      `INSERT INTO booth_sgu_pending (org_id, sku_id, source, suggested_booth_type, created_by)
       VALUES ($1, $2, 'sku-created', $3, $4) RETURNING *`,
      [user.orgId, skuId, suggestedBoothType || 'sundry', user.userId]
    );
    broadcast(user.orgId, 'sku.created', { skuId, suggestedBoothType });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ==================== Supply Quotes (供给报价单) ====================

// List supply quotes
router.get('/supply-quotes', requireAuth, requireEM, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { status, sguId, page = '1', pageSize = '20' } = req.query;
    const limit = Math.min(parseInt(pageSize as string) || 20, 100);
    const offset = ((parseInt(page as string) || 1) - 1) * limit;
    let where = `WHERE sq.org_id = $1`;
    const params: any[] = [user.orgId];
    if (status) { params.push(status); where += ` AND sq.status = $${params.length}`; }
    if (sguId) { params.push(sguId); where += ` AND sq.sgu_id = $${params.length}`; }
    params.push(limit, offset);
    const result = await pool.query(
      `SELECT sq.*, s.sku_id as sgu_sku_id, s.booth_type as sgu_booth_type,
              sku.name as sku_name
       FROM booth_supply_quotes sq
       LEFT JOIN booth_sgu_catalog s ON sq.sgu_id = s.id
       LEFT JOIN booth_skus sku ON sq.sku_id = sku.id
       ${where}
       ORDER BY sq.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM booth_supply_quotes sq ${where}`,
      params.slice(0, -2)
    );
    res.json({ success: true, data: { items: result.rows, total: parseInt(countResult.rows[0].count) } });
  } catch (err) { next(err); }
});

// Get supply quote detail
router.get('/supply-quotes/:id', requireAuth, requireEM, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT sq.*, s.sku_id as sgu_sku_id, s.booth_type as sgu_booth_type,
              sku.name as sku_name
       FROM booth_supply_quotes sq
       LEFT JOIN booth_sgu_catalog s ON sq.sgu_id = s.id
       LEFT JOIN booth_skus sku ON sq.sku_id = sku.id
       WHERE sq.id = $1 AND sq.org_id = $2`,
      [req.params.id, user.orgId]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// Create supply quote
router.post('/supply-quotes', requireAuth, requireEM, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { sguId, skuId, bomMaterialCost = 0, laborCost = 0, manufacturingFee = 0, marginRate = 0, effectiveFrom, effectiveTo, notes } = req.body;
    const supplyPrice = Number(bomMaterialCost) + Number(laborCost) + Number(manufacturingFee);
    const grossProfit = supplyPrice * (Number(marginRate) / 100);
    const totalPrice = supplyPrice + grossProfit;
    const quoteNo = `SQ-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const r = await pool.query(
      `INSERT INTO booth_supply_quotes
       (org_id, quote_no, sgu_id, sku_id, bom_material_cost, labor_cost, manufacturing_fee,
        supply_price, margin_rate, gross_profit, total_price, effective_from, effective_to, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING *`,
      [user.orgId, quoteNo, sguId || null, skuId || null, bomMaterialCost, laborCost, manufacturingFee,
       supplyPrice, marginRate, grossProfit, totalPrice, effectiveFrom || null, effectiveTo || null, notes || null, user.userId]
    );
    // Create audit log
    await pool.query(
      `INSERT INTO booth_supply_quote_audit (quote_id, action, actor_id, new_values, reason)
       VALUES ($1, 'created', $2, $3, $4)`,
      [r.rows[0].id, user.userId, JSON.stringify(r.rows[0]), 'Initial creation']
    );
    // Create version snapshot
    await pool.query(
      `INSERT INTO booth_supply_quote_versions (quote_id, version, bom_material_cost, labor_cost, manufacturing_fee, supply_price, margin_rate, gross_profit, total_price, status, changed_by, change_reason)
       VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, 'Initial version')`,
      [r.rows[0].id, bomMaterialCost, laborCost, manufacturingFee, supplyPrice, marginRate, grossProfit, totalPrice, user.userId]
    );
    broadcast(user.orgId, 'supply-quote.created', { quoteId: r.rows[0].id, quoteNo });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// Update supply quote (creates new version)
router.put('/supply-quotes/:id', requireAuth, requireEM, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { bomMaterialCost, laborCost, manufacturingFee, marginRate, effectiveFrom, effectiveTo, notes, changeReason } = req.body;
    // Get current quote
    const current = await pool.query(
      `SELECT * FROM booth_supply_quotes WHERE id = $1 AND org_id = $2`,
      [req.params.id, user.orgId]
    );
    if (!current.rows[0]) return res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' });
    const q = current.rows[0];
    // Calculate new prices
    const newBom = bomMaterialCost !== undefined ? Number(bomMaterialCost) : Number(q.bom_material_cost);
    const newLabor = laborCost !== undefined ? Number(laborCost) : Number(q.labor_cost);
    const newMfg = manufacturingFee !== undefined ? Number(manufacturingFee) : Number(q.manufacturing_fee);
    const newMargin = marginRate !== undefined ? Number(marginRate) : Number(q.margin_rate);
    const newSupplyPrice = newBom + newLabor + newMfg;
    const newGrossProfit = newSupplyPrice * (newMargin / 100);
    const newTotalPrice = newSupplyPrice + newGrossProfit;
    const newVersion = q.version + 1;
    // Update quote
    const r = await pool.query(
      `UPDATE booth_supply_quotes SET
       bom_material_cost = $1, labor_cost = $2, manufacturing_fee = $3,
       supply_price = $4, margin_rate = $5, gross_profit = $6, total_price = $7,
       effective_from = COALESCE($8, effective_from), effective_to = COALESCE($9, effective_to),
       notes = COALESCE($10, notes), version = $11, updated_at = NOW()
       WHERE id = $12 AND org_id = $13 RETURNING *`,
      [newBom, newLabor, newMfg, newSupplyPrice, newMargin, newGrossProfit, newTotalPrice,
       effectiveFrom, effectiveTo, notes, newVersion, req.params.id, user.orgId]
    );
    // Create audit log
    await pool.query(
      `INSERT INTO booth_supply_quote_audit (quote_id, action, actor_id, old_values, new_values, reason)
       VALUES ($1, 'updated', $2, $3, $4, $5)`,
      [q.id, user.userId, JSON.stringify({ version: q.version, supply_price: q.supply_price, total_price: q.total_price }),
       JSON.stringify({ version: newVersion, supply_price: newSupplyPrice, total_price: newTotalPrice }), changeReason || 'Price update']
    );
    // Create version snapshot
    await pool.query(
      `INSERT INTO booth_supply_quote_versions (quote_id, version, bom_material_cost, labor_cost, manufacturing_fee, supply_price, margin_rate, gross_profit, total_price, status, changed_by, change_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [q.id, newVersion, newBom, newLabor, newMfg, newSupplyPrice, newMargin, newGrossProfit, newTotalPrice, q.status, user.userId, changeReason || 'Price update']
    );
    broadcast(user.orgId, 'supply-quote.updated', { quoteId: r.rows[0].id, version: newVersion });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// Approve supply quote
router.post('/supply-quotes/:id/approve', requireAuth, requireEM, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { effectiveFrom, effectiveTo } = req.body;
    const r = await pool.query(
      `UPDATE booth_supply_quotes SET status = 'approved', approved_by = $1, approved_at = NOW(),
       effective_from = COALESCE($2, effective_from, NOW()), effective_to = COALESCE($3, effective_to),
       updated_at = NOW()
       WHERE id = $4 AND org_id = $5 RETURNING *`,
      [user.userId, effectiveFrom, effectiveTo, req.params.id, user.orgId]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' });
    await pool.query(
      `INSERT INTO booth_supply_quote_audit (quote_id, action, actor_id, new_values)
       VALUES ($1, 'approved', $2, $3)`,
      [r.rows[0].id, user.userId, JSON.stringify({ status: 'approved' })]
    );
    broadcast(user.orgId, 'supply-quote.approved', { quoteId: r.rows[0].id });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// Reject supply quote
router.post('/supply-quotes/:id/reject', requireAuth, requireEM, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { reason } = req.body;
    const r = await pool.query(
      `UPDATE booth_supply_quotes SET status = 'rejected', rejection_reason = $1, updated_at = NOW()
       WHERE id = $2 AND org_id = $3 RETURNING *`,
      [reason || null, req.params.id, user.orgId]
    );
    if (!r.rows[0]) return res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' });
    await pool.query(
      `INSERT INTO booth_supply_quote_audit (quote_id, action, actor_id, new_values, reason)
       VALUES ($1, 'rejected', $2, $3, $4)`,
      [r.rows[0].id, user.userId, JSON.stringify({ status: 'rejected' }), reason]
    );
    broadcast(user.orgId, 'supply-quote.rejected', { quoteId: r.rows[0].id });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// Get quote version history
router.get('/supply-quotes/:id/versions', requireAuth, requireEM, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const result = await pool.query(
      `SELECT v.*, u.name as changed_by_name
       FROM booth_supply_quote_versions v
       LEFT JOIN booth_users u ON v.changed_by = u.id
       JOIN booth_supply_quotes sq ON v.quote_id = sq.id
       WHERE v.quote_id = $1 AND sq.org_id = $2
       ORDER BY v.version DESC`,
      [req.params.id, user.orgId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
});

// Get quote audit log
router.get('/supply-quotes/:id/audit', requireAuth, requireEM, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const result = await pool.query(
      `SELECT a.*, u.name as actor_name
       FROM booth_supply_quote_audit a
       LEFT JOIN booth_users u ON a.actor_id = u.id
       JOIN booth_supply_quotes sq ON a.quote_id = sq.id
       WHERE a.quote_id = $1 AND sq.org_id = $2
       ORDER BY a.created_at DESC`,
      [req.params.id, user.orgId]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) { next(err); }
});

export default router;
