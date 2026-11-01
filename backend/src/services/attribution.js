import { hmacB64url, hmacHex, safeEqual } from '../lib/crypto.js';
import { Seller, Touch } from '../models/index.js';
import { badRequest } from '../lib/errors.js';

// Attribution policy (also documented in docs/ATTRIBUTION.md):
//  * A visit through /store/<slug>?ref=<slug> (or a product link carrying ?ref=) makes the browser call
//    POST /api/attribution/touch. The SERVER validates that the store is approved and active, records the
//    evidence (Touch) and sets a signed, HttpOnly cookie. Nothing the browser sends at checkout can name a seller.
//  * Window and policy (last_touch | first_touch) are admin settings.
//  * At checkout the server verifies the cookie signature and window, then snapshots the attribution onto the order.
//  * The seller link rate only applies to items sold by the referring seller. Items from other sellers use the
//    marketplace rate; Upahars Originals carry no seller commission. So a link can never earn commission on
//    another seller's goods, and no item is ever charged twice.
export const ATTR_COOKIE = 'upahars_ref';

export const signAttribution = (secret, payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${hmacB64url(secret, body)}`;
};
export function readAttribution(secret, value, { now = Date.now(), windowDays }) {
  if (typeof value !== 'string' || !value.includes('.')) return null;
  const [body, sig] = value.split('.');
  if (!safeEqual(hmacB64url(secret, body), sig)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p?.s || !p?.t || typeof p.at !== 'number') return null;
    if (now - p.at > windowDays * 86400000 || p.at > now + 60000) return null;
    return p;
  } catch { return null; }
}
export const cookieOptions = (config, windowDays) => ({ httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: windowDays * 86400000, path: '/' });

const cleanPath = (p) => {
  const s = String(p ?? '/');
  if (!s.startsWith('/') || s.startsWith('//') || s.length > 300) return '/';
  return s.split('#')[0].slice(0, 300);
};

export async function recordTouch({ config, settings, slug, landingPath, referrer, ip, ua, userId, existingCookie }) {
  const seller = await Seller.findOne({ 'store.slug': String(slug).toLowerCase() }).lean();
  if (!seller || seller.status !== 'approved' || seller.store.isPaused) throw badRequest('That store link is not active', 'invalid_ref');
  const { windowDays, policy } = settings.attribution;
  const existing = readAttribution(config.attributionSecret, existingCookie, { windowDays });
  const keepFirst = policy === 'first_touch' && existing;
  const touch = await Touch.create({
    sellerId: seller._id, landingPath: cleanPath(landingPath), referrer: String(referrer ?? '').slice(0, 300),
    ipHash: hmacHex(config.attributionSecret, String(ip ?? '')).slice(0, 32), uaHash: hmacHex(config.attributionSecret, String(ua ?? '')).slice(0, 16),
    userId: userId ?? null, applied: !keepFirst,
  });
  if (keepFirst) return { cookie: null, touch, applied: false };
  const cookie = signAttribution(config.attributionSecret, { s: String(seller._id), t: String(touch._id), at: Date.now(), l: touch.landingPath });
  return { cookie, touch, applied: true };
}

/** Called during checkout. Returns a verified attribution snapshot or null. */
export async function resolveAttribution({ config, settings, cookieValue, buyerUserId }) {
  const { windowDays, policy } = settings.attribution;
  const p = readAttribution(config.attributionSecret, cookieValue, { windowDays });
  if (!p) return null;
  const seller = await Seller.findById(p.s).lean();
  if (!seller || seller.status !== 'approved' || seller.store.isPaused) return null;
  if (String(seller.userId) === String(buyerUserId)) return null; // no commission games on your own purchases
  return { sellerId: seller._id, touchId: p.t, landingPath: p.l, touchedAt: new Date(p.at), policy, windowDays };
}
