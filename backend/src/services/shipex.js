import https from 'node:https';
import { badRequest, HttpError } from '../lib/errors.js';
import { decryptJson, encryptJson } from '../lib/crypto.js';
import { Product, ShippingToken, User } from '../models/index.js';

/**
 * Shipex courier integration.
 *   1. An administrator types the Shipex e-mail + password in the admin panel → generateToken() → JWT.
 *   2. The JWT is stored (encrypted) in MongoDB together with its expiry. The password is never stored.
 *   3. Every serviceability check reads the stored token. When it has expired (≈24 h) the check is refused with
 *      `shipex_token_expired` and the admin panel shows a red "regenerate" banner.
 */

const PROVIDER = 'shipex';
const MIN_WEIGHT_KG = 0.5; // couriers bill at least 0.5 kg
const DEFAULT_DIM_CM = 10;
const CACHE_MS = 10 * 60_000;
const CLOCK_SKEW_MS = 30_000; // treat a token as expired 30 s early so a call never races the expiry

export const paymentTypeFor = () => 'Prepaid'; // Shipex is always asked about Prepaid parcels

export const tokenError = (code, message, status = 409) => new HttpError(status, code, message);

/** Reads the `exp` (seconds) claim of a JWT WITHOUT verifying it (we are not the issuer; we only need the expiry time). */
export function jwtExpiry(token) {
  try {
    const payload = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    return Number.isFinite(payload.exp) ? new Date(payload.exp * 1000) : null;
  } catch { return null; }
}

/** none | active | expiring (inside the warning window) | expired */
export function tokenState(row, now = Date.now(), warnMs = 2 * 3600_000) {
  if (!row?.tokenEnc) return 'none';
  if (row.expiredAt) return 'expired';
  const left = new Date(row.expiresAt).getTime() - now;
  if (left <= CLOCK_SKEW_MS) return 'expired';
  return left <= warnMs ? 'expiring' : 'active';
}

/** Admin-facing view. NEVER contains the token. */
export function tokenView(row, { now = Date.now(), warnMs = 2 * 3600_000 } = {}) {
  const state = tokenState(row, now, warnMs);
  if (state === 'none') return { configured: false, state, lastError: row?.lastError || '' };
  const expiresAt = new Date(row.expiresAt);
  return {
    configured: true, state, email: row.email, issuedAt: row.issuedAt, expiresAt,
    secondsLeft: Math.max(0, Math.floor((expiresAt.getTime() - now) / 1000)),
    serverTime: new Date(now), warnSeconds: Math.round(warnMs / 1000), generatedBy: null,
    lastError: row.lastError || '', lastErrorAt: row.lastErrorAt ?? null, lastCheckAt: row.lastCheckAt ?? null,
    expiredEarly: Boolean(row.expiredAt),
  };
}

const pin = /^[1-9]\d{5}$/;
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Turns cart lines into one or more shipments (one per pickup pincode) with the weight / box / value Shipex needs.
 * Dimensions: the boxes are assumed to be stacked, so length & width are the largest, height is the sum.
 * Pure function (no I/O) so it is easy to test.
 */
export function buildShipments(lines, { defaultPickup } = {}) {
  const groups = new Map();
  const missing = [];
  for (const { product, qty, unitPaise } of lines) {
    const pickup = product.pickupPincode || defaultPickup || '';
    if (!pin.test(pickup)) { missing.push({ productId: String(product._id), title: product.title }); continue; }
    const g = groups.get(pickup) ?? { pickupPincode: pickup, weightKg: 0, length: 0, width: 0, height: 0, declaredValue: 0, productIds: [] };
    const s = product.shipping ?? {};
    g.weightKg += ((s.weightGrams || 0) / 1000) * qty;
    g.length = Math.max(g.length, s.lengthCm || DEFAULT_DIM_CM);
    g.width = Math.max(g.width, s.widthCm || DEFAULT_DIM_CM);
    g.height += (s.heightCm || DEFAULT_DIM_CM) * qty;
    g.declaredValue += (unitPaise * qty) / 100;
    g.productIds.push(String(product._id));
    groups.set(pickup, g);
  }
  const shipments = [...groups.values()].map((g) => ({
    pickupPincode: g.pickupPincode, productIds: g.productIds,
    applicableWeight: round2(Math.max(MIN_WEIGHT_KG, g.weightKg)), length: g.length, width: g.width, height: Math.min(300, g.height),
    declaredValue: Math.max(1, Math.round(g.declaredValue)),
  }));
  return { shipments, missing };
}

/** Node's fetch() refuses a GET that has a body. Used only for the GET + JSON body fallback. */
function rawRequest(url, { method, headers, body, signal }) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : Buffer.from(body);
    const req = https.request(url, { method, headers: { ...headers, ...(payload ? { 'Content-Length': payload.length } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, json: async () => JSON.parse(text) });
      });
    });
    req.on('error', reject);
    signal?.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; req.destroy(e); });
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Reads Shipex's pincodeServiceability answer.
 * Real shape: { status: "success", message, data: [ { courierServiceName, serviceable: true, forward: { finalCharges }, ... }, ... ] }
 * → serviceable when AT LEAST ONE courier in `data` says serviceable: true. Also still understands a plain top-level `serviceable`.
 */
export function parseServiceability(d) {
  const truthy = (v) => v === true || v === 1 || (typeof v === 'string' && ['true', 'yes', 'y', '1'].includes(v.trim().toLowerCase()));
  const message = String(d?.message ?? '');
  if (Array.isArray(d?.data)) {
    const ok = d.data.filter((c) => truthy(c?.serviceable));
    const prices = ok.map((c) => Number(c?.forward?.finalCharges)).filter(Number.isFinite);
    return {
      serviceable: ok.length > 0,
      message: ok.length ? `${ok.length} courier option${ok.length > 1 ? 's' : ''} available.` : (message || 'No courier can deliver here.'),
      couriers: ok.map((c) => ({ name: c.courierServiceName, charges: c?.forward?.finalCharges ?? null })),
      cheapest: prices.length ? Math.min(...prices) : null,
    };
  }
  const src = d && typeof d.data === 'object' && d.data !== null && d.serviceable === undefined ? d.data : (d ?? {});
  const raw = src.serviceable ?? src.isServiceable ?? src.is_serviceable ?? src.available;
  return { serviceable: truthy(raw), message: String(src.message ?? message) };
}

export function createShipexService({ config, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  const base = config.SHIPEX_BASE_URL.replace(/\/$/, '');
  const warnMs = config.SHIPEX_EXPIRY_WARN_HOURS * 3600_000;
  const cache = new Map(); // key → { at, value } — Shipex answers are stable for minutes; saves calls and speeds up the product page

  async function call(path, { method = 'POST', body, query, token } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.SHIPEX_TIMEOUT_MS);
    try {
      const qs = query ? `?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}` : '';
      const url = `${base}/${path}${qs}`;
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
      const json = body === undefined ? undefined : JSON.stringify(body);
      const send = method === 'GET' && json !== undefined && fetchImpl === globalThis.fetch ? rawRequest : fetchImpl;
      const res = await send(url, { method, signal: ctrl.signal, headers, body: json });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok, data };
    } catch (e) {
      throw tokenError('shipex_unreachable', e?.name === 'AbortError' ? 'The courier service took too long to answer.' : 'Could not reach the courier service.', 502);
    } finally { clearTimeout(timer); }
  }

  const row = () => ShippingToken.findOne({ provider: PROVIDER });

  /** Admin: exchange e-mail + password for a token and store it. The password is used for this one request and dropped. */
  async function generateToken({ email, password, adminId }) {
    const r = await call('generateToken', { body: { email, password } });
    const token = r.data?.data?.token;
    if (r.status === 401) throw badRequest('Shipex says the e-mail or password is wrong.', 'shipex_bad_credentials');
    if (!r.ok || !r.data?.success || typeof token !== 'string' || token.split('.').length !== 3)
      throw tokenError('shipex_token_failed', r.data?.message ? `Shipex: ${r.data.message}` : 'Shipex did not return a token. Please try again.', 502);
    const issuedAt = new Date(now());
    const expiresAt = jwtExpiry(token) ?? new Date(issuedAt.getTime() + config.SHIPEX_TOKEN_TTL_HOURS * 3600_000);
    if (expiresAt.getTime() <= issuedAt.getTime() + 60_000) throw tokenError('shipex_token_failed', 'Shipex returned a token that is already expired.', 502);
    const saved = await ShippingToken.findOneAndUpdate(
      { provider: PROVIDER },
      { $set: { tokenEnc: encryptJson(config.encryptionKey, { token }), email: String(email).toLowerCase(), issuedAt, expiresAt, generatedBy: adminId, lastError: '', lastErrorAt: null }, $unset: { expiredAt: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true });
    cache.clear();
    return saved;
  }

  async function status() {
    const r = await row();
    const by = r?.generatedBy ? await User.findById(r.generatedBy).select('name phone').lean() : null;
    const view = tokenView(r, { now: now(), warnMs });
    return view.configured ? { ...view, generatedBy: by ? (by.name || by.phone) : null } : view;
  }

  async function clearToken() { await ShippingToken.updateOne({ provider: PROVIDER }, { $set: { tokenEnc: '', lastError: '' }, $unset: { expiresAt: 1, issuedAt: 1, expiredAt: 1 } }); cache.clear(); }

  /** The stored token if it is still valid; otherwise throws a clear error the caller can translate. */
  async function validToken() {
    const r = await row();
    const state = tokenState(r, now(), warnMs);
    if (state === 'none') throw tokenError('shipex_not_configured', 'The courier service is not connected yet. An administrator must generate the token in Admin → Shipping.');
    if (state === 'expired') throw tokenError('shipex_token_expired', 'The courier token has expired. An administrator must generate a new one in Admin → Shipping.');
    return decryptJson(config.encryptionKey, r.tokenEnc).token;
  }

  async function markFailure(message, { expired = false } = {}) {
    await ShippingToken.updateOne({ provider: PROVIDER }, { $set: { lastError: message, lastErrorAt: new Date(now()), ...(expired ? { expiredAt: new Date(now()) } : {}) } });
  }

  /** One call to Shipex for ONE shipment: POST with pickUpPincode, deliveryPincode, applicableWeight, length, width, height, paymentType (always Prepaid), declaredValue. */
  async function checkOne({ pickUpPincode, deliveryPincode, applicableWeight, length, width, height, declaredValue }) {
    if (!pin.test(pickUpPincode) || !pin.test(deliveryPincode)) throw badRequest('Enter a valid 6-digit pincode.', 'bad_pincode');
    const paymentType = 'Prepaid';
    const key = [pickUpPincode, deliveryPincode, applicableWeight, length, width, height, paymentType, declaredValue].join('|');
    const hit = cache.get(key);
    if (hit && now() - hit.at < CACHE_MS) return hit.value;

    const token = await validToken();
    const body = { pickUpPincode, deliveryPincode, applicableWeight, length, width, height, paymentType, declaredValue };
    // POST + JSON body is the documented call. Only if Shipex rejects it do we try GET + JSON body, then GET + query string.
    const attempts = [{ method: 'POST', body }, { method: 'GET', body }, { method: 'GET', query: body }];
    let r;
    for (const a of attempts) {
      r = await call('pincodeServiceability', { ...a, token });
      console.info(`[shipex] ${a.method}${a.query ? ' (query)' : ''} pincodeServiceability → ${r.status}`, JSON.stringify(r.data).slice(0, 400));
      if (r.status === 401 || r.ok && r.data?.status !== 'failure') break; // token problem or a real answer: stop trying
    }

    if (r.status === 401) {
      await markFailure('Shipex rejected the stored token (401). Generate a new token.', { expired: true });
      cache.clear();
      throw tokenError('shipex_token_expired', 'The courier token is no longer valid. An administrator must generate a new one in Admin → Shipping.');
    }
    if (r.status === 400 || r.data?.status === 'failure') {
      throw badRequest(r.data?.errors?.[0] ?? r.data?.message ?? 'The courier service rejected this request.', 'shipex_rejected');
    }
    if (!r.ok) {
      await markFailure(`Shipex answered ${r.status}`);
      throw tokenError('shipex_unreachable', 'The courier service is having trouble right now.', 502);
    }
    const value = parseServiceability(r.data);
    if (!value.serviceable) console.warn('[shipex] not serviceable', JSON.stringify({ ...body, reply: r.data }));
    cache.set(key, { at: now(), value });
    await ShippingToken.updateOne({ provider: PROVIDER }, { $set: { lastCheckAt: new Date(now()) } });
    return value;
  }

  /**
   * Customer-facing: is this delivery pincode serviceable for these cart lines?
   * Weight, size, value and pickup pincode all come from OUR product records, never from the browser.
   */
  async function checkItems({ items, deliveryPincode, paymentType }) {
    if (!pin.test(deliveryPincode)) throw badRequest('Enter a valid 6-digit pincode.', 'bad_pincode');
    const ids = [...new Set(items.map((i) => i.productId))];
    const products = await Product.find({ _id: { $in: ids }, status: 'published', sellerActive: true }).lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));
    const lines = items.map((i) => {
      const product = byId.get(String(i.productId));
      if (!product) throw badRequest('One of these products is no longer available.', 'product_unavailable');
      const variant = i.variantId ? product.variants?.find((v) => String(v._id) === String(i.variantId)) : null;
      return { product, qty: i.qty ?? 1, unitPaise: variant?.pricePaise ?? product.pricePaise };
    });
    const { shipments, missing } = buildShipments(lines, { defaultPickup: config.SHIPEX_DEFAULT_PICKUP_PINCODE });
    if (missing.length) throw tokenError('no_pickup_pincode', `“${missing[0].title}” has no pickup pincode yet. Add it in Admin → Products.`, 422);

    const results = [];
    for (const s of shipments) {
      const r = await checkOne({ pickUpPincode: s.pickupPincode, deliveryPincode, applicableWeight: s.applicableWeight, length: s.length, width: s.width, height: s.height, declaredValue: s.declaredValue });
      results.push({ productIds: s.productIds, serviceable: r.serviceable, message: r.message });
    }
    const serviceable = results.every((r) => r.serviceable);
    return { serviceable, deliveryPincode, paymentType, shipments: results };
  }

  /** Admin "test it" box: raw pincode pair, no product needed. */
  const checkPair = (p) => checkOne({ ...p, paymentType: p.paymentType ?? 'Prepaid' });

  return { generateToken, status, clearToken, checkItems, checkPair, validToken };
}

// Problems on the courier side (token missing/expired, Shipex down, an old product without a pickup pincode) must never stop a sale:
// only a definite "Shipex cannot deliver there" blocks the order.
const SOFT_ERRORS = new Set(['shipex_not_configured', 'shipex_token_expired', 'shipex_unreachable', 'shipex_rejected', 'no_pickup_pincode', 'product_unavailable']);

/** Checkout guard. Throws `pincode_not_serviceable` only when the courier clearly says it cannot deliver. */
export async function assertDeliverable({ shipex, config, items, pincode, log = console }) {
  if (!shipex || !config.SHIPEX_ENFORCE_AT_CHECKOUT) return;
  let out;
  try { out = await shipex.checkItems({ items, deliveryPincode: pincode, paymentType: paymentTypeFor(config) }); }
  catch (e) {
    if (e instanceof HttpError && SOFT_ERRORS.has(e.code)) { log.warn?.(`[shipex] check skipped at checkout: ${e.code}`); return; }
    throw e;
  }
  if (!out.serviceable) {
    const why = out.shipments?.find((x) => !x.serviceable)?.message;
    throw badRequest(`Sorry, we cannot deliver to pincode ${pincode} yet.${why ? ` (${why})` : ''}`, 'pincode_not_serviceable');
  }
}