/**
 * dexx FAB 基础执行路由 (TECH-DEBT-1 从 dexx-modules.ts 拆出)
 * 覆盖: 工序报工 / 工单完成(QC触发) / 产线阶段流转 / 产线看板 / 良品率追踪 / QC 执行
 * 挂载: /api/booth/dexx (见 dexx-modules.ts 聚合)
 */
import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireHat } from '../auth.js';
import type { JwtPayload } from '../auth.js';
import { createProfitSnapshot } from '../services/profit-service.js';

const router = Router();

// 状态归一化：将新旧状态统一映射
function normalizeStatus(status: string): string {
  const map: Record<string, string> = {
    pending: 'pending',
    accepted: 'accepted',
    preparing: 'preparing',
    in_progress: 'preparing',
    completed: 'completed',
    cancelled: 'cancelled',
    Pending: 'pending',
    Dispatched: 'pending',
    Accepted: 'accepted',
    Running: 'preparing',
    Completed: 'completed',
    Failed: 'cancelled',
    Cancelled: 'cancelled',
    Archived: 'completed',
  };
  return map[status] || status;
}

// ====== FAB: Report work (工序报工) ======
router.post('/fab/report', requireHat('FAB'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const user = (req as any).user as JwtPayload;
    const { workOrderId, seq, opName, qtyCompleted, remark, equipmentId } = req.body;

    await client.query('BEGIN');

    // Verify work order is in_progress
    const woRes = await client.query(
      'SELECT * FROM booth_work_orders WHERE id = $1 AND org_id = $2 FOR UPDATE',
      [workOrderId, user.orgId]
    );
    if (!woRes.rows.length || normalizeStatus(woRes.rows[0].status) !== 'preparing') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Work order not in progress', code: 'INVALID_STATE' });
    }

    // Check if this op already reported
    const existing = await client.query(
      'SELECT id FROM booth_fab_operations WHERE org_id = $1 AND work_order_id = $2 AND seq = $3',
      [user.orgId, workOrderId, seq]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Operation already reported', code: 'DUPLICATE' });
    }

    // Validate equipment belongs to org if provided (FAB-MES-01)
    if (equipmentId) {
      const eqRes = await client.query(
        'SELECT id FROM booth_equipment WHERE id = $1 AND org_id = $2',
        [equipmentId, user.orgId]
      );
      if (!eqRes.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'Equipment not found', code: 'EQUIPMENT_NOT_FOUND' });
      }
    }

    // Insert fab operation (completed_at=NOW(): OEE 按完成时间聚合报工产出)
    const foRes = await client.query(
      `INSERT INTO booth_fab_operations (org_id, work_order_id, seq, name, reported_qty, operator_id, equipment_id, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`,
      [user.orgId, workOrderId, seq, opName, qtyCompleted, user.userId!, equipmentId || null]
    );

    await client.query('COMMIT');
    res.json({ success: true, data: foRes.rows[0] });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// ====== FAB: Complete work order (triggers QC) ======
router.post('/fab/complete', requireHat('FAB'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const user = (req as any).user as JwtPayload;
    const { workOrderId } = req.body;

    await client.query('BEGIN');

    const woRes = await client.query(
      'SELECT * FROM booth_work_orders WHERE id = $1 AND org_id = $2 FOR UPDATE',
      [workOrderId, user.orgId]
    );
    if (!woRes.rows.length || normalizeStatus(woRes.rows[0].status) !== 'preparing') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Work order not in progress', code: 'INVALID_STATE' });
    }

    // Update work order status
    await client.query(
      `UPDATE booth_work_orders SET status = 'completed', completed_at = NOW() WHERE id = $1`,
      [workOrderId]
    );

    // Auto-create QC task
    await client.query(
      `INSERT INTO booth_quality_checks (org_id, work_order_id)
       VALUES ($1, $2)`,
      [user.orgId, workOrderId]
    );

    await client.query('COMMIT');
    res.json({ success: true, data: { workOrderId, message: 'Work order completed, QC task created' } });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// ====== FAB: 产线阶段流转 ======
// 产线阶段: preprocessing(前置工序) → production(制作) → packaging(包装) → sorting(分拣)
const STAGE_ORDER = ['preprocessing', 'production', 'packaging', 'sorting'];
const STAGE_LABELS: Record<string, string> = {
  preprocessing: '前置工序',
  production: '制作',
  packaging: '包装',
  sorting: '分拣',
};

router.post('/fab/stage/advance', requireHat('FAB'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const user = (req as any).user as JwtPayload;
    const { workOrderId, targetStage, remark } = req.body;

    if (!workOrderId || !targetStage) {
      return res.status(400).json({ success: false, error: 'workOrderId and targetStage required', code: 'MISSING_PARAMS' });
    }

    if (!STAGE_ORDER.includes(targetStage)) {
      return res.status(400).json({ success: false, error: `Invalid stage: ${targetStage}`, code: 'INVALID_STAGE' });
    }

    await client.query('BEGIN');

    const woRes = await client.query(
      'SELECT * FROM booth_work_orders WHERE id = $1 AND org_id = $2 FOR UPDATE',
      [workOrderId, user.orgId]
    );
    if (!woRes.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Work order not found', code: 'NOT_FOUND' });
    }

    const wo = woRes.rows[0];
    if (normalizeStatus(wo.status) !== 'preparing') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Work order not in progress', code: 'INVALID_STATE' });
    }

    const currentStage = wo.production_stage || 'preprocessing';
    const currentIdx = STAGE_ORDER.indexOf(currentStage);
    const targetIdx = STAGE_ORDER.indexOf(targetStage);

    if (targetIdx <= currentIdx) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: `Cannot move from ${STAGE_LABELS[currentStage]} to ${STAGE_LABELS[targetStage]}`,
        code: 'INVALID_TRANSITION'
      });
    }

    // Update stage
    await client.query(
      `UPDATE booth_work_orders SET production_stage = $1 WHERE id = $2`,
      [targetStage, workOrderId]
    );

    // Record stage transition in operations log
    const equipmentId = req.body.equipmentId || null;
    if (equipmentId) {
      const eqRes = await client.query(
        'SELECT id FROM booth_equipment WHERE id = $1 AND org_id = $2',
        [equipmentId, user.orgId]
      );
      if (!eqRes.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: 'Equipment not found', code: 'EQUIPMENT_NOT_FOUND' });
      }
    }
    await client.query(
      `INSERT INTO booth_fab_operations (org_id, work_order_id, seq, name, reported_qty, operator_id, equipment_id, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [user.orgId, workOrderId, targetIdx + 100, `stage_${targetStage}`, 0, user.userId!, equipmentId]
    );

    await client.query('COMMIT');
    res.json({
      success: true,
      data: {
        workOrderId,
        fromStage: currentStage,
        toStage: targetStage,
        fromLabel: STAGE_LABELS[currentStage],
        toLabel: STAGE_LABELS[targetStage],
        message: `已流转至${STAGE_LABELS[targetStage]}产线`
      }
    });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// 获取产线阶段定义
router.get('/fab/stages', requireAuth, async (req, res) => {
  res.json({
    success: true,
    data: {
      stages: STAGE_ORDER.map((s, i) => ({
        value: s,
        label: STAGE_LABELS[s],
        order: i
      }))
    }
  });
});

// 产线看板 - 获取所有进行中的工单按产线分组
router.get('/fab/dashboard', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const result = await pool.query(
      `SELECT wo.id, wo.job_id, wo.job_type, wo.product_name, wo.qty, wo.status, wo.progress,
              wo.production_stage, wo.priority, wo.sla_minutes, wo.dispatched_at,
              wo.started_at, wo.completed_at, wo.created_at,
              u.name as operator_name, st.name as station_name
       FROM booth_work_orders wo
       LEFT JOIN booth_users u ON wo.operator_id = u.id
       LEFT JOIN booth_stations st ON wo.station_id = st.id
       WHERE wo.org_id = $1 AND wo.status IN ('accepted', 'in_progress', 'preparing', 'Accepted', 'Running')
       ORDER BY wo.priority DESC NULLS LAST, wo.created_at ASC`,
      [user.orgId]
    );
    res.json({ success: true, data: { orders: result.rows } });
  } catch (err) {
    next(err);
  }
});

// ====== 良品率追踪 ======
// 记录良品率
router.post('/fab/yield/record', requireHat('FAB'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { workOrderId, productionStage, inputQty, goodQty, defectQty = 0, scrapQty = 0, defectReason } = req.body;

    if (!workOrderId || !productionStage || !inputQty || goodQty === undefined) {
      return res.status(400).json({ success: false, error: '缺少必要参数', code: 'MISSING_PARAMS' });
    }

    const totalOutput = goodQty + defectQty + scrapQty;
    if (totalOutput > inputQty) {
      return res.status(400).json({ success: false, error: '产出数量不能超过投入数量', code: 'INVALID_QTY' });
    }

    const yieldRate = inputQty > 0 ? ((goodQty / inputQty) * 100).toFixed(2) : 0;

    const result = await pool.query(
      `INSERT INTO booth_yield_records (org_id, work_order_id, production_stage, input_qty, good_qty, defect_qty, scrap_qty, yield_rate, defect_reason, operator_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [user.orgId, workOrderId, productionStage, inputQty, goodQty, defectQty, scrapQty, yieldRate, defectReason, user.userId]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// 获取所有良品率记录 (必须在 :workOrderId 之前)
router.get('/fab/yield/all', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;

    const result = await pool.query(
      `SELECT yr.*, u.name as operator_name
       FROM booth_yield_records yr
       LEFT JOIN booth_users u ON yr.operator_id = u.id
       WHERE yr.org_id = $1
       ORDER BY yr.created_at DESC
       LIMIT 100`,
      [user.orgId]
    );

    res.json({ success: true, data: { records: result.rows } });
  } catch (err) {
    next(err);
  }
});

// 获取良品率统计 (必须在 :workOrderId 之前)
router.get('/fab/yield/stats', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { days = 7 } = req.query;

    const result = await pool.query(
      `SELECT
        production_stage,
        COUNT(*) as record_count,
        SUM(input_qty) as total_input,
        SUM(good_qty) as total_good,
        SUM(defect_qty) as total_defect,
        SUM(scrap_qty) as total_scrap,
        ROUND(AVG(yield_rate), 2) as avg_yield_rate
       FROM booth_yield_records
       WHERE org_id = $1 AND created_at >= NOW() - ($2::int || ' days')::INTERVAL
       GROUP BY production_stage
       ORDER BY MIN(created_at)`,
      [user.orgId, days]
    );

    // Calculate overall stats
    const overall = result.rows.reduce((acc, row) => ({
      totalInput: acc.totalInput + Number(row.total_input),
      totalGood: acc.totalGood + Number(row.total_good),
      totalDefect: acc.totalDefect + Number(row.total_defect),
      totalScrap: acc.totalScrap + Number(row.total_scrap),
    }), { totalInput: 0, totalGood: 0, totalDefect: 0, totalScrap: 0 });

    const overallYieldRate = overall.totalInput > 0
      ? ((overall.totalGood / overall.totalInput) * 100).toFixed(2)
      : 0;

    res.json({
      success: true,
      data: {
        byStage: result.rows,
        overall: { ...overall, yieldRate: overallYieldRate }
      }
    });
  } catch (err) {
    next(err);
  }
});

// 获取工单的良品率记录 (参数化路由放在最后)
router.get('/fab/yield/:workOrderId', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { workOrderId } = req.params;

    const result = await pool.query(
      `SELECT yr.*, u.name as operator_name
       FROM booth_yield_records yr
       LEFT JOIN booth_users u ON yr.operator_id = u.id
       WHERE yr.org_id = $1 AND yr.work_order_id = $2
       ORDER BY yr.created_at ASC`,
      [user.orgId, workOrderId]
    );

    res.json({ success: true, data: { records: result.rows } });
  } catch (err) {
    next(err);
  }
});

// ====== FAB: QC execute ======
router.post('/fab/qc/execute', requireHat('FAB'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const user = (req as any).user as JwtPayload;
    const { qcId, passed, passedQty, failedQty, remark, detail } = req.body;

    await client.query('BEGIN');

    const qcRes = await client.query(
      'SELECT * FROM booth_quality_checks WHERE id = $1 AND org_id = $2 FOR UPDATE',
      [qcId, user.orgId]
    );
    if (!qcRes.rows.length || qcRes.rows[0].result !== 'pass') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'QC not pending', code: 'INVALID_STATE' });
    }

    const newResult = passed ? 'pass' : 'fail';
    await client.query(
      `UPDATE booth_quality_checks SET result = $1, qty_pass = $2, qty_reject = $3, reject_reason = $4, inspector_id = $5, checked_at = NOW()
       WHERE id = $6`,
      [newResult, passedQty || 0, failedQty || 0, remark, user.userId!, qcId]
    );

    // If QC passed, create profit snapshot
    if (passed) {
      const wo = qcRes.rows[0];
      const fulRes = await client.query(
        'SELECT id FROM booth_fulfillments WHERE work_order_id = $1 AND org_id = $2',
        [wo.work_order_id, user.orgId]
      );
      if (fulRes.rows.length > 0) {
        await createProfitSnapshot(user.orgId, fulRes.rows[0].id, wo.work_order_id);
      }
    }

    await client.query('COMMIT');
    const updated = await pool.query('SELECT * FROM booth_quality_checks WHERE id = $1', [qcId]);
    res.json({ success: true, data: updated.rows[0] });
  } catch (err) { await client.query('ROLLBACK'); next(err); }
  finally { client.release(); }
});

// ====== FAB: Get my QC pending ======
// Pending QC: work orders completed but no QC record, or QC result=fail (need re-inspection)
router.get('/fab/qc/pending', requireHat('FAB'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT wo.id as work_order_id, wo.fulfillment_id, wo.product_name, wo.qty as wo_qty,
              wo.completed_at, qc.id as qc_id, qc.result as qc_result, qc.qty_pass, qc.qty_reject
       FROM booth_work_orders wo
       LEFT JOIN booth_quality_checks qc ON qc.work_order_id = wo.id
       WHERE wo.org_id = $1 AND wo.status = 'completed'
         AND (qc.id IS NULL OR qc.result = 'fail')
       ORDER BY wo.completed_at`,
      [user.orgId]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

export default router;
