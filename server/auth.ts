/**
 * [BOOTH-R7-01 / R7-DEF] 认证中间件 —— 已收口为 OAS 单一信任源
 *  - 仅接受 OAS 签发 RS256 JWT (iss=ziway-oas, 公钥验签)
 *  - OAS_PUBLIC_KEY 未就绪 → 503 AUTH_NOT_READY (fail-closed, 启动期 FATAL 日志)
 *  - legacy 自签 HS256 JWT 信任源已移除 (不再接受非 OAS 签发令牌, 不降级放行)
 *  - telemetry 内部通道独立密钥 (X-Telemetry-Key), 与登录态无关, 保留
 */
import type { Request, Response, NextFunction } from 'express';
import { pool } from './db.js';
import { verifyOASToken, toBoothUser, isOASEnabled, isOASAuthReady, type BoothUser } from './services/oas-client.js';

export type { BoothUser };

const TELEMETRY_KEY = process.env.TELEMETRY_KEY || 'dev-telemetry-2024';

export interface AuthedRequest extends Request {
  user?: BoothUser;
  telemetry?: boolean;
}

/**
 * [OAS-OPEN-DEV-01] 开发期认证放行开关:
 *  - 仅当环境变量 OAS_AUTH_ENABLED 显式 = 'false' 时关闭认证 (默认 true, 安全默认: 漏配 = 认证开)
 *  - 关闭时: requireAuth 匿名放行 (带合法 OAS token 仍解析挂真实身份; 无/无效 token 挂开发匿名身份 du+全帽)
 *            requireRole / requireHat 全部短路放行
 *  - 内测恢复: 部署 env 移除 OAS_AUTH_ENABLED 或设为任意非 'false' 值, 重启即恢复 RS256 认证, 零代码改动
 */
export const AUTH_OPEN = String(process.env.OAS_AUTH_ENABLED ?? 'true').trim().toLowerCase() === 'false';

/** 开发期匿名身份: 等价 du 角色 + 全帽子, 保证所有 handler 对 req.user 的读取不崩、页面开发视图完整 */
export function buildAnonymousUser(): BoothUser {
  return {
    userId: 0,
    identity_id: 'dev-anonymous',
    name: '(开发期匿名)',
    role: 'du',
    roleKey: 'du',
    subRole: 'du',
    hats: ['FAB', 'WH', 'DL', 'SVC', 'MKT'],
    orgId: 1,
    orgMode: 'du',
    edition: null,
    nhiFlag: false,
    ms_access: [],
    source: 'oas',
  };
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

  // [OAS-OPEN-DEV-01] 开发期放行: 合法 OAS token 挂真实身份, 否则匿名 du 全帽
  if (AUTH_OPEN) {
    const header0 = req.headers.authorization;
    const token0 = header0?.startsWith('Bearer ')
      ? header0.slice(7)
      : ((req.headers['x-oas-token'] as string) || (req.query.token as string) || '');
    if (token0 && isOASAuthReady()) {
      const v0 = verifyOASToken(token0);
      if (v0.ok) {
        req.user = toBoothUser(v0.payload, Number(v0.payload.org_id ?? v0.payload.orgId ?? 1) || 1);
        return next();
      }
    }
    req.user = buildAnonymousUser();
    return next();
  }

  // [R7-DEF] fail-closed: OAS 启用但公钥未就绪 → 拒绝 (503), 不降级
  if (!isOASAuthReady()) {
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
  // [BOOTH-PRD-002] DEU 分身: DU 携 X-Acting-As: deu 进入履约铺后台 (会话级身份, 非独立角色; 保留经营决策权/价格可见)
  const acting = String(req.headers['x-acting-as'] || '').toLowerCase();
  if (acting === 'deu' && req.user.roleKey === 'du') req.user.actingAs = 'deu';
  next();
}

/** 角色 → org 绑定校验 + RBAC + 帽子 (逻辑不变, 信任源已收口为 OAS) */
const ROLE_ORG_MAP: Record<string, number> = { dm: 1, du: 1, dx: 1, dxx: 1, ex: 1, exx: 1, em: 1 };

export function requireRole(...allowed: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    // [OAS-OPEN-DEV-01] 开发期放行
    if (AUTH_OPEN) return next();
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ success: false, error: 'Unauthenticated', code: 'E_NO_TOKEN' });
      const deuAsEx = allowed.includes('ex') && user.roleKey === 'du' && user.actingAs === 'deu'; // DEU 分身可入 DEX(ex) 端
      if (!allowed.includes(user.roleKey) && !deuAsEx) {
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
    // [OAS-OPEN-DEV-01] 开发期放行
    if (AUTH_OPEN) return next();
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

/** [BOOTH-PRD-002 价格红线] X 层执行响应统一剥售价 (前后端双重拦截之数据权限层; DEU 分身豁免) */
export function stripXExecutorPrices(req: AuthedRequest, res: Response, next: NextFunction) {
  const originalJson = res.json.bind(res);
  res.json = (body: unknown) => {
    if (isXExecutor(req.user as never)) return originalJson(stripSalePriceFields(body));
    return originalJson(body);
  };
  next();
}

/** [BOOTH-R7] 成本剥离 (价格红线: X 层零价) — 从 oas-client 权威实现转发 */
import { stripCostFields as _stripCostFields, stripSalePriceFields as _stripSalePriceFields, isXExecutor as _isXExecutor } from './services/oas-client.js';
export const stripCostFields = _stripCostFields;
export const stripSalePriceFields = _stripSalePriceFields;
export const isXExecutor = _isXExecutor;

// [R7-DEF] 以下 legacy 能力已移除: signToken (HS256 自签), signTokenFromOAS (本地换签), LEGACY verify fallback
// 登录响应直接透传 OAS 原生 access_token (RS256), 见 server/routes/auth.ts
