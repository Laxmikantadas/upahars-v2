// Pure money rules for offers (no database, easy to test). All amounts are in paise.

/** Real courier price for one shipment, in paise: Shipex's cheapest option + our markup, kept between min and max. null → use the flat fee. */
export function courierFeePaise(cheapestRupees, shipping) {
  const c = Number(cheapestRupees);
  if (shipping.mode !== 'courier' || !Number.isFinite(c) || c <= 0) return null;
  const raw = Math.ceil(c) * 100 + (shipping.markupPaise ?? 0);
  return Math.max(shipping.minFeePaise ?? 0, Math.min(shipping.maxFeePaise ?? raw, raw));
}

/**
 * The biggest total discount (tier + coupon) an order can get while still earning at least the minimum profit.
 *   profit(D) = (revenue − D)·(1 − gateway) − productCost − courierCost   must be ≥ minProfit
 * revenue = items + shipping the customer pays. Never negative, never more than the items' price.
 */
export function maxSafeDiscountPaise({ subtotalPaise, shippingPaise, productCostPaise, courierCostPaise, pricing }) {
  const g = (pricing.gatewayBps ?? 0) / 10000;
  const minProfit = Math.max(pricing.minProfitPaise ?? 0, Math.floor((subtotalPaise * (pricing.minProfitBps ?? 0)) / 10000));
  const revenue = subtotalPaise + shippingPaise;
  const d = Math.floor(revenue - (productCostPaise + courierCostPaise + minProfit) / (1 - g));
  return Math.max(0, Math.min(subtotalPaise, d));
}

/** Profit of an order after discount, paise (gateway fee included). */
export const orderProfitPaise = ({ subtotalPaise, shippingPaise, discountPaise, productCostPaise, courierCostPaise, gatewayBps = 0 }) =>
  Math.floor((subtotalPaise + shippingPaise - discountPaise) * (1 - gatewayBps / 10000)) - productCostPaise - courierCostPaise;

/** Quantity tier: { tier, next } for the cart's total quantity. tiers = [{ minQty, bps }] */
export function pickTier(tiers, totalQty) {
  const sorted = [...(tiers ?? [])].sort((a, b) => a.minQty - b.minQty);
  return { tier: [...sorted].reverse().find((t) => totalQty >= t.minQty) ?? null, next: sorted.find((t) => t.minQty > totalQty && t.bps > 0) ?? null };
}