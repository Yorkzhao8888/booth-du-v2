import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { signToken, signTokenFromOAS } from '../auth.js';
import { orgModes } from '../migrate.js';
import { oasLogin, isOASEnabled, verifyOASToken, oasPayloadToBoothUser, getOASConfigStatus } from '../services/oas-client.js';

const router = Router();

/**
 * POST /login
 * 
 * If OAS is enabled, proxy login through OAS.
 * Otherwise, fall back to local authentication.
 */
router.post('/login', async (req, res, next) => {
  try {
    const { phone, password, username } = req.body;

    // Support both phone and username for OAS compatibility
    const loginId = username || phone;

    if (!loginId || !password) {
      return res.status(400).json({ 
        success: false, 
        error: 'Username/phone and password are required', 
        code: 'MISSING_FIELDS' 
      });
    }

    // [主认证路径] OAS authentication first
    if (isOASEnabled()) {
      const oasResponse = await oasLogin(loginId, password);
      
      if (oasResponse.success && oasResponse.data?.access_token) {
        // Verify the OAS token and extract user info
        const oasPayload = verifyOASToken(oasResponse.data.access_token);
        if (oasPayload) {
          const boothUser = oasPayloadToBoothUser(oasPayload);
          if (boothUser) {
            // Sign a Booth-local token for subsequent requests
            const token = signTokenFromOAS(boothUser);

            return res.json({
              success: true,
              data: {
                token,
                oas_token: oasResponse.data.access_token,
                expires_in: oasResponse.data.expires_in,
                user: {
                  id: 0,
                  identityId: boothUser.identityId,
                  name: boothUser.name,
                  role: boothUser.role,
                  subRole: boothUser.subRole,
                  hats: boothUser.hats,
                  orgId: boothUser.orgId,
                  orgMode: boothUser.orgMode,
                  nhiFlag: boothUser.nhiFlag,
                  msAccess: boothUser.msAccess,
                  source: 'oas',
                },
              },
            });
          }
        }
      }
      // OAS login failed or role mapping failed - fall through to local auth
      // This allows local accounts (like EM) to login even when OAS is enabled
      console.log('[auth] OAS login failed for %s, falling back to local auth', loginId);
    }

    // [DEPRECATED - fallback] Local authentication (legacy 本地账号: 测试账号/EM)
    // 兼容截止日: 2026-12-31, 见 server/auth.ts 兼容层标注。行为冻结不扩展。
    const userRes = await pool.query(
      `SELECT u.*, o.mode as org_mode
       FROM booth_users u
       JOIN booth_orgs o ON o.id = u.org_id
       WHERE u.phone = $1 AND u.is_active = TRUE`,
      [loginId]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
    }

    const user = userRes.rows[0];
    const valid = bcrypt.compareSync(password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ success: false, error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' });
    }

    const orgMode = orgModes.get(user.org_id) || user.org_mode || 'du';

    const token = signToken({
      id: user.id,
      org_id: user.org_id,
      name: user.name,
      role: user.role,
      hats: user.hats || [],
      orgMode,
    });

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          name: user.name,
          role: user.role,
          hats: user.hats || [],
          orgId: user.org_id,
          orgMode,
          source: 'legacy',
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /oas-status
 * 
 * Returns OAS configuration status (for debugging)
 */
router.get('/oas-status', (_req, res) => {
  res.json({
    success: true,
    data: getOASConfigStatus(),
  });
});

/**
 * POST /logout
 * 
 * Logout endpoint (no-op for JWT, but provides consistent API)
 */
router.post('/logout', (_req, res) => {
  res.json({
    success: true,
    data: { message: 'Logged out successfully' },
  });
});

export default router;
