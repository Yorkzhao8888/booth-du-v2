import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole, requireHat, type JwtPayload } from '../auth.js';
import { broadcast } from '../sse.js';
import { canStationTransition, LEGACY_STATUS_TO_STATE, STATION_EVENT_TO_STATE } from '../services/station-state-machine.js';

const router = Router();

// Helper to get user from request
function getUser(req: any): JwtPayload {
  // @ts-ignore
  return req.user as JwtPayload;
}

// JobType 枚举
const VALID_JOB_TYPES = ['PICK', 'PACK', 'SHIP', 'SERVE', 'PRODUCE', 'RESEARCH']; // [DEV-P2-02] +RESEARCH 研发型 Job (LAB 站配套)

// 8 态状态机
const VALID_STATUSES = ['Pending', 'Dispatched', 'Accepted', 'Running', 'Completed', 'Failed', 'Cancelled', 'Archived'];

// 状态流转规则
const VALID_TRANSITIONS: Record<string, string[]> = {
  Pending: ['Dispatched', 'Cancelled'],
  Dispatched: ['Accepted', 'Cancelled'],
  Accepted: ['Running', 'Cancelled'],
  Running: ['Completed', 'Failed', 'Cancelled'],
  Completed: ['Archived'],
  Failed: ['Pending', 'Archived'], // 可重试回 Pending
  Cancelled: ['Archived'],
  Archived: [], // 终态
};

// ---------------------------------------------------------------------------
// [DEPRECATED - 兼容层] 旧状态(小写) ↔ 新状态(8态大写) 双向映射
// 兼容截止日: 2026-12-31。届时移除需主 Agent 另行裁定（线上存量调用归零后）。
// 约定: 本兼容层保持冻结 — 只读不改，禁止新增依赖此映射的接口/字段。
// 仍在写入旧状态字符串的新代码属于违规，应直接使用 VALID_STATUSES 8 态。
// ---------------------------------------------------------------------------
// 旧状态 → 新状态映射
const OLD_TO_NEW_STATUS: Record<string, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  preparing: 'Running',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

// 新状态 → 旧状态映射（兼容期）
// 注意: 当前代码库内已无消费方（仅作为旧系统对接基线保留）。
const NEW_TO_OLD_STATUS: Record<string, string> = {
  Pending: 'pending',
  Dispatched: 'pending', // Dispatched 在旧系统视为 pending
  Accepted: 'accepted',
  Running: 'preparing',
  Completed: 'completed',
  Failed: 'cancelled', // Failed 在旧系统视为 cancelled
  Cancelled: 'cancelled',
  Archived: 'cancelled',
};

// 生成 job_id
async function generateJobId(orgId: number): Promise<string> {
  const result = await pool.query(
    `SELECT COUNT(*) as cnt FROM booth_work_orders WHERE org_id = $1`,
    [orgId]
  );
  const count = parseInt(result.rows[0].cnt) + 1;
  return `J-${orgId}-${count.toString().padStart(6, '0')}`;
}

// 标准化状态（支持新旧两种写法）
// [DEPRECATED - 兼容层] 兼容截止日: 2026-12-31。归一化入口保持只读冻结，
// 新代码的入参必须直接是 8 态大写；此处仅兜底历史存量的小写状态。
function normalizeStatus(status: string): string {
  // 如果是新状态格式（首字母大写）
  if (VALID_STATUSES.includes(status)) {
    return status;
  }
  // 如果是旧状态格式（全小写）
  if (OLD_TO_NEW_STATUS[status]) {
    return OLD_TO_NEW_STATUS[status];
  }
  return status;
}

// 广播 Job 状态变更
// ===== STATION-01: Station 状态双轨消除 =====
// 旧 status(online/offline/busy) 已弃用, 仅作老数据兼容回退; 新站一律读 state/traffic_cap/offline_mode
const STATION_BLOCKED_STATES = ['provisioning', 'paused', 'down', 'maintenance', 'decommissioned'];
function stationEffectiveState(station: any): string {
  // [DEV-P1-02] 旧 status 兼容回退已下线: 历史行已由 dev-p1-02-migrate 按 LEGACY_STATUS_TO_STATE 回填, state 为单一来源
  return String(station.state || 'provisioning');
}
// active 口径: 旧链路 Dispatched/Accepted + 新链路 accepted/preparing (双链路互见, 防超派)
async function stationActiveCount(db: any, stationId: number): Promise<number> {
  const r = await db.query(
    `SELECT COUNT(*)::int AS cnt FROM booth_work_orders WHERE station_id = $1 AND status IN ('Dispatched','Accepted','accepted','preparing')`,
    [stationId]
  );
  return Number(r.rows[0]?.cnt || 0);
}

function broadcastJobEvent(orgId: number, jobId: string, event: string, data: any) {
  broadcast(orgId, 'job_event', { job_id: jobId, event, ...data });
}

router.use(requireAuth);

// ============ CreateJob ============
// POST /jobs - 创建 Job
router.post('/jobs', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const user = getUser(req);
    const { order_id, type, payload, priority, sla_minutes, product_name, qty, boms } = req.body;

    // 校验 JobType
    if (!VALID_JOB_TYPES.includes(type)) {
      return res.status(400).json({ 
        success: false, 
        error: `Invalid job type: ${type}. Must be one of: ${VALID_JOB_TYPES.join(', ')}`,
        code: 'INVALID_TYPE'
      });
    }

    // FAB 模块允许 PRODUCE / RESEARCH 类型 ([DEV-P2-02] RESEARCH 与 LAB 研发站配套)
    if (!['PRODUCE', 'RESEARCH'].includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Job type ${type} not supported in FAB module. Use /wh, /dl, /svc endpoints.`,
        code: 'INVALID_TYPE_FOR_MODULE'
      });
    }

    await client.query('BEGIN');

    const jobId = await generateJobId(user.orgId);

    const result = await client.query(
      `INSERT INTO booth_work_orders 
       (org_id, job_id, fulfillment_id, job_type, product_name, qty, boms, payload, priority, sla_minutes, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Pending')
       RETURNING *`,
      [
        user.orgId, 
        jobId, 
        order_id || null, 
        type, 
        product_name || 'Job', 
        qty || 1, 
        JSON.stringify(boms || []),
        JSON.stringify(payload || {}), 
        priority || 5, 
        sla_minutes || null
      ]
    );

    await client.query('COMMIT');

    broadcastJobEvent(user.orgId, jobId, 'JobCreated', { type, priority });

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ============ DispatchJob ============
// POST /jobs/:job_id/dispatch - 派单到 Station [DEPRECATED: 建议改走 exx-fab-mes assign-order 新链路; 本接口保留兼容, 已切换 station 新状态机]
// POST /jobs/:job_id/dispatch - 派单到 Station
router.post('/jobs/:job_id/dispatch', requireRole('ex', 'du', 'dx'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const user = getUser(req);
    const { job_id } = req.params;
    const { station_id } = req.body;

    if (!station_id) {
      return res.status(400).json({ success: false, error: 'station_id required', code: 'MISSING_STATION' });
    }

    await client.query('BEGIN');

    // 查询 Job
    const jobResult = await client.query(
      `SELECT * FROM booth_work_orders WHERE job_id = $1 AND org_id = $2 FOR UPDATE`,
      [job_id, user.orgId]
    );

    if (jobResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Job not found', code: 'E_404_JOB' });
    }

    const job = jobResult.rows[0];
    const currentStatus = normalizeStatus(job.status);

    // 校验状态流转
    if (currentStatus !== 'Pending') {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        error: `Cannot dispatch: job is ${currentStatus}, must be Pending`,
        code: 'INVALID_TRANSITION'
      });
    }

    // 查询 Station
    const stationResult = await client.query(
      `SELECT * FROM booth_stations WHERE id = $1 AND org_id = $2`,
      [station_id, user.orgId]
    );

    if (stationResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Station not found', code: 'E_404_STATION' });
    }

    const station = stationResult.rows[0];

    // STATION-01: 统一新状态机判断 (offline_mode/blockedStates/traffic_cap, 与 assign-order 语义一致)
    if (station.offline_mode) {
      await client.query('ROLLBACK');
      return res.status(423).json({
        success: false,
        error: 'Station is in offline mode - no new assignments',
        code: 'E_423_STATION_OFFLINE_MODE'
      });
    }
    const stState = stationEffectiveState(station);
    if (STATION_BLOCKED_STATES.includes(stState)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        error: `Station state '${stState}' cannot accept orders`,
        code: 'E_409_STATION_BLOCKED'
      });
    }
    // 可用产能 = traffic_cap (无则回退 capacity); traffic_cap=0 视为无产能拒绝
    const stCap = Number(station.traffic_cap ?? station.capacity ?? 0);
    const stActive = await stationActiveCount(client, station_id);
    if (stActive >= stCap) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        error: 'Station at capacity',
        code: 'E_409_STATION_AT_CAP',
        data: { capacity: stCap, current: stActive }
      });
    }

    // 更新 Job 状态
    await client.query(
      `UPDATE booth_work_orders 
       SET status = 'Dispatched', station_id = $1, dispatched_at = NOW()
       WHERE id = $2`,
      [station_id, job.id]
    );

    // 更新 Station 负载
    await client.query(
      `UPDATE booth_stations 
       SET current_load = current_load + 1, updated_at = NOW()
       WHERE id = $1`,
      [station_id]
    );

    await client.query('COMMIT');

    const updatedJob = await pool.query('SELECT * FROM booth_work_orders WHERE id = $1', [job.id]);

    broadcastJobEvent(user.orgId, job_id, 'JobDispatched', { station_id, station_name: station.name });

    res.json({ success: true, data: updatedJob.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ============ QueryJob ============
// GET /jobs/:job_id - 查询 Job
router.get('/jobs/:job_id', async (req, res, next) => {
  try {
    const user = getUser(req);
    const { job_id } = req.params;

    const result = await pool.query(
      `SELECT wo.*, s.name as station_name, s.type as station_type, s.status as station_status
       FROM booth_work_orders wo
       LEFT JOIN booth_stations s ON s.id = wo.station_id
       WHERE wo.job_id = $1 AND wo.org_id = $2`,
      [job_id, user.orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Job not found', code: 'E_404_JOB' });
    }

    const job = result.rows[0];
    // 标准化状态
    job.status = normalizeStatus(job.status);

    res.json({ success: true, data: job });
  } catch (err) {
    next(err);
  }
});

// ============ CancelJob ============
// POST /jobs/:job_id/cancel - 取消 Job
router.post('/jobs/:job_id/cancel', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const user = getUser(req);
    const { job_id } = req.params;
    const { reason } = req.body;

    await client.query('BEGIN');

    const jobResult = await client.query(
      `SELECT * FROM booth_work_orders WHERE job_id = $1 AND org_id = $2 FOR UPDATE`,
      [job_id, user.orgId]
    );

    if (jobResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Job not found', code: 'E_404_JOB' });
    }

    const job = jobResult.rows[0];
    const currentStatus = normalizeStatus(job.status);

    // 校验状态流转（Cancelled 可从任意非终态转入）
    if (['Completed', 'Cancelled', 'Archived'].includes(currentStatus)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        error: `Cannot cancel: job is ${currentStatus}`,
        code: 'INVALID_TRANSITION'
      });
    }

    // 如果 Job 已派单，释放 Station 负载
    if (job.station_id) {
      await client.query(
        `UPDATE booth_stations 
         SET current_load = GREATEST(0, current_load - 1),
             updated_at = NOW()
         WHERE id = $1`,
        [job.station_id]
      );
    }

    // 更新 Job 状态
    await client.query(
      `UPDATE booth_work_orders 
       SET status = 'Cancelled', cancel_reason = $1, cancelled_at = NOW()
       WHERE id = $2`,
      [reason || null, job.id]
    );

    await client.query('COMMIT');

    broadcastJobEvent(user.orgId, job_id, 'JobCancelled', { reason });

    res.json({ success: true, data: { job_id, status: 'Cancelled' } });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ============ BatchDispatch ============
// POST /jobs/batch-dispatch - 批量派单
router.post('/jobs/batch-dispatch', requireRole('ex', 'du', 'dx'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const user = getUser(req);
    const { job_ids, station_id, strategy } = req.body;

    if (!Array.isArray(job_ids) || job_ids.length === 0) {
      return res.status(400).json({ success: false, error: 'job_ids array required', code: 'MISSING_JOB_IDS' });
    }

    if (!station_id) {
      return res.status(400).json({ success: false, error: 'station_id required', code: 'MISSING_STATION' });
    }

    await client.query('BEGIN');

    // 查询 Station
    const stationResult = await client.query(
      `SELECT * FROM booth_stations WHERE id = $1 AND org_id = $2 FOR UPDATE`,
      [station_id, user.orgId]
    );

    if (stationResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Station not found', code: 'E_404_STATION' });
    }

    const station = stationResult.rows[0];

    // STATION-01: 统一新状态机判断 (与单笔 dispatch / assign-order 语义一致)
    if (station.offline_mode) {
      await client.query('ROLLBACK');
      return res.status(423).json({ success: false, error: 'Station is in offline mode - no new assignments', code: 'E_423_STATION_OFFLINE_MODE' });
    }
    const stState = stationEffectiveState(station);
    if (STATION_BLOCKED_STATES.includes(stState)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: `Station state '${stState}' cannot accept orders`, code: 'E_409_STATION_BLOCKED' });
    }

    const dispatched: string[] = [];
    const failed: { job_id: string; error: string }[] = [];

    // 按优先级排序（strategy: priority_first）
    const jobsResult = await client.query(
      `SELECT * FROM booth_work_orders 
       WHERE job_id = ANY($1) AND org_id = $2 
       ORDER BY priority DESC, created_at ASC
       FOR UPDATE`,
      [job_ids, user.orgId]
    );

    // STATION-01: 产能口径切换 traffic_cap (回退 capacity), active 双链路在途计数
    const stCap = Number(station.traffic_cap ?? station.capacity ?? 0);
    const stActive = await stationActiveCount(client, station_id);
    let availableCapacity = stCap - stActive;

    for (const job of jobsResult.rows) {
      const currentStatus = normalizeStatus(job.status);

      if (currentStatus !== 'Pending') {
        failed.push({ job_id: job.job_id, error: `Status is ${currentStatus}, must be Pending` });
        continue;
      }

      if (availableCapacity <= 0) {
        failed.push({ job_id: job.job_id, error: 'Station at capacity' });
        continue;
      }

      // 派单
      await client.query(
        `UPDATE booth_work_orders 
         SET status = 'Dispatched', station_id = $1, dispatched_at = NOW()
         WHERE id = $2`,
        [station_id, job.id]
      );

      dispatched.push(job.job_id);
      availableCapacity--;
    }

    // 更新 Station 负载
    if (dispatched.length > 0) {
      await client.query(
        `UPDATE booth_stations 
         SET current_load = current_load + $1,
             updated_at = NOW()
         WHERE id = $2`,
        [dispatched.length, station_id]
      );
    }

    await client.query('COMMIT');

    broadcastJobEvent(user.orgId, '', 'BatchDispatched', { dispatched, failed, station_id });

    res.json({ success: true, data: { dispatched, failed } });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ============ Job 列表 ============
// GET /jobs - 获取 Job 列表
router.get('/jobs', async (req, res, next) => {
  try {
    const user = getUser(req);
    const { status, type, station_id, page = '1', pageSize = '20' } = req.query;
    const offset = (Number(page) - 1) * Number(pageSize);
    const limit = Number(pageSize);

    let whereClause = 'WHERE wo.org_id = $1';
    const params: any[] = [user.orgId];
    let paramIdx = 2;

    if (status && status !== 'all') {
      const normalizedStatus = normalizeStatus(status as string);
      whereClause += ` AND wo.status = $${paramIdx}`;
      params.push(normalizedStatus);
      paramIdx++;
    }

    if (type) {
      whereClause += ` AND wo.job_type = $${paramIdx}`;
      params.push(type);
      paramIdx++;
    }

    if (station_id) {
      whereClause += ` AND wo.station_id = $${paramIdx}`;
      params.push(station_id);
      paramIdx++;
    }

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM booth_work_orders wo ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const dataResult = await pool.query(
      `SELECT wo.*, s.name as station_name, s.type as station_type
       FROM booth_work_orders wo
       LEFT JOIN booth_stations s ON s.id = wo.station_id
       ${whereClause}
       ORDER BY wo.priority DESC, wo.created_at ASC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    // 标准化状态
    const items = dataResult.rows.map(row => ({
      ...row,
      status: normalizeStatus(row.status),
    }));

    res.json({ success: true, data: { items, total, page: Number(page), pageSize: limit } });
  } catch (err) {
    next(err);
  }
});

// ============ Station 管理 ============

// GET /stations - 获取 Station 列表
router.get('/stations', async (req, res, next) => {
  try {
    const user = getUser(req);
    const { type } = req.query;

    let whereClause = 'WHERE org_id = $1';
    const params: any[] = [user.orgId];

    if (type) {
      whereClause += ' AND type = $2';
      params.push(type);
    }

    const result = await pool.query(
      `SELECT * FROM booth_stations ${whereClause} ORDER BY name`,
      params
    );

    res.json({ success: true, data: { items: result.rows } });
  } catch (err) {
    next(err);
  }
});

// POST /stations - 创建 Station [DEV-P2-01] 类型扩展五类(+LAB), 编码 {org}.{ZONE}.{STATION_TYPE}-{seq:03d}
const STATION_TYPES = ['FAB', 'WH', 'DL', 'SVC', 'LAB'];
// [DEV-P2-01] 域推导: LAB(研发)->lab; FAB(生产)->shop; WH/SVC/DL(生态作业)->booth
const TYPE_TO_BUSINESS: Record<string, string> = { FAB: 'shop', LAB: 'lab', WH: 'booth', SVC: 'booth', DL: 'booth' };
// [DEV-P1-01 约束映射] dimension <-> business_type 合法组合 (与 chk_stations_dimension_business 同源)
const DIMENSION_BIZ: Record<string, string[]> = {
  workstation: ['shop', 'booth', 'lab'],
  point: ['plaz'],
  case_station: ['case'],
};

router.post('/stations', requireRole('ex', 'du', 'dx'), async (req, res, next) => {
  try {
    const user = getUser(req);
    const { type, name, capacity, station_type: stationTypeIn, dimension: dimIn, business_type: bizIn } = req.body;

    if (!STATION_TYPES.includes(type)) {
      return res.status(400).json({ success: false, error: 'Invalid station type', code: 'INVALID_TYPE' });
    }

    const stType = String(stationTypeIn || 'manual').toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,19}$/.test(stType)) {
      return res.status(400).json({ success: false, error: 'Invalid station_type', code: 'INVALID_TYPE' });
    }

    const dimension = dimIn || 'workstation';
    const businessType = bizIn || TYPE_TO_BUSINESS[type] || 'shop';

    // [DEV-P2-02] 各站特有可选字段 (09-02 裁定: 可选字段进 Station 实体, 不新增独立实体)
    // 白名单: WH->batch | DL->route,batch | SVC->after_sales_type | LAB->lab_record; 非本类字段忽略(置 null)
    const EXTRA_ALLOWED: Record<string, string[]> = { WH: ['batch'], DL: ['route', 'batch'], SVC: ['after_sales_type'], LAB: ['lab_record'] };
    const allowed = EXTRA_ALLOWED[type] || [];
    const pickExtra = (k: string): string | null => (allowed.includes(k) && req.body?.[k] != null ? String(req.body[k]) : null);
    if (!DIMENSION_BIZ[dimension] || !DIMENSION_BIZ[dimension].includes(businessType)) {
      return res.status(400).json({ success: false, error: `Invalid dimension/business_type combo: ${dimension}/${businessType}`, code: 'INVALID_DIMENSION_COMBO' });
    }

    // 编码: {org_id}.{ZONE}.{STATION_TYPE}-{seq:03d}, seq 取同前缀最大值续号 (FAB-MES-05 口径)
    const prefix = `${user.orgId}.${String(type).toUpperCase()}.${stType}-`;
    const last = await pool.query(
      `SELECT code FROM booth_stations WHERE org_id = $1 AND code LIKE $2 ORDER BY code DESC LIMIT 1`,
      [user.orgId, prefix + '%']
    );
    let seq = 1;
    if (last.rows[0]?.code) {
      const m = String(last.rows[0].code).match(/-(\d{3,})$/);
      if (m) seq = parseInt(m[1], 10) + 1;
    }
    const code = `${prefix}${String(seq).padStart(3, '0')}`;

    try {
      const result = await pool.query(
        `INSERT INTO booth_stations (org_id, type, zone_type, station_type, name, capacity, code, dimension, business_type, batch, route, after_sales_type, lab_record)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [user.orgId, type, String(type).toUpperCase(), stType, name, capacity || 1, code, dimension, businessType,
         pickExtra('batch'), pickExtra('route'), pickExtra('after_sales_type'), pickExtra('lab_record')]
      );
      res.json({ success: true, data: result.rows[0] });
    } catch (e: any) {
      if (e?.code === '23505') {
        return res.status(409).json({ success: false, error: 'Station code conflict (unique idx_stations_org_code)', code: 'E_409_STATION_CODE' });
      }
      if (e?.code === '23514') {
        return res.status(400).json({ success: false, error: 'dimension/business_type combo rejected by chk_stations_dimension_business', code: 'INVALID_DIMENSION_COMBO' });
      }
      throw e;
    }
  } catch (err) {
    next(err);
  }
});

// PUT /stations/:id/status - 更新 Station 状态
router.put('/stations/:id/status', requireRole('ex', 'du', 'dx'), async (req, res, next) => {
  try {
    const user = getUser(req);
    const { id } = req.params;
    const { status } = req.body;

    if (!['online', 'offline', 'busy'].includes(status)) {
      return res.status(400).json({ success: false, error: 'Invalid status', code: 'INVALID_STATUS' });
    }

    const result = await pool.query(
      `UPDATE booth_stations SET status = $1, updated_at = NOW()
       WHERE id = $2 AND org_id = $3
       RETURNING *`,
      [status, id, user.orgId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Station not found', code: 'E_404_STATION' });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ============ Station Callback ============
// POST /station/callback - Station 回调端点
router.post('/station/callback', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { job_id, station_id, status, result, error } = req.body;

    // 校验必要参数
    if (!job_id || !station_id || !status) {
      return res.status(400).json({ 
        success: false, 
        error: 'job_id, station_id, status required',
        code: 'MISSING_PARAMS'
      });
    }

    await client.query('BEGIN');

    // 查询 Job
    const jobResult = await client.query(
      `SELECT * FROM booth_work_orders WHERE job_id = $1 FOR UPDATE`,
      [job_id]
    );

    if (jobResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Job not found', code: 'E_404_JOB' });
    }

    const job = jobResult.rows[0];

    // 校验 station_id 匹配
    if (job.station_id !== station_id) {
      await client.query('ROLLBACK');
      return res.status(403).json({ 
        success: false, 
        error: 'Station mismatch',
        code: 'E_403_STATION_MISMATCH'
      });
    }

    // 处理回调事件
    const validEvents = ['JobAccepted', 'JobRunning', 'JobCompleted', 'JobFailed'];
    if (!validEvents.includes(status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        error: `Invalid event: ${status}. Must be one of: ${validEvents.join(', ')}`,
        code: 'INVALID_EVENT'
      });
    }

    // 映射事件到状态
    const eventToStatus: Record<string, string> = {
      JobAccepted: 'Accepted',
      JobRunning: 'Running',
      JobCompleted: 'Completed',
      JobFailed: 'Failed',
    };

    const newStatus = eventToStatus[status];
    const currentStatus = normalizeStatus(job.status);

    // 校验状态流转
    if (!VALID_TRANSITIONS[currentStatus]?.includes(newStatus)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        error: `Invalid transition: ${currentStatus} → ${newStatus}`,
        code: 'INVALID_TRANSITION'
      });
    }

    // 更新 Job
    const updateFields: string[] = [`status = '${newStatus}'`];
    if (newStatus === 'Running') updateFields.push('started_at = NOW()');
    if (newStatus === 'Completed') updateFields.push('completed_at = NOW()');
    if (newStatus === 'Failed') {
      updateFields.push('failed_at = NOW()');
      if (error) updateFields.push(`failure_reason = '${error.replace(/'/g, "''")}'`);
    }
    if (result) updateFields.push(`payload = payload || '{"result": ${JSON.stringify(result)}}'`);

    await client.query(
      `UPDATE booth_work_orders SET ${updateFields.join(', ')} WHERE id = $1`,
      [job.id]
    );

    // 如果完成或失败，释放 Station 负载
    if (['Completed', 'Failed'].includes(newStatus)) {
      await client.query(
        `UPDATE booth_stations 
         SET current_load = GREATEST(0, current_load - 1),
             updated_at = NOW()
         WHERE id = $1`,
        [station_id]
      );
    }

    // [DEV-P1-02] Station-OS 回调事件联动站点新状态机 (state 单一来源; 非法流转记 deviation 不阻断回调)
    const evtStationState = STATION_EVENT_TO_STATE[newStatus] ?? STATION_EVENT_TO_STATE[status]; // [fix] 回调入参原始事件名与内部映射值双查
    if (evtStationState) {
      const stq = await client.query(`SELECT state FROM booth_stations WHERE id = $1 FOR UPDATE`, [station_id]);
      const curSt = stq.rows[0] ? String(stq.rows[0].state || 'provisioning') : null;
      if (curSt && evtStationState !== curSt) {
        let finalTarget = evtStationState;
        if (newStatus === 'Completed') {
          const active = await stationActiveCount(client, station_id); // 减载后在途单, 仍有单保持 busy
          if (active > 0) finalTarget = 'busy';
        }
        if (canStationTransition(curSt, finalTarget)) {
          await client.query(`UPDATE booth_stations SET state = $1, updated_at = NOW() WHERE id = $2`, [finalTarget, station_id]);
        } else {
          await client.query(
            `UPDATE booth_stations SET metadata = COALESCE(metadata,'{}'::jsonb) || $1::jsonb WHERE id = $2`,
            [JSON.stringify({ last_transition_skipped: { event: newStatus, from: curSt, to: finalTarget, at: new Date().toISOString() } }), station_id]
          );
        }
      }
    }

    await client.query('COMMIT');

    broadcastJobEvent(job.org_id, job_id, status, { result, error });

    res.json({ success: true, data: { job_id, status: newStatus } });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// ===========================================================================
// [DEPRECATED - 兼容层] 旧版 accept/start/complete 三段式直改接口
// 兼容截止日: 2026-12-31。届时下线需主 Agent 另行裁定（先确认线上调用归零）。
// 约定:
//   - 三个接口仅保留现状行为，冻结不改、不扩展（禁止新增字段/状态分支）
//   - 新代码一律走标准状态机接口（带 VALID_TRANSITIONS 校验的主路径）
//   - 与旧状态映射(NEW_TO_OLD_STATUS)同批评估移除
// ===========================================================================
// ============ 兼容旧 API 的状态转换 ============

// POST /jobs/:job_id/accept - [DEPRECATED] 兼容旧 accept 接口，截止 2026-12-31
router.post('/jobs/:job_id/accept', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const user = getUser(req);
    const { job_id } = req.params;

    await client.query('BEGIN');

    const jobResult = await client.query(
      `SELECT * FROM booth_work_orders WHERE job_id = $1 AND org_id = $2 FOR UPDATE`,
      [job_id, user.orgId]
    );

    if (jobResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Job not found', code: 'E_404_JOB' });
    }

    const job = jobResult.rows[0];
    const currentStatus = normalizeStatus(job.status);

    if (currentStatus !== 'Dispatched') {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        error: `Cannot accept: job is ${currentStatus}, must be Dispatched`,
        code: 'INVALID_TRANSITION'
      });
    }

    await client.query(
      `UPDATE booth_work_orders 
       SET status = 'Accepted', accepted_by = $1, accepted_at = NOW()
       WHERE id = $2`,
      [user.userId, job.id]
    );

    await client.query('COMMIT');

    broadcastJobEvent(user.orgId, job_id, 'JobAccepted', { operator_id: user.userId });

    res.json({ success: true, data: { job_id, status: 'Accepted' } });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// POST /jobs/:job_id/start - [DEPRECATED] 兼容旧 start 接口，截止 2026-12-31
router.post('/jobs/:job_id/start', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const user = getUser(req);
    const { job_id } = req.params;

    await client.query('BEGIN');

    const jobResult = await client.query(
      `SELECT * FROM booth_work_orders WHERE job_id = $1 AND org_id = $2 FOR UPDATE`,
      [job_id, user.orgId]
    );

    if (jobResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Job not found', code: 'E_404_JOB' });
    }

    const job = jobResult.rows[0];
    const currentStatus = normalizeStatus(job.status);

    if (currentStatus !== 'Accepted') {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        error: `Cannot start: job is ${currentStatus}, must be Accepted`,
        code: 'INVALID_TRANSITION'
      });
    }

    await client.query(
      `UPDATE booth_work_orders 
       SET status = 'Running', operator_id = $1, started_at = NOW()
       WHERE id = $2`,
      [user.userId, job.id]
    );

    await client.query('COMMIT');

    broadcastJobEvent(user.orgId, job_id, 'JobRunning', { operator_id: user.userId });

    res.json({ success: true, data: { job_id, status: 'Running' } });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// POST /jobs/:job_id/complete - [DEPRECATED] 兼容旧 complete 接口，截止 2026-12-31
router.post('/jobs/:job_id/complete', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const user = getUser(req);
    const { job_id } = req.params;

    await client.query('BEGIN');

    const jobResult = await client.query(
      `SELECT * FROM booth_work_orders WHERE job_id = $1 AND org_id = $2 FOR UPDATE`,
      [job_id, user.orgId]
    );

    if (jobResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Job not found', code: 'E_404_JOB' });
    }

    const job = jobResult.rows[0];
    const currentStatus = normalizeStatus(job.status);

    if (currentStatus !== 'Running') {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        error: `Cannot complete: job is ${currentStatus}, must be Running`,
        code: 'INVALID_TRANSITION'
      });
    }

    await client.query(
      `UPDATE booth_work_orders 
       SET status = 'Completed', completed_at = NOW(), progress = 100
       WHERE id = $1`,
      [job.id]
    );

    // 释放 Station 负载
    if (job.station_id) {
      await client.query(
        `UPDATE booth_stations 
         SET current_load = GREATEST(0, current_load - 1),
             updated_at = NOW()
         WHERE id = $1`,
        [job.station_id]
      );
    }

    await client.query('COMMIT');

    broadcastJobEvent(user.orgId, job_id, 'JobCompleted', {});

    res.json({ success: true, data: { job_id, status: 'Completed' } });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

export default router;
export { normalizeStatus, VALID_STATUSES, VALID_JOB_TYPES, VALID_TRANSITIONS };
