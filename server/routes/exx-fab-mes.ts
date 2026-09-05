/**
 * exx FAB-MES 路由 (TECH-DEBT-1 从 exx-modules.ts 拆出)
 * 覆盖: Station-OS 产线/作业站融合(FAB-MES-05) / 产线视角 / 设备台账+OEE(FAB-MES-01) / 保养 / 安灯异常中心(FAB-MES-03)
 * 挂载: /api/booth/exx (见 exx-modules.ts 聚合)
 * 红线: Agent invoke 不越过 LoRA 的「门」(door authority stays with LoRA)
 */
import { Router } from 'express';
import { emitAudit } from '../services/audit-service.js'; // [BOOTH-R7-03]
import { pool } from '../db.js';
import { canStationTransition } from '../services/station-state-machine.js';
import { requireHat } from '../auth.js';
import type { JwtPayload } from '../auth.js';
import { broadcast } from '../sse.js';
import { createAndonEvent, andonStats } from '../services/andon-service.js';
import { stripPriceFields } from '../services/fulfillment-service.js';

const router = Router();

// ====== FAB-MES-03-FIX3 / FAB-MES-04-FIX4: 管理角色产线只读放行 ======
// requireFabRead: FAB 帽全权; du/dx/ex/dm/em 管理角色仅放行只读(GET/HEAD), 写操作回落 requireHat('FAB')
// 导出供 exx-fab-trace.ts 复用 (FAB-MES-02)
export const FAB_READ_MANAGER_ROLES = ['du', 'dx', 'ex', 'dm', 'em'];
export const requireFabRead: any = (req: any, res: any, next: any) => {
  const user = (req as any).user as JwtPayload | undefined;
  const method = (req.method || '').toUpperCase();
  if (user && FAB_READ_MANAGER_ROLES.includes(user.role) && (method === 'GET' || method === 'HEAD')) {
    return next();
  }
  return requireHat('FAB')(req, res, next);
};
// X 层(ex/exx)只读时剥离价格字段; du/dx/dm 可看全量 (价格边界红线)
const stripFabReadFor = (user: JwtPayload, data: unknown): unknown => {
  if (user && ['ex', 'exx'].includes(user.role)) return stripPriceFields(data as any);
  return data;
};

// ====== FAB-MES-05: Station-OS 产线/作业站融合 ======

// 7. GET /exx/fab/stations: Station 列表
router.get('/fab/stations', requireFabRead, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { zone_type, station_type, state } = req.query;
    let sql = `SELECT s.* FROM booth_stations s WHERE s.org_id = $1`;
    const params: any[] = [user.orgId];
    if (zone_type) { params.push(zone_type); sql += ` AND s.zone_type = $${params.length}`; }
    if (station_type) { params.push(station_type); sql += ` AND s.station_type = $${params.length}`; }
    if (state) { params.push(state); sql += ` AND s.state = $${params.length}`; }
    sql += ` ORDER BY s.code ASC`;
    const r = await pool.query(sql, params);
    // 附加当前作业数
    const stations = [];
    for (const st of r.rows) {
      const wos = await pool.query(
        `SELECT COUNT(*) as cnt FROM booth_work_orders WHERE station_id = $1 AND status IN ('accepted','preparing')`,
        [st.id]
      );
      const { status: _legacyStatus, ...stationFields } = st; // [DEV-P1-02] 旧 status 下线, 响应不回传
      // [BOOTH-LINK-01 任务B] X-Dyard(Plaz) 站位映射: plaz_id 存 stationCode, 语义字段带出 (null=Booth 自建站)
      stations.push({ ...stationFields, plaz_station_code: st.plaz_id ?? null, active_orders: parseInt(wos.rows[0]?.cnt || '0') });
    }
    res.json({ success: true, data: { items: stations, total: stations.length } });
  } catch (err) { next(err); }
});

// 8. GET /exx/fab/stations/:id: 单站详情
router.get('/fab/stations/:id', requireFabRead, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { id } = req.params;
    const st = await pool.query(
      `SELECT * FROM booth_stations WHERE id = $1 AND org_id = $2`,
      [id, user.orgId]
    );
    if (st.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Station not found' });
    }
    const { status: _legacyStatus, ...station } = st.rows[0]; // [DEV-P1-02] 旧 status 下线, 响应不回传
    // 当前作业队列
    const queue = await pool.query(
      `SELECT wo.id, wo.job_id, wo.status, wo.priority, wo.qty, wo.accepted_at, wo.completed_at,
              wo.product_name
       FROM booth_work_orders wo
       WHERE wo.station_id = $1 AND wo.status NOT IN ('completed','cancelled','archived')
       ORDER BY wo.priority DESC, wo.accepted_at ASC`,
      [id]
    );
    // Agent 部署位 (从 metadata.agent_ids 读取)
    const metadata = station.metadata || {};
    const agentIds = metadata.agent_ids || [];
    const agents = [];
    for (const aid of agentIds) {
      agents.push({ agent_id: aid, status: 'registered', deployed_at: null });
    }
    // 设备挂载 (FAB-MES-01 预留): booth_devices 中 station_id 关联
    let devices: any[] = [];
    try {
      const dev = await pool.query(
        `SELECT id, device_name, serial_no, status FROM booth_devices WHERE station_id = $1`,
        [id]
      );
      devices = dev.rows;
    } catch { /* table may not exist yet */ }
    res.json({
      success: true,
      data: {
        ...station,
        plaz_station_code: station.plaz_id ?? null, // [BOOTH-LINK-01 任务B] X-Dyard 站位映射语义字段
        queue: queue.rows,
        agents,
        devices,
        andon_events: [], // FAB-MES-03 预留
      },
    });
  } catch (err) { next(err); }
});

// 1. POST /exx/fab/station/:id/assign-order: Station 接单
router.post('/fab/station/:id/assign-order', requireHat('FAB'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { id } = req.params;
    const { work_order_id } = req.body || {};
    if (!work_order_id) {
      return res.status(400).json({ success: false, message: 'work_order_id is required' });
    }
    const st = await pool.query(
      `SELECT * FROM booth_stations WHERE id = $1 AND org_id = $2`,
      [id, user.orgId]
    );
    if (st.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Station not found' });
    }
    const station = st.rows[0];
    // 离线模式: 不授予新权限(不可接收新作业)
    if (station.offline_mode) {
      return res.status(423).json({ success: false, message: 'Station is in offline mode - no new assignments (door authority stays with LoRA)' });
    }
    // 状态检查: provisioning/paused/down/maintenance/decommissioned 不可接单
    const blockedStates = ['provisioning', 'paused', 'down', 'maintenance', 'decommissioned'];
    if (blockedStates.includes(station.state)) {
      return res.status(409).json({ success: false, message: `Station state '${station.state}' cannot accept orders` });
    }
    // traffic_cap 容量检查
    const activeCount = await pool.query(
      `SELECT COUNT(*) as cnt FROM booth_work_orders WHERE station_id = $1 AND status IN ('accepted','preparing')`,
      [id]
    );
    const active = parseInt(activeCount.rows[0]?.cnt || '0');
    const cap = Number(station.traffic_cap || station.capacity || 0);
    if (cap > 0 && active >= cap) {
      return res.status(409).json({
        success: false,
        message: 'Station at capacity',
        data: { capacity: cap, current: active },
      });
    }
    // 派单
    const wo = await pool.query(
      // [DEV-P2-02] 大小写不敏感匹配: job.ts 8 态状态机写 'Pending', FAB 历史口径为 'pending'
      `UPDATE booth_work_orders SET station_id = $1, status = 'accepted', accepted_at = NOW()
       WHERE id = $2 AND org_id = $3 AND LOWER(status) = 'pending' RETURNING *`,
      [id, work_order_id, user.orgId]
    );
    if (wo.rows.length === 0) {
      return res.status(409).json({ success: false, message: 'Work order not available for assignment' });
    }
    // 更新站状态为 busy + current_load
    await pool.query(
      `UPDATE booth_stations SET state = 'busy', current_load = current_load + 1, updated_at = NOW() WHERE id = $1`,
      [id]
    );
    // SSE 通知 ([BOOTH-LINK-01 任务B] 附 X-Dyard stationCode, Plaz 侧可见 Booth 作业)
    broadcast(user.orgId, 'station.assigned', { station_id: Number(id), work_order_id, active: active + 1, cap, plaz_station_code: station.plaz_id ?? null });

    // [BOOTH-R7-03] 任务指派 → OAS 审计
    emitAudit({ actor: `${user.role}:${user.identity_id}`, action: 'station.assign_order', resource: 'station', resourceId: String(id), result: 'success', detail: { work_order_id, job_type: wo.rows[0]?.job_type, station_code: station.code, plaz_station_code: station.plaz_id ?? null } }, user.orgId,);
    res.json({ success: true, data: { station_id: Number(id), work_order_id, active: active + 1, cap } });
  } catch (err) { next(err); }
});

// 2. POST /exx/fab/station/:id/report-status: 站状态上报
router.post('/fab/station/:id/report-status', requireHat('FAB'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { id } = req.params;
    const { state, reason, traffic_cap } = req.body || {};
    const validStates = ['run', 'idle', 'paused', 'down', 'maintenance', 'decommissioned']; // [DEV-P1-02] decommissioned 供流转校验(报废语义), 非法流转返回 INVALID_TRANSITION
    if (!validStates.includes(state)) {
      return res.status(400).json({ success: false, message: `Invalid state, must be one of: ${validStates.join('/')}` });
    }
    // run → busy 映射 (A1.35 report_status 用 run, 内部 state 机用 busy)
    const internalState = state === 'run' ? 'busy' : state;
    const st = await pool.query(
      `SELECT * FROM booth_stations WHERE id = $1 AND org_id = $2`,
      [id, user.orgId]
    );
    if (st.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Station not found' });
    }
    const oldState = st.rows[0].state;
    // [DEV-P1-02] 状态机流转合法性校验 (self 上报 no-op 放行)
    if (!canStationTransition(oldState, internalState)) {
      return res.status(400).json({ success: false, code: 'INVALID_TRANSITION', message: `INVALID_TRANSITION: station state '${oldState}' -> '${internalState}' not allowed` });
    }
    const newCap = traffic_cap !== undefined ? Number(traffic_cap) : Number(st.rows[0].traffic_cap || st.rows[0].capacity || 0);
    await pool.query(
      `UPDATE booth_stations SET state = $1, traffic_cap = $2, metadata = metadata || $3::jsonb, updated_at = NOW() WHERE id = $4`,
      [internalState, newCap, JSON.stringify({ last_status_reason: reason || '', last_status_at: new Date().toISOString() }), id]
    );
    // 状态变更记录到 metadata
    const prevMeta = (st.rows[0].metadata || {}) as any;
    const stateHistory = [...(prevMeta.state_history || []).slice(-49), { from: oldState, to: internalState, reason: reason || '', at: new Date().toISOString() }];
    await pool.query(
      `UPDATE booth_stations SET metadata = metadata || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ state_history: stateHistory }), id]
    );
    broadcast(user.orgId, 'station.status', { station_id: Number(id), from: oldState, to: internalState, traffic_cap: newCap, plaz_station_code: st.rows[0].plaz_id ?? null });
    res.json({ success: true, data: { station_id: Number(id), from: oldState, to: internalState, traffic_cap: newCap } });
  } catch (err) { next(err); }
});

// 3. POST /exx/fab/station/:id/deploy-agent: 部署 Agent (占位待 LoRA, 仅登记)
router.post('/fab/station/:id/deploy-agent', requireHat('FAB'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { id } = req.params;
    const { agent_id } = req.body || {};
    if (!agent_id) {
      return res.status(400).json({ success: false, message: 'agent_id is required' });
    }
    const st = await pool.query(
      `SELECT * FROM booth_stations WHERE id = $1 AND org_id = $2`,
      [id, user.orgId]
    );
    if (st.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Station not found' });
    }
    const metadata = st.rows[0].metadata || {};
    const agentIds: string[] = metadata.agent_ids || [];
    if (!agentIds.includes(agent_id)) {
      agentIds.push(agent_id);
    }
    await pool.query(
      `UPDATE booth_stations SET metadata = metadata || $1::jsonb, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify({ agent_ids: agentIds }), id]
    );
    broadcast(user.orgId, 'station.agent_deployed', { station_id: Number(id), agent_id, status: 'registered' });
    res.json({ success: true, data: { station_id: Number(id), agent_id, status: 'registered', note: 'LoRA gateway not connected - registration only (door authority stays with LoRA)' } });
  } catch (err) { next(err); }
});

// 4. POST /exx/fab/station/:id/invoke-agent: 调用 Agent (占位待 LoRA, 必须过 access_token 鉴权)
router.post('/fab/station/:id/invoke-agent', requireHat('FAB'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { id } = req.params;
    const { agent_id, access_token } = req.body || {};
    if (!agent_id) {
      return res.status(400).json({ success: false, message: 'agent_id is required' });
    }
    // 铁律: 不越过 LoRA 的「门」— invoke 必须过 access_token 鉴权
    if (!access_token) {
      return res.status(401).json({ success: false, message: 'access_token required - LoRA gateway authentication (door authority stays with LoRA)' });
    }
    const st = await pool.query(
      `SELECT * FROM booth_stations WHERE id = $1 AND org_id = $2`,
      [id, user.orgId]
    );
    if (st.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Station not found' });
    }
    const agentIds: string[] = ((st.rows[0].metadata || {}).agent_ids) || [];
    if (!agentIds.includes(agent_id)) {
      return res.status(404).json({ success: false, message: 'Agent not deployed on this station' });
    }
    // 本期 LoRA 未接入: 返回占位响应, 不直连
    res.status(501).json({
      success: false,
      message: 'LoRA gateway not connected - invoke is a placeholder. Direct connection to Agent bypassing LoRA gateway is forbidden.',
      data: { station_id: Number(id), agent_id, status: 'not_implemented' },
    });
  } catch (err) { next(err); }
});

// 5. POST /exx/fab/station/:id/report-agent-status: Agent 状态上报
router.post('/fab/station/:id/report-agent-status', requireHat('FAB'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { id } = req.params;
    const { agent_id, status } = req.body || {};
    if (!agent_id || !status) {
      return res.status(400).json({ success: false, message: 'agent_id and status are required' });
    }
    const st = await pool.query(
      `SELECT * FROM booth_stations WHERE id = $1 AND org_id = $2`,
      [id, user.orgId]
    );
    if (st.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Station not found' });
    }
    const metadata = st.rows[0].metadata || {};
    const agentIds: string[] = metadata.agent_ids || [];
    if (!agentIds.includes(agent_id)) {
      return res.status(404).json({ success: false, message: 'Agent not deployed on this station' });
    }
    const agentStatuses = metadata.agent_statuses || {};
    agentStatuses[agent_id] = { status, reported_at: new Date().toISOString() };
    await pool.query(
      `UPDATE booth_stations SET metadata = metadata || $1::jsonb WHERE id = $2`,
      [JSON.stringify({ agent_statuses: agentStatuses }), id]
    );
    broadcast(user.orgId, 'station.agent_status', { station_id: Number(id), agent_id, status });
    res.json({ success: true, data: { station_id: Number(id), agent_id, status } });
  } catch (err) { next(err); }
});

// 6. POST /exx/fab/station/:id/fault: 故障上报 → 按 fault_strategy 传播
router.post('/fab/station/:id/fault', requireHat('FAB'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { id } = req.params;
    const { reason, strategy } = req.body || {};
    if (!reason) {
      return res.status(400).json({ success: false, message: 'reason is required' });
    }
    const st = await pool.query(
      `SELECT * FROM booth_stations WHERE id = $1 AND org_id = $2`,
      [id, user.orgId]
    );
    if (st.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Station not found' });
    }
    const station = st.rows[0];
    const fs = strategy || station.fault_strategy || 'bypass';
    if (!['stop_all', 'bypass', 'continue'].includes(fs)) {
      return res.status(400).json({ success: false, message: 'Invalid fault_strategy' });
    }
    let affectedOrders = 0;
    let newCap = Number(station.traffic_cap || station.capacity || 0);
    let newState = station.state;
    if (fs === 'stop_all') {
      // 停该站全部作业
      const r = await pool.query(
        `UPDATE booth_work_orders SET status = 'paused' WHERE station_id = $1 AND status IN ('accepted','preparing') RETURNING id`,
        [id]
      );
      affectedOrders = r.rowCount || 0;
      newState = 'down';
      newCap = 0;
    } else if (fs === 'bypass') {
      // 停受影响作业 + 下调 traffic_cap (防止按原产能派单)
      const r = await pool.query(
        `UPDATE booth_work_orders SET status = 'paused' WHERE station_id = $1 AND status IN ('accepted','preparing') RETURNING id`,
        [id]
      );
      affectedOrders = r.rowCount || 0;
      // 下调: 受影响作业占用产能减去
      newCap = Math.max(0, newCap - affectedOrders);
      newState = 'paused';
    } else {
      // continue: 继续运行, 不阻断
      newState = 'busy';
    }
    await pool.query(
      `UPDATE booth_stations SET state = $1, traffic_cap = $2, metadata = metadata || $3::jsonb, updated_at = NOW() WHERE id = $4`,
      [newState, newCap, JSON.stringify({
        last_fault: { reason, strategy: fs, affected_orders: affectedOrders, at: new Date().toISOString() },
        fault_history: [...(((station.metadata || {}) as any).fault_history || []).slice(-49), { reason, strategy: fs, affected_orders: affectedOrders, at: new Date().toISOString() }],
      }), id]
    );
    broadcast(user.orgId, 'station.fault', { station_id: Number(id), strategy: fs, affected_orders: affectedOrders, traffic_cap: newCap, state: newState, plaz_station_code: st.rows[0].plaz_id ?? null });
    res.json({
      success: true,
      data: {
        station_id: Number(id),
        strategy: fs,
        affected_orders: affectedOrders,
        new_state: newState,
        new_traffic_cap: newCap,
        message: fs === 'stop_all' ? 'All operations stopped (stop_all)' : fs === 'bypass' ? `Affected operations stopped + traffic_cap reduced to ${newCap} (bypass)` : 'Operations continue (continue)',
      },
    });
  } catch (err) { next(err); }
});

// 9. GET /exx/fab/zone/:stage: 产线视角按阶段查询（前置/制作/包装/分拣）
router.get('/fab/zone/:stage', requireFabRead, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { stage } = req.params;
    const validStages = ['preprocessing', 'production', 'packaging', 'sorting'];
    if (!validStages.includes(stage)) {
      return res.status(400).json({ success: false, message: 'Invalid stage. Must be one of: preprocessing, production, packaging, sorting' });
    }
    // 该阶段的产线/工位
    const stations = await pool.query(
      `SELECT s.* FROM booth_stations s WHERE s.org_id = $1 AND s.zone_type = $2 AND (s.station_type = 'line' OR s.metadata->>'stage' = $3) ORDER BY s.code ASC`,
      [user.orgId, 'FAB', stage]
    );
    // 该阶段的当前工单
    const orders = await pool.query(
      `SELECT wo.*, s.code AS station_code FROM booth_work_orders wo LEFT JOIN booth_stations s ON s.id = wo.station_id WHERE wo.org_id = $1 AND wo.production_stage = $2 ORDER BY wo.priority DESC, wo.id ASC LIMIT 100`,
      [user.orgId, stage]
    );
    res.json({
      success: true,
      data: {
        stage,
        stations: stations.rows.map((s) => ({ ...s, active_orders: 0 })),
        orders: stripFabReadFor(user, orders.rows),
        total: orders.rows.length,
      },
    });
  } catch (err) { next(err); }
});

/* ============ FAB-MES-01 设备台账 + OEE 稼动率 ============ */

// GET /exx/fab/equipment 设备台账列表（含当前状态/OEE/上次保养）
router.get('/fab/equipment', requireFabRead, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { stationId } = req.query;
    let sql = `SELECT e.*, s.name AS station_name, s.code AS station_code
               FROM booth_equipment e
               LEFT JOIN booth_stations s ON s.id = e.station_id
               WHERE e.org_id = $1`;
    const params: (string | number)[] = [user.orgId];
    if (stationId) { params.push(String(stationId)); sql += ` AND e.station_id = $${params.length}`; }
    sql += ' ORDER BY e.created_at DESC';
    const eqRes = await pool.query(sql, params);
    res.json({ success: true, data: { equipment: eqRes.rows, total: eqRes.rows.length } });
  } catch (err) { next(err); }
});

// POST /exx/fab/equipment 新建设备
router.post('/fab/equipment', requireHat('FAB'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { stationId, code, name, type, ratedCapacity, purchaseDate, maintenanceCycleDays, lastMaintenanceAt } = req.body;
    if (!name || !type) {
      return res.status(400).json({ success: false, error: 'name and type are required', code: 'MISSING_FIELDS' });
    }
    let finalCode = code;
    if (!finalCode) {
      const maxRes = await pool.query(
        `SELECT code FROM booth_equipment WHERE org_id = $1 AND code LIKE 'EQ-%' ORDER BY created_at DESC LIMIT 1`,
        [user.orgId]
      );
      const lastSeq = maxRes.rows.length ? parseInt(maxRes.rows[0].code.replace('EQ-', ''), 10) || 0 : 0;
      finalCode = `EQ-${String(lastSeq + 1).padStart(3, '0')}`;
    }
    const dup = await pool.query('SELECT id FROM booth_equipment WHERE org_id = $1 AND code = $2', [user.orgId, finalCode]);
    if (dup.rows.length) {
      return res.status(409).json({ success: false, error: 'Equipment code already exists', code: 'DUPLICATE_CODE' });
    }
    if (stationId) {
      const stRes = await pool.query('SELECT id FROM booth_stations WHERE id = $1 AND org_id = $2', [stationId, user.orgId]);
      if (!stRes.rows.length) {
        return res.status(400).json({ success: false, error: 'Station not found', code: 'STATION_NOT_FOUND' });
      }
    }
    const ins = await pool.query(
      `INSERT INTO booth_equipment (org_id, station_id, code, name, type, status, rated_capacity, purchase_date, maintenance_cycle_days, last_maintenance_at)
       VALUES ($1,$2,$3,$4,$5,'idle',$6,$7,$8,$9) RETURNING *`,
      [user.orgId, stationId || null, finalCode, name, type, ratedCapacity || null,
        purchaseDate || null, maintenanceCycleDays || null, lastMaintenanceAt || null]
    );
    const eq = ins.rows[0];
    await pool.query(
      `INSERT INTO booth_equipment_status_log (org_id, equipment_id, from_status, to_status, reason, operator_id, started_at)
       VALUES ($1,$2,NULL,'idle','initial',$3,NOW())`,
      [user.orgId, eq.id, user.userId!]
    );
    // maintenanceCycleDays>0 时自动生成首条保养计划 (FAB-MES-01-FIX Bug2)
    if (maintenanceCycleDays && Number(maintenanceCycleDays) > 0) {
      const cycle = Number(maintenanceCycleDays);
      await pool.query(
        `INSERT INTO booth_maintenance_plans (org_id, equipment_id, plan_name, cycle_days, next_due_at, status, remark)
         VALUES ($1,$2,$3,$4,NOW() + ($5 || ' days')::interval,'pending','新建设备自动生成')`,
        [user.orgId, eq.id, `${eq.name} 例行保养`, cycle, String(cycle)]
      );
    }
    broadcast(user.orgId, 'equipment.created', { equipmentId: eq.id, code: eq.code });
    res.status(201).json({ success: true, data: eq });
  } catch (err) { next(err); }
});

// POST /exx/fab/equipment/:id/status 变更设备状态 + 停机原因
router.post('/fab/equipment/:id/status', requireHat('FAB'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { status, reason } = req.body;
    const VALID = ['running', 'idle', 'down', 'maintenance'];
    if (!status || !VALID.includes(status)) {
      return res.status(400).json({ success: false, error: `Invalid status, must be one of: ${VALID.join('/')}`, code: 'INVALID_STATUS' });
    }
    const eqRes = await pool.query('SELECT * FROM booth_equipment WHERE id = $1 AND org_id = $2', [req.params.id, user.orgId]);
    if (!eqRes.rows.length) {
      return res.status(404).json({ success: false, error: 'Equipment not found', code: 'NOT_FOUND' });
    }
    const prev = eqRes.rows[0];
    if (prev.status === status) {
      return res.status(400).json({ success: false, error: 'Status unchanged', code: 'SAME_STATUS' });
    }
    // Close open status log row
    await pool.query(
      `UPDATE booth_equipment_status_log SET ended_at = NOW()
       WHERE equipment_id = $1 AND ended_at IS NULL`,
      [req.params.id]
    );
    await pool.query(
      `INSERT INTO booth_equipment_status_log (org_id, equipment_id, from_status, to_status, reason, operator_id, started_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
      [user.orgId, req.params.id, prev.status, status, reason || null, user.userId!]
    );
    // Exiting maintenance → record maintenance completion on equipment
    let updSql = 'UPDATE booth_equipment SET status = $1';
    const updParams: (string | number)[] = [status];
    if (prev.status === 'maintenance' && status !== 'maintenance') {
      updSql += ', last_maintenance_at = NOW()';
    }
    updSql += ' WHERE id = $2 RETURNING *';
    updParams.push(req.params.id);
    const upd = await pool.query(updSql, updParams);
    // Exiting maintenance → auto-close related due/overdue plans
    if (prev.status === 'maintenance' && status !== 'maintenance') {
      await pool.query(
        `UPDATE booth_maintenance_plans SET status='done', last_done_at=NOW(),
           next_due_at = NOW() + (cycle_days || ' days')::interval
         WHERE equipment_id = $1 AND org_id = $2 AND status IN ('pending','overdue')`,
        [req.params.id, user.orgId]
      );
    }
    broadcast(user.orgId, 'equipment.status', { equipmentId: req.params.id, from: prev.status, to: status });
    res.json({ success: true, data: upd.rows[0] });
  } catch (err) { next(err); }
});

// OEE 计算核心：三率分解，数据不足返回 null（前端显示 N/A）
async function computeOee(orgId: number | string, equipmentId: string, from: Date, to: Date) {
  const plannedMinutes = Math.max(1, Math.round((to.getTime() - from.getTime()) / 60000));
  // Availability: running time overlap within window
  const logRes = await pool.query(
    `SELECT to_status, started_at, ended_at FROM booth_equipment_status_log
     WHERE equipment_id = $1 AND org_id = $2 AND to_status = 'running' AND started_at < $4
       AND (ended_at IS NULL OR ended_at > $3)`,
    [equipmentId, orgId, from, to]
  );
  let runningMinutes = 0;
  for (const row of logRes.rows) {
    const s = new Date(row.started_at) > from ? new Date(row.started_at) : from;
    const e = row.ended_at ? (new Date(row.ended_at) < to ? new Date(row.ended_at) : to) : to;
    if (e > s) runningMinutes += Math.round((e.getTime() - s.getTime()) / 60000);
  }
  const hasLog = logRes.rows.length > 0;
  const availability = hasLog && plannedMinutes > 0 ? runningMinutes / plannedMinutes : null;

  // Equipment rated capacity
  const eqRes = await pool.query('SELECT rated_capacity FROM booth_equipment WHERE id = $1 AND org_id = $2', [equipmentId, orgId]);
  const ratedCapacity = eqRes.rows.length ? Number(eqRes.rows[0].rated_capacity) : null;

  // Performance: actual output / (rated_capacity × running time)
  const opRes = await pool.query(
    `SELECT COALESCE(SUM(reported_qty),0) AS output FROM booth_fab_operations
     WHERE equipment_id = $1 AND org_id = $2 AND completed_at BETWEEN $3 AND $4`,
    [equipmentId, orgId, from, to]
  );
  const outputQty = Number(opRes.rows[0]?.output || 0);
  const hasOps = outputQty > 0;
  const runningDays = runningMinutes / (24 * 60);
  const expectedOutput = ratedCapacity && runningDays > 0 ? ratedCapacity * runningDays : null;
  const performance = expectedOutput && expectedOutput > 0 && hasOps ? outputQty / expectedOutput : null;

  // Quality: pass / total from quality checks of work orders processed on this equipment
  const qcRes = await pool.query(
    `SELECT COALESCE(SUM(qc.qty_pass),0) AS pass, COALESCE(SUM(qc.qty_reject),0) AS reject
     FROM booth_quality_checks qc
     JOIN booth_fab_operations fo ON fo.work_order_id = qc.work_order_id AND fo.org_id = qc.org_id
     WHERE fo.equipment_id = $1 AND fo.org_id = $2 AND qc.checked_at BETWEEN $3 AND $4`,
    [equipmentId, orgId, from, to]
  );
  const passQty = Number(qcRes.rows[0]?.pass || 0);
  const rejectQty = Number(qcRes.rows[0]?.reject || 0);
  const totalChecked = passQty + rejectQty;
  const quality = totalChecked > 0 ? passQty / totalChecked : null;

  const oee = availability !== null && performance !== null && quality !== null
    ? availability * performance * quality : null;
  return {
    availability, performance, quality, oee,
    running_minutes: runningMinutes, planned_minutes: plannedMinutes,
    output_qty: outputQty, pass_qty: passQty, reject_qty: rejectQty,
    rated_capacity: ratedCapacity,
  };
}

// GET /exx/fab/equipment/oee/dashboard 全厂 OEE 汇总（先注册，避免与 :id 冲突）
router.get('/fab/equipment/oee/dashboard', requireFabRead, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(to.getTime() - 7 * 24 * 3600 * 1000);
    const eqRes = await pool.query(
      `SELECT e.*, s.name AS station_name FROM booth_equipment e
       LEFT JOIN booth_stations s ON s.id = e.station_id WHERE e.org_id = $1 ORDER BY e.code`,
      [user.orgId]
    );
    const items = [];
    for (const eq of eqRes.rows) {
      const oee = await computeOee(user.orgId, eq.id, from, to);
      items.push({
        equipment_id: eq.id, code: eq.code, name: eq.name, type: eq.type,
        status: eq.status, station_name: eq.station_name,
        ...oee,
      });
    }
    // 全厂汇总：各率取有值设备的平均；全无数据则 N/A
    const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    const availArr = items.map(i => i.availability).filter((v): v is number => v !== null);
    const perfArr = items.map(i => i.performance).filter((v): v is number => v !== null);
    const qualArr = items.map(i => i.quality).filter((v): v is number => v !== null);
    const plantAvailability = avg(availArr);
    const plantPerformance = avg(perfArr);
    const plantQuality = avg(qualArr);
    const plantOee = plantAvailability !== null && plantPerformance !== null && plantQuality !== null
      ? plantAvailability * plantPerformance * plantQuality : null;
    // 停机原因 TOP 排行
    const downRes = await pool.query(
      `SELECT COALESCE(NULLIF(reason, ''), '未填写') AS reason, COUNT(*) AS cnt
       FROM booth_equipment_status_log
       WHERE org_id = $1 AND to_status = 'down' AND started_at BETWEEN $2 AND $3
       GROUP BY 1 ORDER BY cnt DESC LIMIT 10`,
      [user.orgId, from, to]
    );
    // [BOOTH-PK-03] 遥测联动(plant 级): 近 24h 自动采集总览(含模拟通道打标计数), 无数据如实 N/A
    const tele = await pool.query(
      `SELECT COUNT(*)::int AS auto_points_24h,
              COUNT(DISTINCT equipment_id)::int AS equipments_with_auto,
              COUNT(*) FILTER (WHERE demo_source)::int AS demo_points_24h
       FROM equipment_telemetry WHERE org_id = $1 AND source = 'auto' AND received_at >= NOW() - INTERVAL '24 hours'`,
      [user.orgId]
    );
    const tr = tele.rows[0] || {};
    const plantAutoPoints = tr.auto_points_24h ?? 0;
    res.json({
      success: true,
      data: {
        window: { from, to },
        plant: { availability: plantAvailability, performance: plantPerformance, quality: plantQuality, oee: plantOee },
        equipment: items,
        downtime_top: downRes.rows,
        telemetry_link: {
          available: plantAutoPoints > 0,
          auto_points_24h: plantAutoPoints,
          equipments_with_auto: tr.equipments_with_auto ?? 0,
          demo_points_24h: tr.demo_points_24h ?? 0,
          note: plantAutoPoints > 0 ? '近 24h 自动采集数据总览(source=auto; demo_source=true 为模拟通道)' : 'N/A: 近 24h 无自动采集数据',
        },
      },
    });
  } catch (err) { next(err); }
});

// GET /exx/fab/equipment/:id 单设备详情（含最近状态流水 + 挂载工位）
router.get('/fab/equipment/:id', requireFabRead, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const q = await pool.query(
      `SELECT e.*, s.code AS station_code, s.name AS station_name, s.state AS station_state
       FROM booth_equipment e LEFT JOIN booth_stations s ON s.id = e.station_id
       WHERE e.id = $1 AND e.org_id = $2`,
      [req.params.id, user.orgId]
    );
    if (!q.rows.length) return res.status(404).json({ success: false, error: 'Equipment not found', code: 'NOT_FOUND' });
    const logs = await pool.query(
      `SELECT id, from_status, to_status, reason, operator_id, started_at, ended_at
       FROM booth_equipment_status_log WHERE equipment_id = $1
       ORDER BY started_at DESC LIMIT 30`,
      [req.params.id]
    );
    res.json({ success: true, data: { equipment: q.rows[0], status_log: logs.rows } });
  } catch (err) { next(err); }
});

// GET /exx/fab/equipment/:id/oee 单设备 OEE
router.get('/fab/equipment/:id/oee', requireFabRead, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const ex = await pool.query('SELECT id FROM booth_equipment WHERE id = $1 AND org_id = $2', [req.params.id, user.orgId]);
    if (!ex.rows.length) return res.status(404).json({ success: false, error: 'Equipment not found', code: 'NOT_FOUND' });
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(to.getTime() - 7 * 24 * 3600 * 1000);
    const oee = await computeOee(user.orgId, req.params.id, from, to);
    // [BOOTH-PK-03] 遥测联动: source=auto 自动采集数据流入 OEE(近 24h), 无数据如实 N/A
    const tele = await pool.query(
      `SELECT COUNT(*)::int AS auto_points_24h,
              COUNT(*) FILTER (WHERE demo_source)::int AS demo_points_24h,
              (SELECT value FROM equipment_telemetry WHERE org_id = $1 AND equipment_id = $2 AND metric = 'status' AND source = 'auto' ORDER BY collected_at DESC LIMIT 1) AS latest_status,
              (SELECT collected_at FROM equipment_telemetry WHERE org_id = $1 AND equipment_id = $2 AND metric = 'status' AND source = 'auto' ORDER BY collected_at DESC LIMIT 1) AS latest_status_at,
              (SELECT SUM(value) FROM equipment_telemetry WHERE org_id = $1 AND equipment_id = $2 AND metric = 'output' AND source = 'auto' AND received_at >= NOW() - INTERVAL '24 hours') AS auto_output_24h
       FROM equipment_telemetry WHERE org_id = $1 AND equipment_id = $2 AND source = 'auto' AND received_at >= NOW() - INTERVAL '24 hours'`,
      [user.orgId, req.params.id]
    );
    const t = tele.rows[0] || {};
    const autoPoints = t.auto_points_24h ?? 0;
    const telemetryLink = {
      available: autoPoints > 0,
      auto_points_24h: autoPoints,
      demo_points_24h: t.demo_points_24h ?? 0,
      latest_status: t.latest_status !== null && t.latest_status !== undefined ? { value: Number(t.latest_status), at: t.latest_status_at } : null,
      auto_output_24h: t.auto_output_24h !== null && t.auto_output_24h !== undefined ? Number(t.auto_output_24h) : null,
      note: autoPoints > 0 ? '近 24h 自动采集数据已联动(source=auto, 未经人工报工)' : 'N/A: 该设备近 24h 无自动采集数据',
    };
    res.json({ success: true, data: { equipment_id: req.params.id, window: { from, to }, ...oee, telemetry_link: telemetryLink } });
  } catch (err) { next(err); }
});

// GET /exx/fab/maintenance/plans 保养计划列表（含 overdue 预警）
router.get('/fab/maintenance/plans', requireFabRead, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    // 先刷新 overdue 标记
    await pool.query(
      `UPDATE booth_maintenance_plans SET status = 'overdue'
       WHERE org_id = $1 AND status = 'pending' AND next_due_at < NOW()`,
      [user.orgId]
    );
    const plans = await pool.query(
      `SELECT mp.*, e.code AS equipment_code, e.name AS equipment_name, e.type AS equipment_type
       FROM booth_maintenance_plans mp
       JOIN booth_equipment e ON e.id = mp.equipment_id
       WHERE mp.org_id = $1
       ORDER BY CASE WHEN mp.status = 'overdue' THEN 0 WHEN mp.status = 'pending' THEN 1 ELSE 2 END,
                mp.next_due_at ASC NULLS LAST`,
      [user.orgId]
    );
    const now = new Date();
    const rows = plans.rows.map((p) => ({
      ...p,
      overdue: p.status === 'overdue' || (p.status === 'pending' && p.next_due_at && new Date(p.next_due_at) < now),
      days_left: p.next_due_at ? Math.ceil((new Date(p.next_due_at).getTime() - now.getTime()) / 86400000) : null,
    }));
    res.json({ success: true, data: { plans: rows, total: rows.length } });
  } catch (err) { next(err); }
});

// POST /exx/fab/maintenance/plans/:id/done 完成保养
router.post('/fab/maintenance/plans/:id/done', requireHat('FAB'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const planRes = await pool.query(
      'SELECT * FROM booth_maintenance_plans WHERE id = $1 AND org_id = $2',
      [req.params.id, user.orgId]
    );
    if (!planRes.rows.length) return res.status(404).json({ success: false, error: 'Plan not found', code: 'NOT_FOUND' });
    const plan = planRes.rows[0];
    if (plan.status === 'done') {
      return res.status(400).json({ success: false, error: 'Plan already done', code: 'ALREADY_DONE' });
    }
    const cycleDays = plan.cycle_days || 30;
    const upd = await pool.query(
      `UPDATE booth_maintenance_plans
       SET status = 'done', last_done_at = NOW(), next_due_at = NOW() + ($2 || ' days')::interval
       WHERE id = $1 RETURNING *`,
      [req.params.id, String(cycleDays)]
    );
    await pool.query('UPDATE booth_equipment SET last_maintenance_at = NOW() WHERE id = $1', [plan.equipment_id]);
    broadcast(user.orgId, 'maintenance.done', { planId: req.params.id, equipmentId: plan.equipment_id });
    res.json({ success: true, data: upd.rows[0] });
  } catch (err) { next(err); }
});

/* ================= 安灯异常中心 (Andon, FAB-MES-03) ================= */
// 发起安灯（工位一键呼叫）: 自动关联上下文（当前工单/设备）
router.post('/fab/andon', requireHat('FAB'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { type, severity, message, work_order_id, station_id, equipment_id } = req.body || {};
    if (!type || !message) return res.status(400).json({ error: 'type 与 message 必填' });
    if (!['shortage', 'equipment', 'quality', 'overdue', 'other'].includes(type)) {
      return res.status(400).json({ error: 'Invalid type, must be shortage/equipment/quality/overdue/other' });
    }
    if (!['low', 'medium', 'high', 'critical'].includes(severity || '')) {
      return res.status(400).json({ error: 'Invalid severity, must be low/medium/high/critical' });
    }
    const ev = await createAndonEvent({
      orgId: user.orgId, type, severity, message,
      workOrderId: work_order_id || null, stationId: station_id || null, equipmentId: equipment_id || null,
      callerId: user.userId, auto: false,
    });
    res.json({ success: true, data: ev });
  } catch (err) { next(err); }
});

// 异常中心看板: open/processing 事件、severity 排序、响应/解决时效
router.get('/fab/andon/board', requireFabRead, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const evs = await pool.query(
      `SELECT a.*, u1.name AS caller_name, u2.name AS assignee_name,
              s.code AS station_code, s.name AS station_name,
              e.code AS equipment_code, e.name AS equipment_name,
              wo.job_id AS work_order_job
       FROM booth_andon_events a
       LEFT JOIN booth_users u1 ON u1.id = a.caller_id
       LEFT JOIN booth_users u2 ON u2.id = a.assignee_id
       LEFT JOIN booth_stations s ON s.id = a.station_id
       LEFT JOIN booth_equipment e ON e.id = a.equipment_id
       LEFT JOIN booth_work_orders wo ON wo.id = a.work_order_id
       WHERE a.org_id = $1 AND a.status IN ('open','processing')
       ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
                a.created_at ASC`,
      [user.orgId]
    );
    const stats = await andonStats(user.orgId, '30 days');
    res.json({ success: true, data: { events: evs.rows, stats } });
  } catch (err) { next(err); }
});

// 指派处理人
router.post('/fab/andon/:id/assign', requireHat('FAB'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { assignee_id } = req.body || {};
    if (!assignee_id) return res.status(400).json({ error: 'assignee_id 必填' });
    const ev = await pool.query(
      `UPDATE booth_andon_events SET assignee_id = $2, status = 'processing',
              responded_at = COALESCE(responded_at, NOW())
       WHERE id = $1 AND org_id = $3 AND status IN ('open','processing')
       RETURNING *`,
      [req.params.id, assignee_id, user.orgId]
    );
    if (!ev.rows.length) return res.status(404).json({ error: '安灯事件不存在或不可指派' });
    broadcast(user.orgId, 'andon.updated', { id: ev.rows[0].id, status: 'processing' });
    res.json({ success: true, data: ev.rows[0] });
  } catch (err) { next(err); }
});

// 解决（含 solution 记录）→ 写入知识库候选
router.post('/fab/andon/:id/resolve', requireHat('FAB'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { solution } = req.body || {};
    if (!solution) return res.status(400).json({ error: 'solution 必填' });
    const ev = await pool.query(
      `UPDATE booth_andon_events SET status = 'resolved', resolved_at = NOW(), solution = $2
       WHERE id = $1 AND org_id = $3 AND status IN ('open','processing')
       RETURNING *`,
      [req.params.id, solution, user.orgId]
    );
    if (!ev.rows.length) return res.status(404).json({ error: '安灯事件不存在或已解决' });
    const row = ev.rows[0];
    // 知识库候选：异常描述 + 解决方案沉淀
    await pool.query(
      `INSERT INTO booth_knowledge_candidates (org_id, andon_event_id, title, solution, reporter_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.orgId, row.id, `【${row.type}】${(row.message || '').slice(0, 60)}`, solution, user.userId]
    );
    broadcast(user.orgId, 'andon.updated', { id: row.id, status: 'resolved' });
    res.json({ success: true, data: row });
  } catch (err) { next(err); }
});

// 历史事件 + 响应/解决时效统计
router.get('/fab/andon/history', requireFabRead, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 7 * 86400000);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const evs = await pool.query(
      `SELECT a.*, u1.name AS caller_name, u2.name AS assignee_name
       FROM booth_andon_events a
       LEFT JOIN booth_users u1 ON u1.id = a.caller_id
       LEFT JOIN booth_users u2 ON u2.id = a.assignee_id
       WHERE a.org_id = $1 AND a.created_at BETWEEN $2 AND $3
       ORDER BY a.created_at DESC LIMIT 500`,
      [user.orgId, from.toISOString(), to.toISOString()]
    );
    const stats = await andonStats(user.orgId, '30 days');
    res.json({ success: true, data: { events: evs.rows, stats, from: from.toISOString(), to: to.toISOString() } });
  } catch (err) { next(err); }
});

// ====== FAB-MES-DATA-CLEAN: 测试数据清理接口（幂等 / org 隔离 / 可追溯）======

// DELETE /exx/fab/equipment/:id — 删除设备并级联清理状态流水与保养计划
router.delete('/fab/equipment/:id', requireHat('FAB'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const id = Number(req.params.id);
    const orgId = user.orgId as number;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const eq = await client.query('SELECT id, code, name FROM booth_equipment WHERE id=$1 AND org_id=$2', [id, orgId]);
      if (eq.rowCount === 0) {
        await client.query('COMMIT');
        return res.json({ success: true, data: { deleted: false, id, message: 'already absent (idempotent)' } });
      }
      const logs = await client.query('DELETE FROM booth_equipment_status_log WHERE equipment_id=$1 AND org_id=$2 RETURNING id', [id, orgId]);
      const plans = await client.query('DELETE FROM booth_maintenance_plans WHERE equipment_id=$1 AND org_id=$2 RETURNING id', [id, orgId]);
      await client.query('DELETE FROM booth_equipment WHERE id=$1 AND org_id=$2', [id, orgId]);
      await client.query('COMMIT');
      res.json({ success: true, data: { deleted: true, id, code: eq.rows[0].code, name: eq.rows[0].name, cascaded: { status_logs: logs.rowCount, maintenance_plans: plans.rowCount } } });
    } catch (e: any) {
      await client.query('ROLLBACK');
      // 23503: 报工记录仍引用该设备 —— 不自动级联删报工(追溯数据), 返回可操作指引
      if (e?.code === '23503') {
        const refs = await pool.query('SELECT count(*)::int c FROM booth_fab_operations WHERE equipment_id=$1 AND org_id=$2', [id, orgId]);
        return res.status(409).json({ success: false, error: 'equipment still referenced by fab operations', code: '23503', data: { id, operation_refs: refs.rows[0].c, hint: 'POST /api/booth/exx/fab/operations/cleanup-by-equipment {"equipment_id":' + id + '} 先清理该设备报工引用' } });
      }
      throw e;
    } finally { client.release(); }
  } catch (err) { next(err); }
});

// DELETE /exx/fab/maintenance/plans/:id — 删除保养计划（不影响设备）
router.delete('/fab/maintenance/plans/:id', requireHat('FAB'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const id = Number(req.params.id);
    const del = await pool.query('DELETE FROM booth_maintenance_plans WHERE id=$1 AND org_id=$2 RETURNING id', [id, user.orgId as number]);
    res.json({ success: true, data: { deleted: (del.rowCount ?? 0) > 0, id } });
  } catch (err) { next(err); }
});

// POST /exx/fab/operations/cleanup — 按 id 数组清理报工记录 { ids: number[] }
router.post('/fab/operations/cleanup', requireHat('FAB'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const raw = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const ids = raw.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n > 0);
    if (ids.length === 0) return res.status(400).json({ success: false, error: 'ids (positive integer array) required' });
    const del = await pool.query('DELETE FROM booth_fab_operations WHERE id = ANY($1::int[]) AND org_id=$2 RETURNING id', [ids, user.orgId as number]);
    res.json({ success: true, data: { requested: ids, deleted_ids: del.rows.map((r: any) => r.id) } });
  } catch (err) { next(err); }
});

// POST /exx/fab/operations/cleanup-by-equipment — 清理指定设备的全部报工引用 { equipment_id: number }
router.post('/fab/operations/cleanup-by-equipment', requireHat('FAB'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const eqId = Number(req.body?.equipment_id);
    if (!Number.isInteger(eqId) || eqId <= 0) return res.status(400).json({ success: false, error: 'equipment_id (positive integer) required' });
    const del = await pool.query('DELETE FROM booth_fab_operations WHERE equipment_id=$1 AND org_id=$2 RETURNING id', [eqId, user.orgId as number]);
    res.json({ success: true, data: { equipment_id: eqId, deleted_ids: del.rows.map((r: any) => r.id), deleted_count: del.rowCount ?? 0 } });
  } catch (err) { next(err); }
});

export default router;
