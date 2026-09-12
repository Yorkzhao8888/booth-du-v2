import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db.js';

/**
 * [XDP-ECO] Xfactory 生态版四主体 MVP —— VEM 平台方控制台 + 加盟入驻流 + 经营户铺位管理
 * - 四主体: 个人(#xhpz 消费与派岗) / 企业(#xepz 开店经营) / 经营户(#xdpz 铺位管理) / 平台方(#xvpz·VEM 生态治理)
 * - VEM 最小集: 铺位列表(直营/加盟标) / 入驻审核(通过→开通 Booth-EDP 铺+协议费率落库/驳回带理由) /
 *   费率配置(万分比固定比例可配置) / 分成台账 / 治理操作(停铺/恢复) / 多铺汇总
 * - 分成台账红线: 只记「Case 结算触发事件 + 协议费率 = 应收分成记录」, 全链路 0 金额字段
 *   (动态视图=booth_fulfillments(contract_status=Settled) × 生态铺费率; 金额级分账随 ERP 账本线另单)
 * - 红线: 供给执行线业务逻辑与 Case 结算事务零改动(本路由纯只读消费履约快照); 演示数据 is_demo 隔离
 */

const router = Router();

// ---- 角色判定工具 (OAS 原角色解析; 与 auth.ts parseOASRole 同口径) ----
type EcoUser = { role?: string; subRole?: string; identity_id?: string; orgId?: number };

function parseOASRole(raw: unknown): string[] {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .split(/[+|,;/\s]+/)
    .filter(Boolean);
}

function ecoUser(req: Request): EcoUser {
  return ((req as Request & { user?: EcoUser }).user ?? {}) as EcoUser;
}

/** 开发匿名会话 (DEV OAS_AUTH_ENABLED=false 注入; PROD fail-safe 下不存在) */
function isDevAnon(req: Request): boolean {
  return ecoUser(req).identity_id === 'dev-anonymous';
}

/** [XVPZ] 平台方 VEM 专属闸: OAS 原角色 SU/admin (匿名演示态放行) */
const requireVem = (req: Request, res: Response, next: NextFunction): void => {
  const parts = parseOASRole(ecoUser(req).subRole);
  if (!isDevAnon(req) && !parts.some((p) => ['SU', 'ADMIN'].includes(p))) {
    res.status(403).json({ success: false, error: 'FORBIDDEN', message: '该操作仅限平台方 (VEM) 身份' });
    return;
  }
  next();
};

/** [XDPZ] 经营户闸: OAS 原角色 SU/EM (匿名演示态放行) */
const requireXdpz = (req: Request, res: Response, next: NextFunction): void => {
  const parts = parseOASRole(ecoUser(req).subRole);
  if (!isDevAnon(req) && !parts.some((p) => ['SU', 'EM'].includes(p))) {
    res.status(403).json({ success: false, error: 'FORBIDDEN', message: '该操作仅限经营户身份' });
    return;
  }
  next();
};

/** [XEPZ] EDU 经营线判定 (du/dx/dm) —— 企业主体提交入驻申请 */
const requireEdu = (req: Request, res: Response, next: NextFunction): void => {
  const role = ecoUser(req).role;
  if (!role || !['du', 'dx', 'dm'].includes(role)) {
    res.status(403).json({ success: false, error: 'FORBIDDEN', message: '该操作仅限 EDU 经营身份' });
    return;
  }
  next();
};

const orgIdOf = (req: Request): number => ecoUser(req).orgId || 1;

// ---- 响应映射 (snake → camel, 幂等分支同口径) ----
interface EcoShopRow {
  id: number;
  shop_name: string;
  eco_type: string;
  category: string;
  status: string;
  rate_bps: number;
  source_application_id: number | null;
  is_demo: boolean;
  created_at: Date | string;
}
const mapShop = (r: EcoShopRow) => ({
  id: r.id,
  shopName: r.shop_name,
  ecoType: r.eco_type,
  category: r.category,
  status: r.status,
  rateBps: r.rate_bps,
  sourceApplicationId: r.source_application_id,
  isDemo: r.is_demo,
  createdAt: r.created_at,
});

interface EcoAppRow {
  id: number;
  org_id: number;
  applicant: string;
  contact: string;
  shop_name: string;
  category: string;
  apply_note: string;
  status: string;
  reject_reason: string | null;
  rate_bps: number | null;
  reviewed_by: string | null;
  reviewed_at: Date | string | null;
  is_demo: boolean;
  created_at: Date | string;
}
const mapApplication = (r: EcoAppRow) => ({
  id: r.id,
  applicant: r.applicant,
  contact: r.contact,
  shopName: r.shop_name,
  category: r.category,
  applyNote: r.apply_note,
  status: r.status,
  rejectReason: r.reject_reason,
  rateBps: r.rate_bps,
  reviewedBy: r.reviewed_by,
  reviewedAt: r.reviewed_at,
  isDemo: r.is_demo,
  createdAt: r.created_at,
});

// ============ [XVPZ] VEM 平台方控制台 ============

/** GET /api/booth/eco/summary —— 多铺汇总卡 (铺数/直营/加盟/在营/待审/分成应收记录数) */
router.get('/summary', requireVem, async (req, res) => {
  try {
    const orgId = orgIdOf(req);
    const shops = await pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE eco_type='direct')::int AS direct,
              COUNT(*) FILTER (WHERE eco_type='franchise')::int AS franchise,
              COUNT(*) FILTER (WHERE status='active')::int AS active,
              COUNT(*) FILTER (WHERE status='suspended')::int AS suspended
         FROM booth_eco_shops WHERE org_id=$1`,
      [orgId],
    );
    const pending = await pool.query(
      `SELECT COUNT(*)::int AS n FROM booth_eco_applications WHERE org_id=$1 AND status='pending'`,
      [orgId],
    );
    // 分成应收记录数 = 已触发 Case 结算(Settled) 且关联生态铺的履约契约数 (动态口径, 0 金额)
    const ledger = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM booth_fulfillments f
        WHERE f.org_id=$1 AND f.contract_status='Settled'
          AND EXISTS (SELECT 1 FROM booth_eco_shops s WHERE s.org_id=f.org_id AND s.status='active')`,
      [orgId],
    );
    const s = shops.rows[0];
    res.json({
      success: true,
      data: {
        shopsTotal: s.total,
        directShops: s.direct,
        franchiseShops: s.franchise,
        activeShops: s.active,
        suspendedShops: s.suspended,
        pendingApplications: pending.rows[0].n,
        ledgerEntries: ledger.rows[0].n,
      },
    });
  } catch (err) {
    console.error('[eco] summary failed:', err);
    res.status(500).json({ success: false, error: 'ECO_SUMMARY_FAILED' });
  }
});

/** GET /api/booth/eco/shops —— 铺位列表 (直营/加盟标 + 状态 + 协议费率) */
router.get('/shops', requireVem, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, shop_name, eco_type, category, status, rate_bps, source_application_id, is_demo, created_at
         FROM booth_eco_shops WHERE org_id=$1 ORDER BY (eco_type='direct') DESC, id ASC`,
      [orgIdOf(req)],
    );
    res.json({ success: true, data: r.rows.map(mapShop) });
  } catch (err) {
    console.error('[eco] shops failed:', err);
    res.status(500).json({ success: false, error: 'ECO_SHOPS_FAILED' });
  }
});

/** PUT /api/booth/eco/shops/:id/rate —— 费率配置 (万分比, MVP 固定比例可配置) */
router.put('/shops/:id/rate', requireVem, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const rateBps = Number((req.body ?? {}).rateBps);
    if (!Number.isFinite(rateBps) || rateBps <= 0 || rateBps > 2000) {
      res.status(400).json({ success: false, error: 'INVALID_RATE', message: '费率须为 0-20% 之间的万分比 (如 300=3%)' });
      return;
    }
    const r = await pool.query(
      `UPDATE booth_eco_shops SET rate_bps=$1 WHERE id=$2 AND org_id=$3 RETURNING id`,
      [Math.round(rateBps), id, orgIdOf(req)],
    );
    if (r.rowCount === 0) {
      res.status(404).json({ success: false, error: 'SHOP_NOT_FOUND' });
      return;
    }
    console.log(`[eco] rate updated: shop=${id} rate_bps=${Math.round(rateBps)} (VEM)`);
    res.json({ success: true, data: { id, rateBps: Math.round(rateBps) } });
  } catch (err) {
    console.error('[eco] rate failed:', err);
    res.status(500).json({ success: false, error: 'ECO_RATE_FAILED' });
  }
});

/** POST /api/booth/eco/shops/:id/suspend | /resume —— 治理操作 (停铺/恢复) */
const governanceHandler = (target: 'suspended' | 'active') =>
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = Number(req.params.id);
      const r = await pool.query(
        `UPDATE booth_eco_shops SET status=$1 WHERE id=$2 AND org_id=$3 RETURNING id, status`,
        [target, id, orgIdOf(req)],
      );
      if (r.rowCount === 0) {
        res.status(404).json({ success: false, error: 'SHOP_NOT_FOUND' });
        return;
      }
      console.log(`[eco] governance: shop=${id} -> ${target} (VEM)`);
      res.json({ success: true, data: { id, status: r.rows[0].status } });
    } catch (err) {
      console.error('[eco] governance failed:', err);
      res.status(500).json({ success: false, error: 'ECO_GOVERNANCE_FAILED' });
    }
  };
router.post('/shops/:id/suspend', requireVem, governanceHandler('suspended'));
router.post('/shops/:id/resume', requireVem, governanceHandler('active'));

/** GET /api/booth/eco/applications?status= —— 入驻审核列表 (待审/通过/驳回) */
router.get('/applications', requireVem, async (req, res) => {
  try {
    const status = String(req.query.status ?? '').trim();
    const params: unknown[] = [orgIdOf(req)];
    let where = 'org_id=$1';
    if (['pending', 'approved', 'rejected'].includes(status)) {
      params.push(status);
      where += ` AND status=$${params.length}`;
    }
    const r = await pool.query(
      `SELECT id, org_id, applicant, contact, shop_name, category, apply_note, status,
              reject_reason, rate_bps, reviewed_by, reviewed_at, is_demo, created_at
         FROM booth_eco_applications WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT 200`,
      params,
    );
    res.json({ success: true, data: r.rows.map(mapApplication) });
  } catch (err) {
    console.error('[eco] applications failed:', err);
    res.status(500).json({ success: false, error: 'ECO_APPLICATIONS_FAILED' });
  }
});

/** POST /api/booth/eco/applications/:id/review —— 审核 (approve→开通 Booth-EDP 铺+协议费率落库 / reject 带理由) */
router.post('/applications/:id/review', requireVem, async (req, res) => {
  const client = await pool.connect();
  try {
    const id = Number(req.params.id);
    const body = (req.body ?? {}) as { decision?: string; reason?: string; rateBps?: number };
    const decision = String(body.decision ?? '');
    if (!['approve', 'reject'].includes(decision)) {
      res.status(400).json({ success: false, error: 'INVALID_DECISION', message: 'decision 须为 approve/reject' });
      return;
    }
    const reviewer = ecoUser(req).subRole || 'VEM';
    await client.query('BEGIN');
    // 申请行锁定 (防并发重复审核)
    const app = await client.query(
      `SELECT id, org_id, applicant, contact, shop_name, category, is_demo, status
         FROM booth_eco_applications WHERE id=$1 FOR UPDATE`,
      [id],
    );
    if (app.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ success: false, error: 'APPLICATION_NOT_FOUND' });
      return;
    }
    if (app.rows[0].status !== 'pending') {
      await client.query('ROLLBACK');
      res.status(409).json({ success: false, error: 'ALREADY_REVIEWED', message: '该申请已处理' });
      return;
    }
    if (decision === 'reject') {
      const reason = String(body.reason ?? '').trim();
      if (!reason) {
        await client.query('ROLLBACK');
        res.status(400).json({ success: false, error: 'REJECT_REASON_REQUIRED', message: '驳回必须填写理由' });
        return;
      }
      await client.query(
        `UPDATE booth_eco_applications SET status='rejected', reject_reason=$1, reviewed_by=$2, reviewed_at=NOW() WHERE id=$3`,
        [reason, reviewer, id],
      );
      await client.query('COMMIT');
      console.log(`[eco] application ${id} rejected (VEM)`);
      res.json({ success: true, data: { id, status: 'rejected', rejectReason: reason } });
      return;
    }
    // approve: 费率校验 + 事务内开通 Booth-EDP 铺 (franchise + 协议费率落库)
    const rateBps = Number(body.rateBps);
    if (!Number.isFinite(rateBps) || rateBps <= 0 || rateBps > 2000) {
      await client.query('ROLLBACK');
      res.status(400).json({ success: false, error: 'INVALID_RATE', message: '通过须带 0-20% 的协议费率 (万分比)' });
      return;
    }
    const row = app.rows[0];
    await client.query(
      `UPDATE booth_eco_applications SET status='approved', rate_bps=$1, reviewed_by=$2, reviewed_at=NOW() WHERE id=$3`,
      [Math.round(rateBps), reviewer, id],
    );
    const shop = await client.query(
      `INSERT INTO booth_eco_shops (org_id, shop_name, eco_type, category, status, rate_bps, source_application_id, is_demo)
       VALUES ($1, $2, 'franchise', $3, 'active', $4, $5, $6) RETURNING id`,
      [row.org_id, row.shop_name, row.category, Math.round(rateBps), id, row.is_demo],
    );
    await client.query('COMMIT');
    console.log(`[eco] application ${id} approved -> eco_shop=${shop.rows[0].id} rate_bps=${Math.round(rateBps)} (VEM)`);
    res.json({ success: true, data: { id, status: 'approved', shopId: shop.rows[0].id, rateBps: Math.round(rateBps) } });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[eco] review failed:', err);
    res.status(500).json({ success: false, error: 'ECO_REVIEW_FAILED' });
  } finally {
    client.release();
  }
});

/** GET /api/booth/eco/ledger?shopId= —— 分成台账 (Case 结算触发流水 × 协议费率 = 应收分成记录; 全链路 0 金额) */
router.get('/ledger', requireVem, async (req, res) => {
  try {
    // 可选铺位过滤: 演示铺(无结算流水)可用于空态展示, 兼强化演示隔离语义
    const shopIdRaw = String(req.query.shopId ?? '').trim();
    const shopId = /^\d+$/.test(shopIdRaw) ? Number(shopIdRaw) : null;
    const params: unknown[] = [orgIdOf(req)];
    let where = 'f.org_id=$1 AND f.contract_status=$2';
    params.push('Settled');
    if (shopId !== null) {
      params.push(shopId);
      where += ` AND s.id=$${params.length}`;
    }
    const r = await pool.query(
      `SELECT f.id, f.shop_order_id, f.wave_no, f.contract_status, f.status,
              COALESCE(f.completed_at, f.created_at) AS triggered_at,
              s.id AS shop_id, s.shop_name, s.eco_type, s.rate_bps
         FROM booth_fulfillments f
         LEFT JOIN LATERAL (
           SELECT id, shop_name, eco_type, rate_bps
             FROM booth_eco_shops
            WHERE org_id = f.org_id AND status = 'active'
            ORDER BY (eco_type='direct') DESC, id ASC LIMIT 1
         ) s ON true
        WHERE ${where}
        ORDER BY triggered_at DESC, f.id DESC LIMIT 100`,
      params,
    );
    const data = r.rows.map((x: Record<string, unknown>) => ({
      settleRef: x.shop_order_id,
      waveNo: x.wave_no,
      shopId: x.shop_id,
      shopName: x.shop_name,
      ecoType: x.eco_type,
      rateBps: x.rate_bps,
      triggeredAt: x.triggered_at,
      // 台账口径说明: 只记「结算触发 + 费率」, 金额级分账随 ERP 账本线另单
      receivableNote: '按协议费率应收 · 金额级分账随 ERP 账本线结算',
    }));
    res.json({ success: true, data });
  } catch (err) {
    console.error('[eco] ledger failed:', err);
    res.status(500).json({ success: false, error: 'ECO_LEDGER_FAILED' });
  }
});

// ============ [XEPZ] 企业主体入驻申请 ============

/** POST /api/booth/eco/applications —— 企业主体 (XEPZ) 提交加盟入驻申请 (主体信息 + 经营类目) */
router.post('/applications', requireEdu, async (req, res) => {
  try {
    const body = (req.body ?? {}) as { applicant?: string; contact?: string; shopName?: string; category?: string; applyNote?: string };
    const applicant = String(body.applicant ?? '').trim();
    const shopName = String(body.shopName ?? '').trim();
    if (!applicant || !shopName) {
      res.status(400).json({ success: false, error: 'INVALID_BODY', message: '主体名称与拟开铺名为必填' });
      return;
    }
    const r = await pool.query(
      `INSERT INTO booth_eco_applications (org_id, applicant, contact, shop_name, category, apply_note, status, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', false) RETURNING id`,
      [orgIdOf(req), applicant, String(body.contact ?? '').trim(), shopName, String(body.category ?? '').trim(), String(body.applyNote ?? '').trim()],
    );
    console.log(`[eco] application created: id=${r.rows[0].id} applicant=${applicant} (XEPZ)`);
    res.json({ success: true, data: { id: r.rows[0].id, status: 'pending' } });
  } catch (err) {
    console.error('[eco] apply failed:', err);
    res.status(500).json({ success: false, error: 'ECO_APPLY_FAILED' });
  }
});

/** GET /api/booth/eco/my-applications —— 我的企业申请记录 (XEPZ) */
router.get('/my-applications', requireEdu, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, org_id, applicant, contact, shop_name, category, apply_note, status,
              reject_reason, rate_bps, reviewed_by, reviewed_at, is_demo, created_at
         FROM booth_eco_applications WHERE org_id=$1 AND is_demo=false
        ORDER BY created_at DESC, id DESC LIMIT 50`,
      [orgIdOf(req)],
    );
    res.json({ success: true, data: r.rows.map(mapApplication) });
  } catch (err) {
    console.error('[eco] my-applications failed:', err);
    res.status(500).json({ success: false, error: 'ECO_MY_APPLICATIONS_FAILED' });
  }
});

// ============ [XDPZ] 经营户铺位管理 ============

/** GET /api/booth/eco/my-shops —— 经营户自己的生态铺位 (含停铺态与费率) */
router.get('/my-shops', requireXdpz, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, shop_name, eco_type, category, status, rate_bps, source_application_id, is_demo, created_at
         FROM booth_eco_shops WHERE org_id=$1 ORDER BY (eco_type='direct') DESC, id ASC`,
      [orgIdOf(req)],
    );
    res.json({ success: true, data: r.rows.map(mapShop) });
  } catch (err) {
    console.error('[eco] my-shops failed:', err);
    res.status(500).json({ success: false, error: 'ECO_MY_SHOPS_FAILED' });
  }
});

export default router;
