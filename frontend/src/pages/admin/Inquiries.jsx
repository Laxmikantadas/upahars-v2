import { useState } from 'react';
import { useStore } from '../../lib/store';
import { Badge, Chips, Empty, fmtDate, PageHeader } from './ui';
const STATUSES = ['new', 'quoted', 'closed'];
export default function Inquiries() {
    const { inquiries, setInquiryStatus } = useStore();
    const [f, setF] = useState('all');
    const rows = inquiries.filter((q) => f === 'all' || q.status === f);
    return (<>
      <PageHeader title="Bulk inquiries" subtitle="Quotation requests from the bulk & corporate form"/>
      <div className="mb-3">
        <Chips value={f} onChange={setF} options={[{ v: 'all', label: 'All', count: inquiries.length }, ...STATUSES.map((s) => ({ v: s, label: s, count: inquiries.filter((q) => q.status === s).length }))]}/>
      </div>
      {rows.length === 0 ? <Empty>{inquiries.length ? 'No inquiries in this status.' : 'No bulk inquiries yet.'}</Empty> : (<div className="grid gap-3 md:grid-cols-2">
          {rows.map((q) => (<article key={q.id} className="card text-sm">
              <div className="flex items-start justify-between gap-2">
                <div><p className="font-semibold text-burgundy-700">{q.name}</p><p className="text-xs text-neutral-500">{q.id} · {fmtDate(q.createdAt)}</p></div>
                <Badge value={q.status}/>
              </div>
              <p className="mt-2"><b>{q.quantity}</b> × {q.product}</p>
              {q.message && <p className="mt-1 text-neutral-600">{q.message}</p>}
              <p className="mt-2 text-xs">📞 <a className="underline" href={`tel:${q.phone}`}>{q.phone}</a>{q.email && <> · ✉️ <a className="underline" href={`mailto:${q.email}`}>{q.email}</a></>}</p>
              <div className="mt-3 flex items-center gap-2">
                <label htmlFor={`iq-${q.id}`} className="text-xs font-semibold text-burgundy-700">Status</label>
                <select id={`iq-${q.id}`} value={q.status} onChange={(e) => setInquiryStatus(q.id, e.target.value)} className="rounded-lg border border-gold/40 bg-white px-2 py-1 text-xs capitalize">
                  {STATUSES.map((s) => <option key={s}>{s}</option>)}
                </select>
              </div>
            </article>))}
        </div>)}
    </>);
}
