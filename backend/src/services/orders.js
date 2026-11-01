import mongoose from 'mongoose';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { Coupon, Inventory, Ledger, Order, PaymentEvent, Product, Seller, nextOrderNumber } from '../models/index.js';
import { computeLedger, resolveRate } from './commission.js';
import { getSettings } from './settings.js';
import { quoteCart } from './pricing.js';

const newId = () => new mongoose.Types.ObjectId();
const log = (by, action, note = '') => ({ at: new Date(), by: String(by), action, note });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const same = (a, b) => String(a) === String(b);
const pickPolicy = (s) => ({ discountFunding: s.discountFunding, shipping: { paidTo: s.shipping.paidTo }, paymentFee: s.paymentFee, commission: s.commission });

export function createOrderService({ config, provider }) {
  /* ───── helpers ───── */
  async function restock(rows) {
    for (const r of rows) await Inventory.updateOne({ productId: r.productId, variantId: r.variantId ?? null }, { $inc: { stock: r.qty } });
  }

  async function withOrderLock(orderId, fn) {
    for (let i = 0; i < 6; i++) {
      const got = await Order.findOneAndUpdate({ _id: orderId, $or: [{ lockUntil: null }, { lockUntil: { $lt: new Date() } }] }, { $set: { lockUntil: new Date(Date.now() + 60000) } });
      if (got) { try { return await fn(); } finally { await Order.updateOne({ _id: orderId }, { $set: { lockUntil: null } }); } }
      await sleep(60 * (i + 1));
    }
    throw conflict('This order is being updated. Please try again in a moment.', 'order_busy');
  }

  const checkoutInfo = (order) => ({
    provider: order.payment.provider, providerOrderId: order.payment.providerOrderId, amountPaise: order.payment.amountPaise, currency: 'INR',
    keyId: config.PAYMENT_PROVIDER === 'razorpay' ? config.RAZORPAY_KEY_ID : 'mock',
  });

  /* ───── checkout ───── */
  async function checkout({ user, items, address, couponCode, idempotencyKey, attribution }) {
    const idemRef = idempotencyKey ? `${user._id}:${idempotencyKey}` : undefined;
    if (idemRef) {
      const ex = await Order.findOne({ idemRef });
      if (ex) return { order: ex, checkout: ex.status === 'pending_payment' ? checkoutInfo(ex) : null, reused: true };
    }
    const settings = await getSettings();
    const quote = await quoteCart({ items, userId: user._id, couponCode, settings });

    const reserved = []; let couponUsed = false;
    try {
      for (const l of quote.lines) {
        const r = await Inventory.findOneAndUpdate({ productId: l.productId, variantId: l.variantId, stock: { $gte: l.qty } }, { $inc: { stock: -l.qty } });
        if (!r) throw new HttpError(409, 'out_of_stock', `“${l.title}” does not have enough stock`);
        reserved.push({ productId: l.productId, variantId: l.variantId, qty: l.qty });
      }
      if (quote.coupon) {
        const c = quote.coupon.doc; const cond = { _id: c._id, isActive: true };
        if (c.usageLimit != null) cond.usedCount = { $lt: c.usageLimit };
        if (!(await Coupon.findOneAndUpdate(cond, { $inc: { usedCount: 1 } }))) throw new HttpError(422, 'coupon_invalid', 'This coupon has reached its usage limit');
        couponUsed = true;
      }
    } catch (e) { await restock(reserved); throw e; }

    const orderItems = quote.lines.map((l) => ({
      _id: newId(), productId: l.productId, variantId: l.variantId, title: l.title, variantName: l.variantName, image: l.image,
      ownerType: l.ownerType, sellerId: l.sellerId, qty: l.qty, unitPaise: l.unitPaise, discountPaise: l.discountPaise, customization: l.customization, refundedQty: 0,
    }));
    const shipments = quote.groups.map((g) => ({
      _id: newId(), sellerId: g.sellerId, ownerType: g.ownerType, shippingPaise: g.shippingPaise, status: 'pending',
      itemIds: orderItems.filter((i) => (g.sellerId ? same(i.sellerId, g.sellerId) : !i.sellerId)).map((i) => i._id),
    }));
    const orderNumber = await nextOrderNumber();
    const order = new Order({
      orderNumber, userId: user._id, status: 'pending_payment', items: orderItems, shipments,
      totals: { subtotalPaise: quote.subtotalPaise, discountPaise: quote.discountPaise, shippingPaise: quote.shippingPaise, totalPaise: quote.totalPaise },
      coupon: quote.coupon ? { code: quote.coupon.code, discountPaise: quote.coupon.discountPaise } : { code: '', discountPaise: 0 },
      address, attribution: attribution ?? null, idemRef,
      reservationExpiresAt: new Date(Date.now() + settings.reservationMinutes * 60000),
      payment: { provider: provider.name, status: 'created', amountPaise: quote.totalPaise },
      history: [log(user._id, 'created')],
    });
    const undo = async () => { await restock(reserved); if (couponUsed) await Coupon.updateOne({ code: quote.coupon.code, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } }); };
    try { await order.save(); } catch (e) {
      await undo();
      if (e.code === 11000 && idemRef) { const ex = await Order.findOne({ idemRef }); if (ex) return { order: ex, checkout: checkoutInfo(ex), reused: true }; }
      throw e;
    }
    if (provider.name === 'none') { // no gateway: the order is confirmed immediately (pay on delivery / later)
      const { order: confirmed } = await confirmPaid(order, { paymentId: 'pay_later', method: 'pay_later' });
      return { order: confirmed, checkout: null, reused: false };
    }
    try {
      const po = await provider.createOrder({ amountPaise: quote.totalPaise, receipt: orderNumber, notes: { orderNumber } });
      order.payment.providerOrderId = po.providerOrderId; await order.save();
    } catch (e) {
      await releaseOrder(order, 'payment_failed', 'payment provider unavailable');
      throw new HttpError(502, 'payment_unavailable', 'Payments are temporarily unavailable. Please try again.');
    }
    return { order, checkout: checkoutInfo(order), reused: false };
  }

  /** Puts reserved stock (and coupon use) back. Only the first caller wins, so it can never double-restock. */
  async function releaseOrder(order, newStatus, reason) {
    const won = await Order.findOneAndUpdate({ _id: order._id, status: 'pending_payment' }, { $set: { status: newStatus }, $push: { history: log('system', newStatus, reason) } }, { new: true });
    if (!won) return null;
    await restock(won.items.map((i) => ({ productId: i.productId, variantId: i.variantId, qty: i.qty - i.refundedQty })));
    if (won.coupon?.code) await Coupon.updateOne({ code: won.coupon.code, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
    return won;
  }

  async function releaseExpired(now = new Date()) {
    const due = await Order.find({ status: 'pending_payment', reservationExpiresAt: { $lt: now } }).limit(200);
    let n = 0;
    for (const o of due) if (await releaseOrder(o, 'expired', 'payment not completed in time')) n++;
    return n;
  }

  /* ───── payment confirmation ───── */
  async function createLedgers(order) {
    const settings = await getSettings();
    const sellerShipments = order.shipments.filter((s) => s.sellerId);
    if (!sellerShipments.length) return;
    const sellers = await Seller.find({ _id: { $in: sellerShipments.map((s) => s.sellerId) } }).lean();
    const products = await Product.find({ _id: { $in: order.items.map((i) => i.productId) } }).lean();
    for (const sh of sellerShipments) {
      const seller = sellers.find((s) => same(s._id, sh.sellerId));
      const source = order.attribution && same(order.attribution.sellerId, sh.sellerId) ? 'seller_link' : 'marketplace';
      const lines = order.items.filter((i) => same(i.sellerId, sh.sellerId)).map((i) => {
        const { bps, basis } = resolveRate({ product: products.find((p) => same(p._id, i.productId)), seller, source, settings });
        return { itemId: i._id, title: i.title, qty: i.qty, refundedQty: i.refundedQty, unitPaise: i.unitPaise, discountPaise: i.discountPaise, rateBps: bps, rateBasis: basis };
      });
      const calc = computeLedger({ lines, shippingPaise: sh.shippingPaise, settings });
      try {
        await Ledger.create({
          orderId: order._id, orderNumber: order.orderNumber, sellerId: sh.sellerId, source, lines: calc.lines, shippingPaise: calc.shippingPaise,
          grossPaise: calc.grossPaise, eligiblePaise: calc.eligiblePaise, commissionPaise: calc.commissionPaise, paymentFeePaise: calc.paymentFeePaise,
          sellerPayablePaise: calc.sellerPayablePaise, policy: pickPolicy(settings),
          attribution: order.attribution ? { ...order.attribution.toObject?.() ?? order.attribution } : null,
          history: [log('system', 'created', `source=${source}`)],
        });
      } catch (e) { if (e.code !== 11000) throw e; } // already exists → never charged twice
    }
  }

  async function onPaid(order) {
    await createLedgers(order);
    for (const i of order.items) await Product.updateOne({ _id: i.productId }, { $inc: { soldCount: i.qty } });
  }

  async function confirmPaid(order, { paymentId, method = '' }) {
    const won = await Order.findOneAndUpdate(
      { _id: order._id, status: 'pending_payment' },
      { $set: { status: 'paid', 'payment.status': 'paid', 'payment.providerPaymentId': paymentId, 'payment.paidAt': new Date(), 'payment.method': method }, $push: { history: log('system', 'paid', paymentId) } },
      { new: true },
    );
    if (won) { await onPaid(won); return { order: won, changed: true }; }
    const cur = await Order.findById(order._id);
    if (cur.status === 'paid') return { order: cur, changed: false }; // replay — nothing happens twice
    if (cur.status === 'expired' || cur.status === 'payment_failed') return lateRecovery(cur, { paymentId, method });
    if (cur.status === 'cancelled') return refundStray(cur, { paymentId, note: 'payment_after_cancel_refunded' }); // customer cancelled, then the payment still went through
    return { order: cur, changed: false };
  }

  /** Gives money back for a payment that must not become an order. Claims the refund first, so a repeated call (client retry + webhook) can never refund twice. */
  async function refundStray(order, { paymentId, note }) {
    const claimed = await Order.findOneAndUpdate(
      { _id: order._id, 'payment.status': { $nin: ['refunded', 'paid'] } },
      { $set: { 'payment.status': 'refunded', 'payment.providerPaymentId': paymentId }, $inc: { refundedPaise: order.payment.amountPaise } },
      { new: true },
    );
    if (!claimed) return { order: await Order.findById(order._id), changed: false, refunded: true }; // someone else already handled it
    try {
      const r = await provider.refund({ paymentId, amountPaise: order.payment.amountPaise, receipt: `${order.orderNumber}-late` });
      await Order.updateOne({ _id: order._id }, { $push: { history: log('system', note, r.providerRefundId) } });
    } catch {
      // the gateway said no: undo the claim so it can be retried, and flag it for a person
      await Order.updateOne({ _id: order._id }, { $set: { 'payment.status': 'created', 'payment.providerPaymentId': paymentId }, $inc: { refundedPaise: -order.payment.amountPaise }, $push: { history: log('system', 'late_payment_refund_failed', 'NEEDS MANUAL REFUND') } });
    }
    return { order: await Order.findById(order._id), changed: false, refunded: true };
  }

  /** Money arrived for an order whose reservation had already been released. Re-reserve, or refund — never keep both. */
  async function lateRecovery(order, { paymentId, method }) {
    const taken = [];
    try {
      for (const i of order.items) {
        const r = await Inventory.findOneAndUpdate({ productId: i.productId, variantId: i.variantId, stock: { $gte: i.qty } }, { $inc: { stock: -i.qty } });
        if (!r) throw new Error('out_of_stock');
        taken.push({ productId: i.productId, variantId: i.variantId, qty: i.qty });
      }
    } catch {
      await restock(taken);
      return refundStray(order, { paymentId, note: 'late_payment_refunded' });
    }
    const won = await Order.findOneAndUpdate(
      { _id: order._id, status: { $in: ['expired', 'payment_failed'] } },
      { $set: { status: 'paid', 'payment.status': 'paid', 'payment.providerPaymentId': paymentId, 'payment.paidAt': new Date(), 'payment.method': method }, $push: { history: log('system', 'paid_after_expiry', paymentId) } }, { new: true });
    if (!won) { await restock(taken); return { order: await Order.findById(order._id), changed: false }; }
    if (won.coupon?.code) await Coupon.updateOne({ code: won.coupon.code }, { $inc: { usedCount: 1 } });
    await onPaid(won);
    return { order: won, changed: true };
  }

  /** Client reports a payment. We trust nothing: signature, then the gateway's own record of the payment. */
  async function verifyAndConfirm({ user, orderNumber, paymentId, signature }) {
    const order = await Order.findOne({ orderNumber, userId: user._id });
    if (!order) throw notFound('Order not found');
    if (order.status === 'paid') return { order, changed: false };
    if (!provider.verifySignature({ providerOrderId: order.payment.providerOrderId, paymentId, signature })) throw badRequest('Payment signature is invalid', 'invalid_signature');
    let p;
    try { p = await provider.fetchPayment(paymentId); } catch { throw new HttpError(502, 'payment_check_failed', 'Could not confirm the payment with the gateway yet. If you were charged it will be confirmed automatically.'); }
    if (p.orderId !== order.payment.providerOrderId || p.status !== 'captured' || p.amountPaise !== order.payment.amountPaise) {
      await Order.updateOne({ _id: order._id }, { $push: { history: log('system', 'payment_mismatch', `${p.status}/${p.amountPaise}`) } });
      throw new HttpError(409, 'payment_mismatch', 'The payment could not be matched to this order.');
    }
    return confirmPaid(order, { paymentId, method: p.method });
  }

  async function handleWebhook({ rawBody, signature, eventId }) {
    if (!provider.verifyWebhook(rawBody, signature)) throw badRequest('Invalid webhook signature', 'invalid_signature');
    const evt = JSON.parse(rawBody);
    const id = eventId || evt.id;
    if (!id) throw badRequest('Missing event id');
    try { await PaymentEvent.create({ eventId: id, type: evt.event }); } catch (e) { if (e.code === 11000) return { duplicate: true }; throw e; }
    try {
      const entity = evt.payload?.payment?.entity;
      if (!entity?.order_id) return { ignored: true };
      const order = await Order.findOne({ 'payment.providerOrderId': entity.order_id });
      if (!order) return { ignored: true };
      if (evt.event === 'payment.captured' || evt.event === 'order.paid') {
        if (entity.amount !== order.payment.amountPaise || (entity.status && entity.status !== 'captured')) {
          await Order.updateOne({ _id: order._id }, { $push: { history: log('webhook', 'payment_mismatch', `${entity.status}/${entity.amount}`) } });
          return { mismatch: true };
        }
        return { ...(await confirmPaid(order, { paymentId: entity.id, method: entity.method })), handled: true };
      }
      if (evt.event === 'payment.failed') {
        await Order.updateOne({ _id: order._id, status: 'pending_payment' }, { $set: { 'payment.failureReason': String(entity.error_description ?? 'failed').slice(0, 200) } });
        return { handled: true };
      }
      return { ignored: true };
    } catch (e) { await PaymentEvent.deleteOne({ eventId: id }); throw e; } // let the gateway retry
  }

  /* ───── refunds ───── */
  async function recomputeLedger(order, sellerId) {
    const ledger = await Ledger.findOne({ orderId: order._id, sellerId });
    if (!ledger) return;
    const sh = order.shipments.find((s) => same(s.sellerId, sellerId));
    const lines = ledger.lines.map((l) => {
      const it = order.items.find((i) => same(i._id, l.itemId));
      return { itemId: l.itemId, title: l.title, qty: l.qty, refundedQty: it.refundedQty, unitPaise: l.unitPaise, discountPaise: it.discountPaise, rateBps: l.rateBps, rateBasis: l.rateBasis };
    });
    const calc = computeLedger({ lines, shippingPaise: sh.shippingPaise, settings: ledger.policy });
    const set = { lines: calc.lines, shippingPaise: calc.shippingPaise, grossPaise: calc.grossPaise, eligiblePaise: calc.eligiblePaise, commissionPaise: calc.commissionPaise, paymentFeePaise: calc.paymentFeePaise, sellerPayablePaise: Math.max(0, calc.sellerPayablePaise + (ledger.adjustmentPaise ?? 0)) };
    if (calc.allRefunded && ledger.status === 'pending') set.status = 'reversed';
    await Ledger.updateOne({ _id: ledger._id }, { $set: set, $push: { history: log('system', 'recomputed', `refund applied; payable now ${calc.sellerPayablePaise}`) } });
  }

  // must be called while holding the order lock
  async function refundLocked(orderId, lines, reason, actorId, { cancelShipmentId, cancelAll } = {}) {
    const cur = await Order.findById(orderId);
    if (!cur) throw notFound('Order not found');
    if (cur.status !== 'paid') throw conflict('Only paid orders can be refunded', 'not_paid');
    if (!lines.length) throw badRequest('Choose at least one item');
    const items = cur.items.map((i) => i.toObject());
    const shipments = cur.shipments.map((s) => s.toObject());
    let amount = 0; const restockRows = [];
    for (const l of lines) {
      const it = items.find((i) => same(i._id, l.itemId));
      if (!it) throw badRequest('Unknown item in refund', 'bad_item');
      if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > it.qty - it.refundedQty) throw conflict('Refund quantity is more than what is left to refund', 'refund_exceeds');
      const before = Math.floor((it.discountPaise * it.refundedQty) / it.qty);
      const after = Math.floor((it.discountPaise * (it.refundedQty + l.qty)) / it.qty);
      amount += it.unitPaise * l.qty - (after - before);
      it.refundedQty += l.qty;
      const sh = shipments.find((s) => s.itemIds.some((x) => same(x, it._id)));
      if (sh && ['pending', 'processing', 'cancelled'].includes(sh.status)) restockRows.push({ productId: it.productId, variantId: it.variantId, qty: l.qty });
    }
    for (const sh of shipments) { // shipping comes back only when the whole shipment is refunded
      if (!sh.shippingRefunded && sh.shippingPaise > 0 && sh.itemIds.every((id) => { const it = items.find((i) => same(i._id, id)); return it.refundedQty >= it.qty; })) { amount += sh.shippingPaise; sh.shippingRefunded = true; }
      if ((cancelShipmentId && same(sh._id, cancelShipmentId)) || (cancelAll && ['pending', 'processing'].includes(sh.status))) sh.status = 'cancelled';
    }
    if (amount + cur.refundedPaise > cur.payment.amountPaise) throw conflict('Refund is more than the amount paid', 'refund_exceeds');
    const receipt = `${cur.orderNumber}-r${cur.refunds.length + 1}`;
    let providerRefundId = '';
    if (amount > 0) {
      try { providerRefundId = (await provider.refund({ paymentId: cur.payment.providerPaymentId, amountPaise: amount, receipt })).providerRefundId; } catch (e) {
        await Order.updateOne({ _id: cur._id }, { $push: { refunds: { amountPaise: amount, items: lines, reason, status: 'failed', error: String(e.message).slice(0, 200), by: actorId }, history: log(actorId, 'refund_failed', e.message) } });
        throw new HttpError(502, 'refund_failed', 'The payment gateway did not accept the refund. Nothing was changed.');
      }
    }
    const refundedPaise = cur.refundedPaise + amount;
    await Order.updateOne({ _id: cur._id }, {
      $set: { items, shipments, refundedPaise, 'payment.status': refundedPaise >= cur.payment.amountPaise ? 'refunded' : 'partially_refunded' },
      $push: { refunds: { amountPaise: amount, items: lines, reason, status: 'processed', providerRefundId, by: actorId }, history: log(actorId, 'refund', `${amount} paise: ${reason}`) },
    });
    await restock(restockRows);
    const fresh = await Order.findById(orderId);
    for (const sid of [...new Set(fresh.items.filter((i) => i.sellerId).map((i) => String(i.sellerId)))]) await recomputeLedger(fresh, sid);
    return { order: fresh, refundedPaise: amount, providerRefundId };
  }

  const refundItems = ({ orderId, lines, reason, actorId }) => withOrderLock(orderId, () => refundLocked(orderId, lines, reason, actorId));

  async function cancelByCustomer({ user, orderNumber }) {
    const order = await Order.findOne({ orderNumber, userId: user._id });
    if (!order) throw notFound('Order not found');
    if (order.status === 'pending_payment') { await releaseOrder(order, 'cancelled', 'cancelled by customer'); return Order.findById(order._id); }
    if (order.status !== 'paid') throw conflict('This order cannot be cancelled', 'cannot_cancel');
    return withOrderLock(order._id, async () => {
      const cur = await Order.findById(order._id);
      if (!cur.shipments.every((s) => ['pending', 'processing', 'cancelled'].includes(s.status))) throw conflict('Part of this order has already shipped. Please contact support.', 'cannot_cancel');
      const lines = cur.items.filter((i) => i.qty - i.refundedQty > 0).map((i) => ({ itemId: i._id, qty: i.qty - i.refundedQty }));
      if (!lines.length) throw conflict('Nothing left to cancel', 'cannot_cancel');
      const r = await refundLocked(cur._id, lines, 'customer_cancelled', user._id, { cancelAll: true });
      return r.order;
    });
  }

  /* ───── fulfilment ───── */
  const NEXT = { pending: ['processing', 'cancelled'], processing: ['shipped', 'cancelled'], shipped: ['delivered'], delivered: [], cancelled: [] };
  async function updateShipment({ orderId, shipmentId, actor, status, tracking }) {
    return withOrderLock(orderId, async () => {
      const order = await Order.findById(orderId);
      if (!order) throw notFound('Order not found');
      const sh = order.shipments.find((s) => same(s._id, shipmentId));
      const mine = actor.role === 'admin' || (actor.sellerId && sh && same(sh.sellerId, actor.sellerId));
      if (!sh || !mine) throw notFound('Shipment not found'); // don't reveal other sellers' orders
      if (order.status !== 'paid') throw conflict('Only paid orders can be fulfilled', 'not_paid');
      if (!NEXT[sh.status].includes(status)) throw conflict(`A ${sh.status} shipment cannot become ${status}`, 'bad_transition');
      if (status === 'shipped' && !(tracking?.carrier?.trim() && tracking?.trackingNumber?.trim())) throw badRequest('Enter the carrier and tracking number before marking as shipped', 'tracking_required');
      if (status === 'cancelled') {
        const lines = order.items.filter((i) => sh.itemIds.some((x) => same(x, i._id)) && i.qty - i.refundedQty > 0).map((i) => ({ itemId: i._id, qty: i.qty - i.refundedQty }));
        if (lines.length) { const r = await refundLocked(order._id, lines, `${actor.role}_cancelled_shipment`, actor.userId, { cancelShipmentId: sh._id }); return r.order; }
      }
      const sets = {}; const idx = order.shipments.findIndex((s) => same(s._id, shipmentId));
      sets[`shipments.${idx}.status`] = status;
      if (status === 'shipped') { sets[`shipments.${idx}.shippedAt`] = new Date(); sets[`shipments.${idx}.tracking`] = { carrier: tracking.carrier.trim(), trackingNumber: tracking.trackingNumber.trim(), trackingUrl: (tracking.trackingUrl ?? '').trim(), enteredBy: actor.role }; }
      if (status === 'delivered') sets[`shipments.${idx}.deliveredAt`] = new Date();
      await Order.updateOne({ _id: order._id }, { $set: sets, $push: { history: log(actor.userId, `shipment_${status}`, String(sh._id)) } });
      if (status === 'delivered' && sh.sellerId) {
        const settings = await getSettings(); const now = new Date();
        await Ledger.updateOne({ orderId: order._id, sellerId: sh.sellerId }, { $set: { deliveredAt: now, payableAfter: new Date(now.getTime() + settings.payoutHoldDays * 86400000) }, $push: { history: log(actor.userId, 'delivered', `delivery reported by ${actor.role}`) } });
      }
      return Order.findById(order._id);
    });
  }

  return { checkout, verifyAndConfirm, handleWebhook, confirmPaid, releaseExpired, releaseOrder, refundItems, cancelByCustomer, updateShipment, recomputeLedger, createLedgers, provider };
}

/* ───── views (what each role is allowed to see) ───── */
const itemView = (i) => ({ id: String(i._id), productId: String(i.productId), title: i.title, variantName: i.variantName, image: i.image, qty: i.qty, unitPaise: i.unitPaise, customization: i.customization, refundedQty: i.refundedQty, soldBy: i.ownerType === 'upahars' ? 'Upahars Originals' : 'Independent seller' });
const shipView = (s) => ({ id: String(s._id), owner: s.ownerType, status: s.status, shippingPaise: s.shippingPaise, itemIds: s.itemIds.map(String), tracking: s.tracking?.trackingNumber ? { carrier: s.tracking.carrier, trackingNumber: s.tracking.trackingNumber, trackingUrl: s.tracking.trackingUrl, enteredBy: s.tracking.enteredBy } : null, shippedAt: s.shippedAt, deliveredAt: s.deliveredAt });

export const customerOrderView = (o) => ({
  orderNumber: o.orderNumber, status: o.status, createdAt: o.createdAt, items: o.items.map(itemView), shipments: o.shipments.map(shipView),
  totals: o.totals, coupon: o.coupon, address: o.address, payment: { status: o.payment.status, method: o.payment.method, paidAt: o.payment.paidAt }, refundedPaise: o.refundedPaise,
});

/** A seller sees only their own items/shipments — never other sellers' lines or the full order total. */
export const sellerOrderView = (o, sellerId) => {
  const sh = o.shipments.filter((s) => same(s.sellerId, sellerId));
  const ids = new Set(sh.flatMap((s) => s.itemIds.map(String)));
  return {
    orderNumber: o.orderNumber, status: o.status, createdAt: o.createdAt,
    items: o.items.filter((i) => ids.has(String(i._id))).map(itemView), shipments: sh.map(shipView),
    shipTo: o.status === 'paid' ? o.address : null, // address released only once the order is paid
  };
};

export const adminOrderView = (o) => ({ ...customerOrderView(o), id: String(o._id), userId: String(o.userId), attribution: o.attribution, refunds: o.refunds, history: o.history, payment: { ...customerOrderView(o).payment, provider: o.payment.provider, providerOrderId: o.payment.providerOrderId, providerPaymentId: o.payment.providerPaymentId, amountPaise: o.payment.amountPaise } });
