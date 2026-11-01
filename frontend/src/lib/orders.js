import { api } from './api';
/* ───────── connect the storefront's products to the real catalogue ───────── */
// The storefront pages still show built-in sample products. The server prices and sells the SAME products by title
// (created by `npm run seed`), so each cart line is matched to its server product here — the server then uses ITS prices.
let catalog = null;
export const loadCatalog = () => (catalog ??= api('/products?limit=48')
    .then((r) => new Map(r.products.map((p) => [p.title.trim().toLowerCase(), p])))
    .catch((e) => { catalog = null; throw e; }));
export class CartProblem extends Error {
}
export async function toServerItems(lines) {
    const map = await loadCatalog();
    return lines.map((l) => {
        const p = map.get(l.product.name.trim().toLowerCase());
        if (!p)
            throw new CartProblem(`“${l.product.name}” is not available for online ordering yet. Remove it from your cart to continue.`);
        const v = p.variants.find((x) => x.inStock) ?? p.variants[0];
        return { productId: p.id, ...(v ? { variantId: v.id } : {}), qty: l.qty, ...(l.note ? { customization: l.note } : {}) };
    });
}
export const getQuote = (items, couponCode) => api('/orders/quote', { body: { items, ...(couponCode ? { couponCode } : {}) } }).then((r) => r.quote);
export const startCheckout = (items, address, couponCode, idempotencyKey) => api('/orders/checkout', {
    body: { items, address, ...(couponCode ? { couponCode } : {}) }, headers: { 'Idempotency-Key': idempotencyKey },
});
export const verifyPayment = (orderNumber, paymentId, signature) => api('/payments/verify', { body: { orderNumber, paymentId, signature } }).then((r) => r.order);
/** Development only (mock provider): pretends the customer paid, through the same verification path as Razorpay. */
export const simulatePayment = (orderNumber, outcome = 'success') => api('/dev/payments/simulate', { body: { orderNumber, outcome } }).then((r) => r.order);
export const listOrders = () => api('/orders').then((r) => r.orders);
export const getOrder = (n) => api(`/orders/${encodeURIComponent(n)}`).then((r) => r.order);
export const cancelOrder = (n) => api(`/orders/${encodeURIComponent(n)}/cancel`, { body: {} }).then((r) => r.order);
export const paiseToInr = (p) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(p / 100);
export const STATUS_LABEL = {
    pending_payment: 'Awaiting payment', paid: 'Confirmed', cancelled: 'Cancelled', payment_failed: 'Payment failed', expired: 'Expired',
};
/** What to show the customer. A cancelled-and-refunded order stays "paid" on the server (the payment happened), so look at the refund too. */
export const orderLabel = (o) => o.payment.status === 'refunded' ? 'Cancelled · refunded' : o.payment.status === 'partially_refunded' ? 'Confirmed · partly refunded' : STATUS_LABEL[o.status];
export const isFullyRefunded = (o) => o.payment.status === 'refunded';
