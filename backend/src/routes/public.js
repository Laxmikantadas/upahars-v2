import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { Banner, Coupon, Product, Seller, Showcase, Taxonomy } from '../models/index.js';
import { escapeRegex, publicFilter, publicProducts, sellerBadge, sellerIsActive } from '../services/catalog.js';
import { getSettings } from '../services/settings.js';
import { ATTR_COOKIE, cookieOptions, readAttribution, recordTouch } from '../services/attribution.js';

const listQuery = z.object({
  q: z.string().trim().max(60).optional(), category: z.string().max(60).optional(), occasion: z.string().max(60).optional(),
  collection: z.string().max(60).optional(), type: z.string().max(20).optional(), seller: z.string().max(60).optional(),
  owner: z.enum(['upahars', 'seller']).optional(),
  minPaise: z.coerce.number().int().min(0).optional(), maxPaise: z.coerce.number().int().min(0).optional(),
  sort: z.enum(['new', 'price_asc', 'price_desc', 'popular']).default('new'),
  page: z.coerce.number().int().min(1).max(500).default(1), limit: z.coerce.number().int().min(1).max(48).default(24),
});
const SORTS = { new: { publishedAt: -1 }, price_asc: { pricePaise: 1 }, price_desc: { pricePaise: -1 }, popular: { soldCount: -1 } };

export default function publicRoutes({ config, limits }) {
  const r = Router();

  r.get('/taxonomy', asyncHandler(async (_req, res) => {
    const rows = await Taxonomy.find({ isActive: true }).sort({ sortOrder: 1, name: 1 }).lean();
    const view = (t) => ({ name: t.name, slug: t.slug, description: t.description, image: t.image?.url ?? null });
    res.json({ categories: rows.filter((t) => t.type === 'category').map(view), occasions: rows.filter((t) => t.type === 'occasion').map(view), collections: rows.filter((t) => t.type === 'collection').map(view) });
  }));

  r.get('/banners', asyncHandler(async (_req, res) => {
    const rows = await Banner.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
    res.json({ banners: rows.map((b) => ({ id: String(b._id), title: b.title, subtitle: b.subtitle, image: b.image?.url ?? null, link: b.link, placement: b.placement })) });
  }));

  // Polaroid carousel under the hero: only active entries, in the order the administrator chose.
  r.get('/showcase', asyncHandler(async (_req, res) => {
    const rows = await Showcase.find({ isActive: true }).sort({ sortOrder: 1, createdAt: 1 }).limit(24).lean();
    res.json({ showcase: rows.map((s) => ({ id: String(s._id), title: s.title, caption: s.caption, image: s.image?.url ?? null })) });
  }));

  // Offers the administrator chose to show on the storefront. Coupons are always re-checked by the server at checkout.
  r.get('/offers', asyncHandler(async (_req, res) => {
    const now = new Date();
    const rows = await Coupon.find({ isActive: true, isPublic: true, $and: [{ $or: [{ startsAt: null }, { startsAt: { $lte: now } }] }, { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] }] }).sort({ createdAt: -1 }).limit(12).lean();
    res.json({ offers: rows.filter((c) => c.usageLimit == null || c.usedCount < c.usageLimit).map((c) => ({ code: c.code, title: c.title, description: c.description, type: c.type, value: c.value, minOrderPaise: c.minOrderPaise, maxDiscountPaise: c.maxDiscountPaise, endsAt: c.endsAt })) });
  }));

  r.get('/products', validate(listQuery, 'query'), asyncHandler(async (req, res) => {
    const q = req.query; const f = publicFilter();
    if (q.category) f.category = q.category;
    if (q.occasion) f.occasions = q.occasion;
    if (q.collection) f.collections = q.collection;
    if (q.type) f.productType = q.type;
    if (q.owner) f.ownerType = q.owner;
    if (q.seller) {
      const s = await Seller.findOne({ 'store.slug': q.seller.toLowerCase() }).lean();
      if (!s || !sellerIsActive(s)) return res.json({ products: [], total: 0, page: q.page, pages: 0 });
      f.sellerId = s._id;
    }
    if (q.minPaise != null || q.maxPaise != null) f.pricePaise = { ...(q.minPaise != null && { $gte: q.minPaise }), ...(q.maxPaise != null && { $lte: q.maxPaise }) };
    if (q.q) { const rx = { $regex: escapeRegex(q.q), $options: 'i' }; f.$or = [{ title: rx }, { tags: rx }]; }
    const [total, docs] = await Promise.all([Product.countDocuments(f), Product.find(f).sort(SORTS[q.sort]).skip((q.page - 1) * q.limit).limit(q.limit).lean()]);
    res.json({ products: await publicProducts(docs), total, page: q.page, pages: Math.ceil(total / q.limit) });
  }));

  r.get('/products/:slug', asyncHandler(async (req, res) => {
    const p = await Product.findOne({ slug: req.params.slug, ...publicFilter() }).lean();
    if (!p) throw notFound('Product not found');
    res.json({ product: (await publicProducts([p]))[0] });
  }));

  const storeView = (s) => ({
    slug: s.store.slug, storeName: s.store.storeName, tagline: s.store.tagline, description: s.store.description,
    logo: s.store.logo?.url ?? null, banner: s.store.banner?.url ?? null, city: s.application.city, shipsFrom: s.store.shipsFrom,
    processingDays: s.store.processingDays, shippingNote: s.store.shippingNote, isPaused: s.store.isPaused,
    verified: Boolean(s.verification?.verified), // only true after an administrator verified the seller
  });
  r.get('/stores', asyncHandler(async (_req, res) => {
    const rows = await Seller.find({ status: 'approved', 'store.isPaused': false }).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ stores: rows.map(storeView) });
  }));
  r.get('/stores/:slug', asyncHandler(async (req, res) => {
    const s = await Seller.findOne({ 'store.slug': req.params.slug.toLowerCase() }).lean();
    if (!s || s.status !== 'approved') throw notFound('Store not found');
    res.json({ store: storeView(s) });
  }));

  // ── attribution ──
  r.post('/attribution/touch', limits.touch, validate(z.object({ ref: z.string().trim().min(2).max(60), landingPath: z.string().max(300).optional() }).strict()), asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const { cookie, applied } = await recordTouch({
      config, settings, slug: req.body.ref, landingPath: req.body.landingPath, referrer: req.get('referer'), ip: req.ip, ua: req.get('user-agent'),
      userId: req.user?._id, existingCookie: req.cookies?.[ATTR_COOKIE],
    });
    if (cookie) res.cookie(ATTR_COOKIE, cookie, cookieOptions(config, settings.attribution.windowDays));
    res.json({ ok: true, applied });
  }));
  r.get('/attribution/current', asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const p = readAttribution(config.attributionSecret, req.cookies?.[ATTR_COOKIE], { windowDays: settings.attribution.windowDays });
    const s = p && (await Seller.findById(p.s).lean());
    res.json({ active: Boolean(s && sellerIsActive(s)), store: s && sellerIsActive(s) ? sellerBadge(s) : null });
  }));
  return r;
}
export { badRequest };
