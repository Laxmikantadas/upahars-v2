import { bpsOf } from '../lib/money.js';

/**
 * Commission rate precedence (highest first), decided on the server only:
 *   1. a rate set on the PRODUCT by an administrator (applies to every source)
 *   2. a rate set on the SELLER by an administrator, for this source
 *   3. the platform default for this source
 * source: 'seller_link' (order came through that seller's own link) | 'marketplace'
 */
export function resolveRate({ product, seller, source, settings }) {
  if (Number.isInteger(product?.commissionOverrideBps)) return { bps: product.commissionOverrideBps, basis: 'product_override' };
  const key = source === 'seller_link' ? 'linkBps' : 'marketplaceBps';
  const o = seller?.commissionOverride?.[key];
  if (Number.isInteger(o)) return { bps: o, basis: 'seller_override' };
  return { bps: settings.commission[key], basis: 'platform_default' };
}

/**
 * Pure ledger calculation for ONE seller within ONE order. Money is in integer paise.
 *
 * line: { itemId, title, qty, refundedQty, unitPaise, discountPaise, rateBps, rateBasis }
 *  - eligible base = price of the units not refunded
 *  - an order-level coupon only reduces the base when settings.discountFunding === 'seller'
 *  - shipping is never commissionable; it goes to the seller when settings.shipping.paidTo === 'seller'
 *    (and is returned if every unit in the shipment was refunded)
 *  - taxes: prices are tax-inclusive and no separate tax is modelled
 *  - commission is rounded half-up per line
 *  - the gateway fee is an ESTIMATE (settings.paymentFee.bps) and is deducted only if bearer === 'seller'
 */
export function computeLedger({ lines, shippingPaise = 0, settings }) {
  const out = lines.map((l) => {
    const remaining = l.qty - (l.refundedQty ?? 0);
    const gross = l.unitPaise * remaining;
    const discountRemaining = (l.discountPaise ?? 0) - Math.floor(((l.discountPaise ?? 0) * (l.refundedQty ?? 0)) / l.qty);
    const sellerBorne = settings.discountFunding === 'seller' ? discountRemaining : 0;
    const eligible = Math.max(0, gross - sellerBorne);
    return { ...l, grossPaise: gross, discountBorneBySellerPaise: sellerBorne, eligiblePaise: eligible, commissionPaise: bpsOf(eligible, l.rateBps) };
  });
  const allRefunded = lines.length > 0 && lines.every((l) => (l.refundedQty ?? 0) >= l.qty);
  const grossPaise = out.reduce((a, l) => a + l.grossPaise, 0);
  const eligiblePaise = out.reduce((a, l) => a + l.eligiblePaise, 0);
  const commissionPaise = out.reduce((a, l) => a + l.commissionPaise, 0);
  const sellerShip = settings.shipping.paidTo === 'seller' && !allRefunded ? shippingPaise : 0;
  const paymentFeePaise = settings.paymentFee.bearer === 'seller' ? bpsOf(eligiblePaise + sellerShip, settings.paymentFee.bps) : 0;
  const sellerPayablePaise = Math.max(0, eligiblePaise - commissionPaise - paymentFeePaise + sellerShip);
  return { lines: out, grossPaise, eligiblePaise, commissionPaise, paymentFeePaise, shippingPaise: sellerShip, sellerPayablePaise, allRefunded };
}
