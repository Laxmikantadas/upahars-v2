import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import PincodeCheck from '../components/PincodeCheck';
import ProductCard from '../components/ProductCard';
import { describe, discountPct, inr, isCustomizable } from '../data/demo';
import { addRecent } from '../lib/recent';
import { useStore } from '../lib/store';
import ComingSoon from './ComingSoon';
import { notify } from '../lib/notify';
import ProductGallery from '../components/ProductGallery';
import { productFacts } from '../lib/specs';
import { useSeo } from '../components/Seo';
import { breadcrumbSchema, categoryPath, clip, findCategory, productPath, productSchema } from '../lib/seo';
export default function ProductDetail() {
    const { slug = '' } = useParams();
    const { getProduct, products, categories, addToCart, user } = useStore();
    const navigate = useNavigate();
    const [qty, setQty] = useState(1);
    const [note, setNote] = useState('');
    const [error, setError] = useState('');
    const [added, setAdded] = useState(false);
    const p = getProduct(slug);
    const cat = p ? findCategory(categories, p.category) : undefined;
    const catPath = cat ? categoryPath(cat) : `/categories?name=${encodeURIComponent(p?.category ?? '')}`;
    // Demo/sample products are placeholders, so they are kept out of Google. Real catalogue products are indexed.
    useSeo(p ? {
        title: `${p.name}: Buy Online`, type: 'product', path: productPath(p), image: p.images?.[0] ?? p.image, noindex: !p.live,
        description: clip(`${p.description ? p.description + ' ' : ''}Buy ${p.name} (${p.category}) online at ₹${Math.round(p.salePrice ?? p.price)}. Handmade by Odisha artisans. Delivery across India.`, 158),
        schema: [breadcrumbSchema([{ name: 'Home', path: '/' }, { name: p.category, path: cat ? catPath : '/categories' }, { name: p.name, path: productPath(p) }]), productSchema(p)],
    } : { title: 'Product not found', noindex: true });
    useEffect(() => { if (p)
        addRecent(p.id); }, [p]);
    if (!p)
        return <ComingSoon notFound/>;
    const custom = isCustomizable(p);
    const off = discountPct(p);
    const facts = productFacts(p);
    const maxQty = Math.min(20, p.lowStock ?? 20);
    const related = products.filter((x) => x.category === p.category && x.id !== p.id).slice(0, 5);
    const add = (go) => {
        if (custom && !note.trim()) {
            notify.error('Please enter the name or message to personalize this gift.', { title: 'Almost there!' });
            return setError('Please enter the name or message to personalize this gift.');
        }
        setError('');
        if (!addToCart(p.id, qty, custom ? note : undefined)) {
            notify.error('Please sign in to order.', { title: 'Hello there!', emoji: '🔐' });
            return setError('Please sign in to order.');
        }
        if (go)
            navigate('/cart');
        else {
            setAdded(true);
            setTimeout(() => setAdded(false), 2000);
        }
    };
    return (<div className="container-page py-6">
      <p className="text-sm text-neutral-600">
        <Link to="/" className="text-burgundy underline">Home</Link> / <Link to={catPath} className="text-burgundy underline">{p.category}</Link>
      </p>
      <div className="mt-4 grid gap-6 md:grid-cols-2">
        <ProductGallery images={p.images ?? (p.image ? [p.image] : [])} name={p.name} from={p.from} to={p.to} emoji={p.emoji} demo={!p.live}/>

        <div>
          <h1 className="text-3xl font-bold md:text-4xl">{p.name}</h1>
          {p.reviews > 0 && <p className="mt-1 text-sm text-neutral-500">★ {p.rating.toFixed(1)} · {p.reviews} reviews (demo)</p>}
          <p className="mt-3 flex items-baseline gap-3">
            <span className="text-3xl font-bold text-burgundy-700">{inr(p.salePrice ?? p.price)}</span>
            {p.salePrice && <><span className="text-neutral-400 line-through">{inr(p.price)}</span><span className="rounded-full bg-burgundy px-2 py-0.5 text-xs font-bold text-cream">{off}% OFF</span></>}
          </p>
          <p className="mt-1 text-xs text-neutral-500">Inclusive of taxes. Delivery ₹65 — free on orders of ₹699 and above.</p>
          <p className="mt-4 text-sm text-neutral-700">{describe(p)}</p>

          {p.lowStock && p.inStock !== false && <p role="status" className="mt-3 inline-block rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-800">🔥 Only {p.lowStock} left — order soon!</p>}

          {facts.length > 0 && (<section aria-labelledby="facts-h" className="mt-4 rounded-2xl border border-gold/30 bg-white p-3">
              <h2 id="facts-h" className="text-lg font-bold">Product details</h2>
              <dl className="mt-1 grid grid-cols-2 gap-x-4 text-sm sm:grid-cols-3">
                {facts.map(([k, v]) => (<div key={k} className="border-b border-gold/20 py-1.5">
                    <dt className="text-xs text-neutral-500">{k}</dt>
                    <dd className="font-semibold text-neutral-800">{v}</dd>
                  </div>))}
              </dl>
            </section>)}

          {p.live && p.inStock && <PincodeCheck productId={p.id}/>}

          {custom && (<div className="mt-4">
              <label htmlFor="note" className="label">Name / message to print *</label>
              <input id="note" maxLength={60} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Happy Birthday Riya" className="input"/>
              <p className="mt-1 text-xs text-neutral-500">{note.length}/60 characters</p>
            </div>)}

          <div className="mt-4 flex items-center gap-3">
            <div className="flex items-center rounded-lg border border-gold/40 bg-white">
              <button type="button" aria-label="Decrease quantity" className="px-3 py-2 text-lg" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
              <span className="w-8 text-center text-sm font-semibold" aria-live="polite">{qty}</span>
              <button type="button" aria-label="Increase quantity" className="px-3 py-2 text-lg" onClick={() => { if (qty >= maxQty && p.lowStock) notify.info(`Only ${p.lowStock} left in stock.`, { title: 'Almost gone!', emoji: '🙈' }); setQty((q) => Math.min(maxQty, q + 1)); }}>+</button>
            </div>
            {!user ? (<Link to={`/account?next=${encodeURIComponent(`/product/${p.slug}`)}`} className="btn-primary flex-1">Sign in to order</Link>) : p.inStock ? (<>
                <button type="button" className="btn-primary flex-1" onClick={() => add(false)}>{added ? 'Added ✓' : 'Add to cart'}</button>
                <button type="button" className="btn-gold flex-1" onClick={() => add(true)}>Buy now</button>
              </>) : (<p className="flex-1 rounded-lg bg-neutral-100 px-4 py-2.5 text-center text-sm font-semibold text-neutral-600">Out of stock</p>)}
          </div>
          {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
          {qty >= 20 && <p className="mt-2 text-xs text-neutral-500">Need more than 20? <Link to="/bulk-orders" className="underline">Request a bulk quotation</Link>.</p>}
        </div>
      </div>

      {related.length > 0 && (<section className="mt-10">
          <h2 className="mb-3 text-2xl font-bold">You may also like</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{related.map((r) => <ProductCard key={r.id} product={r}/>)}</div>
        </section>)}
    </div>);
}
