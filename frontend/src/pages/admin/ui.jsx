const COLORS = {
    placed: 'bg-blue-100 text-blue-800',
    confirmed: 'bg-amber-100 text-amber-800',
    shipped: 'bg-indigo-100 text-indigo-800',
    delivered: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
    new: 'bg-blue-100 text-blue-800',
    quoted: 'bg-amber-100 text-amber-800',
    closed: 'bg-neutral-200 text-neutral-700',
};
export const Badge = ({ value }) => (<span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${COLORS[value] ?? 'bg-neutral-100 text-neutral-700'}`}>{value}</span>);
export const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
export function PageHeader({ title, subtitle, actions }) {
    return (<div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-3xl font-bold">{title}</h1>
        {subtitle && <p className="text-sm text-neutral-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>);
}
export const Empty = ({ children }) => (<div className="card text-center text-sm text-neutral-600">{children}</div>);
export function Chips({ value, onChange, options }) {
    return (<div className="flex flex-wrap gap-2" role="tablist">
      {options.map((o) => (<button key={o.v} type="button" role="tab" aria-selected={value === o.v} onClick={() => onChange(o.v)} className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${value === o.v ? 'bg-burgundy text-cream' : 'border border-gold/40 bg-white text-burgundy-700 hover:bg-gold/10'}`}>
          {o.label}{o.count !== undefined && <span className="ml-1 opacity-70">{o.count}</span>}
        </button>))}
    </div>);
}
