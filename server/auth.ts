import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

const JWT_SECRET = process.env.JWT_SECRET || 'booth-dev-secret';

export interface JwtPayload {
  userId: number;
  orgId: number;
  name: string;
  role: string;
  hats: string[];
  orgMode: string;
}

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
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });
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

  if (!token) {
    return next({ statusCode: 401, code: 'UNAUTHORIZED', error: 'Missing or invalid token' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    // @ts-ignore
    req.user = decoded;
    next();
  } catch {
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
