import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useStore } from '../../lib/store';
import CategoryAvatar from '../../components/CategoryAvatar';
import { uploadImage } from './upload';
import { Empty, PageHeader } from './ui';
import { notify } from '../../lib/notify';

const errText = (e) => { const m = e instanceof ApiError ? e.message : 'Something went wrong. Please try again.'; notify.error(m); return m; };

function CategoryEditor({ item, nextOrder, onClose, onSaved }) {
    const [name, setName] = useState(item?.name ?? '');
    const [image, setImage] = useState(item?.image?.url ?? '');
    const [sortOrder, setSortOrder] = useState(String(item?.sortOrder ?? nextOrder));
    const [isActive, setIsActive] = useState(item?.isActive ?? true);
    const [busy, setBusy] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [err, setErr] = useState('');
    const pick = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        setUploading(true); setErr('');
        try { setImage(await uploadImage(file, 'site')); } catch (x) { setErr(errText(x)); } finally { setUploading(false); }
    };
    const submit = async (e) => {
        e.preventDefault();
        if (name.trim().length < 2) return setErr('Enter a category name (at least 2 letters).');
        setBusy(true); setErr('');
        const base = { name: name.trim(), sortOrder: Math.max(0, Math.floor(Number(sortOrder) || 0)), isActive };
        try {
            if (item) await api(`/admin/taxonomy/${item._id}`, { method: 'PATCH', body: { ...base, image: image ? { url: image } : null } });
            else await api('/admin/taxonomy', { body: { type: 'category', ...base, ...(image ? { image: { url: image } } : {}) } });
            await onSaved(item ? 'Category updated.' : 'Category added.');
        } catch (x) { setErr(errText(x)); setBusy(false); }
    };
    return (<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={item ? 'Edit category' : 'Add category'}>
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-2xl bg-cream-100 p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">{item ? 'Edit category' : 'Add category'}</h2>
          <button type="button" onClick={onClose} className="rounded-lg border border-gold/40 px-3 py-1 text-sm" aria-label="Close">✕</button>
        </div>
        <div className="flex flex-col items-center gap-2">
          <CategoryAvatar image={image} name={name} className="h-28 w-28" text="text-5xl"/>
          <label className="btn-ghost cursor-pointer !py-1.5 text-xs">
            {uploading ? 'Uploading…' : image ? 'Change picture' : 'Upload picture'}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => void pick(e)} disabled={uploading}/>
          </label>
          {image && <button type="button" className="text-xs text-red-700 underline" onClick={() => setImage('')}>Remove picture</button>}
          <p className="text-xs text-neutral-500">Use a square photo (JPG, PNG or WebP). It is shown in a circle.</p>
        </div>
        <div><label htmlFor="cat-name" className="label">Category name *</label><input id="cat-name" className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Decorative Candles"/></div>
        <div className="grid grid-cols-2 items-end gap-3">
          <div><label htmlFor="cat-order" className="label">Position (0 = first)</label><input id="cat-order" type="number" min={0} className="input" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}/></div>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)}/> Show on website</label>
        </div>
        {err && <p role="alert" className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary disabled:opacity-60" disabled={busy || uploading}>{busy ? 'Saving…' : 'Save category'}</button>
        </div>
      </form>
    </div>);
}

export default function Categories() {
    const { isLive, refreshCatalog } = useStore();
    const [rows, setRows] = useState(null);
    const [msg, setMsg] = useState('');
    const [editor, setEditor] = useState(null);
    const load = useCallback(async () => {
        try {
            const r = await api('/admin/taxonomy');
            setRows(r.items.filter((t) => t.type === 'category').sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)));
        } catch (e) { setMsg(errText(e)); setRows([]); }
    }, []);
    useEffect(() => { void load(); }, [load]);
    const saved = async (note) => { setEditor(null); setMsg(note); notify.success(note); await Promise.all([load(), refreshCatalog()]); };
    const toggle = async (c) => {
        try { await api(`/admin/taxonomy/${c._id}`, { method: 'PATCH', body: { isActive: !c.isActive } }); await saved(`“${c.name}” is now ${c.isActive ? 'hidden' : 'visible'}.`); } catch (e) { setMsg(errText(e)); }
    };
    const remove = async (c) => {
        if (!window.confirm(`Delete the category “${c.name}”?`)) return;
        try { await api(`/admin/taxonomy/${c._id}`, { method: 'DELETE' }); await saved(`“${c.name}” deleted.`); } catch (e) { setMsg(errText(e)); }
    };
    if (!isLive)
        return <Empty>Categories are managed on the live server. Start the backend and reload this page.</Empty>;
    return (<>
      <PageHeader title="Categories" subtitle="These appear as round pictures in “Shop by Category” and in the product form." actions={<button type="button" className="btn-primary" onClick={() => setEditor({ item: null })}>+ Add category</button>}/>
      {msg && <p role="status" className="mb-3 rounded-lg bg-white px-3 py-2 text-sm text-burgundy-700 ring-1 ring-gold/40">{msg}</p>}
      {rows === null ? <Empty>Loading categories…</Empty> : rows.length === 0 ? <Empty>No categories yet. Add your first one.</Empty> : (<ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {rows.map((c) => (<li key={c._id} className={`card flex flex-col items-center gap-2 text-center ${c.isActive ? '' : 'opacity-60'}`}>
              <CategoryAvatar image={c.image?.url} name={c.name} className="h-24 w-24" text="text-4xl"/>
              <p className="text-sm font-semibold text-burgundy-700">{c.name}</p>
              <p className="text-xs text-neutral-500">Position {c.sortOrder}{c.isActive ? '' : ' · hidden'}</p>
              <div className="mt-auto flex flex-wrap justify-center gap-1.5">
                <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setEditor({ item: c })}>Edit</button>
                <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => void toggle(c)}>{c.isActive ? 'Hide' : 'Show'}</button>
                <button type="button" className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50" onClick={() => void remove(c)}>Delete</button>
              </div>
            </li>))}
        </ul>)}
      {editor && <CategoryEditor item={editor.item} nextOrder={rows?.length ?? 0} onClose={() => setEditor(null)} onSaved={saved}/>}
    </>);
}
