import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db.js';

/**
 * [ONBOARDING-P0] Xfactory 快速上手包
 * - 开通向导: EDU 身份三步(铺信息/产能模板/演示数据可选灌入), 可跳过可补完成
 * - 演示数据: 全闭环种子(来源单→拆单→波次→履约四节点→G-005 回执→Case 结算), DEMO- 前缀标记
 * - 红线: 供给执行线业务逻辑零改动(本路由只做数据层种子写入/清理); 演示数据严禁混入真实账
 */

const router = Router();

// EDU 经营线判定 (du/dx/dm); DEU 分身放行 (分身即经营身份进入履约铺操作)
const requireEdu = (req: Request, res: Response, next: NextFunction): void => {
  const user = (req as Request & { user?: { role?: string } }).user;
  if (!user || !['du', 'dx', 'dm'].includes(user.role || '')) {
    res.status(403).json({ success: false, error: '该操作仅限 EDU 经营身份' });
    return;
  }
  next();
};

router.use(requireEdu);

// 模板定义: 行业产能模板 (工艺步骤 + 产能字段示例)
const CAPACITY_TEMPLATES: Record<string, { label: string; craftCode: string; craftName: string; productName: string; steps: Array<{ seq: number; name: string; capacity?: string }> }> = {
  food: {
    label: '食品加工',
    craftCode: 'DEMO-CRAFT-food',
    craftName: '演示·卤味工艺',
    productName: '演示·卤味礼盒',
    steps: [
      { seq: 1, name: '腌制', capacity: '300盒/日' },
      { seq: 2, name: '卤制', capacity: '200盒/日' },
      { seq: 3, name: '包装', capacity: '400盒/日' },
    ],
  },
  garment: {
    label: '服装定制',
    craftCode: 'DEMO-CRAFT-garment',
    craftName: '演示·成衣工艺',
    productName: '演示·工装套装',
    steps: [
      { seq: 1, name: '裁剪', capacity: '150套/日' },
      { seq: 2, name: '缝制', capacity: '100套/日' },
      { seq: 3, name: '整烫包装', capacity: '200套/日' },
    ],
  },
  electronics: {
    label: '电子组装',
    craftCode: 'DEMO-CRAFT-electronics',
    craftName: '演示·贴片组装工艺',
    productName: '演示·智能传感模组',
    steps: [
      { seq: 1, name: 'SMT 贴片', capacity: '500件/日' },
      { seq: 2, name: '焊接', capacity: '400件/日' },
      { seq: 3, name: '老化测试', capacity: '350件/日' },
    ],
  },
};

const hasAnyRow = async (sql: string): Promise<boolean> => {
  const r = await pool.query(sql);
  return (r.rowCount ?? 0) > 0;
};

// GET /api/booth/onboarding/status — 向导状态 (EDU; requireEdu 全局闸, isEdu 供前端卡渲染判定)
router.get('/status', async (req, res) => {
  try {
    const user = (req as Request & { user?: { role?: string } }).user;
    const isEdu = ['du', 'dx', 'dm'].includes(user?.role || '');
    const hasRealData =
      (await hasAnyRow("SELECT 1 FROM booth_production_orders WHERE org_id=1 AND production_no NOT LIKE 'DEMO-%' LIMIT 1")) ||
      (await hasAnyRow("SELECT 1 FROM booth_fulfillments WHERE org_id=1 AND shop_order_id NOT LIKE 'DEMO-%' LIMIT 1"));
    const profile = await pool.query('SELECT factory_name, intro, venue, onboarded_at FROM booth_onboarding_profile WHERE org_id=1');
    const demo = await pool.query("SELECT dataset_no, seeded_at, cleared_at FROM booth_demo_datasets WHERE org_id=1 ORDER BY id DESC LIMIT 1");
    const p = profile.rows[0] || null;
    const d = demo.rows[0] || null;
    res.json({
      success: true,
      data: {
        isEdu,
        hasRealData,
        hasOrgProfile: !!p && !!p.factory_name,
        onboardedAt: p?.onboarded_at ?? null,
        demoActive: !!d && !d.cleared_at,
        demoDataset: d ? { datasetNo: d.dataset_no, seededAt: d.seeded_at, clearedAt: d.cleared_at } : null,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'status failed' });
  }
});

// POST /api/booth/onboarding/profile — ①铺信息 upsert
router.post('/profile', async (req, res) => {
  try {
    const { factoryName = '', intro = '', venue = '' } = (req.body || {}) as { factoryName?: string; intro?: string; venue?: string };
    if (!String(factoryName).trim()) {
      res.status(400).json({ success: false, error: '厂名不能为空' });
      return;
    }
    await pool.query(
      `INSERT INTO booth_onboarding_profile (org_id, factory_name, intro, venue, updated_at)
       VALUES (1, $1, $2, $3, NOW())
       ON CONFLICT (org_id) DO UPDATE SET factory_name=EXCLUDED.factory_name, intro=EXCLUDED.intro, venue=EXCLUDED.venue, updated_at=NOW()`,
      [String(factoryName).trim().slice(0, 120), String(intro).slice(0, 500), String(venue).slice(0, 120)],
    );
    res.json({ success: true, data: { saved: true } });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'profile failed' });
  }
});

// POST /api/booth/onboarding/apply-template — ②产能模板应用 (写入演示工艺, 幂等)
router.post('/apply-template', async (req, res) => {
  try {
    const { templateKey = '' } = (req.body || {}) as { templateKey?: string };
    const tpl = CAPACITY_TEMPLATES[templateKey];
    if (!tpl) {
      res.status(400).json({ success: false, error: `未知模板: ${templateKey}` });
      return;
    }
    const exists = await pool.query('SELECT 1 FROM booth_crafts WHERE org_id=1 AND craft_code=$1 LIMIT 1', [tpl.craftCode]);
    if ((exists.rowCount ?? 0) > 0) {
      res.json({ success: true, data: { applied: false, reason: 'already' } });
      return;
    }
    await pool.query(
      `INSERT INTO booth_crafts (org_id, craft_code, craft_name, product_name, steps, enabled)
       VALUES (1, $1, $2, $3, $4::jsonb, true)`,
      [tpl.craftCode, tpl.craftName, tpl.productName, JSON.stringify(tpl.steps)],
    );
    res.json({ success: true, data: { applied: true, template: tpl.label, craftCode: tpl.craftCode } });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'apply-template failed' });
  }
});

// POST /api/booth/onboarding/seed-demo — ③演示数据全闭环灌入 (幂等: 未清空批次存在则 409)
router.post('/seed-demo', async (_req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const active = await client.query("SELECT 1 FROM booth_demo_datasets WHERE org_id=1 AND cleared_at IS NULL LIMIT 1");
    if ((active.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ success: false, error: '演示数据已灌入 (未清空), 不可重复灌入' });
      return;
    }
    // 来源单 (履约单, 四节点全 done): Market 下单→接单→履约→交付确认, contract_status=Settled (Case 结算触发演示)
    const ff = await client.query(
      `INSERT INTO booth_fulfillments (org_id, shop_order_id, status, contract_status, source, items, wave_no, completed_at)
       VALUES (1, 'DEMO-SO-2026-0901', 'completed', 'Settled', 'demo', $1::jsonb, 'DEMO-WAVE-0901', NOW()) RETURNING id`,
      [JSON.stringify([{ name: '演示·卤味礼盒', product_name: '演示·卤味礼盒', qty: 20 }])],
    );
    const ffId = ff.rows[0].id as number;
    // 生产单 (source=demo, 通货供给族)
    const po = await client.query(
      `INSERT INTO booth_production_orders (org_id, production_no, shop_order_id, dx_case_no, wave_no, status, order_type, source, order_family, items)
       VALUES (1, 'DEMO-PO-0901', 'DEMO-SO-2026-0901', 'DEMO-CASE-0901', 'DEMO-WAVE-0901', 'completed', 'self_made', 'demo', 'E', $1::jsonb) RETURNING id`,
      [JSON.stringify([{ name: '演示·卤味礼盒', qty: 20 }])],
    );
    const poId = po.rows[0].id as number;
    // 拆单任务 (制造铺)
    const task = await client.query(
      `INSERT INTO booth_production_tasks (org_id, production_order_id, task_type, status, work_order_no)
       VALUES (1, $1, 'manufacture', 'completed', 'DEMO-PROD-0901-001') RETURNING id`,
      [poId],
    );
    const taskId = task.rows[0].id as number;
    // 工单 ×2: 生产 + 配送 (全 completed)
    const woFab = await client.query(
      `INSERT INTO booth_work_orders (org_id, work_order_no, product_name, qty, status, wo_scope, production_task_id, split_source, step_name)
       VALUES (1, 'DEMO-PROD-0901-001', '演示·卤味礼盒', 20, 'completed', 'production', $1, 'demo', '卤制生产') RETURNING id`,
      [taskId],
    );
    const woFabId = woFab.rows[0].id as number;
    const woDl = await client.query(
      `INSERT INTO booth_work_orders (org_id, work_order_no, product_name, qty, status, wo_scope, production_task_id, split_source, step_name)
       VALUES (1, 'DEMO-PROD-0901-002', '演示·卤味礼盒', 20, 'completed', 'delivery', $1, 'demo', '配送') RETURNING id`,
      [taskId],
    );
    const woDlId = woDl.rows[0].id as number;
    // G-005 凭证 (完工回执演示)
    const ev = await client.query(
      `INSERT INTO booth_work_order_evidences (org_id, work_order_id, evidence_type, url, note)
       VALUES (1, $1, 'photo', 'demo://DEMO-EV-0901', '演示·完工回执 (G-005 凭证联动演示)') RETURNING id`,
      [woFabId],
    );
    const evId = ev.rows[0].id as number;
    // 完工入库单
    const stock = await client.query(
      `INSERT INTO booth_stock_docs (org_id, work_order_id, doc_type, payload, created_by)
       VALUES (1, $1, 'inbound', $2::jsonb, 'demo') RETURNING id`,
      [woFabId, JSON.stringify({ items: [{ name: '演示·卤味礼盒', qty: 20 }], total_qty: 20, demo: true })],
    );
    const stockId = stock.rows[0].id as number;
    // 批次登记 (幂等锚点; 清空后重灌 upsert 复活同号批次)
    const ds = await client.query(
      `INSERT INTO booth_demo_datasets (org_id, dataset_no, summary)
       VALUES (1, 'DEMO-DS-0901', $1::jsonb)
       ON CONFLICT (dataset_no) DO UPDATE SET summary = EXCLUDED.summary, seeded_at = NOW(), cleared_at = NULL
       RETURNING id`,
      [JSON.stringify({ fulfillmentId: ffId, productionOrderId: poId, taskId, workOrderIds: [woFabId, woDlId], evidenceId: evId, stockDocId: stockId })],
    );
    await client.query('COMMIT');
    res.json({
      success: true,
      data: {
        datasetNo: 'DEMO-DS-0901',
        demoId: ds.rows[0].id,
        closedLoop: ['来源单 DEMO-SO-2026-0901', '生产单 DEMO-PO-0901', '制造任务', '生产/配送工单', 'G-005 凭证', '完工入库', 'Case 结算 (Settled)'],
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'seed-demo failed' });
  } finally {
    client.release();
  }
});

// POST /api/booth/onboarding/clear-demo — 演示数据清空 (仅 DEMO- 前缀, 绝不触碰真实数据)
router.post('/clear-demo', async (_req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const woIds = await client.query("SELECT id FROM booth_work_orders WHERE org_id=1 AND work_order_no LIKE 'DEMO-%'");
    const woIdList = woIds.rows.map((r: { id: number }) => r.id);
    if (woIdList.length > 0) {
      await client.query('DELETE FROM booth_work_order_evidences WHERE org_id=1 AND work_order_id = ANY($1::bigint[])', [woIdList]);
      await client.query('DELETE FROM booth_stock_docs WHERE org_id=1 AND work_order_id = ANY($1::bigint[])', [woIdList]);
    }
    const rWo = await client.query("DELETE FROM booth_work_orders WHERE org_id=1 AND work_order_no LIKE 'DEMO-%'");
    const rTask = await client.query("DELETE FROM booth_production_tasks WHERE org_id=1 AND (work_order_no LIKE 'DEMO-%' OR production_order_id IN (SELECT id FROM booth_production_orders WHERE org_id=1 AND production_no LIKE 'DEMO-%'))");
    const rPo = await client.query("DELETE FROM booth_production_orders WHERE org_id=1 AND production_no LIKE 'DEMO-%'");
    const rFf = await client.query("DELETE FROM booth_fulfillments WHERE org_id=1 AND shop_order_id LIKE 'DEMO-%'");
    const rCraft = await client.query("DELETE FROM booth_crafts WHERE org_id=1 AND craft_code LIKE 'DEMO-CRAFT-%'");
    const rDs = await client.query("UPDATE booth_demo_datasets SET cleared_at=NOW() WHERE org_id=1 AND cleared_at IS NULL");
    await client.query('COMMIT');
    res.json({
      success: true,
      data: {
        cleared: { workOrders: rWo.rowCount ?? 0, tasks: rTask.rowCount ?? 0, productionOrders: rPo.rowCount ?? 0, fulfillments: rFf.rowCount ?? 0, crafts: rCraft.rowCount ?? 0, datasets: rDs.rowCount ?? 0 },
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'clear-demo failed' });
  } finally {
    client.release();
  }
});

// POST /api/booth/onboarding/complete — 三步完成/跳过标记
router.post('/complete', async (req, res) => {
  try {
    const { skipped = false } = (req.body || {}) as { skipped?: boolean };
    await pool.query(
      `INSERT INTO booth_onboarding_profile (org_id, factory_name, onboarded_at, updated_at)
       VALUES (1, CASE WHEN $1 THEN '' ELSE factory_name END, $2, NOW())
       ON CONFLICT (org_id) DO UPDATE SET onboarded_at = $2, updated_at=NOW()`,
      [skipped, skipped ? null : new Date()],
    );
    res.json({ success: true, data: { completed: true, skipped } });
  } catch (err) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'complete failed' });
  }
});

export default router;
