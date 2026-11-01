import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { cancelOrder, getOrder, isFullyRefunded, orderLabel, paiseToInr } from '../lib/orders';
/** A real order from the server. The customer can only ever see their own orders (the server returns 404 for anyone else's). */
export default function OrderDetail() {
    const { id = '' } = useParams();
    const [o, setO] = useState(null);
    const [state, setState] = useState('loading');
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);
    const load = useCallback(() => getOrder(id).then((x) => { setO(x); setState('ready'); })
        .catch((e) => setState(e instanceof ApiError && e.status === 404 ? 'missing' : 'error')), [id]);
    useEffect(() => { void load(); }, [load]);
    // payment confirmation can take a few seconds to reach us (webhook) — keep checking while it is pending
    useEffect(() => {
        if (o?.status !== 'pending_payment')
            return;
        const t = setInterval(() => void load(), 5000);
        return () => clearInterval(t);
    }, [o?.status, load]);
    if (state === 'loading')
        return <div className="container-page max-w-md py-16 text-center text-sm text-neutral-600" role="status">Loading your order…</div>;
    if (state === 'error')
        return <div className="container-page py-16 text-center"><h1 className="text-3xl font-bold">Could not load the order</h1><button type="button" className="btn-primary mt-5" onClick={() => { setState('loading'); void load(); }}>Try again</button></div>;
    if (state === 'missing' || !o)
        return <div className="container-page py-16 text-center"><h1 className="text-3xl font-bold">Order not found</h1><Link to="/" className="btn-primary mt-5">Home</Link></div>;
    const canCancel = !isFullyRefunded(o) && (o.status === 'pending_payment' || o.status === 'paid') && o.shipments.every((s) => ['pending', 'processing', 'cancelled'].includes(s.status));
    const cancel = async () => {
        if (!window.confirm('Cancel this order?' + (o.status === 'paid' ? ' Your payment will be refunded.' : '')))
            return;
        setBusy(true);
        setMsg('');
        try {
            setO(await cancelOrder(o.orderNumber));
        }
        catch (e) {
            setMsg(e instanceof ApiError ? e.message : 'Could not cancel. Please try again.');
        }
        finally {
            setBusy(false);
        }
    };
    const paid = o.status === 'paid' && !isFullyRefunded(o);
    return (<div className="container-page max-w-3xl py-8">
      <div className="card text-center">
        <p className="text-5xl">{paid ? '🎉' : o.status === 'pending_payment' ? '⏳' : 'ℹ️'}</p>
        <h1 className="text-3xl font-bold">{paid ? `Thank you, ${o.address.name.split(' ')[0]}!` : orderLabel(o)}</h1>
        <p className="mt-1 text-sm text-neutral-600">Order <b className="font-mono">{o.orderNumber}</b> · {new Date(o.createdAt).toLocaleString('en-IN')}</p>
        <p className="mt-2 inline-block rounded-full bg-gold/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-burgundy-700">{orderLabel(o)}</p>
        {o.status === 'pending_payment' && <p className="mt-2 text-sm text-neutral-600">We are waiting for the payment confirmation. If you were charged, this page updates by itself within a minute.</p>}
      </div>
      <div className="card mt-4">
        <ul className="divide-y divide-gold/20 text-sm">
          {o.items.map((i) => <li key={i.id} className="flex justify-between py-2"><span>{i.title}{i.variantName ? ` (${i.variantName})` : ''} × {i.qty}{i.customization && <em className="block text-xs text-neutral-500">Personalization: “{i.customization}”</em>}</span><span>{paiseToInr(i.unitPaise * i.qty)}</span></li>)}
        </ul>
        <div className="mt-2 space-y-0.5 border-t border-gold/40 pt-2 text-sm">
          <p className="flex justify-between"><span>Subtotal</span><span>{paiseToInr(o.totals.subtotalPaise)}</span></p>
          {o.totals.discountPaise > 0 && <p className="flex justify-between text-green-700"><span>Discount{o.coupon.code ? ` (${o.coupon.code})` : ''}</span><span>− {paiseToInr(o.totals.discountPaise)}</span></p>}
          <p className="flex justify-between"><span>Shipping</span><span>{o.totals.shippingPaise ? paiseToInr(o.totals.shippingPaise) : 'Free'}</span></p>
          <p className="flex justify-between text-base font-bold text-burgundy-700"><span>Total</span><span>{paiseToInr(o.totals.totalPaise)}</span></p>
        </div>
      </div>
      <div className="card mt-4 text-sm">
        <p className="font-semibold text-burgundy-700">Delivering to</p>
        <p>{o.address.name} · {o.address.phone}</p>
        <p>{o.address.line}, {o.address.city}, {o.address.state} – {o.address.pincode}</p>
        <p className="mt-2 text-neutral-600">Payment: {o.payment.status === 'paid' ? `Paid online${o.payment.method ? ` (${o.payment.method})` : ''}` : o.payment.status === 'refunded' ? 'Refunded' : 'Not paid yet'}</p>
        {o.shipments.filter((s) => s.tracking).map((s) => <p key={s.id} className="mt-1 text-neutral-600">Tracking: {s.tracking.carrier} · {s.tracking.trackingUrl ? <a className="underline" href={s.tracking.trackingUrl} target="_blank" rel="noreferrer">{s.tracking.trackingNumber}</a> : s.tracking.trackingNumber}</p>)}
      </div>
      {msg && <p role="alert" className="mt-3 text-center text-sm text-red-700">{msg}</p>}
      <div className="mt-5 flex flex-wrap justify-center gap-3">
        <Link to="/account" className="btn-ghost">My orders</Link>
        {canCancel && <button type="button" className="btn-ghost" disabled={busy} onClick={() => void cancel()}>{busy ? 'Cancelling…' : 'Cancel order'}</button>}
        <Link to="/categories" className="btn-primary">Continue shopping</Link>
      </div>
    </div>);
}
