import { Link, useParams } from 'react-router-dom';
import { inr } from '../../data/demo';
import { ORDER_STATUSES, useStore } from '../../lib/store';
import { Badge, Empty, PageHeader } from './ui';
import { LiveOrderDetail } from './LiveOrders';
const FLOW = ['placed', 'confirmed', 'shipped', 'delivered'];
export default function AdminOrderDetail() {
    const { isLive } = useStore();
    return isLive ? <LiveOrderDetail /> : <DemoOrderDetail />;
}
function DemoOrderDetail() {
    const { id = '' } = useParams();
    const { orders, setOrderStatus } = useStore();
    const o = orders.find((x) => x.id === id);
    if (!o)
        return <Empty>Order not found. <Link to="/admin/orders" className="font-semibold text-burgundy underline">Back to orders</Link></Empty>;
    const step = FLOW.indexOf(o.status);
    const nextStatus = step >= 0 && step < FLOW.length - 1 ? FLOW[step + 1] : null;
    return (<>
      <p className="mb-2 text-sm"><Link to="/admin/orders" className="text-burgundy underline">← Orders</Link></p>
      <PageHeader title={o.id} subtitle={new Date(o.createdAt).toLocaleString('en-IN')} actions={<>
          {nextStatus && <button type="button" className="btn-primary" onClick={() => setOrderStatus(o.id, nextStatus)}>Mark as {nextStatus}</button>}
          {o.status !== 'cancelled' && o.status !== 'delivered' && (<button type="button" className="btn-ghost" onClick={() => { if (window.confirm('Cancel this order?'))
                setOrderStatus(o.id, 'cancelled'); }}>Cancel order</button>)}
        </>}/>

      <section className="card mb-4" aria-label="Order progress">
        {o.status === 'cancelled' ? <p className="text-sm"><Badge value="cancelled"/> This order was cancelled.</p> : (<ol className="flex items-center">
            {FLOW.map((s, i) => (<li key={s} className="flex flex-1 items-center last:flex-none">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i <= step ? 'bg-burgundy text-cream' : 'bg-neutral-200 text-neutral-500'}`} aria-current={i === step ? 'step' : undefined}>{i < step ? '✓' : i + 1}</span>
                <span className={`ml-2 hidden text-xs capitalize sm:inline ${i <= step ? 'font-semibold text-burgundy-700' : 'text-neutral-500'}`}>{s}</span>
                {i < FLOW.length - 1 && <span className={`mx-2 h-0.5 flex-1 ${i < step ? 'bg-burgundy' : 'bg-neutral-200'}`}/>}
              </li>))}
          </ol>)}
        <div className="mt-3 flex items-center gap-2 text-sm">
          <label htmlFor="ost" className="font-semibold text-burgundy-700">Status</label>
          <select id="ost" value={o.status} onChange={(e) => setOrderStatus(o.id, e.target.value)} className="rounded-lg border border-gold/40 bg-white px-2 py-1.5 capitalize">
            {ORDER_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <h2 className="text-xl font-bold">Items</h2>
          <ul className="mt-2 divide-y divide-gold/20 text-sm">
            {o.items.map((i, n) => (<li key={n} className="flex justify-between gap-3 py-2">
                <span>{i.name} × {i.qty}{i.note && <em className="block text-xs text-burgundy-700">Personalization: “{i.note}”</em>}</span>
                <span>{inr(i.unitPrice * i.qty)}</span>
              </li>))}
          </ul>
          <div className="mt-2 space-y-0.5 border-t border-gold/40 pt-2 text-sm">
            <p className="flex justify-between"><span>Subtotal</span><span>{inr(o.totals.subtotal)}</span></p>
            {o.totals.discount > 0 && <p className="flex justify-between text-green-700"><span>Discount ({o.totals.couponApplied})</span><span>− {inr(o.totals.discount)}</span></p>}
            {o.totals.wrap > 0 && <p className="flex justify-between"><span>Gift wrapping</span><span>{inr(o.totals.wrap)}</span></p>}
            <p className="flex justify-between"><span>Shipping</span><span>{o.totals.shipping ? inr(o.totals.shipping) : 'Free'}</span></p>
            <p className="flex justify-between text-base font-bold text-burgundy-700"><span>Total</span><span>{inr(o.totals.total)}</span></p>
          </div>
        </section>

        <div className="space-y-4">
          <section className="card text-sm">
            <h2 className="text-xl font-bold">Customer</h2>
            <p className="mt-1 font-semibold">{o.address.name}</p>
            <p>Account: {o.phone}</p>
            <p>Delivery contact: {o.address.phone}</p>
            {o.address.email && <p>{o.address.email}</p>}
          </section>
          <section className="card text-sm">
            <h2 className="text-xl font-bold">Ship to</h2>
            <p className="mt-1">{o.address.line}<br />{o.address.city}, {o.address.state} – {o.address.pincode}</p>
          </section>
          <section className="card text-sm">
            <h2 className="text-xl font-bold">Payment</h2>
            <p className="mt-1">Online (demo) — nothing was charged</p>
          </section>
        </div>
      </div>
    </>);
}
