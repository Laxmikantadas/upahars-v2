import { COUPONS } from '../../lib/pricing';
import { useStore } from '../../lib/store';
import { PageHeader } from './ui';
export default function DemoData() {
    const { seedDemo, resetAll, orders, inquiries } = useStore();
    return (<>
      <PageHeader title="Demo data" subtitle="Tools for testing the MVP"/>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card space-y-3 text-sm">
          <h2 className="text-xl font-bold">Sample data</h2>
          <p>Adds 5 sample orders (one per status) and 2 bulk inquiries. Running it again replaces the earlier samples instead of duplicating them.</p>
          <p className="text-neutral-600">Currently stored: {orders.length} orders, {inquiries.length} inquiries.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={seedDemo}>Load sample orders &amp; inquiries</button>
            <button type="button" className="btn-ghost" onClick={() => { if (window.confirm('Delete ALL local data (cart, orders, inquiries, customers, price edits)? You will be signed out.'))
        resetAll(); }}>Reset everything</button>
          </div>
        </section>

        <section className="card space-y-2 text-sm lg:col-span-2">
          <h2 className="text-xl font-bold">Test coupons</h2>
          <ul className="divide-y divide-gold/20">
            {COUPONS.map((c) => <li key={c.code} className="flex justify-between gap-3 py-1.5"><b className="font-mono">{c.code}</b><span className="text-neutral-600">{c.label}</span></li>)}
          </ul>
        </section>
      </div>
    </>);
}
