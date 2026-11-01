import { describe, expect, it } from 'vitest';
import { breadcrumbSchema, categoryPath, clip, faqSchema, findCategory, pageTitle, parseQas, productSchema, slugify, websiteSchema } from '../lib/seo';
const S = 'https://shop.test';
describe('seo helpers', () => {
    it('makes clean category URLs', () => {
        expect(slugify('Wall Décor and Handcrafted Art')).toBe('wall-decor-and-handcrafted-art');
        expect(slugify('Diwali Gifts & Festive Hampers')).toBe('diwali-gifts-and-festive-hampers');
        expect(categoryPath({ name: 'Customized Gifts', slug: 'Customized Gifts' })).toBe('/category/customized-gifts');
        expect(categoryPath({ name: 'Customized Gifts', slug: 'custom-gifts' })).toBe('/category/custom-gifts');
    });
    it('finds a category by slug, clean name or old exact name', () => {
        const cats = [{ name: 'Customized Gifts', slug: 'custom-gifts' }, { name: 'Home Décor', slug: 'Home Décor' }];
        expect(findCategory(cats, 'custom-gifts')?.name).toBe('Customized Gifts');
        expect(findCategory(cats, 'home-decor')?.name).toBe('Home Décor');
        expect(findCategory(cats, 'Home Décor')?.name).toBe('Home Décor');
        expect(findCategory(cats, 'nope')).toBeUndefined();
    });
    it('keeps titles short and descriptions at a word boundary', () => {
        expect(pageTitle('Customized Gifts').endsWith('| Upahars')).toBe(true);
        expect(pageTitle('A very long product name that goes on and on and on forever and ever amen').length).toBeLessThanOrEqual(71);
        const c = clip('word '.repeat(80), 100);
        expect(c.length).toBeLessThanOrEqual(100);
        expect(c.endsWith('…')).toBe(true);
        expect(clip('<b>Short</b> text', 50)).toBe('Short text');
    });
});
describe('schema.org', () => {
    const p = { id: 'p1', slug: 'jasmine-candle', name: 'Jasmine Candle', category: 'Candles', price: 499, salePrice: 399, inStock: true, images: ['https://img.test/a.jpg', '/rel.jpg'], description: 'Soy wax.', specs: { packQty: 6, weightGrams: 300, heightCm: 9, widthCm: 8, lengthCm: 8 } };
    it('describes a product with price, stock, size and weight, and never invents ratings', () => {
        const s = productSchema(p, S);
        expect(s['@type']).toBe('Product');
        expect(s.offers).toMatchObject({ priceCurrency: 'INR', price: '399.00', availability: 'https://schema.org/InStock', url: `${S}/product/jasmine-candle` });
        expect(s.image).toEqual(['https://img.test/a.jpg', `${S}/rel.jpg`]);
        expect(s.weight).toMatchObject({ value: 300, unitCode: 'GRM' });
        expect(s.height).toMatchObject({ value: 9, unitCode: 'CMT' });
        expect(s.additionalProperty[0]).toMatchObject({ name: 'Pieces in pack', value: 6 });
        expect(s.aggregateRating).toBeUndefined();
        expect(productSchema({ ...p, inStock: false }, S).offers.availability).toBe('https://schema.org/OutOfStock');
    });
    it('builds breadcrumbs, a search box and FAQ markup', () => {
        const b = breadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'Candles', path: '/category/candles' }], S);
        expect(b.itemListElement[1]).toMatchObject({ position: 2, item: `${S}/category/candles` });
        expect(websiteSchema(S).potentialAction.target.urlTemplate).toBe(`${S}/search?q={search_term_string}`);
        const qas = parseQas(['How long does delivery take? Usually 4-7 days.', 'No question here']);
        expect(qas).toEqual([['How long does delivery take?', 'Usually 4-7 days.']]);
        expect(faqSchema(qas).mainEntity[0].acceptedAnswer.text).toBe('Usually 4-7 days.');
    });
});
