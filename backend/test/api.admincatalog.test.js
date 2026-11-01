import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADDRESS, client, login, loginAdmin, makeApprovedSeller, makeProduct, resetDb, seedTaxonomy, startApp, stopDb } from './helpers.js';
import { Inventory, Product } from '../src/models/index.js';

let ctx, admin;
beforeAll(async () => { ctx = await startApp(); });
afterAll(stopDb);
beforeEach(async () => { await resetDb(); await seedTaxonomy(); admin = await loginAdmin(ctx.app); });

const newProduct = { title: 'Brass Lamp', category: 'home-decor', pricePaise: 99900, compareAtPaise: 129900, stock: 7, status: 'published' };

describe('admin controls every product', () => {
  it('creates, edits, restocks and deletes a product', async () => {
    const c = await admin.post('/api/admin/products').send(newProduct);
    expect(c.status).toBe(201);
    const id = c.body.product.id;
    expect((await client(ctx.app).get(`/api/products/${c.body.product.slug}`)).status).toBe(200);

    const u = await admin.patch(`/api/admin/products/${id}`).send({ title: 'Brass Lamp Large', pricePaise: 89900, compareAtPaise: null });
    expect(u.status).toBe(200);
    expect(u.body.product.pricePaise).toBe(89900);
    expect((await admin.put(`/api/admin/products/${id}/inventory`).send({ stocks: [{ stock: 0 }] })).status).toBe(200);
    expect((await admin.get(`/api/admin/products/${id}`)).body.product.stocks[0].stock).toBe(0);

    const d = await admin.delete(`/api/admin/products/${id}`);
    expect(d.status).toBe(200); expect(d.body.archived).toBe(false);
    expect(await Product.countDocuments()).toBe(0);
    expect(await Inventory.countDocuments()).toBe(0);
  });

  it('can edit and delete a seller listing too', async () => {
    const { seller } = await makeApprovedSeller(ctx.app, admin, 'artisan');
    const p = await makeProduct({ title: 'Seller Pot', seller });
    expect((await admin.patch(`/api/admin/products/${p._id}`).send({ title: 'Seller Pot v2', status: 'paused' })).status).toBe(200);
    expect((await Product.findById(p._id)).status).toBe('paused');
    expect((await admin.delete(`/api/admin/products/${p._id}`)).status).toBe(200);
    expect(await Product.exists({ _id: p._id })).toBeNull();
  });

  it('archives instead of deleting a product that has orders', async () => {
    const p = await makeProduct({ title: 'Ordered Candle' });
    const buyer = await login(ctx.app);
    const o = await buyer.post('/api/orders/checkout').set('Idempotency-Key', 'k-admincat-1').send({ items: [{ productId: String(p._id), qty: 1 }], address: ADDRESS });
    expect(o.status).toBe(201);
    const d = await admin.delete(`/api/admin/products/${p._id}`);
    expect(d.body.archived).toBe(true);
    expect((await Product.findById(p._id)).status).toBe('archived');
  });

  it('refuses non-admins', async () => {
    const u = await login(ctx.app);
    expect([401, 403]).toContain((await u.post('/api/admin/products').send(newProduct)).status);
    expect([401, 403]).toContain((await u.delete('/api/admin/coupons/aaaaaaaaaaaaaaaaaaaaaaaa')).status);
  });
});

describe('admin controls offers', () => {
  const body = { code: 'DIWALI10', type: 'percent', value: 10, minOrderPaise: 50000, title: 'Diwali 10% off', description: 'On orders above ₹500', isPublic: true };

  it('creates, edits, publishes on the storefront, and deletes a coupon', async () => {
    const c = await admin.post('/api/admin/coupons').send(body);
    expect(c.status).toBe(201);
    expect((await admin.post('/api/admin/coupons').send(body)).status).toBe(409);
    const offers = await client(ctx.app).get('/api/offers');
    expect(offers.body.offers.map((o) => o.code)).toEqual(['DIWALI10']);

    const u = await admin.patch(`/api/admin/coupons/${c.body.coupon._id}`).send({ type: 'fixed', value: 5000, isPublic: false });
    expect(u.status).toBe(200); expect(u.body.coupon.type).toBe('fixed');
    expect((await client(ctx.app).get('/api/offers')).body.offers).toEqual([]);

    expect((await admin.patch(`/api/admin/coupons/${c.body.coupon._id}`).send({ type: 'percent', value: 95 })).status).toBe(400);
    expect((await admin.delete(`/api/admin/coupons/${c.body.coupon._id}`)).status).toBe(200);
    expect((await admin.get('/api/admin/coupons')).body.coupons).toEqual([]);
  });

  it('hides expired and inactive offers from the storefront', async () => {
    await admin.post('/api/admin/coupons').send({ ...body, code: 'OLD', endsAt: new Date(Date.now() - 86400000).toISOString() });
    await admin.post('/api/admin/coupons').send({ ...body, code: 'OFF', isActive: false });
    expect((await client(ctx.app).get('/api/offers')).body.offers).toEqual([]);
  });
});
