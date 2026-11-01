import { api } from './api';
import { CATEGORY_ICONS } from '../data/demo';
const PALETTE = [['#F5D9A8', '#C58F3C'], ['#FBD38D', '#DD6B20'], ['#FEB2B2', '#9B1B24'], ['#C6F6D5', '#2F855A'], ['#E9D8FD', '#6B46C1'], ['#BEE3F8', '#2B6CB0'], ['#FED7E2', '#B83280']];
const TYPE_EMOJI = { candle: '🕯️', hamper: '🎁', gift_box: '🎀', handmade: '🧵', decor: '🏠', personalized: '✨', other: '🎁' };
const KNOWN_TAGS = ['trending', 'best', 'custom', 'hamper', 'diwali', 'candle'];
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
export const rupees = (paise) => Math.round(paise) / 100;
export function toCatalogProduct(p, categoryName) {
    const [from, to] = PALETTE[hash(p.id) % PALETTE.length];
    const tags = new Set(p.tags.map((t) => t.toLowerCase()).filter((t) => KNOWN_TAGS.includes(t)));
    if (p.productType === 'candle')
        tags.add('candle');
    if (p.productType === 'hamper' || p.productType === 'gift_box')
        tags.add('hamper');
    if (p.isCustomizable)
        tags.add('custom');
    if (p.occasions.includes('diwali'))
        tags.add('diwali');
    const onSale = p.compareAtPaise != null && p.compareAtPaise > p.pricePaise;
    return {
        id: p.id, slug: p.slug, name: p.title, category: categoryName(p.category),
        price: rupees(onSale ? p.compareAtPaise : p.pricePaise), salePrice: onSale ? rupees(p.pricePaise) : undefined,
        rating: 0, reviews: 0, emoji: TYPE_EMOJI[p.productType] ?? '🎁', from, to, tags: [...tags],
        image: p.images[0], images: p.images,
        specs: { packQty: p.packQuantity ?? 1, weightGrams: p.shipping?.weightGrams ?? 0, lengthCm: p.shipping?.lengthCm ?? 0, widthCm: p.shipping?.widthCm ?? 0, heightCm: p.shipping?.heightCm ?? 0, processingDays: p.shipping?.processingDays ?? 0 },
        lowStock: p.lowStock ?? null, description: p.description, customizable: p.isCustomizable, live: true, inStock: p.inStock,
    };
}
/** Throws when the server cannot be reached, so the storefront can fall back to its built-in sample catalogue. */
export async function loadLiveCatalog() {
    const [tax, first, offers, banners, showcase] = await Promise.all([
        api('/taxonomy'),
        api('/products?limit=48&sort=popular'),
        api('/offers').catch(() => ({ offers: [] })),
        api('/banners').catch(() => ({ banners: [] })),
        api('/showcase').catch(() => ({ showcase: [] })),
    ]);
    const rows = [...first.products];
    for (let pg = 2; pg <= Math.min(first.pages, 10); pg++)
        rows.push(...(await api(`/products?limit=48&sort=popular&page=${pg}`)).products);
    const names = new Map(tax.categories.map((c) => [c.slug, c.name]));
    return {
        products: rows.map((p) => toCatalogProduct(p, (slug) => names.get(slug) ?? slug)),
        categories: tax.categories.map((c) => ({ ...c, icon: CATEGORY_ICONS[c.name] ?? '🎁' })),
        offers: offers.offers, banners: banners.banners, showcase: showcase.showcase,
    };
}
export const describeOffer = (o) => (o.type === 'percent' ? `${o.value}% off` : `₹${rupees(o.value)} off`);
