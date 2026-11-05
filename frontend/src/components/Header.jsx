import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Logo from './Logo';
import { useStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import { useLoginModal } from './LoginModal';
import { SoundToggle } from './Toaster';

/** Logged out → "Login" button (opens the modal). Logged in → "Hi, Name" dropdown. */
function AccountMenu() {
    const { status, user, isAdmin, logout } = useAuth();
    const { openLogin } = useLoginModal();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    useEffect(() => {
        if (!open) return;
        const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
    }, [open]);
    if (status === 'loading')
        return <span className="inline-block w-16" aria-hidden="true"/>;
    if (!user || !user.name)
        return <button type="button" onClick={() => openLogin()} className="rounded-lg bg-burgundy px-4 py-1.5 text-cream hover:bg-burgundy-700">Login</button>;
    const first = user.name.split(' ')[0];
    return (<div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 hover:text-gold-600">
        Hi, {first} <span aria-hidden="true" className="text-[10px]">▾</span>
      </button>
      {open && (<div role="menu" className="absolute right-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-xl border border-gold/30 bg-white py-1 text-sm shadow-lg">
          <Link role="menuitem" to="/account" onClick={() => setOpen(false)} className="block px-4 py-2 hover:bg-cream">My account &amp; orders</Link>
          {isAdmin && <Link role="menuitem" to="/admin" onClick={() => setOpen(false)} className="block px-4 py-2 hover:bg-cream">Admin panel</Link>}
          <button role="menuitem" type="button" onClick={() => { setOpen(false); void logout().then(() => navigate('/')); }} className="block w-full px-4 py-2 text-left hover:bg-cream">Sign out</button>
        </div>)}
    </div>);
}

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
          <AccountMenu />
          <Link to="/cart" className="hover:text-gold-600">Cart{cartCount > 0 && <span className="ml-1 rounded-full bg-burgundy px-1.5 py-0.5 text-[11px] text-cream">{cartCount}</span>}</Link>
        </nav>
        <SoundToggle className="shrink-0" />
      </div>
    </header>);
}