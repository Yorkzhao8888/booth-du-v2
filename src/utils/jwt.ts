/**
 * JWT 解码工具函数
 * 支持 base64url 编码（JWT 标准），处理 -/_ 字符和 padding
 */

/**
 * 安全解码 base64url 字符串
 */
function base64UrlDecode(str: string): string {
  // 将 base64url 转换为标准 base64
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  // 补充 padding
  const pad = base64.length % 4;
  if (pad === 2) base64 += '==';
  else if (pad === 3) base64 += '=';
  // 使用 atob 解码
  return atob(base64);
}

/**
 * 解码 JWT token 的 payload 部分
 * @param token JWT token 字符串
 * @returns 解码后的 payload 对象，解析失败返回 null
 */
export function decodeJwt<T = any>(token: string | null | undefined): T | null {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const decoded = base64UrlDecode(payload);
    // 使用 TextDecoder 处理 UTF-8
    const bytes = Uint8Array.from(decoded, c => c.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * 从 localStorage 获取当前用户角色
 * 优先从 booth_user 读取，失败则从 token 解码
 */
export function getCurrentRole(): string | null {
  // 优先从 store 的 localStorage 读取
  try {
    const raw = localStorage.getItem('booth_user');
    if (raw) {
      const user = JSON.parse(raw);
      if (user?.role) return user.role;
    }
  } catch {
    // ignore
  }
  // 降级：从 token 解码
  const token = localStorage.getItem('booth_token');
  const payload = decodeJwt<{ role?: string }>(token);
  return payload?.role || null;
}
