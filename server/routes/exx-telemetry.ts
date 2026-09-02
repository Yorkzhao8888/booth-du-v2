// BOOTH-PK-03 IoT/边缘自动采集(通道契约先行)
// 通道契约: ingest 幂等(org+设备+metric+collected_at 唯一) / health 在线判定(断连告警) / configs 采集配置 / demo beat 内置模拟通道
// 红线:
//  - 采集通道只登记真实采集数据; 模拟通道 demo_source=true 与生产隔离打标, 绝不冒充真实设备数据
//  - 无硬件时以「占位接入点」存在(ingest), 如实标注待接入, 不留假 token/假数据
//  - 写操作 requireHat('FAB') 或内部上报密钥(TELEMETRY_INGEST_KEY, 在 requireAuth 内校验); 查询 requireFabRead; org 限定
//  - 设备只关联不替代工位容量(FAB-MES 红线延续); 遥测为弱关联(无外键), 不阻塞设备生命周期
import { Router } from 'express';
import { pool } from '../db.js';
import { requireHat, type JwtPayload } from '../auth.js';
import { requireFabRead } from './exx-fab-mes.js';

const router = Router();

// 占位接入点如实标注: 真实硬件未接入, 当前仅内置模拟通道(demo_source=true)可用于链路联调
const INGEST_META = {
  runtime: 'contract-only',
  real_device_connected: false,
  ingest_endpoint: 'POST /exx/fab/telemetry/ingest',
  auth: 'JWT(FAB 帽) 或 X-Telemetry-Key(env.TELEMETRY_INGEST_KEY; env 未配置则密钥通道不可用)',
  note: '真实硬件/边缘设备未接入: 本通道为契约占位接入点, 设备接入后自动生效, 无需改业务; 当前仅内置模拟通道(demo_source=true)用于链路联调',
};

// 写操作闸门(与 PK-01 station-capabilities 同款): 非 GET/HEAD 需 du/dx/dex 或 FAB 帽;
// 密钥通道无 user 直接放行(由 ingest 的 requireIngestAuth 自行鉴权)。
router.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const user = (req as any).user as JwtPayload | undefined;
    if (user) {
      const isManager = ['du', 'dx', 'dex'].includes(user.role);
      const isFabHat = !!user.hats?.includes('FAB');
      if (!isManager && !isFabHat) {
        return res.status(403).json({ success: false, error: 'FORBIDDEN', message: '采集编排仅 EX/DEX 或 FAB 帽持有者可用' });
      }
    }
  }
  next();
});

// ingest 鉴权: 密钥通道(req.telemetryKeyAuth, requireAuth 已校验) / JWT 通道 requireHat('FAB')
function requireIngestAuth(req: any, res: any, next: any) {
  if (req.telemetryKeyAuth) return next();
  return requireHat('FAB')(req, res, next);
}

// ---------------------------------------------------------------------------
// POST /exx/fab/telemetry/ingest —— 边缘上报(幂等)
// 同 org+equipment+metric+collected_at 重复上报不产生重复记录(uq_telemetry_point DO NOTHING)
// ---------------------------------------------------------------------------
router.post('/fab/telemetry/ingest', requireIngestAuth, async (req: any, res, next) => {
  try {
    const user = req.user as JwtPayload | undefined;
    const keyAuth = !!req.telemetryKeyAuth;
    const body = req.body || {};
    const orgId = keyAuth ? Number(body.org_id) : user?.orgId;
    if (!Number.isInteger(orgId) || (orgId as number) <= 0) {
      return res.status(400).json({ success: false, error: 'ORG_REQUIRED', message: keyAuth ? '密钥通道须在 body 提供有效 org_id' : '无效组织' });
    }
    if (body.demo_source === true || body.demo_source === 'true') {
      return res.status(400).json({ success: false, error: 'DEMO_SOURCE_RESERVED', message: 'demo_source 为内置模拟通道保留字段, 禁止经生产 ingest 通道上报(隔离红线)' });
    }
    const equipmentId = Number(body.equipment_id);
    const metric = typeof body.metric === 'string' ? body.metric.trim() : '';
    const value = Number(body.value);
    const collectedAt = body.collected_at ? new Date(body.collected_at) : new Date();
    if (!Number.isInteger(equipmentId)) return res.status(400).json({ success: false, error: 'INVALID_EQUIPMENT_ID' });
    if (!metric || metric.length > 50) return res.status(400).json({ success: false, error: 'INVALID_METRIC', message: 'metric 必填(不超过 50 字符)' });
    if (!Number.isFinite(value)) return res.status(400).json({ success: false, error: 'INVALID_VALUE', message: 'value 必须为数字' });
    if (isNaN(collectedAt.getTime())) return res.status(400).json({ success: false, error: 'INVALID_COLLECTED_AT', message: 'collected_at 须为合法时间' });
    if (collectedAt.getTime() > Date.now() + 5 * 60 * 1000) {
      return res.status(400).json({ success: false, error: 'COLLECTED_AT_IN_FUTURE', message: 'collected_at 不允许超前当前时间 5 分钟以上' });
    }
    const eq = await pool.query('SELECT id FROM booth_equipment WHERE id = $1 AND org_id = $2', [equipmentId, orgId]);
    if (!eq.rows.length) return res.status(404).json({ success: false, error: 'EQUIPMENT_NOT_FOUND', message: '设备不存在或不属于该组织' });
    const ins = await pool.query(
      `INSERT INTO equipment_telemetry (org_id, equipment_id, metric, value, collected_at, received_at, source, demo_source)
       VALUES ($1, $2, $3, $4, $5, NOW(), 'auto', FALSE)
       ON CONFLICT (org_id, equipment_id, metric, collected_at) DO NOTHING
       RETURNING id`,
      [orgId, equipmentId, metric, value, collectedAt]
    );
    const duplicated = !ins.rows.length;
    return res.status(duplicated ? 200 : 201).json({
      success: true,
      data: {
        telemetry_id: ins.rows[0]?.id ?? null,
        duplicated,
        equipment_id: equipmentId,
        metric,
        value,
        collected_at: collectedAt.toISOString(),
        source: 'auto',
        demo_source: false,
      },
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /exx/fab/equipment/:id/telemetry?from=&to=&metric=&demo_source=all|exclude|only
// 遥测查询(只读, org 限定): 每点带 source/demo_source 打标; demo_source=exclude 为生产口径
// ---------------------------------------------------------------------------
router.get('/fab/equipment/:id/telemetry', requireFabRead, async (req: any, res, next) => {
  try {
    const orgId = req.user.orgId as number;
    const equipmentId = Number(req.params.id);
    if (!Number.isInteger(equipmentId)) return res.status(400).json({ success: false, error: 'INVALID_EQUIPMENT_ID' });
    const eq = await pool.query(
      `SELECT e.id, e.code, e.name, e.status, s.name AS station_name
       FROM booth_equipment e LEFT JOIN booth_stations s ON s.id = e.station_id
       WHERE e.id = $1 AND e.org_id = $2`,
      [equipmentId, orgId]
    );
    if (!eq.rows.length) return res.status(404).json({ success: false, error: 'EQUIPMENT_NOT_FOUND' });
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(to.getTime() - 24 * 3600 * 1000);
    const metric = typeof req.query.metric === 'string' && req.query.metric.trim() ? req.query.metric.trim() : null;
    const demoMode = ['all', 'exclude', 'only'].includes(String(req.query.demo_source)) ? String(req.query.demo_source) : 'all';
    const params: any[] = [orgId, equipmentId, from, to];
    let where = 'org_id = $1 AND equipment_id = $2 AND collected_at >= $3 AND collected_at <= $4';
    if (metric) { params.push(metric); where += ` AND metric = $${params.length}`; }
    if (demoMode === 'exclude') where += ' AND demo_source = FALSE';
    if (demoMode === 'only') where += ' AND demo_source = TRUE';
    const rows = await pool.query(
      `SELECT id, metric, value, collected_at, received_at, source, demo_source
       FROM equipment_telemetry WHERE ${where}
       ORDER BY collected_at ASC LIMIT 2000`,
      params
    );
    const sum = await pool.query(
      `SELECT metric, COUNT(*)::int AS cnt, MIN(value) AS min_v, MAX(value) AS max_v, AVG(value) AS avg_v
       FROM equipment_telemetry WHERE ${where} GROUP BY metric ORDER BY metric`,
      params
    );
    const latest = await pool.query(
      `SELECT DISTINCT ON (metric) metric, value, collected_at, demo_source
       FROM equipment_telemetry WHERE ${where}
       ORDER BY metric, collected_at DESC`,
      params
    );
    const latestMap = new Map<string, any>(latest.rows.map((r: any) => [r.metric, r]));
    const summary = sum.rows.map((r: any) => {
      const lat = latestMap.get(r.metric);
      return {
        metric: r.metric,
        count: r.cnt,
        min: r.min_v === null ? null : Number(r.min_v),
        max: r.max_v === null ? null : Number(r.max_v),
        avg: r.avg_v === null ? null : Number(Number(r.avg_v).toFixed(2)),
        latest_value: lat ? Number(lat.value) : null,
        latest_at: lat ? lat.collected_at : null,
      };
    });
    res.json({
      success: true,
      data: {
        equipment: eq.rows[0],
        window: { from, to },
        demo_mode: demoMode,
        points: rows.rows.map((r: any) => ({ ...r, value: Number(r.value) })),
        summary,
        meta: { source_note: 'source=auto 为边缘自动采集; demo_source=true 为内置模拟通道(联调用), 与生产数据隔离' },
      },
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// GET /exx/fab/telemetry/health —— 采集在线状态
// 判定: threshold = max(该设备最短启用 interval_sec * 2, 15); age = now - 最近 received_at(服务端接收时间, 防设备时钟漂移)
// 状态: online / offline(断连超阈值, 进 alerts) / na(无任何数据, 如实 N/A) / paused(配置全停用, 不告警)
// ---------------------------------------------------------------------------
router.get('/fab/telemetry/health', requireFabRead, async (req: any, res, next) => {
  try {
    const orgId = req.user.orgId as number;
    const cfgs = await pool.query(
      `SELECT c.*, e.name AS equipment_name, e.code AS equipment_code, e.status AS equipment_status, s.name AS station_name
       FROM equipment_telemetry_configs c
       LEFT JOIN booth_equipment e ON e.id = c.equipment_id
       LEFT JOIN booth_stations s ON s.id = c.station_id
       WHERE c.org_id = $1 ORDER BY c.equipment_id, c.metric`,
      [orgId]
    );
    const lastRes = await pool.query(
      `SELECT equipment_id, MAX(received_at) AS last_received, COUNT(*)::int AS total_points,
              COUNT(*) FILTER (WHERE demo_source)::int AS demo_points
       FROM equipment_telemetry WHERE org_id = $1 GROUP BY equipment_id`,
      [orgId]
    );
    const lastMap = new Map<number, any>(lastRes.rows.map((r: any) => [Number(r.equipment_id), r]));
    const byEq = new Map<number, any[]>();
    for (const c of cfgs.rows) {
      const k = Number(c.equipment_id);
      if (!byEq.has(k)) byEq.set(k, []);
      byEq.get(k)!.push(c);
    }
    const now = Date.now();
    const devices: any[] = [];
    const alerts: any[] = [];
    let online = 0, offline = 0, na = 0, paused = 0;
    for (const [equipmentId, list] of byEq) {
      const first = list[0];
      const enabledList = list.filter((c: any) => c.enabled);
      const intervals = enabledList.map((c: any) => Number(c.interval_sec)).filter((n: number) => Number.isFinite(n) && n > 0);
      const minInterval = intervals.length ? Math.min(...intervals) : null;
      const thresholdSec = minInterval !== null ? Math.max(minInterval * 2, 15) : null;
      const last = lastMap.get(equipmentId);
      const lastReceived = last?.last_received ?? null;
      const ageSec = lastReceived ? Math.max(0, Math.floor((now - new Date(lastReceived).getTime()) / 1000)) : null;
      let status: string;
      if (!enabledList.length) status = 'paused';
      else if (ageSec === null) status = 'na';
      else if (thresholdSec !== null && ageSec <= thresholdSec) status = 'online';
      else status = 'offline';
      if (status === 'online') online += 1;
      else if (status === 'offline') {
        offline += 1;
        alerts.push({
          equipment_id: equipmentId,
          equipment_name: first.equipment_name ?? `设备#${equipmentId}`,
          equipment_code: first.equipment_code ?? null,
          last_received_at: lastReceived,
          age_sec: ageSec,
          threshold_sec: thresholdSec,
          reason: 'no_heartbeat_over_threshold',
          message: `采集离线: 最近心跳 ${ageSec}s 前, 超过阈值 ${thresholdSec}s(采样间隔 ${minInterval}s)`,
        });
      } else if (status === 'na') na += 1;
      else paused += 1;
      devices.push({
        equipment_id: equipmentId,
        equipment_code: first.equipment_code ?? null,
        equipment_name: first.equipment_name ?? null,
        station_name: first.station_name ?? null,
        metrics: list.map((c: any) => ({ metric: c.metric, interval_sec: c.interval_sec, enabled: c.enabled, demo_source: c.demo_source })),
        min_interval_sec: minInterval,
        threshold_sec: thresholdSec,
        last_received_at: lastReceived,
        age_sec: ageSec,
        delay_sec: ageSec !== null && minInterval !== null ? Math.max(0, ageSec - minInterval) : null,
        total_points: last?.total_points ?? 0,
        demo_points: last?.demo_points ?? 0,
        status,
      });
    }
    devices.sort((a, b) => a.equipment_id - b.equipment_id);
    res.json({
      success: true,
      data: {
        summary: { total: devices.length, online, offline, na, paused },
        devices,
        alerts,
        meta: {
          ...INGEST_META,
          demo_channel: {
            configs: cfgs.rows.filter((c: any) => c.demo_source).length,
            note: 'demo_source=true 的采集配置属内置模拟通道, 仅用于链路联调, 与生产数据隔离',
          },
        },
      },
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// 采集配置 equipment_telemetry_configs
// ---------------------------------------------------------------------------
router.get('/fab/telemetry/configs', requireFabRead, async (req: any, res, next) => {
  try {
    const rows = await pool.query(
      `SELECT c.*, e.name AS equipment_name, e.code AS equipment_code, e.status AS equipment_status, s.name AS station_name
       FROM equipment_telemetry_configs c
       LEFT JOIN booth_equipment e ON e.id = c.equipment_id
       LEFT JOIN booth_stations s ON s.id = c.station_id
       WHERE c.org_id = $1 ORDER BY c.equipment_id, c.metric`,
      [req.user.orgId]
    );
    res.json({ success: true, data: { configs: rows.rows, meta: INGEST_META } });
  } catch (err) { next(err); }
});

// POST /exx/fab/telemetry/configs —— 登记/更新采集配置(幂等 upsert: org+equipment+metric 唯一; station 自动带出)
router.post('/fab/telemetry/configs', requireHat('FAB'), async (req: any, res, next) => {
  try {
    const orgId = req.user.orgId as number;
    const body = req.body || {};
    const equipmentId = Number(body.equipment_id);
    const metric = typeof body.metric === 'string' ? body.metric.trim() : '';
    const intervalSec = body.interval_sec === undefined || body.interval_sec === null || body.interval_sec === '' ? 60 : Number(body.interval_sec);
    const enabled = body.enabled === undefined ? true : !!body.enabled;
    const demoSource = body.demo_source === true || body.demo_source === 'true';
    if (!Number.isInteger(equipmentId)) return res.status(400).json({ success: false, error: 'INVALID_EQUIPMENT_ID' });
    if (!metric || metric.length > 50) return res.status(400).json({ success: false, error: 'INVALID_METRIC', message: 'metric 必填(不超过 50 字符)' });
    if (!Number.isFinite(intervalSec) || intervalSec < 1) return res.status(400).json({ success: false, error: 'INVALID_INTERVAL', message: 'interval_sec 必须 ≥ 1' });
    const eq = await pool.query('SELECT id, station_id FROM booth_equipment WHERE id = $1 AND org_id = $2', [equipmentId, orgId]);
    if (!eq.rows.length) return res.status(404).json({ success: false, error: 'EQUIPMENT_NOT_FOUND', message: '设备不存在或不属于该组织' });
    const up = await pool.query(
      `INSERT INTO equipment_telemetry_configs (org_id, station_id, equipment_id, metric, interval_sec, enabled, demo_source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (org_id, equipment_id, metric)
       DO UPDATE SET station_id = EXCLUDED.station_id, interval_sec = EXCLUDED.interval_sec,
                     enabled = EXCLUDED.enabled, demo_source = EXCLUDED.demo_source, updated_at = NOW()
       RETURNING *`,
      [orgId, eq.rows[0].station_id, equipmentId, metric, Math.round(intervalSec), enabled, demoSource]
    );
    res.json({ success: true, data: { config: up.rows[0], demo_source_note: demoSource ? '该配置属内置模拟通道, 上报数据将打标 demo_source=true 与生产隔离' : null } });
  } catch (err) { next(err); }
});

// POST /exx/fab/telemetry/configs/:id/toggle —— 启停采集配置(幂等取反)
router.post('/fab/telemetry/configs/:id/toggle', requireHat('FAB'), async (req: any, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'INVALID_CONFIG_ID' });
    const up = await pool.query(
      `UPDATE equipment_telemetry_configs SET enabled = NOT enabled, updated_at = NOW()
       WHERE id = $1 AND org_id = $2 RETURNING *`,
      [id, req.user.orgId]
    );
    if (!up.rows.length) return res.status(404).json({ success: false, error: 'CONFIG_NOT_FOUND' });
    res.json({ success: true, data: { config: up.rows[0] } });
  } catch (err) { next(err); }
});

// DELETE /exx/fab/telemetry/configs/:id —— 删除采集配置(幂等; 遥测历史数据保留)
router.delete('/fab/telemetry/configs/:id', requireHat('FAB'), async (req: any, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ success: false, error: 'INVALID_CONFIG_ID' });
    const del = await pool.query('DELETE FROM equipment_telemetry_configs WHERE id = $1 AND org_id = $2', [id, req.user.orgId]);
    res.json({ success: true, data: { deleted: del.rowCount ?? 0 } });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------------------
// POST /exx/fab/telemetry/demo/beat —— 内置模拟上报通道(仅链路联调)
// 为 demo_source=true 且启用的配置各生成一个采集点(collected_at=NOW());
// 隔离红线: 写入强制 demo_source=TRUE / source='auto', 绝不冒充真实设备数据。
// ---------------------------------------------------------------------------
router.post('/fab/telemetry/demo/beat', requireHat('FAB'), async (req: any, res, next) => {
  try {
    const orgId = req.user.orgId as number;
    const body = req.body || {};
    const eqFilter = Number(body.equipment_id);
    const params: any[] = [orgId];
    let where = 'c.org_id = $1 AND c.enabled = TRUE AND c.demo_source = TRUE AND e.id IS NOT NULL';
    if (Number.isInteger(eqFilter)) { params.push(eqFilter); where += ` AND c.equipment_id = $${params.length}`; }
    const cfgs = await pool.query(
      `SELECT c.*, e.name AS equipment_name FROM equipment_telemetry_configs c
       LEFT JOIN booth_equipment e ON e.id = c.equipment_id
       WHERE ${where} ORDER BY c.equipment_id, c.metric`,
      params
    );
    if (!cfgs.rows.length) {
      return res.status(404).json({
        success: false,
        error: 'NO_DEMO_CONFIG',
        message: '无启用的模拟采集配置: 请先登记 demo_source=true 的采集配置(POST /fab/telemetry/configs)',
      });
    }
    const collectedAt = new Date();
    const points: any[] = [];
    for (const c of cfgs.rows) {
      const value = demoValue(String(c.metric));
      const ins = await pool.query(
        `INSERT INTO equipment_telemetry (org_id, equipment_id, metric, value, collected_at, received_at, source, demo_source)
         VALUES ($1, $2, $3, $4, $5, NOW(), 'auto', TRUE)
         ON CONFLICT (org_id, equipment_id, metric, collected_at) DO NOTHING RETURNING id`,
        [orgId, c.equipment_id, c.metric, value, collectedAt]
      );
      points.push({
        equipment_id: c.equipment_id,
        equipment_name: c.equipment_name,
        metric: c.metric,
        value,
        collected_at: collectedAt.toISOString(),
        inserted: ins.rows.length > 0,
      });
    }
    res.json({
      success: true,
      data: {
        beaten: points.length,
        points,
        demo: true,
        note: '模拟通道数据: demo_source=true, 与生产数据隔离; 仅用于链路联调, 不冒充真实设备',
      },
    });
  } catch (err) { next(err); }
});

// 模拟值生成: 联调用数值, 不承载业务语义
function demoValue(metric: string): number {
  const t = Date.now() / 60000;
  if (metric === 'status') return Math.sin(t) > -0.8 ? 1 : 0; // 大部分时间运行(1), 偶发待机(0)
  if (metric === 'output') return 1; // 每拍 1 件增量
  const base = Math.abs(Math.sin(t + metric.length)) * 20;
  return Number((50 + base).toFixed(2));
}

export default router;
