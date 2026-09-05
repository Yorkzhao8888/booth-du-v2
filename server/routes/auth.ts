import { Router } from 'express';
import { oasLogin, verifyOASToken, toBoothUser, getOASConfigStatus, OAS_AUTH_READY } from '../services/oas-client.js';
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
    if (!OAS_AUTH_READY) {
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
