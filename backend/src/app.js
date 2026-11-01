import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { asyncHandler, errorMiddleware } from './lib/errors.js';
import { limiters } from './middleware/limits.js';
import { loadUser, originGuard } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import publicRoutes from './routes/public.js';
import orderRoutes from './routes/orders.js';
import sellerRoutes from './routes/seller.js';
import adminRoutes from './routes/admin.js';
import miscRoutes from './routes/misc.js';
import shippingRoutes from './routes/shipping.js';
import { createShipexService } from './services/shipex.js';

export function createApp({ config, orders, sms, logger = console, shipex = createShipexService({ config }) }) {
  const app = express();
  if (config.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.locals.requireAdmin2fa = Boolean(config.requireAdmin2fa);
  app.use(helmet());
  app.use(cors({ origin: (o, cb) => cb(null, !o || config.origins.includes(o)), credentials: true }));
  app.use(cookieParser());
  const limits = limiters(config);

  // Payment gateway webhook: needs the RAW body to verify the signature, so it is mounted before express.json()
  app.post('/api/payments/webhook/razorpay', express.raw({ type: '*/*', limit: '200kb' }), asyncHandler(async (req, res) => {
    await orders.handleWebhook({ rawBody: Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '', signature: req.get('x-razorpay-signature'), eventId: req.get('x-razorpay-event-id') });
    res.json({ ok: true });
  }));

  app.use('/api', limits.api);
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', originGuard(config));
  app.use('/api', loadUser(config));

  app.get('/api/health', (_req, res) => res.json({ ok: true, payments: orders.provider.name, sms: sms.name, uploads: Object.values(config.cloudinary).every(Boolean) ? 'cloudinary' : 'not_configured' }));
  app.use('/api', authRoutes({ config, sms, limits }));
  app.use('/api', publicRoutes({ config, limits }));
  app.use('/api', shippingRoutes({ config, limits, shipex }));
  app.use('/api', orderRoutes({ config, limits, orders, shipex }));
  app.use('/api', sellerRoutes({ config, limits, orders }));
  app.use('/api', adminRoutes({ config, orders }));
  app.use('/api', miscRoutes({ config, limits }));

  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'No such endpoint' } }));
  app.use(errorMiddleware(logger));
  return app;
}
