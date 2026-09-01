import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole, requireHat } from '../auth.js';
import type { JwtPayload } from '../auth.js';
import { createProfitSnapshot } from '../services/profit-service.js';
import { broadcast } from '../sse.js';

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
    const { workOrderId, seq, opName, qtyCompleted, remark } = req.body;

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

    // Insert fab operation
    const foRes = await client.query(
      `INSERT INTO booth_fab_operations (org_id, work_order_id, seq, name, reported_qty, operator_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [user.orgId, workOrderId, seq, opName, qtyCompleted, user.userId!]
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
    await client.query(
      `INSERT INTO booth_fab_operations (org_id, work_order_id, seq, name, reported_qty, operator_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user.orgId, workOrderId, targetIdx + 100, `stage_${targetStage}`, 0, user.userId!]
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

// ====== WH: Stocktake create ======
router.post('/wh/stocktakes', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { remark, skuIds } = req.body;
    const stNo = `ST${Date.now()}${Math.floor(Math.random() * 1000)}`;

    // Build initial lines from skuIds (enrich server-side)
    const initLines: any[] = [];
    if (Array.isArray(skuIds) && skuIds.length > 0) {
      const skuRows = await pool.query(
        `SELECT id, name FROM booth_skus WHERE id = ANY($1) AND org_id = $2`,
        [skuIds, user.orgId]
      );
      for (const sku of skuRows.rows) {
        // Get bookQty from inventory
        const invRow = await pool.query(
          `SELECT qty_on_hand FROM booth_inventory WHERE org_id = $1 AND sku_id = $2`,
          [user.orgId, sku.id]
        );
        const bookQty = invRow.rows[0] ? parseFloat(invRow.rows[0].qty_on_hand) : 0;
        initLines.push({ skuId: sku.id, skuName: sku.name, bookQty, actualQty: null, diffQty: null, batchNo: '' });
      }
    }

    const r = await pool.query(
      `INSERT INTO booth_stocktake_orders (org_id, st_no, status, lines, created_by, remark)
       VALUES ($1, $2, 'draft', $3, $4, $5) RETURNING *`,
      [user.orgId, stNo, JSON.stringify(initLines), user.userId!, remark]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== WH: Stocktake submit ======
router.post('/wh/stocktakes/:id/submit', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { lines } = req.body;

    // Validate lines
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ success: false, error: 'Submit failed: lines is empty', code: 'EMPTY_LINES' });
    }

    // Enrich each line server-side
    const enrichedLines: any[] = [];
    for (const line of lines) {
      const skuId = line.skuId || line.sku_id;
      if (!skuId) continue;

      // Get SKU name
      const skuRow = await pool.query(`SELECT name FROM booth_skus WHERE id = $1`, [skuId]);
      const skuName = skuRow.rows[0]?.name || '';

      // Get bookQty: if batchNo provided, sum from stock_batches; otherwise from inventory
      let bookQty: number;
      const batchNo = line.batchNo || '';
      if (batchNo) {
        const batchRow = await pool.query(
          `SELECT COALESCE(SUM(qty), 0) as total FROM booth_stock_batches WHERE org_id = $1 AND sku_id = $2 AND batch_no = $3`,
          [user.orgId, skuId, batchNo]
        );
        bookQty = parseFloat(batchRow.rows[0].total);
      } else {
        const invRow = await pool.query(
          `SELECT qty_on_hand FROM booth_inventory WHERE org_id = $1 AND sku_id = $2`,
          [user.orgId, skuId]
        );
        bookQty = invRow.rows[0] ? parseFloat(invRow.rows[0].qty_on_hand) : 0;
      }

      const actualQty = parseFloat(line.actualQty) || 0;
      const diffQty = actualQty - bookQty;

      enrichedLines.push({ skuId, skuName, bookQty, actualQty, diffQty, batchNo });
    }

    const r = await pool.query(
      `UPDATE booth_stocktake_orders SET lines = $1, status = 'submitted', submitted_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND org_id = $3 AND status = 'draft' RETURNING *`,
      [JSON.stringify(enrichedLines), req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot submit: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== WH: My stocktakes ======
router.get('/wh/stocktakes', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query('SELECT * FROM booth_stocktake_orders WHERE org_id = $1 ORDER BY created_at DESC', [user.orgId]);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== WH: Batches view ======
router.get('/wh/batches', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const skuId = req.query.skuId as string;
    let where = 'WHERE b.org_id = $1'; const params: any[] = [user.orgId]; let idx = 2;
    if (skuId) { where += ` AND b.sku_id = $${idx}`; params.push(skuId); idx++; }
    const r = await pool.query(
      `SELECT b.*, s.name as sku_name, s.sku_code
       FROM booth_stock_batches b
       JOIN booth_skus s ON s.id = b.sku_id
       ${where} ORDER BY b.expiry_date ASC NULLS LAST`,
      params
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== DL: Queue (assigned tasks waiting to accept) ======
router.get('/dl/queue', requireHat('DL'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT * FROM booth_dl_tasks WHERE org_id = $1 AND assignee_id = $2 AND status = 'assigned' ORDER BY created_at`,
      [user.orgId, user.userId!]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== DL: Active (accepted/picked/delivering) ======
router.get('/dl/active', requireHat('DL'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT * FROM booth_dl_tasks WHERE org_id = $1 AND assignee_id = $2 AND status IN ('accepted','picked','delivering') ORDER BY updated_at DESC`,
      [user.orgId, user.userId!]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== DL: History (signed/exception/cancelled) ======
router.get('/dl/history', requireHat('DL'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT * FROM booth_dl_tasks WHERE org_id = $1 AND assignee_id = $2 AND status IN ('signed','exception','cancelled') ORDER BY updated_at DESC`,
      [user.orgId, user.userId!]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== DL: Get my tasks (all) ======
router.get('/dl/tasks', requireHat('DL'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT * FROM booth_dl_tasks WHERE org_id = $1 AND assignee_id = $2 ORDER BY created_at DESC`,
      [user.orgId, user.userId!]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// Helper: verify ownership
async function verifyDlOwnership(pool: any, taskId: string, orgId: number, userId: number | undefined) {
  if (!userId) return { error: 'UNAUTHORIZED', status: 401 };
  const r = await pool.query('SELECT * FROM booth_dl_tasks WHERE id = $1 AND org_id = $2', [taskId, orgId]);
  if (!r.rows.length) return { error: 'NOT_FOUND', status: 404 };
  if (r.rows[0].assignee_id !== userId) return { error: 'Not your task', status: 403 };
  return { task: r.rows[0] };
}

async function verifySvcOwnership(pool: any, taskId: string, orgId: number, userId: number | undefined) {
  if (!userId) return { error: 'UNAUTHORIZED', status: 401 };
  const r = await pool.query('SELECT * FROM booth_svc_tasks WHERE id = $1 AND org_id = $2', [taskId, orgId]);
  if (!r.rows.length) return { error: 'NOT_FOUND', status: 404 };
  if (r.rows[0].assignee_id !== userId) return { error: 'Not your task', status: 403 };
  return { task: r.rows[0] };
}

// ====== DL: Accept ======
router.post('/dl/tasks/:id/accept', requireHat('DL'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const check = await verifyDlOwnership(pool, req.params.id, user.orgId, user.userId);
    if ('error' in check) return res.status(check.status || 400).json({ success: false, error: check.error, code: check.error });
    const r = await pool.query(
      `UPDATE booth_dl_tasks SET status = 'accepted', accepted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND assignee_id = $3 AND status = 'assigned' RETURNING *`,
      [req.params.id, user.orgId, user.userId!]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot accept: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== DL: Pick ======
router.post('/dl/tasks/:id/pick', requireHat('DL'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const check = await verifyDlOwnership(pool, req.params.id, user.orgId, user.userId);
    if ('error' in check) return res.status(check.status || 400).json({ success: false, error: check.error, code: check.error });
    const r = await pool.query(
      `UPDATE booth_dl_tasks SET status = 'picked', picked_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND assignee_id = $3 AND status = 'accepted' RETURNING *`,
      [req.params.id, user.orgId, user.userId!]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot pick: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== DL: Deliver ======
router.post('/dl/tasks/:id/deliver', requireHat('DL'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const check = await verifyDlOwnership(pool, req.params.id, user.orgId, user.userId);
    if ('error' in check) return res.status(check.status || 400).json({ success: false, error: check.error, code: check.error });
    const r = await pool.query(
      `UPDATE booth_dl_tasks SET status = 'delivering', delivering_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND assignee_id = $3 AND status = 'picked' RETURNING *`,
      [req.params.id, user.orgId, user.userId!]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot deliver: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== DL: Sign ======
router.post('/dl/tasks/:id/sign', requireHat('DL'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const check = await verifyDlOwnership(pool, req.params.id, user.orgId, user.userId);
    if ('error' in check) return res.status(check.status || 400).json({ success: false, error: check.error, code: check.error });
    const { signer } = req.body;
    const r = await pool.query(
      `UPDATE booth_dl_tasks SET status = 'signed', signer = $1, signed_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND org_id = $3 AND assignee_id = $4 AND status = 'delivering' RETURNING *`,
      [signer || user.userId!, req.params.id, user.orgId, user.userId!]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot sign: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== DL: start (alias for accept, backward compat) ======
router.post('/dl/tasks/:id/start', requireHat('DL'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `UPDATE booth_dl_tasks SET status = 'accepted', accepted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND assignee_id = $3 AND status = 'assigned' RETURNING *`,
      [req.params.id, user.orgId, user.userId!]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot start: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== DL: Complete (alias for sign, backward compat) ======
router.post('/dl/tasks/:id/complete', requireHat('DL'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { signedBy, signTime } = req.body;
    const r = await pool.query(
      `UPDATE booth_dl_tasks SET status = 'signed', signer = $1, signed_at = $2, updated_at = NOW()
       WHERE id = $3 AND org_id = $4 AND assignee_id = $5 AND status IN ('delivering','picked','accepted') RETURNING *`,
      [signedBy || user.userId!, signTime || new Date(), req.params.id, user.orgId, user.userId!]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot complete: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== DL: Report exception ======
router.post('/dl/tasks/:id/exception', requireHat('DL'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const check = await verifyDlOwnership(pool, req.params.id, user.orgId, user.userId);
    if ('error' in check) return res.status(check.status || 400).json({ success: false, error: check.error, code: check.error });
    const { reason, detail } = req.body;
    const r = await pool.query(
      `UPDATE booth_dl_tasks SET status = 'exception', exception_reason = $1, remark = $2, updated_at = NOW()
       WHERE id = $3 AND org_id = $4 AND assignee_id = $5 AND status IN ('assigned','accepted','picked','delivering') RETURNING *`,
      [reason, detail, req.params.id, user.orgId, user.userId!]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot report exception: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== SVC: Queue (assigned tasks waiting to accept) ======
router.get('/svc/queue', requireHat('SVC'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { service_category } = req.query;
    let sql = `SELECT * FROM booth_svc_tasks WHERE org_id = $1 AND assignee_id = $2 AND status = 'assigned'`;
    const params: any[] = [user.orgId, user.userId!];
    if (service_category) { sql += ` AND service_category = $${params.length + 1}`; params.push(service_category); }
    sql += ` ORDER BY created_at`;
    const r = await pool.query(sql, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== SVC: Active (accepted/in_service) ======
router.get('/svc/active', requireHat('SVC'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { service_category } = req.query;
    let sql = `SELECT * FROM booth_svc_tasks WHERE org_id = $1 AND assignee_id = $2 AND status IN ('accepted','in_service')`;
    const params: any[] = [user.orgId, user.userId!];
    if (service_category) { sql += ` AND service_category = $${params.length + 1}`; params.push(service_category); }
    sql += ` ORDER BY updated_at DESC`;
    const r = await pool.query(sql, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== SVC: History ======
router.get('/svc/history', requireHat('SVC'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { service_category } = req.query;
    let sql = `SELECT * FROM booth_svc_tasks WHERE org_id = $1 AND assignee_id = $2 AND status IN ('completed','exception','cancelled')`;
    const params: any[] = [user.orgId, user.userId!];
    if (service_category) { sql += ` AND service_category = $${params.length + 1}`; params.push(service_category); }
    sql += ` ORDER BY updated_at DESC`;
    const r = await pool.query(sql, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== SVC: Get my tasks (all) ======
router.get('/svc/tasks', requireHat('SVC'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { service_category } = req.query;
    let sql = `SELECT * FROM booth_svc_tasks WHERE org_id = $1 AND assignee_id = $2`;
    const params: any[] = [user.orgId, user.userId!];
    if (service_category) { sql += ` AND service_category = $${params.length + 1}`; params.push(service_category); }
    sql += ` ORDER BY created_at DESC`;
    const r = await pool.query(sql, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== SVC: Accept ======
router.post('/svc/tasks/:id/accept', requireHat('SVC'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const check = await verifySvcOwnership(pool, req.params.id, user.orgId, user.userId);
    if ('error' in check) return res.status(check.status || 400).json({ success: false, error: check.error, code: check.error });
    const r = await pool.query(
      `UPDATE booth_svc_tasks SET status = 'accepted', accepted_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND assignee_id = $3 AND status = 'assigned' RETURNING *`,
      [req.params.id, user.orgId, user.userId!]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot accept: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== SVC: Start (accepted → in_service) ======
router.post('/svc/tasks/:id/start', requireHat('SVC'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `UPDATE booth_svc_tasks SET status = 'in_service', started_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND assignee_id = $3 AND status = 'accepted' RETURNING *`,
      [req.params.id, user.orgId, user.userId!]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot start: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== SVC: Complete (in_service → completed) ======
router.post('/svc/tasks/:id/complete', requireHat('SVC'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { remark } = req.body;
    const r = await pool.query(
      `UPDATE booth_svc_tasks SET status = 'completed', remark = COALESCE($1, remark), completed_at = NOW(), updated_at = NOW()
       WHERE id = $2 AND org_id = $3 AND assignee_id = $4 AND status = 'in_service' RETURNING *`,
      [remark, req.params.id, user.orgId, user.userId!]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot complete: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== SVC: Report exception ======
router.post('/svc/tasks/:id/exception', requireHat('SVC'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { reason, detail } = req.body;
    const r = await pool.query(
      `UPDATE booth_svc_tasks SET status = 'exception', exception_reason = $1, remark = $2, updated_at = NOW()
       WHERE id = $3 AND org_id = $4 AND assignee_id = $5 AND status IN ('assigned','accepted','in_service') RETURNING *`,
      [reason, detail, req.params.id, user.orgId, user.userId!]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot report exception: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== WH-SUPPLY-01: 供给单 ======

// 供给单列表
router.get('/wh/supply-orders', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { supply_type, status } = req.query;
    let sql = `SELECT * FROM booth_supply_orders WHERE org_id = $1`;
    const params: any[] = [user.orgId];
    let idx = 2;
    if (supply_type) { sql += ` AND supply_type = $${idx}`; params.push(supply_type); idx++; }
    if (status) { sql += ` AND status = $${idx}`; params.push(status); idx++; }
    sql += ` ORDER BY created_at DESC`;
    const r = await pool.query(sql, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// 创建供给单
router.post('/wh/supply-orders', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { supplyType, targetType, targetId, targetName, fromWarehouseType, skuId, skuName, qty, unit, deviceId, plazaResourceId, remark } = req.body;
    const supplyNo = `SUP${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const r = await pool.query(
      `INSERT INTO booth_supply_orders (org_id, supply_no, supply_type, target_type, target_id, target_name, from_warehouse_type, sku_id, sku_name, qty, unit, device_id, plaza_resource_id, remark, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [user.orgId, supplyNo, supplyType || 'material', targetType, targetId, targetName, fromWarehouseType || 'material', skuId, skuName, qty, unit, deviceId, plazaResourceId, remark, user.userId]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// 供给单详情
router.get('/wh/supply-orders/:id', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT * FROM booth_supply_orders WHERE id = $1 AND org_id = $2`,
      [req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// 执行供给（pending → supplied）
router.post('/wh/supply-orders/:id/supply', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `UPDATE booth_supply_orders SET status = 'supplied', supplied_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND status IN ('pending','dispatched') RETURNING *`,
      [req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot supply: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// 取消供给单
router.post('/wh/supply-orders/:id/cancel', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `UPDATE booth_supply_orders SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND org_id = $2 AND status IN ('pending','dispatched') RETURNING *`,
      [req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: 'Cannot cancel: invalid state', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// ====== WH-SUPPLY-01: 设备管理 ======

// 设备列表
router.get('/wh/devices', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { status } = req.query;
    let sql = `SELECT * FROM booth_devices WHERE org_id = $1`;
    const params: any[] = [user.orgId];
    if (status) { sql += ` AND status = $2`; params.push(status); }
    sql += ` ORDER BY created_at DESC`;
    const r = await pool.query(sql, params);
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// 创建设备
router.post('/wh/devices', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { deviceCode, deviceName, deviceType, serialNo, location, purchaseDate, warrantyUntil, remark } = req.body;
    const r = await pool.query(
      `INSERT INTO booth_devices (org_id, device_code, device_name, device_type, serial_no, location, purchase_date, warranty_until, remark)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [user.orgId, deviceCode, deviceName, deviceType, serialNo, location, purchaseDate, warrantyUntil, remark]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// 设备出库给产线（创建供给单 + 更新设备状态）
router.post('/wh/devices/:id/dispatch', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { targetType, targetId, targetName, remark } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // 获取设备信息
      const devR = await client.query('SELECT * FROM booth_devices WHERE id = $1 AND org_id = $2 AND status = $3', [req.params.id, user.orgId, 'idle']);
      if (!devR.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: '设备不可用或不存在', code: 'DEVICE_UNAVAILABLE' });
      }
      const device = devR.rows[0];
      // 创建供给单
      const supplyNo = `SUP${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const supR = await client.query(
        `INSERT INTO booth_supply_orders (org_id, supply_no, supply_type, target_type, target_id, target_name, from_warehouse_type, device_id, status, remark, created_by)
         VALUES ($1,$2,'device',$3,$4,$5,'device',$6,'supplied',$7,$8) RETURNING *`,
        [user.orgId, supplyNo, targetType, targetId, targetName, device.id, remark, user.userId]
      );
      // 更新设备状态
      await client.query(
        `UPDATE booth_devices SET status = 'in_use', assigned_line = $1, updated_at = NOW() WHERE id = $2`,
        [targetName || targetType, device.id]
      );
      await client.query('COMMIT');
      res.json({ success: true, data: supR.rows[0] });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});

// 设备维保记录
router.post('/wh/devices/:id/maintenance', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { maintenanceType, description, cost, remark } = req.body;
    // 更新设备状态为维保中
    await pool.query(
      `UPDATE booth_devices SET status = 'maintenance', updated_at = NOW() WHERE id = $1 AND org_id = $2`,
      [req.params.id, user.orgId]
    );
    const r = await pool.query(
      `INSERT INTO booth_device_maintenance_logs (org_id, device_id, maintenance_type, description, operator_id, started_at, cost, remark)
       VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7) RETURNING *`,
      [user.orgId, req.params.id, maintenanceType || 'routine', description, user.userId, cost || 0, remark]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// 维保完成（恢复设备状态）
router.post('/wh/devices/:id/maintenance/complete', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { logId } = req.body;
    await pool.query(
      `UPDATE booth_device_maintenance_logs SET completed_at = NOW() WHERE id = $1 AND org_id = $2`,
      [logId, user.orgId]
    );
    const r = await pool.query(
      `UPDATE booth_devices SET status = 'idle', updated_at = NOW() WHERE id = $1 AND org_id = $2 AND status = 'maintenance' RETURNING *`,
      [req.params.id, user.orgId]
    );
    if (!r.rows.length) return res.status(400).json({ success: false, error: '设备不在维保状态', code: 'INVALID_STATE' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// 设备维保履历查询
router.get('/wh/devices/:id/maintenance', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT * FROM booth_device_maintenance_logs WHERE device_id = $1 AND org_id = $2 ORDER BY created_at DESC`,
      [req.params.id, user.orgId]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== WH-SUPPLY-01: 场地资源 (Plaza) ======

// 场地资源列表
router.get('/wh/plaza-resources', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT * FROM booth_plaza_resources WHERE org_id = $1 ORDER BY created_at DESC`,
      [user.orgId]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// 创建场地资源
router.post('/wh/plaza-resources', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { resourceCode, resourceName, plazaType, areaSq, capacity, location, remark } = req.body;
    const r = await pool.query(
      `INSERT INTO booth_plaza_resources (org_id, resource_code, resource_name, plaza_type, area_sqm, capacity, location, remark)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [user.orgId, resourceCode, resourceName, plazaType || 'standard', areaSq || 0, capacity || 0, location, remark]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// 场地预订
router.post('/wh/plaza-resources/:id/book', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { purpose, startAt, endAt, remark } = req.body;
    const bookingNo = `PB${Date.now()}${Math.floor(Math.random() * 1000)}`;
    // 检查资源可用
    const resCheck = await pool.query(
      `SELECT * FROM booth_plaza_resources WHERE id = $1 AND org_id = $2 AND status = 'available'`,
      [req.params.id, user.orgId]
    );
    if (!resCheck.rows.length) return res.status(400).json({ success: false, error: '资源不可用', code: 'RESOURCE_UNAVAILABLE' });
    // 创建预订
    const r = await pool.query(
      `INSERT INTO booth_plaza_bookings (org_id, resource_id, booking_no, booker_id, purpose, start_at, end_at, remark)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [user.orgId, req.params.id, bookingNo, user.userId, purpose, startAt, endAt, remark]
    );
    // 更新资源状态
    await pool.query(
      `UPDATE booth_plaza_resources SET status = 'booked', updated_at = NOW() WHERE id = $1`,
      [req.params.id]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) { next(err); }
});

// 释放场地
router.post('/wh/plaza-bookings/:id/release', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const bookingR = await client.query(
        `SELECT * FROM booth_plaza_bookings WHERE id = $1 AND org_id = $2 AND status IN ('booked','checked_in')`,
        [req.params.id, user.orgId]
      );
      if (!bookingR.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, error: '预订不存在或已释放', code: 'INVALID_STATE' });
      }
      const booking = bookingR.rows[0];
      // 更新预订状态
      await client.query(
        `UPDATE booth_plaza_bookings SET status = 'released', updated_at = NOW() WHERE id = $1`,
        [req.params.id]
      );
      // 恢复资源状态
      await client.query(
        `UPDATE booth_plaza_resources SET status = 'available', updated_at = NOW() WHERE id = $1`,
        [booking.resource_id]
      );
      await client.query('COMMIT');
      res.json({ success: true, data: { released: true } });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});

// 场地预订列表
router.get('/wh/plaza-bookings', requireHat('WH'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT b.*, r.resource_name, r.resource_code FROM booth_plaza_bookings b
       JOIN booth_plaza_resources r ON r.id = b.resource_id
       WHERE b.org_id = $1 ORDER BY b.created_at DESC`,
      [user.orgId]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== FAB-MES-05: Station-OS 产线/作业站融合 ======

// 7. GET /dexx/fab/stations: Station 列表
router.get('/fab/stations', requireHat('FAB'), async (req, res, next) => {
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
      stations.push({ ...st, active_orders: parseInt(wos.rows[0]?.cnt || '0') });
    }
    res.json({ success: true, data: { items: stations, total: stations.length } });
  } catch (err) { next(err); }
});

// 8. GET /dexx/fab/stations/:id: 单站详情
router.get('/fab/stations/:id', requireHat('FAB'), async (req, res, next) => {
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
    const station = st.rows[0];
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
        queue: queue.rows,
        agents,
        devices,
        andon_events: [], // FAB-MES-03 预留
      },
    });
  } catch (err) { next(err); }
});

// 1. POST /dexx/fab/station/:id/assign-order: Station 接单
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
      `UPDATE booth_work_orders SET station_id = $1, status = 'accepted', accepted_at = NOW()
       WHERE id = $2 AND org_id = $3 AND status IN ('pending') RETURNING *`,
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
    // SSE 通知
    broadcast(user.orgId, 'station.assigned', { station_id: Number(id), work_order_id, active: active + 1, cap });
    res.json({ success: true, data: { station_id: Number(id), work_order_id, active: active + 1, cap } });
  } catch (err) { next(err); }
});

// 2. POST /dexx/fab/station/:id/report-status: 站状态上报
router.post('/fab/station/:id/report-status', requireHat('FAB'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const { id } = req.params;
    const { state, reason, traffic_cap } = req.body || {};
    const validStates = ['run', 'idle', 'paused', 'down', 'maintenance'];
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
    broadcast(user.orgId, 'station.status', { station_id: Number(id), from: oldState, to: internalState, traffic_cap: newCap });
    res.json({ success: true, data: { station_id: Number(id), from: oldState, to: internalState, traffic_cap: newCap } });
  } catch (err) { next(err); }
});

// 3. POST /dexx/fab/station/:id/deploy-agent: 部署 Agent (占位待 LoRA, 仅登记)
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

// 4. POST /dexx/fab/station/:id/invoke-agent: 调用 Agent (占位待 LoRA, 必须过 access_token 鉴权)
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

// 5. POST /dexx/fab/station/:id/report-agent-status: Agent 状态上报
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

// 6. POST /dexx/fab/station/:id/fault: 故障上报 → 按 fault_strategy 传播
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
    broadcast(user.orgId, 'station.fault', { station_id: Number(id), strategy: fs, affected_orders: affectedOrders, traffic_cap: newCap, state: newState });
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

// 9. GET /dexx/fab/zone/:stage: 产线视角按阶段查询（前置/制作/包装/分拣）
router.get('/fab/zone/:stage', requireHat('FAB'), async (req, res, next) => {
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
        orders: orders.rows,
        total: orders.rows.length,
      },
    });
  } catch (err) { next(err); }
});

export default router;
