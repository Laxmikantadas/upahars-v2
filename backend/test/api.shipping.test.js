import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADDRESS, client, login, loginAdmin, makeProduct, resetDb, seedTaxonomy, startApp, stopDb } from './helpers.js';
import { ShippingToken } from '../src/models/index.js';

// A fake Shipex: tests decide what it answers and can see what it was asked.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const makeJwt = (expSec) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ user: { id: 'x' }, exp: expSec })}.sig`;
const reply = (status, body) => ({ status, ok: status < 300, json: async () => body });
const shipex = { serviceable: true, calls: [], loginStatus: 200, ttlSec: 86400 };
const fetchImpl = async (url, init) => {
  const body = init.body ? JSON.parse(init.body) : undefined;
  shipex.calls.push({ url, method: init.method, auth: init.headers.Authorization, body });
  if (url.endsWith('/generateToken')) {
    return shipex.loginStatus === 200
      ? reply(200, { success: true, message: 'Token generated successfully', data: { token: makeJwt(Math.floor(Date.now() / 1000) + shipex.ttlSec) } })
      : reply(401, { success: false, message: 'Invalid email or password' });
  }
  return reply(200, { status: 'success', message: 'Rate calculation successful.', data: [
    { courierServiceName: 'Delhivery Surface', courierId: '02', forward: { charges: 558, gst: 100.44, finalCharges: 658 }, serviceable: shipex.serviceable },
    { courierServiceName: 'Ekart Surface', courierId: '08', forward: { charges: 511.5, gst: 92.07, finalCharges: 604 }, serviceable: shipex.serviceable },
  ] });
};

let ctx, admin;
beforeAll(async () => { ctx = await startApp({}, { fetchImpl }); });
afterAll(stopDb);
beforeEach(async () => {
  await resetDb(); await seedTaxonomy(); admin = await loginAdmin(ctx.app);
  Object.assign(shipex, { serviceable: true, calls: [], loginStatus: 200, ttlSec: 86400 });
});

const generate = (a = admin) => a.post('/api/admin/shipping/token').send({ email: 'ops@upahars.in', password: 'Secret#123' });
const item = (p, qty = 1) => ({ productId: String(p._id), qty });

describe('admin: courier token', () => {
  it('starts empty, then stores a token with its expiry and never shows the token', async () => {
    expect((await admin.get('/api/admin/shipping/token')).body.token).toMatchObject({ configured: false, state: 'none' });
    const g = await generate();
    expect(g.status).toBe(201);
    expect(g.body.token).toMatchObject({ configured: true, state: 'active', email: 'ops@upahars.in' });
    expect(g.body.token.secondsLeft).toBeGreaterThan(86000);
    expect(JSON.stringify(g.body)).not.toMatch(/eyJ|Secret#123|tokenEnc/);
    const row = await ShippingToken.findOne({ provider: 'shipex' }).lean();
    expect(row.tokenEnc.startsWith('v1.')).toBe(true);       // encrypted at rest
    expect(JSON.stringify(row)).not.toContain('Secret#123'); // password never stored
  });
  it('reports "expiring" near the end and "expired" after it', async () => {
    shipex.ttlSec = 3600; await generate();
    expect((await admin.get('/api/admin/shipping/token')).body.token.state).toBe('expiring'); // inside the 2 h warning window
    await ShippingToken.updateOne({ provider: 'shipex' }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await admin.get('/api/admin/shipping/token')).body.token.state).toBe('expired');
  });
  it('wrong Shipex password is a clear 400 and nothing is saved', async () => {
    shipex.loginStatus = 401;
    const g = await generate();
    expect(g.status).toBe(400); expect(g.body.error.code).toBe('shipex_bad_credentials');
    expect(await ShippingToken.countDocuments()).toBe(0);
  });
  it('can be removed again; only administrators may touch it', async () => {
    await generate();
    expect((await admin.delete('/api/admin/shipping/token')).body.token.state).toBe('none');
    const customer = await login(ctx.app);
    expect((await customer.get('/api/admin/shipping/token')).status).toBe(403);
    expect((await generate(customer)).status).toBe(403);
    expect((await client(ctx.app).get('/api/admin/shipping/token')).status).toBe(401);
  });
});

describe('products carry a pickup pincode', () => {
  it('is saved on create and edit, validated, and never shown to customers', async () => {
    const base = { title: 'Brass Lamp', category: 'home-decor', pricePaise: 99900, stock: 3, status: 'published', shipping: { weightGrams: 700, lengthCm: 20, widthCm: 15, heightCm: 12 } };
    expect((await admin.post('/api/admin/products').send({ ...base, pickupPincode: '75100' })).status).toBe(400);
    const c = await admin.post('/api/admin/products').send({ ...base, pickupPincode: '751007' });
    expect(c.status).toBe(201); expect(c.body.product.pickupPincode).toBe('751007'); expect(c.body.product.shipping.heightCm).toBe(12);
    const u = await admin.patch(`/api/admin/products/${c.body.product.id}`).send({ pickupPincode: '400001' });
    expect(u.body.product.pickupPincode).toBe('400001');
    const pub = await client(ctx.app).get(`/api/products/${c.body.product.slug}`);
    expect(JSON.stringify(pub.body)).not.toMatch(/400001|pickupPincode/);
  });
});

describe('serviceability', () => {
  it('asks Shipex with data from OUR database (pickup pincode, weight, size, value) and the stored token', async () => {
    await generate();
    const p = await makeProduct({ pricePaise: 25000, extra: { pickupPincode: '751007', shipping: { weightGrams: 600, lengthCm: 20, widthCm: 15, heightCm: 10 } } });
    const r = await client(ctx.app).post('/api/shipping/serviceability').send({ deliveryPincode: '110011', items: [item(p, 2)] });
    expect(r.status).toBe(200); expect(r.body.serviceable).toBe(true);
    const call = shipex.calls.find((c) => c.url.endsWith('/pincodeServiceability'));
    expect(call.auth).toMatch(/^Bearer eyJ/);
    expect(call.method).toBe('POST');
    expect(call.body).toEqual({ pickUpPincode: '751007', deliveryPincode: '110011', applicableWeight: 1.2, length: 20, width: 15, height: 20, paymentType: 'Prepaid', declaredValue: 500 });
  });
  it('the browser cannot choose the pickup pincode or weight', async () => {
    const p = await makeProduct({ extra: { pickupPincode: '751007' } });
    for (const bad of [{ pickUpPincode: '110011' }, { applicableWeight: 0.1 }, { paymentType: 'COD' }])
      expect((await client(ctx.app).post('/api/shipping/serviceability').send({ deliveryPincode: '110011', items: [item(p)], ...bad })).status).toBe(400);
  });
  it('says "not serviceable", and tells the customer when the courier cannot be asked', async () => {
    const p = await makeProduct({ extra: { pickupPincode: '751007' } });
    const ask = () => client(ctx.app).post('/api/shipping/serviceability').send({ deliveryPincode: '799999', items: [item(p)] });
    expect((await ask()).body.error.code).toBe('shipex_not_configured'); // no token yet
    await generate(); shipex.serviceable = false;
    expect((await ask()).body.serviceable).toBe(false);
    await ShippingToken.updateOne({ provider: 'shipex' }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await ask()).body.error.code).toBe('shipex_token_expired');
  });
  it('product without a pickup pincode gives a clear 422', async () => {
    await generate();
    const p = await makeProduct();
    const r = await client(ctx.app).post('/api/shipping/serviceability').send({ deliveryPincode: '110011', items: [item(p)] });
    expect(r.status).toBe(422); expect(r.body.error.code).toBe('no_pickup_pincode');
  });
});

describe('checkout', () => {
  const order = (a, p) => a.post('/api/orders/checkout').send({ items: [item(p)], address: ADDRESS });
  it('refuses an order to a pincode the courier cannot reach', async () => {
    await generate(); shipex.serviceable = false;
    const p = await makeProduct({ extra: { pickupPincode: '751007' } }); const a = await login(ctx.app);
    const r = await order(a, p);
    expect(r.status).toBe(400); expect(r.body.error.code).toBe('pincode_not_serviceable');
  });
  it('accepts it when serviceable', async () => {
    await generate();
    const p = await makeProduct({ extra: { pickupPincode: '751007' } }); const a = await login(ctx.app);
    expect((await order(a, p)).status).toBe(201);
  });
  it('never blocks a sale just because the courier token is missing or expired', async () => {
    const p = await makeProduct({ extra: { pickupPincode: '751007' } }); const a = await login(ctx.app);
    expect((await order(a, p)).status).toBe(201); // no token at all
  });
});
