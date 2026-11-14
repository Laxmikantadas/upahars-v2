import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { paiseToInr } from '../../lib/orders';
import { Chips, Empty, fmtDate, PageHeader } from './ui';

const errText = (e) => (e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
const PAGE = 20;
const SORTS = [
  ['newest', 'Newest first'], ['oldest', 'Oldest first'], ['most_returns', 'Most returns'],
  ['most_orders', 'Most orders'], ['top_spenders', 'Top spenders'], ['last_login', 'Last login'],
];
const RETURN_FILTERS = [
  { v: 'all', label: 'All' }, { v: 'any', label: 'Has returns' }, { v: '3plus', label: '3+ returns' }, { v: 'none', label: 'No returns' },
];
const STATUS_FILTERS = [{ v: 'all', label: 'All' }, { v: 'active', label: 'Active' }, { v: 'suspended', label: 'Suspended' }];
const roleOf = (u) => (u.roles.includes('admin') ? 'admin' : u.roles.includes('seller') ? 'seller' : 'customer');
const fmtDT = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

function Stat({ label, value, tone }) {
  return (<div className="card py-3"><p className="text-xs text-neutral-500">{label}</p><p className={`text-2xl font-bold ${tone ?? ''}`}>{value}</p></div>);
}

function SuspendDialog({ user, onClose, onDone }) {
  const suspending = !user.isSuspended;
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setBusy(true); setErr('');
    try { await api(`/admin/users/${user.id}/suspend`, { body: { suspended: suspending, reason: reason.trim() } }); onDone(); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-labelledby="sd-h">
    <div className="card w-full max-w-md space-y-3">
      <h2 id="sd-h" className="text-xl font-bold">{suspending ? 'Suspend' : 'Reinstate'} {user.name || user.phone}?</h2>
      <p className="text-sm text-neutral-700">{suspending ? 'They will be signed out immediately and cannot log in until reinstated.' : 'They will be able to sign in and order again.'}</p>
      <div>
        <label htmlFor="sd-r" className="text-xs font-semibold text-neutral-600">Reason (kept in the audit log)</label>
        <textarea id="sd-r" className="input mt-1" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Too many returns / suspected misuse"/>
      </div>
      {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{err}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded-lg border border-gold/40 px-3 py-1.5 text-sm" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" disabled={busy || reason.trim().length < 3} onClick={submit} className={`rounded-lg px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50 ${suspending ? 'bg-red-700' : 'bg-green-700'}`}>
          {busy ? 'Saving…' : suspending ? 'Suspend user' : 'Reinstate user'}
        </button>
      </div>
    </div>
  </div>);
}

function UserDetail({ id, onClose, onChanged }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [dlg, setDlg] = useState(false);
  const load = useCallback(() => api(`/admin/users/${id}`).then(setD).catch((e) => setErr(errText(e))), [id]);
  useEffect(() => { void load(); }, [load]);
  const u = d?.user;
  const isAdmin = u?.roles.includes('admin');
  return (<div className="fixed inset-0 z-40 flex justify-end bg-black/40" role="dialog" aria-modal="true" aria-label="User details">
    <div className="h-full w-full max-w-xl overflow-y-auto bg-cream p-5 shadow-xl">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className="text-2xl font-bold">User details</h2>
        <button type="button" onClick={onClose} className="rounded-lg border border-gold/40 px-3 py-1 text-sm">Close</button>
      </div>
      {err && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>}
      {!d && !err && <p className="text-sm text-neutral-600">Loading…</p>}
      {u && (<div className="space-y-4">
        <section className="card space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-semibold">{u.name || 'No name'}</p>
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold capitalize">{roleOf(u)}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${u.isSuspended ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>{u.isSuspended ? 'Suspended' : 'Active'}</span>
          </div>
          <p className="font-mono text-sm">{u.phone}</p>
          {u.email && <p className="text-sm text-neutral-700">{u.email}</p>}
          <p className="text-xs text-neutral-500">Joined {fmtDate(u.createdAt)} · Last login {fmtDT(u.lastLoginAt)}</p>
        </section>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Orders" value={u.stats.orders}/>
          <Stat label="Returns (orders)" value={u.stats.returns} tone={u.stats.returns >= 3 ? 'text-red-700' : ''}/>
          <Stat label="Items returned" value={u.stats.returnedItems}/>
          <Stat label="Cancelled" value={u.stats.cancelled}/>
          <Stat label="Net spent" value={paiseToInr(u.stats.spentPaise)}/>
          <Stat label="Refunded" value={paiseToInr(u.stats.refundedPaise)}/>
        </div>
        {!isAdmin && (<button type="button" onClick={() => setDlg(true)} className={`w-full rounded-lg px-4 py-2 text-sm font-semibold text-white ${u.isSuspended ? 'bg-green-700' : 'bg-red-700'}`}>
          {u.isSuspended ? 'Reinstate this user' : 'Suspend this user'}
        </button>)}
        <section className="card p-0">
          <h3 className="px-4 pt-3 font-semibold">Recent orders</h3>
          {d.orders.length === 0 ? <p className="px-4 py-3 text-sm text-neutral-600">No orders yet.</p> : (<div className="overflow-x-auto"><table className="w-full min-w-[460px] text-left text-sm">
            <thead className="text-xs text-neutral-500"><tr><th className="px-4 py-2">Order</th><th>Date</th><th>Total</th><th>Returned</th></tr></thead>
            <tbody>{d.orders.map((o) => (<tr key={o.orderNumber} className="border-t border-gold/20">
              <td className="px-4 py-2"><Link className="font-mono text-xs text-burgundy-700 underline" to={`/admin/orders/${o.orderNumber}`}>{o.orderNumber}</Link>{o.status === 'cancelled' && <span className="ml-1 text-[11px] text-red-700">cancelled</span>}</td>
              <td className="text-xs">{fmtDate(o.createdAt)}</td>
              <td>{paiseToInr(o.totalPaise)}</td>
              <td className={o.returns ? 'font-semibold text-red-700' : 'text-neutral-400'}>{o.returns ? `${o.returnedItems} item(s) · ${paiseToInr(o.refundedPaise)}` : '—'}</td>
            </tr>))}</tbody></table></div>)}
        </section>
        {d.suspensionHistory.length > 0 && (<section className="card">
          <h3 className="mb-2 font-semibold">Suspension history</h3>
          <ul className="space-y-2 text-sm">{d.suspensionHistory.map((h, i) => (<li key={i}><span className="font-semibold">{h.action === 'user.suspend' ? 'Suspended' : 'Reinstated'}</span> · <span className="text-xs text-neutral-500">{fmtDT(h.at)}</span><br/><span className="text-neutral-700">{h.reason}</span></li>))}</ul>
        </section>)}
      </div>)}
    </div>
    {dlg && u && <SuspendDialog user={u} onClose={() => setDlg(false)} onDone={() => { setDlg(false); void load(); onChanged(); }}/>}
  </div>);
}

export default function Users() {
  const [f, setF] = useState({ q: '', status: 'all', role: 'all', returns: 'all', sort: 'newest' });
  const [qInput, setQInput] = useState('');
  const [pg, setPg] = useState(1);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { const t = setTimeout(() => { setF((x) => ({ ...x, q: qInput.trim() })); setPg(1); }, 300); return () => clearTimeout(t); }, [qInput]);
  useEffect(() => {
    let live = true;
    const qs = new URLSearchParams({ ...f, page: String(pg), limit: String(PAGE) });
    if (!f.q) qs.delete('q');
    api(`/admin/users?${qs}`).then((r) => { if (live) { setData(r); setErr(''); } }).catch((e) => live && setErr(errText(e)));
    return () => { live = false; };
  }, [f, pg, tick]);
  const set = (k) => (v) => { setF((x) => ({ ...x, [k]: v })); setPg(1); };
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;
  const s = data?.summary;
  return (<>
    <PageHeader title="Users" subtitle="Every account, with how many orders they returned. Open a user to suspend or reinstate them."
      actions={<div className="w-56"><label htmlFor="uq" className="sr-only">Search users</label><input id="uq" value={qInput} onChange={(e) => setQInput(e.target.value)} placeholder="Name, phone or email" className="input"/></div>}/>
    {s && (<div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label="Total users" value={s.total}/><Stat label="Suspended" value={s.suspended} tone={s.suspended ? 'text-red-700' : ''}/>
      <Stat label="Users with returns" value={s.withReturns}/><Stat label="Total returns" value={s.totalReturns}/>
    </div>)}
    <div className="card mb-4 space-y-3">
      <div><p className="mb-1 text-xs font-semibold text-neutral-500">Account status</p><Chips value={f.status} onChange={set('status')} options={STATUS_FILTERS}/></div>
      <div><p className="mb-1 text-xs font-semibold text-neutral-500">Returns</p><Chips value={f.returns} onChange={set('returns')} options={RETURN_FILTERS}/></div>
      <div className="flex flex-wrap gap-3">
        <div><label htmlFor="ur" className="block text-xs font-semibold text-neutral-500">Role</label>
          <select id="ur" className="input" value={f.role} onChange={(e) => set('role')(e.target.value)}><option value="all">All roles</option><option value="customer">Customers</option><option value="seller">Sellers</option><option value="admin">Admins</option></select></div>
        <div><label htmlFor="us" className="block text-xs font-semibold text-neutral-500">Sort by</label>
          <select id="us" className="input" value={f.sort} onChange={(e) => set('sort')(e.target.value)}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <button type="button" className="self-end rounded-lg border border-gold/40 px-3 py-2 text-xs font-semibold" onClick={() => { setQInput(''); setF({ q: '', status: 'all', role: 'all', returns: 'all', sort: 'newest' }); setPg(1); }}>Reset filters</button>
      </div>
    </div>
    {err && <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>}
    {!data && !err ? <Empty>Loading users…</Empty> : data && data.users.length === 0 ? <Empty>No users match these filters.</Empty> : data && (<>
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-cream-200/60 text-xs text-neutral-500"><tr><th className="px-4 py-2">User</th><th>Phone</th><th>Role</th><th>Orders</th><th>Returns</th><th>Net spent</th><th>Status</th><th/></tr></thead>
          <tbody>{data.users.map((u) => (<tr key={u.id} className="border-t border-gold/20">
            <td className="px-4 py-2.5 font-medium">{u.name || <span className="text-neutral-400">No name</span>}</td>
            <td className="font-mono text-xs">{u.phone}</td>
            <td className="text-xs capitalize">{roleOf(u)}</td>
            <td>{u.stats.orders}</td>
            <td className={u.stats.returns >= 3 ? 'font-bold text-red-700' : u.stats.returns ? 'font-semibold text-amber-700' : 'text-neutral-400'}>{u.stats.returns}{u.stats.returnedItems > 0 && <span className="ml-1 text-[11px] font-normal text-neutral-500">({u.stats.returnedItems} items)</span>}</td>
            <td>{paiseToInr(u.stats.spentPaise)}</td>
            <td><span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${u.isSuspended ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>{u.isSuspended ? 'Suspended' : 'Active'}</span></td>
            <td className="pr-4 text-right"><button type="button" className="text-xs font-semibold text-burgundy-700 underline" onClick={() => setOpen(u.id)}>View</button></td>
          </tr>))}</tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-between text-sm">
        <span className="text-neutral-600">{data.total} user{data.total === 1 ? '' : 's'} · page {pg} of {pages}</span>
        <div className="flex gap-2">
          <button type="button" disabled={pg <= 1} onClick={() => setPg((p) => p - 1)} className="rounded-lg border border-gold/40 px-3 py-1 disabled:opacity-40">Previous</button>
          <button type="button" disabled={pg >= pages} onClick={() => setPg((p) => p + 1)} className="rounded-lg border border-gold/40 px-3 py-1 disabled:opacity-40">Next</button>
        </div>
      </div>
    </>)}
    {open && <UserDetail id={open} onClose={() => setOpen(null)} onChanged={() => setTick((t) => t + 1)}/>}
  </>);
}