import { HttpError } from '../lib/errors.js';
import { allocate } from '../lib/money.js';
import { Coupon, Order, Product, Seller } from '../models/index.js';
import { sellerIsActive } from './catalog.js';

const unprocessable = (code, message, details) => new HttpError(422, code, message, details);

export async function checkCoupon(code, { userId, merchandisePaise, now = new Date() }) {
  const c = await Coupon.findOne({ code: String(code).trim().toUpperCase() });
  if (!c || !c.isActive) throw unprocessable('coupon_invalid', 'Invalid coupon code');
  if (c.startsAt && now < c.startsAt) throw unprocessable('coupon_invalid', 'This coupon is not active yet');
  if (c.endsAt && now > c.endsAt) throw unprocessable('coupon_invalid', 'This coupon has expired');
  if (c.usageLimit != null && c.usedCount >= c.usageLimit) throw unprocessable('coupon_invalid', 'This coupon has reached its usage limit');
  if (merchandisePaise < c.minOrderPaise) throw unprocessable('coupon_invalid', `Add ₹${Math.ceil((c.minOrderPaise - merchandisePaise) / 100)} more to use this coupon`);
  if (userId) {
    const used = await Order.countDocuments({ userId, 'coupon.code': c.code, status: { $in: ['pending_payment', 'paid'] } });
    if (used >= c.perUserLimit) throw unprocessable('coupon_invalid', 'You have already used this coupon');
  }
  let d = c.type === 'percent' ? Math.floor((merchandisePaise * c.value) / 100) : c.value;
  if (c.maxDiscountPaise != null) d = Math.min(d, c.maxDiscountPaise);
  return { coupon: c, discountPaise: Math.min(d, merchandisePaise) };
}

/**
 * Prices a cart entirely from the database. The client sends ONLY product ids, variant ids, quantities and
 * personalisation text — never prices, totals, seller ids or commissions.
 */
export async function quoteCart({ items, userId, couponCode, settings }) {
  // merge duplicate lines
  const merged = new Map();
  for (const it of items) {
    const key = `${it.productId}:${it.variantId ?? ''}:${(it.customization ?? '').trim()}`;
    const m = merged.get(key);
    if (m) m.qty += it.qty; else merged.set(key, { ...it, customization: (it.customization ?? '').trim() });
  }
  const wanted = [...merged.values()];
  if (wanted.some((w) => w.qty > settings.maxQtyPerLine)) throw unprocessable('quantity_too_high', `You can order at most ${settings.maxQtyPerLine} of one item`);

  const products = await Product.find({ _id: { $in: [...new Set(wanted.map((w) => w.productId))] } }).lean();
  const pById = new Map(products.map((p) => [String(p._id), p]));
  const sellerIds = [...new Set(products.filter((p) => p.sellerId).map((p) => String(p.sellerId)))];
  const sellers = sellerIds.length ? await Seller.find({ _id: { $in: sellerIds } }).lean() : [];
  const sById = new Map(sellers.map((s) => [String(s._id), s]));

  const lines = wanted.map((w) => {
    const p = pById.get(String(w.productId));
    if (!p || p.status !== 'published' || !p.sellerActive) throw unprocessable('product_unavailable', `“${p?.title ?? 'An item'}” is no longer available`);
    let seller = null;
    if (p.ownerType === 'seller') {
      seller = sById.get(String(p.sellerId));
      if (!seller || !sellerIsActive(seller)) throw unprocessable('product_unavailable', `“${p.title}” is no longer available`);
      if (String(seller.userId) === String(userId)) throw unprocessable('own_product', 'You cannot buy your own products');
    }
    let unitPaise = p.pricePaise, variantName = '', variantId = null;
    if ((p.variants ?? []).length) {
      const v = (p.variants ?? []).find((x) => String(x._id) === String(w.variantId));
      if (!v) throw unprocessable('variant_required', `Please choose an option for “${p.title}”`);
      unitPaise = v.pricePaise; variantName = v.name; variantId = v._id;
    } else if (w.variantId) throw unprocessable('variant_invalid', `“${p.title}” has no options`);
    if (p.isCustomizable) {
      if (!w.customization) throw unprocessable('customization_required', `Please add the personalisation for “${p.title}”`);
      if (w.customization.length > p.customization.maxLength) throw unprocessable('customization_too_long', `Personalisation for “${p.title}” is too long`);
    } else if (w.customization) throw unprocessable('customization_invalid', `“${p.title}” cannot be personalised`);
    return {
      productId: p._id, variantId, title: p.title, variantName, image: p.images?.[0]?.url ?? '', ownerType: p.ownerType,
      sellerId: p.sellerId ?? null, qty: w.qty, unitPaise, customization: w.customization, lineTotalPaise: unitPaise * w.qty, discountPaise: 0,
    };
  });

  const subtotalPaise = lines.reduce((a, l) => a + l.lineTotalPaise, 0);
  let discountPaise = 0, coupon = null;
  if (couponCode) {
    const r = await checkCoupon(couponCode, { userId, merchandisePaise: subtotalPaise });
    discountPaise = r.discountPaise; coupon = { doc: r.coupon, code: r.coupon.code, discountPaise };
    allocate(discountPaise, lines.map((l) => l.lineTotalPaise)).forEach((d, i) => { lines[i].discountPaise = d; });
  }

  // one shipment (and one shipping charge) per seller / per Upahars Originals
  const groups = new Map();
  for (const l of lines) {
    const key = l.sellerId ? String(l.sellerId) : 'upahars';
    const g = groups.get(key) ?? { key, sellerId: l.sellerId, ownerType: l.ownerType, subtotalPaise: 0, lines: [] };
    g.subtotalPaise += l.lineTotalPaise; g.lines.push(l); groups.set(key, g);
  }
  const groupList = [...groups.values()].map((g) => ({ ...g, shippingPaise: g.subtotalPaise >= settings.shipping.freeAbovePaise ? 0 : settings.shipping.flatFeePaise }));
  const shippingPaise = groupList.reduce((a, g) => a + g.shippingPaise, 0);
  return { lines, groups: groupList, subtotalPaise, discountPaise, shippingPaise, totalPaise: subtotalPaise - discountPaise + shippingPaise, coupon };
}

/** What the API returns for a quote (no internal ids/overrides). */
export const quoteView = (q) => ({
  items: q.lines.map((l) => ({ productId: String(l.productId), variantId: l.variantId ? String(l.variantId) : null, title: l.title, variantName: l.variantName, image: l.image, qty: l.qty, unitPaise: l.unitPaise, lineTotalPaise: l.lineTotalPaise, customization: l.customization, soldBy: l.ownerType === 'upahars' ? 'Upahars Originals' : 'Independent seller' })),
  shipments: q.groups.map((g) => ({ owner: g.ownerType, subtotalPaise: g.subtotalPaise, shippingPaise: g.shippingPaise })),
  subtotalPaise: q.subtotalPaise, discountPaise: q.discountPaise, shippingPaise: q.shippingPaise, totalPaise: q.totalPaise, coupon: q.coupon ? { code: q.coupon.code, discountPaise: q.coupon.discountPaise } : null,
});
