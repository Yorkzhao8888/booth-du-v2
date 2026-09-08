/**
 * [BOOTH-PRD-002] 铺面管理 + 权限（阶段一 P0 核心）
 * - PM-001 供应铺管理: 四铺(研发 rd/制造 manufacture/配送 delivery/供给 supply)建改停用列表 + 能力展示数据源(BDD-16, PM-008 预留)
 * - PM-002 订单类型配置: 字典化(MVP 三类=外发/自制/研发) + 派发映射(default_target_shop_type, BDD-01)
 * - PM-004 角色管理(口径修正): 生态角色链 dm→du→dx→dex→dexx; DEU=DU 履约铺分身(非独立角色, 保留经营决策权)
 *   价格边界红线: M 层(dm/du)+X 层管理(dx)可见价格; X 层执行(ex=DEX/exx=DEXX/dxx)不可见任何价格; DEXX 不可见售价
 */
import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../db.js';
import { AuthedRequest, requireAuth, requireWriteAccess } from '../auth.js';
import { isXExecutor } from '../services/oas-client.js';

const router = Router();
type AuthedReq = AuthedRequest;

function orgOf(req: AuthedReq): number {
  return Number(req.user?.orgId ?? 1) || 1;
}

/** [PM-004 价格边界] M 层(dm/du)+X 层管理(dx) 可见价格; DEU(DU 分身)可见; X 层执行不可见 */
function canSeePrice(user?: { roleKey?: string; orgMode?: string; actingAs?: string } | null): boolean {
  if (!user) return false;
  if (user.actingAs === 'deu') return true;
  return ['du', 'dx', 'dm'].includes(user.roleKey || '') || user.orgMode === 'du';
}

const SHOP_TYPES = ['rd', 'manufacture', 'delivery', 'supply'] as const; // [PM-001 裁定] 四铺
const SHOP_TYPE_NAMES: Record<string, string> = { rd: '研发铺', manufacture: '制造铺', delivery: '配送铺', supply: '供给铺' };

/* ─────────────── PM-001 供应铺管理 ─────────────── */

/** 列表 (BDD-16: 能力展示数据源; X 层执行可见但无价格字段 — 本表无价格列, 天然合规) */
router.get('/supply-shops', requireAuth, async (req: AuthedReq, res: Response, next: NextFunction) => {
  try {
    const orgId = orgOf(req);
    const shopType = String((req.query.shopType as string) || '');
    const status = String((req.query.status as string) || '');
    const params: unknown[] = [orgId];
    let cond = '';
    if (SHOP_TYPES.includes(shopType as never)) { params.push(shopType); cond += ` AND shop_type = $${params.length}`; }
    if (['active', 'inactive'].includes(status)) { params.push(status); cond += ` AND status = $${params.length}`; }
    const r = await pool.query(
      `SELECT id, shop_type, shop_name, status, capabilities, contact, remark, created_at, updated_at
       FROM booth_supply_shops WHERE org_id = $1${cond} ORDER BY shop_type, id`,
      params
    );
    res.json({ success: true, data: r.rows, shopTypeNames: SHOP_TYPE_NAMES });
  } catch (e) { next(e); }
});

/** 新建 (M 层 + X 层管理: du/dx) */
router.post('/supply-shops', requireAuth, requireWriteAccess, async (req: AuthedReq, res: Response, next: NextFunction) => {
  try {
    const orgId = orgOf(req);
    const body = req.body as { shopType?: string; shopName?: string; capabilities?: string[]; contact?: string; remark?: string };
    if (!SHOP_TYPES.includes(body.shopType as never)) {
      return res.status(400).json({ success: false, error: `shopType must be one of ${SHOP_TYPES.join('/')}`, code: 'INVALID_SHOP_TYPE' });
    }
    if (!body.shopName || !String(body.shopName).trim()) {
      return res.status(400).json({ success: false, error: 'shopName is required', code: 'MISSING_NAME' });
    }
    const dup = await pool.query('SELECT id FROM booth_supply_shops WHERE org_id = $1 AND shop_type = $2 AND shop_name = $3', [orgId, body.shopType, String(body.shopName).trim()]);
    if (dup.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'supply shop already exists', code: 'DUPLICATE_SHOP' });
    }
    const r = await pool.query(
      `INSERT INTO booth_supply_shops (org_id, shop_type, shop_name, capabilities, contact, remark)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6) RETURNING *`,
      [orgId, body.shopType, String(body.shopName).trim(), JSON.stringify(Array.isArray(body.capabilities) ? body.capabilities : []), body.contact ?? null, body.remark ?? null]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) { next(e); }
});

/** 修改 (M 层 + X 层管理) */
router.put('/supply-shops/:id', requireAuth, requireWriteAccess, async (req: AuthedReq, res: Response, next: NextFunction) => {
  try {
    const orgId = orgOf(req);
    const id = Number(req.params.id);
    const body = req.body as { shopName?: string; capabilities?: string[]; contact?: string; remark?: string };
    const r = await pool.query(
      `UPDATE booth_supply_shops SET
         shop_name = COALESCE($3, shop_name),
         capabilities = COALESCE($4::jsonb, capabilities),
         contact = COALESCE($5, contact),
         remark = COALESCE($6, remark),
         updated_at = NOW()
       WHERE id = $1 AND org_id = $2 RETURNING *`,
      [id, orgId, body.shopName?.trim() ?? null, body.capabilities ? JSON.stringify(body.capabilities) : null, body.contact ?? null, body.remark ?? null]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: 'not found', code: 'NOT_FOUND' });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { next(e); }
});

/** 停用/启用 */
router.post('/supply-shops/:id/:action(deactivate|activate)', requireAuth, requireWriteAccess, async (req: AuthedReq, res: Response, next: NextFunction) => {
  try {
    const orgId = orgOf(req);
    const id = Number(req.params.id);
    const action = req.params.action;
    const r = await pool.query(
      `UPDATE booth_supply_shops SET status = $3, updated_at = NOW() WHERE id = $1 AND org_id = $2 RETURNING id, shop_name, status`,
      [id, orgId, action === 'deactivate' ? 'inactive' : 'active']
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: 'not found', code: 'NOT_FOUND' });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { next(e); }
});

/** 能力展示数据源 (BDD-16 前置, PM-008 预留挂接点) */
router.get('/supply-shops/:id/capabilities', requireAuth, async (req: AuthedReq, res: Response, next: NextFunction) => {
  try {
    const orgId = orgOf(req);
    const id = Number(req.params.id);
    const r = await pool.query('SELECT id, shop_type, shop_name, status, capabilities FROM booth_supply_shops WHERE id = $1 AND org_id = $2', [id, orgId]);
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: 'not found', code: 'NOT_FOUND' });
    const row = r.rows[0];
    // [PM-008 预留] capabilities 结构: [{ code, name, price?, sla? }] — 当前仅透传名称清单, 能力定价/SLA 由 PM-008 落地
    res.json({ success: true, data: { shop: { id: row.id, shopType: row.shop_type, shopName: row.shop_name, status: row.status }, capabilities: row.capabilities || [], wiringNote: 'PM-008 能力联动挂接点' } });
  } catch (e) { next(e); }
});

/* ─────────────── PM-002 订单类型配置 ─────────────── */

/** 类型字典列表 (字典化: MVP 三类, 预留扩展) */
router.get('/order-types', requireAuth, async (req: AuthedReq, res: Response, next: NextFunction) => {
  try {
    const orgId = orgOf(req);
    const r = await pool.query(
      `SELECT id, type_code, type_name, default_target_shop_type, sort_order, enabled, remark
       FROM booth_order_types WHERE org_id = $1 ORDER BY sort_order, id`,
      [orgId]
    );
    res.json({ success: true, data: r.rows, shopTypeNames: SHOP_TYPE_NAMES });
  } catch (e) { next(e); }
});

/** 新增类型 (字典化扩展预留; MVP 三类由种子提供, 允许追加) */
router.post('/order-types', requireAuth, requireWriteAccess, async (req: AuthedReq, res: Response, next: NextFunction) => {
  try {
    const orgId = orgOf(req);
    const body = req.body as { typeCode?: string; typeName?: string; defaultTargetShopType?: string; remark?: string };
    if (!body.typeCode || !body.typeName) return res.status(400).json({ success: false, error: 'typeCode/typeName required', code: 'MISSING_FIELDS' });
    if (!SHOP_TYPES.includes(body.defaultTargetShopType as never)) {
      return res.status(400).json({ success: false, error: `defaultTargetShopType must be one of ${SHOP_TYPES.join('/')}`, code: 'INVALID_SHOP_TYPE' });
    }
    const dup = await pool.query('SELECT id FROM booth_order_types WHERE org_id = $1 AND type_code = $2', [orgId, body.typeCode]);
    if (dup.rows.length > 0) return res.status(409).json({ success: false, error: 'type code exists', code: 'DUPLICATE_TYPE' });
    const maxSort = await pool.query('SELECT COALESCE(MAX(sort_order),0)::int + 1 AS n FROM booth_order_types WHERE org_id = $1', [orgId]);
    const r = await pool.query(
      `INSERT INTO booth_order_types (org_id, type_code, type_name, default_target_shop_type, sort_order, remark)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [orgId, String(body.typeCode).trim(), String(body.typeName).trim(), body.defaultTargetShopType, maxSort.rows[0].n, body.remark ?? null]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e) { next(e); }
});

/** 修改类型 (改映射/停用) */
router.put('/order-types/:id', requireAuth, requireWriteAccess, async (req: AuthedReq, res: Response, next: NextFunction) => {
  try {
    const orgId = orgOf(req);
    const id = Number(req.params.id);
    const body = req.body as { typeName?: string; defaultTargetShopType?: string; enabled?: boolean; remark?: string };
    if (body.defaultTargetShopType && !SHOP_TYPES.includes(body.defaultTargetShopType as never)) {
      return res.status(400).json({ success: false, error: `defaultTargetShopType must be one of ${SHOP_TYPES.join('/')}`, code: 'INVALID_SHOP_TYPE' });
    }
    const r = await pool.query(
      `UPDATE booth_order_types SET
         type_name = COALESCE($3, type_name),
         default_target_shop_type = COALESCE($4, default_target_shop_type),
         enabled = COALESCE($5, enabled),
         remark = COALESCE($6, remark)
       WHERE id = $1 AND org_id = $2 RETURNING *`,
      [id, orgId, body.typeName ?? null, body.defaultTargetShopType ?? null, typeof body.enabled === 'boolean' ? body.enabled : null, body.remark ?? null]
    );
    if (r.rows.length === 0) return res.status(404).json({ success: false, error: 'not found', code: 'NOT_FOUND' });
    res.json({ success: true, data: r.rows[0] });
  } catch (e) { next(e); }
});

/* ─────────────── PM-004 角色管理 (修正口径) ─────────────── */

/** 生态角色链 + 价格边界矩阵 (BDD-17 权威口径; DEU=DU 分身非独立角色) */
router.get('/rbac/roles', requireAuth, async (req: AuthedReq, res: Response, next: NextFunction) => {
  try {
    const user = req.user as { roleKey?: string; actingAs?: string; orgId?: number; hats?: string[] } | undefined;
    // [BUG-20260908-BOOTH-ECO-01 修复] 响应结构与前端 RbacRoles 契约对齐 (chain[].roleKey/ecoName/priceVisible + me)
    const chain = [
      { roleKey: 'dm', ecoName: 'DM', layer: 'M-层', priceVisible: true, description: '生态管理 (M 层上游, 只读)' },
      { roleKey: 'du', ecoName: 'DU', layer: 'M-层', priceVisible: true, description: '店主/履约铺主' },
      { roleKey: 'dx', ecoName: 'DX', layer: 'X-管理', priceVisible: true, description: '店长' },
      { roleKey: 'ex', ecoName: 'DEX', layer: 'X-执行', priceVisible: false, description: 'DEX = ex (店-铺长), 全链路不可见售价' },
      { roleKey: 'exx', ecoName: 'DEXX', layer: 'X-执行', priceVisible: false, description: 'DEXX = exx (铺员), 全链路不可见售价' },
    ];
    const roleKey = user?.roleKey || 'du';
    const self = chain.find((c) => c.roleKey === roleKey);
    const ecoName = user?.actingAs === 'deu' ? 'DEU (DU 分身)' : self?.ecoName || roleKey.toUpperCase();
    const priceVisible = canSeePrice(user as never);
    const hatScope: Record<string, string> = { FAB: 'fab', WH: 'wh', DL: 'dl', SVC: 'svc' };
    const hats = user?.hats || [];
    const menuScope =
      roleKey === 'exx'
        ? hats.map((h) => hatScope[h]).filter(Boolean)
        : roleKey === 'ex'
          ? ['fab', 'wh', 'dl', 'svc']
          : ['mkt', 'fab', 'wh', 'dl', 'svc'];
    const dataScope = ['du', 'dx', 'dm'].includes(roleKey)
      ? `org#${user?.orgId ?? 1} 全域 (M/X 管理层)`
      : roleKey === 'ex'
        ? `org#${user?.orgId ?? 1} 履约铺执行域 (DEX, 无价格)`
        : `org#${user?.orgId ?? 1} 帽子域 [${hats.join('/') || '无'}] (DEXX, 无价格)`;
    res.json({
      success: true,
      data: {
        chain,
        deuExplanation: 'DEU=DU 履约铺分身, 非独立角色 (会话级别名 X-Acting-As: deu); 保留经营决策权 (订单下发/审批终审/看板/收入) 与价格可见; 系统内不出现 DEU 独立角色。',
        me: {
          roleKey,
          ecoName,
          actingAs: user?.actingAs,
          priceVisible,
          menuScope,
          dataScope,
        },
      },
    });
  } catch (e) { next(e); }
});

/** 当前用户权限视图 (前端菜单权限依据 — BDD-17 双层校验之后端数据权限层) */
router.get('/rbac/me', requireAuth, async (req: AuthedReq, res: Response, next: NextFunction) => {
  try {
    const user = req.user as { roleKey?: string; actingAs?: string; orgMode?: string; hats?: string[] } | undefined;
    const roleKey = user?.roleKey || 'exx';
    const actingAs = user?.actingAs; // 'deu' | undefined
    const priceVisible = canSeePrice(user as never);
    const isXExec = isXExecutor(user as never);
    res.json({
      success: true,
      data: {
        roleKey,
        actingAs,
        isDeuShadow: actingAs === 'deu',
        priceVisible,
        xExecutorStripped: isXExec,
        hats: user?.hats || [],
        menuScope: roleKey === 'dm' ? ['du'] : [roleKey], // dm 复用 du 菜单视图
        note: '前端按 priceVisible 渲染价格列; 后端 ex/exx 路由已挂 stripXExecutorPrices 数据权限层',
      },
    });
  } catch (e) { next(e); }
});

export default router;
