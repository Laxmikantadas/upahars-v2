import { useMemo, useState } from 'react';
import CategoryAvatar from '../components/CategoryAvatar';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import ProductCard from '../components/ProductCard';
import { OCCASIONS } from '../data/demo';
import { useStore } from '../lib/store';
import { useSeo } from '../components/Seo';
import { breadcrumbSchema, categoryPath, clip, collectionSchema, findCategory } from '../lib/seo';
import ComingSoon from './ComingSoon';
const price = (p) => p.salePrice ?? p.price;
function Grid({ items }) {
    const [sort, setSort] = useState('relevance');
    const sorted = useMemo(() => {
        const a = [...items];
        if (sort === 'low')
            a.sort((x, y) => price(x) - price(y));
        if (sort === 'high')
            a.sort((x, y) => price(y) - price(x));
        if (sort === 'rating')
            a.sort((x, y) => y.rating - x.rating);
        return a;
    }, [items, sort]);
    if (!items.length) {
        return <p className="card text-center text-sm text-neutral-600">No products found. Try another search or <Link className="font-semibold text-burgundy underline" to="/categories">browse categories</Link>.</p>;
    }
    return (<>
      <div className="mb-3 flex items-center justify-between text-sm">
        <span className="text-neutral-600">{items.length} product{items.length === 1 ? '' : 's'}</span>
        <label className="flex items-center gap-2">
          <span className="text-neutral-600">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-lg border border-gold/40 bg-white px-2 py-1.5">
            <option value="relevance">Featured</option>
            <option value="low">Price: low to high</option>
            <option value="high">Price: high to low</option>
            <option value="rating">Top rated</option>
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-5">
        {sorted.map((p) => <ProductCard key={p.id} product={p}/>)}
      </div>
    </>);
}
export default function Shop() {
    const { products, categories } = useStore();
    const { pathname } = useLocation();
    const { slug } = useParams();
    const [params] = useSearchParams();
    const isSearch = pathname === '/search';
    const q = (params.get('q') ?? '').trim();
    const legacyName = params.get('name'); // old links: /categories?name=Customized%20Gifts
    const wanted = slug ?? legacyName;
    const cat = wanted ? findCategory(categories, wanted) : undefined;
    const catName = cat?.name ?? (legacyName && !slug ? legacyName : null);
    const catItems = catName ? products.filter((p) => p.category === catName) : [];
    const catPath = cat ? categoryPath(cat) : '/categories';

    /* ---- SEO: one call per page; search results and unknown categories are kept out of Google ---- */
    let seo;
    if (isSearch)
        seo = { title: q ? `Search results for “${q}”` : 'All products', noindex: true };
    else if (wanted && !catName)
        seo = { title: 'Category not found', noindex: true };
    else if (catName) {
        const description = clip(cat?.description || `Buy ${catName} online from Upahars: handmade, customizable gifts made by Odisha artisans${catItems.length ? `. Choose from ${catItems.length} product${catItems.length === 1 ? '' : 's'}` : ''}. Delivery across India.`, 158);
        seo = {
            title: `${catName}: Buy Handmade Gifts Online`, description, path: catPath, image: cat?.image || catItems.find((p) => p.image)?.image,
            schema: [breadcrumbSchema([{ name: 'Home', path: '/' }, { name: 'Categories', path: '/categories' }, { name: catName, path: catPath }]), collectionSchema({ name: catName, description, path: catPath, products: catItems })],
        };
    }
    else
        seo = { title: 'Shop Handmade Gifts by Category', description: 'Browse handmade décor, scented candles, customized gifts, festive hampers and eco-friendly gifts from Odisha artisans. Delivery across India.', path: '/categories' };
    useSeo(seo);

    if (isSearch) {
        const ql = q.toLowerCase();
        const occasion = OCCASIONS.find((o) => o.name.toLowerCase() === ql);
        let items = products;
        if (occasion)
            items = products.filter((p) => p.tags.includes('custom') || p.tags.includes('hamper'));
        else if (ql === 'best')
            items = products.filter((p) => p.tags.includes('best'));
        else if (ql)
            items = products.filter((p) => `${p.name} ${p.category} ${p.tags.join(' ')}`.toLowerCase().includes(ql));
        return (<div className="container-page py-6">
        <h1 className="text-3xl font-bold">{q ? `Results for “${q}”` : 'All products'}</h1>
        {occasion && <p className="mb-3 text-sm text-neutral-600">Gift ideas for {occasion.name} — customized gifts and hampers.</p>}
        <div className="mt-4"><Grid items={items}/></div>
      </div>);
    }
    if (wanted && !catName)
        return <ComingSoon />;
    if (catName) {
        return (<div className="container-page py-6">
        <nav aria-label="Breadcrumb" className="text-sm"><Link to="/" className="text-burgundy underline">Home</Link> / <Link to="/categories" className="text-burgundy underline">All categories</Link></nav>
        <h1 className="text-3xl font-bold">{catName}</h1>
        {cat?.description && <p className="mt-1 max-w-3xl text-sm text-neutral-700">{cat.description}</p>}
        {catName.includes('Bulk') && <p className="mt-1 text-sm text-neutral-600">Need large quantities? <Link className="font-semibold text-burgundy underline" to="/bulk-orders">Request a quotation</Link>.</p>}
        <div className="mt-4"><Grid items={catItems}/></div>
      </div>);
    }
    return (<div className="container-page py-6">
      <h1 className="text-3xl font-bold">Shop by Category</h1>
      <ul className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        {categories.map((c) => (<li key={c.name}>
            <Link to={categoryPath(c)} className="card flex items-center gap-3 transition hover:-translate-y-0.5 hover:shadow-md">
              <CategoryAvatar image={c.image} icon={c.icon} name={c.name} className="h-14 w-14" text="text-2xl"/>
              <span>
                <span className="block text-sm font-semibold text-burgundy-700">{c.name}</span>
                <span className="text-xs text-neutral-500">{products.filter((p) => p.category === c.name).length} products</span>
              </span>
            </Link>
          </li>))}
      </ul>
    </div>);
}
