import { afterEach, describe, expect, it, vi } from 'vitest';
import { CartProblem, paiseToInr, toServerItems } from '../lib/orders';
afterEach(() => vi.unstubAllGlobals());
describe('connecting the cart to the server catalogue', () => {
    it('matches cart lines to server products by title, picks an in-stock variant, and carries the personalization note', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ products: [
                    { id: 'p1', title: 'Jasmine Soy Wax Jar Candle', inStock: true, variants: [] },
                    { id: 'p2', title: 'Photo Frame', inStock: true, variants: [{ id: 'v1', name: 'S', inStock: false }, { id: 'v2', name: 'L', inStock: true }] },
                ] }) }));
        const items = await toServerItems([
            { product: { name: 'jasmine soy wax jar candle' }, qty: 2 },
            { product: { name: 'Photo Frame' }, qty: 1, note: 'Asha' },
        ]);
        expect(items).toEqual([{ productId: 'p1', qty: 2 }, { productId: 'p2', variantId: 'v2', qty: 1, customization: 'Asha' }]);
    });
    it('explains plainly when a product is not sold online yet', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ products: [] }) }));
        await expect(toServerItems([{ product: { name: 'Mystery' }, qty: 1 }])).rejects.toBeInstanceOf(CartProblem);
    });
});
describe('money', () => {
    it('formats paise as rupees', () => { expect(paiseToInr(89900)).toContain('899'); expect(paiseToInr(150)).toContain('1.50'); });
});
