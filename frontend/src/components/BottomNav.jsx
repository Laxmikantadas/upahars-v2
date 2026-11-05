import { NavLink } from 'react-router-dom';
import { useStore } from '../lib/store';
import { useAuth } from '../lib/auth';
import { useLoginModal } from './LoginModal';
const items = [
    { to: '/', label: 'Home', end: true, d: 'M3 11l9-8 9 8v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1v-9z' },
    { to: '/categories', label: 'Categories', d: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z' },
    { to: '/search', label: 'Search', d: 'M11 4a7 7 0 105 12l4 4 1.5-1.5-4-4A7 7 0 0011 4z' },
    { to: '/cart', label: 'Cart', d: 'M3 4h2l2.4 11h10.2L20 7H6.2M9 20a1 1 0 100-2 1 1 0 000 2zm9 0a1 1 0 100-2 1 1 0 000 2z' },
    { to: '/account', label: 'Account', d: 'M12 12a4 4 0 100-8 4 4 0 000 8zm-8 9a8 8 0 0116 0z' },
];
export default function BottomNav() {
    const { cartCount } = useStore();
    const { user } = useAuth();
    const { openLogin } = useLoginModal();
    const loggedIn = Boolean(user?.name);
    const iconClass = 'flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium';
    return (<nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 border-t border-gold/40 bg-cream md:hidden" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <ul className="grid grid-cols-5">
        {items.map((it) => (<li key={it.label}>
            {it.label === 'Account' && !loggedIn ? (<button type="button" onClick={() => openLogin()} className={`${iconClass} w-full text-neutral-500`}>
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={it.d}/></svg>
                Login
              </button>) : (<NavLink to={it.to} end={it.end} className={({ isActive }) => `flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${isActive ? 'text-burgundy' : 'text-neutral-500'}`}>
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={it.d}/>
              </svg>
              {it.label}{it.label === 'Cart' && cartCount > 0 ? ` (${cartCount})` : ''}
            </NavLink>)}
          </li>))}
      </ul>
    </nav>);
}