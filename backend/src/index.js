import './lib/loadEnv.js'; // loads .env (works on every Node 18+)
import { loadConfig } from './config.js';
import { connectDb } from './db.js';
import { createApp } from './app.js';
import { createSmsProvider } from './lib/sms.js';
import { createPaymentProvider } from './lib/payments.js';
import { createOrderService } from './services/orders.js';
import { ensureDefaultCategories } from './services/bootstrap.js';

const config = loadConfig();
await connectDb(config.MONGODB_URI);
await ensureDefaultCategories().catch((e) => console.error('[bootstrap]', e.message));
const orders = createOrderService({ config, provider: createPaymentProvider(config) });
const app = createApp({ config, orders, sms: createSmsProvider(config) });

// release stock held by unpaid orders
setInterval(() => orders.releaseExpired().catch((e) => console.error('[release-expired]', e.message)), 60_000).unref();

const server = app.listen(config.PORT, () => console.log(`Upahars API on :${config.PORT} (payments=${orders.provider.name}, env=${config.NODE_ENV})`));
const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop); process.on('SIGINT', stop);
