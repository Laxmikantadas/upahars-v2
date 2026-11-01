import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { isValidSlug, slugify } from '../lib/slug.js';
import { parseOwnedImage, siteFolder, originalsFolder, sellerFolder } from '../lib/cloudinary.js';
import { validate } from '../lib/validate.js';
import { AuditLog, Banner, Coupon, Inventory, Ledger, Order, Payout, Product, Seller, Showcase, Taxonomy, Ticket, Touch, User } from '../models/index.js';
import { requireAdmin } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { escapeRegex, syncSellerProducts, sellerIsActive } from '../services/catalog.js';
import { adminOrderView } from '../services/orders.js';
import { createPayout, eligibleLedgers, markPayoutFailed, markPayoutPaid, outstanding } from '../services/payouts.js';
import { createProduct, productBase, productPatch, refineProduct, setStocks, updateProduct, withStock } from '../services/products.js';
import { getSettings, settingsPatchSchema, updateSettings } from '../services/settings.js';
import { sellerProductView } from './seller.js';

const oid = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const idParam = validate(z.object({ id: oid }), 'params');
const page = z.object({ page: z.coerce.number().int().min(1).max(1000).default(1), limit: z.coerce.number().int().min(1).max(100).default(30) });
const reason = z.object({ reason: z.string().trim().min(3).max(300) }).strict();
const bpsOrNull = z.number().int().min(0).max(5000).nullable();

export default function adminRoutes({ config, orders }) {
  const r = Router();
  r.use('/admin', requireAdmin);
  const cfg = config.cloudinary;

  /* ── dashboard ── */
  r.get('/admin/dashboard', asyncHandler(async (_req, res) => {
    const since = new Date(Date.now() - 30 * 86400000);
    const [sellers, pendingProducts, openTickets, paid, ledgers] = await Promise.all([
      Seller.find({}).select('status').lean(), Product.countDocuments({ status: 'pending_review' }), Ticket.countDocuments({ status: { $in: ['open', 'pending'] } }),
      Order.find({ status: 'paid', createdAt: { $gte: since } }).select('totals items refundedPaise').lean(), Ledger.find({ status: { $ne: 'reversed' } }).select('commissionPaise sellerPayablePaise settledPaise status').lean(),
    ]);
    const bySt = (s) => sellers.filter((x) => x.status === s).length;
    res.json({
      sellers: { pending: bySt('pending'), approved: bySt('approved'), suspended: bySt('suspended'), rejected: bySt('rejected') },
      pendingProducts, openTickets,
      last30Days: { orders: paid.length, gmvPaise: paid.reduce((a, o) => a + o.totals.totalPaise, 0), refundedPaise: paid.reduce((a, o) => a + o.refundedPaise, 0) },
      commissionEarnedPaise: ledgers.reduce((a, l) => a + l.commissionPaise, 0),
      owedToSellersPaise: ledgers.reduce((a, l) => a + Math.max(0, outstanding(l)), 0),
    });
  }));

  /* ── sellers ── */
  const sellerAdminView = (s, user) => ({
    id: String(s._id), userId: String(s.userId), phone: user?.phone, status: s.status, statusNote: s.statusNote, createdAt: s.createdAt,
    application: { ...s.application, panEnc: undefined, pan: s.application.panLast4 ? `••••••${s.application.panLast4}` : '' },
    store: s.store, verification: s.verification, commissionOverride: s.commissionOverride, payoutHint: s.payoutHint,
  });
  r.get('/admin/sellers', validate(page.extend({ status: z.enum(['pending', 'approved', 'rejected', 'suspended']).optional(), q: z.string().max(60).optional() }), 'query'), asyncHandler(async (req, res) => {
    const { status, q, page: pg, limit } = req.query; const f = {};
    if (status) f.status = status;
    if (q) { const rx = { $regex: escapeRegex(q), $options: 'i' }; f.$or = [{ 'store.storeName': rx }, { 'store.slug': rx }, { 'application.businessName': rx }]; }
    const [total, rows] = await Promise.all([Seller.countDocuments(f), Seller.find(f).sort({ createdAt: -1 }).skip((pg - 1) * limit).limit(limit).lean()]);
    const users = await User.find({ _id: { $in: rows.map((s) => s.userId) } }).lean();
    res.json({ total, sellers: rows.map((s) => sellerAdminView(s, users.find((u) => String(u._id) === String(s.userId)))) });
  }));
  const sellerById = async (id) => { const s = await Seller.findById(id); if (!s) throw notFound('Seller not found'); return s; };
  r.get('/admin/sellers/:id', idParam, asyncHandler(async (req, res) => {
    const s = await sellerById(req.params.id); const user = await User.findById(s.userId).lean();
    res.json({ seller: sellerAdminView(s.toObject(), user), productCount: await Product.countDocuments({ sellerId: s._id }) });
  }));
  const setStatus = (path, status, { needReason = false, from } = {}) => r.post(`/admin/sellers/:id/${path}`, idParam, validate(needReason ? reason : z.object({ reason: z.string().max(300).optional() }).strict()), asyncHandler(async (req, res) => {
    const s = await sellerById(req.params.id);
    if (from && !from.includes(s.status)) throw conflict(`A ${s.status} seller cannot be ${path}d`, 'bad_state');
    const before = s.status;
    s.status = status; s.statusNote = req.body.reason ?? ''; s.statusChangedAt = new Date(); s.statusChangedBy = req.user._id;
    if (status !== 'approved') s.verification.verified = false; // verification never survives suspension/rejection
    await s.save();
    await syncSellerProducts(s);
    if (status === 'approved') await User.updateOne({ _id: s.userId }, { $addToSet: { roles: 'seller' } });
    else await User.updateOne({ _id: s.userId }, { $pull: { roles: 'seller' } });
    await audit(req, `seller.${path}`, 'seller', s._id, { before, after: status, reason: req.body.reason });
    res.json({ seller: sellerAdminView(s.toObject()) });
  }));
  setStatus('approve', 'approved', { from: ['pending', 'rejected'] });
  setStatus('reject', 'rejected', { needReason: true, from: ['pending'] });
  setStatus('suspend', 'suspended', { needReason: true, from: ['approved'] });
  setStatus('reinstate', 'approved', { from: ['suspended'] });
  r.post('/admin/sellers/:id/verify', idParam, validate(z.object({ note: z.string().max(300).default('') }).strict()), asyncHandler(async (req, res) => {
    const s = await sellerById(req.params.id);
    if (s.status !== 'approved') throw conflict('Only approved sellers can be verified', 'bad_state');
    s.verification = { verified: true, verifiedAt: new Date(), verifiedBy: req.user._id, note: req.body.note };
    await s.save(); await audit(req, 'seller.verify', 'seller', s._id, { note: req.body.note });
    res.json({ seller: sellerAdminView(s.toObject()) });
  }));
  r.post('/admin/sellers/:id/unverify', idParam, validate(reason), asyncHandler(async (req, res) => {
    const s = await sellerById(req.params.id);
    s.verification = { verified: false, note: req.body.reason }; await s.save();
    await audit(req, 'seller.unverify', 'seller', s._id, { reason: req.body.reason });
    res.json({ seller: sellerAdminView(s.toObject()) });
  }));
  r.patch('/admin/sellers/:id/commission', idParam, validate(z.object({ linkBps: bpsOrNull.optional(), marketplaceBps: bpsOrNull.optional(), reason: z.string().trim().min(3).max(300) }).strict()), asyncHandler(async (req, res) => {
    const s = await sellerById(req.params.id); const before = { ...s.commissionOverride?.toObject?.() };
    for (const k of ['linkBps', 'marketplaceBps']) if (req.body[k] !== undefined) s.commissionOverride[k] = req.body[k];
    await s.save();
    await audit(req, 'seller.commission', 'seller', s._id, { before, after: s.commissionOverride.toObject(), reason: req.body.reason });
    res.json({ seller: sellerAdminView(s.toObject()) });
  }));

  /* ── products ── */
  r.get('/admin/products', validate(page.extend({ status: z.string().max(20).optional(), owner: z.enum(['upahars', 'seller']).optional(), seller: oid.optional(), q: z.string().max(60).optional() }), 'query'), asyncHandler(async (req, res) => {
    const { status, owner, seller, q, page: pg, limit } = req.query; const f = {};
    if (status) f.status = status; if (owner) f.ownerType = owner; if (seller) f.sellerId = seller;
    if (q) f.title = { $regex: escapeRegex(q), $options: 'i' };
    const [total, docs] = await Promise.all([Product.countDocuments(f), Product.find(f).sort({ updatedAt: -1 }).skip((pg - 1) * limit).limit(limit).lean()]);
    res.json({ total, products: (await withStock(docs)).map((p) => ({ ...sellerProductView(p), ownerType: p.ownerType, sellerId: p.sellerId ? String(p.sellerId) : null, collections: p.collections, commissionOverrideBps: p.commissionOverrideBps })) });
  }));
  const productById = async (id) => { const p = await Product.findById(id); if (!p) throw notFound('Product not found'); return p; };
  // Administrators control every product (Originals and seller listings). Image uploads must sit in the owner's folder.
  const folderFor = (p) => (p.ownerType === 'upahars' ? originalsFolder() : sellerFolder(p.sellerId));
  const fullView = async (p) => ({ ...sellerProductView((await withStock([p.toObject()]))[0]), ownerType: p.ownerType, sellerId: p.sellerId ? String(p.sellerId) : null, collections: p.collections, commissionOverrideBps: p.commissionOverrideBps });
  r.get('/admin/products/:id', idParam, asyncHandler(async (req, res) => { res.json({ product: await fullView(await productById(req.params.id)) }); }));
  const adminProductInput = refineProduct(productBase.extend({ collections: z.array(z.string().max(60)).max(10).default([]), status: z.enum(['draft', 'published']).default('draft') }).strict());

  r.post('/admin/products', validate(adminProductInput), asyncHandler(async (req, res) => {
    const { status, ...input } = req.body;
    const p = await createProduct({ input, owner: { type: 'upahars' }, imageFolder: originalsFolder(), cfg, status });
    if (status === 'published') { p.publishedAt = new Date(); await p.save(); }
    await audit(req, 'product.create_original', 'product', p._id, { title: p.title });
    res.status(201).json({ product: sellerProductView((await withStock([p.toObject()]))[0]) });
  }));
  r.patch('/admin/products/:id', idParam, validate(productPatch.extend({ collections: z.array(z.string().max(60)).max(10).optional(), status: z.enum(['draft', 'published', 'paused', 'archived']).optional() }).strict()), asyncHandler(async (req, res) => {
    const p = await productById(req.params.id);
    const { status, ...patch } = req.body;
    await updateProduct({ product: p, patch, imageFolder: folderFor(p), cfg });
    if (status) { p.status = status; if (status === 'published' && !p.publishedAt) p.publishedAt = new Date(); await p.save(); }
    await audit(req, p.ownerType === 'upahars' ? 'product.update_original' : 'product.update_seller_listing', 'product', p._id, { fields: Object.keys(req.body) });
    res.json({ product: await fullView(p) });
  }));
  // Delete: a product that was ever ordered is archived instead (order history must keep pointing at it).
  r.delete('/admin/products/:id', idParam, asyncHandler(async (req, res) => {
    const p = await productById(req.params.id);
    if (await Order.exists({ 'items.productId': p._id })) {
      p.status = 'archived'; await p.save();
      await audit(req, 'product.archive', 'product', p._id, { title: p.title, why: 'has orders' });
      return res.json({ ok: true, archived: true });
    }
    await Inventory.deleteMany({ productId: p._id }); await p.deleteOne();
    await audit(req, 'product.delete', 'product', p._id, { title: p.title });
    res.json({ ok: true, archived: false });
  }));
  r.put('/admin/products/:id/inventory', idParam, validate(z.object({ stocks: z.array(z.object({ variantId: oid.optional(), stock: z.number().int().min(0).max(1_000_000) }).strict()).min(1).max(30) }).strict()), asyncHandler(async (req, res) => {
    const p = await productById(req.params.id);
    await setStocks(p, req.body.stocks); await audit(req, 'product.stock', 'product', p._id, { stocks: req.body.stocks });
    res.json({ product: sellerProductView((await withStock([p.toObject()]))[0]) });
  }));
  r.post('/admin/products/:id/approve', idParam, asyncHandler(async (req, res) => {
    const p = await productById(req.params.id);
    if (p.status !== 'pending_review') throw conflict('Only products awaiting review can be approved', 'bad_state');
    p.status = 'published'; p.publishedAt = p.publishedAt ?? new Date(); p.moderation = { note: '', reviewedBy: req.user._id, reviewedAt: new Date() }; await p.save();
    await audit(req, 'product.approve', 'product', p._id, { title: p.title });
    res.json({ product: sellerProductView((await withStock([p.toObject()]))[0]) });
  }));
  r.post('/admin/products/:id/reject', idParam, validate(z.object({ note: z.string().trim().min(3).max(300) }).strict()), asyncHandler(async (req, res) => {
    const p = await productById(req.params.id);
    if (p.ownerType !== 'seller') throw badRequest('Use the product editor for Upahars Originals');
    p.status = 'rejected'; p.moderation = { note: req.body.note, reviewedBy: req.user._id, reviewedAt: new Date() }; await p.save();
    await audit(req, 'product.reject', 'product', p._id, { note: req.body.note });
    res.json({ product: sellerProductView((await withStock([p.toObject()]))[0]) });
  }));
  r.patch('/admin/products/:id/commission', idParam, validate(z.object({ commissionOverrideBps: bpsOrNull, reason: z.string().trim().min(3).max(300) }).strict()), asyncHandler(async (req, res) => {
    const p = await productById(req.params.id); const before = p.commissionOverrideBps;
    p.commissionOverrideBps = req.body.commissionOverrideBps; await p.save();
    await audit(req, 'product.commission', 'product', p._id, { before, after: p.commissionOverrideBps, reason: req.body.reason });
    res.json({ ok: true, commissionOverrideBps: p.commissionOverrideBps });
  }));
  r.put('/admin/products/:id/collections', idParam, validate(z.object({ collections: z.array(z.string().max(60)).max(10) }).strict()), asyncHandler(async (req, res) => {
    const p = await productById(req.params.id);
    await updateProduct({ product: p, patch: { collections: req.body.collections }, imageFolder: '', cfg });
    await audit(req, 'product.collections', 'product', p._id, { collections: req.body.collections });
    res.json({ ok: true });
  }));

  /* ── taxonomy: categories, occasions, collections ── */
  const taxBody = z.object({ type: z.enum(['category', 'occasion', 'collection']), name: z.string().trim().min(2).max(80), slug: z.string().trim().toLowerCase().optional(), description: z.string().max(300).default(''), sortOrder: z.number().int().min(0).max(10000).default(0), isActive: z.boolean().default(true), image: z.object({ url: z.string().url() }).strict().nullable().optional() }).strict();
  const taxImage = (u) => { if (!u) return null; const ok = parseOwnedImage(cfg, u.url, siteFolder()); if (!ok) throw badRequest('Images must be uploaded through Upahars image upload', 'bad_image'); return ok; };
  r.get('/admin/taxonomy', asyncHandler(async (_req, res) => res.json({ items: await Taxonomy.find({}).sort({ type: 1, sortOrder: 1 }).lean() })));
  r.post('/admin/taxonomy', validate(taxBody), asyncHandler(async (req, res) => {
    const slug = req.body.slug || slugify(req.body.name); if (!isValidSlug(slug)) throw badRequest('Invalid slug');
    const t = await Taxonomy.create({ ...req.body, slug, image: taxImage(req.body.image) });
    await audit(req, 'taxonomy.create', 'taxonomy', t._id, { type: t.type, slug }); res.status(201).json({ item: t });
  }));
  r.patch('/admin/taxonomy/:id', idParam, validate(taxBody.partial().omit({ type: true, slug: true }).strict()), asyncHandler(async (req, res) => {
    const t = await Taxonomy.findById(req.params.id); if (!t) throw notFound('Not found');
    const { image, ...rest } = req.body; Object.assign(t, rest); if (image !== undefined) t.image = taxImage(image);
    await t.save(); await audit(req, 'taxonomy.update', 'taxonomy', t._id, req.body); res.json({ item: t });
  }));
  r.delete('/admin/taxonomy/:id', idParam, asyncHandler(async (req, res) => {
    const t = await Taxonomy.findById(req.params.id); if (!t) throw notFound('Not found');
    const field = t.type === 'category' ? 'category' : t.type === 'occasion' ? 'occasions' : 'collections';
    if (await Product.exists({ [field]: t.slug })) throw conflict('Products still use this. Deactivate it instead.', 'in_use');
    await t.deleteOne(); await audit(req, 'taxonomy.delete', 'taxonomy', t._id, { slug: t.slug }); res.json({ ok: true });
  }));

  /* ── platform settings (commission rules etc.) ── */
  r.get('/admin/settings', asyncHandler(async (_req, res) => res.json({ settings: await getSettings() })));
  r.put('/admin/settings', validate(settingsPatchSchema), asyncHandler(async (req, res) => {
    const { before, after } = await updateSettings(req.body, req.user._id);
    await audit(req, 'settings.update', 'settings', 'platform', { before, after }); res.json({ settings: after });
  }));

  /* ── coupons & banners ── */
  const couponFields = { title: z.string().trim().max(80).default(''), description: z.string().trim().max(200).default(''), isPublic: z.boolean().default(false) };
  const couponBody = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,24}$/), type: z.enum(['percent', 'fixed']), value: z.number().int().min(1), minOrderPaise: z.number().int().min(0).default(0), maxDiscountPaise: z.number().int().min(1).nullable().default(null), startsAt: z.coerce.date().nullable().default(null), endsAt: z.coerce.date().nullable().default(null), usageLimit: z.number().int().min(1).nullable().default(null), perUserLimit: z.number().int().min(1).max(100).default(1), isActive: z.boolean().default(true), ...couponFields }).strict();
  const checkCouponRules = (c) => {
    if (c.type === 'percent' && c.value > 90) throw badRequest('Percent discount cannot exceed 90');
    if (c.startsAt && c.endsAt && c.endsAt <= c.startsAt) throw badRequest('End date must be after the start date');
  };
  r.get('/admin/coupons', asyncHandler(async (_req, res) => res.json({ coupons: await Coupon.find({}).sort({ createdAt: -1 }).lean() })));
  r.post('/admin/coupons', validate(couponBody), asyncHandler(async (req, res) => {
    checkCouponRules(req.body);
    if (await Coupon.exists({ code: req.body.code })) throw conflict('That coupon code already exists', 'duplicate');
    const c = await Coupon.create(req.body); await audit(req, 'coupon.create', 'coupon', c._id, { code: c.code }); res.status(201).json({ coupon: c });
  }));
  // Every field except the code can be changed. (The code is what customers and past orders refer to.)
  r.patch('/admin/coupons/:id', idParam, validate(couponBody.omit({ code: true }).partial().strict()), asyncHandler(async (req, res) => {
    const c = await Coupon.findById(req.params.id); if (!c) throw notFound('Coupon not found');
    Object.assign(c, req.body); checkCouponRules(c); await c.save();
    await audit(req, 'coupon.update', 'coupon', c._id, req.body); res.json({ coupon: c });
  }));
  r.delete('/admin/coupons/:id', idParam, asyncHandler(async (req, res) => {
    const c = await Coupon.findById(req.params.id); if (!c) throw notFound('Coupon not found');
    await c.deleteOne(); await audit(req, 'coupon.delete', 'coupon', c._id, { code: c.code }); res.json({ ok: true });
  }));
  const bannerBody = z.object({ title: z.string().trim().min(2).max(100), subtitle: z.string().max(200).default(''), link: z.string().max(200).regex(/^\/[^/]/, 'Use an on-site link like /store/rosecraft').default('/'), placement: z.enum(['home_hero', 'home_strip']).default('home_hero'), sortOrder: z.number().int().default(0), isActive: z.boolean().default(true), image: z.object({ url: z.string().url() }).strict().nullable().optional() }).strict();
  r.get('/admin/banners', asyncHandler(async (_req, res) => res.json({ banners: await Banner.find({}).sort({ sortOrder: 1 }).lean() })));
  r.post('/admin/banners', validate(bannerBody), asyncHandler(async (req, res) => { const b = await Banner.create({ ...req.body, image: taxImage(req.body.image) }); await audit(req, 'banner.create', 'banner', b._id, { title: b.title }); res.status(201).json({ banner: b }); }));
  r.patch('/admin/banners/:id', idParam, validate(bannerBody.partial().strict()), asyncHandler(async (req, res) => {
    const b = await Banner.findById(req.params.id); if (!b) throw notFound('Banner not found'); const { image, ...rest } = req.body; Object.assign(b, rest); if (image !== undefined) b.image = taxImage(image); await b.save();
    await audit(req, 'banner.update', 'banner', b._id, req.body); res.json({ banner: b });
  }));
  r.delete('/admin/banners/:id', idParam, asyncHandler(async (req, res) => { await Banner.deleteOne({ _id: req.params.id }); await audit(req, 'banner.delete', 'banner', req.params.id); res.json({ ok: true }); }));

  /* ── home-page polaroid carousel ("showcase"): picture + name + description ── */
  const showcaseBody = z.object({ title: z.string().trim().min(2).max(60), caption: z.string().trim().max(160).default(''), sortOrder: z.number().int().min(0).max(9999).default(0), isActive: z.boolean().default(true), image: z.object({ url: z.string().url() }).strict().nullable().optional() }).strict();
  r.get('/admin/showcase', asyncHandler(async (_req, res) => res.json({ items: await Showcase.find({}).sort({ sortOrder: 1, createdAt: 1 }).lean() })));
  r.post('/admin/showcase', validate(showcaseBody), asyncHandler(async (req, res) => {
    if (await Showcase.countDocuments({}) >= 24) throw badRequest('You can keep up to 24 pictures in the carousel. Delete one first.', 'limit');
    const s = await Showcase.create({ ...req.body, image: taxImage(req.body.image) });
    await audit(req, 'showcase.create', 'showcase', s._id, { title: s.title }); res.status(201).json({ item: s });
  }));
  r.patch('/admin/showcase/:id', idParam, validate(showcaseBody.partial().strict()), asyncHandler(async (req, res) => {
    const s = await Showcase.findById(req.params.id); if (!s) throw notFound('Carousel picture not found');
    const { image, ...rest } = req.body; Object.assign(s, rest); if (image !== undefined) s.image = taxImage(image); await s.save();
    await audit(req, 'showcase.update', 'showcase', s._id, req.body); res.json({ item: s });
  }));
  r.delete('/admin/showcase/:id', idParam, asyncHandler(async (req, res) => {
    const s = await Showcase.findById(req.params.id); if (!s) throw notFound('Carousel picture not found');
    await s.deleteOne(); await audit(req, 'showcase.delete', 'showcase', s._id, { title: s.title }); res.json({ ok: true });
  }));

  /* ── orders, refunds, shipments ── */
  r.get('/admin/orders', validate(page.extend({ status: z.string().max(20).optional(), q: z.string().max(40).optional(), seller: oid.optional() }), 'query'), asyncHandler(async (req, res) => {
    const { status, q, seller, page: pg, limit } = req.query; const f = {};
    if (status) f.status = status; if (seller) f['shipments.sellerId'] = seller; if (q) f.orderNumber = { $regex: escapeRegex(q.toUpperCase()) };
    const [total, rows] = await Promise.all([Order.countDocuments(f), Order.find(f).sort({ createdAt: -1 }).skip((pg - 1) * limit).limit(limit)]);
    res.json({ total, orders: rows.map(adminOrderView) });
  }));
  r.get('/admin/orders/:orderNumber', asyncHandler(async (req, res) => {
    const o = await Order.findOne({ orderNumber: req.params.orderNumber }); if (!o) throw notFound('Order not found');
    const ledgers = await Ledger.find({ orderId: o._id }).lean(); const touch = o.attribution?.touchId ? await Touch.findById(o.attribution.touchId).lean() : null;
    res.json({ order: adminOrderView(o), ledgers, attributionEvidence: touch });
  }));
  r.post('/admin/orders/:orderNumber/refund', validate(z.object({ items: z.array(z.object({ itemId: oid, qty: z.number().int().min(1) }).strict()).min(1).max(50), reason: z.string().trim().min(3).max(300) }).strict()), asyncHandler(async (req, res) => {
    const o = await Order.findOne({ orderNumber: req.params.orderNumber }); if (!o) throw notFound('Order not found');
    const out = await orders.refundItems({ orderId: o._id, lines: req.body.items, reason: req.body.reason, actorId: req.user._id });
    await audit(req, 'order.refund', 'order', o.orderNumber, { items: req.body.items, amountPaise: out.refundedPaise, reason: req.body.reason });
    res.json({ order: adminOrderView(out.order), refundedPaise: out.refundedPaise });
  }));
  r.post('/admin/orders/:orderNumber/shipments/:shipmentId', validate(z.object({ status: z.enum(['processing', 'shipped', 'delivered', 'cancelled']), tracking: z.object({ carrier: z.string().trim().max(60), trackingNumber: z.string().trim().max(60), trackingUrl: z.string().trim().url().max(300).or(z.literal('')).default('') }).strict().optional() }).strict()), asyncHandler(async (req, res) => {
    const o = await Order.findOne({ orderNumber: req.params.orderNumber }); if (!o) throw notFound('Order not found');
    const u = await orders.updateShipment({ orderId: o._id, shipmentId: req.params.shipmentId, actor: { role: 'admin', userId: req.user._id }, status: req.body.status, tracking: req.body.tracking });
    await audit(req, 'order.shipment', 'order', o.orderNumber, { shipmentId: req.params.shipmentId, status: req.body.status });
    res.json({ order: adminOrderView(u) });
  }));
  r.post('/admin/maintenance/release-expired', asyncHandler(async (_req, res) => res.json({ released: await orders.releaseExpired() })));

  /* ── ledgers (commission records) & disputes ── */
  r.get('/admin/ledgers', validate(page.extend({ sellerId: oid.optional(), status: z.string().max(20).optional() }), 'query'), asyncHandler(async (req, res) => {
    const { sellerId, status, page: pg, limit } = req.query; const f = {}; if (sellerId) f.sellerId = sellerId; if (status) f.status = status;
    const [total, rows] = await Promise.all([Ledger.countDocuments(f), Ledger.find(f).sort({ createdAt: -1 }).skip((pg - 1) * limit).limit(limit).lean()]);
    res.json({ total, ledgers: rows.map((l) => ({ ...l, outstandingPaise: outstanding(l) })) });
  }));
  const ledgerById = async (id) => { const l = await Ledger.findById(id); if (!l) throw notFound('Ledger not found'); return l; };
  r.post('/admin/ledgers/:id/hold', idParam, validate(reason), asyncHandler(async (req, res) => {
    const l = await ledgerById(req.params.id); if (l.status !== 'pending') throw conflict('Only pending earnings can be put on hold', 'bad_state');
    l.status = 'disputed'; l.history.push({ at: new Date(), by: String(req.user._id), action: 'hold', note: req.body.reason }); await l.save();
    await audit(req, 'ledger.hold', 'ledger', l._id, { reason: req.body.reason }); res.json({ ok: true });
  }));
  r.post('/admin/ledgers/:id/release', idParam, validate(reason), asyncHandler(async (req, res) => {
    const l = await ledgerById(req.params.id); if (l.status !== 'disputed') throw conflict('This ledger is not on hold', 'bad_state');
    l.status = 'pending'; l.history.push({ at: new Date(), by: String(req.user._id), action: 'release', note: req.body.reason }); await l.save();
    await audit(req, 'ledger.release', 'ledger', l._id, { reason: req.body.reason }); res.json({ ok: true });
  }));
  r.post('/admin/ledgers/:id/adjust', idParam, validate(z.object({ amountPaise: z.number().int().min(-10_000_000).max(10_000_000).refine((n) => n !== 0, 'Amount cannot be zero'), reason: z.string().trim().min(3).max(300) }).strict()), asyncHandler(async (req, res) => {
    const l = await ledgerById(req.params.id); if (['in_payout'].includes(l.status)) throw conflict('Wait for the open payout to finish', 'bad_state');
    l.adjustmentPaise += req.body.amountPaise; l.sellerPayablePaise = Math.max(0, l.sellerPayablePaise + req.body.amountPaise);
    l.history.push({ at: new Date(), by: String(req.user._id), action: 'adjust', note: `${req.body.amountPaise} paise: ${req.body.reason}` }); await l.save();
    await audit(req, 'ledger.adjust', 'ledger', l._id, { amountPaise: req.body.amountPaise, reason: req.body.reason }); res.json({ ledger: { ...l.toObject(), outstandingPaise: outstanding(l) } });
  }));

  /* ── payouts (recorded by an administrator; money is moved outside the platform) ── */
  r.get('/admin/sellers/:id/payable', idParam, asyncHandler(async (req, res) => {
    const rows = await eligibleLedgers(req.params.id); res.json({ ledgers: rows.map((l) => ({ id: String(l._id), orderNumber: l.orderNumber, outstandingPaise: outstanding(l) })), totalPaise: rows.reduce((a, l) => a + outstanding(l), 0) });
  }));
  r.post('/admin/sellers/:id/payouts', idParam, asyncHandler(async (req, res) => {
    const s = await sellerById(req.params.id);
    const p = await createPayout({ sellerId: s._id, adminId: req.user._id });
    await audit(req, 'payout.create', 'payout', p._id, { sellerId: String(s._id), amountPaise: p.amountPaise }); res.status(201).json({ payout: p });
  }));
  r.get('/admin/payouts', asyncHandler(async (_req, res) => res.json({ payouts: await Payout.find({}).sort({ createdAt: -1 }).limit(200).lean() })));
  r.post('/admin/payouts/:id/paid', idParam, validate(z.object({ reference: z.string().trim().min(3).max(80), method: z.string().max(30).default('') }).strict()), asyncHandler(async (req, res) => {
    const p = await markPayoutPaid({ payoutId: req.params.id, reference: req.body.reference, method: req.body.method, adminId: req.user._id });
    await audit(req, 'payout.paid', 'payout', p._id, { reference: req.body.reference, amountPaise: p.amountPaise }); res.json({ payout: p });
  }));
  r.post('/admin/payouts/:id/failed', idParam, validate(z.object({ note: z.string().max(300).default('') }).strict()), asyncHandler(async (req, res) => {
    const p = await markPayoutFailed({ payoutId: req.params.id, note: req.body.note, adminId: req.user._id });
    await audit(req, 'payout.failed', 'payout', p._id, { note: req.body.note }); res.json({ payout: p });
  }));

  /* ── users, support, audit ── */
  r.get('/admin/users', validate(page.extend({ q: z.string().max(20).optional() }), 'query'), asyncHandler(async (req, res) => {
    const { q, page: pg, limit } = req.query; const f = q ? { phone: { $regex: escapeRegex(q) } } : {};
    const [total, rows] = await Promise.all([User.countDocuments(f), User.find(f).sort({ createdAt: -1 }).skip((pg - 1) * limit).limit(limit).lean()]);
    res.json({ total, users: rows.map((u) => ({ id: String(u._id), phone: u.phone, name: u.name, roles: u.roles, isSuspended: u.isSuspended, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt })) });
  }));
  r.post('/admin/users/:id/suspend', idParam, validate(z.object({ suspended: z.boolean(), reason: z.string().trim().min(3).max(300) }).strict()), asyncHandler(async (req, res) => {
    const u = await User.findById(req.params.id); if (!u) throw notFound('User not found');
    if (String(u._id) === String(req.user._id) || u.roles.includes('admin')) throw forbidden('Administrators cannot be suspended here');
    u.isSuspended = req.body.suspended; await u.save(); await audit(req, req.body.suspended ? 'user.suspend' : 'user.unsuspend', 'user', u._id, { reason: req.body.reason });
    res.json({ ok: true });
  }));
  r.get('/admin/tickets', validate(page.extend({ status: z.string().max(20).optional() }), 'query'), asyncHandler(async (req, res) => {
    const f = req.query.status ? { status: req.query.status } : {}; res.json({ tickets: await Ticket.find(f).sort({ updatedAt: -1 }).limit(req.query.limit).lean() });
  }));
  r.post('/admin/tickets/:id/messages', idParam, validate(z.object({ text: z.string().trim().min(1).max(2000), status: z.enum(['open', 'pending', 'resolved', 'closed']).optional() }).strict()), asyncHandler(async (req, res) => {
    const t = await Ticket.findById(req.params.id); if (!t) throw notFound('Ticket not found');
    t.messages.push({ by: req.user._id, role: 'admin', text: req.body.text }); t.status = req.body.status ?? 'pending'; await t.save();
    await audit(req, 'ticket.reply', 'ticket', t._id, { status: t.status }); res.json({ ticket: t });
  }));
  r.get('/admin/audit', validate(page.extend({ action: z.string().max(40).optional(), entity: z.string().max(40).optional() }), 'query'), asyncHandler(async (req, res) => {
    const f = {}; if (req.query.action) f.action = { $regex: '^' + escapeRegex(req.query.action) }; if (req.query.entity) f.entity = req.query.entity;
    const [total, rows] = await Promise.all([AuditLog.countDocuments(f), AuditLog.find(f).sort({ createdAt: -1 }).skip((req.query.page - 1) * req.query.limit).limit(req.query.limit).lean()]);
    res.json({ total, entries: rows });
  }));

  /* ── reports (computed in code; move to aggregation pipelines at larger scale) ── */
  r.get('/admin/reports/sales', validate(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), 'query'), asyncHandler(async (req, res) => {
    const since = new Date(Date.now() - req.query.days * 86400000);
    const rows = await Order.find({ status: 'paid', createdAt: { $gte: since } }).select('createdAt totals items refundedPaise').lean();
    const days = new Map();
    for (const o of rows) {
      const k = o.createdAt.toISOString().slice(0, 10); const d = days.get(k) ?? { date: k, orders: 0, gmvPaise: 0, originalsPaise: 0, sellersPaise: 0 };
      d.orders++; d.gmvPaise += o.totals.totalPaise;
      for (const i of o.items) (i.ownerType === 'upahars' ? (d.originalsPaise += i.unitPaise * i.qty) : (d.sellersPaise += i.unitPaise * i.qty));
      days.set(k, d);
    }
    res.json({ days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)), totals: { orders: rows.length, gmvPaise: rows.reduce((a, o) => a + o.totals.totalPaise, 0), refundedPaise: rows.reduce((a, o) => a + o.refundedPaise, 0) } });
  }));
  r.get('/admin/reports/sellers', asyncHandler(async (_req, res) => {
    const [sellers, ledgers] = await Promise.all([Seller.find({}).lean(), Ledger.find({}).lean()]);
    res.json({ sellers: sellers.map((s) => { const ls = ledgers.filter((l) => String(l.sellerId) === String(s._id) && l.status !== 'reversed'); return { id: String(s._id), storeName: s.store.storeName, status: s.status, orders: ls.length, grossPaise: ls.reduce((a, l) => a + l.grossPaise, 0), commissionPaise: ls.reduce((a, l) => a + l.commissionPaise, 0), viaOwnLinkOrders: ls.filter((l) => l.source === 'seller_link').length, owedPaise: ls.reduce((a, l) => a + Math.max(0, outstanding(l)), 0), paidPaise: ls.reduce((a, l) => a + l.settledPaise, 0) }; }) });
  }));
  r.get('/admin/reports/products', asyncHandler(async (_req, res) => {
    const top = await Product.find({ soldCount: { $gt: 0 } }).sort({ soldCount: -1 }).limit(20).select('title slug ownerType soldCount pricePaise').lean();
    res.json({ top });
  }));
  return r;
}
export { sellerIsActive };
