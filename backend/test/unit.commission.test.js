import { describe, expect, it } from 'vitest';
import { allocate, bpsOf } from '../src/lib/money.js';
import { computeLedger, resolveRate } from '../src/services/commission.js';
import { DEFAULT_SETTINGS as S } from '../src/services/settings.js';

const line = (o = {}) => ({ itemId: 'i1', title: 'x', qty: 1, refundedQty: 0, unitPaise: 100000, discountPaise: 0, rateBps: 500, rateBasis: 'platform_default', ...o });
const settings = (o = {}) => ({ ...S, ...o });

describe('rate precedence', () => {
  const seller = { commissionOverride: { linkBps: 300, marketplaceBps: 900 } };
  it('uses platform defaults: 5% via link, 12% via marketplace', () => {
    expect(resolveRate({ product: {}, seller: {}, source: 'seller_link', settings: S })).toEqual({ bps: 500, basis: 'platform_default' });
    expect(resolveRate({ product: {}, seller: {}, source: 'marketplace', settings: S })).toEqual({ bps: 1200, basis: 'platform_default' });
  });
  it('seller override beats the default, per source', () => {
    expect(resolveRate({ product: {}, seller, source: 'seller_link', settings: S })).toEqual({ bps: 300, basis: 'seller_override' });
    expect(resolveRate({ product: {}, seller, source: 'marketplace', settings: S })).toEqual({ bps: 900, basis: 'seller_override' });
  });
  it('product override beats the seller override and applies to every source; 0% is honoured', () => {
    expect(resolveRate({ product: { commissionOverrideBps: 0 }, seller, source: 'marketplace', settings: S })).toEqual({ bps: 0, basis: 'product_override' });
    expect(resolveRate({ product: { commissionOverrideBps: 750 }, seller, source: 'seller_link', settings: S }).bps).toBe(750);
  });
});

describe('ledger maths (integer paise)', () => {
  it('commission and payable for a simple order, shipping goes to the seller', () => {
    const r = computeLedger({ lines: [line({ qty: 2, unitPaise: 49900 })], shippingPaise: 6000, settings: S });
    expect(r.grossPaise).toBe(99800); expect(r.commissionPaise).toBe(4990); expect(r.sellerPayablePaise).toBe(99800 - 4990 + 6000);
  });
  it('shipping is not commissionable and can go to the platform instead', () => {
    const r = computeLedger({ lines: [line()], shippingPaise: 6000, settings: settings({ shipping: { ...S.shipping, paidTo: 'platform' } }) });
    expect(r.sellerPayablePaise).toBe(100000 - 5000);
  });
  it('rounds half-up per line', () => {
    expect(bpsOf(1, 5000)).toBe(1); expect(bpsOf(1, 4999)).toBe(0); expect(bpsOf(333, 1200)).toBe(40);
    const r = computeLedger({ lines: [line({ unitPaise: 333, rateBps: 1200 }), line({ itemId: 'i2', unitPaise: 333, rateBps: 1200 })], settings: S });
    expect(r.commissionPaise).toBe(80);
  });
  it('coupon discount is paid by the platform by default: seller base is unchanged', () => {
    const r = computeLedger({ lines: [line({ discountPaise: 20000 })], settings: S });
    expect(r.eligiblePaise).toBe(100000); expect(r.commissionPaise).toBe(5000);
  });
  it('seller-funded discount reduces the commission base', () => {
    const r = computeLedger({ lines: [line({ discountPaise: 20000 })], settings: settings({ discountFunding: 'seller' }) });
    expect(r.eligiblePaise).toBe(80000); expect(r.commissionPaise).toBe(4000); expect(r.sellerPayablePaise).toBe(76000);
  });
  it('refunded units leave the base; commission shrinks proportionally', () => {
    const r = computeLedger({ lines: [line({ qty: 4, refundedQty: 1, unitPaise: 10000, rateBps: 1200 })], shippingPaise: 0, settings: S });
    expect(r.grossPaise).toBe(30000); expect(r.commissionPaise).toBe(3600);
  });
  it('a fully refunded shipment returns the shipping too', () => {
    const r = computeLedger({ lines: [line({ qty: 1, refundedQty: 1 })], shippingPaise: 6000, settings: S });
    expect(r.allRefunded).toBe(true); expect(r.sellerPayablePaise).toBe(0); expect(r.shippingPaise).toBe(0);
  });
  it('the estimated gateway fee is deducted only when the seller bears it', () => {
    const base = computeLedger({ lines: [line()], settings: settings({ paymentFee: { bps: 200, bearer: 'platform' } }) });
    const seller = computeLedger({ lines: [line()], settings: settings({ paymentFee: { bps: 200, bearer: 'seller' } }) });
    expect(base.paymentFeePaise).toBe(0); expect(seller.paymentFeePaise).toBe(2000); expect(seller.sellerPayablePaise).toBe(base.sellerPayablePaise - 2000);
  });
  it('a 100% commission never produces a negative payout', () => {
    expect(computeLedger({ lines: [line({ rateBps: 10000 })], settings: S }).sellerPayablePaise).toBe(0);
  });
});

describe('allocate (coupon split)', () => {
  it('never loses or invents a paisa', () => {
    for (const [t, w] of [[100, [1, 1, 1]], [1, [5, 5]], [999, [123, 4567, 89]], [0, [1, 2]], [50, [0, 0]]]) {
      const out = allocate(t, w); expect(out.reduce((a, b) => a + b, 0)).toBe(w.every((x) => x === 0) ? 0 : t);
    }
  });
  it('is proportional', () => expect(allocate(300, [100, 200])).toEqual([100, 200]));
});
