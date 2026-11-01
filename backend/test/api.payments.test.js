import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADDRESS, login, resetDb, seedTaxonomy, startApp, stockOf, stopDb, makeProduct } from './helpers.js';
import { Order } from '../src/models/index.js';

let ctx;
beforeAll(async () => { ctx = await startApp(); });
afterAll(stopDb);
beforeEach(resetDb);

describe('payment edge cases', () => {
  it('a payment that still goes through after the customer cancelled is refunded — once, and never turns into an order', async () => {
    await seedTaxonomy(); const p = await makeProduct(); const a = await login(ctx.app);
    const r = await a.post('/api/orders/checkout').send({ items: [{ productId: String(p._id), qty: 1 }], address: ADDRESS });
    expect(r.status).toBe(201); const n = r.body.order.orderNumber;
    expect((await a.post(`/api/orders/${n}/cancel`).send({})).status).toBe(200);
    expect(await stockOf(p)).toBe(10); // stock released by the cancel

    const sim = ctx.provider._simulate(r.body.payment.providerOrderId); // customer pays in the still-open payment window
    const v1 = await a.post('/api/payments/verify').send({ orderNumber: n, ...sim });
    expect(v1.status).toBe(200); expect(v1.body.order.status).toBe('cancelled'); expect(v1.body.order.payment.status).toBe('refunded');
    const o1 = await Order.findOne({ orderNumber: n });
    expect(o1.refundedPaise).toBe(o1.payment.amountPaise); expect(o1.history.some((h) => h.action === 'payment_after_cancel_refunded')).toBe(true);

    const v2 = await a.post('/api/payments/verify').send({ orderNumber: n, ...sim }); // retry / webhook replay
    expect(v2.status).toBe(200);
    expect((await Order.findOne({ orderNumber: n })).refundedPaise).toBe(o1.payment.amountPaise); // not refunded twice
    expect(await stockOf(p)).toBe(10); // and no stock was taken
  });

  it('the checkout reply tells the browser how to open the payment window', async () => {
    await seedTaxonomy(); const p = await makeProduct(); const a = await login(ctx.app);
    const r = await a.post('/api/orders/checkout').set('Idempotency-Key', 'key-12345678').send({ items: [{ productId: String(p._id), qty: 1 }], address: ADDRESS });
    expect(r.body.payment).toMatchObject({ provider: 'mock', currency: 'INR', amountPaise: r.body.order.totals.totalPaise });
    expect(r.body.payment.providerOrderId).toMatch(/^order_/);
    const again = await a.post('/api/orders/checkout').set('Idempotency-Key', 'key-12345678').send({ items: [{ productId: String(p._id), qty: 1 }], address: ADDRESS });
    expect(again.status).toBe(200); expect(again.body.order.orderNumber).toBe(r.body.order.orderNumber); // "Pay again" re-uses the same order
    expect(again.body.payment.providerOrderId).toBe(r.body.payment.providerOrderId);
  });
});
