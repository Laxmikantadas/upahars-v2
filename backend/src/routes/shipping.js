import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../lib/errors.js';
import { validate } from '../lib/validate.js';
import { requireAdmin } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { paymentTypeFor } from '../services/shipex.js';

const oid = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid id');
const pincode = z.string().regex(/^[1-9]\d{5}$/, 'Pincode must be exactly 6 digits');

/**
 * Admin:  GET/POST/DELETE /api/admin/shipping/token   (status incl. expiry / generate / forget)
 *         POST /api/admin/shipping/test               (try a pincode pair from the panel)
 * Public: POST /api/shipping/serviceability           (product page + checkout)
 */
export default function shippingRoutes({ config, limits, shipex }) {
  const r = Router();

  /* ── admin ── */
  r.use('/admin/shipping', requireAdmin);

  r.get('/admin/shipping/token', asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ token: await shipex.status() });
  }));

  // Generating a token calls Shipex with the admin's own credentials, so it has its own (tighter) rate limit.
  r.post('/admin/shipping/token', limits.checkout, validate(z.object({ email: z.string().trim().toLowerCase().email().max(120), password: z.string().min(1).max(200) }).strict()), asyncHandler(async (req, res) => {
    const row = await shipex.generateToken({ email: req.body.email, password: req.body.password, adminId: req.user._id });
    await audit(req, 'shipping.token_generate', 'shipping_token', row._id, { email: row.email, expiresAt: row.expiresAt }); // never the token or password
    res.set('Cache-Control', 'no-store');
    res.status(201).json({ token: await shipex.status() });
  }));

  r.delete('/admin/shipping/token', asyncHandler(async (req, res) => {
    await shipex.clearToken();
    await audit(req, 'shipping.token_clear', 'shipping_token', 'shipex');
    res.json({ token: await shipex.status() });
  }));

  r.post('/admin/shipping/test', limits.api, validate(z.object({
    pickUpPincode: pincode, deliveryPincode: pincode, paymentType: z.enum(['COD', 'Prepaid']).default('Prepaid'),
    applicableWeight: z.number().min(0.1).max(500).default(0.5), length: z.number().min(1).max(300).default(10), width: z.number().min(1).max(300).default(10),
    height: z.number().min(1).max(300).default(10), declaredValue: z.number().min(1).max(10_000_000).default(500),
  }).strict()), asyncHandler(async (req, res) => {
    res.json({ result: await shipex.checkPair(req.body) });
  }));

  /* ── customers ── */
  // The browser only says WHICH products and WHERE to deliver. Pickup pincode, weight, size and value are read from our database.
  r.post('/shipping/serviceability', limits.api, validate(z.object({
    deliveryPincode: pincode,
    items: z.array(z.object({ productId: oid, variantId: oid.optional(), qty: z.number().int().min(1).max(100).default(1) }).strict()).min(1).max(50),
  }).strict()), asyncHandler(async (req, res) => {
    const out = await shipex.checkItems({ items: req.body.items, deliveryPincode: req.body.deliveryPincode, paymentType: paymentTypeFor(config) });
    res.json(out);
  }));

  return r;
}
