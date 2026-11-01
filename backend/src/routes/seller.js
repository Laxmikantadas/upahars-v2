import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { encryptJson } from '../lib/crypto.js';
import { isValidSlug, RESERVED_SLUGS, slugify } from '../lib/slug.js';
import { parseOwnedImage, sellerFolder } from '../lib/cloudinary.js';
import { validate } from '../lib/validate.js';
import { Ledger, Order, Payout, Product, Seller } from '../models/index.js';
import { loadSellerAnyStatus, requireAuth, requireSeller } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { syncSellerProducts } from '../services/catalog.js';
import { MATERIAL_FIELDS, canPublish, createProduct, productInput, productPatch, setStocks, updateProduct, withStock } from '../services/products.js';
import { getSettings } from '../services/settings.js';
import { sellerOrderView } from '../services/orders.js';
import { earningsSummary, outstanding } from '../services/payouts.js';

const oid = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const idParam = validate(z.object({ id: oid }), 'params');
const apply = z.object({
  businessName: z.string().trim().min(2).max(100), ownerName: z.string().trim().min(2).max(80),
  businessType: z.enum(['individual', 'proprietorship', 'partnership', 'company']), city: z.string().trim().min(2).max(60), state: z.string().trim().min(2).max(60),
  instagram: z.string().trim().max(80).default(''), website: z.string().trim().url().max(200).or(z.literal('')).default(''),
  gstin: z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid GSTIN').or(z.literal('')).default(''),
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Enter a valid PAN').or(z.literal('')).default(''),
  about: z.string().trim().max(1000).default(''), categories: z.array(z.string().max(40)).max(10).default([]),
  storeName: z.string().trim().min(2).max(80), slug: z.string().trim().toLowerCase().optional(),
}).strict();
const storePatch = z.object({
  storeName: z.string().trim().min(2).max(80), tagline: z.string().trim().max(120), description: z.string().trim().max(2000),
  logo: z.object({ url: z.string().url().max(500) }).strict().nullable(), banner: z.object({ url: z.string().url().max(500) }).strict().nullable(),
  shipsFrom: z.string().trim().max(80), processingDays: z.number().int().min(0).max(30), shippingNote: z.string().trim().max(300), isPaused: z.boolean(),
}).partial().strict();

export const effectiveRates = (seller, settings) => ({
  linkBps: seller.commissionOverride?.linkBps ?? settings.commission.linkBps,
  marketplaceBps: seller.commissionOverride?.marketplaceBps ?? settings.commission.marketplaceBps,
});

export const sellerSelfView = (s, settings) => ({
  id: String(s._id), status: s.status, statusNote: s.statusNote,
  application: { ...s.application, panEnc: undefined, pan: s.application.panLast4 ? `••••••${s.application.panLast4}` : '' },
  store: s.store, verified: Boolean(s.verification?.verified), rates: effectiveRates(s, settings), payoutHint: s.payoutHint,
  shareLinks: { store: `/store/${s.store.slug}?ref=${s.store.slug}` },
});

export default function sellerRoutes({ config, limits, orders }) {
  const r = Router();
  const cfg = config.cloudinary;

  /* ── application ── */
  r.post('/seller/apply', requireAuth, limits.api, validate(apply), asyncHandler(async (req, res) => {
    const b = req.body;
    const slug = b.slug || slugify(b.storeName);
    if (!isValidSlug(slug) || RESERVED_SLUGS.has(slug)) throw badRequest('Choose a different store link (letters, numbers and hyphens only)', 'bad_slug');
    const existing = await Seller.findOne({ userId: req.user._id });
    if (existing && existing.status !== 'rejected') throw conflict('You already have a seller application', 'already_applied');
    if (await Seller.exists({ 'store.slug': slug, ...(existing && { _id: { $ne: existing._id } }) })) throw conflict('That store link is already taken', 'slug_taken');
    const { pan, storeName, slug: _s, ...application } = b; void _s;
    const doc = existing ?? new Seller({ userId: req.user._id });
    doc.application = { ...application, panEnc: pan ? encryptJson(config.encryptionKey, { pan }) : '', panLast4: pan.slice(-4) };
    doc.store = { ...(doc.store?.toObject?.() ?? {}), storeName, slug };
    doc.status = 'pending'; doc.statusNote = '';
    await doc.save();
    await audit(req, 'seller.apply', 'seller', doc._id, { slug });
    res.status(201).json({ seller: sellerSelfView(doc, await getSettings()) });
  }));

  r.get('/seller/me', loadSellerAnyStatus, asyncHandler(async (req, res) => {
    if (!req.seller) throw notFound('No seller account');
    res.json({ seller: sellerSelfView(req.seller, await getSettings()) });
  }));

  /* ── store profile ── */
  r.patch('/seller/store', requireSeller, limits.api, validate(storePatch), asyncHandler(async (req, res) => {
    const s = req.seller, p = req.body, folder = sellerFolder(s._id);
    for (const k of ['storeName', 'tagline', 'description', 'shipsFrom', 'processingDays', 'shippingNote', 'isPaused']) if (p[k] !== undefined) s.store[k] = p[k];
    for (const k of ['logo', 'banner']) if (p[k] !== undefined) {
      if (p[k] === null) s.store[k] = null;
      else { const ok = parseOwnedImage(cfg, p[k].url, folder); if (!ok) throw badRequest('Images must be uploaded through Upahars image upload', 'bad_image'); s.store[k] = ok; }
    }
    await s.save();
    if (p.isPaused !== undefined) await syncSellerProducts(s);
    res.json({ seller: sellerSelfView(s, await getSettings()) });
  }));

  r.put('/seller/payout-details', requireSeller, validate(z.discriminatedUnion('method', [
    z.object({ method: z.literal('upi'), upiId: z.string().trim().regex(/^[\w.-]{2,}@[\w]{2,}$/, 'Enter a valid UPI ID') }).strict(),
    z.object({ method: z.literal('bank'), accountHolder: z.string().trim().min(2).max(80), ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC'), accountNumber: z.string().regex(/^\d{9,18}$/, 'Enter a valid account number') }).strict(),
  ])), asyncHandler(async (req, res) => {
    const b = req.body;
    req.seller.payoutEnc = encryptJson(config.encryptionKey, b);
    req.seller.payoutHint = b.method === 'upi' ? `UPI ${b.upiId.replace(/^(.).*(@.*)$/, '$1•••$2')}` : `${b.ifsc.slice(0, 4)} ••••${b.accountNumber.slice(-4)}`;
    await req.seller.save();
    await audit(req, 'seller.payout_details', 'seller', req.seller._id, { method: b.method });
    res.json({ payoutHint: req.seller.payoutHint });
  }));

  /* ── products (always scoped to the signed-in seller) ── */
  const mine = (req, id) => Product.findOne({ _id: id, sellerId: req.seller._id }); // another seller's id simply 404s

  r.get('/seller/products', requireSeller, asyncHandler(async (req, res) => {
    const docs = await Product.find({ sellerId: req.seller._id }).sort({ updatedAt: -1 }).limit(500).lean();
    res.json({ products: (await withStock(docs)).map(sellerProductView) });
  }));
  r.post('/seller/products', requireSeller, limits.api, validate(productInput), asyncHandler(async (req, res) => {
    const p = await createProduct({ input: req.body, owner: { type: 'seller', sellerId: req.seller._id }, imageFolder: sellerFolder(req.seller._id), cfg });
    await audit(req, 'product.create', 'product', p._id, { title: p.title });
    res.status(201).json({ product: sellerProductView((await withStock([p.toObject()]))[0]) });
  }));
  r.get('/seller/products/:id', requireSeller, idParam, asyncHandler(async (req, res) => {
    const p = await mine(req, req.params.id); if (!p) throw notFound('Product not found');
    res.json({ product: sellerProductView((await withStock([p.toObject()]))[0]) });
  }));
  r.patch('/seller/products/:id', requireSeller, idParam, limits.api, validate(productPatch), asyncHandler(async (req, res) => {
    const p = await mine(req, req.params.id); if (!p) throw notFound('Product not found');
    if (p.status === 'archived') throw conflict('This product is archived', 'archived');
    const settings = await getSettings();
    const material = MATERIAL_FIELDS.some((k) => req.body[k] !== undefined);
    await updateProduct({ product: p, patch: req.body, imageFolder: sellerFolder(req.seller._id), cfg });
    // content changes to a live product go back to review (when approval is on); price/stock changes do not
    if (material && p.status === 'published' && settings.requireProductApproval) { p.status = 'pending_review'; await p.save(); }
    res.json({ product: sellerProductView((await withStock([p.toObject()]))[0]) });
  }));
  r.put('/seller/products/:id/inventory', requireSeller, idParam, validate(z.object({ stocks: z.array(z.object({ variantId: oid.optional(), stock: z.number().int().min(0).max(1_000_000) }).strict()).min(1).max(30) }).strict()), asyncHandler(async (req, res) => {
    const p = await mine(req, req.params.id); if (!p) throw notFound('Product not found');
    await setStocks(p, req.body.stocks);
    res.json({ product: sellerProductView((await withStock([p.toObject()]))[0]) });
  }));
  r.post('/seller/products/:id/submit', requireSeller, idParam, asyncHandler(async (req, res) => {
    const p = await mine(req, req.params.id); if (!p) throw notFound('Product not found');
    if (!['draft', 'rejected'].includes(p.status)) throw conflict(`A ${p.status} product cannot be submitted`, 'bad_state');
    canPublish(p);
    const settings = await getSettings();
    p.status = settings.requireProductApproval ? 'pending_review' : 'published';
    if (p.status === 'published') p.publishedAt = new Date();
    await p.save();
    res.json({ product: sellerProductView((await withStock([p.toObject()]))[0]) });
  }));
  for (const [path, from, to] of [['pause', 'published', 'paused'], ['resume', 'paused', 'published']]) {
    r.post(`/seller/products/:id/${path}`, requireSeller, idParam, asyncHandler(async (req, res) => {
      const p = await mine(req, req.params.id); if (!p) throw notFound('Product not found');
      if (p.status !== from) throw conflict(`Only ${from} products can be ${path}d`, 'bad_state');
      p.status = to; await p.save();
      res.json({ product: sellerProductView((await withStock([p.toObject()]))[0]) });
    }));
  }
  r.delete('/seller/products/:id', requireSeller, idParam, asyncHandler(async (req, res) => {
    const p = await mine(req, req.params.id); if (!p) throw notFound('Product not found');
    p.status = 'archived'; await p.save(); // archived, never deleted: past orders keep their history
    res.json({ ok: true });
  }));

  /* ── orders ── */
  const sellerOrder = async (req) => {
    const o = await Order.findOne({ orderNumber: req.params.orderNumber, status: 'paid', 'shipments.sellerId': req.seller._id });
    if (!o) throw notFound('Order not found');
    return o;
  };
  r.get('/seller/orders', requireSeller, asyncHandler(async (req, res) => {
    const rows = await Order.find({ status: 'paid', 'shipments.sellerId': req.seller._id }).sort({ createdAt: -1 }).limit(200);
    res.json({ orders: rows.map((o) => sellerOrderView(o, req.seller._id)) });
  }));
  r.get('/seller/orders/:orderNumber', requireSeller, asyncHandler(async (req, res) => res.json({ order: sellerOrderView(await sellerOrder(req), req.seller._id) })));
  r.post('/seller/orders/:orderNumber/shipments/:shipmentId', requireSeller, validate(z.object({ status: z.enum(['processing', 'shipped', 'delivered', 'cancelled']), tracking: z.object({ carrier: z.string().trim().max(60), trackingNumber: z.string().trim().max(60), trackingUrl: z.string().trim().url().max(300).or(z.literal('')).default('') }).strict().optional() }).strict()), asyncHandler(async (req, res) => {
    const o = await sellerOrder(req);
    const updated = await orders.updateShipment({ orderId: o._id, shipmentId: req.params.shipmentId, actor: { role: 'seller', sellerId: req.seller._id, userId: req.user._id }, status: req.body.status, tracking: req.body.tracking });
    res.json({ order: sellerOrderView(updated, req.seller._id) });
  }));

  /* ── earnings ── */
  r.get('/seller/earnings', requireSeller, asyncHandler(async (req, res) => {
    const ledgers = await Ledger.find({ sellerId: req.seller._id }).sort({ createdAt: -1 }).limit(200).lean();
    res.json({
      summary: await earningsSummary(req.seller._id),
      entries: ledgers.map((l) => ({ orderNumber: l.orderNumber, status: l.status, source: l.source, grossPaise: l.grossPaise, commissionPaise: l.commissionPaise, paymentFeePaise: l.paymentFeePaise, shippingPaise: l.shippingPaise, sellerPayablePaise: l.sellerPayablePaise, outstandingPaise: outstanding(l), deliveredAt: l.deliveredAt, payableAfter: l.payableAfter, lines: l.lines.map((x) => ({ title: x.title, qty: x.qty, refundedQty: x.refundedQty, grossPaise: x.grossPaise, rateBps: x.rateBps, commissionPaise: x.commissionPaise })), createdAt: l.createdAt })),
    });
  }));
  r.get('/seller/payouts', requireSeller, asyncHandler(async (req, res) => {
    const rows = await Payout.find({ sellerId: req.seller._id }).sort({ createdAt: -1 }).limit(100).lean();
    // a payout is only shown as "paid" when an administrator recorded the bank/UPI reference
    res.json({ payouts: rows.map((p) => ({ id: String(p._id), amountPaise: p.amountPaise, status: p.status, reference: p.status === 'paid' ? p.reference : '', paidAt: p.paidAt, createdAt: p.createdAt })) });
  }));
  return r;
}

export const sellerProductView = (p) => ({
  id: String(p._id), slug: p.slug, title: p.title, description: p.description, images: (p.images ?? []).map((i) => i.url), category: p.category, occasions: p.occasions ?? [], tags: p.tags ?? [],
  productType: p.productType, pricePaise: p.pricePaise, compareAtPaise: p.compareAtPaise, status: p.status, moderation: { note: p.moderation?.note ?? '' },
  variants: (p.variants ?? []).map((v) => ({ id: String(v._id), name: v.name, sku: v.sku, pricePaise: v.pricePaise, compareAtPaise: v.compareAtPaise })),
  packQuantity: p.packQuantity ?? 1, isCustomizable: p.isCustomizable, customization: p.customization, shipping: p.shipping, pickupPincode: p.pickupPincode ?? '', stocks: p.stocks, soldCount: p.soldCount, updatedAt: p.updatedAt,
});
export { forbidden };
