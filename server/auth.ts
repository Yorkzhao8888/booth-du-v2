/**
 * [BOOTH-R7-01 / R7-DEF] 认证中间件 —— 已收口为 OAS 单一信任源
 *  - 仅接受 OAS 签发 RS256 JWT (iss=ziway-oas, 公钥验签)
 *  - OAS_PUBLIC_KEY 未就绪 → 503 AUTH_NOT_READY (fail-closed, 启动期 FATAL 日志)
 *  - legacy 自签 HS256 JWT 信任源已移除 (不再接受非 OAS 签发令牌, 不降级放行)
 *  - telemetry 内部通道独立密钥 (X-Telemetry-Key), 与登录态无关, 保留
 */
import type { Request, Response, NextFunction } from 'express';
import { pool } from './db.js';
import { verifyOASToken, toBoothUser, isOASEnabled, OAS_AUTH_READY, type BoothUser } from './services/oas-client.js';

export type { BoothUser };

const TELEMETRY_KEY = process.env.TELEMETRY_KEY || 'dev-telemetry-2024';

export interface AuthedRequest extends Request {
  user?: BoothUser;
  telemetry?: boolean;
}

/**
 * 统一认证入口:
 *  1. telemetry 内部通道 (X-Telemetry-Key)
 *  2. OAS RS256 JWT (Authorization: Bearer / x-oas-token / SSE query token)
 * 验签失败一律 401 拒绝, 无任何回退
 */
export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.headers['x-telemetry-key'] === TELEMETRY_KEY) {
    req.telemetry = true;
    return next();
  }

  // [R7-DEF] fail-closed: OAS 启用但公钥未就绪 → 拒绝 (503), 不降级
  if (!OAS_AUTH_READY) {
    return res.status(503).json({
      success: false,
      error: 'Authentication service not ready: OAS public key missing (fail-closed)',
      code: 'AUTH_NOT_READY',
    });
  }

  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ')
    ? header.slice(7)
    : ((req.headers['x-oas-token'] as string) || (req.query.token as string) || '');
  if (!token) {
    return res.status(401).json({ success: false, error: 'Missing token', code: 'E_NO_TOKEN' });
  }

  const v = verifyOASToken(token);
  if (!v.ok) {
    // [R7-DEF] 验签失败一律 401; AUTH_NOT_READY(理论不可达, 上方已拦) 同样拒绝
    if (v.code === 'AUTH_NOT_READY') {
      return res.status(503).json({ success: false, error: v.reason, code: 'AUTH_NOT_READY' });
    }
    return res.status(401).json({ success: false, error: `Invalid token: ${v.reason}`, code: 'E_INVALID_TOKEN' });
  }

  const payload = v.payload;
  const orgId = Number(payload.org_id ?? payload.orgId ?? 1) || 1;
  req.user = toBoothUser(payload, orgId);
  next();
}

/** 角色 → org 绑定校验 + RBAC + 帽子 (逻辑不变, 信任源已收口为 OAS) */
const ROLE_ORG_MAP: Record<string, number> = { dm: 1, du: 1, dx: 1, dxx: 1, ex: 1, exx: 1, em: 1 };

export function requireRole(...allowed: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ success: false, error: 'Unauthenticated', code: 'E_NO_TOKEN' });
      if (!allowed.includes(user.roleKey)) {
        return res.status(403).json({ success: false, error: `Forbidden: requires ${allowed.join('/')}`, code: 'E_FORBIDDEN' });
      }
      // org 绑定: OAS claim 显式 org_id 优先, 否则按角色默认绑定 Booth org=1
      const expected = ROLE_ORG_MAP[user.roleKey] ?? 1;
      if (user.orgId !== expected) {
        return res.status(403).json({ success: false, error: `Forbidden: org ${user.orgId} not bound to role ${user.roleKey}`, code: 'E_ORG_MISMATCH' });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** 写权限: dm 只读穿透 */
export async function requireWriteAccess(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.telemetry) return next();
  const user = req.user;
  if (!user) return res.status(401).json({ success: false, error: 'Unauthenticated', code: 'E_NO_TOKEN' });
  if (user.roleKey === 'dm') {
    return res.status(403).json({ success: false, error: 'Read-only role (dm) cannot write', code: 'E_READ_ONLY' });
  }
  next();
}

/** 帽子校验 (执行端 FAB/WH 等); OAS ms_access 无匹配时已在 toBoothUser 按角色兜底 */
export function requireHat(hat: string) {
  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (req.telemetry) return next();
    const user = req.user;
    if (!user) return res.status(401).json({ success: false, error: 'Unauthenticated', code: 'E_NO_TOKEN' });
    if (['du', 'dx', 'dm', 'em'].includes(user.roleKey)) return next(); // M 层全帽
    if (!user.hats?.includes(hat)) {
      return res.status(403).json({ success: false, error: `Missing hat ${hat}`, code: 'E_NO_HAT' });
    }
    next();
  };
}

/** 兼容导出: OAS 是否启用 (登录路由探测用) */
export { isOASEnabled };

/** 兼容导出: 旧代码引用名 (R7 重命名后的等价物) */
export type JwtPayload = BoothUser;

/** [BOOTH-R7] 成本剥离 (价格红线: X 层零价) — 从 oas-client 权威实现转发 */
import { stripCostFields as _stripCostFields } from './services/oas-client.js';
export const stripCostFields = _stripCostFields;

// [R7-DEF] 以下 legacy 能力已移除: signToken (HS256 自签), signTokenFromOAS (本地换签), LEGACY verify fallback
// 登录响应直接透传 OAS 原生 access_token (RS256), 见 server/routes/auth.ts
