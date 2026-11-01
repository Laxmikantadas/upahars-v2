import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ADDRESS, REAL_MONGO, client, login, loginAdmin, makeApprovedSeller, makeProduct, ORIGIN, resetDb, seedTaxonomy, startApp, stockOf, stopDb } from './helpers.js';
import { Coupon, Inventory, Ledger, Order, PaymentEvent, Touch } from '../src/models/index.js';
import { hmacHex } from '../src/lib/crypto.js';

let ctx, admin;
beforeAll(async () => { ctx = await startApp(); });
afterAll(stopDb);
beforeEach(async () => { await resetDb(); await seedTaxonomy(); admin = await loginAdmin(ctx.app); });

const item = (p, qty = 1, extra = {}) => ({ productId: String(p._id), qty, ...extra });
const checkout = (a, items, extra = {}, headers = {}) => { let r = a.post('/api/orders/checkout'); for (const [k, v] of Object.entries(headers)) r = r.set(k, v); return r.send({ items, address: ADDRESS, ...extra }); };
const pay = async (a, order) => (await a.post('/api/dev/payments/simulate').send({ orderNumber: order.orderNumber })).body.order;
const touch = (a, ref) => a.post('/api/attribution/touch').send({ ref, landingPath: `/store/${ref}` });

describe('quote and checkout — the server decides every price', () => {
  it('prices from the database, adds shipping per seller, and ignores nothing the client invents', async () => {
    const S = await makeApprovedSeller(ctx.app, admin, 'quoteshop'); const cand = await makeProduct({ seller: S.seller, pricePaise: 30000 }); const orig = await makeProduct({ title: 'Original', pricePaise: 20000 });
    const a = await login(ctx.app);
    const q = await a.post('/api/orders/quote').send({ items: [item(cand, 2), item(orig, 1)] });
    expect(q.status).toBe(200);
    expect(q.body.quote).toMatchObject({ subtotalPaise: 80000, shippingPaise: 13000, totalPaise: 93000, discountPaise: 0 }); // 600 + 200, ₹65 shipping per shipment (both below ₹699)
    expect(q.body.quote.shipments).toHaveLength(2);
    expect(JSON.stringify(q.body)).not.toMatch(/commission|sellerId/i);
  });
  it('rejects prices, totals, seller ids or commissions sent by the client', async () => {
    const p = await makeProduct(); const a = await login(ctx.app);
    for (const bad of [{ unitPaise: 1 }, { pricePaise: 1 }, { sellerId: '507f1f77bcf86cd799439011' }, { commissionBps: 0 }]) {
      expect((await checkout(a, [{ ...item(p), ...bad }])).status, JSON.stringify(bad)).toBe(400);
    }
    for (const bad of [{ totalPaise: 1 }, { shippingPaise: 0 }, { attribution: { sellerId: 'x' } }, { ref: 'someone' }]) expect((await checkout(a, [item(p)], bad)).status, JSON.stringify(bad)).toBe(400);
  });
  it('requires sign-in to check out, and validates the address and quantities', async () => {
    const p = await makeProduct();
    expect((await checkout(client(ctx.app), [item(p)])).status).toBe(401);
    const a = await login(ctx.app);
    expect((await checkout(a, [item(p)], { address: { ...ADDRESS, pincode: '12' } })).status).toBe(400);
    expect((await checkout(a, [item(p, 0)])).status).toBe(400);
    expect((await checkout(a, [item(p, 21)])).body.error.code).toBe('quantity_too_high');
    expect((await checkout(a, [])).status).toBe(400);
  });
  it('enforces variants and personalisation rules', async () => {
    const v = await makeProduct({ title: 'Sized', variants: [{ name: 'S', pricePaise: 10000 }, { name: 'L', pricePaise: 20000 }] });
    const c = await makeProduct({ title: 'Custom', customizable: true }); const a = await login(ctx.app);
    expect((await checkout(a, [item(v)])).body.error.code).toBe('variant_required');
    expect((await checkout(a, [item(v, 1, { variantId: '507f1f77bcf86cd799439011' })])).body.error.code).toBe('variant_required');
    expect((await checkout(a, [item(c)])).body.error.code).toBe('customization_required');
    expect((await checkout(a, [item(c, 1, { customization: 'x'.repeat(31) })])).body.error.code).toBe('customization_too_long');
    const ok = await checkout(a, [item(v, 1, { variantId: String(v.variants[1]._id) }), item(c, 1, { customization: 'Happy Birthday' })]);
    expect(ok.status).toBe(201); expect(ok.body.order.totals.subtotalPaise).toBe(20000 + 49900);
    expect(ok.body.order.items.find((i) => i.title === 'Custom').customization).toBe('Happy Birthday');
  });
  it('refuses unavailable products and a seller buying their own goods', async () => {
    const S = await makeApprovedSeller(ctx.app, admin, 'ownstuff'); const mine = await makeProduct({ seller: S.seller }); const draft = await makeProduct({ title: 'Draft', status: 'draft' });
    const a = await login(ctx.app);
    expect((await checkout(a, [item(draft)])).body.error.code).toBe('product_unavailable');
    expect((await checkout(S.agent, [item(mine)])).body.error.code).toBe('own_product');
  });
  it('coupons: validated and applied on the server, with limits', async () => {
    const p = await makeProduct({ pricePaise: 100000 }); const a = await login(ctx.app);
    await Coupon.create({ code: 'SAVE10', type: 'percent', value: 10, minOrderPaise: 50000, maxDiscountPaise: 5000, perUserLimit: 1, usageLimit: 5 });
    const q = await a.post('/api/orders/quote').send({ items: [item(p)], couponCode: 'save10' });
    expect(q.body.quote.discountPaise).toBe(5000); // capped
    expect((await a.post('/api/orders/quote').send({ items: [item(p)], couponCode: 'NOPE' })).body.error.code).toBe('coupon_invalid');
    const o = await checkout(a, [item(p)], { couponCode: 'SAVE10' }); expect(o.status).toBe(201);
    expect((await Coupon.findOne({ code: 'SAVE10' })).usedCount).toBe(1);
    expect((await checkout(a, [item(p)], { couponCode: 'SAVE10' })).body.error.message).toMatch(/already used/);
  });
});

describe('stock never oversells', () => {
  it.skipIf(!REAL_MONGO)('two shoppers racing for the last unit: exactly one wins (needs real MongoDB)', async () => {
    const p = await makeProduct({ stock: 1 }); const a = await login(ctx.app); const b = await login(ctx.app);
    const [r1, r2] = await Promise.all([checkout(a, [item(p)]), checkout(b, [item(p)])]);
    expect([r1.status, r2.status].sort()).toEqual([201, 409]);
    expect(await stockOf(p)).toBe(0);
    expect((await Order.countDocuments({}))).toBe(1);
  });
  it('a failed multi-item checkout leaves other items\' stock untouched', async () => {
    const plenty = await makeProduct({ title: 'Plenty', stock: 5 }); const few = await makeProduct({ title: 'Few', stock: 1 }); const a = await login(ctx.app);
    const r = await checkout(a, [item(plenty, 2), item(few, 2)]);
    expect(r.body.error.code).toBe('out_of_stock'); expect(await stockOf(plenty)).toBe(5); expect(await stockOf(few)).toBe(1);
  });
  it('retrying with the same Idempotency-Key never creates a second order or double-reserves', async () => {
    const p = await makeProduct({ stock: 5 }); const a = await login(ctx.app);
    const r1 = await checkout(a, [item(p)], {}, { 'Idempotency-Key': 'key-12345678' });
    const r2 = await checkout(a, [item(p)], {}, { 'Idempotency-Key': 'key-12345678' });
    expect(r1.status).toBe(201); expect(r2.status).toBe(200); expect(r2.body.order.orderNumber).toBe(r1.body.order.orderNumber);
    expect(await stockOf(p)).toBe(4); expect(await Order.countDocuments({})).toBe(1);
  });
  it('unpaid orders expire and return their stock and coupon use', async () => {
    const p = await makeProduct({ stock: 3, pricePaise: 100000 }); const a = await login(ctx.app);
    await Coupon.create({ code: 'HOLD', type: 'fixed', value: 1000, perUserLimit: 5 });
    const r = await checkout(a, [item(p, 2)], { couponCode: 'HOLD' });
    expect(await stockOf(p)).toBe(1); expect((await Coupon.findOne({ code: 'HOLD' })).usedCount).toBe(1);
    await Order.updateOne({ orderNumber: r.body.order.orderNumber }, { $set: { reservationExpiresAt: new Date(Date.now() - 1000) } });
    expect(await ctx.orders.releaseExpired()).toBe(1);
    expect(await stockOf(p)).toBe(3); expect((await Coupon.findOne({ code: 'HOLD' })).usedCount).toBe(0);
    expect(await ctx.orders.releaseExpired()).toBe(0); expect(await stockOf(p)).toBe(3); // idempotent — never restocks twice
  });
  it('customers can cancel an unpaid order and the stock returns', async () => {
    const p = await makeProduct({ stock: 2 }); const a = await login(ctx.app); const r = await checkout(a, [item(p)]);
    expect((await a.post(`/api/orders/${r.body.order.orderNumber}/cancel`).send({})).body.order.status).toBe('cancelled'); expect(await stockOf(p)).toBe(2);
  });
});

describe('payments are only trusted when verified', () => {
  it('a client-side "success" without a valid signature does not mark the order paid', async () => {
    const p = await makeProduct(); const a = await login(ctx.app); const r = await checkout(a, [item(p)]);
    const res = await a.post('/api/payments/verify').send({ orderNumber: r.body.order.orderNumber, paymentId: 'pay_fake_12345', signature: 'f'.repeat(64) });
    expect(res.status).toBe(400); expect(res.body.error.code).toBe('invalid_signature');
    expect((await Order.findOne({})).status).toBe('pending_payment'); expect(await Ledger.countDocuments({})).toBe(0);
  });
  it('a valid signature for an unpaid/failed payment (gateway says not captured) is refused', async () => {
    const p = await makeProduct(); const a = await login(ctx.app); const r = await checkout(a, [item(p)]);
    const sim = ctx.provider._simulate(r.body.payment.providerOrderId, 'failure');
    const res = await a.post('/api/payments/verify').send({ orderNumber: r.body.order.orderNumber, ...sim });
    expect(res.status).toBe(409); expect((await Order.findOne({})).status).toBe('pending_payment');
  });
  it('refuses a payment whose amount does not match the order', async () => {
    const p = await makeProduct(); const a = await login(ctx.app); const r = await checkout(a, [item(p)]);
    const sim = ctx.provider._simulate(r.body.payment.providerOrderId); ctx.provider._tamperAmount(sim.paymentId, 100);
    expect((await a.post('/api/payments/verify').send({ orderNumber: r.body.order.orderNumber, ...sim })).body.error.code).toBe('payment_mismatch');
    expect((await Order.findOne({})).status).toBe('pending_payment');
  });
  it('a signature from one order cannot confirm another', async () => {
    const p = await makeProduct({ stock: 5 }); const a = await login(ctx.app);
    const o1 = await checkout(a, [item(p)]); const o2 = await checkout(a, [item(p)]);
    const sim1 = ctx.provider._simulate(o1.body.payment.providerOrderId);
    expect((await a.post('/api/payments/verify').send({ orderNumber: o2.body.order.orderNumber, ...sim1 })).status).toBe(400);
    expect((await Order.findOne({ orderNumber: o2.body.order.orderNumber })).status).toBe('pending_payment');
  });
  it('another customer cannot verify, read or cancel someone else\'s order', async () => {
    const p = await makeProduct(); const a = await login(ctx.app); const b = await login(ctx.app); const r = await checkout(a, [item(p)]);
    const sim = ctx.provider._simulate(r.body.payment.providerOrderId); const n = r.body.order.orderNumber;
    expect((await b.post('/api/payments/verify').send({ orderNumber: n, ...sim })).status).toBe(404);
    expect((await b.get(`/api/orders/${n}`)).status).toBe(404);
    expect((await b.post(`/api/orders/${n}/cancel`).send({})).status).toBe(404);
    expect((await b.get('/api/orders')).body.orders).toHaveLength(0);
    expect((await a.get(`/api/orders/${n}`)).status).toBe(200);
  });
  it.skipIf(!REAL_MONGO)('confirming twice at the same instant is harmless: one ledger, one sale count (needs real MongoDB)', async () => {
    const S = await makeApprovedSeller(ctx.app, admin, 'twice'); const p = await makeProduct({ seller: S.seller }); const a = await login(ctx.app); const r = await checkout(a, [item(p)]);
    const sim = ctx.provider._simulate(r.body.payment.providerOrderId); const body = { orderNumber: r.body.order.orderNumber, ...sim };
    const [x, y] = await Promise.all([a.post('/api/payments/verify').send(body), a.post('/api/payments/verify').send(body)]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect(await Ledger.countDocuments({})).toBe(1); expect((await Order.findOne({})).status).toBe('paid');
    expect((await (await import('../src/models/index.js')).Product.findById(p._id)).soldCount).toBe(1);
  });
  describe('webhook', () => {
    const send = (raw, sig, id) => request(ctx.app).post('/api/payments/webhook/razorpay').set('Content-Type', 'application/json').set('x-razorpay-signature', sig).set('x-razorpay-event-id', id).send(raw);
    const evt = (providerOrderId, paymentId, amount, status = 'captured', event = 'payment.captured') => JSON.stringify({ event, payload: { payment: { entity: { id: paymentId, order_id: providerOrderId, amount, status, method: 'upi' } } } });
    it('rejects a bad signature and ignores nothing silently', async () => {
      const p = await makeProduct(); const a = await login(ctx.app); const r = await checkout(a, [item(p)]);
      const raw = evt(r.body.payment.providerOrderId, 'pay_x12345', r.body.order.totals.totalPaise);
      expect((await send(raw, 'bad', 'evt1')).status).toBe(400);
      expect((await Order.findOne({})).status).toBe('pending_payment'); expect(await PaymentEvent.countDocuments({})).toBe(0);
    });
    it('confirms a captured payment, and replaying the same event changes nothing', async () => {
      const S = await makeApprovedSeller(ctx.app, admin, 'hooks'); const p = await makeProduct({ seller: S.seller }); const a = await login(ctx.app); const r = await checkout(a, [item(p)]);
      const raw = evt(r.body.payment.providerOrderId, 'pay_hook12345', r.body.order.totals.totalPaise); const sig = ctx.provider._webhookSign(raw);
      expect((await send(raw, sig, 'evt-A')).status).toBe(200);
      expect((await Order.findOne({})).status).toBe('paid');
      expect((await send(raw, sig, 'evt-A')).status).toBe(200); // duplicate delivery
      expect(await Ledger.countDocuments({})).toBe(1); expect(await PaymentEvent.countDocuments({})).toBe(1);
    });
    it('does not trust a webhook whose amount differs from the order', async () => {
      const p = await makeProduct(); const a = await login(ctx.app); const r = await checkout(a, [item(p)]);
      const raw = evt(r.body.payment.providerOrderId, 'pay_low12345', 100); expect((await send(raw, ctx.provider._webhookSign(raw), 'evt-B')).status).toBe(200);
      expect((await Order.findOne({})).status).toBe('pending_payment');
    });
    it('a payment arriving after the reservation expired is re-reserved if possible, otherwise refunded', async () => {
      const p = await makeProduct({ stock: 1 }); const a = await login(ctx.app); const b = await login(ctx.app);
      const r = await checkout(a, [item(p)]);
      await Order.updateOne({ orderNumber: r.body.order.orderNumber }, { $set: { reservationExpiresAt: new Date(Date.now() - 1000) } }); await ctx.orders.releaseExpired();
      const sim = ctx.provider._simulate(r.body.payment.providerOrderId); // customer pays late
      const late = await a.post('/api/payments/verify').send({ orderNumber: r.body.order.orderNumber, ...sim });
      expect(late.status).toBe(200); expect(late.body.order.status).toBe('paid'); expect(await stockOf(p)).toBe(0); // stock was free → re-reserved
      // second case: stock gone to someone else before the late payment arrives
      const p2 = await makeProduct({ title: 'Scarce', stock: 1 }); const r2 = await checkout(a, [item(p2)]);
      await Order.updateOne({ orderNumber: r2.body.order.orderNumber }, { $set: { reservationExpiresAt: new Date(Date.now() - 1000) } }); await ctx.orders.releaseExpired();
      expect((await checkout(b, [item(p2)])).status).toBe(201); // someone else takes it
      const sim2 = ctx.provider._simulate(r2.body.payment.providerOrderId);
      await a.post('/api/payments/verify').send({ orderNumber: r2.body.order.orderNumber, ...sim2 });
      const o2 = await Order.findOne({ orderNumber: r2.body.order.orderNumber });
      expect(o2.status).toBe('expired'); expect(o2.payment.status).toBe('refunded'); expect(o2.history.some((h) => h.action === 'late_payment_refunded')).toBe(true);
      expect(await stockOf(p2)).toBe(0);
    });
  });
});

describe('attribution & commission', () => {
  const ledgerOf = (order, seller) => Ledger.findOne({ orderNumber: order.orderNumber, sellerId: seller._id });
  it('orders via a seller link pay 5%; the same seller\'s goods bought through the marketplace pay 12%', async () => {
    const S = await makeApprovedSeller(ctx.app, admin, 'rosecraft'); const p = await makeProduct({ seller: S.seller, pricePaise: 100000, stock: 5 });
    const viaLink = await login(ctx.app); expect((await touch(viaLink, 'rosecraft')).status).toBe(200);
    const o1 = (await checkout(viaLink, [item(p)])).body.order; await pay(viaLink, o1);
    const l1 = await ledgerOf(o1, S.seller); expect(l1.source).toBe('seller_link'); expect(l1.commissionPaise).toBe(5000); expect(l1.lines[0]).toMatchObject({ rateBps: 500, rateBasis: 'platform_default' });
    const direct = await login(ctx.app); const o2 = (await checkout(direct, [item(p)])).body.order; await pay(direct, o2);
    const l2 = await ledgerOf(o2, S.seller); expect(l2.source).toBe('marketplace'); expect(l2.commissionPaise).toBe(12000);
    expect(l1.sellerPayablePaise).toBe(100000 - 5000 + 0); // free shipping at ₹1000
  });
  it('multi-seller cart through one seller\'s link: that seller pays 5%, others 12%, Upahars Originals no seller commission', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha'); const B = await makeApprovedSeller(ctx.app, admin, 'beta');
    const pa = await makeProduct({ title: 'A item', seller: A.seller, pricePaise: 100000 }); const pb = await makeProduct({ title: 'B item', seller: B.seller, pricePaise: 100000 }); const po = await makeProduct({ title: 'Own item', pricePaise: 100000 });
    const buyer = await login(ctx.app); await touch(buyer, 'alpha');
    const o = (await checkout(buyer, [item(pa), item(pb), item(po)])).body.order; const paid = await pay(buyer, o);
    expect(paid.status).toBe('paid');
    expect((await ledgerOf(o, A.seller)).commissionPaise).toBe(5000);
    expect((await ledgerOf(o, B.seller)).commissionPaise).toBe(12000);
    expect(await Ledger.countDocuments({})).toBe(2); // Originals produce no seller ledger
    expect(paid.shipments).toHaveLength(3);
  });
  it('last-touch: switching sellers moves the referral; first-touch keeps the original', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha'); const B = await makeApprovedSeller(ctx.app, admin, 'beta');
    const pa = await makeProduct({ title: 'A', seller: A.seller, pricePaise: 100000 }); const pb = await makeProduct({ title: 'B', seller: B.seller, pricePaise: 100000 });
    const buyer = await login(ctx.app); await touch(buyer, 'alpha'); await touch(buyer, 'beta');
    const o = (await checkout(buyer, [item(pa), item(pb)])).body.order; await pay(buyer, o);
    expect((await ledgerOf(o, B.seller)).source).toBe('seller_link'); expect((await ledgerOf(o, A.seller)).source).toBe('marketplace');
    await admin.put('/api/admin/settings').send({ attribution: { policy: 'first_touch' } });
    const buyer2 = await login(ctx.app); await touch(buyer2, 'alpha'); const second = await touch(buyer2, 'beta'); expect(second.body.applied).toBe(false);
    const o2 = (await checkout(buyer2, [item(pa), item(pb)])).body.order; await pay(buyer2, o2);
    expect((await ledgerOf(o2, A.seller)).source).toBe('seller_link'); expect((await ledgerOf(o2, B.seller)).source).toBe('marketplace');
  });
  it('the attribution window is enforced; expired cookies earn the marketplace rate', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha'); const pa = await makeProduct({ seller: A.seller, pricePaise: 100000 });
    const buyer = await login(ctx.app); await touch(buyer, 'alpha');
    await admin.put('/api/admin/settings').send({ attribution: { windowDays: 1 } });
    await Touch.updateMany({}, { $set: { createdAt: new Date(Date.now() - 5 * 86400000) } }); // evidence only; the signed cookie carries its own time
    const cookie = (await buyer.get('/api/attribution/current')).body; expect(cookie.active).toBe(true);
    const realNow = Date.now; Date.now = () => realNow() + 2 * 86400000;
    try { const o = (await checkout(buyer, [item(pa)])).body.order; Date.now = realNow; await pay(buyer, o); expect((await ledgerOf(o, A.seller)).source).toBe('marketplace'); } finally { Date.now = realNow; }
  });
  it('a forged or unknown ref grants nothing, and the checkout body cannot name a seller', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha'); const pa = await makeProduct({ seller: A.seller, pricePaise: 100000 });
    const buyer = await login(ctx.app);
    expect((await touch(buyer, 'no-such-store')).status).toBe(400);
    const goodBody = Buffer.from(JSON.stringify({ s: String(A.seller._id), t: 'x', at: Date.now() })).toString('base64url');
    const forged = await request(ctx.app).post('/api/orders/checkout').set('Origin', ORIGIN)
      .set('Cookie', `${buyer.sessionCookie}; upahars_ref=${goodBody}.${'A'.repeat(43)}`).send({ items: [item(pa)], address: ADDRESS });
    expect(forged.status).toBe(201);
    expect((await Order.findOne({ orderNumber: forged.body.order.orderNumber })).attribution).toBeNull(); // unsigned cookie → no attribution
    await pay(buyer, forged.body.order); expect((await ledgerOf(forged.body.order, A.seller)).source).toBe('marketplace');
  });
  it('suspended or paused stores no longer attract link commission', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha'); const buyer = await login(ctx.app); await touch(buyer, 'alpha');
    await A.agent.patch('/api/seller/store').send({ isPaused: true });
    expect((await touch(await login(ctx.app), 'alpha')).status).toBe(400); expect((await buyer.get('/api/attribution/current')).body.active).toBe(false);
  });
  it('sellers earn nothing extra by buying their own goods (blocked), and cannot attribute to themselves', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha'); const mine = await makeProduct({ seller: A.seller }); await touch(A.agent, 'alpha');
    expect((await checkout(A.agent, [item(mine)])).body.error.code).toBe('own_product');
  });
  it('records the evidence on the order and in a touch record; admins can see it, customers cannot', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha'); const pa = await makeProduct({ seller: A.seller, pricePaise: 100000 });
    const buyer = await login(ctx.app); await touch(buyer, 'alpha');
    const o = (await checkout(buyer, [item(pa)])).body.order; await pay(buyer, o);
    const adminView = await admin.get(`/api/admin/orders/${o.orderNumber}`);
    expect(adminView.body.order.attribution).toMatchObject({ policy: 'last_touch', windowDays: 14, landingPath: '/store/alpha' });
    expect(adminView.body.attributionEvidence).toMatchObject({ landingPath: '/store/alpha', applied: true }); expect(adminView.body.attributionEvidence.ipHash).toHaveLength(32);
    expect(JSON.stringify((await buyer.get(`/api/orders/${o.orderNumber}`)).body)).not.toMatch(/attribution|touch|commission/i);
  });
  it('commission rules are configurable: admin settings, seller override, then product override', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha'); const p = await makeProduct({ seller: A.seller, pricePaise: 100000, stock: 20 });
    const run = async () => { const b = await login(ctx.app); await touch(b, 'alpha'); const o = (await checkout(b, [item(p)])).body.order; await pay(b, o); return ledgerOf(o, A.seller); };
    expect((await run()).lines[0].rateBps).toBe(500);
    await admin.put('/api/admin/settings').send({ commission: { linkBps: 700 } }); expect((await run()).lines[0]).toMatchObject({ rateBps: 700, rateBasis: 'platform_default' });
    await admin.patch(`/api/admin/sellers/${A.seller._id}/commission`).send({ linkBps: 300, reason: 'launch partner' }); expect((await run()).lines[0]).toMatchObject({ rateBps: 300, rateBasis: 'seller_override' });
    await admin.patch(`/api/admin/products/${p._id}/commission`).send({ commissionOverrideBps: 0, reason: 'promotion' }); expect((await run()).lines[0]).toMatchObject({ rateBps: 0, rateBasis: 'product_override' });
    const old = await Ledger.find({}).sort({ createdAt: 1 }); expect(old[0].lines[0].rateBps).toBe(500); // past orders keep the rate they were sold at
  });
  it('seller-funded coupons reduce the commission base; platform-funded do not', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha'); const p = await makeProduct({ seller: A.seller, pricePaise: 100000, stock: 5 });
    await Coupon.create({ code: 'TWENTY', type: 'fixed', value: 20000, perUserLimit: 5 });
    const run = async () => { const b = await login(ctx.app); const o = (await checkout(b, [item(p)], { couponCode: 'TWENTY' })).body.order; await pay(b, o); return ledgerOf(o, A.seller); };
    const platform = await run(); expect(platform.eligiblePaise).toBe(100000); expect(platform.commissionPaise).toBe(12000);
    await admin.put('/api/admin/settings').send({ discountFunding: 'seller' });
    const seller = await run(); expect(seller.eligiblePaise).toBe(80000); expect(seller.commissionPaise).toBe(9600);
  });
  void Inventory;
});
