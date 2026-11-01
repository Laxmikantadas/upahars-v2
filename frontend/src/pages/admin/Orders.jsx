import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { inr } from '../../data/demo';
import { ORDER_STATUSES, useStore } from '../../lib/store';
import { Badge, Chips, Empty, fmtDate, PageHeader } from './ui';
import { LiveOrders } from './LiveOrders';
const csvCell = (v) => `"${String(v).replace(/"/g, '""')}"`;
function exportCsv(rows) {
    const head = ['Order ID', 'Date', 'Customer', 'Phone', 'City', 'Items', 'Subtotal', 'Discount', 'Shipping', 'Total', 'Payment', 'Status'];
    const body = rows.map((o) => [
        o.id, o.createdAt, o.address.name, o.address.phone, o.address.city,
        o.items.map((i) => `${i.name} x${i.qty}${i.note ? ` [${i.note}]` : ''}`).join('; '),
        o.totals.subtotal, o.totals.discount, o.totals.shipping, o.totals.total, o.payment, o.status,
    ]);
    const csv = [head, ...body].map((r) => r.map(csvCell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `upahars-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}
export default function Orders() {
    const { isLive } = useStore();
    return isLive ? <LiveOrders /> : <DemoOrders />;
}
function DemoOrders() {
    const { orders, setOrderStatus } = useStore();
    const [status, setStatus] = useState('all');
    const [q, setQ] = useState('');
    const rows = useMemo(() => {
        const t = q.trim().toLowerCase();
        return [...orders]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .filter((o) => (status === 'all' || o.status === status)
            && (!t || `${o.id} ${o.address.name} ${o.address.phone} ${o.phone} ${o.address.city}`.toLowerCase().includes(t)));
    }, [orders, status, q]);
    return (<>
      <PageHeader title="Orders" subtitle={`${orders.length} total`} actions={<button type="button" className="btn-ghost" disabled={!rows.length} onClick={() => exportCsv(rows)}>Export CSV</button>}/>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <Chips value={status} onChange={setStatus} options={[{ v: 'all', label: 'All', count: orders.length }, ...ORDER_STATUSES.map((s) => ({ v: s, label: s, count: orders.filter((o) => o.status === s).length }))]}/>
        <div className="w-full sm:w-64">
          <label htmlFor="oq" className="sr-only">Search orders</label>
          <input id="oq" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ID, name, phone, city" className="input"/>
        </div>
      </div>

      {rows.length === 0 ? <Empty>{orders.length ? 'No orders match your filters.' : <>No orders yet. <Link to="/admin/demo" className="font-semibold text-burgundy underline">Load sample data</Link>.</>}</Empty> : (<div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-cream-200/60 text-xs text-neutral-500">
              <tr><th className="px-4 py-2">Order</th><th>Date</th><th>Customer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map((o) => (<tr key={o.id} className="border-t border-gold/20 hover:bg-gold/5">
                  <td className="px-4 py-2.5"><Link to={`/admin/orders/${o.id}`} className="font-mono font-semibold text-burgundy underline">{o.id}</Link></td>
                  <td className="whitespace-nowrap">{fmtDate(o.createdAt)}</td>
                  <td>{o.address.name}<br /><span className="text-xs text-neutral-500">{o.address.city}</span></td>
                  <td>{o.items.reduce((s, i) => s + i.qty, 0)}</td>
                  <td className="font-semibold">{inr(o.totals.total)}</td>
                  <td className="text-xs">Online (demo)</td>
                  <td>
                    <label className="sr-only" htmlFor={`st-${o.id}`}>Status of {o.id}</label>
                    <select id={`st-${o.id}`} value={o.status} onChange={(e) => setOrderStatus(o.id, e.target.value)} className="rounded-lg border border-gold/40 bg-white px-2 py-1 text-xs capitalize">
                      {ORDER_STATUSES.map((s) => <option key={s}>{s}</option>)}
                    </select>
                    <span className="ml-2 hidden lg:inline"><Badge value={o.status}/></span>
                  </td>
                </tr>))}
            </tbody>
          </table>
        </div>)}
    </>);
}
