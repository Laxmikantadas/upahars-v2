import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Logo from './Logo';
import { useStore } from '../lib/store';
import { SoundToggle } from './Toaster';
export default function Header() {
    const [q, setQ] = useState('');
    const navigate = useNavigate();
    const { cartCount } = useStore();
    const onSearch = (e) => {
        e.preventDefault();
        const term = q.trim();
        if (term)
            navigate(`/search?q=${encodeURIComponent(term)}`);
    };
    return (<header className="sticky top-0 z-40 border-b border-gold/30 bg-cream/95 backdrop-blur">
      <div className="container-page flex items-center gap-3 py-2">
        <Logo />

        <form onSubmit={onSearch} role="search" className="flex-1">
          <label htmlFor="site-search" className="sr-only">Search Upahars</label>
          <input id="site-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search handmade gifts, candles, hampers…" className="w-full rounded-lg border border-gold/40 bg-white px-4 py-2.5 text-sm outline-none focus:border-burgundy focus:ring-1 focus:ring-burgundy"/>
        </form>

        <nav aria-label="Account and cart" className="hidden items-center gap-5 text-sm font-medium text-burgundy-700 md:flex">
          <Link to="/account" className="hover:text-gold-600">Account</Link>
          <Link to="/cart" className="hover:text-gold-600">Cart{cartCount > 0 && <span className="ml-1 rounded-full bg-burgundy px-1.5 py-0.5 text-[11px] text-cream">{cartCount}</span>}</Link>
        </nav>
        <SoundToggle className="shrink-0" />
      </div>
    </header>);
}
