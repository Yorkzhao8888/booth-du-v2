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
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next({ statusCode: 401, code: 'UNAUTHORIZED', error: 'Missing or invalid token' });
  }
  const token = authHeader.slice(7);
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
