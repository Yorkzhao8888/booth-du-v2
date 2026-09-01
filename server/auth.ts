import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { verifyOASToken, oasPayloadToBoothUser, isOASEnabled, type BoothUserFromOAS } from './services/oas-client.js';

const JWT_SECRET = process.env.JWT_SECRET || 'booth-dev-secret';

// ---------------------------------------------------------------------------
// [DEPRECATED - 兼容层] Legacy JWT 载荷与本地签发（OAS 为主认证路径）
// 兼容截止日: 2026-12-31。届时评估移除需主 Agent 另行裁定。
// 约定: 认证主路径 = OAS（signTokenFromOAS 签发 / verifyOASToken 校验）；
// legacy 本地 JWT 仅作为 fallback 保留（本地测试账号/EM 登录），冻结不扩展。
// ---------------------------------------------------------------------------
// Legacy JWT payload (for backward compatibility during transition)
export interface JwtPayload {
  userId: number;
  orgId: number;
  name: string;
  role: string;
  hats: string[];
  orgMode: string;
  // OAS fields (when using OAS tokens)
  identityId?: string;
  subRole?: string;
  nhiFlag?: boolean;
  msAccess?: string[];
  source?: 'oas' | 'legacy';
}

/**
 * [DEPRECATED - legacy fallback] 本地账号签发（测试账号/EM 本地登录用）。
 * 主认证签发路径请使用 signTokenFromOAS。兼容截止日: 2026-12-31。
 */
export function signToken(user: {
  id: number;
  org_id: number;
  name: string;
  role: string;
  hats: string[];
  orgMode: string;
}): string {
  const payload: JwtPayload = {
    userId: user.id,
    orgId: user.org_id,
    name: user.name,
    role: user.role,
    hats: user.hats || [],
    orgMode: user.orgMode,
    source: 'legacy',
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
}

/**
 * [主认证路径] Sign a token from OAS user info
 */
export function signTokenFromOAS(user: BoothUserFromOAS): string {
  const payload: JwtPayload = {
    userId: 0, // OAS users don't have local IDs
    orgId: user.orgId,
    name: user.name,
    role: user.role,
    hats: user.hats,
    orgMode: user.orgMode,
    identityId: user.identityId,
    subRole: user.subRole,
    nhiFlag: user.nhiFlag,
    msAccess: user.msAccess,
    source: 'oas',
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '15m' }); // Shorter expiry for OAS tokens
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  // Prefer Authorization: Bearer header; fall back to ?token= query param
  // (EventSource/SSE cannot set custom headers).
  let token: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (typeof req.query.token === 'string' && req.query.token) {
    token = req.query.token;
  } else {
    // Fallback: manually parse token from raw URL (in case proxy strips query)
    try {
      const rawUrl = req.url || '';
      const qIdx = rawUrl.indexOf('?');
      if (qIdx !== -1) {
        const params = new URLSearchParams(rawUrl.slice(qIdx));
        const t = params.get('token');
        if (t) token = t;
      }
    } catch { /* ignore */ }
  }

  // Debug log for production troubleshooting
  if (!token) {
    console.warn('[auth] No token found. headers.authorization:', !!authHeader, 'query:', JSON.stringify(req.query), 'url:', req.url);
  }

  // [BOOTH-PK-03] 边缘设备遥测上报密钥通道: 无 JWT 时允许 X-Telemetry-Key 匹配 env.TELEMETRY_INGEST_KEY 放行。
  // org 归属校验在业务 handler 内完成; env 未配置时该通道永不可用(fail-closed), 不留假 token。
  const telemetryKey = req.headers['x-telemetry-key'];
  if (
    !token &&
    typeof telemetryKey === 'string' &&
    telemetryKey.length > 0 &&
    process.env.TELEMETRY_INGEST_KEY &&
    telemetryKey === process.env.TELEMETRY_INGEST_KEY
  ) {
    // @ts-ignore mark key-channel auth for telemetry ingest handler
    req.telemetryKeyAuth = true;
    return next();
  }

  if (!token) {
    return next({ statusCode: 401, code: 'UNAUTHORIZED', error: 'Missing or invalid token' });
  }

  // ---- [主认证路径] OAS JWT verification first if OAS is enabled ----
  if (isOASEnabled()) {
    const oasPayload = verifyOASToken(token);
    if (oasPayload) {
      const boothUser = oasPayloadToBoothUser(oasPayload);
      if (boothUser) {
        // @ts-ignore
        req.user = {
          userId: 0,
          orgId: boothUser.orgId,
          name: boothUser.name,
          role: boothUser.role,
          hats: boothUser.hats,
          orgMode: boothUser.orgMode,
          identityId: boothUser.identityId,
          subRole: boothUser.subRole,
          nhiFlag: boothUser.nhiFlag,
          msAccess: boothUser.msAccess,
          source: 'oas',
        } as JwtPayload;
        return next();
      }
    }
    // If OAS verification fails, fall through to legacy verification
    // This allows for graceful migration
  }

  // ---------------------------------------------------------------------------
  // [DEPRECATED - fallback] Legacy JWT verification
  // 仅当 OAS 关闭或 OAS 校验失败时进入（graceful migration）。
  // 兼容截止日: 2026-12-31。行为冻结：不新增字段、不放宽校验。
  // Fail-closed: OAS 与 legacy 均失败时拒绝访问（401），保持现状。
  // ---------------------------------------------------------------------------
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    // @ts-ignore
    req.user = decoded;
    next();
  } catch {
    // Fail-closed: if both OAS and legacy verification fail, deny access
    next({ statusCode: 401, code: 'INVALID_TOKEN', error: 'Token verification failed' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    // @ts-ignore
    const user = req.user as JwtPayload;
    if (!user || !roles.includes(user.role)) {
      return next({ statusCode: 403, code: 'FORBIDDEN', error: 'Insufficient role' });
    }
    next();
  };
}

export function requireHat(hat: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    // @ts-ignore
    const user = req.user as JwtPayload;
    if (!user || !user.hats || !user.hats.includes(hat)) {
      return next({ statusCode: 403, code: 'FORBIDDEN', error: `Missing hat: ${hat}` });
    }
    next();
  };
}

// DM 运营：只读穿透（可访问所有读接口，写接口 403）
export function requireWriteAccess(req: Request, _res: Response, next: NextFunction) {
  // @ts-ignore
  const user = req.user as JwtPayload;
  if (user?.role === 'dm') {
    const method = req.method?.toUpperCase();
    if (method && method !== 'GET' && method !== 'HEAD') {
      return next({ statusCode: 403, code: 'FORBIDDEN', error: 'DM role is read-only' });
    }
  }
  next();
}

// Price isolation: strip cost/price fields for DXX role
export function stripCostFields<T>(obj: T): T {
  // @ts-ignore
  const user = { role: 'unknown' } as JwtPayload; // Will be overridden by middleware context
  
  const COST_FIELDS = [
    'costPrice', 'cost_price', 'unitCost', 'unit_cost', 'totalCost', 'total_cost',
    'purchasePrice', 'purchase_price', 'margin', 'grossMargin', 'gross_margin',
    'profit', 'grossProfit', 'gross_profit', 'netProfit', 'net_profit',
    'materialCost', 'material_cost', 'laborCost', 'labor_cost',
    'revenue', 'settleAmount', 'settle_amount', 'totalSettled', 'total_settled',
    'pendingSettlement', 'pending_settlement',
  ];

  function strip(obj: unknown): unknown {
    if (Array.isArray(obj)) {
      return obj.map(strip);
    }
    if (obj && typeof obj === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (!COST_FIELDS.includes(key)) {
          result[key] = strip(value);
        }
      }
      return result;
    }
    return obj;
  }

  return strip(obj) as T;
}

// Middleware to strip cost fields for DXX role
export function stripCostFieldsForDXX(req: Request, res: Response, next: NextFunction) {
  // @ts-ignore
  const user = req.user as JwtPayload;
  
  if (user?.role === 'dxx') {
    const originalJson = res.json.bind(res);
    res.json = function (body: unknown) {
      return originalJson(stripCostFields(body as Record<string, unknown>));
    };
  }
  
  next();
}
