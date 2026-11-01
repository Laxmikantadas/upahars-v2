import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { client, login, newPhone, ORIGIN, resetDb, startApp, stopDb } from './helpers.js';
import { OtpChallenge, OtpThrottle, User } from '../src/models/index.js';

let ctx;
beforeAll(async () => { ctx = await startApp(); });
afterAll(stopDb);
beforeEach(resetDb);

describe('phone OTP login', () => {
  it('signs in, sets an HttpOnly session cookie, and exposes /me', async () => {
    const phone = newPhone(); const a = client(ctx.app);
    const r1 = await a.post('/api/auth/otp/request').send({ phone });
    expect(r1.status).toBe(200); expect(r1.body.devCode).toMatch(/^\d{6}$/);
    const r2 = await a.post('/api/auth/otp/verify').send({ phone, code: r1.body.devCode, name: 'Asha' });
    expect(r2.status).toBe(200); expect(r2.body.user).toMatchObject({ phone, name: 'Asha', roles: ['customer'] });
    const cookie = r2.headers['set-cookie'].find((c) => c.startsWith('upahars_session='));
    expect(cookie).toMatch(/HttpOnly/i); expect(cookie).toMatch(/SameSite=Lax/i);
    expect((await a.get('/api/me')).body.user.phone).toBe(phone);
  });
  it('never stores the code in plain text', async () => {
    const phone = newPhone(); const r = await client(ctx.app).post('/api/auth/otp/request').send({ phone });
    const ch = await OtpChallenge.findOne({ phone }); expect(ch.codeHash).not.toContain(r.body.devCode); expect(ch.codeHash).toHaveLength(64);
  });
  it('is single use, and rejects wrong codes', async () => {
    const phone = newPhone(); const a = client(ctx.app);
    const { body } = await a.post('/api/auth/otp/request').send({ phone });
    const wrong = body.devCode === '111111' ? '222222' : '111111';
    expect((await a.post('/api/auth/otp/verify').send({ phone, code: wrong })).body.error.code).toBe('otp_wrong');
    expect((await a.post('/api/auth/otp/verify').send({ phone, code: body.devCode })).status).toBe(200);
    expect((await a.post('/api/auth/otp/verify').send({ phone, code: body.devCode })).status).toBe(400); // already used
  });
  it('locks the code after 5 wrong attempts, even if the right code is then supplied', async () => {
    const phone = newPhone(); const a = client(ctx.app);
    const { body } = await a.post('/api/auth/otp/request').send({ phone });
    const wrong = body.devCode === '111111' ? '222222' : '111111';
    for (let i = 0; i < 5; i++) await a.post('/api/auth/otp/verify').send({ phone, code: wrong });
    const r = await a.post('/api/auth/otp/verify').send({ phone, code: body.devCode });
    expect(r.status).toBe(400); expect(r.body.error.code).toBe('otp_locked');
  });
  it('expires after 15 minutes (and is then deleted by MongoDB)', async () => {
    const phone = newPhone(); const a = client(ctx.app);
    const { body } = await a.post('/api/auth/otp/request').send({ phone });
    await OtpChallenge.updateOne({ phone }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await a.post('/api/auth/otp/verify').send({ phone, code: body.devCode })).body.error.code).toBe('otp_expired');
  });
  it('a code is valid for 15 minutes, and the limits still apply after it has been deleted', async () => {
    const phone = newPhone(); const a = client(ctx.app); const t0 = Date.now();
    await a.post('/api/auth/otp/request').send({ phone });
    const ch = await OtpChallenge.findOne({ phone });
    expect(ch.expiresAt.getTime() - t0).toBeGreaterThan(14.9 * 60_000); expect(ch.expiresAt.getTime() - t0).toBeLessThan(15.1 * 60_000);
    await OtpChallenge.deleteOne({ phone }); // what MongoDB's TTL cleanup does after 15 minutes
    expect((await a.post('/api/auth/otp/request').send({ phone })).body.error.code).toBe('otp_too_soon');
  });
  it('a registered user signs in again with number + a fresh code after the old one expired', async () => {
    const phone = newPhone(); await login(ctx.app, phone, 'Asha');
    await OtpChallenge.deleteMany({ phone }); await OtpThrottle.deleteMany({ phone });
    const a = client(ctx.app); const { body } = await a.post('/api/auth/otp/request').send({ phone });
    const r = await a.post('/api/auth/otp/verify').send({ phone, code: body.devCode });
    expect(r.status).toBe(200); expect(r.body.user.name).toBe('Asha'); expect(await User.countDocuments({ phone })).toBe(1);
  });
  it('throttles resends (30s gap, 5 per hour)', async () => {
    const phone = newPhone(); const a = client(ctx.app);
    expect((await a.post('/api/auth/otp/request').send({ phone })).status).toBe(200);
    expect((await a.post('/api/auth/otp/request').send({ phone })).body.error.code).toBe('otp_too_soon');
    await OtpThrottle.updateOne({ phone }, { $set: { lastSentAt: new Date(Date.now() - 60000), sendCount: 5, windowStart: new Date() } });
    expect((await a.post('/api/auth/otp/request').send({ phone })).body.error.code).toBe('otp_limit');
  });
  it('validates the phone number and rejects unexpected fields', async () => {
    const a = client(ctx.app);
    expect((await a.post('/api/auth/otp/request').send({ phone: '12345' })).status).toBe(400);
    expect((await a.post('/api/auth/otp/request').send({ phone: newPhone(), isAdmin: true })).status).toBe(400);
  });
  it('does not return the code when OTP_DEV_ECHO is off', async () => {
    const other = await startApp({ OTP_DEV_ECHO: 'false' });
    const r = await client(other.app).post('/api/auth/otp/request').send({ phone: newPhone() });
    expect(r.status).toBe(200); expect(r.body.devCode).toBeUndefined();
  });
  it('a customer can never gain a role by sending one', async () => {
    const a = await login(ctx.app);
    expect((await a.patch('/api/me').send({ roles: ['admin'] })).status).toBe(400);
    expect((await a.get('/api/me')).body.user.roles).toEqual(['customer']);
  });
  it('suspended users cannot sign in, and an existing session stops working immediately', async () => {
    const a = await login(ctx.app);
    await User.updateOne({ phone: a.phone }, { $set: { isSuspended: true } });
    expect((await a.get('/api/me')).status).toBe(401);
    const b = client(ctx.app); const { body } = await b.post('/api/auth/otp/request').send({ phone: a.phone });
    expect((await b.post('/api/auth/otp/verify').send({ phone: a.phone, code: body.devCode })).status).toBe(403);
  });
  it('rejects a forged session cookie', async () => {
    const r = await request(ctx.app).get('/api/me').set('Cookie', 'upahars_session=forged.token.value');
    expect(r.status).toBe(401);
  });
});

describe('CSRF / origin guard', () => {
  it('blocks state-changing requests from other origins', async () => {
    const a = await login(ctx.app);
    const r = await a.patch('/api/me').set('Origin', 'https://evil.example').send({ name: 'Hacked' });
    expect(r.status).toBe(403);
    expect((await a.get('/api/me')).body.user.name).toBe('Test User');
  });
  it('blocks cookie-bearing writes that carry no Origin at all', async () => {
    const a = await login(ctx.app);
    const r = await request(ctx.app).patch('/api/me').set('Cookie', a.sessionCookie).send({ name: 'x' });
    expect(r.status).toBe(403);
    const ok = await request(ctx.app).get('/api/me').set('Cookie', a.sessionCookie); // reads are fine
    expect(ok.status).toBe(200);
  });
  it('allows the configured origin', async () => {
    const a = await login(ctx.app);
    expect((await a.patch('/api/me').set('Origin', ORIGIN).send({ name: 'Renamed' })).status).toBe(200);
  });
});

describe('misc', () => {
  it('unknown API routes return JSON 404 and errors never leak stack traces', async () => {
    const r = await client(ctx.app).get('/api/nope'); expect(r.status).toBe(404); expect(r.body.error.code).toBe('not_found');
    const bad = await client(ctx.app).post('/api/auth/otp/request').set('Content-Type', 'application/json').send('{bad json');
    expect(bad.status).toBe(400); expect(JSON.stringify(bad.body)).not.toMatch(/at .*\.js/);
  });
});
