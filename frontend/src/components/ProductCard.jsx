import { Link } from 'react-router-dom';
import { discountPct, inr } from '../data/demo';
import { addRecent } from '../lib/recent';
import { madeNote, popularBadge } from '../lib/madeNote';
export default function ProductCard({ product, className = '' }) {
    const off = discountPct(product);
    const badge = popularBadge(product);
    return (<Link to={`/product/${product.slug}`} onClick={() => addRecent(product.id)} className={`group block overflow-hidden rounded-2xl border border-gold/30 bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg ${className}`}>
      <div className="relative flex aspect-square items-center justify-center text-6xl" style={{ background: `linear-gradient(135deg, ${product.from}, ${product.to})` }} aria-hidden="true">
        {product.image
            ? <img src={product.image} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover"/>
            : <span className="drop-shadow-md transition group-hover:scale-110">{product.emoji}</span>}
        {off > 0 && (<span className="absolute left-2 top-2 rounded-full bg-burgundy px-2 py-0.5 text-[11px] font-bold text-cream">{off}% OFF</span>)}
        {badge && (<span className={`absolute right-2 top-2 rounded-full px-2 py-0.5 text-[11px] font-bold shadow ${badge.cls}`}><span aria-hidden="true">{badge.icon} </span>{badge.label}</span>)}
        {product.inStock === false && (<span className="absolute inset-x-0 bottom-0 bg-neutral-800/80 py-1 text-center text-xs font-semibold text-white">Out of stock</span>)}
        {!product.live && <span className="absolute bottom-2 right-2 rounded bg-white/80 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-neutral-600">Demo</span>}
      </div>
      <div className="p-3">
        <p className="line-clamp-2 min-h-[2.5rem] text-sm font-medium text-neutral-800">{product.name}</p>
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-neutral-500">{madeNote(product)}</p>
        {product.reviews > 0 && <p className="mt-1 text-xs text-neutral-500">★ {product.rating.toFixed(1)} · {product.reviews} reviews</p>}
        <p className="mt-1 flex items-baseline gap-2">
          <span className="text-base font-bold text-burgundy-700">{inr(product.salePrice ?? product.price)}</span>
          {product.salePrice && <span className="text-xs text-neutral-400 line-through">{inr(product.price)}</span>}
        </p>
      </div>
    </Link>);
}
