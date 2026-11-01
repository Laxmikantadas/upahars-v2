import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { paiseToInr } from '../../lib/orders';
import { useStore } from '../../lib/store';
import { uploadImage } from './upload';
import { Chips, Empty, PageHeader } from './ui';
import { notify } from '../../lib/notify';
const errText = (e) => { const m = e instanceof ApiError ? e.message : 'Something went wrong. Please try again.'; notify.error(m); return m; };
const IST = 'Asia/Kolkata';
const dateIn = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA', { timeZone: IST }) : '');
const startIso = (d) => (d ? new Date(`${d}T00:00:00+05:30`).toISOString() : null);
const endIso = (d) => (d ? new Date(`${d}T23:59:59+05:30`).toISOString() : null);
const showDate = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: IST }) : '');
const toPaise = (v) => Math.round(Number(v) * 100);
function describe(c) { return c.type === 'percent' ? `${c.value}% off` : `${paiseToInr(c.value)} off`; }
function validity(c) {
    const now = Date.now();
    if (!c.isActive)
        return 'Switched off';
    if (c.startsAt && new Date(c.startsAt).getTime() > now)
        return `Starts ${showDate(c.startsAt)}`;
    if (c.endsAt && new Date(c.endsAt).getTime() < now)
        return 'Expired';
    if (c.usageLimit != null && c.usedCount >= c.usageLimit)
        return 'Fully used';
    return c.endsAt ? `Until ${showDate(c.endsAt)}` : 'Active';
}
const blankC = { code: '', title: '', description: '', type: 'percent', value: '10', min: '0', max: '', starts: '', ends: '', usage: '', perUser: '1', isPublic: true, isActive: true };
const fromCoupon = (c) => ({
    code: c.code, title: c.title ?? '', description: c.description ?? '', type: c.type, value: String(c.type === 'percent' ? c.value : c.value / 100), min: String(c.minOrderPaise / 100),
    max: c.maxDiscountPaise == null ? '' : String(c.maxDiscountPaise / 100), starts: dateIn(c.startsAt), ends: dateIn(c.endsAt), usage: c.usageLimit == null ? '' : String(c.usageLimit),
    perUser: String(c.perUserLimit), isPublic: Boolean(c.isPublic), isActive: c.isActive,
});
function CouponEditor({ coupon, onClose, onSaved }) {
    const [f, setF] = useState(coupon ? fromCoupon(coupon) : blankC);
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
    const submit = async (e) => {
        e.preventDefault();
        const value = f.type === 'percent' ? Math.round(Number(f.value)) : toPaise(f.value);
        if (!coupon && !/^[A-Za-z0-9_-]{3,24}$/.test(f.code.trim()))
            return setErr('Code must be 3–24 letters, numbers, - or _.');
        if (!(value >= 1))
            return setErr('Enter the discount amount.');
        if (f.type === 'percent' && value > 90)
            return setErr('A percentage discount cannot be more than 90%.');
        if (f.starts && f.ends && f.ends < f.starts)
            return setErr('The end date must be on or after the start date.');
        const body = {
            ...(coupon ? {} : { code: f.code.trim().toUpperCase() }), title: f.title.trim(), description: f.description.trim(), type: f.type, value,
            minOrderPaise: Math.max(0, toPaise(f.min || '0')), maxDiscountPaise: f.type === 'percent' && f.max.trim() ? toPaise(f.max) : null,
            startsAt: startIso(f.starts), endsAt: endIso(f.ends), usageLimit: f.usage.trim() ? Math.max(1, Math.floor(Number(f.usage))) : null,
            perUserLimit: Math.min(100, Math.max(1, Math.floor(Number(f.perUser) || 1))), isPublic: f.isPublic, isActive: f.isActive,
        };
        setBusy(true);
        setErr('');
        try {
            await api(coupon ? `/admin/coupons/${coupon._id}` : '/admin/coupons', { method: coupon ? 'PATCH' : 'POST', body });
            onSaved();
        }
        catch (e2) {
            setErr(errText(e2));
        }
        finally {
            setBusy(false);
        }
    };
    return (<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={coupon ? 'Edit offer' : 'New offer'}>
      <form onSubmit={submit} className="w-full max-w-2xl space-y-4 rounded-2xl bg-cream-100 p-4 shadow-2xl sm:p-6">
        <div className="flex items-center justify-between"><h2 className="text-2xl font-bold">{coupon ? `Edit ${coupon.code}` : 'New offer'}</h2>
          <button type="button" onClick={onClose} className="rounded-lg border border-gold/40 px-3 py-1 text-sm" aria-label="Close">✕</button></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label htmlFor="c-code" className="label">Coupon code *</label>
            <input id="c-code" className="input font-mono uppercase" value={f.code} disabled={Boolean(coupon)} maxLength={24} onChange={(e) => set('code', e.target.value)} placeholder="e.g. DIWALI15"/>
            {coupon && <p className="mt-1 text-xs text-neutral-500">The code cannot be changed. Create a new offer to use a different code.</p>}</div>
          <div><label htmlFor="c-title" className="label">Headline on the shop</label><input id="c-title" className="input" maxLength={80} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Diwali sale"/></div>
        </div>
        <div><label htmlFor="c-desc" className="label">Short description</label><input id="c-desc" className="input" maxLength={200} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="e.g. On orders above ₹999"/></div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div><label htmlFor="c-type" className="label">Discount type</label>
            <select id="c-type" className="input" value={f.type} onChange={(e) => set('type', e.target.value)}><option value="percent">Percentage (%)</option><option value="fixed">Fixed amount (₹)</option></select></div>
          <div><label htmlFor="c-val" className="label">{f.type === 'percent' ? 'Percent off *' : 'Amount off ₹ *'}</label><input id="c-val" type="number" min={1} step={f.type === 'percent' ? 1 : 0.01} className="input" value={f.value} onChange={(e) => set('value', e.target.value)}/></div>
          <div><label htmlFor="c-min" className="label">Minimum order ₹</label><input id="c-min" type="number" min={0} className="input" value={f.min} onChange={(e) => set('min', e.target.value)}/></div>
        </div>
        {f.type === 'percent' && <div className="max-w-xs"><label htmlFor="c-max" className="label">Maximum discount ₹ (optional)</label><input id="c-max" type="number" min={1} className="input" value={f.max} onChange={(e) => set('max', e.target.value)} placeholder="no cap"/></div>}
        <div className="grid gap-3 sm:grid-cols-4">
          <div><label htmlFor="c-start" className="label">Starts</label><input id="c-start" type="date" className="input" value={f.starts} onChange={(e) => set('starts', e.target.value)}/></div>
          <div><label htmlFor="c-end" className="label">Ends</label><input id="c-end" type="date" className="input" value={f.ends} onChange={(e) => set('ends', e.target.value)}/></div>
          <div><label htmlFor="c-use" className="label">Total uses</label><input id="c-use" type="number" min={1} className="input" value={f.usage} onChange={(e) => set('usage', e.target.value)} placeholder="unlimited"/></div>
          <div><label htmlFor="c-per" className="label">Uses per customer</label><input id="c-per" type="number" min={1} max={100} className="input" value={f.perUser} onChange={(e) => set('perUser', e.target.value)}/></div>
        </div>
        <div className="flex flex-wrap gap-5 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.isPublic} onChange={(e) => set('isPublic', e.target.checked)}/>Show on the shop (home page and cart)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.isActive} onChange={(e) => set('isActive', e.target.checked)}/>Active</label>
        </div>
        {err && <p role="alert" className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="btn-ghost">Cancel</button><button type="submit" disabled={busy} className="btn-primary disabled:opacity-60">{busy ? 'Saving…' : 'Save offer'}</button></div>
      </form>
    </div>);
}
function Coupons({ onChange }) {
    const [rows, setRows] = useState(null);
    const [msg, setMsg] = useState('');
    const [editor, setEditor] = useState(null);
    const load = useCallback(() => api('/admin/coupons').then((r) => setRows(r.coupons)).catch((e) => { setMsg(errText(e)); setRows([]); }), []);
    useEffect(() => { void load(); }, [load]);
    const patch = async (c, body, note) => {
        try {
            await api(`/admin/coupons/${c._id}`, { method: 'PATCH', body });
            setMsg(note); notify.success(note);
            await load();
            onChange(note);
        }
        catch (e) {
            setMsg(errText(e));
        }
    };
    const remove = async (c) => {
        if (!window.confirm(`Delete the offer ${c.code}? Customers will no longer be able to use it. Past orders are not affected.`))
            return;
        try {
            await api(`/admin/coupons/${c._id}`, { method: 'DELETE' });
            setMsg(`${c.code} deleted.`); notify.remove(`${c.code} deleted.`);
            await load();
            onChange('deleted');
        }
        catch (e) {
            setMsg(errText(e));
        }
    };
    return (<>
      <div className="mb-3 flex items-center justify-between gap-3"><p className="text-sm text-neutral-600">Coupon codes customers enter at checkout.</p>
        <button type="button" className="btn-primary" onClick={() => setEditor({ coupon: null })}>+ New offer</button></div>
      {msg && <p role="status" className="mb-3 rounded-lg bg-white px-3 py-2 text-sm text-burgundy-700 ring-1 ring-gold/40">{msg}</p>}
      {rows === null ? <Empty>Loading offers…</Empty> : rows.length === 0 ? <Empty>No offers yet. Create your first one.</Empty> : (<div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="bg-cream-200/60 text-xs text-neutral-500"><tr><th className="px-4 py-2">Code</th><th>Offer</th><th>Min order</th><th>Status</th><th>Used</th><th>On shop</th><th className="pr-4 text-right">Actions</th></tr></thead>
            <tbody>
              {rows.map((c) => (<tr key={c._id} className="border-t border-gold/20">
                  <td className="px-4 py-2"><b className="font-mono">{c.code}</b>{c.title && <span className="block text-xs text-neutral-500">{c.title}</span>}</td>
                  <td>{describe(c)}{c.maxDiscountPaise ? <span className="block text-xs text-neutral-500">max {paiseToInr(c.maxDiscountPaise)}</span> : null}</td>
                  <td>{c.minOrderPaise ? paiseToInr(c.minOrderPaise) : '—'}</td>
                  <td className="text-xs">{validity(c)}</td>
                  <td className="text-xs">{c.usedCount}{c.usageLimit != null ? ` / ${c.usageLimit}` : ''}</td>
                  <td><input type="checkbox" aria-label={`Show ${c.code} on the shop`} checked={Boolean(c.isPublic)} onChange={(e) => void patch(c, { isPublic: e.target.checked }, `${c.code} ${e.target.checked ? 'is now shown on' : 'is hidden from'} the shop.`)} className="h-4 w-4"/></td>
                  <td className="space-x-1 whitespace-nowrap pr-4 text-right">
                    <button type="button" className="btn-ghost !px-3 !py-1 text-xs" onClick={() => void patch(c, { isActive: !c.isActive }, `${c.code} ${c.isActive ? 'switched off' : 'switched on'}.`)}>{c.isActive ? 'Switch off' : 'Switch on'}</button>
                    <button type="button" className="btn-ghost !px-3 !py-1 text-xs" onClick={() => setEditor({ coupon: c })}>Edit</button>
                    <button type="button" className="rounded-lg border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50" onClick={() => void remove(c)}>Delete</button>
                  </td>
                </tr>))}
            </tbody>
          </table>
        </div>)}
      {editor && <CouponEditor coupon={editor.coupon} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setMsg('Offer saved.'); notify.success('Offer saved.'); void load(); onChange('saved'); }}/>}
    </>);
}
function BannerEditor({ banner, onClose, onSaved }) {
    const [f, setF] = useState(banner ? { title: banner.title, subtitle: banner.subtitle, link: banner.link, placement: banner.placement, sortOrder: String(banner.sortOrder), isActive: banner.isActive, image: banner.image?.url ?? '' } : { title: '', subtitle: '', link: '/categories', placement: 'home_hero', sortOrder: '0', isActive: true, image: '' });
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    const [up, setUp] = useState(false);
    const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
    const submit = async (e) => {
        e.preventDefault();
        if (f.title.trim().length < 2)
            return setErr('Enter a headline.');
        if (!/^\/[^/]/.test(f.link))
            return setErr('Use an on-site link that starts with “/”, for example /categories?name=Customized%20Gifts');
        setBusy(true);
        setErr('');
        const body = { title: f.title.trim(), subtitle: f.subtitle.trim(), link: f.link.trim(), placement: f.placement, sortOrder: Math.floor(Number(f.sortOrder) || 0), isActive: f.isActive, image: f.image ? { url: f.image } : null };
        try {
            await api(banner ? `/admin/banners/${banner._id}` : '/admin/banners', { method: banner ? 'PATCH' : 'POST', body });
            onSaved();
        }
        catch (e2) {
            setErr(errText(e2));
        }
        finally {
            setBusy(false);
        }
    };
    return (<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label="Banner">
      <form onSubmit={submit} className="w-full max-w-xl space-y-4 rounded-2xl bg-cream-100 p-4 shadow-2xl sm:p-6">
        <div className="flex items-center justify-between"><h2 className="text-2xl font-bold">{banner ? 'Edit banner' : 'New banner'}</h2><button type="button" onClick={onClose} className="rounded-lg border border-gold/40 px-3 py-1 text-sm" aria-label="Close">✕</button></div>
        <div><label htmlFor="b-title" className="label">Headline *</label><input id="b-title" className="input" maxLength={100} value={f.title} onChange={(e) => set('title', e.target.value)}/></div>
        <div><label htmlFor="b-sub" className="label">Sub-text</label><input id="b-sub" className="input" maxLength={200} value={f.subtitle} onChange={(e) => set('subtitle', e.target.value)}/></div>
        <div><label htmlFor="b-link" className="label">Button link (on this site)</label><input id="b-link" className="input" maxLength={200} value={f.link} onChange={(e) => set('link', e.target.value)}/></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label htmlFor="b-place" className="label">Where</label><select id="b-place" className="input" value={f.placement} onChange={(e) => set('placement', e.target.value)}><option value="home_hero">Home page — big slider</option><option value="home_strip">Home page — strip</option></select></div>
          <div><label htmlFor="b-sort" className="label">Order (small first)</label><input id="b-sort" type="number" className="input" value={f.sortOrder} onChange={(e) => set('sortOrder', e.target.value)}/></div>
        </div>
        <div><p className="label">Image</p>
          <div className="flex items-center gap-3">
            {f.image && <img src={f.image} alt="Banner preview" className="h-16 w-28 rounded-lg object-cover"/>}
            <label className="btn-ghost cursor-pointer">{up ? 'Uploading…' : f.image ? 'Replace' : 'Upload image'}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={up} onChange={async (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file)
        return; setUp(true); setErr(''); try {
        set('image', await uploadImage(file, 'site'));
    }
    catch (x) {
        setErr(errText(x));
    }
    finally {
        setUp(false);
    } }}/></label>
            {f.image && <button type="button" className="text-xs underline" onClick={() => set('image', '')}>Remove</button>}
          </div></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.isActive} onChange={(e) => set('isActive', e.target.checked)}/>Show on the shop</label>
        {err && <p role="alert" className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800">{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="btn-ghost">Cancel</button><button type="submit" disabled={busy || up} className="btn-primary disabled:opacity-60">{busy ? 'Saving…' : 'Save banner'}</button></div>
      </form>
    </div>);
}
function Banners({ onChange }) {
    const [rows, setRows] = useState(null);
    const [msg, setMsg] = useState('');
    const [editor, setEditor] = useState(null);
    const load = useCallback(() => api('/admin/banners').then((r) => setRows(r.banners)).catch((e) => { setMsg(errText(e)); setRows([]); }), []);
    useEffect(() => { void load(); }, [load]);
    const toggle = async (b) => { try {
        await api(`/admin/banners/${b._id}`, { method: 'PATCH', body: { isActive: !b.isActive } });
        await load();
        onChange('toggled');
    }
    catch (e) {
        setMsg(errText(e));
    } };
    const remove = async (b) => {
        if (!window.confirm(`Delete the banner “${b.title}”?`))
            return;
        try {
            await api(`/admin/banners/${b._id}`, { method: 'DELETE' });
            setMsg('Banner deleted.'); notify.remove('Banner deleted.');
            await load();
            onChange('deleted');
        }
        catch (e) {
            setMsg(errText(e));
        }
    };
    return (<>
      <div className="mb-3 flex items-center justify-between gap-3"><p className="text-sm text-neutral-600">Slides on the home page. While no big-slider banner is active, the built-in slides are shown.</p>
        <button type="button" className="btn-primary" onClick={() => setEditor({ banner: null })}>+ New banner</button></div>
      {msg && <p role="status" className="mb-3 rounded-lg bg-white px-3 py-2 text-sm text-burgundy-700 ring-1 ring-gold/40">{msg}</p>}
      {rows === null ? <Empty>Loading banners…</Empty> : rows.length === 0 ? <Empty>No banners yet.</Empty> : (<ul className="grid gap-3 md:grid-cols-2">
          {rows.map((b) => (<li key={b._id} className="card flex gap-3">
              {b.image?.url ? <img src={b.image.url} alt="" className="h-20 w-28 shrink-0 rounded-lg object-cover"/> : <span className="flex h-20 w-28 shrink-0 items-center justify-center rounded-lg bg-cream-200 text-xs text-neutral-500">No image</span>}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{b.title}</p>
                <p className="truncate text-xs text-neutral-500">{b.placement === 'home_hero' ? 'Big slider' : 'Strip'} · {b.link} · {b.isActive ? 'Showing' : 'Hidden'}</p>
                <div className="mt-2 space-x-1">
                  <button type="button" className="btn-ghost !px-3 !py-1 text-xs" onClick={() => void toggle(b)}>{b.isActive ? 'Hide' : 'Show'}</button>
                  <button type="button" className="btn-ghost !px-3 !py-1 text-xs" onClick={() => setEditor({ banner: b })}>Edit</button>
                  <button type="button" className="rounded-lg border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50" onClick={() => void remove(b)}>Delete</button>
                </div>
              </div>
            </li>))}
        </ul>)}
      {editor && <BannerEditor banner={editor.banner} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); setMsg('Banner saved.'); notify.success('Banner saved.'); void load(); onChange('saved'); }}/>}
    </>);
}
export default function Offers() {
    const { refreshCatalog } = useStore();
    const [tab, setTab] = useState('coupons');
    const changed = () => void refreshCatalog(); // the shop reads offers and banners from the same server data
    return (<>
      <PageHeader title="Offers" subtitle="Coupons and home-page banners. Changes go live on the shop immediately."/>
      <div className="mb-4"><Chips value={tab} onChange={setTab} options={[{ v: 'coupons', label: 'Coupons' }, { v: 'banners', label: 'Banners' }]}/></div>
      {tab === 'coupons' ? <Coupons onChange={changed}/> : <Banners onChange={changed}/>}
    </>);
}
