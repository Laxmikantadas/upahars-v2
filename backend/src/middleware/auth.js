import jwt from 'jsonwebtoken';
import { forbidden, HttpError, unauthorized } from '../lib/errors.js';
import { Seller, User } from '../models/index.js';

export const SESSION_COOKIE = 'upahars_session';
// Every token carries a type so a short-lived 2FA challenge can never be used as a session cookie.
export const signSession = (config, userId) => jwt.sign({ sub: String(userId), typ: 'session' }, config.JWT_SECRET, { algorithm: 'HS256', expiresIn: '7d' });
const mfaKey = (config) => `${config.JWT_SECRET}:mfa-challenge`;
export const signMfaChallenge = (config, userId) => jwt.sign({ sub: String(userId), typ: 'mfa' }, mfaKey(config), { algorithm: 'HS256', expiresIn: '5m' });
export const verifyMfaChallenge = (config, token) => {
  try { const p = jwt.verify(token, mfaKey(config), { algorithms: ['HS256'] }); return p.typ === 'mfa' ? String(p.sub) : null; } catch { return null; }
};
export const sessionCookieOptions = (config) => ({ httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: 7 * 86400000, path: '/' });

/** Loads the user from the session cookie on EVERY request, so suspensions and role changes apply immediately. */
export const loadUser = (config) => async (req, _res, next) => {
  req.user = null;
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    try {
      const p = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
      if (p.typ !== 'session') throw new Error('not a session token');
      const u = await User.findById(p.sub);
      if (u && !u.isSuspended) req.user = u;
    } catch { /* invalid/expired → anonymous */ }
  }
  next();
};

export const requireAuth = (req, _res, next) => (req.user ? next() : next(unauthorized()));
export const requireAdmin = (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  if (!req.user.roles.includes('admin')) return next(forbidden('Administrators only'));
  if (req.app.locals.requireAdmin2fa && !req.user.twoFactor?.enabled) return next(new HttpError(403, 'two_factor_setup_required', 'Set up two-factor authentication to use the admin panel'));
  next();
};

/** Seller routes: the seller is ALWAYS derived from the signed-in user, never from a request parameter. */
export const requireSeller = async (req, _res, next) => {
  try {
    if (!req.user) throw unauthorized();
    const s = await Seller.findOne({ userId: req.user._id });
    if (!s) throw forbidden('You do not have a seller account');
    if (s.status !== 'approved') throw forbidden(`Your seller account is ${s.status}`);
    req.seller = s; next();
  } catch (e) { next(e); }
};
export const loadSellerAnyStatus = async (req, _res, next) => {
  try { if (!req.user) throw unauthorized(); req.seller = await Seller.findOne({ userId: req.user._id }); next(); } catch (e) { next(e); }
};

/** Blocks cross-site state-changing requests that carry the session cookie (CSRF defence on top of SameSite=Lax). */
export const originGuard = (config) => (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin ? !config.origins.includes(origin) : Boolean(req.cookies?.[SESSION_COOKIE])) return next(forbidden('Request origin not allowed'));
  next();
};
