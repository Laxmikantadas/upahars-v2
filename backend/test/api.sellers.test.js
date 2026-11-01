import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { client, imageUrl, loginAdmin, login, makeApprovedSeller, resetDb, seedTaxonomy, startApp, stopDb, CLOUD } from './helpers.js';
import { Inventory, Product, Seller, User } from '../src/models/index.js';

let ctx, admin;
beforeAll(async () => { ctx = await startApp(); });
afterAll(stopDb);
beforeEach(async () => { await resetDb(); await seedTaxonomy(); admin = await loginAdmin(ctx.app); });

const productBody = (sellerId, over = {}) => ({
  title: 'Rose Petal Candle', description: 'Hand poured', category: 'candles', occasions: ['birthday'], tags: ['rose'], productType: 'candle', pricePaise: 34900,
  images: [{ url: imageUrl(`upahars/sellers/${sellerId}`) }], stock: 12, ...over,
});

describe('seller application & approval', () => {
  it('lets a signed-in user apply; nothing is live until an administrator approves', async () => {
    const a = await login(ctx.app);
    const r = await a.post('/api/seller/apply').send({ businessName: 'Rose Craft', ownerName: 'Rita Das', businessType: 'individual', city: 'Cuttack', state: 'Odisha', storeName: 'RoseCraft', pan: 'ABCDE1234F' });
    expect(r.status).toBe(201); expect(r.body.seller.status).toBe('pending'); expect(r.body.seller.store.slug).toBe('rosecraft');
    expect(r.body.seller.application.pan).toBe('••••••234F'.replace('234F', '234F')); // masked, never returned in full
    expect(JSON.stringify(r.body)).not.toContain('ABCDE1234F');
    expect((await client(ctx.app).get('/api/stores/rosecraft')).status).toBe(404);          // not public
    expect((await a.post('/api/seller/products').send(productBody('x'))).status).toBe(403);  // cannot sell yet
    const s = await Seller.findOne({ 'store.slug': 'rosecraft' }); expect(s.application.panEnc).not.toContain('ABCDE1234F'); // encrypted at rest
  });
  it('requires authentication, rejects reserved/duplicate store links and applying twice', async () => {
    expect((await client(ctx.app).post('/api/seller/apply').send({})).status).toBe(401);
    const a = await login(ctx.app); const body = { businessName: 'B', ownerName: 'Owner', businessType: 'individual', city: 'Pune', state: 'MH', storeName: 'Shop' };
    expect((await a.post('/api/seller/apply').send({ ...body, businessName: 'Biz', slug: 'admin' })).status).toBe(400);
    expect((await a.post('/api/seller/apply').send({ ...body, businessName: 'Biz', slug: 'shop-one' })).status).toBe(201);
    expect((await a.post('/api/seller/apply').send({ ...body, businessName: 'Biz', slug: 'shop-two' })).body.error.code).toBe('already_applied');
    const b = await login(ctx.app);
    expect((await b.post('/api/seller/apply').send({ ...body, businessName: 'Biz2', slug: 'shop-one' })).body.error.code).toBe('slug_taken');
  });
  it('only administrators can approve, reject or suspend', async () => {
    const a = await login(ctx.app); const r = await a.post('/api/seller/apply').send({ businessName: 'Biz', ownerName: 'Owner', businessType: 'individual', city: 'Pune', state: 'MH', storeName: 'Shop' });
    const other = await login(ctx.app);
    for (const who of [a, other, client(ctx.app)]) expect([401, 403]).toContain((await who.post(`/api/admin/sellers/${r.body.seller.id}/approve`).send({})).status);
    expect((await admin.post(`/api/admin/sellers/${r.body.seller.id}/approve`).send({})).status).toBe(200);
    expect((await a.get('/api/me')).body.user.roles).toContain('seller');
  });
  it('"verified" appears only after an administrator verifies, and disappears on suspension', async () => {
    const { seller } = await makeApprovedSeller(ctx.app, admin, 'verifyme');
    const pub = () => client(ctx.app).get('/api/stores/verifyme');
    expect((await pub()).body.store.verified).toBe(false);
    expect((await admin.post(`/api/admin/sellers/${seller._id}/verify`).send({ note: 'GST checked' })).status).toBe(200);
    expect((await pub()).body.store.verified).toBe(true);
    await admin.post(`/api/admin/sellers/${seller._id}/suspend`).send({ reason: 'policy breach' });
    expect((await pub()).status).toBe(404);
    await admin.post(`/api/admin/sellers/${seller._id}/reinstate`).send({});
    expect((await pub()).body.store.verified).toBe(false); // verification did not survive suspension
  });
  it('records every sensitive action in the audit log', async () => {
    const { seller } = await makeApprovedSeller(ctx.app, admin, 'audited');
    await admin.patch(`/api/admin/sellers/${seller._id}/commission`).send({ linkBps: 300, reason: 'negotiated' });
    const log = await admin.get('/api/admin/audit?entity=seller');
    const actions = log.body.entries.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['seller.approve', 'seller.commission']));
    expect(log.body.entries.find((e) => e.action === 'seller.commission').details).toMatchObject({ after: { linkBps: 300 }, reason: 'negotiated' });
  });
});

describe('seller products', () => {
  it('create → submit → admin approval → public listing with a seller badge', async () => {
    const { agent, seller } = await makeApprovedSeller(ctx.app, admin, 'rosecraft');
    const c = await agent.post('/api/seller/products').send(productBody(seller._id));
    expect(c.status).toBe(201); expect(c.body.product.status).toBe('draft'); expect(c.body.product.stocks).toEqual([{ variantId: null, stock: 12 }]);
    expect((await client(ctx.app).get(`/api/products/${c.body.product.slug}`)).status).toBe(404); // drafts are private
    expect((await agent.post(`/api/seller/products/${c.body.product.id}/submit`).send({})).body.product.status).toBe('pending_review');
    expect((await client(ctx.app).get(`/api/products/${c.body.product.slug}`)).status).toBe(404); // still not public
    expect((await agent.post(`/api/admin/products/${c.body.product.id}/approve`).send({})).status).toBe(403);
    expect((await admin.post(`/api/admin/products/${c.body.product.id}/approve`).send({})).status).toBe(200);
    const pub = await client(ctx.app).get(`/api/products/${c.body.product.slug}`);
    expect(pub.status).toBe(200); expect(pub.body.product.soldBy).toMatchObject({ type: 'seller', slug: 'rosecraft', verified: false }); expect(pub.body.product.inStock).toBe(true);
    const text = JSON.stringify(pub.body); expect(text).not.toMatch(/commission|sellerId|moderation|panEnc|payout/i); // (ids inside image folder paths are fine: access control never relies on hidden ids)
  });
  it('sellers cannot set ownership, status, slug or commission — the server rejects those fields', async () => {
    const { agent, seller } = await makeApprovedSeller(ctx.app, admin, 'strict');
    for (const extra of [{ sellerId: '507f1f77bcf86cd799439011' }, { status: 'published' }, { commissionOverrideBps: 0 }, { ownerType: 'upahars' }, { slug: 'mine' }, { soldCount: 999 }]) {
      const r = await agent.post('/api/seller/products').send({ ...productBody(seller._id), ...extra });
      expect(r.status, JSON.stringify(extra)).toBe(400);
    }
  });
  it('only accepts images uploaded to the seller\'s own Cloudinary folder', async () => {
    const { agent, seller } = await makeApprovedSeller(ctx.app, admin, 'imgs');
    const bad = [
      'https://evil.example/a.jpg', `https://res.cloudinary.com/${CLOUD}/image/upload/v1/upahars/sellers/507f1f77bcf86cd799439011/a.jpg`,
      `https://res.cloudinary.com/othercloud/image/upload/v1/upahars/sellers/${seller._id}/a.jpg`, 'javascript:alert(1)',
    ];
    for (const url of bad) expect((await agent.post('/api/seller/products').send(productBody(seller._id, { images: [{ url }] }))).status, url).toBe(400);
  });
  it('validates prices, variants and taxonomy', async () => {
    const { agent, seller } = await makeApprovedSeller(ctx.app, admin, 'valid');
    const post = (o) => agent.post('/api/seller/products').send(productBody(seller._id, o));
    expect((await post({ pricePaise: 5 })).status).toBe(400);
    expect((await post({ pricePaise: 1.5 })).status).toBe(400);
    expect((await post({ pricePaise: -100 })).status).toBe(400);
    expect((await post({ compareAtPaise: 100 })).status).toBe(400);
    expect((await post({ category: 'nonexistent' })).body.error.code).toBe('bad_category');
    expect((await post({ occasions: ['made-up'] })).body.error.code).toBe('bad_occasion');
    expect((await post({ stock: -1 })).status).toBe(400);
    const v = await post({ pricePaise: undefined, variants: [{ name: 'Small', pricePaise: 20000, stock: 5 }, { name: 'Large', pricePaise: 35000, stock: 0 }] });
    expect(v.status).toBe(201); expect(v.body.product.pricePaise).toBe(20000); // listing price = cheapest option
    expect(v.body.product.stocks.map((s) => s.stock).sort()).toEqual([0, 5]);
  });
  it('editing the content of a live product sends it back to review; price and stock do not', async () => {
    const { agent, seller } = await makeApprovedSeller(ctx.app, admin, 'edits');
    const c = (await agent.post('/api/seller/products').send(productBody(seller._id))).body.product;
    await agent.post(`/api/seller/products/${c.id}/submit`).send({}); await admin.post(`/api/admin/products/${c.id}/approve`).send({});
    expect((await agent.patch(`/api/seller/products/${c.id}`).send({ pricePaise: 39900 })).body.product.status).toBe('published');
    expect((await agent.put(`/api/seller/products/${c.id}/inventory`).send({ stocks: [{ stock: 3 }] })).body.product.stocks[0].stock).toBe(3);
    expect((await agent.patch(`/api/seller/products/${c.id}`).send({ title: 'Totally different title' })).body.product.status).toBe('pending_review');
  });
  it('can pause and resume; paused and archived products leave the catalogue', async () => {
    const { agent, seller } = await makeApprovedSeller(ctx.app, admin, 'pauser');
    const c = (await agent.post('/api/seller/products').send(productBody(seller._id))).body.product;
    await agent.post(`/api/seller/products/${c.id}/submit`).send({}); await admin.post(`/api/admin/products/${c.id}/approve`).send({});
    const visible = async () => (await client(ctx.app).get(`/api/products/${c.slug}`)).status;
    expect(await visible()).toBe(200);
    await agent.post(`/api/seller/products/${c.id}/pause`).send({}); expect(await visible()).toBe(404);
    await agent.post(`/api/seller/products/${c.id}/resume`).send({}); expect(await visible()).toBe(200);
    await agent.delete(`/api/seller/products/${c.id}`); expect(await visible()).toBe(404);
    expect(await Product.findById(c.id)).not.toBeNull(); // archived, not deleted
  });
  it('pausing the store or suspending the seller hides every product at once', async () => {
    const { agent, seller } = await makeApprovedSeller(ctx.app, admin, 'hide');
    const c = (await agent.post('/api/seller/products').send(productBody(seller._id))).body.product;
    await agent.post(`/api/seller/products/${c.id}/submit`).send({}); await admin.post(`/api/admin/products/${c.id}/approve`).send({});
    const visible = async () => (await client(ctx.app).get(`/api/products/${c.slug}`)).status;
    await agent.patch('/api/seller/store').send({ isPaused: true }); expect(await visible()).toBe(404);
    expect((await client(ctx.app).get('/api/products?seller=hide')).body.total).toBe(0);
    await agent.patch('/api/seller/store').send({ isPaused: false }); expect(await visible()).toBe(200);
    await admin.post(`/api/admin/sellers/${seller._id}/suspend`).send({ reason: 'investigation' }); expect(await visible()).toBe(404);
    expect((await agent.post('/api/seller/products').send(productBody(seller._id))).status).toBe(403);
  });
});

describe('seller isolation', () => {
  it('seller B cannot read, edit, restock, submit, pause or delete seller A\'s products', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha'); const B = await makeApprovedSeller(ctx.app, admin, 'beta');
    const p = (await A.agent.post('/api/seller/products').send(productBody(A.seller._id))).body.product;
    const checks = [
      B.agent.get(`/api/seller/products/${p.id}`), B.agent.patch(`/api/seller/products/${p.id}`).send({ pricePaise: 100 }),
      B.agent.put(`/api/seller/products/${p.id}/inventory`).send({ stocks: [{ stock: 0 }] }), B.agent.post(`/api/seller/products/${p.id}/submit`).send({}),
      B.agent.post(`/api/seller/products/${p.id}/pause`).send({}), B.agent.delete(`/api/seller/products/${p.id}`),
    ];
    for (const r of await Promise.all(checks)) expect(r.status).toBe(404);
    const list = await B.agent.get('/api/seller/products'); expect(list.body.products).toHaveLength(0);
    const fresh = await Product.findById(p.id); expect(fresh.pricePaise).toBe(34900); expect(fresh.status).toBe('draft');
    expect((await Inventory.findOne({ productId: p.id })).stock).toBe(12);
  });
  it('B cannot upload into A\'s folder or point a product at it', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha2'); const B = await makeApprovedSeller(ctx.app, admin, 'beta2');
    const sig = await B.agent.post('/api/uploads/sign').send({ scope: 'seller' });
    expect(sig.body.upload.folder).toBe(`upahars/sellers/${B.seller._id}`); expect(JSON.stringify(sig.body)).not.toContain('cloud-secret');
    expect((await B.agent.post('/api/seller/products').send(productBody(B.seller._id, { images: [{ url: imageUrl(`upahars/sellers/${A.seller._id}`) }] }))).status).toBe(400);
    expect((await B.agent.post('/api/uploads/sign').send({ scope: 'originals' })).status).toBe(403);
  });
  it('admin-only product tools are closed to sellers and customers', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha3'); const cust = await login(ctx.app);
    const p = (await A.agent.post('/api/seller/products').send(productBody(A.seller._id))).body.product;
    for (const who of [A.agent, cust]) {
      expect((await who.patch(`/api/admin/products/${p.id}/commission`).send({ commissionOverrideBps: 0, reason: 'please' })).status).toBe(403);
      expect((await who.get('/api/admin/sellers')).status).toBe(403);
      expect((await who.put('/api/admin/settings').send({ commission: { linkBps: 0 } })).status).toBe(403);
      expect((await who.get('/api/admin/audit')).status).toBe(403);
    }
    expect((await client(ctx.app).get('/api/admin/sellers')).status).toBe(401);
  });
  it('only Upahars Originals can be edited by an administrator; seller listings can only be approved/rejected', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha4');
    const p = (await A.agent.post('/api/seller/products').send(productBody(A.seller._id))).body.product;
    expect((await admin.patch(`/api/admin/products/${p.id}`).send({ title: 'Admin edit' })).status).toBe(403);
    const orig = await admin.post('/api/admin/products').send({ title: 'Designer Soy Candle', category: 'candles', pricePaise: 59900, stock: 20, status: 'published' });
    expect(orig.status).toBe(201);
    const pub = await client(ctx.app).get(`/api/products/${orig.body.product.slug}`);
    expect(pub.body.product.soldBy).toEqual({ type: 'upahars', label: 'Upahars Originals' });
    expect((await admin.patch(`/api/admin/products/${orig.body.product.id}`).send({ pricePaise: 54900 })).status).toBe(200);
  });
});

describe('catalogue', () => {
  it('filters by category, occasion, seller, owner, price and text; sorts; paginates', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'filt');
    const mk = async (title, price, over = {}) => { const r = await A.agent.post('/api/seller/products').send(productBody(A.seller._id, { title, pricePaise: price, ...over })); await A.agent.post(`/api/seller/products/${r.body.product.id}/submit`).send({}); await admin.post(`/api/admin/products/${r.body.product.id}/approve`).send({}); };
    await mk('Alpha Candle', 20000); await mk('Beta Lamp', 90000, { category: 'home-decor', occasions: ['diwali'], tags: ['lamp'] });
    await admin.post('/api/admin/products').send({ title: 'Original Hamper', category: 'candles', pricePaise: 50000, stock: 5, status: 'published' });
    const get = (q) => client(ctx.app).get('/api/products' + q);
    expect((await get('')).body.total).toBe(3);
    expect((await get('?category=home-decor')).body.products.map((p) => p.title)).toEqual(['Beta Lamp']);
    expect((await get('?occasion=diwali')).body.total).toBe(1);
    expect((await get('?owner=upahars')).body.products[0].title).toBe('Original Hamper');
    expect((await get('?seller=filt')).body.total).toBe(2);
    expect((await get('?minPaise=30000&maxPaise=60000')).body.total).toBe(1);
    expect((await get('?q=lamp')).body.total).toBe(1);
    expect((await get('?q=' + encodeURIComponent('.*'))).body.total).toBe(0);               // regex input is escaped
    expect((await get('?sort=price_desc')).body.products[0].title).toBe('Beta Lamp');
    expect((await get('?limit=2&page=2')).body.products).toHaveLength(1);
    expect((await get('?limit=500')).status).toBe(400);
  });
  it('lists only approved, active stores', async () => {
    await makeApprovedSeller(ctx.app, admin, 'visible-store');
    const a = await login(ctx.app); await a.post('/api/seller/apply').send({ businessName: 'Pend', ownerName: 'Owner', businessType: 'individual', city: 'Pune', state: 'MH', storeName: 'Pending Shop' });
    const r = await client(ctx.app).get('/api/stores'); expect(r.body.stores.map((s) => s.slug)).toEqual(['visible-store']);
    expect(JSON.stringify(r.body)).not.toMatch(/panEnc|payout|commission/i);
  });
  it('commission overrides are admin-only and bounded', async () => {
    const { seller } = await makeApprovedSeller(ctx.app, admin, 'bounded');
    expect((await admin.patch(`/api/admin/sellers/${seller._id}/commission`).send({ linkBps: 6000, reason: 'too high' })).status).toBe(400);
    expect((await admin.patch(`/api/admin/sellers/${seller._id}/commission`).send({ linkBps: -1, reason: 'negative' })).status).toBe(400);
    expect((await admin.patch(`/api/admin/sellers/${seller._id}/commission`).send({ linkBps: 250, reason: 'negotiated deal' })).status).toBe(200);
    const me = await (await login(ctx.app)).get('/api/seller/me'); expect(me.status).toBe(404);
    void User;
  });
});
