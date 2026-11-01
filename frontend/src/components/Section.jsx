import { Link } from 'react-router-dom';
export default function Section({ title, subtitle, to, toLabel = 'View all', children, tone = 'plain' }) {
    const bg = tone === 'dark' ? 'bg-burgundy-700 text-cream' : tone === 'soft' ? 'bg-cream-200/70' : '';
    return (<section className={`${bg} reveal py-8 md:py-12`}>
      <div className="container-page">
        <div className="mb-4 flex items-end justify-between gap-3">
          <div>
            <h2 className={`text-2xl font-bold md:text-3xl ${tone === 'dark' ? '!text-gold-300' : ''}`}>{title}</h2>
            {subtitle && <p className={`mt-0.5 text-sm ${tone === 'dark' ? 'text-cream/80' : 'text-neutral-600'}`}>{subtitle}</p>}
            <span className="mt-2 flex items-center gap-1.5" aria-hidden="true"><span className="h-0.5 w-14 rounded bg-gold"/><span className="h-1.5 w-1.5 rotate-45 bg-gold"/></span>
          </div>
          {to && (<Link to={to} className={`shrink-0 text-sm font-semibold hover:underline ${tone === 'dark' ? 'text-gold-300' : 'text-burgundy'}`}>
              {toLabel} →
            </Link>)}
        </div>
        {children}
      </div>
    </section>);
}
/** Horizontal scroll on mobile (app-like), grid on larger screens. */
export function Rail({ children }) {
    return (<div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0 lg:grid-cols-5 [&>*]:w-44 [&>*]:shrink-0 [&>*]:snap-start md:[&>*]:w-auto">
      {children}
    </div>);
}
