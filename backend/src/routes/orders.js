import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { Order } from '../models/index.js';
import { requireAuth } from '../middleware/auth.js';
import { getSettings } from '../services/settings.js';
import { quoteCart, quoteView } from '../services/pricing.js';
import { ATTR_COOKIE, resolveAttribution } from '../services/attribution.js';
import { customerOrderView } from '../services/orders.js';
import { assertDeliverable as assertDeliverableAt } from '../services/shipex.js';

const oid = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const cartItem = z.object({ productId: oid, variantId: oid.optional(), qty: z.number().int().min(1).max(100), customization: z.string().max(200).optional() }).strict();
const cart = z.array(cartItem).min(1).max(50);
const address = z.object({
  name: z.string().trim().min(2).max(80), phone: z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number'),
  email: z.string().trim().email().max(120).or(z.literal('')).default(''), line: z.string().trim().min(6).max(200),
  city: z.string().trim().min(2).max(60), state: z.string().trim().min(2).max(60), pincode: z.string().regex(/^[1-9]\d{5}$/, 'Enter a 6-digit pincode'),
}).strict();

export default function orderRoutes({ config, limits, orders, shipex }) {
  const assertDeliverable = (items, pincode) => assertDeliverableAt({ shipex, config, items, pincode });
  const r = Router();

  r.post('/orders/quote', limits.api, validate(z.object({ items: cart, couponCode: z.string().trim().max(24).optional() }).strict()), asyncHandler(async (req, res) => {
    const settings = await getSettings();
    const q = await quoteCart({ items: req.body.items, userId: req.user?._id, couponCode: req.body.couponCode || undefined, settings });
    res.json({ quote: quoteView(q) });
  }));

  r.post('/orders/checkout', requireAuth, limits.checkout, validate(z.object({ items: cart, address, couponCode: z.string().trim().max(24).optional() }).strict()), asyncHandler(async (req, res) => {
    const key = req.get('idempotency-key');
    if (key && !/^[A-Za-z0-9_-]{8,64}$/.test(key)) throw badRequest('Invalid Idempotency-Key');
    await assertDeliverable(req.body.items.map((i) => ({ productId: i.productId, variantId: i.variantId, qty: i.qty })), req.body.address.pincode);
    const settings = await getSettings();
    const attribution = await resolveAttribution({ config, settings, cookieValue: req.cookies?.[ATTR_COOKIE], buyerUserId: req.user._id });
    const { order, checkout, reused } = await orders.checkout({ user: req.user, items: req.body.items, address: req.body.address, couponCode: req.body.couponCode || undefined, idempotencyKey: key, attribution });
    res.status(reused ? 200 : 201).json({ order: customerOrderView(order), payment: checkout });
  }));

  r.get('/orders', requireAuth, asyncHandler(async (req, res) => {
    const rows = await Order.find({ userId: req.user._id, status: { $ne: 'expired' } }).sort({ createdAt: -1 }).limit(100);
    res.json({ orders: rows.map(customerOrderView) });
  }));
  // ownership is part of the query, so another customer's order number simply returns 404
  r.get('/orders/:orderNumber', requireAuth, asyncHandler(async (req, res) => {
    const o = await Order.findOne({ orderNumber: req.params.orderNumber, userId: req.user._id });
    if (!o) throw notFound('Order not found');
    res.json({ order: customerOrderView(o) });
  }));
  r.post('/orders/:orderNumber/cancel', requireAuth, asyncHandler(async (req, res) => {
    const o = await orders.cancelByCustomer({ user: req.user, orderNumber: req.params.orderNumber });
    res.json({ order: customerOrderView(o) });
  }));

  r.post('/payments/verify', requireAuth, limits.checkout, validate(z.object({ orderNumber: z.string().max(30), paymentId: z.string().min(5).max(80), signature: z.string().min(10).max(200) }).strict()), asyncHandler(async (req, res) => {
    const { order, changed } = await orders.verifyAndConfirm({ user: req.user, ...req.body });
    res.json({ order: customerOrderView(order), changed });
  }));

  // DEVELOPMENT ONLY — exists only with the mock provider and never in production
  if (orders.provider.name === 'mock' && !config.isProd) {
    r.post('/dev/payments/simulate', requireAuth, validate(z.object({ orderNumber: z.string().max(30), outcome: z.enum(['success', 'failure']).default('success') }).strict()), asyncHandler(async (req, res) => {
      const o = await Order.findOne({ orderNumber: req.body.orderNumber, userId: req.user._id });
      if (!o) throw notFound('Order not found');
      const sim = orders.provider._simulate(o.payment.providerOrderId, req.body.outcome);
      const out = await orders.verifyAndConfirm({ user: req.user, orderNumber: o.orderNumber, paymentId: sim.paymentId, signature: sim.signature });
      res.json({ order: customerOrderView(out.order), note: 'Simulated payment (development only)' });
    }));
  }
  return r;
}
