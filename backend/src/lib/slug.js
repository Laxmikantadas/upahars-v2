export const RESERVED_SLUGS = new Set([
  'admin', 'api', 'store', 'stores', 'seller', 'sellers', 'cart', 'checkout', 'login', 'logout', 'account', 'orders', 'order',
  'product', 'products', 'categories', 'category', 'search', 'about', 'contact', 'faq', 'help', 'support', 'terms', 'privacy',
  'www', 'static', 'assets', 'upahars', 'official', 'wishlist', 'bulk-orders', 'hampers', 'new', 'null', 'undefined',
]);
export const slugify = (s) =>
  String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
export const isValidSlug = (s) => /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/.test(s);
