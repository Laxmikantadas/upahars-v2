import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { inr } from '../data/demo';
import { COUPONS, FREE_SHIPPING_ABOVE, GIFT_WRAP_FEE } from '../lib/pricing';
import { describeOffer } from '../lib/catalog';
import SignInPrompt from '../components/SignInPrompt';
import { useStore } from '../lib/store';
import { notify } from '../lib/notify';
export function Summary() {
    const { totals, coupon } = useStore();
    const row = (l, v, cls = '') => <div className={`flex justify-between py-1 text-sm ${cls}`}><span>{l}</span><span>{v}</span></div>;
    return (<div>
      {row('Subtotal', inr(totals.subtotal))}
      {totals.discount > 0 && row(`Discount (${totals.couponApplied})`, `− ${inr(totals.discount)}`, 'text-green-700')}
      {(totals.wrap > 0 || totals.couponApplied === 'FREEWRAP') && row('Gift wrapping', totals.wrap > 0 ? inr(totals.wrap) : 'Free', totals.wrap > 0 ? '' : 'text-green-700')}
      {row('Shipping', totals.shipping ? inr(totals.shipping) : 'Free')}
      <div className="mt-1 flex justify-between border-t border-gold/40 pt-2 text-base font-bold text-burgundy-700"><span>Total</span><span>{inr(totals.total)}</span></div>
      {coupon && totals.couponError && <p role="alert" className="mt-2 text-xs text-red-700">{totals.couponError}</p>}
    </div>);
}
export default function Cart() {
    const { cart, setQty, removeLine, coupon, setCoupon, giftWrap, setGiftWrap, totals, user, isLive, offers } = useStore();
    useEffect(() => {
        if (totals.couponApplied && totals.discount > 0)
            notify.success(`Coupon ${totals.couponApplied} applied. You saved ${inr(totals.discount)}!`, { title: 'Sweet deal!', emoji: '🏷️' });
    }, [totals.couponApplied]); // eslint-disable-line react-hooks/exhaustive-deps
    if (!user)
        return <SignInPrompt title="Sign in to view your cart"/>;
    if (!cart.length) {
        return (<div className="container-page py-16 text-center">
        <p className="text-5xl">🛍️</p>
        <h1 className="mt-2 text-3xl font-bold">Your cart is empty</h1>
        <Link to="/categories" className="btn-primary mt-5">Start shopping</Link>
      </div>);
    }
    return (<div className="container-page py-6">
      <h1 className="text-3xl font-bold">Your cart</h1>
      <div className="mt-4 grid gap-6 md:grid-cols-[1.6fr_1fr]">
        <ul className="space-y-3">
          {cart.map((l) => (<li key={l.key} className="card flex gap-3">
              <Link to={`/product/${l.product.slug}`} className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl text-4xl" style={{ background: `linear-gradient(135deg, ${l.product.from}, ${l.product.to})` }} aria-label={l.product.name}>
                {l.product.image
            ? <img src={l.product.image} alt={l.product.name} loading="lazy" className="absolute inset-0 h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }}/>
            : <span aria-hidden="true">{l.product.emoji}</span>}
              </Link>
              <div className="flex-1">
                <Link to={`/product/${l.product.slug}`} className="text-sm font-semibold text-neutral-800">{l.product.name}</Link>
                {l.note && <p className="text-xs text-neutral-600">Personalization: “{l.note}”</p>}
                <p className="text-sm font-bold text-burgundy-700">{inr(l.unitPrice)}</p>
                <div className="mt-1 flex items-center gap-3 text-sm">
                  <div className="flex items-center rounded-lg border border-gold/40">
                    <button type="button" aria-label="Decrease quantity" className="px-2.5 py-1" onClick={() => setQty(l.key, l.qty - 1)}>−</button>
                    <span className="w-7 text-center">{l.qty}</span>
                    <button type="button" aria-label="Increase quantity" className="px-2.5 py-1" onClick={() => setQty(l.key, l.qty + 1)}>+</button>
                  </div>
                  <button type="button" onClick={() => removeLine(l.key)} className="text-xs text-red-700 underline">Remove</button>
                </div>
              </div>
              <p className="text-sm font-semibold">{inr(l.unitPrice * l.qty)}</p>
            </li>))}
        </ul>

        <aside className="card h-fit space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={giftWrap} onChange={(e) => setGiftWrap(e.target.checked)}/>
            Add gift wrapping ({inr(GIFT_WRAP_FEE)})
          </label>
          <div>
            <label htmlFor="coupon" className="label">Coupon code</label>
            <input id="coupon" value={coupon} onChange={(e) => setCoupon(e.target.value)} placeholder={isLive ? 'Enter coupon code' : 'e.g. DEMODIWALI15'} className="input font-mono uppercase"/>
            {isLive
            ? offers.length > 0 && <p className="mt-1 text-xs text-neutral-500">Offers: {offers.map((o) => `${o.code} (${describeOffer(o)})`).join(', ')}</p>
            : <p className="mt-1 text-xs text-neutral-500">Try: {COUPONS.map((c) => c.code).join(', ')}</p>}
          </div>
          <Summary />
          {totals.shipping > 0 && <p className="text-xs text-neutral-500">Add {inr(FREE_SHIPPING_ABOVE - (totals.subtotal - totals.discount))} more for free shipping.</p>}
          <Link to="/checkout" className="btn-primary w-full">Proceed to checkout</Link>
        </aside>
      </div>
    </div>);
}
