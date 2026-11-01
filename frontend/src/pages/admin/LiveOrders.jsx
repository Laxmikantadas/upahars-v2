import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { paiseToInr } from '../../lib/orders';
import { Chips, Empty, fmtDate, PageHeader } from './ui';
import { notify } from '../../lib/notify';

const errText = (e) => { const m = e instanceof ApiError ? e.message : 'Something went wrong. Please try again.'; notify.error(m); return m; };
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const fullAddress = (a) => [a?.line, a?.city, [a?.state, a?.pincode].filter(Boolean).join(' – ')].filter(Boolean).join(', ');
const PAY_LABEL = { created: 'Awaiting payment', paid: 'Paid', failed: 'Failed', refunded: 'Refunded', partially_refunded: 'Partly refunded' };
const ORDER_LABEL = { pending_payment: 'Awaiting payment', paid: 'Paid', cancelled: 'Cancelled', payment_failed: 'Payment failed', expired: 'Expired' };
const SHIP_NEXT = { pending: ['processing', 'cancelled'], processing: ['shipped', 'cancelled'], shipped: ['delivered'], delivered: [], cancelled: [] };

function Pill({ children, tone = 'neutral' }) {
    const c = { good: 'bg-green-100 text-green-800', warn: 'bg-amber-100 text-amber-800', bad: 'bg-red-100 text-red-800', info: 'bg-indigo-100 text-indigo-800', neutral: 'bg-neutral-100 text-neutral-700' }[tone];
    return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${c}`}>{children}</span>;
}
const orderTone = (s) => (s === 'paid' ? 'good' : s === 'pending_payment' ? 'warn' : 'bad');
const shipTone = (s) => (s === 'delivered' ? 'good' : s === 'shipped' ? 'info' : s === 'cancelled' ? 'bad' : 'warn');
// The status the admin works with day to day: paid orders follow their shipment(s).
const fulfilment = (o) => (o.status !== 'paid' ? null : o.shipments.every((s) => s.status === 'delivered') ? 'delivered' : o.shipments.some((s) => s.status === 'shipped') ? 'shipped' : o.shipments.every((s) => s.status === 'cancelled') ? 'cancelled' : 'to ship');

function CopyButton({ text, label = 'Copy address' }) {
    const [done, setDone] = useState(false);
    return (<button type="button" className="btn-ghost !px-3 !py-1 text-xs" onClick={async () => {
            try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1800); } catch { setDone(false); }
        }}>{done ? 'Copied ✓' : label}</button>);
}

export function LiveOrders() {
    const [rows, setRows] = useState(null);
    const [err, setErr] = useState('');
    const [filter, setFilter] = useState('paid');
    const [q, setQ] = useState('');
    const load = useCallback(() => {
        setErr('');
        api('/admin/orders?limit=100').then((r) => setRows(r.orders)).catch((e) => { setErr(errText(e)); setRows([]); });
    }, []);
    useEffect(() => { load(); }, [load]);
    const list = useMemo(() => {
        const t = q.trim().toLowerCase();
        return (rows ?? []).filter((o) => (filter === 'all' || o.status === filter)
            && (!t || `${o.orderNumber} ${o.address?.name} ${o.address?.phone} ${o.address?.city} ${o.address?.pincode} ${o.address?.line}`.toLowerCase().includes(t)));
    }, [rows, filter, q]);
    const exportCsv = () => {
        const head = ['Order', 'Date', 'Customer', 'Phone', 'Delivery address', 'City', 'State', 'Pincode', 'Items', 'Total (INR)', 'Payment', 'Order status'];
        const body = list.map((o) => [o.orderNumber, o.createdAt, o.address?.name, o.address?.phone, o.address?.line, o.address?.city, o.address?.state, o.address?.pincode,
            o.items.map((i) => `${i.title} x${i.qty}${i.customization ? ` [${i.customization}]` : ''}`).join('; '), (o.totals.totalPaise / 100).toFixed(2), PAY_LABEL[o.payment.status] ?? o.payment.status, ORDER_LABEL[o.status] ?? o.status]);
        const url = URL.createObjectURL(new Blob([[head, ...body].map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a'); a.href = url; a.download = `upahars-orders-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
    };
    const count = (s) => (rows ?? []).filter((o) => o.status === s).length;
    return (<>
      <PageHeader title="Orders" subtitle={rows ? `${rows.length} loaded` : 'Loading…'} actions={<>
          <button type="button" className="btn-ghost" onClick={load}>Refresh</button>
          <button type="button" className="btn-ghost" disabled={!list.length} onClick={exportCsv}>Export CSV</button>
        </>}/>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Chips value={filter} onChange={setFilter} options={[
            { v: 'paid', label: 'Paid', count: count('paid') },
            { v: 'pending_payment', label: 'Awaiting payment', count: count('pending_payment') },
            { v: 'cancelled', label: 'Cancelled', count: count('cancelled') },
            { v: 'all', label: 'All', count: rows?.length ?? 0 },
        ]}/>
        <div className="w-full sm:w-72">
          <label htmlFor="oq" className="sr-only">Search orders</label>
          <input id="oq" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search order, name, phone, city, pincode" className="input"/>
        </div>
      </div>
      {err && <p role="alert" className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{err}</p>}
      {rows === null ? <Empty>Loading orders…</Empty> : list.length === 0 ? <Empty>No orders match.</Empty> : (<div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-cream-200/60 text-xs text-neutral-500">
              <tr><th className="px-4 py-2">Order</th><th>Date</th><th>Customer</th><th>Delivery address</th><th>Items</th><th>Total</th><th>Payment</th><th>Fulfilment</th></tr>
            </thead>
            <tbody>
              {list.map((o) => { const f = fulfilment(o); return (<tr key={o.orderNumber} className="border-t border-gold/20 align-top hover:bg-gold/5">
                  <td className="px-4 py-2.5"><Link to={`/admin/orders/${o.orderNumber}`} className="font-mono font-semibold text-burgundy underline">{o.orderNumber}</Link></td>
                  <td className="whitespace-nowrap py-2.5">{fmtDate(o.createdAt)}</td>
                  <td className="py-2.5">{o.address?.name}<br /><span className="text-xs text-neutral-500">{o.address?.phone}</span></td>
                  <td className="max-w-[16rem] py-2.5 text-xs text-neutral-700">{fullAddress(o.address)}</td>
                  <td className="py-2.5">{o.items.reduce((s, i) => s + i.qty, 0)}</td>
                  <td className="py-2.5 font-semibold">{paiseToInr(o.totals.totalPaise)}</td>
                  <td className="py-2.5"><Pill tone={orderTone(o.status)}>{ORDER_LABEL[o.status] ?? o.status}</Pill></td>
                  <td className="py-2.5">{f ? <Pill tone={f === 'delivered' ? 'good' : f === 'shipped' ? 'info' : f === 'cancelled' ? 'bad' : 'warn'}>{f}</Pill> : <span className="text-xs text-neutral-400">—</span>}</td>
                </tr>); })}
            </tbody>
          </table>
        </div>)}
    </>);
}

function ShipmentCard({ order, shipment, onUpdated }) {
    const [carrier, setCarrier] = useState(shipment.tracking?.carrier ?? '');
    const [num, setNum] = useState(shipment.tracking?.trackingNumber ?? '');
    const [url, setUrl] = useState(shipment.tracking?.trackingUrl ?? '');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const items = order.items.filter((i) => shipment.itemIds.includes(i.id));
    const options = SHIP_NEXT[shipment.status] ?? [];
    const move = async (status) => {
        if (status === 'cancelled' && !window.confirm('Cancel this shipment? Its items will be refunded.')) return;
        setBusy(true); setErr('');
        try {
            const body = { status, ...(status === 'shipped' ? { tracking: { carrier: carrier.trim(), trackingNumber: num.trim(), trackingUrl: url.trim() } } : {}) };
            const r = await api(`/admin/orders/${order.orderNumber}/shipments/${shipment.id}`, { body });
            onUpdated(r.order);
        } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
    };
    return (<div className="rounded-xl border border-gold/30 p-3 text-sm">
      <p className="flex items-center justify-between gap-2"><span className="font-semibold">{items.map((i) => i.title).join(', ') || 'Shipment'}</span><Pill tone={shipTone(shipment.status)}>{shipment.status}</Pill></p>
      {shipment.tracking && <p className="mt-1 text-xs text-neutral-600">{shipment.tracking.carrier} · {shipment.tracking.trackingNumber}{shipment.tracking.trackingUrl && <> · <a href={shipment.tracking.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-burgundy underline">Track</a></>}</p>}
      {order.status === 'paid' && options.length > 0 && (<div className="mt-3 space-y-2">
          {shipment.status === 'processing' && (<div className="grid gap-2 sm:grid-cols-3">
              <input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Carrier" aria-label="Carrier" className="input"/>
              <input value={num} onChange={(e) => setNum(e.target.value)} placeholder="Tracking number" aria-label="Tracking number" className="input"/>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Tracking link (optional)" aria-label="Tracking link" className="input"/>
            </div>)}
          <div className="flex flex-wrap gap-2">
            {options.map((s) => (<button key={s} type="button" disabled={busy} onClick={() => void move(s)} className={s === 'cancelled' ? 'btn-ghost !py-1.5 text-xs' : 'btn-primary !py-1.5 text-xs'}>
                {s === 'processing' ? 'Start processing' : s === 'shipped' ? 'Mark as shipped' : s === 'delivered' ? 'Mark as delivered' : 'Cancel shipment'}
              </button>))}
          </div>
        </div>)}
      {err && <p role="alert" className="mt-2 text-xs text-red-700">{err}</p>}
    </div>);
}

export function LiveOrderDetail() {
    const { id = '' } = useParams();
    const [o, setO] = useState(null);
    const [err, setErr] = useState('');
    useEffect(() => {
        let alive = true;
        setO(null); setErr('');
        api(`/admin/orders/${encodeURIComponent(id)}`).then((r) => alive && setO(r.order)).catch((e) => alive && setErr(errText(e)));
        return () => { alive = false; };
    }, [id]);
    if (err) return <Empty>{err} <Link to="/admin/orders" className="font-semibold text-burgundy underline">Back to orders</Link></Empty>;
    if (!o) return <Empty>Loading order…</Empty>;
    const a = o.address ?? {};
    const addressText = [a.name, a.phone, a.line, `${a.city ?? ''}${a.state ? `, ${a.state}` : ''}${a.pincode ? ` – ${a.pincode}` : ''}`].filter(Boolean).join('\n');
    return (<>
      <p className="mb-2 text-sm"><Link to="/admin/orders" className="text-burgundy underline">← Orders</Link></p>
      <PageHeader title={o.orderNumber} subtitle={new Date(o.createdAt).toLocaleString('en-IN')} actions={<Pill tone={orderTone(o.status)}>{ORDER_LABEL[o.status] ?? o.status}</Pill>}/>

      <section className="card mb-4 border-2 border-gold/60 bg-gold/5" aria-label="Delivery address">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xl font-bold">📍 Delivery address</h2>
          <CopyButton text={addressText}/>
        </div>
        <p className="mt-2 text-base font-semibold">{a.name}</p>
        <p className="text-sm">📞 {a.phone}{a.email && <> · ✉️ {a.email}</>}</p>
        <p className="mt-1 whitespace-pre-line text-sm">{a.line}{'\n'}{a.city}{a.state ? `, ${a.state}` : ''}{a.pincode ? ` – ${a.pincode}` : ''}</p>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <section className="card">
            <h2 className="text-xl font-bold">Items</h2>
            <ul className="mt-2 divide-y divide-gold/20 text-sm">
              {o.items.map((i) => (<li key={i.id} className="flex justify-between gap-3 py-2">
                  <span>{i.title}{i.variantName ? ` (${i.variantName})` : ''} × {i.qty}{i.customization && <em className="block text-xs text-burgundy-700">Personalization: “{i.customization}”</em>}{i.refundedQty > 0 && <span className="block text-xs text-red-700">{i.refundedQty} refunded</span>}</span>
                  <span>{paiseToInr(i.unitPaise * i.qty)}</span>
                </li>))}
            </ul>
            <div className="mt-2 space-y-0.5 border-t border-gold/40 pt-2 text-sm">
              <p className="flex justify-between"><span>Subtotal</span><span>{paiseToInr(o.totals.subtotalPaise)}</span></p>
              {o.totals.discountPaise > 0 && <p className="flex justify-between text-green-700"><span>Discount{o.coupon?.code ? ` (${o.coupon.code})` : ''}</span><span>− {paiseToInr(o.totals.discountPaise)}</span></p>}
              <p className="flex justify-between"><span>Shipping</span><span>{o.totals.shippingPaise ? paiseToInr(o.totals.shippingPaise) : 'Free'}</span></p>
              <p className="flex justify-between text-base font-bold text-burgundy-700"><span>Total</span><span>{paiseToInr(o.totals.totalPaise)}</span></p>
              {o.refundedPaise > 0 && <p className="flex justify-between text-red-700"><span>Refunded</span><span>{paiseToInr(o.refundedPaise)}</span></p>}
            </div>
          </section>
          <section className="card">
            <h2 className="text-xl font-bold">Fulfilment</h2>
            {o.status !== 'paid' && <p className="mt-1 text-sm text-neutral-600">Shipping can start once the order is paid.</p>}
            <div className="mt-2 space-y-3">
              {o.shipments.map((s) => <ShipmentCard key={s.id} order={o} shipment={s} onUpdated={setO}/>)}
            </div>
          </section>
        </div>
        <div className="space-y-4">
          <section className="card text-sm">
            <h2 className="text-xl font-bold">Payment</h2>
            <p className="mt-1"><Pill tone={o.payment.status === 'paid' ? 'good' : 'warn'}>{PAY_LABEL[o.payment.status] ?? o.payment.status}</Pill></p>
            {o.payment.method && <p className="mt-1">Method: {o.payment.method}</p>}
            {o.payment.paidAt && <p>Paid: {new Date(o.payment.paidAt).toLocaleString('en-IN')}</p>}
            {o.payment.providerPaymentId && <p className="break-all text-xs text-neutral-500">Ref: {o.payment.providerPaymentId}</p>}
          </section>
        </div>
      </div>
    </>);
}
