import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router-dom';
import { BRAND } from '../../lib/brand';
import { useAuth } from '../../lib/auth';
import { useStore } from '../../lib/store';
import { formatCountdown, STATE_STYLE, useShippingToken } from '../../lib/shipping';
const NAV = [
    { to: '/admin', label: 'Dashboard', end: true, d: 'M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10' },
    { to: '/admin/orders', label: 'Orders', d: 'M6 2h12l2 4v14a1 1 0 01-1 1H5a1 1 0 01-1-1V6zM4 6h16M9 10a3 3 0 006 0' },
    { to: '/admin/products', label: 'Products', d: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8' },
    { to: '/admin/categories', label: 'Categories', d: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM17 13a3.5 3.5 0 100 7 3.5 3.5 0 000-7z' },
    { to: '/admin/carousel', label: 'Home carousel', d: 'M3 7h18v10H3zM7 7l-2-3M17 7l2-3M8 12a2 2 0 104 0 2 2 0 00-4 0M3 17l5-4 4 3 3-2 6 4' },
    { to: '/admin/shipping', label: 'Shipping', d: 'M3 7h11v9H3zM14 10h4l3 3v3h-7zM7 19a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z' },
    { to: '/admin/offers', label: 'Offers', d: 'M20 12l-8 8-9-9V3h8zM7.5 7.5h.01' },
    { to: '/admin/customers', label: 'Customers', d: 'M16 11a4 4 0 10-8 0 4 4 0 008 0zM4 21a8 8 0 0116 0' },
    { to: '/admin/inquiries', label: 'Bulk inquiries', d: 'M4 4h16v12H8l-4 4zM8 9h8M8 12h5' },
    { to: '/admin/demo', label: 'Demo data', d: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6' },
];
/** Header chip: courier token state + live countdown, on every admin page. Click = go to the Shipping page. */
function CourierChip() {
    const s = useShippingToken();
    if (s.loading || s.error)
        return null;
    const st = STATE_STYLE[s.state];
    const text = s.state === 'none' ? 'Courier: not connected' : s.state === 'expired' ? 'Courier token expired' : `Courier token · ${formatCountdown(s.secondsLeft)} left`;
    return (<Link to="/admin/shipping" title="Courier (Shipex) token" className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold tabular-nums ${st.chip}`}>{text}</Link>);
}
/** Red/amber bar under the header when the courier token needs attention (hidden on the Shipping page itself). */
function CourierBanner() {
    const s = useShippingToken();
    const { pathname } = useLocation();
    if (s.loading || s.error || pathname.startsWith('/admin/shipping') || !['expired', 'expiring', 'none'].includes(s.state))
        return null;
    const text = s.state === 'expired' ? 'The courier token has expired — delivery pincode checks are not working.'
        : s.state === 'expiring' ? `The courier token expires in ${formatCountdown(s.secondsLeft)}.`
            : 'The courier (Shipex) is not connected — delivery pincode checks are off.';
    return (<div role="alert" className={`flex flex-wrap items-center gap-2 px-4 py-2 text-sm ${s.state === 'expiring' ? 'bg-amber-100 text-amber-900' : 'bg-red-100 text-red-800'}`}>
      <span className="font-medium">{text}</span>
      <Link to="/admin/shipping" className="font-semibold underline">{s.state === 'none' ? 'Connect now' : 'Generate a new token'}</Link>
    </div>);
}
export default function AdminLayout() {
    const { user, authLoading, logout, orders, inquiries, isLive } = useStore();
    const { pathname } = useLocation();
    const auth = useAuth();
    const [open, setOpen] = useState(false);
    useEffect(() => setOpen(false), [pathname]);
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape')
            setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);
    if (authLoading)
        return <div className="container-page max-w-md py-16 text-center text-sm text-neutral-600" role="status">Checking your session…</div>;
    // This only decides what to SHOW. The real protection is on the server: every /api/admin/* call re-checks the admin role.
    if (!user?.isAdmin)
        return <Navigate to="/admin/login" replace state={{ from: pathname }}/>;
    // Administrators must switch on two-factor first (the server enforces this too and refuses every /api/admin call until then).
    if (auth.user?.twoFactorSetupRequired) {
        return (<div className="container-page max-w-md py-16 text-center">
        <h1 className="text-3xl font-bold">Two-factor required</h1>
        <p className="mt-2 text-sm text-neutral-600">For safety, administrators must turn on two-factor authentication before using the admin panel. It takes a minute.</p>
        <Link to="/account" className="btn-primary mt-5">Set up two-factor</Link>
      </div>);
    }
    const badge = {
        '/admin/orders': orders.filter((o) => o.status === 'placed').length,
        '/admin/inquiries': inquiries.filter((q) => q.status === 'new').length,
    };
    const current = NAV.find((n) => (n.end ? pathname === n.to : pathname.startsWith(n.to)))?.label ?? 'Admin';
    return (<div className="min-h-screen bg-cream-100 text-neutral-800">
      {open && <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setOpen(false)} aria-hidden="true"/>}

      <aside id="admin-sidebar" aria-label="Admin sidebar" className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-burgundy-800 text-cream transition-transform duration-200 md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-2 border-b border-gold/30 px-4 py-4">
          <img src={BRAND.icon} alt="" className="h-10 w-auto"/>
          <div className="leading-tight"><p className="font-display text-xl font-bold text-gold-300">{BRAND.name}</p><p className="text-xs text-cream/70">Admin panel</p></div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Admin sections">
          {NAV.map((n) => (<NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${isActive ? 'bg-gold/20 text-gold-300 ring-1 ring-gold/40' : 'text-cream/85 hover:bg-white/10'}`}>
              <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={n.d}/></svg>
              <span className="flex-1">{n.label}</span>
              {badge[n.to] > 0 && <span className="rounded-full bg-gold px-2 py-0.5 text-[11px] font-bold text-burgundy-800" aria-label={`${badge[n.to]} new`}>{badge[n.to]}</span>}
            </NavLink>))}
        </nav>

        <div className="space-y-2 border-t border-gold/30 p-4 text-sm">
          <p className="truncate font-semibold">{user.name}</p>
          <p className="text-xs text-cream/70">{user.phone} · Administrator</p>
          <div className="flex gap-2 pt-1">
            <Link to="/" className="flex-1 rounded-lg border border-cream/40 px-3 py-1.5 text-center text-xs font-semibold hover:bg-white/10">View store</Link>
            <button type="button" onClick={() => void logout()} className="flex-1 rounded-lg bg-gold px-3 py-1.5 text-xs font-semibold text-burgundy-800 hover:bg-gold-400">Sign out</button>
          </div>
        </div>
      </aside>

      <div className="md:pl-64">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-gold/30 bg-cream/95 px-4 py-3 backdrop-blur">
          <button type="button" className="rounded-lg border border-gold/40 p-2 md:hidden" aria-label="Open menu" aria-expanded={open} aria-controls="admin-sidebar" onClick={() => setOpen(true)}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
          <p className="font-semibold text-burgundy-700">{current}</p>
          <span className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <CourierChip />
            <span className="rounded-full bg-gold/20 px-2.5 py-0.5 text-[11px] font-semibold text-burgundy-700">{isLive ? 'Live catalogue' : 'Server not connected'}</span>
          </span>
        </header>
        <CourierBanner />
        <main className="p-4 md:p-6"><Outlet /></main>
      </div>
    </div>);
}
