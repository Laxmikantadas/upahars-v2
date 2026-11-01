# SEO guide for Upahars

## Before you launch (5 minutes)
1. In your hosting dashboard (Vercel) set `VITE_SITE_URL` to your real address, e.g. `https://www.upahars.in` (no trailing slash).
2. Set `VITE_API_BASE` to your API address so `sitemap.xml` also lists every product and category.
3. Put your real email, phone and address in `frontend/src/lib/brand.js`, and add your Instagram / Facebook links to `social: []`.
4. Deploy, then open Google Search Console, add your site, and submit `https://your-site/sitemap.xml`.
5. Use "URL Inspection" on your home page and one product page, and press "Request indexing".

## What is already done
- **Titles and descriptions:** every page has its own title (about 60 characters) and description (about 155 characters).
- **Canonical links:** each page names its one official address, so duplicates do not compete.
- **Clean category addresses:** `/category/customized-gifts`. The old `/categories?name=...` links still work and point Google to the clean address.
- **Social previews:** Open Graph and Twitter tags (WhatsApp, Facebook, X, LinkedIn).
- **Structured data (JSON-LD):** Organization and WebSite with a search box (all pages), Product with price, stock, weight, size and pack quantity, BreadcrumbList, category CollectionPage and FAQPage.
- **Kept out of Google:** admin, cart, checkout, account, orders, search results, not-found pages and the demo sample products.
- **sitemap.xml and robots.txt:** created automatically by `npm run build`.

## Good to know
- Product ratings are NOT put in the schema, because Google only allows real customer reviews. Add `aggregateRating` once you collect them.
- This is a client-side React app. Google runs JavaScript and reads all of the above. WhatsApp, Facebook and X do not run JavaScript, so a shared product link shows the home-page preview. Pre-rendering fixes that if you need it.
- Replace the logo preview image with a 1200 × 630 picture for better social cards (`DEFAULT_IMAGE` in `src/lib/seo.js` and the two image tags in `index.html`).
- Write a real, unique description for every product in the admin. It becomes the Google snippet.
