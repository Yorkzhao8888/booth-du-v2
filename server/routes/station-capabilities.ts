// BOOTH-PK-01 Station 能力插件(v1.1: 能力登记 + 匹配子集)
// 能力是执行能力登记层, 执行仍走 booth_fab_operations, 不建并行执行引擎。
// 红线: 不替代/不覆盖既有业务主链路状态机; 目录如实标记占位(runtime registry-only)。
import { Router } from 'express';
import { pool } from '../db.js';
import { requireHat, requireRole, type JwtPayload } from '../auth.js';
import { requireFabRead } from './exx-fab-mes.js';

const router = Router();

// v1.1 匹配规则: 工单必经 FAB 标准工序链(zone 体系), 能力按 capability_code 精确匹配 stage。
// 如实标注: 规则版本 v1.1-stage-match, 尚无插件运行时(热插拔 P1)。
const STAGE_REQUIREMENTS: Array<{ stage: string; label: string }> = [
  { stage: 'preprocessing', label: '前置工序' },
  { stage: 'production', label: '产线中段' },
  { stage: 'packaging', label: '包装' },
  { stage: 'sorting', label: '分拣' },
];

const RUNTIME_META = {
  runtime: 'registry-only',
  rule_version: 'v1.1-stage-match',
  note: '能力为执行能力登记层, 执行仍走 booth_fab_operations 工序表; 插件热插拔运行时为 P1 跟踪项, 尚未实现',
};

// 能力编排写权限: EX/DEX(du/dx/dex) 或持 FAB 帽(exx) —— 依工单红线"写操作 requireHat('FAB')"取并集。
// 必须先于写路由注册(Express 顺序匹配)。
router.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const user = (req as any).user as JwtPayload | undefined;
    const isManager = user && ['du', 'dx', 'ex'].includes(user.role);
    const isFabHat = user?.hats?.includes('FAB');
    if (user && !isManager && !isFabHat) {
      return res.status(403).json({ success: false, error: 'FORBIDDEN', message: '能力编排仅 EX/DEX 或 FAB 帽持有者可用' });
    }
  }
  next();
});

// 登记/更新能力并挂载到 Station(幂等 upsert, 重新登记即重新上线)
router.post('/fab/station/:id/capabilities/register', requireHat('FAB'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const user = (req as any).user as JwtPayload;
    const orgId = user.orgId;
    const stationId = Number(req.params.id);
    const { capability_code, name, inputs, outputs, estimated_time, rate } = req.body || {};
    if (!Number.isFinite(stationId)) return res.status(400).json({ success: false, error: 'INVALID_STATION_ID' });
    if (!capability_code || typeof capability_code !== 'string' || !name) {
      return res.status(400).json({ success: false, error: 'capability_code/name 必填' });
    }
    await client.query('BEGIN');
    const st = await client.query('SELECT id, code, name FROM booth_stations WHERE id = $1 AND org_id = $2', [stationId, orgId]);
    if (!st.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'STATION_NOT_FOUND' });
    }
    const capRes = await client.query(
      `INSERT INTO station_capabilities (org_id, station_id, capability_code, name, inputs, outputs, estimated_time, rate, status)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, 'active')
       ON CONFLICT (org_id, station_id, capability_code) DO UPDATE
         SET name = EXCLUDED.name,
             inputs = EXCLUDED.inputs,
             outputs = EXCLUDED.outputs,
             estimated_time = EXCLUDED.estimated_time,
             rate = EXCLUDED.rate,
             status = 'active',
             updated_at = NOW()
       RETURNING *`,
      [orgId, stationId, capability_code.trim(), name,
       JSON.stringify(Array.isArray(inputs) ? inputs : []),
       JSON.stringify(Array.isArray(outputs) ? outputs : []),
       estimated_time ?? null, rate ?? null]
    );
    const cap = capRes.rows[0];
    const mountRes = await client.query(
      `INSERT INTO station_capability_mounts (org_id, station_id, capability_id, mount_at, state)
       VALUES ($1, $2, $3, NOW(), 'registered')
       ON CONFLICT (org_id, station_id, capability_id) DO UPDATE
         SET state = 'registered', mount_at = NOW()
       RETURNING *`,
      [orgId, stationId, cap.id]
    );
    await client.query('COMMIT');
    res.json({ success: true, data: { capability: cap, mount: mountRes.rows[0], station: st.rows[0] } });
  } catch (e) { await client.query('ROLLBACK').catch(() => {}); next(e); } finally { client.release(); }
});

// 卸载: 置 inactive(能力与挂载位), 不影响既有工单状态机(能力与工单主链路解耦)
router.post('/fab/station/:id/capabilities/:code/unregister', requireHat('FAB'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const orgId = user.orgId;
    const stationId = Number(req.params.id);
    const code = String(req.params.code || '');
    if (!Number.isFinite(stationId) || !code) return res.status(400).json({ success: false, error: 'INVALID_PARAMS' });
    const capRes = await pool.query(
      `UPDATE station_capabilities SET status = 'inactive', updated_at = NOW()
       WHERE org_id = $1 AND station_id = $2 AND capability_code = $3
       RETURNING *`,
      [orgId, stationId, code]
    );
    if (!capRes.rows.length) return res.status(404).json({ success: false, error: 'CAPABILITY_NOT_FOUND' });
    await pool.query(
      `UPDATE station_capability_mounts SET state = 'inactive'
       WHERE org_id = $1 AND station_id = $2 AND capability_id = $3`,
      [orgId, stationId, capRes.rows[0].id]
    );
    res.json({ success: true, data: { capability: capRes.rows[0], unmounted: true } });
  } catch (e) { next(e); }
});

// 能力市场: 全 Booth 已登记能力(含状态/挂载位), 只读开放给管理角色
router.get('/fab/plugins/catalog', requireFabRead, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const orgId = user.orgId;
    const { status, q } = req.query as { status?: string; q?: string };
    const params: any[] = [orgId];
    let where = 'c.org_id = $1';
    if (status === 'active' || status === 'inactive') { params.push(status); where += ` AND c.status = $${params.length}`; }
    if (q) { params.push(`%${q}%`); where += ` AND (c.capability_code ILIKE $${params.length} OR c.name ILIKE $${params.length})`; }
    const rows = await pool.query(
      `SELECT c.*, s.code AS station_code, s.name AS station_name,
              m.state AS mount_state, m.mount_at
       FROM station_capabilities c
       JOIN booth_stations s ON s.id = c.station_id
       LEFT JOIN station_capability_mounts m ON m.org_id = c.org_id AND m.station_id = c.station_id AND m.capability_id = c.id
       WHERE ${where}
       ORDER BY c.updated_at DESC, c.id DESC`,
      params
    );
    res.json({
      success: true,
      data: {
        items: rows.rows.map((r) => ({ ...r, runtime_status: 'registry_only' })),
        meta: RUNTIME_META,
      },
    });
  } catch (e) { next(e); }
});

// 订单→能力匹配(v1.1: 标准工序链 × 能力目录 code 精确匹配; 缺失明确提示需登记)
router.get('/fab/orders/:id/capability-match', requireFabRead, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const orgId = user.orgId;
    const woId = Number(req.params.id);
    if (!Number.isFinite(woId)) return res.status(400).json({ success: false, error: 'INVALID_ORDER_ID' });
    const wo = await pool.query(
      'SELECT id, product_name, status, qty FROM booth_work_orders WHERE id = $1 AND org_id = $2',
      [woId, orgId]
    );
    if (!wo.rows.length) return res.status(404).json({ success: false, error: 'ORDER_NOT_FOUND' });
    const caps = await pool.query(
      `SELECT DISTINCT ON (capability_code) id, station_id, capability_code, name, status, estimated_time, rate
       FROM station_capabilities WHERE org_id = $1 AND status = 'active' AND capability_code = ANY($2)
       ORDER BY capability_code, updated_at DESC`,
      [orgId, STAGE_REQUIREMENTS.map((s) => s.stage)]
    );
    const byStage = new Map<string, any>(caps.rows.map((c) => [c.capability_code, c]));
    const requirements = STAGE_REQUIREMENTS.map((r) => {
      const cap = byStage.get(r.stage) || null;
      return {
        stage: r.stage,
        label: r.label,
        matched: !!cap,
        capability: cap,
      };
    });
    const missingLabels = requirements.filter((r) => !r.matched).map((r) => `需登记 ${r.label}能力`);
    const matchedCount = requirements.filter((r) => r.matched).length;
    res.json({
      success: true,
      data: {
        order: wo.rows[0],
        requirements,
        missing_labels: missingLabels,
        coverage: `${matchedCount}/${requirements.length}`,
        meta: RUNTIME_META,
      },
    });
  } catch (e) { next(e); }
});

// Station 能力槽位(详情卡片: 已登记/可用/停用)
router.get('/fab/station/:id/capabilities', requireFabRead, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const orgId = user.orgId;
    const stationId = Number(req.params.id);
    if (!Number.isFinite(stationId)) return res.status(400).json({ success: false, error: 'INVALID_STATION_ID' });
    const st = await pool.query('SELECT id, code, name, status FROM booth_stations WHERE id = $1 AND org_id = $2', [stationId, orgId]);
    if (!st.rows.length) return res.status(404).json({ success: false, error: 'STATION_NOT_FOUND' });
    const mounts = await pool.query(
      `SELECT c.*, m.state AS mount_state, m.mount_at
       FROM station_capability_mounts m
       JOIN station_capabilities c ON c.id = m.capability_id
       WHERE m.org_id = $1 AND m.station_id = $2
       ORDER BY m.mount_at DESC`,
      [orgId, stationId]
    );
    res.json({ success: true, data: { station: st.rows[0], mounts: mounts.rows, meta: RUNTIME_META } });
  } catch (e) { next(e); }
});

export default router;
