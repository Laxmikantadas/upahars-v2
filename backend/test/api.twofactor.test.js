import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { client, login, loginAdmin, newPhone, resetDb, startApp, stopDb } from './helpers.js';
import { User } from '../src/models/index.js';
import { totpAt } from '../src/lib/totp.js';

let ctx;
beforeAll(async () => { ctx = await startApp(); });
afterAll(stopDb);
beforeEach(resetDb);

/** Turns two-factor on for a signed-in agent and returns { secret, backupCodes }. */
async function enable2fa(a) {
  const s = await a.post('/api/auth/2fa/setup').send({});
  expect(s.status).toBe(200);
  const e = await a.post('/api/auth/2fa/enable').send({ code: totpAt(s.body.secret) });
  expect(e.status).toBe(200);
  return { secret: s.body.secret, backupCodes: e.body.backupCodes, view: e.body.user };
}
/** First sign-in step only (phone code). */
async function phoneStep(phone) {
  const a = client(ctx.app);
  const r1 = await a.post('/api/auth/otp/request').send({ phone });
  const r2 = await a.post('/api/auth/otp/verify').send({ phone, code: r1.body.devCode });
  return { a, r2 };
}
const nextStepCode = (secret) => totpAt(secret, Date.now() + 30_000); // a fresh step so tests never collide with the enable step

describe('two-factor setup', () => {
  it('needs a signed-in user', async () => { expect((await client(ctx.app).post('/api/auth/2fa/setup').send({})).status).toBe(401); });
  it('returns a secret + otpauth link, and turns on only after a correct code; backup codes are shown once and stored hashed', async () => {
    const a = await login(ctx.app);
    const s = await a.post('/api/auth/2fa/setup').send({});
    expect(s.body.secret).toMatch(/^[A-Z2-7]{32}$/); expect(s.body.otpauthUri).toContain('otpauth://totp/');
    expect((await a.post('/api/auth/2fa/enable').send({ code: '000000' })).body.error.code).toBe('two_factor_wrong');
    expect((await a.get('/api/me')).body.user.twoFactorEnabled).toBe(false);
    const e = await a.post('/api/auth/2fa/enable').send({ code: totpAt(s.body.secret) });
    expect(e.status).toBe(200); expect(e.body.backupCodes).toHaveLength(10); expect(e.body.user.twoFactorEnabled).toBe(true);
    const u = await User.findOne({ phone: a.phone });
    expect(JSON.stringify(u.twoFactor)).not.toContain(s.body.secret);        // secret encrypted
    expect(JSON.stringify(u.twoFactor)).not.toContain(e.body.backupCodes[0]); // codes hashed
    expect((await a.post('/api/auth/2fa/setup').send({})).status).toBe(409);
  });
  it('cannot enable without starting setup', async () => {
    const a = await login(ctx.app);
    expect((await a.post('/api/auth/2fa/enable').send({ code: '123456' })).body.error.code).toBe('two_factor_not_started');
  });
});

describe('sign-in with two-factor', () => {
  it('phone code alone gives NO session; the app code completes it', async () => {
    const a = await login(ctx.app); const { secret } = await enable2fa(a);
    const { a: b, r2 } = await phoneStep(a.phone);
    expect(r2.body.twoFactorRequired).toBe(true); expect(r2.body.user).toBeUndefined(); expect(r2.headers['set-cookie']).toBeUndefined();
    expect((await b.get('/api/me')).status).toBe(401);
    const ok = await b.post('/api/auth/2fa/login').send({ challenge: r2.body.challenge, code: nextStepCode(secret) });
    expect(ok.status).toBe(200); expect(ok.body.user.phone).toBe(a.phone);
    expect((await b.get('/api/me')).status).toBe(200);
  });
  it('rejects a wrong code, a reused code, and a forged or expired challenge', async () => {
    const a = await login(ctx.app); const { secret } = await enable2fa(a);
    const { a: b, r2 } = await phoneStep(a.phone);
    expect((await b.post('/api/auth/2fa/login').send({ challenge: r2.body.challenge, code: '000000' })).body.error.code).toBe('two_factor_wrong');
    const code = nextStepCode(secret);
    expect((await b.post('/api/auth/2fa/login').send({ challenge: r2.body.challenge, code })).status).toBe(200);
    expect((await b.post('/api/auth/2fa/login').send({ challenge: r2.body.challenge, code })).body.error.code).toBe('two_factor_wrong'); // replay
    expect((await b.post('/api/auth/2fa/login').send({ challenge: 'x'.repeat(40), code })).body.error.code).toBe('challenge_expired');
  });
  it('the challenge token can never be used as a session cookie', async () => {
    const a = await login(ctx.app); await enable2fa(a);
    const { r2 } = await phoneStep(a.phone);
    const r = await request(ctx.app).get('/api/me').set('Cookie', `upahars_session=${r2.body.challenge}`);
    expect(r.status).toBe(401);
  });
  it('locks after 5 wrong codes', async () => {
    const a = await login(ctx.app); const { secret } = await enable2fa(a);
    const { a: b, r2 } = await phoneStep(a.phone);
    for (let i = 0; i < 5; i++) await b.post('/api/auth/2fa/login').send({ challenge: r2.body.challenge, code: '000000' });
    const r = await b.post('/api/auth/2fa/login').send({ challenge: r2.body.challenge, code: nextStepCode(secret) });
    expect(r.status).toBe(429); expect(r.body.error.code).toBe('two_factor_locked');
  });
  it('a backup code works once', async () => {
    const a = await login(ctx.app); const { backupCodes } = await enable2fa(a);
    const one = await phoneStep(a.phone);
    expect((await one.a.post('/api/auth/2fa/login').send({ challenge: one.r2.body.challenge, code: backupCodes[0].toUpperCase() })).status).toBe(200);
    const again = await phoneStep(a.phone);
    expect((await again.a.post('/api/auth/2fa/login').send({ challenge: again.r2.body.challenge, code: backupCodes[0] })).body.error.code).toBe('two_factor_wrong');
    expect((await again.a.post('/api/auth/2fa/login').send({ challenge: again.r2.body.challenge, code: backupCodes[1] })).status).toBe(200);
  });
  it('a suspended user cannot finish sign-in', async () => {
    const a = await login(ctx.app); const { secret } = await enable2fa(a);
    const { a: b, r2 } = await phoneStep(a.phone);
    await User.updateOne({ phone: a.phone }, { $set: { isSuspended: true } });
    expect((await b.post('/api/auth/2fa/login').send({ challenge: r2.body.challenge, code: nextStepCode(secret) })).status).toBe(403);
  });
});

describe('manage two-factor', () => {
  it('disable needs a valid code; regenerate replaces the backup codes', async () => {
    const a = await login(ctx.app); const { secret, backupCodes } = await enable2fa(a);
    expect((await a.post('/api/auth/2fa/disable').send({ code: '000000' })).status).toBe(400);
    const regen = await a.post('/api/auth/2fa/backup-codes').send({ code: nextStepCode(secret) });
    expect(regen.body.backupCodes).toHaveLength(10); expect(regen.body.backupCodes).not.toContain(backupCodes[0]);
    const off = await a.post('/api/auth/2fa/disable').send({ code: regen.body.backupCodes[0] });
    expect(off.status).toBe(200); expect(off.body.user.twoFactorEnabled).toBe(false);
    const { r2 } = await phoneStep(a.phone);
    expect(r2.body.twoFactorRequired).toBeUndefined(); expect(r2.body.user.phone).toBe(a.phone); // back to phone-code-only sign-in
  });
});

describe('administrators', () => {
  it('cannot use the admin API until two-factor is on, then can; cannot turn it off', async () => {
    const strict = await startApp({ REQUIRE_ADMIN_2FA: 'true' });
    const phone = newPhone(); await User.create({ phone, name: 'Boss', roles: ['customer', 'admin'] });
    const a = client(strict.app);
    const r1 = await a.post('/api/auth/otp/request').send({ phone });
    const r2 = await a.post('/api/auth/otp/verify').send({ phone, code: r1.body.devCode });
    expect(r2.body.user.twoFactorSetupRequired).toBe(true);
    const blocked = await a.get('/api/admin/dashboard'); expect(blocked.status).toBe(403); expect(blocked.body.error.code).toBe('two_factor_setup_required');
    const s = await a.post('/api/auth/2fa/setup').send({});
    const e = await a.post('/api/auth/2fa/enable').send({ code: totpAt(s.body.secret) }); expect(e.body.user.twoFactorSetupRequired).toBe(false);
    expect((await a.get('/api/admin/dashboard')).status).not.toBe(403);
    expect((await a.post('/api/auth/2fa/disable').send({ code: nextStepCode(s.body.secret) })).status).toBe(403);
  });
  it('is not enforced when REQUIRE_ADMIN_2FA=false (tests / local)', async () => {
    const admin = await loginAdmin(ctx.app);
    expect(admin.user.twoFactorSetupRequired).toBe(false);
  });
});
