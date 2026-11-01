import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { client, newPhone, resetDb, startApp, stopDb } from './helpers.js';
import { User } from '../src/models/index.js';

const ADMIN_PHONE = '8018811056';
let ctx;
beforeAll(async () => { ctx = await startApp(); });
afterAll(stopDb);
beforeEach(resetDb);

describe('separate admin login (/api/auth/admin/otp/*)', () => {
  it('lets the allow-listed admin number sign in, creating the admin account on first use', async () => {
    const a = client(ctx.app);
    const r1 = await a.post('/api/auth/admin/otp/request').send({ phone: ADMIN_PHONE });
    expect(r1.status).toBe(200); expect(r1.body.devCode).toMatch(/^\d{6}$/);
    const r2 = await a.post('/api/auth/admin/otp/verify').send({ phone: ADMIN_PHONE, code: r1.body.devCode });
    expect(r2.status).toBe(200);
    expect(r2.body.user).toMatchObject({ phone: ADMIN_PHONE });
    expect(r2.body.user.roles).toEqual(expect.arrayContaining(['customer', 'admin']));
    expect((await a.get('/api/admin/orders')).status).toBe(200); // the session really works for the admin API
  });

  it('promotes an existing customer account that uses an admin number', async () => {
    await User.create({ phone: ADMIN_PHONE, name: 'Owner' });
    const a = client(ctx.app);
    const { body } = await a.post('/api/auth/admin/otp/request').send({ phone: ADMIN_PHONE });
    const r = await a.post('/api/auth/admin/otp/verify').send({ phone: ADMIN_PHONE, code: body.devCode });
    expect(r.body.user.roles).toContain('admin'); expect(r.body.user.name).toBe('Owner');
  });

  it('gives no code and creates no account for any other number, with the same answer as for admins', async () => {
    const phone = newPhone(); const a = client(ctx.app);
    const r = await a.post('/api/auth/admin/otp/request').send({ phone });
    expect(r.status).toBe(200); expect(r.body.devCode).toBeUndefined();
    const v = await a.post('/api/auth/admin/otp/verify').send({ phone, code: '123456' });
    expect(v.status).toBe(400); expect(await User.findOne({ phone })).toBeNull();
  });

  it('does not let a normal customer use a code from the customer login on the admin endpoint', async () => {
    const phone = newPhone(); const a = client(ctx.app);
    const { body } = await a.post('/api/auth/otp/request').send({ phone });
    expect((await a.post('/api/auth/admin/otp/verify').send({ phone, code: body.devCode })).status).toBe(400);
  });

  it('also makes the admin number an administrator when it signs in from the normal /account login', async () => {
    const a = client(ctx.app);
    const { body } = await a.post('/api/auth/otp/request').send({ phone: ADMIN_PHONE });
    const r = await a.post('/api/auth/otp/verify').send({ phone: ADMIN_PHONE, code: body.devCode });
    expect(r.body.user.roles).toContain('admin');
  });

  it('reads extra admin numbers from ADMIN_PHONES', async () => {
    const other = await startApp({ ADMIN_PHONES: '8018811056, 9876500000' });
    expect(other.config.adminPhones).toEqual(['8018811056', '9876500000']);
  });
});
