import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { abs, DEFAULT_DESCRIPTION, DEFAULT_IMAGE, DEFAULT_TITLE, clip, pageTitle, SITE_NAME } from '../lib/seo';

const setMeta = (attr, key, content) => {
    let el = document.head.querySelector(`meta[${attr}="${key}"]`);
    if (!content) {
        el?.remove();
        return;
    }
    if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, key);
        document.head.appendChild(el);
    }
    el.setAttribute('content', content);
};
const setCanonical = (href) => {
    let el = document.head.querySelector('link[rel="canonical"]');
    if (!href) {
        el?.remove();
        return;
    }
    if (!el) {
        el = document.createElement('link');
        el.setAttribute('rel', 'canonical');
        document.head.appendChild(el);
    }
    el.setAttribute('href', href);
};
/** `<` is escaped so text from the catalogue can never close the script tag. */
const setJsonLd = (schema) => {
    const id = 'seo-jsonld';
    let el = document.getElementById(id);
    const list = [schema].flat().filter(Boolean);
    if (!list.length) {
        el?.remove();
        return;
    }
    if (!el) {
        el = document.createElement('script');
        el.id = id;
        el.type = 'application/ld+json';
        document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(list.length === 1 ? list[0] : list).replace(/</g, '\\u003c');
};

/** Write the page's <title>, description, canonical, robots, Open Graph / Twitter tags and JSON-LD into <head>. */
export function applySeo({ title, description, path, image, type = 'website', noindex = false, schema } = {}) {
    if (typeof document === 'undefined')
        return;
    const t = title ? pageTitle(title) : DEFAULT_TITLE;
    const d = clip(description || DEFAULT_DESCRIPTION, 158);
    const url = path === undefined ? '' : abs(path);
    document.title = t;
    setMeta('name', 'description', d);
    setMeta('name', 'robots', noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large, max-snippet:-1');
    setCanonical(noindex ? '' : url);
    setMeta('property', 'og:site_name', SITE_NAME);
    setMeta('property', 'og:type', type);
    setMeta('property', 'og:title', t);
    setMeta('property', 'og:description', d);
    setMeta('property', 'og:url', url);
    setMeta('property', 'og:image', abs(image || DEFAULT_IMAGE));
    setMeta('property', 'og:locale', 'en_IN');
    setMeta('name', 'twitter:card', 'summary_large_image');
    setMeta('name', 'twitter:title', t);
    setMeta('name', 'twitter:description', d);
    setMeta('name', 'twitter:image', abs(image || DEFAULT_IMAGE));
    setJsonLd(schema);
}
/** Call once per page. Re-applies only when the values change. */
export function useSeo(opts) {
    const key = JSON.stringify(opts);
    useEffect(() => { applySeo(opts); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/* Pages that have fixed text. Pages with data (product, category, FAQ...) call useSeo themselves. */
const STATIC = {
    '/': { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, path: '/' },
    '/categories': { title: 'Shop Handmade Gifts by Category', description: 'Browse handmade décor, scented candles, customized gifts, festive hampers and eco-friendly gifts from Odisha artisans. Delivery across India.', path: '/categories' },
    '/bulk-orders': { title: 'Bulk & Corporate Gifting: Get a Quotation', description: 'Order candles, gift boxes and hampers in bulk with custom branding for weddings, festivals and corporate gifting. Request a quotation in minutes.', path: '/bulk-orders' },
    '/terms-and-conditions': { title: 'Terms and Conditions', description: 'Read the terms for shopping on Upahars: accounts, orders, payments, shipping, returns and more.', path: '/terms-and-conditions' },
};
/** Private or utility pages that must never appear in Google. */
const PRIVATE = [[/^\/admin/, 'Admin'], [/^\/cart/, 'Your cart'], [/^\/checkout/, 'Checkout'], [/^\/account/, 'My account'], [/^\/order\//, 'Order details']];
/** Owned by the page component itself. */
const SELF = [/^\/search/, /^\/product\//, /^\/category\//, /^\/about$/, /^\/contact$/, /^\/faq$/, /^\/shipping-policy$/, /^\/return-policy$/, /^\/privacy-policy$/];
export function RouteSeo() {
    const { pathname, search } = useLocation();
    const priv = PRIVATE.find(([r]) => r.test(pathname))?.[1] ?? '';
    const own = SELF.some((r) => r.test(pathname)) || (pathname === '/categories' && /[?&]name=/.test(search));
    const fixed = !priv && !own ? STATIC[pathname.replace(/\/$/, '') || '/'] : undefined;
    useEffect(() => {
        if (priv)
            applySeo({ title: priv, noindex: true });
        else if (fixed)
            applySeo(fixed);
    }, [priv, fixed]);
    return null;
}
export default RouteSeo;
