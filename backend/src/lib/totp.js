// Authenticator-app codes (TOTP, RFC 6238 / RFC 4226) using only node:crypto — works with Google Authenticator,
// Microsoft Authenticator, Authy, 1Password, etc. 6 digits, 30-second steps, SHA-1 (what every app supports).
import { createHmac, randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const STEP_SECONDS = 30;

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(str) {
  let bits = 0, value = 0; const out = [];
  for (const ch of String(str).replace(/[\s=-]/g, '').toUpperCase()) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('bad base32');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const generateSecret = () => base32Encode(randomBytes(20)); // 160 bits

export function hotp(secretB32, counter, digits = 6) {
  const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', base32Decode(secretB32)).update(c).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, '0');
}
export const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / STEP_SECONDS);
export const totpAt = (secretB32, ms = Date.now()) => hotp(secretB32, stepAt(ms));

/** Returns the matching time-step number (accepts ±1 step for clock drift) or null. Callers store the step to stop code re-use. */
export function verifyTotp(secretB32, code, { ms = Date.now(), window = 1, lastStep = 0 } = {}) {
  if (!/^\d{6}$/.test(String(code))) return null;
  const now = stepAt(ms);
  for (let d = -window; d <= window; d++) {
    const step = now + d;
    if (step <= lastStep) continue; // already used (or older than a used code)
    if (hotp(secretB32, step) === code) return step;
  }
  return null;
}

export const otpauthUri = ({ secret, account, issuer = 'Upahars' }) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;
