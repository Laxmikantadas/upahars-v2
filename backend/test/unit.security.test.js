import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { decryptJson, encryptJson, hmacHex, safeEqual } from '../src/lib/crypto.js';
import { parseOwnedImage, signUpload } from '../src/lib/cloudinary.js';
import { createMockProvider, createRazorpayProvider } from '../src/lib/payments.js';
import { readAttribution, signAttribution } from '../src/services/attribution.js';

const SECRET = 'attribution-secret';
describe('attribution cookie', () => {
  const now = Date.now(); const payload = { s: 'seller1', t: 'touch1', at: now, l: '/store/x' };
  it('round-trips inside the window', () => expect(readAttribution(SECRET, signAttribution(SECRET, payload), { now, windowDays: 14 })).toMatchObject({ s: 'seller1' }));
  it('rejects a tampered seller id', () => {
    const [body, sig] = signAttribution(SECRET, payload).split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, s: 'attacker' })).toString('base64url');
    expect(readAttribution(SECRET, `${forged}.${sig}`, { now, windowDays: 14 })).toBeNull();
    expect(readAttribution(SECRET, `${body}.AAAA`, { now, windowDays: 14 })).toBeNull();
  });
  it('rejects a cookie signed with another secret, garbage, and cookies outside the window', () => {
    expect(readAttribution(SECRET, signAttribution('other', payload), { now, windowDays: 14 })).toBeNull();
    expect(readAttribution(SECRET, 'nonsense', { now, windowDays: 14 })).toBeNull();
    expect(readAttribution(SECRET, signAttribution(SECRET, payload), { now: now + 15 * 86400000, windowDays: 14 })).toBeNull();
    expect(readAttribution(SECRET, signAttribution(SECRET, payload), { now: now + 13 * 86400000, windowDays: 14 })).not.toBeNull();
  });
  it('rejects cookies from the future', () => expect(readAttribution(SECRET, signAttribution(SECRET, { ...payload, at: now + 3600000 }), { now, windowDays: 14 })).toBeNull());
});

describe('cloudinary', () => {
  const cfg = { cloudName: 'demo', apiKey: 'k', apiSecret: 'secret' };
  it('signs exactly per the documented algorithm and never leaks the secret', () => {
    const s = signUpload(cfg, { folder: 'upahars/sellers/abc', timestamp: 1700000000 });
    const expected = createHash('sha1').update('allowed_formats=jpg,jpeg,png,webp&folder=upahars/sellers/abc&timestamp=1700000000secret').digest('hex');
    expect(s.signature).toBe(expected); expect(JSON.stringify(s)).not.toContain('secret');
  });
  it('returns null when Cloudinary is not configured', () => expect(signUpload({}, { folder: 'x' })).toBeNull());
  it('accepts only our cloud and the allowed folder', () => {
    const ok = (u, f = 'upahars/sellers/abc') => parseOwnedImage(cfg, u, f);
    expect(ok('https://res.cloudinary.com/demo/image/upload/v1/upahars/sellers/abc/pic.jpg')).toMatchObject({ publicId: 'upahars/sellers/abc/pic' });
    expect(ok('https://res.cloudinary.com/other/image/upload/v1/upahars/sellers/abc/pic.jpg')).toBeNull();     // someone else's cloud
    expect(ok('https://res.cloudinary.com/demo/image/upload/v1/upahars/sellers/zzz/pic.jpg')).toBeNull();      // another seller's folder
    expect(ok('https://res.cloudinary.com/demo/image/upload/v1/upahars/sellers/abc/../zzz/p.jpg')).toBeNull();
    expect(ok('https://evil.com/demo/image/upload/v1/upahars/sellers/abc/pic.jpg')).toBeNull();
    expect(ok('http://res.cloudinary.com/demo/image/upload/v1/upahars/sellers/abc/pic.jpg')).toBeNull();
    expect(ok('https://res.cloudinary.com/demo/image/upload/v1/upahars/sellers/abc/pic.jpg?x=1')).toBeNull();
    expect(ok('javascript:alert(1)')).toBeNull();
  });
});

describe('payments', () => {
  const rz = createRazorpayProvider({ RAZORPAY_KEY_ID: 'rzp_test_x', RAZORPAY_KEY_SECRET: 'sec', RAZORPAY_WEBHOOK_SECRET: 'whsec' });
  it('verifies the Razorpay checkout signature (HMAC of order_id|payment_id)', () => {
    const sig = hmacHex('sec', 'order_1|pay_1');
    expect(rz.verifySignature({ providerOrderId: 'order_1', paymentId: 'pay_1', signature: sig })).toBe(true);
    expect(rz.verifySignature({ providerOrderId: 'order_1', paymentId: 'pay_2', signature: sig })).toBe(false);
    expect(rz.verifySignature({ providerOrderId: 'order_2', paymentId: 'pay_1', signature: sig })).toBe(false);
    expect(rz.verifySignature({ providerOrderId: 'order_1', paymentId: 'pay_1', signature: '' })).toBe(false);
  });
  it('verifies webhooks over the RAW body with the webhook secret', () => {
    const raw = '{"event":"payment.captured"}';
    expect(rz.verifyWebhook(raw, hmacHex('whsec', raw))).toBe(true);
    expect(rz.verifyWebhook(raw + ' ', hmacHex('whsec', raw))).toBe(false);
    expect(rz.verifyWebhook(raw, hmacHex('sec', raw))).toBe(false); // key secret ≠ webhook secret
  });
  it('talks to Razorpay with basic auth and surfaces failures', async () => {
    const calls = [];
    const p = createRazorpayProvider({ RAZORPAY_KEY_ID: 'id', RAZORPAY_KEY_SECRET: 's' }, async (url, init) => { calls.push([url, init]); return { ok: true, json: async () => ({ id: 'order_9' }) }; });
    expect((await p.createOrder({ amountPaise: 500, receipt: 'r' })).providerOrderId).toBe('order_9');
    expect(calls[0][0]).toBe('https://api.razorpay.com/v1/orders'); expect(calls[0][1].headers.Authorization).toBe('Basic ' + Buffer.from('id:s').toString('base64'));
    const bad = createRazorpayProvider({ RAZORPAY_KEY_ID: 'id', RAZORPAY_KEY_SECRET: 's' }, async () => ({ ok: false, status: 400, json: async () => ({ error: { description: 'nope' } }) }));
    await expect(bad.refund({ paymentId: 'p', amountPaise: 1 })).rejects.toThrow(/nope/);
  });
  it('the mock provider refuses to exist in production', () => expect(() => createMockProvider({ NODE_ENV: 'production' })).toThrow(/production/));
});

describe('crypto helpers', () => {
  it('safeEqual', () => { expect(safeEqual('abc', 'abc')).toBe(true); expect(safeEqual('abc', 'abd')).toBe(false); expect(safeEqual('abc', 'ab')).toBe(false); expect(safeEqual(undefined, 'a')).toBe(false); });
  it('payout details are encrypted at rest and tamper-evident', () => {
    const key = Buffer.alloc(32, 9); const t = encryptJson(key, { upiId: 'a@b' });
    expect(t).not.toContain('a@b'); expect(decryptJson(key, t)).toEqual({ upiId: 'a@b' });
    expect(() => decryptJson(key, t.slice(0, -3) + 'AAA')).toThrow();
    expect(() => decryptJson(Buffer.alloc(32, 1), t)).toThrow();
  });
});

describe('production config guard', () => {
  const ok = { NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), PAYMENT_PROVIDER: 'razorpay', RAZORPAY_KEY_ID: 'a', RAZORPAY_KEY_SECRET: 'b', RAZORPAY_WEBHOOK_SECRET: 'c', OTP_PROVIDER: 'msg91', MSG91_WIDGET_ID: 'w', MSG91_WIDGET_TOKEN: 't', MSG91_AUTH_KEY: 'k', ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'), CLIENT_ORIGINS: 'https://upahars.in' };
  it('accepts a safe production config', () => expect(loadConfig(ok).isProd).toBe(true));
  it.each([
    [{ PAYMENT_PROVIDER: 'mock' }, /mock/], [{ OTP_DEV_ECHO: 'true' }, /OTP_DEV_ECHO/], [{ OTP_PROVIDER: 'console' }, /console/],
    [{ ENCRYPTION_KEY: undefined }, /ENCRYPTION_KEY/], [{ CLIENT_ORIGINS: 'http://upahars.in' }, /https/], [{ RAZORPAY_WEBHOOK_SECRET: undefined }, /webhook/i],
  ])('rejects %j', (patch, rx) => expect(() => loadConfig({ ...ok, ...patch })).toThrow(rx));
  it('rejects a short JWT secret', () => expect(() => loadConfig({ ...ok, JWT_SECRET: 'short' })).toThrow());
});
