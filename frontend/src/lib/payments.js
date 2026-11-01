// Razorpay Checkout (the pop-up that offers UPI, cards and wallets). Net banking is switched off in the pop-up
// (see `method` below). This is a display setting only: to enforce it for good, also turn Net Banking off in
// Razorpay Dashboard → Account & Settings → Payment Methods.
// The amount and order are created by OUR server; the browser only opens the pop-up and reports back,
// and the server re-checks the payment with Razorpay before the order counts as paid.
const SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let loading = null;
export function loadRazorpay() {
    if (typeof window === 'undefined')
        return Promise.reject(new Error('no window'));
    if (window.Razorpay)
        return Promise.resolve();
    loading ??= new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = SRC;
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => { loading = null; s.remove(); reject(new Error('Could not load the payment window. Check your internet connection and try again.')); };
        document.head.appendChild(s);
    });
    return loading;
}
/** Opens the Razorpay pop-up and resolves when the customer pays, closes it, or the payment fails. */
export async function payWithRazorpay(o) {
    await loadRazorpay();
    const Rz = window.Razorpay;
    if (!Rz)
        throw new Error('The payment window is not available.');
    return new Promise((resolve) => {
        let done = false;
        const finish = (r) => { if (!done) {
            done = true;
            resolve(r);
        } };
        const rz = new Rz({
            key: o.keyId, amount: o.amountPaise, currency: 'INR', order_id: o.providerOrderId,
            name: 'Upahars', description: o.description, prefill: o.prefill, theme: { color: '#7A1118' },
            method: { netbanking: false }, // online payment only, but no net banking
            handler: (r) => finish({ paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }),
            modal: { ondismiss: () => finish({ cancelled: true }) },
        });
        rz.on('payment.failed', (r) => finish({ failed: r.error?.description ?? 'The payment failed.' }));
        rz.open();
    });
}
