// Writes public/sitemap.xml and public/robots.txt before every build (npm run build runs it automatically).
// Product and category pages are added when the API can be reached (set VITE_API_BASE to your API address);
// otherwise only the fixed pages are listed, and the build never fails because of it.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...(existsSync(join(root, '.env')) ? Object.fromEntries(readFileSync(join(root, '.env'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])) : {}), ...process.env };
const SITE = (env.VITE_SITE_URL || 'https://upahars.in').replace(/\/$/, '');
const API = (env.VITE_API_BASE || env.VITE_API_TARGET || '').replace(/\/$/, '');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const slugify = (s) => String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const urls = [
  ['/', 'daily', '1.0'], ['/categories', 'daily', '0.9'], ['/bulk-orders', 'monthly', '0.6'],
  ['/about', 'monthly', '0.5'], ['/contact', 'monthly', '0.5'], ['/faq', 'monthly', '0.5'],
  ['/shipping-policy', 'yearly', '0.3'], ['/return-policy', 'yearly', '0.3'], ['/privacy-policy', 'yearly', '0.3'], ['/terms-and-conditions', 'yearly', '0.3'],
].map(([path, changefreq, priority]) => ({ path, changefreq, priority }));

async function getJson(p) {
  const r = await fetch(`${API}/api${p}`, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${p} -> ${r.status}`);
  return r.json();
}
let note = 'fixed pages only (API not reachable or VITE_API_BASE not set)';
if (API) {
  try {
    const tax = await getJson('/taxonomy');
    for (const c of tax.categories) urls.push({ path: `/category/${c.slug && !/\s/.test(c.slug) ? c.slug : slugify(c.name)}`, changefreq: 'daily', priority: '0.8' });
    let page = 1, pages = 1, count = 0;
    do {
      const r = await getJson(`/products?limit=48&page=${page}`);
      pages = Math.min(r.pages ?? 1, 200);
      for (const p of r.products) { urls.push({ path: `/product/${p.slug}`, changefreq: 'weekly', priority: '0.7', lastmod: p.createdAt?.slice(0, 10) }); count++; }
      page++;
    } while (page <= pages);
    note = `${tax.categories.length} categories and ${count} products from the API`;
  } catch (e) {
    console.warn(`[seo] could not read the API (${e.message}); sitemap lists fixed pages only.`);
  }
}
const today = new Date().toISOString().slice(0, 10);
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(SITE + u.path)}</loc><lastmod>${u.lastmod || today}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join('\n')}\n</urlset>\n`;
const robots = `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /cart\nDisallow: /checkout\nDisallow: /account\nDisallow: /order/\nDisallow: /search\nDisallow: /api/\n\nSitemap: ${SITE}/sitemap.xml\n`;
mkdirSync(join(root, 'public'), { recursive: true });
writeFileSync(join(root, 'public/sitemap.xml'), xml);
writeFileSync(join(root, 'public/robots.txt'), robots);
console.log(`[seo] sitemap.xml: ${urls.length} URLs (${note}); robots.txt written for ${SITE}`);
