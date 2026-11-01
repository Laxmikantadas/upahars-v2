import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { useStore } from '../../lib/store';
import { uploadImage } from './upload';
import { Empty, PageHeader } from './ui';
import { notify } from '../../lib/notify';

const errText = (e) => { const m = e instanceof ApiError ? e.message : 'Something went wrong. Please try again.'; notify.error(m); return m; };

/** Small polaroid used for the live preview in the editor and for the list. */
function Print({ image, title, caption, className = '' }) {
    return (<figure className={`bg-[#fbfaf7] p-2 pb-0 shadow-md ring-1 ring-black/5 ${className}`}>
      <div className="aspect-square w-full overflow-hidden bg-[#d9d5cc]">
        {image ? <img src={image} alt="" className="h-full w-full object-cover"/> : <div className="flex h-full items-center justify-center px-2 text-center text-xs text-neutral-500">No picture yet</div>}
      </div>
      <figcaption className="flex h-10 items-center justify-center truncate px-1 font-serif text-sm italic text-neutral-700">{title || 'Name'}</figcaption>
      {caption !== undefined && <span className="sr-only">{caption}</span>}
    </figure>);
}

function ShowcaseEditor({ item, nextOrder, onClose, onSaved }) {
    const [title, setTitle] = useState(item?.title ?? '');
    const [caption, setCaption] = useState(item?.caption ?? '');
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
        if (title.trim().length < 2) return setErr('Enter a name (at least 2 letters).');
        setBusy(true); setErr('');
        const base = { title: title.trim(), caption: caption.trim(), sortOrder: Math.max(0, Math.floor(Number(sortOrder) || 0)), isActive };
        try {
            if (item) await api(`/admin/showcase/${item._id}`, { method: 'PATCH', body: { ...base, image: image ? { url: image } : null } });
            else await api('/admin/showcase', { body: { ...base, ...(image ? { image: { url: image } } : {}) } });
            await onSaved(item ? 'Picture updated.' : 'Picture added to the carousel.');
        } catch (x) { setErr(errText(x)); setBusy(false); }
    };
    return (<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={item ? 'Edit carousel picture' : 'Add carousel picture'}>
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-2xl bg-cream-100 p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">{item ? 'Edit picture' : 'Add picture'}</h2>
          <button type="button" onClick={onClose} className="rounded-lg border border-gold/40 px-3 py-1 text-sm" aria-label="Close">✕</button>
        </div>
        <div className="flex flex-col items-center gap-2">
          <Print image={image} title={title} className="w-44 -rotate-2"/>
          <label className="btn-ghost cursor-pointer !py-1.5 text-xs">
            {uploading ? 'Uploading…' : image ? 'Change picture' : 'Upload picture'}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => void pick(e)} disabled={uploading}/>
          </label>
          {image && <button type="button" className="text-xs text-red-700 underline" onClick={() => setImage('')}>Remove picture</button>}
          <p className="text-center text-xs text-neutral-500">Use a square photo (JPG, PNG or WebP, up to 8 MB). Without a picture, the website paints a soft placeholder.</p>
        </div>
        <div><label htmlFor="sc-title" className="label">Name *</label><input id="sc-title" className="input" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Hand-painted Diyas"/></div>
        <div>
          <label htmlFor="sc-caption" className="label">Description</label>
          <textarea id="sc-caption" className="input min-h-[4.5rem]" maxLength={160} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="One short line shown under the picture"/>
          <p className="mt-0.5 text-right text-[11px] text-neutral-500">{caption.length}/160</p>
        </div>
        <div className="grid grid-cols-2 items-end gap-3">
          <div><label htmlFor="sc-order" className="label">Position (0 = first)</label><input id="sc-order" type="number" min={0} className="input" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}/></div>
          <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)}/> Show on website</label>
        </div>
        {err && <p role="alert" className="rounded-lg bg-red-100 px-3 py-2 text-sm text-red-800">{err}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary disabled:opacity-60" disabled={busy || uploading}>{busy ? 'Saving…' : 'Save picture'}</button>
        </div>
      </form>
    </div>);
}

export default function Showcase() {
    const { isLive, refreshCatalog } = useStore();
    const [rows, setRows] = useState(null);
    const [msg, setMsg] = useState('');
    const [editor, setEditor] = useState(null);
    const load = useCallback(async () => {
        try { setRows((await api('/admin/showcase')).items); }
        catch (e) { setMsg(errText(e)); setRows([]); }
    }, []);
    useEffect(() => { void load(); }, [load]);
    const saved = async (note) => { setEditor(null); setMsg(note); notify.success(note); await Promise.all([load(), refreshCatalog()]); };
    const toggle = async (s) => {
        try { await api(`/admin/showcase/${s._id}`, { method: 'PATCH', body: { isActive: !s.isActive } }); await saved(`“${s.title}” is now ${s.isActive ? 'hidden' : 'visible'}.`); } catch (e) { setMsg(errText(e)); }
    };
    const remove = async (s) => {
        if (!window.confirm(`Delete “${s.title}” from the carousel?`)) return;
        try { await api(`/admin/showcase/${s._id}`, { method: 'DELETE' }); await saved(`“${s.title}” deleted.`); } catch (e) { setMsg(errText(e)); }
    };
    if (!isLive)
        return <Empty>The home carousel is managed on the live server. Start the backend and reload this page.</Empty>;
    return (<>
      <PageHeader title="Home carousel" subtitle="The hanging polaroid pictures right below the home-page banner: a picture, a name and a short description." actions={<button type="button" className="btn-primary" onClick={() => setEditor({ item: null })}>+ Add picture</button>}/>
      {msg && <p role="status" className="mb-3 rounded-lg bg-white px-3 py-2 text-sm text-burgundy-700 ring-1 ring-gold/40">{msg}</p>}
      {rows === null ? <Empty>Loading pictures…</Empty> : rows.length === 0 ? <Empty>No pictures yet. Add your first one — the carousel stays hidden on the website until you do.</Empty> : (<ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {rows.map((s) => (<li key={s._id} className={`card flex flex-col gap-2 ${s.isActive ? '' : 'opacity-60'}`}>
              <Print image={s.image?.url} title={s.title} className="mx-auto w-full max-w-[11rem]"/>
              <p className="line-clamp-2 min-h-[2.25rem] text-xs text-neutral-600">{s.caption || <span className="italic text-neutral-400">No description</span>}</p>
              <p className="text-xs text-neutral-500">Position {s.sortOrder}{s.isActive ? '' : ' · hidden'}</p>
              <div className="mt-auto flex flex-wrap gap-1.5">
                <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => setEditor({ item: s })}>Edit</button>
                <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => void toggle(s)}>{s.isActive ? 'Hide' : 'Show'}</button>
                <button type="button" className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50" onClick={() => void remove(s)}>Delete</button>
              </div>
            </li>))}
        </ul>)}
      {editor && <ShowcaseEditor item={editor.item} nextOrder={rows?.length ?? 0} onClose={() => setEditor(null)} onSaved={saved}/>}
    </>);
}
