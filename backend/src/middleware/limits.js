import rateLimit from 'express-rate-limit';
const make = (config, windowMs, max, message) => rateLimit({
  windowMs, max: config.NODE_ENV === 'test' ? 100000 : max, standardHeaders: true, legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: { code: 'rate_limited', message } }),
});
export const limiters = (config) => ({
  api: make(config, 60_000, 300, 'Too many requests. Please slow down.'),
  // per-IP ceilings are generous on purpose (mobile networks share IPs); the real brute-force limits are per phone / per account
  otp: make(config, 15 * 60_000, 40, 'Too many code requests. Please try again later.'),
  twofa: make(config, 15 * 60_000, 40, 'Too many attempts. Please try again later.'),
  touch: make(config, 60_000, 60, 'Too many requests.'),
  checkout: make(config, 60_000, 20, 'Too many checkout attempts. Please wait a minute.'),
  upload: make(config, 60_000, 30, 'Too many upload requests.'),
});
