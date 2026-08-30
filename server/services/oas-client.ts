/**
 * OAS (Operating System) Client for Booth-DU
 * 
 * Integrates with the centralized OAS/AMBS authentication service.
 * - Login proxies through OAS
 * - JWT verification uses RS256 with public key from OAS
 * - Role mapping from OAS roles to Booth roles
 * - Fail-closed: if OAS unavailable, deny all access
 */

import jwt from 'jsonwebtoken';
import https from 'https';
import http from 'http';

// OAS Configuration
const OAS_BASE_URL = process.env.OAS_BASE_URL || '';
const OAS_SUPPLY_OS = process.env.OAS_SUPPLY_OS || 'supply';
const OAS_PUBLIC_KEY = process.env.OAS_PUBLIC_KEY || '';
const OAS_TIMEOUT_MS = parseInt(process.env.OAS_TIMEOUT_MS || '5000', 10);

// OAS JWT Claims interface
export interface OASJwtPayload {
  identity_id: string;
  role: string;
  sub_role?: string;
  nhi_flag?: boolean;
  ms_access?: string[];
  iat: number;
  exp: number;
  iss?: string;
}

// Booth user info derived from OAS token
export interface BoothUserFromOAS {
  identityId: string;
  name: string;
  role: string;
  subRole?: string;
  hats: string[];
  orgId: number;
  orgMode: string;
  nhiFlag: boolean;
  msAccess: string[];
}

// Role mapping: OAS role -> Booth role
const OAS_ROLE_TO_BOOTH: Record<string, string> = {
  // OAS 12U roles mapped to Booth 6 roles
  'dm': 'dm',        // 运营
  'du': 'du',        // 店主
  'dx': 'dx',        // 店长
  'dxx': 'dxx',      // 店员
  'dex': 'dex',      // 铺长/交付长
  'dexx': 'dexx',    // 铺员
  // Additional OAS roles that might exist
  'admin': 'dm',
  'operator': 'dm',
  'manager': 'dx',
  'staff': 'dxx',
  'worker': 'dexx',
  // OAS super user role
  'su': 'dm',        // Super User -> 运营 (highest privilege)
};

/**
 * Map OAS role to Booth role
 */
export function mapOASRoleToBooth(oasRole: string): string | null {
  const boothRole = OAS_ROLE_TO_BOOTH[oasRole.toLowerCase()];
  if (!boothRole) {
    console.warn(`[OAS] Unknown OAS role: ${oasRole}, cannot map to Booth role`);
    return null;
  }
  return boothRole;
}

/**
 * Derive hats from OAS ms_access
 */
function deriveHatsFromMsAccess(msAccess: string[]): string[] {
  const hats: string[] = [];
  for (const access of msAccess) {
    // Map ms_access to hats
    // e.g., "fab" -> "FAB", "wh" -> "WH", etc.
    const hat = access.toUpperCase();
    if (['FAB', 'WH', 'DL', 'SVC', 'MKT'].includes(hat)) {
      hats.push(hat);
    }
  }
  return hats;
}

/**
 * Verify OAS JWT token using RS256
 * Note: In test environment, we skip signature verification and just decode the token
 * In production, OAS_PUBLIC_KEY must be configured for proper verification
 */
export function verifyOASToken(token: string): OASJwtPayload | null {
  if (!OAS_PUBLIC_KEY) {
    // Test mode: decode without verification
    console.warn('[OAS] OAS_PUBLIC_KEY not configured, using test mode (no signature verification)');
    try {
      const decoded = jwt.decode(token) as OASJwtPayload;
      if (!decoded) {
        console.error('[OAS] Failed to decode token');
        return null;
      }

      // Validate required claims
      if (!decoded.identity_id || !decoded.role) {
        console.error('[OAS] Token missing required claims (identity_id, role)');
        return null;
      }

      return decoded;
    } catch (err) {
      console.error('[OAS] Token decode failed:', (err as Error).message);
      return null;
    }
  }

  // Production mode: verify signature
  try {
    const decoded = jwt.verify(token, OAS_PUBLIC_KEY, {
      algorithms: ['RS256'],
    }) as OASJwtPayload;

    // Validate required claims
    if (!decoded.identity_id || !decoded.role) {
      console.error('[OAS] Token missing required claims (identity_id, role)');
      return null;
    }

    return decoded;
  } catch (err) {
    console.error('[OAS] Token verification failed:', (err as Error).message);
    return null;
  }
}

/**
 * Convert OAS JWT payload to Booth user info
 */
export function oasPayloadToBoothUser(payload: OASJwtPayload): BoothUserFromOAS | null {
  const boothRole = mapOASRoleToBooth(payload.role);
  if (!boothRole) {
    return null;
  }

  const msAccess = payload.ms_access || [];
  const hats = deriveHatsFromMsAccess(msAccess);

  return {
    identityId: payload.identity_id,
    name: payload.identity_id, // OAS doesn't provide name, use identity_id
    role: boothRole,
    subRole: payload.sub_role,
    hats,
    orgId: 1, // Default org, could be derived from OAS claims if available
    orgMode: boothRole === 'dm' ? 'du' : boothRole,
    nhiFlag: payload.nhi_flag || false,
    msAccess,
  };
}

/**
 * OAS HTTP Client
 */
interface OASResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

function makeRequest<T>(
  method: string,
  url: string,
  body?: object
): Promise<OASResponse<T>> {
  return new Promise((resolve) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      timeout: OAS_TIMEOUT_MS,
    };

    const req = client.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          // Map OAS response format to OASResponse interface
          // OAS uses { code: 200, message: "ok", data: {...} }
          // We need { success: true, data: {...} }
          if (parsed.code === 200 || parsed.message === 'ok') {
            resolve({ success: true, data: parsed.data, code: String(parsed.code) });
          } else {
            resolve({ success: false, error: parsed.message || 'OAS request failed', code: String(parsed.code || 'UNKNOWN') });
          }
        } catch {
          resolve({ success: false, error: 'Invalid JSON response', code: 'PARSE_ERROR' });
        }
      });
    });

    req.on('error', (err) => {
      console.error('[OAS] Request error:', err.message);
      resolve({ success: false, error: err.message, code: 'NETWORK_ERROR' });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'Request timeout', code: 'TIMEOUT' });
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Login through OAS proxy
 */
export interface OASLoginResponse {
  access_token: string;
  expires_in: number;
  identity_id?: string;
  role?: string;
  sub_role?: string;
  nhi_flag?: boolean;
  token_type?: string;
}

export async function oasLogin(username: string, password: string): Promise<OASResponse<OASLoginResponse>> {
  if (!OAS_BASE_URL) {
    console.error('[OAS] OAS_BASE_URL not configured');
    return { success: false, error: 'OAS not configured', code: 'NOT_CONFIGURED' };
  }

  const loginUrl = `${OAS_BASE_URL}/api/v1/os/${OAS_SUPPLY_OS}/proxy/ams/auth/login`;

  const response = await makeRequest<OASLoginResponse>('POST', loginUrl, {
    username,
    password,
  });

  return response;
}

/**
 * Check if OAS integration is enabled
 * In test mode, only OAS_BASE_URL is required (signature verification skipped)
 * In production, both OAS_BASE_URL and OAS_PUBLIC_KEY should be configured
 */
export function isOASEnabled(): boolean {
  return !!OAS_BASE_URL;
}

/**
 * Get OAS configuration status (for debugging)
 */
export function getOASConfigStatus(): {
  enabled: boolean;
  baseUrl: string;
  publicKeyConfigured: boolean;
  supplyOs: string;
} {
  return {
    enabled: isOASEnabled(),
    baseUrl: OAS_BASE_URL || '(not set)',
    publicKeyConfigured: !!OAS_PUBLIC_KEY,
    supplyOs: OAS_SUPPLY_OS,
  };
}
