/**
 * dexx FAB-MES 质量追溯链路由 (FAB-MES-02)
 * 覆盖: 追溯查询(正/反向) / 单批次详情 / 缺陷 TOP 分析 / 质检任务列表(多关卡)
 * 挂载: /api/booth/dexx (见 dexx-modules.ts 聚合)
 * 红线: 追溯链数据由业务动作自动写入(领料/完工/质检), 本文件只读, 不提供手工补录
 * 鉴权: 复用 requireFabRead (FAB 帽全权; du/dx/dex/dm/em 管理角色只读放行)
 */
import { Router } from 'express';
import { pool } from '../db.js';
import type { JwtPayload } from '../auth.js';
import { requireFabRead } from './dexx-fab-mes.js';

const router = Router();

const userOf = (req: any): JwtPayload => (req as any).user as JwtPayload;

/** 组装工单级追溯链: consume(领料) / operations(报工) / qc(质检) / output_batches(产出) + 数据缺口 */
async function buildWorkOrderChain(orgId: number, woIds: number[]): Promise<any[]> {
  if (!woIds.length) return [];
  const wos = await pool.query(
    `SELECT id, product_name, status, qty, operator_id, station_id, priority, created_at, started_at, completed_at
     FROM booth_work_orders WHERE org_id = $1 AND id = ANY($2) ORDER BY id`,
    [orgId, woIds]
  );
  const consumed = await pool.query(
    `SELECT tl.work_order_id, tl.qty, tl.operator_id, tl.created_at,
            sb.batch_no, sb.sku_id, s.name AS sku_name
     FROM booth_trace_links tl
     LEFT JOIN booth_stock_batches sb ON sb.id = tl.batch_id
     LEFT JOIN booth_skus s ON s.id = sb.sku_id
     WHERE tl.org_id = $1 AND tl.work_order_id = ANY($2) AND tl.relation_type = 'consume'
     ORDER BY tl.created_at ASC`,
    [orgId, woIds]
  );
  const ops = await pool.query(
    `SELECT fo.work_order_id, fo.seq, fo.name, fo.status, fo.reported_qty, fo.completed_at, fo.equipment_id,
            u.name AS operator_name, e.code AS equipment_code, e.name AS equipment_name
     FROM booth_fab_operations fo
     LEFT JOIN booth_users u ON u.id = fo.operator_id
     LEFT JOIN booth_equipment e ON e.id = fo.equipment_id
     WHERE fo.org_id = $1 AND fo.work_order_id = ANY($2)
     ORDER BY fo.seq ASC`,
    [orgId, woIds]
  );
  const qcs = await pool.query(
    `SELECT qc.id, qc.work_order_id, qc.check_type, qc.stage, qc.result, qc.qty_pass, qc.qty_reject,
            qc.reject_reason, qc.checked_at, u.name AS inspector_name
     FROM booth_quality_checks qc
     LEFT JOIN booth_users u ON u.id = qc.inspector_id
     WHERE qc.org_id = $1 AND qc.work_order_id = ANY($2)
     ORDER BY qc.created_at ASC`,
    [orgId, woIds]
  );
  const outs = await pool.query(
    `SELECT * FROM booth_output_batches WHERE org_id = $1 AND work_order_id = ANY($2) ORDER BY created_at ASC`,
    [orgId, woIds]
  );

  // [BOOTH-PK-03] 遥测联动: 工单涉及设备近 24h 自动采集摘要(source=auto; 无数据如实 N/A)
  const chainEqIds = Array.from(new Set(ops.rows.map((o: any) => o.equipment_id).filter((v: any) => v !== null)));
  const teleByEq = new Map<number, any>();
  if (chainEqIds.length) {
    const tele = await pool.query(
      `SELECT equipment_id, COUNT(*)::int AS auto_points_24h, MAX(received_at) AS last_received_at
       FROM equipment_telemetry
       WHERE org_id = $1 AND equipment_id = ANY($2) AND source = 'auto' AND received_at >= NOW() - INTERVAL '24 hours'
       GROUP BY equipment_id`,
      [orgId, chainEqIds]
    );
    for (const r of tele.rows) teleByEq.set(Number(r.equipment_id), r);
  }

  return wos.rows.map((wo: any) => {
    const consumedRows = consumed.rows.filter((c: any) => c.work_order_id === wo.id);
    const opRows = ops.rows.filter((o: any) => o.work_order_id === wo.id);
    const qcRows = qcs.rows.filter((q: any) => q.work_order_id === wo.id);
    const outRows = outs.rows.filter((o: any) => o.work_order_id === wo.id);
    // 数据缺口如实标注, 不造假链
    const gaps: string[] = [];
    if (!consumedRows.length) gaps.push('无领料追溯记录(可能早于追溯功能上线或未走工单领料)');
    if (!opRows.length) gaps.push('无报工记录');
    if (!qcRows.length) gaps.push('无质检记录');
    if (!outRows.length) gaps.push('无产出批次(工单未完工)');
    // 遥测联动(按工单涉及设备聚合)
    const woEqIds = Array.from(new Set(opRows.map((o: any) => o.equipment_id).filter((v: any) => v !== null)));
    const woTele = woEqIds.map((id: number) => ({
      equipment_id: id,
      auto_points_24h: teleByEq.get(id)?.auto_points_24h ?? 0,
      last_received_at: teleByEq.get(id)?.last_received_at ?? null,
    }));
    const woAutoPoints = woTele.reduce((a: number, r: any) => a + r.auto_points_24h, 0);
    return {
      work_order: wo,
      consumed: consumedRows,
      operations: opRows,
      qc: qcRows,
      output_batches: outRows,
      gaps,
      telemetry_link: {
        equipment_ids: woEqIds,
        equipments: woTele,
        auto_points_24h: woAutoPoints,
        available: woAutoPoints > 0,
        note: woAutoPoints > 0 ? '设备自动采集数据已联动追溯链(source=auto, 未经人工报工)' : 'N/A: 工单涉及设备近 24h 无自动采集数据',
      },
    };
  });
}

/** 原料批次正向追溯: 该批料流入哪些工单/成品批次 */
async function forwardFromMaterial(orgId: number, batchId: number): Promise<{ chain: any[]; downstream: any[]; gaps: string[] }> {
  const links = await pool.query(
    `SELECT DISTINCT tl.work_order_id FROM booth_trace_links tl
     WHERE tl.org_id = $1 AND tl.batch_id = $2 AND tl.relation_type = 'consume'`,
    [orgId, batchId]
  );
  const woIds = links.rows.map((r: any) => r.work_order_id);
  if (!woIds.length) return { chain: [], downstream: [], gaps: ['该原料批次暂无领料消耗记录'] };
  const chain = await buildWorkOrderChain(orgId, woIds);
  const downstream = chain.flatMap((c: any) =>
    (c.output_batches || []).map((ob: any) => ({
      work_order_id: c.work_order.id,
      product_name: c.work_order.product_name,
      output_batch_no: ob.batch_no,
      qty: ob.qty,
      quality_status: ob.quality_status,
    }))
  );
  return { chain, downstream, gaps: [] };
}

// ====== 追溯查询: { batch_no } 或 { work_order_id } -> 全链 ======
router.post('/fab/trace/query', requireFabRead, async (req, res, next) => {
  try {
    const user = userOf(req);
    const orgId = user.orgId;
    const { batch_no: batchNo, work_order_id: workOrderId } = req.body || {};
    if (!batchNo && !workOrderId) {
      return res.status(400).json({ success: false, error: 'batch_no or work_order_id required', code: 'INVALID_PARAM' });
    }

    if (batchNo) {
      const out = await pool.query(
        `SELECT ob.*, wo.product_name, wo.status AS wo_status
         FROM booth_output_batches ob JOIN booth_work_orders wo ON wo.id = ob.work_order_id
         WHERE ob.org_id = $1 AND ob.batch_no = $2`,
        [orgId, batchNo]
      );
      const mat = await pool.query(
        `SELECT sb.*, s.name AS sku_name
         FROM booth_stock_batches sb LEFT JOIN booth_skus s ON s.id = sb.sku_id
         WHERE sb.org_id = $1 AND sb.batch_no = $2`,
        [orgId, batchNo]
      );

      if (!out.rows.length && !mat.rows.length) {
        return res.json({ success: true, data: { kind: 'not_found', batch_no: batchNo, chain: [], downstream: [], gaps: ['未找到该批次(成品批次或原料批次)'] } });
      }

      const data: any = { batch_no: batchNo, chain: [], downstream: [], gaps: [] };
      if (out.rows.length) {
        data.kind = 'output';
        data.batch = { ...out.rows[0], batch_kind: 'output' };
        data.chain = await buildWorkOrderChain(orgId, [out.rows[0].work_order_id]);
        data.gaps = data.chain.flatMap((c: any) => c.gaps);
      } else {
        const fw = await forwardFromMaterial(orgId, mat.rows[0].id);
        data.kind = 'material';
        data.batch = { ...mat.rows[0], batch_kind: 'material' };
        data.chain = fw.chain;
        data.downstream = fw.downstream;
        data.gaps = fw.gaps;
      }
      return res.json({ success: true, data });
    }

    // work_order_id 直查
    const woChk = await pool.query('SELECT id FROM booth_work_orders WHERE id = $1 AND org_id = $2', [workOrderId, orgId]);
    if (!woChk.rows.length) {
      return res.status(404).json({ success: false, error: 'Work order not found', code: 'NOT_FOUND' });
    }
    const chain = await buildWorkOrderChain(orgId, [Number(workOrderId)]);
    res.json({
      success: true,
      data: {
        kind: 'work_order',
        work_order_id: Number(workOrderId),
        chain,
        downstream: chain.flatMap((c: any) =>
          (c.output_batches || []).map((ob: any) => ({
            work_order_id: c.work_order.id,
            product_name: c.work_order.product_name,
            output_batch_no: ob.batch_no,
            qty: ob.qty,
            quality_status: ob.quality_status,
          }))
        ),
        gaps: chain.flatMap((c: any) => c.gaps),
      },
    });
  } catch (err) { next(err); }
});

// ====== 单批次详情: 含质检结果/设备/操作员/时间线 ======
router.get('/fab/trace/batch/:batchNo', requireFabRead, async (req, res, next) => {
  try {
    const user = userOf(req);
    const orgId = user.orgId;
    const batchNo = req.params.batchNo;

    const out = await pool.query(
      `SELECT ob.*, wo.product_name, wo.status AS wo_status
       FROM booth_output_batches ob JOIN booth_work_orders wo ON wo.id = ob.work_order_id
       WHERE ob.org_id = $1 AND ob.batch_no = $2`,
      [orgId, batchNo]
    );
    const mat = await pool.query(
      `SELECT sb.*, s.name AS sku_name
       FROM booth_stock_batches sb LEFT JOIN booth_skus s ON s.id = sb.sku_id
       WHERE sb.org_id = $1 AND sb.batch_no = $2`,
      [orgId, batchNo]
    );

    if (!out.rows.length && !mat.rows.length) {
      return res.status(404).json({ success: false, error: 'Batch not found', code: 'NOT_FOUND' });
    }

    const data: any = { batch_no: batchNo };
    if (out.rows.length) {
      const ob = out.rows[0];
      data.batch_kind = 'output';
      data.batch = ob;
      const chain = await buildWorkOrderChain(orgId, [ob.work_order_id]);
      const c = chain[0] || null;
      data.work_order = c?.work_order || null;
      data.operations = c?.operations || [];
      data.qc = c?.qc || [];
      data.consumed = c?.consumed || [];
      data.gaps = c?.gaps || [];
      data.timeline = [
        { node: 'produce', label: '完工产出', at: ob.created_at, detail: `产出批次 ${ob.batch_no} x ${ob.qty}` },
        ...(c?.operations || []).map((o: any) => ({ node: 'operation', label: `报工·${o.name || o.seq}`, at: o.completed_at, detail: `${o.operator_name || '-'} / ${o.equipment_code || '无设备'} / ${o.reported_qty ?? '-'}` })),
        ...(c?.qc || []).map((q: any) => ({ node: 'qc', label: `质检·${q.check_type || 'fqc'}`, at: q.checked_at, detail: `${q.result} ${q.reject_reason ? '(' + q.reject_reason + ')' : ''} by ${q.inspector_name || '-'}` })),
        ...(c?.consumed || []).map((cm: any) => ({ node: 'consume', label: '领料', at: cm.created_at, detail: `${cm.batch_no || '-'} ${cm.sku_name || ''} x ${cm.qty}` })),
      ].filter((t: any) => t.at).sort((a: any, b: any) => new Date(a.at).getTime() - new Date(b.at).getTime());
    } else {
      const sb = mat.rows[0];
      data.batch_kind = 'material';
      data.batch = sb;
      const fw = await forwardFromMaterial(orgId, sb.id);
      data.downstream = fw.downstream;
      data.gaps = fw.gaps;
      data.timeline = [{ node: 'receive', label: '来料入库', at: sb.received_at || sb.created_at, detail: `${sb.batch_no} ${sb.sku_name || ''} 余量 ${sb.qty}` }];
    }
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

// ====== 缺陷类型 TOP 排行 (SPC 简化版): TOP / 趋势 / 设备分布 / 人员分布 ======
router.get('/fab/trace/defect/top', requireFabRead, async (req, res, next) => {
  try {
    const user = userOf(req);
    const orgId = user.orgId;
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 86400_000);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid from/to', code: 'INVALID_PARAM' });
    }
    const range = [orgId, from.toISOString(), to.toISOString()];
    const cond = `qc.org_id = $1 AND qc.result IN ('fail', 'reject') AND qc.reject_reason IS NOT NULL AND qc.checked_at >= $2 AND qc.checked_at <= $3`;

    const top = await pool.query(
      `SELECT qc.reject_reason, COUNT(*)::int AS cnt, COALESCE(SUM(qc.qty_reject), 0)::float AS reject_qty
       FROM booth_quality_checks qc WHERE ${cond}
       GROUP BY qc.reject_reason ORDER BY cnt DESC LIMIT 10`,
      range
    );
    const trend = await pool.query(
      `SELECT to_char(date_trunc('day', qc.checked_at), 'YYYY-MM-DD') AS day, COUNT(*)::int AS cnt, COALESCE(SUM(qc.qty_reject), 0)::float AS reject_qty
       FROM booth_quality_checks qc WHERE ${cond}
       GROUP BY 1 ORDER BY 1`,
      range
    );
    const byEquipment = await pool.query(
      `SELECT e.code, e.name, COUNT(DISTINCT qc.id)::int AS cnt
       FROM booth_quality_checks qc
       JOIN booth_work_orders wo ON wo.id = qc.work_order_id
       JOIN booth_fab_operations fo ON fo.work_order_id = wo.id AND fo.equipment_id IS NOT NULL
       JOIN booth_equipment e ON e.id = fo.equipment_id
       WHERE ${cond}
       GROUP BY e.id, e.code, e.name ORDER BY cnt DESC LIMIT 10`,
      range
    );
    const byInspector = await pool.query(
      `SELECT COALESCE(u.name, '未署名') AS inspector, COUNT(*)::int AS cnt
       FROM booth_quality_checks qc LEFT JOIN booth_users u ON u.id = qc.inspector_id
       WHERE ${cond}
       GROUP BY u.name ORDER BY cnt DESC LIMIT 10`,
      range
    );

    res.json({
      success: true,
      data: { from: from.toISOString(), to: to.toISOString(), top: top.rows, trend: trend.rows, by_equipment: byEquipment.rows, by_inspector: byInspector.rows },
    });
  } catch (err) { next(err); }
});

// ====== 质检任务列表: 待检 + 已检, 支持关卡筛选 (FAB-MES-02 多关卡) ======
router.get('/fab/qc/list', requireFabRead, async (req, res, next) => {
  try {
    const user = userOf(req);
    const orgId = user.orgId;
    const { check_type: checkType, pending } = req.query;
    const params: any[] = [orgId];
    let where = 'qc.org_id = $1';
    if (checkType && checkType !== 'all') {
      params.push(checkType);
      where += ` AND qc.check_type = $${params.length}`;
    }
    if (pending === '1' || pending === 'true') {
      where += ` AND qc.result IN ('pending', 'fail', 'hold')`;
    }
    const r = await pool.query(
      `SELECT qc.id, qc.work_order_id, qc.check_type, qc.stage, qc.result, qc.qty_pass, qc.qty_reject,
              qc.reject_reason, qc.inspector_id, qc.checked_at, qc.created_at,
              u.name AS inspector_name, wo.product_name, wo.status AS wo_status, wo.qty AS wo_qty
       FROM booth_quality_checks qc
       LEFT JOIN booth_users u ON u.id = qc.inspector_id
       LEFT JOIN booth_work_orders wo ON wo.id = qc.work_order_id
       WHERE ${where}
       ORDER BY qc.created_at DESC LIMIT 200`,
      params
    );
    res.json({ success: true, data: r.rows });
  } catch (err) { next(err); }
});

export default router;
