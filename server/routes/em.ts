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

export default router;
