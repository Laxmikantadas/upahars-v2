import { randomUUID } from 'node:crypto';
import { hmacHex, safeEqual } from './crypto.js';

// Payment provider interface:
//   createOrder({ amountPaise, receipt, notes }) -> { providerOrderId, checkout }
//   verifySignature({ providerOrderId, paymentId, signature }) -> boolean
//   verifyWebhook(rawBody, signature) -> boolean
//   fetchPayment(paymentId) -> { id, orderId, status, amountPaise }   (server-side status check)
//   refund({ paymentId, amountPaise, receipt }) -> { providerRefundId }

export function createRazorpayProvider(config, fetchImpl = fetch) {
  const { RAZORPAY_KEY_ID: keyId, RAZORPAY_KEY_SECRET: secret, RAZORPAY_WEBHOOK_SECRET: whSecret } = config;
  if (!keyId || !secret) throw new Error('Razorpay needs RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET');
  const auth = 'Basic ' + Buffer.from(`${keyId}:${secret}`).toString('base64');
  const call = async (path, init = {}) => {
    const res = await fetchImpl(`https://api.razorpay.com/v1${path}`, { ...init, headers: { Authorization: auth, 'Content-Type': 'application/json' } });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Razorpay error ${res.status}: ${json?.error?.description ?? 'request failed'}`);
    return json;
  };
  return {
    name: 'razorpay',
    async createOrder({ amountPaise, receipt, notes }) {
      const o = await call('/orders', { method: 'POST', body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt, notes }) });
      return { providerOrderId: o.id, checkout: { keyId, currency: 'INR' } };
    },
    verifySignature: ({ providerOrderId, paymentId, signature }) => safeEqual(hmacHex(secret, `${providerOrderId}|${paymentId}`), signature),
    verifyWebhook: (rawBody, signature) => Boolean(whSecret) && safeEqual(hmacHex(whSecret, rawBody), signature),
    async fetchPayment(paymentId) {
      const p = await call(`/payments/${encodeURIComponent(paymentId)}`);
      return { id: p.id, orderId: p.order_id, status: p.status, amountPaise: p.amount, method: p.method };
    },
    async refund({ paymentId, amountPaise, receipt }) {
      const r = await call(`/payments/${encodeURIComponent(paymentId)}/refund`, { method: 'POST', body: JSON.stringify({ amount: amountPaise, receipt }) });
      return { providerRefundId: r.id };
    },
  };
}

/**
 * DEVELOPMENT/TEST ONLY. Behaves like a payment gateway but nothing is real. It can never be enabled in
 * production (config refuses it). A "payment" only succeeds through the same signature-verification path as
 * Razorpay, so the order flow is exercised honestly without pretending money moved.
 */
export function createMockProvider(config) {
  if (config.NODE_ENV === 'production') throw new Error('The mock payment provider cannot be used in production');
  const secret = 'mock-secret-for-development-only';
  const orders = new Map(); const payments = new Map();
  return {
    name: 'mock',
    async createOrder({ amountPaise }) {
      const providerOrderId = 'order_mock_' + randomUUID().slice(0, 12);
      orders.set(providerOrderId, { amountPaise });
      return { providerOrderId, checkout: { keyId: 'mock', currency: 'INR' } };
    },
    verifySignature: ({ providerOrderId, paymentId, signature }) => safeEqual(hmacHex(secret, `${providerOrderId}|${paymentId}`), signature),
    verifyWebhook: (rawBody, signature) => safeEqual(hmacHex(secret, rawBody), signature),
    async fetchPayment(paymentId) { const p = payments.get(paymentId); if (!p) throw new Error('unknown payment'); return p; },
    async refund({ paymentId }) { if (!payments.has(paymentId)) throw new Error('unknown payment'); return { providerRefundId: 'rfnd_mock_' + randomUUID().slice(0, 10) }; },
    // dev helper used by /api/dev/payments/simulate and by tests
    _simulate(providerOrderId, outcome = 'success') {
      const o = orders.get(providerOrderId); if (!o) throw new Error('unknown order');
      const paymentId = 'pay_mock_' + randomUUID().slice(0, 12);
      payments.set(paymentId, { id: paymentId, orderId: providerOrderId, status: outcome === 'success' ? 'captured' : 'failed', amountPaise: o.amountPaise, method: 'mock' });
      return { paymentId, signature: hmacHex(secret, `${providerOrderId}|${paymentId}`) };
    },
    _webhookSign: (raw) => hmacHex(secret, raw),
    _tamperAmount(paymentId, amountPaise) { payments.get(paymentId).amountPaise = amountPaise; },
  };
}

/**
 * NO PAYMENT GATEWAY. Orders are confirmed as soon as they are placed (pay on delivery / pay later, handled outside the site).
 * Nothing is charged online, so there is nothing to verify and nothing to refund through a gateway.
 */
export function createNoPaymentProvider() {
  const off = () => { throw new Error('Online payments are switched off'); };
  return {
    name: 'none',
    createOrder: off,
    verifySignature: () => false,
    verifyWebhook: () => false,
    fetchPayment: off,
    async refund() { return { providerRefundId: 'offline' }; }, // cancelling an order needs no gateway refund
  };
}

export const createPaymentProvider = (config) =>
  config.PAYMENT_PROVIDER === 'razorpay' ? createRazorpayProvider(config) : config.PAYMENT_PROVIDER === 'none' ? createNoPaymentProvider() : createMockProvider(config);
