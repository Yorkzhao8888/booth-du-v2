/**
 * [BOOTH-R7-01 / R7-DEF-1] OAS 客户端 —— RS256 强制验签版
 *
 * 信任模型: 仅信任 OAS 签发的 RS256 JWT (iss=ziway-oas)
 *  - OAS_PUBLIC_KEY (PEM, 平台侧下发) 未配置 → OAS_AUTH_READY=false → 全部认证请求 503 拒绝 (fail-closed)
 *  - test mode (跳过验签) 已彻底移除
 *  - 校验: 签名 + iss + exp; edition claim 按基座侧补齐节奏容错读取 (缺失不报错)
 */
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export const OAS_BASE_URL = process.env.OAS_BASE_URL || '';
// [R7-DEF-1] 公钥 PEM 支持 \n 字面转义 (env 单行注入) 与原生多行
const OAS_PUBLIC_KEY_RAW = process.env.OAS_PUBLIC_KEY || '';
// OAS AMS 代理 app 段 (R7-01 收口: /api/v1/os/booth/proxy/ams/auth/login)
const OAS_PROXY_APP = process.env.OAS_PROXY_APP || 'booth';

export const OAS_ISSUER = 'ziway-oas';

/** 解析 PEM 公钥; 无效/缺失返回 null */
function parsePublicKeyPem(): string | null {
  if (!OAS_PUBLIC_KEY_RAW.trim()) return null;
  const pem = OAS_PUBLIC_KEY_RAW.includes('\\n')
    ? OAS_PUBLIC_KEY_RAW.replace(/\\n/g, '\n')
    : OAS_PUBLIC_KEY_RAW;
  if (!pem.includes('-----BEGIN PUBLIC KEY-----')) return null;
  try {
    // 构造校验: 用公钥对象化验证格式有效性
    crypto.createPublicKey(pem);
    return pem;
  } catch {
    return null;
  }
}

const OAS_PUBLIC_KEY: string | null = parsePublicKeyPem();
/** [R7-DEF] fail-closed 全局标志: OAS 启用且公钥就绪才放行认证 */
export const OAS_AUTH_READY = Boolean(OAS_BASE_URL) && OAS_PUBLIC_KEY !== null;

export function isOASEnabled(): boolean {
  return Boolean(OAS_BASE_URL);
}

/** [BOOTH-R7-01/DEF] fail-closed 状态: OAS 启用但公钥未配置 → 认证全拒 (503 AUTH_NOT_READY) */
export function isOASAuthReady(): boolean {
  return OAS_AUTH_READY;
}

// ============ 价格红线: 成本字段剥离 (R7 从 auth.ts 平移, 实现不变) ============
const COST_FIELDS = [
  'costPrice', 'cost_price', 'unitCost', 'unit_cost', 'totalCost', 'total_cost',
  'purchasePrice', 'purchase_price', 'margin', 'grossMargin', 'gross_margin',
  'profit', 'grossProfit', 'gross_profit', 'netProfit', 'net_profit',
  'materialCost', 'material_cost', 'laborCost', 'labor_cost',
  'revenue', 'settleAmount', 'settle_amount', 'totalSettled', 'total_settled',
  'pendingSettlement', 'pending_settlement',
];

export function stripCostFields<T>(obj: T): T {
  function strip(obj: unknown): unknown {
    if (Array.isArray(obj)) return obj.map(strip);
    if (obj && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (!COST_FIELDS.includes(key)) result[key] = strip(value);
      }
      return result;
    }
    return obj;
  }
  return strip(obj) as T;
}

/* ─────────────────────────── 登录代理 ─────────────────────────── */

export interface OASLoginResult {
  ok: boolean;
  status: number;
  data?: { access_token: string; token_type?: string; expires_in?: number; [k: string]: unknown };
  error?: string;
}

/**
 * [R7-01] 登录统一走 OAS AMS 代理
 * POST {OAS_BASE_URL}/api/v1/os/{app}/proxy/ams/auth/login  (app=booth)
 * 五角色 test-accounts: admin/SU, operator/AU, customer/CU, viewer/GU, em/EM (test123)
 */
export async function oasLogin(username: string, password: string): Promise<OASLoginResult> {
  if (!isOASEnabled()) return { ok: false, status: 503, error: 'OAS_BASE_URL not configured' };
  try {
    const resp = await fetch(`${OAS_BASE_URL}/api/v1/os/${OAS_PROXY_APP}/proxy/ams/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(8000),
    });
    const body: any = await resp.json().catch(() => ({}));
    if (!resp.ok || !body?.data?.access_token) {
      return { ok: false, status: resp.status, error: body?.message || body?.error || `OAS ${resp.status}` };
    }
    return { ok: true, status: resp.status, data: body.data };
  } catch (err: any) {
    return { ok: false, status: 502, error: `OAS unreachable: ${err?.message || err}` };
  }
}

/* ─────────────────────────── Token 验签 ─────────────────────────── */

export interface OASTokenVerifyOk {
  ok: true;
  payload: OASTokenPayload;
}
export interface OASTokenVerifyFail {
  ok: false;
  code: 'AUTH_NOT_READY' | 'INVALID' | 'EXPIRED' | 'BAD_ISSUER';
  reason: string;
}

export interface OASTokenPayload {
  sub?: string;
  identity_id?: string;
  user_id?: string;
  role?: string;
  roles?: string[];
  active_role?: string;
  edition?: string | null;
  org_id?: number | string;
  ms_access?: string[];
  iss?: string;
  exp?: number;
  [k: string]: unknown;
}

/**
 * [R7-DEF-1] RS256 强制验签: 无公钥 → AUTH_NOT_READY (fail-closed)
 * 校验链: 签名(RS256) → iss=ziway-oas → exp; edition 缺失容错 (基座侧补齐节奏)
 */
export function verifyOASToken(token: string): OASTokenVerifyOk | OASTokenVerifyFail {
  if (!OAS_AUTH_READY || !OAS_PUBLIC_KEY) {
    return { ok: false, code: 'AUTH_NOT_READY', reason: 'OAS public key not configured (fail-closed)' };
  }
  let payload: OASTokenPayload;
  try {
    payload = jwt.verify(token, OAS_PUBLIC_KEY, {
      algorithms: ['RS256'],
      issuer: OAS_ISSUER,
      clockTolerance: 30,
    }) as OASTokenPayload;
  } catch (err: any) {
    if (err?.name === 'TokenExpiredError') return { ok: false, code: 'EXPIRED', reason: 'token expired' };
    if (err?.message?.includes('issuer')) return { ok: false, code: 'BAD_ISSUER', reason: 'issuer mismatch (expected ziway-oas)' };
    return { ok: false, code: 'INVALID', reason: `signature/claims rejected: ${err?.message || 'bad token'}` };
  }
  if (!payload.role && !payload.active_role && !payload.roles?.length) {
    return { ok: false, code: 'INVALID', reason: 'missing role claim' };
  }
  // edition claim: 基座侧已补; Booth 侧读取不报错 (缺失容错)
  void payload.edition;
  return { ok: true, payload };
}

/* ─────────────────────────── 角色映射 ─────────────────────────── */

/**
 * [R7-01] OAS 角色 → Booth 角色映射 (13U 修正口径: Booth 归供给侧 EU 线)
 *
 * 五角色 (OAS test-accounts):
 *   SU (admin)    → du   (店主, M 层知价, 经营全权)   [原 'su'→'dm' 只读穿透与 SU 权限语义冲突, 收口修正]
 *   AU (operator) → dx   (店长, M 层知价, 运营操作)
 *   CU (customer) → exx  (铺员执行位, X 层无价, FAB 帽)
 *   GU (viewer)   → dxx  (只读店员, 穿透视图)
 *   EM            → em   (供给运营平台位, 直通)
 * 12U 历史角色直通兼容: dm/du/dx/dxx/ex/exx/em
 */
const ROLE_TO_BOOTH: Record<string, string> = {
  SU: 'du',
  AU: 'dx',
  CU: 'exx',
  GU: 'dxx',
  EM: 'em',
  // 12U 直通
  DM: 'dm',
  DU: 'du',
  DX: 'dx',
  DXX: 'dxx',
  EX: 'ex',
  EXX: 'exx',
  EM_OLD: 'em', // 占位防重名, 实际 EM 已映射
};

/** 角色默认帽子兜底 (OAS ms_access 为系统缩写 fms/sms/..., 非 Booth 帽子词, 派生为空时启用) */
const ROLE_DEFAULT_HATS: Record<string, string[]> = {
  du: ['FAB', 'WH', 'DL', 'SVC', 'MKT'],
  dx: ['FAB', 'WH', 'DL', 'SVC', 'MKT'],
  ex: ['FAB', 'WH', 'DL', 'SVC', 'MKT'],
  exx: ['FAB'],
  dxx: [],
  dm: ['FAB', 'WH', 'DL', 'SVC', 'MKT'],
  em: ['FAB', 'WH', 'DL', 'SVC', 'MKT'],
};

/** ms_access 中 Booth 帽子派生 (保留: OAS 未来下发业务帽时自动生效) */
function deriveHats(msAccess?: string[]): string[] {
  if (!Array.isArray(msAccess)) return [];
  return msAccess.filter((m) => ['FAB', 'WH', 'DL', 'SVC', 'MKT'].includes(String(m).toUpperCase()));
}

export interface BoothUser {
  userId: number; // 兼容字段 (R7 收口后 OAS 会话固定 0)
  identity_id: string;
  name?: string;
  role: string;
  subRole?: string;
  roleKey: string;
  hats: string[];
  orgId: number;
  orgMode: string;
  nhiFlag: boolean;
  edition: string | null;
  ms_access: string[];
  source: 'oas';
}

/** OAS payload → Booth 会话用户 (角色映射 + 帽子兜底) */
export function toBoothUser(payload: OASTokenPayload, orgId: number): BoothUser {
  const activeRole = String(payload.active_role || payload.role || payload.roles?.[0] || '').toUpperCase();
  const roleKey = ROLE_TO_BOOTH[activeRole] || 'dxx';
  const derived = deriveHats(payload.ms_access);
  const hats = derived.length > 0 ? derived : ROLE_DEFAULT_HATS[roleKey] || [];
  return {
    userId: 0,
    identity_id: String(payload.identity_id ?? payload.user_id ?? payload.sub ?? 'unknown'),
    name: (payload.name as string) || undefined,
    role: roleKey, // [BOOTH-R7-01] Booth 角色 (requireRole 语义); OAS 原角色保存在 subRole
    subRole: activeRole || undefined,
    roleKey,
    hats,
    orgId: Number(payload.org_id ?? orgId) || 1,
    orgMode: 'du',
    nhiFlag: Boolean(payload.nhi_flag),
    edition: (payload.edition as string) ?? null,
    ms_access: Array.isArray(payload.ms_access) ? payload.ms_access : [],
    source: 'oas',
  };
}

/** 兼容别名 (历史调用点) */
export const oasPayloadToBoothUser = (payload: OASTokenPayload): BoothUser | null => toBoothUser(payload, 1);

/* ─────────────────────────── 配置状态 ─────────────────────────── */

export function getOASConfigStatus() {
  return {
    enabled: isOASEnabled(),
    baseUrl: OAS_BASE_URL || null,
    supplyOs: process.env.OAS_SUPPLY_OS || 'booth',
    proxyApp: OAS_PROXY_APP,
    authReady: OAS_AUTH_READY,
    failClosed: isOASEnabled() && !OAS_AUTH_READY,
    publicKeyConfigured: OAS_PUBLIC_KEY !== null,
    issuer: OAS_ISSUER,
    eventSigning: process.env.OAS_EVENT_SIGNING_KEY ? 'enabled' : 'disabled', // [R7-DEF-3]
    roleMapping: { SU: 'du', AU: 'dx', CU: 'exx', GU: 'dxx', EM: 'em' },
  };
}
