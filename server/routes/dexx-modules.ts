import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth, requireRole, requireHat } from '../auth.js';
import type { JwtPayload } from '../auth.js';
import { createProfitSnapshot } from '../services/profit-service.js';

const router = Router();

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
    if (!woRes.rows.length || woRes.rows[0].status !== 'in_progress') {
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
    if (!woRes.rows.length || woRes.rows[0].status !== 'in_progress') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Work order not in progress', code: 'INVALID_STATE' });
    }

    // Update work order status
    await client.query(
      `UPDATE booth_work_orders SET status = 'completed', completed_at = NOW(), updated_at = NOW() WHERE id = $1`,
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
    if (wo.status !== 'in_progress') {
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
      `UPDATE booth_work_orders SET production_stage = $1, updated_at = NOW() WHERE id = $2`,
      [targetStage, workOrderId]
    );

    // Record stage transition in operations log
    await client.query(
      `INSERT INTO booth_fab_operations (org_id, work_order_id, seq, op_name, qty_completed, remark)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (org_id, work_order_id, seq) DO NOTHING`,
      [user.orgId, workOrderId, targetIdx + 100, `stage_${targetStage}`, 0, remark || `流转至${STAGE_LABELS[targetStage]}产线`]
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
      `SELECT wo.*, p.name as product_name
       FROM booth_work_orders wo
       LEFT JOIN booth_products p ON wo.product_id = p.id
       WHERE wo.org_id = $1 AND wo.status IN ('accepted', 'in_progress')
       ORDER BY 
         CASE wo.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END,
         wo.planned_start ASC NULLS LAST`,
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

// 获取工单的良品率记录
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

// 获取所有良品率记录
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

// 获取良品率统计
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
    const r = await pool.query(
      `SELECT * FROM booth_svc_tasks WHERE org_id = $1 AND assignee_id = $2 AND status = 'assigned' ORDER BY created_at`,
      [user.orgId, user.userId!]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== SVC: Active (accepted/in_service) ======
router.get('/svc/active', requireHat('SVC'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT * FROM booth_svc_tasks WHERE org_id = $1 AND assignee_id = $2 AND status IN ('accepted','in_service') ORDER BY updated_at DESC`,
      [user.orgId, user.userId!]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== SVC: History ======
router.get('/svc/history', requireHat('SVC'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT * FROM booth_svc_tasks WHERE org_id = $1 AND assignee_id = $2 AND status IN ('completed','exception','cancelled') ORDER BY updated_at DESC`,
      [user.orgId, user.userId!]
    );
    res.json({ success: true, data: { items: r.rows, total: r.rows.length } });
  } catch (err) { next(err); }
});

// ====== SVC: Get my tasks (all) ======
router.get('/svc/tasks', requireHat('SVC'), async (req, res, next) => {
  try {
    const user = (req as any).user as JwtPayload;
    const r = await pool.query(
      `SELECT * FROM booth_svc_tasks WHERE org_id = $1 AND assignee_id = $2 ORDER BY created_at DESC`,
      [user.orgId, user.userId!]
    );
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

export default router;
