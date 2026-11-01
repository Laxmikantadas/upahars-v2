import { describe, expect, it } from 'vitest';
import { computeTotals, GIFT_WRAP_FEE, SHIPPING_FEE } from '../lib/pricing';
const line = (unitPrice, qty = 1) => ({ unitPrice, qty });
describe('computeTotals', () => {
    it('adds shipping below ₹999 and waives it above', () => {
        expect(computeTotals([line(500)]).shipping).toBe(SHIPPING_FEE);
        expect(computeTotals([line(500, 2)]).shipping).toBe(0);
    });
    it('charges ₹65 below ₹699 and delivers free from exactly ₹699', () => {
        expect(SHIPPING_FEE).toBe(65);
        expect(computeTotals([line(698)]).shipping).toBe(65);
        expect(computeTotals([line(699)]).shipping).toBe(0);
        expect(computeTotals([line(700)]).total).toBe(700);
    });
    it('returns zeros for an empty cart', () => {
        expect(computeTotals([], 'FREEWRAP', true).total).toBe(0);
    });
    it('applies DEMODIWALI15 only above the minimum', () => {
        expect(computeTotals([line(900)], 'DEMODIWALI15').couponError).toMatch(/more/);
        const t = computeTotals([line(1000)], 'DEMODIWALI15');
        expect(t.discount).toBe(150);
        expect(t.total).toBe(850); // 850 is above the ₹699 free-shipping threshold
    });
    it('applies DEMOFIRST100 and is case/space tolerant', () => {
        const t = computeTotals([line(600)], '  demofirst100 ');
        expect(t.discount).toBe(100);
        expect(t.couponApplied).toBe('DEMOFIRST100');
    });
    it('FREEWRAP needs gift wrap ticked, then waives the fee', () => {
        expect(computeTotals([line(1200)], 'FREEWRAP', false).couponError).toBeDefined();
        const t = computeTotals([line(1200)], 'FREEWRAP', true);
        expect(t.wrap).toBe(0);
        expect(t.total).toBe(1200);
    });
    it('charges gift wrap normally', () => {
        expect(computeTotals([line(1200)], '', true).total).toBe(1200 + GIFT_WRAP_FEE);
    });
    it('rejects unknown coupons without changing totals', () => {
        const t = computeTotals([line(1200)], 'NOPE');
        expect(t.couponError).toBe('Invalid coupon code');
        expect(t.discount).toBe(0);
    });
});
