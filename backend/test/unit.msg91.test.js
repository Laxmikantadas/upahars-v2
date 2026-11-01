import { describe, expect, it } from 'vitest';
import { createMsg91Provider } from '../src/lib/sms.js';

const cfg = { MSG91_WIDGET_ID: 'w1', MSG91_WIDGET_TOKEN: 't1', MSG91_AUTH_KEY: 'a1' };
const jwt = (payload) => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`;
const fake = (replies) => { const calls = []; const f = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), headers: init.headers }); const r = replies.shift(); return { ok: r.status !== 500, status: r.status ?? 200, json: async () => r.json }; }; return { f, calls }; };

describe('MSG91 provider (server-side widget API)', () => {
  it('refuses placeholder or missing credentials', () => {
    expect(() => createMsg91Provider({ MSG91_WIDGET_ID: 'your_widget_id', MSG91_WIDGET_TOKEN: 't', MSG91_AUTH_KEY: 'a' })).toThrow(/MSG91_WIDGET_ID/);
    expect(() => createMsg91Provider({ MSG91_WIDGET_ID: 'w', MSG91_WIDGET_TOKEN: 't' })).toThrow(/MSG91_AUTH_KEY/);
  });
  it('sends to the +91 number and returns the request id', async () => {
    const { f, calls } = fake([{ json: { type: 'success', message: 'req-1' } }]);
    expect(await createMsg91Provider(cfg, f).sendOtp('9876543210')).toEqual({ reqId: 'req-1' });
    expect(calls[0].url).toMatch(/widget\/sendOtp$/); expect(calls[0].body).toEqual({ widgetId: 'w1', tokenAuth: 't1', identifier: '919876543210' });
  });
  it('a correct code: verifies, then confirms the token with the auth key', async () => {
    const tok = jwt({ requestId: 'req-1', companyId: 'c' });
    const { f, calls } = fake([{ json: { type: 'success', message: tok } }, { json: { type: 'success', message: 'verified' } }]);
    expect(await createMsg91Provider(cfg, f).verifyOtp('9876543210', 'req-1', '123456')).toBe(true);
    expect(calls[0].body).toEqual({ widgetId: 'w1', tokenAuth: 't1', reqId: 'req-1', otp: '123456' });
    expect(calls[1].body).toEqual({ authkey: 'a1', 'access-token': tok });
  });
  it('rejects a token that belongs to a different request (cannot be borrowed from another number)', async () => {
    const { f } = fake([{ json: { type: 'success', message: jwt({ requestId: 'OTHER' }) } }]);
    expect(await createMsg91Provider(cfg, f).verifyOtp('9876543210', 'req-1', '123456')).toBe(false);
  });
  it('a wrong code is false; a setup problem (captcha, auth, token) throws so it is never shown as "wrong code"', async () => {
    expect(await createMsg91Provider(cfg, fake([{ json: { type: 'error', message: 'otp not match' } }]).f).verifyOtp('9', 'r', '000000')).toBe(false);
    await expect(createMsg91Provider(cfg, fake([{ json: { type: 'error', message: 'Invalid Captcha Token' } }]).f).sendOtp('9876543210')).rejects.toThrow(/Captcha/);
    await expect(createMsg91Provider(cfg, fake([{ json: { type: 'error', message: 'AuthenticationFailure' } }]).f).verifyOtp('9', 'r', '123456')).rejects.toThrow(/AuthenticationFailure/);
    await expect(createMsg91Provider(cfg, async () => { throw new Error('x'); }).sendOtp('9876543210')).rejects.toThrow(/network/);
  });
});

import { createMsg91Sender, createSmsProvider } from '../src/lib/sms.js';
describe('MSG91 as SMS carrier (our backend owns the code)', () => {
  it('is chosen when a template id is set, and needs only the auth key + template', () => {
    expect(createSmsProvider({ OTP_PROVIDER: 'msg91', MSG91_AUTH_KEY: 'a1', MSG91_TEMPLATE_ID: 'tpl' }).managed).toBeUndefined();
    expect(() => createMsg91Sender({ authkey: '', templateId: 'tpl' })).toThrow(/MSG91_AUTH_KEY/);
  });
  it('sends OUR code to the +91 number through the OTP API, auth key in the header', async () => {
    const { f, calls } = fake([{ json: { type: 'success', message: 'id' } }]);
    await createMsg91Sender({ authkey: 'a1', templateId: 'tpl' }, f).send('9876543210', 'ignored', '482913');
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe('/api/v5/otp');
    expect([u.searchParams.get('template_id'), u.searchParams.get('mobile'), u.searchParams.get('otp')]).toEqual(['tpl', '919876543210', '482913']);
    expect(calls[0].headers.authkey).toBe('a1');
    expect(calls[0].url).not.toContain('a1&'); // key is not placed in the URL
  });
  it('surfaces MSG91 errors (bad template, no balance...) instead of pretending the SMS went out', async () => {
    await expect(createMsg91Sender({ authkey: 'a', templateId: 't' }, fake([{ json: { type: 'error', message: 'Template not found' } }]).f).send('9876543210', '', '123456')).rejects.toThrow(/Template not found/);
  });
});
