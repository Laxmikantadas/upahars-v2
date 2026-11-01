import { z } from 'zod';
import { createHmac } from 'node:crypto';

const bool = (d) => z.enum(['true', 'false']).default(d ? 'true' : 'false').transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(5000),
  MONGODB_URI: z.string().optional(),
  MONGO_URI: z.string().optional(), // alias, either name works
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ENCRYPTION_KEY: z.string().optional(), // base64, 32 bytes — payout details are encrypted with it
  ATTRIBUTION_SECRET: z.string().optional(),
  CLIENT_ORIGINS: z.string().default('http://localhost:5173'),
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),
  TRUST_PROXY: bool(false),
  // Administrators must use two-factor authentication. Default: on (off only under NODE_ENV=test).
  REQUIRE_ADMIN_2FA: z.enum(['true', 'false']).optional(),
  // Comma-separated 10-digit mobile numbers that are always administrators. They sign in on /admin/login with the normal phone OTP.
  ADMIN_PHONES: z.string().default('8018811056'),

  OTP_PROVIDER: z.enum(['console', 'msg91']).default('console'),
  MSG91_WIDGET_ID: z.string().optional(),
  MSG91_WIDGET_TOKEN: z.string().optional(),
  MSG91_AUTH_KEY: z.string().optional(),
  MSG91_TEMPLATE_ID: z.string().optional(), // set = our backend makes + checks the code, MSG91 only sends the SMS
  OTP_DEV_ECHO: bool(false), // returns the OTP in the API response — development only

  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  // Shipex courier API (pincode serviceability). The token itself is generated in the admin panel and stored in the database.
  SHIPEX_BASE_URL: z.string().url().default('https://api.shipexindia.com/v1/api/external'),
  SHIPEX_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(8000),
  SHIPEX_TOKEN_TTL_HOURS: z.coerce.number().min(1).max(168).default(24), // used only if the JWT carries no exp
  SHIPEX_EXPIRY_WARN_HOURS: z.coerce.number().min(0.1).max(24).default(2), // admin panel turns amber this long before expiry
  SHIPEX_ENFORCE_AT_CHECKOUT: bool(true), // refuse an order to a pincode Shipex says it cannot reach
  SHIPEX_DEFAULT_PICKUP_PINCODE: z.string().regex(/^[1-9]\d{5}$/).optional(), // used for products that have no pickup pincode yet

  PAYMENT_PROVIDER: z.enum(['razorpay', 'mock', 'none']).default('mock'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
});

const derive = (secret, label) => createHmac('sha256', secret).update(label).digest();

export function loadConfig(env = process.env) {
  const e = schema.parse(env);
  const prod = e.NODE_ENV === 'production';
  const origins = e.CLIENT_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);

  if (prod) {
    const problems = [];
    if (e.PAYMENT_PROVIDER === 'mock') problems.push('PAYMENT_PROVIDER=mock is not allowed in production');
    if (e.OTP_DEV_ECHO) problems.push('OTP_DEV_ECHO must be false in production');
    if (e.OTP_PROVIDER === 'console') problems.push('OTP_PROVIDER=console is not allowed in production (set OTP_PROVIDER=msg91)');
    if (e.OTP_PROVIDER === 'msg91' && !(e.MSG91_AUTH_KEY && (e.MSG91_TEMPLATE_ID || (e.MSG91_WIDGET_ID && e.MSG91_WIDGET_TOKEN)))) problems.push('OTP_PROVIDER=msg91 needs MSG91_AUTH_KEY plus either MSG91_TEMPLATE_ID or MSG91_WIDGET_ID and MSG91_WIDGET_TOKEN');
    if (!e.ENCRYPTION_KEY) problems.push('ENCRYPTION_KEY is required in production');
    if (origins.some((o) => !o.startsWith('https://'))) problems.push('CLIENT_ORIGINS must be https in production');
    if (e.PAYMENT_PROVIDER === 'razorpay' && !(e.RAZORPAY_KEY_ID && e.RAZORPAY_KEY_SECRET && e.RAZORPAY_WEBHOOK_SECRET))
      problems.push('Razorpay key id, key secret and webhook secret are required');
    if (problems.length) throw new Error('Unsafe production configuration:\n - ' + problems.join('\n - '));
  }

  return {
    ...e,
    MONGODB_URI: e.MONGODB_URI ?? e.MONGO_URI ?? 'mongodb://127.0.0.1:27017/upahars',
    isProd: prod,
    requireAdmin2fa: e.REQUIRE_ADMIN_2FA ? e.REQUIRE_ADMIN_2FA === 'true' : e.NODE_ENV !== 'test',
    origins,
    adminPhones: e.ADMIN_PHONES.split(',').map((x) => x.trim()).filter((x) => /^[6-9]\d{9}$/.test(x)),
    cookieSecure: e.COOKIE_SECURE ? e.COOKIE_SECURE === 'true' : prod,
    encryptionKey: e.ENCRYPTION_KEY ? Buffer.from(e.ENCRYPTION_KEY, 'base64') : derive(e.JWT_SECRET, 'dev-encryption-key'),
    attributionSecret: e.ATTRIBUTION_SECRET ?? derive(e.JWT_SECRET, 'attribution').toString('hex'),
    cloudinary: { cloudName: e.CLOUDINARY_CLOUD_NAME, apiKey: e.CLOUDINARY_API_KEY, apiSecret: e.CLOUDINARY_API_SECRET },
  };
}
