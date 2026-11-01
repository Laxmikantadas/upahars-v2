import { describe, expect, it } from 'vitest';
import { formatCm, formatWeight, productFacts } from '../lib/specs';
describe('product details', () => {
    it('formats weight in grams or kilograms', () => {
        expect(formatWeight(450)).toBe('450 g');
        expect(formatWeight(1500)).toBe('1.5 kg');
        expect(formatWeight(0)).toBe('');
    });
    it('formats centimetres and hides empty values', () => {
        expect(formatCm(12.5)).toBe('12.5 cm');
        expect(formatCm(0)).toBe('');
    });
    it('lists only the facts the shop filled in', () => {
        const rows = productFacts({ specs: { packQty: 12, weightGrams: 900, heightCm: 8, lengthCm: 20, widthCm: 0, processingDays: 3 } });
        expect(rows).toEqual([['Quantity in 1 pack', '12 pieces'], ['Weight', '900 g'], ['Height', '8 cm'], ['Length', '20 cm'], ['Ready to ship in', '3 days']]);
        expect(productFacts({})).toEqual([]);
    });
});
