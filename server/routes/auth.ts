import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { signToken } from '../auth.js';
import { orgModes } from '../migrate.js';

const router = Router();

router.post('/login', async (req, res, next) => {
  try {
    const { phone, password } = req.body;

    if (!phone || !password) {
      return res.status(400).json({ success: false, error: 'Phone and password are required', code: 'MISSING_FIELDS' });
    }

    const userRes = await pool.query(
      `SELECT u.*, o.mode as org_mode
       FROM booth_users u
       JOIN booth_orgs o ON o.id = u.org_id
       WHERE u.phone = $1 AND u.is_active = TRUE`,
      [phone]
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
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
