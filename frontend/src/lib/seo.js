/* SEO helpers: site config, clean URLs and schema.org (JSON-LD) builders. Pure functions: easy to test. */
import { BRAND } from './brand';

/** Public address of the website. Set VITE_SITE_URL (no trailing slash) in the hosting dashboard before launch. */
export const SITE_URL = (import.meta.env?.VITE_SITE_URL || (typeof window !== 'undefined' ? window.location.origin : 'https://upahars.in')).replace(/\/$/, '');
export const SITE_NAME = BRAND.name;
export const DEFAULT_TITLE = 'Upahars: Handmade Gifts, Customized Gifts, Hampers & Candles from Odisha';
export const DEFAULT_DESCRIPTION = 'Shop handmade and customized gifts, festive hampers, scented candles and home décor made by Odisha artisans. Personalize gifts, order in bulk, and get delivery across India.';
export const DEFAULT_IMAGE = BRAND.logo;

export const abs = (pathOrUrl, site = SITE_URL) => (!pathOrUrl ? '' : /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${site}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`);

/** "Wall Décor & Handcrafted Art" -> "wall-decor-handcrafted-art" */
export const slugify = (s) => String(s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Clean, keyword-friendly address of a category page: /category/customized-gifts */
export const categoryPath = (cat) => `/category/${cat?.slug && !/\s/.test(cat.slug) ? cat.slug : slugify(cat?.name ?? cat)}`;
export const productPath = (p) => `/product/${p.slug}`;
/** Find a category from a URL slug (or, for old links, from its exact name). */
export const findCategory = (categories, wanted) => {
    if (!wanted)
        return undefined;
    const w = String(wanted);
    return categories.find((c) => c.slug === w || slugify(c.name) === slugify(w) || c.name === w);
};

/** Cut text at a word boundary, add an ellipsis only when something was removed. */
export function clip(text, max) {
    const t = String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (t.length <= max)
        return t;
    const cut = t.slice(0, max - 1);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6)).replace(/[\s,.;:–-]+$/, '')}…`;
}
/** Google shows about 60 characters of a title. The brand name is added only if it fits. */
export function pageTitle(t) {
    const base = clip(t, 70);
    if (!base)
        return DEFAULT_TITLE;
    if (/upahars/i.test(base))
        return base;
    const full = `${base} | ${SITE_NAME}`;
    return full.length <= 62 ? full : base;
}

/* ---------- schema.org builders ---------- */
const ctx = 'https://schema.org';
const realContact = (v) => v && !/example|00000-00000/i.test(v);
export function organizationSchema(site = SITE_URL) {
    const sameAs = (BRAND.social ?? []).filter(Boolean);
    return {
        '@context': ctx, '@type': 'Organization', '@id': `${site}/#organization`, name: BRAND.name, legalName: BRAND.legalName, url: site,
        logo: abs(BRAND.logo, site), slogan: BRAND.tagline,
        areaServed: { '@type': 'Country', name: 'India' },
        address: { '@type': 'PostalAddress', addressRegion: 'Odisha', addressCountry: 'IN' },
        ...(realContact(BRAND.supportEmail) || realContact(BRAND.supportPhone) ? {
            contactPoint: { '@type': 'ContactPoint', contactType: 'customer support', areaServed: 'IN', availableLanguage: ['English', 'Hindi', 'Odia'], ...(realContact(BRAND.supportEmail) ? { email: BRAND.supportEmail } : {}), ...(realContact(BRAND.supportPhone) ? { telephone: BRAND.supportPhone } : {}) },
        } : {}),
        ...(sameAs.length ? { sameAs } : {}),
    };
}
export const websiteSchema = (site = SITE_URL) => ({
    '@context': ctx, '@type': 'WebSite', '@id': `${site}/#website`, url: site, name: BRAND.name, inLanguage: 'en-IN', publisher: { '@id': `${site}/#organization` },
    potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: `${site}/search?q={search_term_string}` }, 'query-input': 'required name=search_term_string' },
});
export const breadcrumbSchema = (items, site = SITE_URL) => ({
    '@context': ctx, '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: abs(it.path, site) })),
});
const qv = (value, unitCode) => ({ '@type': 'QuantitativeValue', value: Math.round(value * 100) / 100, unitCode });
export function productSchema(p, site = SITE_URL) {
    const price = p.salePrice ?? p.price;
    const s = p.specs ?? {};
    const images = (p.images?.length ? p.images : p.image ? [p.image] : []).map((u) => abs(u, site));
    return {
        '@context': ctx, '@type': 'Product', '@id': `${abs(productPath(p), site)}#product`, name: p.name,
        description: clip(p.description || `${p.name}: ${p.category} by ${BRAND.name}.`, 500),
        ...(images.length ? { image: images } : {}), sku: String(p.id), category: p.category,
        brand: { '@type': 'Brand', name: BRAND.name },
        ...(s.weightGrams > 0 ? { weight: qv(s.weightGrams, 'GRM') } : {}),
        ...(s.heightCm > 0 ? { height: qv(s.heightCm, 'CMT') } : {}),
        ...(s.widthCm > 0 ? { width: qv(s.widthCm, 'CMT') } : {}),
        ...(s.lengthCm > 0 ? { depth: qv(s.lengthCm, 'CMT') } : {}),
        ...(s.packQty > 1 ? { additionalProperty: [{ '@type': 'PropertyValue', name: 'Pieces in pack', value: s.packQty }] } : {}),
        offers: {
            '@type': 'Offer', url: abs(productPath(p), site), priceCurrency: 'INR', price: Number(price).toFixed(2),
            availability: p.inStock === false ? `${ctx}/OutOfStock` : `${ctx}/InStock`, itemCondition: `${ctx}/NewCondition`,
            seller: { '@id': `${site}/#organization` },
        },
        // No aggregateRating on purpose: Google penalises ratings that are not real, collected reviews.
    };
}
export function collectionSchema({ name, description, path, products }, site = SITE_URL) {
    return {
        '@context': ctx, '@type': 'CollectionPage', name, description, url: abs(path, site), isPartOf: { '@id': `${site}/#website` },
        mainEntity: { '@type': 'ItemList', numberOfItems: products.length, itemListElement: products.slice(0, 24).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(productPath(p), site), name: p.name })) },
    };
}
export const faqSchema = (qas) => ({
    '@context': ctx, '@type': 'FAQPage',
    mainEntity: qas.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
});
/** Split "Question? Answer." lines into [question, answer] pairs. */
export const parseQas = (lines) => lines.map((l) => { const i = l.indexOf('?'); return i > 0 ? [l.slice(0, i + 1).trim(), l.slice(i + 1).trim()] : null; }).filter((x) => x && x[1]);
