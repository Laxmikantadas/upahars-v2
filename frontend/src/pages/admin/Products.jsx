import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { paiseToInr } from '../../lib/orders';
import { useStore } from '../../lib/store';
import { uploadImage } from './upload';
import CategoryAvatar from '../../components/CategoryAvatar';
import { isPincode } from '../../lib/shipping';
import { Badge, Empty, PageHeader } from './ui';
import { notify } from '../../lib/notify';
const TYPES = [['candle', 'Candle'], ['hamper', 'Hamper'], ['gift_box', 'Gift box'], ['handmade', 'Handmade'], ['decor', 'Décor'], ['personalized', 'Personalised'], ['other', 'Other']];
const EDITABLE_STATUS = ['published', 'draft', 'paused', 'archived'];
const STATUS_FILTERS = ['', 'published', 'draft', 'pending_review', 'paused', 'rejected', 'archived'];
const toPaise = (v) => Math.round(Number(v) * 100);
const num = (v) => Math.max(0, Math.round(Number(v) * 100) / 100 || 0);
const toRupees = (p) => (p == null ? '' : String(p / 100));
const errText = (e) => { const m = e instanceof ApiError ? e.message : 'Something went wrong. Please try again.'; notify.error(m); return m; };
const parseTags = (str) => str.split(',').map((t) => t.trim()).filter(Boolean);
const hasTag = (tags, t) => tags.some((x) => x.toLowerCase() === t);
const withTag = (tags, t, on) => (on ? (hasTag(tags, t) ? tags : [...tags, t]) : tags.filter((x) => x.toLowerCase() !== t));
const totalStock = (p) => p.stocks.reduce((a, s) => a + s.stock, 0);
const blank = (category) => ({ title: '', description: '', category, productType: 'other', price: '', mrp: '', stock: '10', tags: '', occasions: [], collections: [], isCustomizable: false, prompt: '', status: 'published', images: [], variants: [], packQuantity: '1', pickupPincode: '', weightGrams: '', lengthCm: '', widthCm: '', heightCm: '', processingDays: 3 });
const fromProduct = (p) => ({
    title: p.title, description: p.description, category: p.category, productType: p.productType, price: toRupees(p.pricePaise), mrp: toRupees(p.compareAtPaise),
    stock: String(p.stocks.find((s) => s.variantId === null)?.stock ?? 0), tags: p.tags.join(', '), occasions: p.occasions, collections: p.collections,
    isCustomizable: p.isCustomizable, prompt: p.customization?.prompt ?? '', status: p.status, images: p.images,
    packQuantity: String(p.packQuantity ?? 1), pickupPincode: p.pickupPincode ?? '', weightGrams: p.shipping?.weightGrams ? String(p.shipping.weightGrams) : '', lengthCm: p.shipping?.lengthCm ? String(p.shipping.lengthCm) : '', widthCm: p.shipping?.widthCm ? String(p.shipping.widthCm) : '', heightCm: p.shipping?.heightCm ? String(p.shipping.heightCm) : '', processingDays: p.shipping?.processingDays ?? 3,
    variants: p.variants.map((v) => ({ id: v.id, name: v.name, sku: v.sku, price: toRupees(v.pricePaise), mrp: toRupees(v.compareAtPaise), stock: String(p.stocks.find((s) => s.variantId === v.id)?.stock ?? 0) })),
});
function toPayload(f, editing) {
    const hasVariants = f.variants.length > 0;
    const body = {
        title: f.title.trim(), description: f.description.trim(), category: f.category, productType: f.productType,
        tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), occasions: f.occasions, collections: f.collections,
        isCustomizable: f.isCustomizable, customization: { prompt: f.prompt.trim(), maxLength: 60 }, images: f.images.map((url) => ({ url })), status: f.status,
        // where the courier collects the parcel + the parcel's size/weight (used for the courier pincode check)
        pickupPincode: f.pickupPincode.trim(),
        packQuantity: Math.max(1, Math.floor(num(f.packQuantity)) || 1),
        shipping: { weightGrams: Math.floor(num(f.weightGrams)), lengthCm: num(f.lengthCm), widthCm: num(f.widthCm), heightCm: num(f.heightCm), processingDays: f.processingDays },
    };
    if (hasVariants) {
        body.variants = f.variants.map((v) => ({ ...(v.id ? { id: v.id } : {}), name: v.name.trim(), sku: v.sku.trim(), pricePaise: toPaise(v.price), compareAtPaise: v.mrp ? toPaise(v.mrp) : null, stock: Math.max(0, Math.floor(Number(v.stock) || 0)) }));
    }
    else {
        body.pricePaise = toPaise(f.price);
        body.compareAtPaise = f.mrp.trim() ? toPaise(f.mrp) : editing ? null : undefined;
        body.stock = Math.max(0, Math.floor(Number(f.stock) || 0));
    }
    return body;
}
function validate(f) {
    if (f.title.trim().length < 3)
        return 'Enter a product name (at least 3 letters).';
    if (!f.category)
        return 'Choose a category.';
    if (!isPincode(f.pickupPincode.trim()))
        return 'Enter the pickup pincode — exactly 6 digits (where the courier collects this product).';
    if (Math.floor(num(f.weightGrams)) !== num(f.weightGrams) || num(f.weightGrams) > 50000)
        return 'Weight must be a whole number of grams (up to 50,000).';
    if ([f.lengthCm, f.widthCm, f.heightCm].some((d) => num(d) > 300))
        return 'Parcel size cannot be more than 300 cm in any direction.';
    if (f.variants.length) {
        if (f.variants.some((v) => !v.name.trim() || !(toPaise(v.price) >= 100)))
            return 'Every option needs a name and a price of at least ₹1.';
        return '';
    }
    if (!(toPaise(f.price) >= 100))
        return 'Enter a selling price of at least ₹1.';
    if (f.mrp.trim() && toPaise(f.mrp) <= toPaise(f.price))
        return 'The original price (MRP) must be higher than the selling price — or leave it empty.';
    return '';
}
function Editor({ product, taxonomy, onClose, onSaved }) {
    const cats = taxonomy.filter((t) => t.type === 'category' && (t.isActive || t.slug === product?.category));
    const occs = taxonomy.filter((t) => t.type === 'occasion');
    const cols = taxonomy.filter((t) => t.type === 'collection');
    const [f, setF] = useState(() => (product ? fromProduct(product) : blank(cats[0]?.slug ?? '')));
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    const [uploading, setUploading] = useState(false);
    const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
    const toggle = (k, slug) => setF((x) => ({ ...x, [k]: x[k].includes(slug) ? x[k].filter((s) => s !== slug) : [...x[k], slug] }));
    const setVariant = (i, patch) => setF((x) => ({ ...x, variants: x.variants.map((v, n) => (n === i ? { ...v, ...patch } : v)) }));
    const canUpload = !product || product.ownerType === 'upahars'; // images must live in the owner's folder
    const hasVariants = f.variants.length > 0;
    const statusOptions = EDITABLE_STATUS.includes(f.status) ? EDITABLE_STATUS : [f.status, ...EDITABLE_STATUS];
    const onFiles = async (files) => {
        if (!files?.length)
            return;
        setErr('');
        setUploading(true);
        try {
            const urls = [];
            for (const file of Array.from(files).slice(0, 8 - f.images.length))
                urls.push(await uploadImage(file, 'originals'));
            setF((x) => ({ ...x, images: [...x.images, ...urls] }));
        }
        catch (e) {
            setErr(errText(e));
        }
        finally {
            setUploading(false);
        }
    };
    const submit = async (e) => {
        e.preventDefault();
        const bad = validate(f);
        if (bad)
            return setErr(bad);
        setBusy(true);
        setErr('');
        try {
            const body = toPayload(f, Boolean(product));
            if (product) {
                if (f.status === product.status)
                    delete body.status; // don't re-send review states the API doesn't accept
                await api(`/admin/products/${product.id}`, { method: 'PATCH', body });
            }
            else {
                await api('/admin/products', { method: 'POST', body });
            }
            onSaved();
        }
        catch (e2) {
            setErr(errText(e2));
        }
        finally {
            setBusy(false);
        }
    };
    return (<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={product ? 'Edit product' : 'Add product'}>
      <form onSubmit={submit} className="w-full max-w-3xl space-y-4 rounded-2xl bg-cream-100 p-4 shadow-2xl sm:p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">{product ? 'Edit product' : 'Add product'}</h2>
          <button type="button" onClick={onClose} className="rounded-lg border border-gold/40 px-3 py-1 text-sm" aria-label="Close">✕</button>
        </div>
        {product?.ownerType === 'seller' && <p className="rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900">This is a seller’s listing. Your changes are saved and recorded in the audit log.</p>}

        <div><label htmlFor="pf-title" className="label">Product name *</label><input id="pf-title" className="input" value={f.title} maxLength={120} onChange={(e) => set('title', e.target.value)}/></div>
        <div><label htmlFor="pf-desc" className="label">Description</label><textarea id="pf-desc" className="input min-h-[90px]" value={f.description} maxLength={5000} onChange={(e) => set('description', e.target.value)}/></div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><span id="pf-cat-l" className="label">Category * <span className="font-normal text-neutral-500">— tap a picture to choose</span></span>
            <div role="radiogroup" aria-labelledby="pf-cat-l" className="flex flex-wrap gap-3 rounded-xl border border-gold/30 bg-white p-3">
              {cats.map((c) => { const on = f.category === c.slug; return (<button key={c.slug} type="button" role="radio" aria-checked={on} onClick={() => set('category', c.slug)} className={`flex w-20 flex-col items-center gap-1 rounded-xl p-1.5 text-center transition ${on ? 'bg-burgundy/10 ring-2 ring-burgundy' : 'hover:bg-gold/10'}`}>
                  <CategoryAvatar image={c.image?.url} name={c.name} className={`h-14 w-14 ${on ? '!ring-burgundy' : ''}`} text="text-2xl"/>
                  <span className={`text-[11px] leading-tight ${on ? 'font-bold text-burgundy' : 'text-neutral-700'}`}>{on ? '✓ ' : ''}{c.name}</span>
                </button>); })}
            </div></div>
          <div><label htmlFor="pf-type" className="label">Type</label>
            <select id="pf-type" className="input" value={f.productType} onChange={(e) => set('productType', e.target.value)}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        </div>

        {hasVariants ? (<fieldset className="space-y-2 rounded-xl border border-gold/30 bg-white p-3">
            <legend className="px-1 text-xs font-semibold text-burgundy-700">Options (price and stock for each)</legend>
            {f.variants.map((v, i) => (<div key={v.id ?? i} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr]">
                <div className="col-span-2 sm:col-span-1"><label className="label" htmlFor={`vn${i}`}>Name</label><input id={`vn${i}`} className="input" value={v.name} onChange={(e) => setVariant(i, { name: e.target.value })}/></div>
                <div><label className="label" htmlFor={`vp${i}`}>Price ₹</label><input id={`vp${i}`} type="number" min={1} step="0.01" className="input" value={v.price} onChange={(e) => setVariant(i, { price: e.target.value })}/></div>
                <div><label className="label" htmlFor={`vm${i}`}>MRP ₹</label><input id={`vm${i}`} type="number" min={0} step="0.01" className="input" value={v.mrp} onChange={(e) => setVariant(i, { mrp: e.target.value })}/></div>
                <div><label className="label" htmlFor={`vs${i}`}>Stock</label><input id={`vs${i}`} type="number" min={0} className="input" value={v.stock} onChange={(e) => setVariant(i, { stock: e.target.value })}/></div>
              </div>))}
          </fieldset>) : (<div className="grid gap-3 sm:grid-cols-3">
            <div><label htmlFor="pf-price" className="label">Selling price ₹ *</label><input id="pf-price" type="number" min={1} step="0.01" className="input" value={f.price} onChange={(e) => set('price', e.target.value)}/></div>
            <div><label htmlFor="pf-mrp" className="label">Original price ₹ (shows as offer)</label><input id="pf-mrp" type="number" min={0} step="0.01" className="input" placeholder="none" value={f.mrp} onChange={(e) => set('mrp', e.target.value)}/></div>
            <div><label htmlFor="pf-stock" className="label">Stock</label><input id="pf-stock" type="number" min={0} className="input" value={f.stock} onChange={(e) => set('stock', e.target.value)}/></div>
          </div>)}

        <fieldset className="rounded-xl border border-gold/30 bg-white p-3">
          <legend className="px-1 text-xs font-semibold text-burgundy-700">Product details (shown to customers)</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <div><label htmlFor="pf-pack" className="label">Quantity in 1 pack (pieces)</label><input id="pf-pack" type="number" min={1} max={10000} className="input" placeholder="1" value={f.packQuantity} onChange={(e) => set('packQuantity', e.target.value)}/></div>
            <p className="text-xs text-neutral-500 sm:col-span-2 sm:self-end">E.g. 12 for a set of 12 diyas. Weight and size below also appear on the product page; images (up to 8) all show in the gallery.</p>
          </div>
        </fieldset>

        <fieldset className="rounded-xl border border-gold/30 bg-white p-3">
          <legend className="px-1 text-xs font-semibold text-burgundy-700">Pickup &amp; parcel (for courier delivery check)</legend>
          <div className="grid gap-3 sm:grid-cols-5">
            <div className="sm:col-span-2"><label htmlFor="pf-pickup" className="label">Pickup pincode *</label>
              <input id="pf-pickup" inputMode="numeric" maxLength={6} className="input" placeholder="e.g. 751007" aria-invalid={f.pickupPincode !== '' && !isPincode(f.pickupPincode)} value={f.pickupPincode} onChange={(e) => set('pickupPincode', e.target.value.replace(/\D/g, '').slice(0, 6))}/>
              <p className="mt-1 text-xs text-neutral-500">Where the courier collects it. Customers never see this.</p></div>
            <div><label htmlFor="pf-w" className="label">Weight (g)</label><input id="pf-w" type="number" min={0} max={50000} className="input" placeholder="500" value={f.weightGrams} onChange={(e) => set('weightGrams', e.target.value)}/></div>
            <div className="sm:col-span-2"><span className="label">Parcel size (cm) L × W × H</span>
              <div className="flex gap-1.5">{[['lengthCm', 'Length'], ['widthCm', 'Width'], ['heightCm', 'Height']].map(([k, l]) => (<input key={k} type="number" min={0} max={300} aria-label={l} placeholder={l} className="input min-w-0" value={f[k]} onChange={(e) => set(k, e.target.value)}/>))}</div></div>
          </div>
          <p className="mt-1 text-xs text-neutral-500">Empty weight counts as 0.5 kg and an empty size as 10 cm, so the courier check still works.</p>
        </fieldset>

        <fieldset className="rounded-xl border border-gold/30 bg-white p-3">
          <legend className="px-1 text-xs font-semibold text-burgundy-700">Show on home page</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {[['trending', '🔥 Trending Handmade Products'], ['best', '⭐ Best Sellers']].map(([t, label]) => (<label key={t} className="flex items-center gap-2 font-medium">
                <input type="checkbox" checked={hasTag(parseTags(f.tags), t)} onChange={(e) => set('tags', withTag(parseTags(f.tags), t, e.target.checked).join(', '))}/>{label}
              </label>))}
          </div>
        </fieldset>

        <div><label htmlFor="pf-tags" className="label">Tags (comma separated)</label><input id="pf-tags" className="input" value={f.tags} placeholder="trending, best, diwali" onChange={(e) => set('tags', e.target.value)}/>
          <p className="mt-1 text-xs text-neutral-500">Use the boxes above for the home-page rows; add any other tags here.</p></div>

        {occs.length > 0 && <fieldset><legend className="label">Occasions</legend><div className="flex flex-wrap gap-2">{occs.map((o) => (<label key={o.slug} className="flex items-center gap-1.5 rounded-full border border-gold/40 bg-white px-3 py-1 text-xs"><input type="checkbox" checked={f.occasions.includes(o.slug)} onChange={() => toggle('occasions', o.slug)}/>{o.name}</label>))}</div></fieldset>}
        {cols.length > 0 && <fieldset><legend className="label">Collections</legend><div className="flex flex-wrap gap-2">{cols.map((o) => (<label key={o.slug} className="flex items-center gap-1.5 rounded-full border border-gold/40 bg-white px-3 py-1 text-xs"><input type="checkbox" checked={f.collections.includes(o.slug)} onChange={() => toggle('collections', o.slug)}/>{o.name}</label>))}</div></fieldset>}

        <div className="rounded-xl border border-gold/30 bg-white p-3">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={f.isCustomizable} onChange={(e) => set('isCustomizable', e.target.checked)}/>Customer can personalise this (name / message)</label>
          {f.isCustomizable && <div className="mt-2"><label htmlFor="pf-prompt" className="label">What should the customer enter?</label><input id="pf-prompt" className="input" maxLength={120} placeholder="Name or message to print" value={f.prompt} onChange={(e) => set('prompt', e.target.value)}/></div>}
        </div>

        <div>
          <p className="label">Images (up to 8)</p>
          <div className="flex flex-wrap gap-2">
            {f.images.map((u, i) => (<div key={u} className="relative h-20 w-20 overflow-hidden rounded-lg border border-gold/40">
                <img src={u} alt={`Product ${i + 1}`} className="h-full w-full object-cover"/>
                <button type="button" aria-label={`Remove image ${i + 1}`} onClick={() => set('images', f.images.filter((x) => x !== u))} className="absolute right-0.5 top-0.5 rounded-full bg-black/70 px-1.5 text-xs text-white">✕</button>
              </div>))}
            {canUpload && f.images.length < 8 && (<label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-gold/60 text-center text-xs text-burgundy-700">
                {uploading ? 'Uploading…' : '+ Add'}
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={uploading} onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }}/>
              </label>)}
          </div>
          <p className="mt-1 text-xs text-neutral-500">{canUpload ? 'JPG, PNG or WebP. Without an image the shop shows a coloured placeholder.' : 'Seller images can be removed here; only the seller can upload new ones.'}</p>
        </div>

        <div className="max-w-xs"><label htmlFor="pf-status" className="label">Visibility</label>
          <select id="pf-status" className="input capitalize" value={f.status} onChange={(e) => set('status', e.target.value)}>
            {(product ? statusOptions : ['published', 'draft']).map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select>
          <p className="mt-1 text-xs text-neutral-500">Only “published” products are visible to customers.</p></div>

        {err && <p role="alert" className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
          <button type="submit" disabled={busy || uploading} className="btn-primary disabled:opacity-60">{busy ? 'Saving…' : product ? 'Save changes' : 'Add product'}</button>
        </div>
      </form>
    </div>);
}
export default function Products() {
    const { refreshCatalog } = useStore();
    const [rows, setRows] = useState([]);
    const [total, setTotal] = useState(0);
    const [taxonomy, setTaxonomy] = useState([]);
    const [q, setQ] = useState('');
    const [status, setStatus] = useState('');
    const [owner, setOwner] = useState('');
    const [page, setPage] = useState(1);
    const [state, setState] = useState('loading');
    const [msg, setMsg] = useState('');
    const [editor, setEditor] = useState(null);
    const LIMIT = 20;
    const load = useCallback(async () => {
        try {
            const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
            if (q.trim())
                qs.set('q', q.trim());
            if (status)
                qs.set('status', status);
            if (owner)
                qs.set('owner', owner);
            const r = await api(`/admin/products?${qs}`);
            setRows(r.products);
            setTotal(r.total);
            setState('ready');
        }
        catch (e) {
            setMsg(errText(e));
            setState('error');
        }
    }, [page, q, status, owner]);
    useEffect(() => { const t = setTimeout(() => void load(), 250); return () => clearTimeout(t); }, [load]);
    const [taxState, setTaxState] = useState('loading');
    const [taxErr, setTaxErr] = useState('');
    const loadTaxonomy = useCallback(async () => {
        setTaxState('loading');
        setTaxErr('');
        try {
            const r = await api('/admin/taxonomy');
            setTaxonomy(r.items);
            setTaxState('ready');
        }
        catch (e) {
            setTaxErr(errText(e));
            setTaxState('error');
        }
    }, []);
    useEffect(() => { void loadTaxonomy(); }, [loadTaxonomy]);
    // First-time setup: a fresh database has no categories, and a product cannot be saved without one.
    const createDefaultCategories = async () => {
        setMsg('');
        try {
            for (const [i, name] of ['Candles', 'Hampers', 'Gift Boxes', 'Handmade', 'Home Decor', 'Personalised'].entries())
                await api('/admin/taxonomy', { method: 'POST', body: { type: 'category', name, sortOrder: i } });
            await loadTaxonomy();
            setMsg('Default categories created. You can now add products.'); notify.success('Default categories created. You can now add products.');
        }
        catch (e) {
            setMsg(errText(e));
            await loadTaxonomy();
        }
    };
    const hasCategory = taxonomy.some((t) => t.type === 'category' && t.isActive);
    const changed = async (note) => { setMsg(note); notify.success(note); await Promise.all([load(), refreshCatalog()]); };
    const run = async (fn, note) => { try {
        await fn();
        await changed(note);
    }
    catch (e) {
        setMsg(errText(e));
    } };
    const remove = (p) => {
        const ok = window.confirm(`Delete “${p.title}”?\n\nThis cannot be undone. If customers have already ordered it, it will be archived (hidden) instead so order history stays intact.`);
        if (!ok)
            return;
        void run(async () => {
            const r = await api(`/admin/products/${p.id}`, { method: 'DELETE' });
            setMsg(r.archived ? 'This product has orders, so it was archived instead of deleted.' : 'Product deleted.'); notify.remove(r.archived ? 'This product has orders, so it was archived instead of deleted.' : 'Product deleted.');
        }, '');
    };
    const toggleTag = (p, t, label) => {
        const on = hasTag(p.tags, t);
        return run(() => api(`/admin/products/${p.id}`, { method: 'PATCH', body: { tags: withTag(p.tags, t, !on) } }), on ? `“${p.title}” removed from ${label}.` : `“${p.title}” added to ${label}.`);
    };
    const setProductStatus = (p, s) => run(() => api(`/admin/products/${p.id}`, { method: 'PATCH', body: { status: s } }), `“${p.title}” is now ${s}.`);
    return (<>
      <PageHeader title="Products" subtitle={state === 'ready' ? `${total} product${total === 1 ? '' : 's'}` : ''} actions={<button type="button" className="btn-primary disabled:opacity-60" onClick={() => setEditor({ product: null })} disabled={taxState === 'loading' || !hasCategory}>+ Add product</button>}/>

      {taxState === 'error' && (<p role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800">
          Could not load categories, so products cannot be added yet. {taxErr}
          <button type="button" className="btn-ghost !px-3 !py-1 text-xs" onClick={() => void loadTaxonomy()}>Try again</button>
        </p>)}
      {taxState === 'ready' && !hasCategory && (<p role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">
          There are no categories yet — every product needs one.
          <button type="button" className="btn-primary !px-3 !py-1 text-xs" onClick={() => void createDefaultCategories()}>Create default categories</button>
        </p>)}

      <div className="mb-3 flex flex-wrap gap-2">
        <label htmlFor="pq" className="sr-only">Search products</label>
        <input id="pq" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search products" className="input sm:w-56"/>
        <label htmlFor="ps" className="sr-only">Status</label>
        <select id="ps" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="input capitalize sm:w-44">
          {STATUS_FILTERS.map((s) => <option key={s} value={s}>{s ? s.replace('_', ' ') : 'All statuses'}</option>)}</select>
        <label htmlFor="po" className="sr-only">Sold by</label>
        <select id="po" value={owner} onChange={(e) => { setOwner(e.target.value); setPage(1); }} className="input sm:w-44">
          <option value="">All sellers</option><option value="upahars">Upahars Originals</option><option value="seller">Seller listings</option></select>
      </div>
      {msg && <p role="status" className="mb-3 rounded-lg bg-white px-3 py-2 text-sm text-burgundy-700 ring-1 ring-gold/40">{msg}</p>}

      {state === 'loading' ? <Empty>Loading products…</Empty>
            : state === 'error' ? <Empty>Could not load products from the server. {msg}</Empty>
                : rows.length === 0 ? <Empty>No products match. Use “Add product” to create one.</Empty> : (<div className="card overflow-x-auto p-0">
            <table className="w-full min-w-[940px] text-left text-sm">
              <thead className="bg-cream-200/60 text-xs text-neutral-500"><tr><th className="px-4 py-2">Product</th><th>Sold by</th><th>Price</th><th>Stock</th><th>Home page</th><th>Status</th><th className="pr-4 text-right">Actions</th></tr></thead>
              <tbody>
                {rows.map((p) => (<tr key={p.id} className="border-t border-gold/20 align-middle">
                    <td className="px-4 py-2"><div className="flex items-center gap-2">
                      {p.images[0] ? <img src={p.images[0]} alt="" className="h-10 w-10 rounded-lg object-cover"/> : <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-cream-200 text-lg" aria-hidden="true">🎁</span>}
                      <span><span className="font-medium">{p.title}</span>
                        {p.pickupPincode ? <span className="block text-[11px] text-neutral-500">Pickup {p.pickupPincode}</span> : <span className="block text-[11px] font-semibold text-amber-700">⚠ No pickup pincode</span>}</span></div></td>
                    <td className="text-xs text-neutral-600">{p.ownerType === 'upahars' ? 'Upahars' : 'Seller'}</td>
                    <td><span className="font-semibold text-burgundy-700">{paiseToInr(p.pricePaise)}</span>{p.compareAtPaise ? <span className="ml-1 text-xs text-neutral-400 line-through">{paiseToInr(p.compareAtPaise)}</span> : null}{p.variants.length ? <span className="ml-1 text-xs text-neutral-500">from</span> : null}</td>
                    <td className={totalStock(p) === 0 ? 'font-semibold text-red-700' : ''}>{totalStock(p)}</td>
                    <td className="whitespace-nowrap">
                      {[['trending', '🔥', 'Trending'], ['best', '⭐', 'Best seller']].map(([t, e, label]) => { const on = hasTag(p.tags, t); return (<button key={t} type="button" aria-pressed={on} title={on ? `Remove from ${label}` : `Add to ${label}`} onClick={() => void toggleTag(p, t, label)} className={`mr-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${on ? 'border-gold bg-gold/20 text-burgundy-700' : 'border-neutral-300 text-neutral-400 hover:border-gold hover:text-burgundy-700'}`}>{e} {label}</button>); })}
                    </td>
                    <td>
                      {p.status === 'pending_review' ? <Badge value="pending review"/> : (<select aria-label={`Status of ${p.title}`} value={p.status} onChange={(e) => void setProductStatus(p, e.target.value)} className="input w-32 py-1 text-xs capitalize">
                          {(EDITABLE_STATUS.includes(p.status) ? EDITABLE_STATUS : [p.status, ...EDITABLE_STATUS]).map((s) => <option key={s} value={s}>{s}</option>)}</select>)}
                    </td>
                    <td className="space-x-1 whitespace-nowrap pr-4 text-right">
                      {p.status === 'pending_review' && <button type="button" className="btn-gold !px-3 !py-1 text-xs" onClick={() => void run(() => api(`/admin/products/${p.id}/approve`, { method: 'POST', body: {} }), `Approved “${p.title}”.`)}>Approve</button>}
                      <button type="button" className="btn-ghost !px-3 !py-1 text-xs" onClick={() => setEditor({ product: p })}>Edit</button>
                      <button type="button" className="rounded-lg border border-red-300 px-3 py-1 text-xs font-semibold text-red-700 hover:bg-red-50" onClick={() => remove(p)}>Delete</button>
                    </td>
                  </tr>))}
              </tbody>
            </table>
          </div>)}

      {total > LIMIT && (<div className="mt-3 flex items-center justify-center gap-3 text-sm">
          <button type="button" className="btn-ghost !py-1" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>Previous</button>
          <span>Page {page} of {Math.ceil(total / LIMIT)}</span>
          <button type="button" className="btn-ghost !py-1" disabled={page >= Math.ceil(total / LIMIT)} onClick={() => setPage((n) => n + 1)}>Next</button>
        </div>)}

      {editor && <Editor product={editor.product} taxonomy={taxonomy} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void changed(editor.product ? 'Product saved.' : 'Product added.'); }}/>}
    </>);
}
