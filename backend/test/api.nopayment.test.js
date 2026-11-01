import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADDRESS, login, makeProduct, resetDb, seedTaxonomy, stopDb } from './helpers.js';
import { loadConfig } from '../src/config.js';
import { connectDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createNoPaymentProvider } from '../src/lib/payments.js';
import { createSmsProvider } from '../src/lib/sms.js';
import { createOrderService } from '../src/services/orders.js';

let app;
beforeAll(async () => {
  const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: 'test-secret-test-secret-test-secret-1234', OTP_DEV_ECHO: 'true', CLIENT_ORIGINS: 'http://localhost:5173', PAYMENT_PROVIDER: 'none', MONGODB_URI: process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/upahars_test' });
  await connectDb(config.MONGODB_URI);
  app = createApp({ config, orders: createOrderService({ config, provider: createNoPaymentProvider() }), sms: createSmsProvider(config, { info() {} }), logger: { error() {} } });
});
afterAll(stopDb);
beforeEach(async () => { await resetDb(); await seedTaxonomy(); });

describe('PAYMENT_PROVIDER=none', () => {
  it('confirms the order at checkout with no payment step', async () => {
    const p = await makeProduct(); const a = await login(app);
    const r = await a.post('/api/orders/checkout').send({ items: [{ productId: String(p._id), qty: 1 }], address: ADDRESS });
    expect(r.status).toBe(201);
    expect(r.body.payment).toBeNull();
    expect(r.body.order.status).toBe('paid');
    expect((await a.get('/api/health')).body.payments).toBe('none');
  });
});
