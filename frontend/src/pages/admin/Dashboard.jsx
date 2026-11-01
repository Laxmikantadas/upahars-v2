import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { inr } from '../../data/demo';
import { ORDER_STATUSES, useStore } from '../../lib/store';
import { Badge, Empty, fmtDate, PageHeader } from './ui';
export default function Dashboard() {
    const { orders, inquiries, products } = useStore();
    const live = orders.filter((o) => o.status !== 'cancelled');
    const revenue = live.reduce((t, o) => t + o.totals.total, 0);
    const customers = new Set(orders.map((o) => o.phone)).size;
    const days = useMemo(() => {
        const out = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setHours(0, 0, 0, 0);
            d.setDate(d.getDate() - i);
            const next = new Date(d);
            next.setDate(d.getDate() + 1);
            const inDay = live.filter((o) => { const t = new Date(o.createdAt).getTime(); return t >= d.getTime() && t < next.getTime(); });
            out.push({ label: d.toLocaleDateString('en-IN', { weekday: 'short' }), total: inDay.reduce((s, o) => s + o.totals.total, 0), count: inDay.length });
        }
        return out;
    }, [live]);
    const max = Math.max(1, ...days.map((d) => d.total));
    const stats = [
        { label: 'Total orders', value: String(orders.length), to: '/admin/orders' },
        { label: 'New orders', value: String(orders.filter((o) => o.status === 'placed').length), to: '/admin/orders', hint: 'waiting to be confirmed' },
        { label: 'Revenue', value: inr(revenue), to: '/admin/orders', hint: 'excludes cancelled' },
        { label: 'Customers', value: String(customers), to: '/admin/customers' },
        { label: 'Open inquiries', value: String(inquiries.filter((q) => q.status === 'new').length), to: '/admin/inquiries' },
    ];
    const outOfStock = products.filter((p) => !p.inStock);
    return (<>
      <PageHeader title="Dashboard" subtitle="A quick look at how the store is doing"/>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {stats.map((s) => (<Link key={s.label} to={s.to} className="card transition hover:shadow-md">
            <p className="text-xs text-neutral-500">{s.label}</p>
            <p className="text-2xl font-bold text-burgundy-700">{s.value}</p>
            {s.hint && <p className="text-[11px] text-neutral-400">{s.hint}</p>}
          </Link>))}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2" aria-labelledby="rev7">
          <h2 id="rev7" className="text-xl font-bold">Revenue — last 7 days</h2>
          <div className="mt-4 flex h-44 items-end gap-2" role="img" aria-label="Bar chart of revenue for the last 7 days">
            {days.map((d, i) => (<div key={i} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${d.label}: ${inr(d.total)} (${d.count} orders)`}>
                <span className="text-[10px] text-neutral-500">{d.total ? inr(d.total) : ''}</span>
                <div className="w-full rounded-t-md bg-gradient-to-t from-burgundy to-gold" style={{ height: `${Math.max(d.total ? 6 : 2, (d.total / max) * 100)}%`, opacity: d.total ? 1 : 0.25 }}/>
                <span className="text-xs text-neutral-600">{d.label}</span>
              </div>))}
          </div>
        </section>

        <section className="card" aria-labelledby="bystatus">
          <h2 id="bystatus" className="text-xl font-bold">Orders by status</h2>
          <ul className="mt-3 space-y-2">
            {ORDER_STATUSES.map((s) => {
            const n = orders.filter((o) => o.status === s).length;
            return (<li key={s} className="flex items-center gap-2 text-sm">
                  <span className="w-24"><Badge value={s}/></span>
                  <span className="h-2 flex-1 overflow-hidden rounded bg-neutral-100"><span className="block h-full rounded bg-gold" style={{ width: `${orders.length ? (n / orders.length) * 100 : 0}%` }}/></span>
                  <span className="w-6 text-right font-semibold">{n}</span>
                </li>);
        })}
          </ul>
        </section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2" aria-labelledby="recent">
          <div className="flex items-center justify-between"><h2 id="recent" className="text-xl font-bold">Recent orders</h2><Link to="/admin/orders" className="text-sm font-semibold text-burgundy underline">View all</Link></div>
          {orders.length === 0 ? (<div className="mt-3"><Empty>No orders yet. <Link to="/admin/demo" className="font-semibold text-burgundy underline">Load sample data</Link> to see the dashboard in action.</Empty></div>) : (<ul className="mt-2 divide-y divide-gold/20 text-sm">
              {[...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5).map((o) => (<li key={o.id}>
                  <Link to={`/admin/orders/${o.id}`} className="flex items-center justify-between gap-3 py-2 hover:bg-gold/5">
                    <span><b className="font-mono">{o.id}</b><br /><span className="text-xs text-neutral-500">{o.address.name} · {fmtDate(o.createdAt)}</span></span>
                    <span className="flex items-center gap-3"><b>{inr(o.totals.total)}</b><Badge value={o.status}/></span>
                  </Link>
                </li>))}
            </ul>)}
        </section>

        <section className="card" aria-labelledby="stock">
          <h2 id="stock" className="text-xl font-bold">Stock alerts</h2>
          {outOfStock.length === 0 ? <p className="mt-2 text-sm text-neutral-600">All products are in stock ✓</p> : (<ul className="mt-2 space-y-1 text-sm">{outOfStock.map((p) => <li key={p.id} className="flex justify-between"><span>{p.emoji} {p.name}</span><span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">Out of stock</span></li>)}</ul>)}
          <Link to="/admin/products" className="mt-3 inline-block text-sm font-semibold text-burgundy underline">Manage products</Link>
        </section>
      </div>
    </>);
}
