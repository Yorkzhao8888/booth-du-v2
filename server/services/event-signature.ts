/**
 * [BOOTH-R7-DEF-3] XBUS 事件签名验签 (HMAC-SHA256)
 * - 规格: 发布方对原始 body 计算 HMAC-SHA256, 头 X-Event-Signature: sha256=<hex>
 * - 密钥: OAS_EVENT_SIGNING_KEY (OAS EventBus 下发); 未配置时兼容期放行 (signing=disabled)
 * - 验签失败: 事件进 DLQ 并告警, 不静默消费 (internal.ts verifySignature)
 */
import { createHmac, timingSafeEqual } from 'crypto';

export const EVENT_SIGNING_KEY = process.env.OAS_EVENT_SIGNING_KEY || '';

export function isSigningEnforced(): boolean {
  return EVENT_SIGNING_KEY.length > 0;
}

export function signEventPayload(rawBody: string): string {
  return 'sha256=' + createHmac('sha256', EVENT_SIGNING_KEY).update(rawBody).digest('hex');
}

export function verifyEventSignature(rawBody: string, signature: string | undefined): { ok: boolean; reason?: string } {
  if (!isSigningEnforced()) {
    return { ok: true, reason: 'signing-disabled' };
  }
  if (!signature || !signature.startsWith('sha256=')) {
    return { ok: false, reason: 'missing_signature' };
  }
  const expected = Buffer.from(signEventPayload(rawBody), 'utf8');
  const provided = Buffer.from(signature, 'utf8');
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { ok: false, reason: 'signature_mismatch' };
  }
  return { ok: true };
}
