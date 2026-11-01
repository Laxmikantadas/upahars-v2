import { useMemo, useState } from 'react';
import { inr } from '../../data/demo';
import { useStore } from '../../lib/store';
import { Empty, fmtDate, PageHeader } from './ui';
export default function Customers() {
    const { orders } = useStore();
    const [q, setQ] = useState('');
    const rows = useMemo(() => {
        const map = new Map();
        orders.forEach((o) => {
            const c = map.get(o.phone) ?? { phone: o.phone, name: o.address.name, verified: false, orders: 0, spent: 0 };
            c.orders += 1;
            if (o.status !== 'cancelled')
                c.spent += o.totals.total;
            if (!c.last || o.createdAt > c.last)
                c.last = o.createdAt;
            map.set(o.phone, c);
        });
        const t = q.trim().toLowerCase();
        return [...map.values()].filter((c) => !t || `${c.name} ${c.phone}`.toLowerCase().includes(t)).sort((a, b) => b.spent - a.spent);
    }, [orders, q]);
    return (<>
      <PageHeader title="Customers" subtitle="Seen in orders (the real customer list comes with the orders phase)" actions={<div className="w-56"><label htmlFor="cq" className="sr-only">Search customers</label><input id="cq" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone" className="input"/></div>}/>
      {rows.length === 0 ? <Empty>No customers yet.</Empty> : (<div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead className="bg-cream-200/60 text-xs text-neutral-500"><tr><th className="px-4 py-2">Customer</th><th>Phone</th><th>Orders</th><th>Total spent</th><th>Last order</th></tr></thead>
            <tbody>
              {rows.map((c) => (<tr key={c.phone} className="border-t border-gold/20">
                  <td className="px-4 py-2.5 font-medium">{c.name}{c.verified && <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold text-green-800">verified</span>}</td>
                  <td className="font-mono text-xs">{c.phone}</td>
                  <td>{c.orders}</td>
                  <td className="font-semibold">{inr(c.spent)}</td>
                  <td className="text-xs text-neutral-600">{c.last ? fmtDate(c.last) : '—'}</td>
                </tr>))}
            </tbody>
          </table>
        </div>)}
    </>);
}
