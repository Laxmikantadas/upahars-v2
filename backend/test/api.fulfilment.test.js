import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADDRESS, REAL_MONGO, client, login, loginAdmin, makeApprovedSeller, makeProduct, resetDb, seedTaxonomy, startApp, stockOf, stopDb } from './helpers.js';
import { Coupon, Ledger, Order, Payout, Seller } from '../src/models/index.js';
import { decryptJson } from '../src/lib/crypto.js';

let ctx, admin;
beforeAll(async () => { ctx = await startApp(); });
afterAll(stopDb);
beforeEach(async () => { await resetDb(); await seedTaxonomy(); admin = await loginAdmin(ctx.app); });

const item = (p, qty = 1, extra = {}) => ({ productId: String(p._id), qty, ...extra });
async function paidOrder(buyer, items, extra = {}) {
  const r = await buyer.post('/api/orders/checkout').send({ items, address: ADDRESS, ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const paid = await buyer.post('/api/dev/payments/simulate').send({ orderNumber: r.body.order.orderNumber });
  expect(paid.body.order.status).toBe('paid');
  return paid.body.order;
}
const ship = (agent, o, sh, status, tracking, base = '/api/seller') => agent.post(`${base}/orders/${o.orderNumber}/shipments/${sh.id}`).send({ status, ...(tracking && { tracking }) });
const TRACK = { carrier: 'Delhivery', trackingNumber: 'DL123456', trackingUrl: '' };

describe('seller fulfilment', () => {
  it('follows pending → processing → shipped (tracking required) → delivered, and never invents tracking', async () => {
    const S = await makeApprovedSeller(ctx.app, admin, 'shipper'); const p = await makeProduct({ seller: S.seller }); const buyer = await login(ctx.app);
    const o = await paidOrder(buyer, [item(p)]); const sh = o.shipments[0];
    expect(sh.tracking).toBeNull(); expect(sh.status).toBe('pending');
    expect((await ship(S.agent, o, sh, 'delivered')).body.error.code).toBe('bad_transition');
    expect((await ship(S.agent, o, sh, 'shipped', TRACK)).body.error.code).toBe('bad_transition'); // must be processing first
    expect((await ship(S.agent, o, sh, 'processing')).status).toBe(200);
    expect((await ship(S.agent, o, sh, 'shipped')).body.error.code).toBe('tracking_required');
    expect((await ship(S.agent, o, sh, 'shipped', { carrier: ' ', trackingNumber: '', trackingUrl: '' })).body.error.code).toBe('tracking_required');
    const shipped = await ship(S.agent, o, sh, 'shipped', TRACK); expect(shipped.status).toBe(200);
    const cust = (await buyer.get(`/api/orders/${o.orderNumber}`)).body.order.shipments[0]; expect(cust.tracking).toMatchObject({ carrier: 'Delhivery', trackingNumber: 'DL123456', enteredBy: 'seller' });
    expect((await ship(S.agent, o, sh, 'delivered')).status).toBe(200);
    const l = await Ledger.findOne({ orderNumber: o.orderNumber }); expect(l.deliveredAt).toBeTruthy(); expect(l.payableAfter.getTime()).toBeGreaterThan(Date.now() + 6 * 86400000);
  });
  it('unpaid orders cannot be fulfilled', async () => {
    const S = await makeApprovedSeller(ctx.app, admin, 'early'); const p = await makeProduct({ seller: S.seller }); const buyer = await login(ctx.app);
    const r = await buyer.post('/api/orders/checkout').send({ items: [item(p)], address: ADDRESS });
    expect((await S.agent.get(`/api/seller/orders/${r.body.order.orderNumber}`)).status).toBe(404); // sellers never see unpaid orders
    expect((await S.agent.get('/api/seller/orders')).body.orders).toHaveLength(0);
  });
  it('sellers see only their own items, and the delivery address only for paid orders', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha'); const B = await makeApprovedSeller(ctx.app, admin, 'beta');
    const pa = await makeProduct({ title: 'A item', seller: A.seller }); const pb = await makeProduct({ title: 'B item', seller: B.seller }); const po = await makeProduct({ title: 'Own item' });
    const buyer = await login(ctx.app); const o = await paidOrder(buyer, [item(pa), item(pb), item(po)]);
    const av = (await A.agent.get(`/api/seller/orders/${o.orderNumber}`)).body.order;
    expect(av.items.map((i) => i.title)).toEqual(['A item']); expect(av.shipments).toHaveLength(1); expect(av.shipTo.pincode).toBe('751007');
    const text = JSON.stringify(av); expect(text).not.toMatch(/B item|Own item|totals|userId|payment|coupon/i);
    expect((await B.agent.get('/api/seller/orders')).body.orders[0].items.map((i) => i.title)).toEqual(['B item']);
  });
  it('seller B cannot touch seller A\'s shipment, and no seller can ship Upahars Originals', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha'); const B = await makeApprovedSeller(ctx.app, admin, 'beta');
    const pa = await makeProduct({ title: 'A item', seller: A.seller }); const po = await makeProduct({ title: 'Own item' });
    const buyer = await login(ctx.app); const o = await paidOrder(buyer, [item(pa), item(po)]);
    const shA = o.shipments.find((s) => s.owner === 'seller'), shO = o.shipments.find((s) => s.owner === 'upahars');
    expect((await ship(B.agent, o, shA, 'processing')).status).toBe(404);
    expect((await B.agent.get(`/api/seller/orders/${o.orderNumber}`)).status).toBe(404);
    expect((await ship(A.agent, o, shO, 'processing')).status).toBe(404);
    const aSeesO = await A.agent.post(`/api/seller/orders/${o.orderNumber}/shipments/${shO.id}`).send({ status: 'processing' }); expect(aSeesO.status).toBe(404);
    expect((await ship(admin, o, shO, 'processing', null, '/api/admin')).status).toBe(200); // admins run Originals fulfilment
    expect((await Order.findOne({ orderNumber: o.orderNumber })).shipments.find((s) => s.ownerType === 'seller').status).toBe('pending');
  });
  it('a seller cancelling a shipment refunds those items, restocks and reverses their ledger', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha'); const p = await makeProduct({ seller: A.seller, pricePaise: 50000, stock: 5 }); const buyer = await login(ctx.app);
    const o = await paidOrder(buyer, [item(p, 2)]); expect(await stockOf(p)).toBe(3);
    const r = await ship(A.agent, o, o.shipments[0], 'cancelled'); expect(r.status).toBe(200);
    const fresh = await Order.findOne({ orderNumber: o.orderNumber });
    expect(fresh.shipments[0].status).toBe('cancelled'); expect(fresh.payment.status).toBe('refunded'); expect(fresh.refundedPaise).toBe(fresh.payment.amountPaise);
    expect(await stockOf(p)).toBe(5); expect((await Ledger.findOne({})).status).toBe('reversed');
  });
});

describe('cancellation and refunds', () => {
  it('a customer can cancel a paid order before anything ships: full refund, stock back, ledger reversed', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha'); const p = await makeProduct({ seller: A.seller, pricePaise: 50000, stock: 4 }); const buyer = await login(ctx.app);
    const o = await paidOrder(buyer, [item(p, 2)]);
    const c = await buyer.post(`/api/orders/${o.orderNumber}/cancel`).send({}); expect(c.status).toBe(200);
    expect(c.body.order.payment.status).toBe('refunded'); expect(c.body.order.shipments[0].status).toBe('cancelled');
    expect(await stockOf(p)).toBe(4); expect((await Ledger.findOne({})).status).toBe('reversed');
    expect((await buyer.post(`/api/orders/${o.orderNumber}/cancel`).send({})).status).toBe(409); // already cancelled
  });
  it('cannot be cancelled by the customer once part has shipped', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha'); const p = await makeProduct({ seller: A.seller }); const buyer = await login(ctx.app); const o = await paidOrder(buyer, [item(p)]);
    await ship(A.agent, o, o.shipments[0], 'processing'); await ship(A.agent, o, o.shipments[0], 'shipped', TRACK);
    expect((await buyer.post(`/api/orders/${o.orderNumber}/cancel`).send({})).body.error.code).toBe('cannot_cancel');
  });
  it('partial refunds split coupon discounts exactly and recompute the seller\'s ledger', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha'); const p = await makeProduct({ seller: A.seller, pricePaise: 100000, stock: 5 }); const buyer = await login(ctx.app);
    await Coupon.create({ code: 'TWENTY', type: 'fixed', value: 20000, perUserLimit: 5 });
    const o = await paidOrder(buyer, [item(p, 2)], { couponCode: 'TWENTY' }); const itemId = o.items[0].id;
    expect(o.totals.totalPaise).toBe(180000);
    const r1 = await admin.post(`/api/admin/orders/${o.orderNumber}/refund`).send({ items: [{ itemId, qty: 1 }], reason: 'damaged piece' });
    expect(r1.status).toBe(200); expect(r1.body.refundedPaise).toBe(90000);
    let l = await Ledger.findOne({}); expect(l.lines[0].refundedQty).toBe(1); expect(l.grossPaise).toBe(100000); expect(l.commissionPaise).toBe(12000);
    const r2 = await admin.post(`/api/admin/orders/${o.orderNumber}/refund`).send({ items: [{ itemId, qty: 1 }], reason: 'second one too' });
    expect(r1.body.refundedPaise + r2.body.refundedPaise).toBe(180000); // exactly what was paid — never more
    l = await Ledger.findOne({}); expect(l.status).toBe('reversed'); expect(l.sellerPayablePaise).toBe(0);
    expect((await admin.post(`/api/admin/orders/${o.orderNumber}/refund`).send({ items: [{ itemId, qty: 1 }], reason: 'again?' })).body.error.code).toBe('refund_exceeds');
  });
  it('shipping is refunded only when the whole shipment is refunded', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha'); const p = await makeProduct({ seller: A.seller, pricePaise: 20000, stock: 5 }); const buyer = await login(ctx.app);
    const o = await paidOrder(buyer, [item(p, 2)]); expect(o.totals.shippingPaise).toBe(6500); const id = o.items[0].id;
    expect((await admin.post(`/api/admin/orders/${o.orderNumber}/refund`).send({ items: [{ itemId: id, qty: 1 }], reason: 'partial' })).body.refundedPaise).toBe(20000);
    expect((await admin.post(`/api/admin/orders/${o.orderNumber}/refund`).send({ items: [{ itemId: id, qty: 1 }], reason: 'rest of it' })).body.refundedPaise).toBe(26500);
  });
  it.skipIf(!REAL_MONGO)('two simultaneous refunds can never refund the same units twice (needs real MongoDB)', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha'); const p = await makeProduct({ seller: A.seller, pricePaise: 100000 }); const buyer = await login(ctx.app);
    const o = await paidOrder(buyer, [item(p, 1)]); const body = { items: [{ itemId: o.items[0].id, qty: 1 }], reason: 'double click' };
    const res = await Promise.all([admin.post(`/api/admin/orders/${o.orderNumber}/refund`).send(body), admin.post(`/api/admin/orders/${o.orderNumber}/refund`).send(body)]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 409]);
    const fresh = await Order.findOne({ orderNumber: o.orderNumber }); expect(fresh.refundedPaise).toBe(fresh.payment.amountPaise); expect(fresh.refunds.filter((x) => x.status === 'processed')).toHaveLength(1);
  });
  it('if the gateway refuses the refund nothing changes and the failure is recorded', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha'); const p = await makeProduct({ seller: A.seller, pricePaise: 100000, stock: 3 }); const buyer = await login(ctx.app); const o = await paidOrder(buyer, [item(p)]);
    const orig = ctx.provider.refund; ctx.provider.refund = async () => { throw new Error('gateway down'); };
    try { const r = await admin.post(`/api/admin/orders/${o.orderNumber}/refund`).send({ items: [{ itemId: o.items[0].id, qty: 1 }], reason: 'try' }); expect(r.status).toBe(502); } finally { ctx.provider.refund = orig; }
    const fresh = await Order.findOne({ orderNumber: o.orderNumber }); expect(fresh.refundedPaise).toBe(0); expect(fresh.items[0].refundedQty).toBe(0); expect(fresh.refunds[0].status).toBe('failed');
    expect(await stockOf(p)).toBe(2); expect((await Ledger.findOne({})).status).toBe('pending');
  });
  it('refund endpoints are admin-only and refuse unpaid orders and unknown items', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha'); const p = await makeProduct({ seller: A.seller }); const buyer = await login(ctx.app);
    const pending = (await buyer.post('/api/orders/checkout').send({ items: [item(p)], address: ADDRESS })).body.order;
    expect((await buyer.post(`/api/admin/orders/${pending.orderNumber}/refund`).send({ items: [{ itemId: pending.items[0].id, qty: 1 }], reason: 'hack' })).status).toBe(403);
    expect((await admin.post(`/api/admin/orders/${pending.orderNumber}/refund`).send({ items: [{ itemId: pending.items[0].id, qty: 1 }], reason: 'unpaid' })).body.error.code).toBe('not_paid');
    const o = await paidOrder(await login(ctx.app), [item(await makeProduct({ title: 'Other', seller: A.seller }))]);
    expect((await admin.post(`/api/admin/orders/${o.orderNumber}/refund`).send({ items: [{ itemId: '507f1f77bcf86cd799439011', qty: 1 }], reason: 'bogus item' })).body.error.code).toBe('bad_item');
  });
});

describe('earnings and payouts', () => {
  async function deliveredSale(S, price = 100000, buyer) {
    const p = await makeProduct({ title: `P${Math.random()}`, seller: S.seller, pricePaise: price });
    const b = buyer ?? await login(ctx.app); const o = await paidOrder(b, [item(p)]);
    await ship(S.agent, o, o.shipments[0], 'processing'); await ship(S.agent, o, o.shipments[0], 'shipped', TRACK); await ship(S.agent, o, o.shipments[0], 'delivered');
    return o;
  }
  const releaseHold = () => Ledger.updateMany({ deliveredAt: { $ne: null } }, { $set: { payableAfter: new Date(Date.now() - 1000) } });

  it('earnings are not payable until delivery plus the hold period', async () => {
    const S = await makeApprovedSeller(ctx.app, admin, 'earner'); const p = await makeProduct({ seller: S.seller, pricePaise: 100000 }); const buyer = await login(ctx.app);
    const o = await paidOrder(buyer, [item(p)]);
    let e = (await S.agent.get('/api/seller/earnings')).body; expect(e.summary).toMatchObject({ pendingPaise: 88000, payablePaise: 0, paidPaise: 0 });
    expect(e.entries[0]).toMatchObject({ commissionPaise: 12000, sellerPayablePaise: 88000, source: 'marketplace' });
    expect((await admin.post(`/api/admin/sellers/${S.seller._id}/payouts`).send({})).body.error.code).toBe('nothing_to_pay');
    await ship(S.agent, o, o.shipments[0], 'processing'); await ship(S.agent, o, o.shipments[0], 'shipped', TRACK); await ship(S.agent, o, o.shipments[0], 'delivered');
    expect((await admin.post(`/api/admin/sellers/${S.seller._id}/payouts`).send({})).body.error.code).toBe('nothing_to_pay'); // still inside the return window
    await releaseHold();
    e = (await S.agent.get('/api/seller/earnings')).body; expect(e.summary.payablePaise).toBe(88000);
  });
  it('payout flow: create → locked → paid needs a bank/UPI reference → seller sees it as paid', async () => {
    const S = await makeApprovedSeller(ctx.app, admin, 'paid'); await deliveredSale(S); await deliveredSale(S, 50000); await releaseHold();
    const preview = (await admin.get(`/api/admin/sellers/${S.seller._id}/payable`)).body; expect(preview.totalPaise).toBe(88000 + 50500); // 2nd sale: 50,000 − 12% + ₹65 shipping (paid to the seller)
    const created = await admin.post(`/api/admin/sellers/${S.seller._id}/payouts`).send({}); expect(created.status).toBe(201); expect(created.body.payout.amountPaise).toBe(138500);
    expect((await admin.post(`/api/admin/sellers/${S.seller._id}/payouts`).send({})).body.error.code).toBe('nothing_to_pay'); // already locked — cannot be paid twice
    const sellerView = (await S.agent.get('/api/seller/payouts')).body.payouts[0]; expect(sellerView).toMatchObject({ status: 'processing', reference: '' });
    expect((await admin.post(`/api/admin/payouts/${created.body.payout._id}/paid`).send({ reference: '' })).status).toBe(400);
    expect((await S.agent.post(`/api/admin/payouts/${created.body.payout._id}/paid`).send({ reference: 'UTR123456' })).status).toBe(403);
    expect((await admin.post(`/api/admin/payouts/${created.body.payout._id}/paid`).send({ reference: 'UTR123456789', method: 'bank' })).status).toBe(200);
    expect((await admin.post(`/api/admin/payouts/${created.body.payout._id}/paid`).send({ reference: 'UTR-AGAIN' })).status).toBe(409); // cannot be marked twice
    expect((await S.agent.get('/api/seller/payouts')).body.payouts[0]).toMatchObject({ status: 'paid', reference: 'UTR123456789' });
    const e = (await S.agent.get('/api/seller/earnings')).body.summary; expect(e).toMatchObject({ paidPaise: 138500, payablePaise: 0, pendingPaise: 0 });
  });
  it('a failed payout returns the earnings to payable', async () => {
    const S = await makeApprovedSeller(ctx.app, admin, 'failpay'); await deliveredSale(S); await releaseHold();
    const c = await admin.post(`/api/admin/sellers/${S.seller._id}/payouts`).send({});
    await admin.post(`/api/admin/payouts/${c.body.payout._id}/failed`).send({ note: 'bank rejected' });
    expect((await S.agent.get('/api/seller/earnings')).body.summary.payablePaise).toBe(88000);
    expect((await admin.post(`/api/admin/sellers/${S.seller._id}/payouts`).send({})).status).toBe(201);
  });
  it('a refund after the seller was paid becomes a deduction from the next payout', async () => {
    const S = await makeApprovedSeller(ctx.app, admin, 'clawback'); const first = await deliveredSale(S, 100000); await deliveredSale(S, 100000); await releaseHold();
    const pay1 = await admin.post(`/api/admin/sellers/${S.seller._id}/payouts`).send({}); expect(pay1.body.payout.amountPaise).toBe(176000);
    await admin.post(`/api/admin/payouts/${pay1.body.payout._id}/paid`).send({ reference: 'UTR-1-ABCDE' });
    await admin.post(`/api/admin/orders/${first.orderNumber}/refund`).send({ items: [{ itemId: first.items[0].id, qty: 1 }], reason: 'customer returned it' });
    const ledgers = await Ledger.find({}).sort({ createdAt: 1 }); expect(ledgers[0].sellerPayablePaise).toBe(0); expect(ledgers[0].settledPaise).toBe(88000); // owes 880 back
    expect((await S.agent.get('/api/seller/earnings')).body.entries.find((x) => x.orderNumber === first.orderNumber).outstandingPaise).toBe(-88000);
    expect((await admin.post(`/api/admin/sellers/${S.seller._id}/payouts`).send({})).body.error.code).toBe('nothing_to_pay'); // net is not positive
    await deliveredSale(S, 100000); await deliveredSale(S, 100000); await releaseHold();   // two new sales: +176,000, minus the 88,000 owed back
    const pay2 = await admin.post(`/api/admin/sellers/${S.seller._id}/payouts`).send({}); expect(pay2.status).toBe(201); expect(pay2.body.payout.amountPaise).toBe(176000 - 88000);
    await admin.post(`/api/admin/payouts/${pay2.body.payout._id}/paid`).send({ reference: 'UTR-2-ABCDE' });
    const settled = (await Ledger.find({}).sort({ createdAt: 1 })).map((l) => l.settledPaise); expect(settled[0]).toBe(0); // the clawback was settled against the new payout
    expect(settled.reduce((a, b) => a + b, 0)).toBe(176000 + 88000);   // total actually paid out to this seller across both payouts
  });
  it('admin can hold disputed earnings, which keeps them out of payouts, and adjust with a reason', async () => {
    const S = await makeApprovedSeller(ctx.app, admin, 'dispute'); const o = await deliveredSale(S); await releaseHold(); const l = await Ledger.findOne({});
    expect((await admin.post(`/api/admin/ledgers/${l._id}/hold`).send({ reason: 'customer dispute' })).status).toBe(200);
    expect((await admin.post(`/api/admin/sellers/${S.seller._id}/payouts`).send({})).body.error.code).toBe('nothing_to_pay');
    expect((await S.agent.get('/api/seller/earnings')).body.summary.onHoldPaise).toBe(88000);
    await admin.post(`/api/admin/ledgers/${l._id}/release`).send({ reason: 'resolved' });
    expect((await admin.post(`/api/admin/ledgers/${l._id}/adjust`).send({ amountPaise: -5000, reason: 'packaging damage claim' })).body.ledger.sellerPayablePaise).toBe(83000);
    expect((await admin.post(`/api/admin/ledgers/${l._id}/adjust`).send({ amountPaise: 0, reason: 'nothing' })).status).toBe(400);
    const log = (await admin.get('/api/admin/audit?entity=ledger')).body.entries.map((e) => e.action); expect(log).toEqual(expect.arrayContaining(['ledger.hold', 'ledger.release', 'ledger.adjust']));
    void o;
  });
  it('sellers only ever see their own earnings and payouts', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha'); const B = await makeApprovedSeller(ctx.app, admin, 'beta'); await deliveredSale(A); await releaseHold();
    expect((await B.agent.get('/api/seller/earnings')).body.entries).toHaveLength(0); expect((await B.agent.get('/api/seller/earnings')).body.summary.pendingPaise).toBe(0);
    await admin.post(`/api/admin/sellers/${A.seller._id}/payouts`).send({}); expect((await B.agent.get('/api/seller/payouts')).body.payouts).toHaveLength(0);
    expect((await (await login(ctx.app)).get('/api/seller/earnings')).status).toBe(403);
  });
  it('payout details are encrypted at rest and only a masked hint is ever returned', async () => {
    const S = await makeApprovedSeller(ctx.app, admin, 'bank');
    expect((await S.agent.put('/api/seller/payout-details').send({ method: 'upi', upiId: 'not-a-upi' })).status).toBe(400);
    const r = await S.agent.put('/api/seller/payout-details').send({ method: 'bank', accountHolder: 'Rita Das', ifsc: 'SBIN0001234', accountNumber: '123456789012' });
    expect(r.body.payoutHint).toBe('SBIN ••••9012'); expect(JSON.stringify(r.body)).not.toContain('123456789012');
    const doc = await Seller.findById(S.seller._id); expect(doc.payoutEnc).not.toContain('123456789012'); expect(decryptJson(ctx.config.encryptionKey, doc.payoutEnc).accountNumber).toBe('123456789012');
    expect(JSON.stringify((await S.agent.get('/api/seller/me')).body)).not.toContain('123456789012');
    expect(JSON.stringify((await admin.get(`/api/admin/sellers/${S.seller._id}`)).body)).not.toContain('123456789012');
  });
});

describe('admin tools', () => {
  it('settings are validated; commission can be changed but not set to nonsense', async () => {
    for (const bad of [{ commission: { linkBps: 20000 } }, { commission: { linkBps: 1.5 } }, { attribution: { windowDays: 0 } }, { attribution: { policy: 'random' } }, { discountFunding: 'nobody' }, { unknown: 1 }, { commission: { surprise: 1 } }])
      expect((await admin.put('/api/admin/settings').send(bad)).status, JSON.stringify(bad)).toBe(400);
    const ok = await admin.put('/api/admin/settings').send({ commission: { linkBps: 400, marketplaceBps: 1000 }, payoutHoldDays: 3 });
    expect(ok.body.settings.commission).toEqual({ linkBps: 400, marketplaceBps: 1000 }); expect(ok.body.settings.shipping.flatFeePaise).toBe(6500);
    const log = (await admin.get('/api/admin/audit?action=settings')).body.entries[0]; expect(log.details.before.commission.linkBps).toBe(500); expect(log.details.after.commission.linkBps).toBe(400);
  });
  it('coupons, banners and taxonomy are managed by admins with validation', async () => {
    expect((await admin.post('/api/admin/coupons').send({ code: 'big', type: 'percent', value: 95 })).status).toBe(400);
    const c = await admin.post('/api/admin/coupons').send({ code: 'festive20', type: 'percent', value: 20, minOrderPaise: 50000 }); expect(c.status).toBe(201); expect(c.body.coupon.code).toBe('FESTIVE20');
    expect((await admin.post('/api/admin/coupons').send({ code: 'FESTIVE20', type: 'fixed', value: 100 })).status).toBe(409);
    expect((await admin.post('/api/admin/banners').send({ title: 'Diwali', link: 'https://evil.example' })).status).toBe(400);
    expect((await admin.post('/api/admin/banners').send({ title: 'Diwali', link: '/store/rosecraft' })).status).toBe(201);
    expect((await client(ctx.app).get('/api/banners')).body.banners).toHaveLength(1);
    const p = await makeProduct({ extra: { category: 'candles' } });
    const cat = (await admin.get('/api/admin/taxonomy')).body.items.find((t) => t.slug === 'candles');
    expect((await admin.delete(`/api/admin/taxonomy/${cat._id}`)).body.error.code).toBe('in_use'); void p;
    expect((await admin.post('/api/admin/taxonomy').send({ type: 'occasion', name: 'Housewarming' })).body.item.slug).toBe('housewarming');
    expect((await client(ctx.app).get('/api/taxonomy')).body.occasions.map((o) => o.slug)).toContain('housewarming');
  });
  it('dashboard and reports compute from real data', async () => {
    const S = await makeApprovedSeller(ctx.app, admin, 'report'); const p = await makeProduct({ seller: S.seller, pricePaise: 100000 }); await paidOrder(await login(ctx.app), [item(p, 2)]);
    const d = (await admin.get('/api/admin/dashboard')).body; expect(d.sellers.approved).toBe(1); expect(d.last30Days).toMatchObject({ orders: 1, gmvPaise: 200000 }); expect(d.commissionEarnedPaise).toBe(24000);
    expect((await admin.get('/api/admin/reports/sales')).body.totals.orders).toBe(1);
    expect((await admin.get('/api/admin/reports/sellers')).body.sellers[0]).toMatchObject({ orders: 1, commissionPaise: 24000 });
    expect((await admin.get('/api/admin/reports/products')).body.top[0].soldCount).toBe(2);
  });
  it('admin can suspend a customer (not another admin); the session dies immediately', async () => {
    const u = await login(ctx.app); const uid = u.user.id;
    expect((await admin.post(`/api/admin/users/${uid}/suspend`).send({ suspended: true, reason: 'fraud' })).status).toBe(200);
    expect((await u.get('/api/me')).status).toBe(401);
    expect((await admin.post(`/api/admin/users/${(await admin.get('/api/me')).body.user.id}/suspend`).send({ suspended: true, reason: 'self' })).status).toBe(403);
  });
  it('support tickets: customers see only their own; admins can answer; order references are ownership-checked', async () => {
    const A = await makeApprovedSeller(ctx.app, admin, 'alpha'); const p = await makeProduct({ seller: A.seller }); const buyer = await login(ctx.app); const other = await login(ctx.app); const o = await paidOrder(buyer, [item(p)]);
    const t = await buyer.post('/api/support/tickets').send({ subject: 'Where is my order', message: 'Please check', orderNumber: o.orderNumber, type: 'dispute' }); expect(t.status).toBe(201);
    expect((await other.post('/api/support/tickets').send({ subject: 'Snooping', message: 'hello', orderNumber: o.orderNumber })).status).toBe(404);
    expect((await other.get('/api/support/tickets')).body.tickets).toHaveLength(0);
    expect((await other.post(`/api/support/tickets/${t.body.ticket.id}/messages`).send({ text: 'hi' })).status).toBe(404);
    expect((await A.agent.post('/api/support/tickets').send({ subject: 'Dispute', message: 'about my shipment', orderNumber: o.orderNumber })).status).toBe(201); // the seller involved may raise one
    expect((await admin.post(`/api/admin/tickets/${t.body.ticket.id}/messages`).send({ text: 'On it', status: 'resolved' })).body.ticket.status).toBe('resolved');
    expect((await buyer.get('/api/support/tickets')).body.tickets[0].messages.map((m) => m.role)).toEqual(['customer', 'admin']);
  });
  it('wishlist: add, list only live products, remove', async () => {
    const p = await makeProduct(); const draft = await makeProduct({ title: 'Hidden', status: 'draft' }); const a = await login(ctx.app);
    expect((await a.put(`/api/me/wishlist/${p._id}`)).status).toBe(200); expect((await a.put(`/api/me/wishlist/${draft._id}`)).status).toBe(404);
    expect((await a.get('/api/me/wishlist')).body.products.map((x) => x.id)).toEqual([String(p._id)]);
    await a.delete(`/api/me/wishlist/${p._id}`); expect((await a.get('/api/me/wishlist')).body.products).toHaveLength(0);
  });
});
