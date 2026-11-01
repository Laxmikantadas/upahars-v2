import mongoose from 'mongoose';
import request from 'supertest';
import { loadConfig } from '../src/config.js';
import { connectDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createMockProvider } from '../src/lib/payments.js';
import { createSmsProvider } from '../src/lib/sms.js';
import { createOrderService } from '../src/services/orders.js';
import { createShipexService } from '../src/services/shipex.js';
import { Inventory, OtpChallenge, OtpThrottle, Product, Seller, Taxonomy, User } from '../src/models/index.js';

export const ORIGIN = 'http://localhost:5173';
export const CLOUD = 'democloud';
const baseEnv = {
  NODE_ENV: 'test', JWT_SECRET: 'test-secret-test-secret-test-secret-1234', OTP_DEV_ECHO: 'true', CLIENT_ORIGINS: ORIGIN,
  CLOUDINARY_CLOUD_NAME: CLOUD, CLOUDINARY_API_KEY: '123456', CLOUDINARY_API_SECRET: 'cloud-secret', PAYMENT_PROVIDER: 'mock',
  MONGODB_URI: process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/upahars_test',
};

export async function startApp(env = {}, { sms, fetchImpl } = {}) {
  const config = loadConfig({ ...baseEnv, ...env });
  await connectDb(config.MONGODB_URI);
  const provider = createMockProvider(config);
  const orders = createOrderService({ config, provider });
  const shipex = createShipexService({ config, fetchImpl: fetchImpl ?? (async () => { throw new Error('no network in tests'); }) });
  const app = createApp({ config, orders, sms: sms ?? createSmsProvider(config, { info() {} }), logger: process.env.TEST_LOG ? console : { error() {} }, shipex });
  return { app, config, provider, orders, shipex };
}

export async function resetDb() {
  await Promise.all(Object.values(mongoose.models).map((m) => m.deleteMany({})));
}
export const stopDb = () => mongoose.disconnect();

export const client = (app) => request.agent(app).set('Origin', ORIGIN);

let phoneSeq = 6000000000;
export const newPhone = () => String(++phoneSeq);

/** Signs in through the real OTP endpoints and returns an agent holding the session cookie. */
export async function login(app, phone = newPhone(), name = 'Test User') {
  await OtpChallenge.deleteMany({ phone }); await OtpThrottle.deleteMany({ phone });
  const a = client(app);
  const r1 = await a.post('/api/auth/otp/request').send({ phone });
  if (r1.status !== 200) throw new Error('otp request failed ' + JSON.stringify(r1.body));
  const r2 = await a.post('/api/auth/otp/verify').send({ phone, code: r1.body.devCode, name });
  if (r2.status !== 200) throw new Error('otp verify failed ' + JSON.stringify(r2.body));
  a.user = r2.body.user; a.phone = phone;
  a.sessionCookie = r2.headers['set-cookie'].find((c) => c.startsWith('upahars_session=')).split(';')[0];
  return a;
}
export async function loginAdmin(app) {
  const phone = newPhone();
  await User.create({ phone, name: 'Admin', roles: ['customer', 'admin'] });
  return login(app, phone, 'Admin');
}

export async function seedTaxonomy() {
  await Taxonomy.create([
    { type: 'category', name: 'Candles', slug: 'candles' }, { type: 'category', name: 'Home Decor', slug: 'home-decor' },
    { type: 'occasion', name: 'Birthday', slug: 'birthday' }, { type: 'occasion', name: 'Diwali', slug: 'diwali' },
    { type: 'collection', name: 'Festive', slug: 'festive' },
  ]);
}

/** Creates an approved seller (through the real apply + admin approve endpoints) and returns { agent, seller }. */
export async function makeApprovedSeller(app, admin, slug, opts = {}) {
  const agent = await login(app, newPhone(), `${slug} owner`);
  const r = await agent.post('/api/seller/apply').send({ businessName: `${slug} Biz`, ownerName: 'Owner Name', businessType: 'individual', city: 'Bhubaneswar', state: 'Odisha', storeName: `${slug} Store`, slug, ...opts.application });
  if (r.status !== 201) throw new Error('apply failed ' + JSON.stringify(r.body));
  const approve = await admin.post(`/api/admin/sellers/${r.body.seller.id}/approve`).send({});
  if (approve.status !== 200) throw new Error('approve failed ' + JSON.stringify(approve.body));
  const seller = await Seller.findById(r.body.seller.id);
  agent.sellerId = String(seller._id);
  return { agent, seller };
}

export const imageUrl = (folder, name = 'a.jpg') => `https://res.cloudinary.com/${CLOUD}/image/upload/v1700000000/${folder}/${name}`;

/** Inserts a published product directly (fast path for checkout tests). */
export async function makeProduct({ title = 'Test Candle', seller = null, pricePaise = 49900, stock = 10, variants = [], customizable = false, status = 'published', extra = {} } = {}) {
  const p = await Product.create({
    ownerType: seller ? 'seller' : 'upahars', sellerId: seller?._id ?? null, title, slug: `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Math.random().toString(36).slice(2, 7)}`,
    category: 'candles', pricePaise: variants.length ? Math.min(...variants.map((v) => v.pricePaise)) : pricePaise, variants, status, isCustomizable: customizable,
    customization: customizable ? { prompt: 'Name', maxLength: 30 } : undefined, sellerActive: true, publishedAt: new Date(), ...extra,
  });
  if (variants.length) for (const v of p.variants) await Inventory.create({ productId: p._id, variantId: v._id, stock });
  else await Inventory.create({ productId: p._id, variantId: null, stock });
  return p;
}
export const stockOf = async (p, variantId = null) => (await Inventory.findOne({ productId: p._id, variantId }))?.stock;

export const ADDRESS = { name: 'Test Buyer', phone: '9876543210', email: '', line: '12 Demo Street, Saheed Nagar', city: 'Bhubaneswar', state: 'Odisha', pincode: '751007' };

/** Tests that depend on MongoDB's single-document atomicity (stock races, order locks). FerretDB — the stand-in used
 *  when no real MongoDB is available — does not provide it, so these run only with TEST_REAL_MONGO=1 against a real mongod. */
export const REAL_MONGO = process.env.TEST_REAL_MONGO === '1';
