import { Router } from 'express';
import { oasLogin, verifyOASToken, toBoothUser, getOASConfigStatus, isOASAuthReady, oasDevToken, type BoothUser } from '../services/oas-client.js';
import { emitAudit } from '../services/audit-service.js';

const router = Router();

/**
 * [BOOTH-R7-01] POST /login —— 已收口为 OAS AMS 单一登录源
 *
 * 用户名/密码透传 OAS AMS 代理: POST /api/v1/os/booth/proxy/ams/auth/login
 * 响应直接透传 OAS 原生 RS256 access_token (Booth 不再本地换签/自签)。
 * OAS 校验失败/账号不存在 → 401, 不回退本地账号 (legacy 信任源已移除)。
 * 登录成功/失败均有审计埋点 ([R7-03])。
 */
router.post('/login', async (req, res, next) => {
  try {
    const { phone, password, username } = req.body;
    const loginId = username || phone;

    if (!loginId || !password) {
      return res.status(400).json({ success: false, error: 'Username/phone and password are required', code: 'MISSING_FIELDS' });
    }
    if (!isOASAuthReady()) {
      return res.status(503).json({
        success: false,
        error: 'Authentication service not ready: OAS public key missing (fail-closed)',
        code: 'AUTH_NOT_READY',
      });
    }

    const oas = await oasLogin(loginId, password);
    if (!oas.ok || !oas.data?.access_token) {
      // [R7-03] 登录失败审计 (异常路径)
      await emitAudit({
        actor: loginId,
        action: 'auth.login',
        resource: 'booth_session',
        resourceId: loginId,
        result: 'failure',
        detail: { reason: oas.error || `OAS ${oas.status}` },
      });
      return res.status(oas.status === 502 || oas.status === 503 ? 502 : 401).json({
        success: false,
        error: oas.error || 'Invalid credentials (OAS AMS)',
        code: 'INVALID_CREDENTIALS',
      });
    }

    const v = verifyOASToken(oas.data.access_token);
    if (!v.ok) {
      await emitAudit({
        actor: loginId,
        action: 'auth.login',
        resource: 'booth_session',
        resourceId: loginId,
        result: 'failure',
        detail: { reason: `token verify: ${v.reason}` },
      });
      return res.status(401).json({ success: false, error: `OAS token rejected: ${v.reason}`, code: 'E_INVALID_TOKEN' });
    }

    const user = toBoothUser(v.payload, Number(v.payload.org_id ?? 1) || 1);

    // [R7-03] 登录成功审计
    await emitAudit({
      actor: String(user.identity_id ?? loginId),
      action: 'auth.login',
      resource: 'booth_session',
      resourceId: String(user.identity_id ?? loginId),
      result: 'success',
      detail: { role: user.role, roleKey: user.roleKey, hats: user.hats },
    });

    return res.json({
      success: true,
      data: {
        // [R7-01] 直接透传 OAS RS256 token, Booth 不再签发任何本地令牌
        token: oas.data.access_token,
        oas_token: oas.data.access_token,
        expires_in: oas.data.expires_in,
        user: {
          id: 0,
          identityId: user.identity_id,
          name: user.name ?? loginId,
          role: user.role,
          roleKey: user.roleKey,
          hats: user.hats,
          orgId: user.orgId,
          orgMode: user.orgMode,
          edition: user.edition ?? null,
          msAccess: user.ms_access ?? [],
          source: 'oas',
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * [AUTH-02] POST /dev-token —— 开发期临时令牌接入 (仅 DEV/beta, 生产 404)
 *
 * 代理 OAS POST /api/v1/auth/dev-token (Booth 不自行签发, 仅透传+本地验签+角色映射)。
 * token claims 与正式登录一致, 验签走 Booth 已配置的 OAS 公钥 (显式 PEM 或 JWKS 自动发现), 无豁免。
 * 生成即验签: 保证返回给前端的 token 一定能通过 Booth 认证中间件。
 */
router.post('/dev-token', async (req, res, next) => {
  try {
    if (process.env.COZE_PROJECT_ENV === 'PROD') {
      return res.status(404).json({ success: false, error: 'Not Found', code: 'NOT_FOUND' });
    }
    const body = (req.body ?? {}) as { username?: string; role?: string; expires_minutes?: number };
    const minutes = Number(body.expires_minutes ?? 30);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 60) {
      return res.status(400).json({ success: false, error: 'expires_minutes must be 1-60 (DEV cap)', code: 'INVALID_BODY' });
    }

    const oas = await oasDevToken({
      ...(body.username ? { username: String(body.username).trim() } : {}),
      ...(body.role ? { role: String(body.role).trim() } : {}),
      expires_minutes: Math.floor(minutes),
    });
    if (!oas.ok || !oas.data?.token) {
      // [R7-03] dev-token 失败审计
      await emitAudit({
        actor: body.username || 'dev-token',
        action: 'auth.dev_token',
        resource: 'booth_session',
        resourceId: body.role || 'default',
        result: 'failure',
        detail: { reason: oas.error || `OAS ${oas.status}` },
      });
      const notReady = oas.status === 404;
      return res.status(notReady ? 503 : (oas.status === 401 || oas.status === 403 ? 401 : 502)).json({
        success: false,
        error: notReady ? 'OAS dev-token endpoint not ready (404) - OAS implementation pending' : (oas.error || 'OAS dev-token failed'),
        code: notReady ? 'OAS_DEV_TOKEN_NOT_READY' : 'OAS_DEV_TOKEN_FAILED',
      });
    }

    const v = verifyOASToken(oas.data.token);
    if (!v.ok) {
      await emitAudit({
        actor: oas.data.username || 'dev-token',
        action: 'auth.dev_token',
        resource: 'booth_session',
        resourceId: oas.data.role || 'default',
        result: 'failure',
        detail: { reason: `token verify: ${v.reason}` },
      });
      return res.status(502).json({ success: false, error: `dev-token rejected by Booth verify: ${v.reason}`, code: 'E_INVALID_TOKEN' });
    }

    const user = toBoothUser(v.payload, Number(v.payload.org_id ?? 1) || 1);
    // [R7-03] dev-token 成功审计
    await emitAudit({
      actor: String(user.identity_id ?? oas.data.username ?? 'dev-token'),
      action: 'auth.dev_token',
      resource: 'booth_session',
      resourceId: String(user.identity_id ?? 'dev-token'),
      result: 'success',
      detail: { role: user.role, roleKey: user.roleKey, hats: user.hats, oas_role: oas.data.role, expires_at: oas.data.expires_at },
    });

    return res.json({
      success: true,
      data: {
        token: oas.data.token,
        expires_at: oas.data.expires_at ?? null,
        oas: { username: oas.data.username ?? null, role: oas.data.role ?? null },
        user: {
          id: 0,
          identityId: user.identity_id,
          name: user.name ?? oas.data.username ?? 'dev-user',
          role: user.role,
          roleKey: user.roleKey,
          hats: user.hats,
          orgId: user.orgId,
          orgMode: user.orgMode,
          edition: user.edition ?? null,
          msAccess: user.ms_access ?? [],
          source: 'oas-dev-token',
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /oas-status —— OAS 配置状态 (R7-DEF: 增加 authReady/failClosed)
 */
router.get('/oas-status', (_req, res) => {
  res.json({ success: true, data: getOASConfigStatus() });
});

/**
 * POST /logout (无状态 JWT, 保留一致性 API; token 失效交由 OAS 侧过期/吊销)
 */
router.post('/logout', (_req, res) => {
  res.json({ success: true, data: { message: 'Logged out successfully' } });
});

export default router;

// [BOOTH-R7-01] legacy 移除清单: 本地 booth_users 密码校验 / signToken / signTokenFromOAS / bcrypt 依赖
// 13800000001~06 本地测试账号不再可用 (OAS AMS 未同步该批账号, 见回报遗留缺口); OAS test-accounts 五角色为登录验收口径
