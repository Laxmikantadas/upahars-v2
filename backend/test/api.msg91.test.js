import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { client, newPhone, resetDb, startApp, stopDb } from './helpers.js';
import { OtpChallenge, User } from '../src/models/index.js';

// Stand-in for MSG91: the right code for a request is "4321"; it records which phone each request id was sent to.
const sent = new Map();
const fakeMsg91 = {
  name: 'msg91', managed: true,
  async sendOtp(phone) { const reqId = `req-${phone}-${sent.size}`; sent.set(reqId, phone); return { reqId }; },
  async verifyOtp(phone, reqId, code) { return sent.get(reqId) === phone && code === '4321'; },
};
let ctx;
beforeAll(async () => { ctx = await startApp({}, { sms: fakeMsg91 }); });
afterAll(stopDb);
beforeEach(async () => { await resetDb(); sent.clear(); });

describe('MSG91 phone login', () => {
  it('request -> verify signs in as the number the code was sent to', async () => {
    const phone = newPhone(); const a = client(ctx.app);
    const r1 = await a.post('/api/auth/otp/request').send({ phone });
    expect(r1.status).toBe(200); expect(r1.body.devCode).toBeUndefined(); // MSG91 holds the code
    expect((await OtpChallenge.findOne({ phone })).reqId).toMatch(/^req-/);
    const r2 = await a.post('/api/auth/otp/verify').send({ phone, code: '4321', name: 'Asha' });
    expect(r2.status).toBe(200); expect(r2.body.user.phone).toBe(phone);
    expect(await User.countDocuments({ phone })).toBe(1);
  });
  it('a wrong code is refused and counted; the code cannot be used for a different number', async () => {
    const mine = newPhone(), victim = newPhone(); const a = client(ctx.app);
    await a.post('/api/auth/otp/request').send({ phone: mine });
    await a.post('/api/auth/otp/request').send({ phone: victim });
    expect((await a.post('/api/auth/otp/verify').send({ phone: victim, code: '1111' })).body.error.code).toBe('otp_wrong');
    expect((await OtpChallenge.findOne({ phone: victim })).attempts).toBe(1);
    expect((await a.post('/api/auth/otp/verify').send({ phone: newPhone(), code: '4321' })).body.error.code).toBe('otp_expired'); // no code was ever sent to that number
  });
  it('shows MSG91 trouble as a clear error, and does not use up a send', async () => {
    const broken = await startApp({}, { sms: { ...fakeMsg91, async sendOtp() { throw new Error('Invalid Captcha Token'); } } });
    const phone = newPhone(); const r = await client(broken.app).post('/api/auth/otp/request').send({ phone });
    expect(r.status).toBe(502); expect(r.body.error.code).toBe('sms_failed');
    expect(await OtpChallenge.countDocuments({ phone })).toBe(0);
  });
});
