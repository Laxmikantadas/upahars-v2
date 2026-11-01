import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const hmacHex = (secret, data) => createHmac('sha256', secret).update(data).digest('hex');
export const hmacB64url = (secret, data) => createHmac('sha256', secret).update(data).digest('base64url');
export const randomToken = (bytes = 24) => randomBytes(bytes).toString('base64url');
export const randomInt32 = () => randomInt(0, 2 ** 31);
export const randomOtp = () => String(randomInt(100000, 1000000));

/** Constant-time string comparison (safe for signatures). */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  if (x.length !== y.length) { timingSafeEqual(x, x); return false; }
  return timingSafeEqual(x, y);
}

/** AES-256-GCM for small secrets at rest (payout details). Format: v1.iv.tag.data (base64url) */
export function encryptJson(key, obj) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}
export function decryptJson(key, token) {
  const [v, iv, tag, data] = String(token).split('.');
  if (v !== 'v1') throw new Error('bad ciphertext');
  const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8'));
}
