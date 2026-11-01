import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { inr } from '../data/demo';
import { api, ApiError } from '../lib/api';
import { useStore } from '../lib/store';
import { CartProblem, getQuote, paiseToInr, simulatePayment, startCheckout, toServerItems, verifyPayment } from '../lib/orders';
import { payWithRazorpay } from '../lib/payments';
import { checkServiceability, isPincode, recallPincode, rememberPincode } from '../lib/shipping';
import SignInPrompt from '../components/SignInPrompt';
import { notify } from '../lib/notify';
/** Works on plain http (phone testing on your Wi-Fi) too, where crypto.randomUUID is not available. */
const newKey = () => 'up-' + Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join('') + Date.now().toString(36);
const STATES = ['Odisha', 'West Bengal', 'Jharkhand', 'Andhra Pradesh', 'Telangana', 'Karnataka', 'Tamil Nadu', 'Maharashtra', 'Delhi', 'Gujarat', 'Uttar Pradesh', 'Other'];
export default function Checkout() {
    const { cart, user, totals, coupon, giftWrap, setCoupon, clearCart } = useStore();
    const navigate = useNavigate();
    const [a, setA] = useState({ name: user?.name ?? '', phone: user?.phone ?? '', email: '', line: '', city: '', state: 'Odisha', pincode: recallPincode() });
    const [errors, setErrors] = useState({});
    const [quote, setQuote] = useState(null);
    const [quoteErr, setQuoteErr] = useState('');
    const [provider, setProvider] = useState('');
    const [busy, setBusy] = useState(false);
    const [payErr, setPayErr] = useState('');
    useEffect(() => { if (payErr) notify.error(payErr, { title: 'Payment hiccup' }); }, [payErr]);
    const [retry, setRetry] = useState(false);
    const [pinCheck, setPinCheck] = useState(null); // courier answer for the typed pincode: { status: 'checking' | 'ok' | 'no' | 'unknown' | 'error', message }
    // one idempotency key per distinct order attempt: a double click or "Pay again" re-uses the SAME server order, never a second one
    const attempt = useRef({ sig: '', key: '' });
    // Which payment gateway is live (Razorpay in production, a test gateway in development)
    useEffect(() => { api('/health').then((h) => setProvider(h.payments)).catch(() => setProvider('')); }, []);
    // The SERVER prices the order (its own catalogue, shipping and coupon rules) — this is the amount that is charged.
    const cartSig = cart.map((l) => `${l.product.name}|${l.qty}|${l.note ?? ''}`).join(';') + `#${coupon}`;
    useEffect(() => {
        let alive = true;
        setQuote(null);
        setQuoteErr('');
        if (!cart.length)
            return;
        toServerItems(cart).then((items) => getQuote(items, coupon || undefined))
            .then((q) => alive && setQuote(q))
            .catch((e) => alive && setQuoteErr(e instanceof ApiError || e instanceof CartProblem ? e.message : 'Could not get the latest price. Please try again.'));
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cartSig]);
    // As soon as a full pincode is typed (and whenever the cart changes), ask the server whether the courier can deliver there.
    // The server checks again when the order is placed, so this only gives early feedback.
    useEffect(() => {
        if (!user || !cart.length || !isPincode(a.pincode)) {
            setPinCheck(null);
            return undefined;
        }
        let alive = true;
        setErrors((x) => (x.pincode ? { ...x, pincode: undefined } : x));
        setPinCheck({ status: 'checking', message: 'Checking delivery to this pincode…' });
        const t = setTimeout(() => {
            toServerItems(cart).then((items) => checkServiceability(items, a.pincode))
                .then((r) => { if (!alive)
                return; if (r.status === 'ok' || r.status === 'no')
                rememberPincode(a.pincode); setPinCheck(r); })
                .catch(() => alive && setPinCheck(null));
        }, 400);
        return () => { alive = false; clearTimeout(t); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [a.pincode, cartSig, Boolean(user)]);
    if (!user)
        return <SignInPrompt title="Sign in to check out"/>;
    if (!cart.length) {
        return <div className="container-page py-16 text-center"><h1 className="text-3xl font-bold">Nothing to check out</h1><Link to="/categories" className="btn-primary mt-5">Browse products</Link></div>;
    }
    const set = (k) => (e) => setA((x) => ({ ...x, [k]: e.target.value }));
    const validate = () => {
        const err = {};
        if (a.name.trim().length < 2)
            err.name = 'Enter your full name';
        if (!/^[6-9]\d{9}$/.test(a.phone))
            err.phone = 'Enter a valid 10-digit mobile number';
        if (a.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(a.email))
            err.email = 'Enter a valid email or leave blank';
        if (a.line.trim().length < 6)
            err.line = 'Enter your full address';
        if (a.city.trim().length < 2)
            err.city = 'Enter your city';
        if (!/^[1-9]\d{5}$/.test(a.pincode))
            err.pincode = 'Enter a 6-digit pincode';
        setErrors(err);
        return Object.keys(err).length === 0;
    };
    const done = (orderNumber) => { clearCart(); notify.celebrate(`Order ${orderNumber} is placed. Thank you for shopping with Upahars!`, { title: 'Order placed!' }); navigate(`/order/${orderNumber}`, { replace: true }); };
    const submit = async (e) => {
        e.preventDefault();
        if (busy)
            return;
        if (!validate()) {
            notify.error('Please check the highlighted fields and try again.', { title: 'Missing something' });
            return;
        }
        if (pinCheck?.status === 'no') {
            setErrors((x) => ({ ...x, pincode: pinCheck.message }));
            notify.error(pinCheck.message, { title: 'Pincode problem', emoji: '📍' });
            return;
        }
        setBusy(true);
        setPayErr('');
        setRetry(false);
        let orderNumber = '';
        try {
            const items = await toServerItems(cart);
            const address = { ...a, name: a.name.trim(), line: a.line.trim(), city: a.city.trim(), email: a.email.trim() };
            const sig = JSON.stringify({ items, address, coupon });
            if (attempt.current.sig !== sig)
                attempt.current = { sig, key: newKey() };
            const { order, payment } = await startCheckout(items, address, coupon || undefined, attempt.current.key);
            orderNumber = order.orderNumber;
            if (!payment)
                return done(order.orderNumber); // already paid (e.g. a repeated click)
            if (payment.provider === 'mock') { // development gateway: same verification path, no real money
                await simulatePayment(order.orderNumber, 'success');
                return done(order.orderNumber);
            }
            const r = await payWithRazorpay({
                keyId: payment.keyId, providerOrderId: payment.providerOrderId, amountPaise: payment.amountPaise,
                description: `Order ${order.orderNumber}`, prefill: { name: address.name, contact: address.phone, email: address.email || undefined },
            });
            if ('cancelled' in r) {
                setPayErr('Payment was not completed. Your items are held for a short time — you can try again.');
                setRetry(true);
                return;
            }
            if ('failed' in r) {
                setPayErr(`${r.failed} You can try again or use another payment method in the payment window.`);
                setRetry(true);
                return;
            }
            await verifyPayment(order.orderNumber, r.paymentId, r.signature);
            done(order.orderNumber);
        }
        catch (x) {
            if (x instanceof ApiError && x.code === 'payment_check_failed' && orderNumber)
                return done(orderNumber); // charged; the gateway will confirm it automatically
            setPayErr(x instanceof ApiError || x instanceof CartProblem || x instanceof Error ? x.message : 'Something went wrong. Please try again.');
            setRetry(Boolean(orderNumber));
        }
        finally {
            setBusy(false);
        }
    };
    const field = (k, label, props = {}) => (<div>
      <label htmlFor={k} className="label">{label}</label>
      <input id={k} value={a[k]} onChange={set(k)} className="input" aria-invalid={Boolean(errors[k])} {...props}/>
      {errors[k] && <p role="alert" className="mt-1 text-xs text-red-700">{errors[k]}</p>}
    </div>);
    return (<form onSubmit={(e) => void submit(e)} noValidate className="container-page py-6">
      <h1 className="text-3xl font-bold">Checkout</h1>
      <div className="mt-4 grid gap-6 md:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          <section className="card grid gap-3 sm:grid-cols-2">
            <h2 className="text-xl font-bold sm:col-span-2">Delivery address</h2>
            {field('name', 'Full name *', { autoComplete: 'name' })}
            {field('phone', 'Delivery contact number *', { inputMode: 'numeric', maxLength: 10, autoComplete: 'tel' })}
            {field('email', 'Email (optional)', { type: 'email', autoComplete: 'email' })}
            <div className="sm:col-span-2">{field('line', 'Address *', { autoComplete: 'street-address', placeholder: 'House no, street, area, landmark' })}</div>
            {field('city', 'City *')}
            <div>
              <label htmlFor="state" className="label">State *</label>
              <select id="state" value={a.state} onChange={set('state')} className="input">{STATES.map((s) => <option key={s}>{s}</option>)}</select>
            </div>
            <div>
              {field('pincode', 'Pincode *', { inputMode: 'numeric', maxLength: 6, autoComplete: 'postal-code' })}
              {pinCheck && !errors.pincode && <p role="status" aria-live="polite" className={`mt-1 text-xs font-medium ${pinCheck.status === 'ok' ? 'text-green-700' : pinCheck.status === 'no' || pinCheck.status === 'error' ? 'text-red-700' : pinCheck.status === 'unknown' ? 'text-amber-800' : 'text-neutral-500'}`}>{pinCheck.status === 'ok' ? '✓ ' : pinCheck.status === 'no' ? '✗ ' : ''}{pinCheck.message}</p>}
            </div>
          </section>

          <section className="card">
            <h2 className="text-xl font-bold">Payment</h2>
            <div className="mt-2 space-y-2 text-sm">
              <label className="flex items-start gap-2 rounded-lg border border-gold/50 bg-gold/10 p-3">
                <input type="radio" name="pay" checked readOnly/>
                <span>
                  <b>{provider === 'none' ? 'Pay on delivery' : 'Pay online — UPI, cards and wallets'}</b>
                  <br /><span className="text-neutral-600">{provider === 'none' ? 'No online payment is needed. Your order is confirmed as soon as you place it.' : provider === 'mock' ? 'Test mode: no real payment is made.' : 'Secure payment by Razorpay. You choose UPI, card or wallet in the next window. (Cash on delivery and net banking are not offered.)'}</span>
                </span>
              </label>
            </div>
          </section>
        </div>

        <aside className="card h-fit">
          <h2 className="text-xl font-bold">Order summary</h2>
          <ul className="my-2 divide-y divide-gold/20 text-sm">
            {cart.map((l) => (<li key={l.key} className="flex justify-between gap-2 py-1.5"><span>{l.product.name} × {l.qty}{l.note && <em className="block text-xs text-neutral-500">“{l.note}”</em>}</span><span>{inr(l.unitPrice * l.qty)}</span></li>))}
          </ul>
          {quote ? (<div className="text-sm">
              <p className="flex justify-between py-1"><span>Subtotal</span><span>{paiseToInr(quote.subtotalPaise)}</span></p>
              {quote.discountPaise > 0 && <p className="flex justify-between py-1 text-green-700"><span>Discount{quote.coupon ? ` (${quote.coupon.code})` : ''}</span><span>− {paiseToInr(quote.discountPaise)}</span></p>}
              <p className="flex justify-between py-1"><span>Shipping</span><span>{quote.shippingPaise ? paiseToInr(quote.shippingPaise) : 'Free'}</span></p>
              <p className="mt-1 flex justify-between border-t border-gold/40 pt-2 text-base font-bold text-burgundy-700"><span>Total</span><span>{paiseToInr(quote.totalPaise)}</span></p>
              {giftWrap && <p className="mt-2 text-xs text-neutral-500">Gift wrapping is not charged online yet — mention it in your item note.</p>}
            </div>) : quoteErr ? (<div role="alert" className="text-sm text-red-700">{quoteErr}{coupon && <button type="button" className="ml-2 underline" onClick={() => setCoupon('')}>Remove coupon</button>}</div>) : <p className="text-sm text-neutral-500" role="status">Getting the latest price… (cart total {inr(totals.total)})</p>}
          {payErr && <p role="alert" className="mt-3 rounded-lg bg-red-50 p-2 text-xs text-red-800">{payErr}</p>}
          <button type="submit" className="btn-primary mt-4 w-full" disabled={busy || !quote || pinCheck?.status === 'no'}>
            {busy ? 'Processing…' : retry ? `Pay again · ${quote ? paiseToInr(quote.totalPaise) : ''}` : provider === 'none' ? `Place order · ${quote ? paiseToInr(quote.totalPaise) : ''}` : `Pay securely · ${quote ? paiseToInr(quote.totalPaise) : ''}`}
          </button>
          <p className="mt-2 text-center text-xs text-neutral-500">By ordering you agree to our <Link to="/terms-and-conditions" className="underline">Terms</Link>.</p>
        </aside>
      </div>
    </form>);
}
