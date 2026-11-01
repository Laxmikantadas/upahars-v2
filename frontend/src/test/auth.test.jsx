import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import App from '../App';
import { api, ApiError } from '../lib/api';
import { isValidPhone, AuthProvider } from '../lib/auth';
import { StoreProvider } from '../lib/store';
const reply = (status, body) => vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
afterEach(() => vi.unstubAllGlobals());
describe('api client', () => {
    it('sends cookies and JSON to /api', async () => {
        const f = reply(200, { ok: true });
        vi.stubGlobal('fetch', f);
        await api('/auth/otp/request', { body: { phone: '9876543210' } });
        const [url, init] = f.mock.calls[0];
        expect(url).toBe('/api/auth/otp/request');
        expect(init).toMatchObject({ method: 'POST', credentials: 'include', body: JSON.stringify({ phone: '9876543210' }) });
    });
    it('turns the backend error format into an ApiError with its message and code', async () => {
        vi.stubGlobal('fetch', reply(400, { error: { code: 'otp_wrong', message: 'Wrong code. Please check and try again.' } }));
        await expect(api('/auth/otp/verify', { body: {} })).rejects.toMatchObject({ status: 400, code: 'otp_wrong', message: 'Wrong code. Please check and try again.' });
    });
    it('reports an unreachable server in plain words', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));
        const e = (await api('/me').catch((x) => x));
        expect(e).toBeInstanceOf(ApiError);
        expect(e.code).toBe('network');
    });
});
describe('phone validation', () => {
    it.each([['9876543210', true], ['6000000000', true], ['5876543210', false], ['98765', false], ['98765432101', false], ['abcdefghij', false]])('%s → %s', (p, ok) => {
        expect(isValidPhone(p)).toBe(ok);
    });
});
describe('two-factor calls', () => {
    it('sends the challenge + code to the 2FA login endpoint', async () => {
        const f = reply(200, { user: {} });
        vi.stubGlobal('fetch', f);
        await api('/auth/2fa/login', { body: { challenge: 'c'.repeat(30), code: '123456' } });
        expect(f.mock.calls[0][0]).toBe('/api/auth/2fa/login');
    });
    it('surfaces the server message for a wrong authenticator code', async () => {
        vi.stubGlobal('fetch', reply(400, { error: { code: 'two_factor_wrong', message: 'Wrong code. Please check and try again.' } }));
        await expect(api('/auth/2fa/login', { body: {} })).rejects.toMatchObject({ code: 'two_factor_wrong' });
    });
});
describe('sign-in screen', () => {
    const html = (initial) => renderToString(<StaticRouter location="/account"><AuthProvider initial={initial}><StoreProvider><App /></StoreProvider></AuthProvider></StaticRouter>);
    it('shows the phone form for visitors', () => { const h = html({ status: 'anonymous', user: null }); expect(h).toContain('Register / Sign in'); expect(h).toContain('Send code'); });
    it('does not flash the sign-in form while the session is being checked', () => { const h = html({ status: 'loading', user: null }); expect(h).toContain('Checking your session'); expect(h).not.toContain('Send code'); });
});
