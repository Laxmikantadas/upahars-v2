import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, badRequest, forbidden, notFound, HttpError } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { Order, Product, Seller, Ticket, User } from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { originalsFolder, signUpload, sellerFolder, siteFolder } from '../lib/cloudinary.js';
import { publicProducts } from '../services/catalog.js';

const oid = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');

export default function miscRoutes({ config, limits }) {
  const r = Router();

  /* image uploads: server signs, browser uploads straight to Cloudinary */
  r.post('/uploads/sign', requireAuth, limits.upload, validate(z.object({ scope: z.enum(['seller', 'originals', 'site']).default('seller') }).strict()), asyncHandler(async (req, res) => {
    let folder;
    if (req.body.scope === 'seller') {
      const s = await Seller.findOne({ userId: req.user._id });
      if (!s || ['rejected', 'suspended'].includes(s.status)) throw forbidden('Only active sellers can upload store images');
      folder = sellerFolder(s._id);
    } else {
      if (!req.user.roles.includes('admin')) throw forbidden('Administrators only');
      folder = req.body.scope === 'originals' ? originalsFolder() : siteFolder();
    }
    const sig = signUpload(config.cloudinary, { folder });
    if (!sig) throw new HttpError(503, 'uploads_not_configured', 'Image uploads are not configured yet (Cloudinary credentials missing)');
    res.json({ upload: sig });
  }));

  /* wishlist */
  r.get('/me/wishlist', requireAuth, asyncHandler(async (req, res) => {
    const docs = await Product.find({ _id: { $in: req.user.wishlist }, status: 'published', sellerActive: true }).lean();
    res.json({ products: await publicProducts(docs) });
  }));
  r.put('/me/wishlist/:productId', requireAuth, validate(z.object({ productId: oid }), 'params'), asyncHandler(async (req, res) => {
    if (!(await Product.exists({ _id: req.params.productId, status: 'published' }))) throw notFound('Product not found');
    if (req.user.wishlist.length >= 200) throw badRequest('Wishlist is full');
    await User.updateOne({ _id: req.user._id }, { $addToSet: { wishlist: req.params.productId } });
    res.json({ ok: true });
  }));
  r.delete('/me/wishlist/:productId', requireAuth, validate(z.object({ productId: oid }), 'params'), asyncHandler(async (req, res) => {
    await User.updateOne({ _id: req.user._id }, { $pull: { wishlist: req.params.productId } });
    res.json({ ok: true });
  }));

  /* support & disputes */
  const view = (t) => ({ id: String(t._id), type: t.type, subject: t.subject, status: t.status, orderId: t.orderId ? String(t.orderId) : null, messages: t.messages.map((m) => ({ role: m.role, text: m.text, at: m.at })), createdAt: t.createdAt });
  r.post('/support/tickets', requireAuth, limits.api, validate(z.object({ subject: z.string().trim().min(3).max(120), message: z.string().trim().min(3).max(2000), type: z.enum(['support', 'dispute']).default('support'), orderNumber: z.string().max(30).optional() }).strict()), asyncHandler(async (req, res) => {
    const seller = await Seller.findOne({ userId: req.user._id });
    let orderId = null;
    if (req.body.orderNumber) {
      const o = await Order.findOne({ orderNumber: req.body.orderNumber });
      const involved = o && (String(o.userId) === String(req.user._id) || (seller && o.shipments.some((s) => String(s.sellerId) === String(seller._id))));
      if (!involved) throw notFound('Order not found'); // can't probe other people's orders
      orderId = o._id;
    }
    const t = await Ticket.create({ userId: req.user._id, sellerId: seller?._id ?? null, orderId, type: req.body.type, subject: req.body.subject, messages: [{ by: req.user._id, role: seller && !orderId ? 'seller' : 'customer', text: req.body.message }] });
    res.status(201).json({ ticket: view(t) });
  }));
  r.get('/support/tickets', requireAuth, asyncHandler(async (req, res) => res.json({ tickets: (await Ticket.find({ userId: req.user._id }).sort({ updatedAt: -1 }).limit(100)).map(view) })));
  r.post('/support/tickets/:id/messages', requireAuth, limits.api, validate(z.object({ text: z.string().trim().min(1).max(2000) }).strict()), asyncHandler(async (req, res) => {
    const t = await Ticket.findOne({ _id: req.params.id, userId: req.user._id });
    if (!t) throw notFound('Ticket not found');
    if (t.status === 'closed') throw badRequest('This ticket is closed');
    t.messages.push({ by: req.user._id, role: 'customer', text: req.body.text }); t.status = 'open'; await t.save();
    res.json({ ticket: view(t) });
  }));
  return r;
}
