import { useLocation } from 'react-router-dom';
import Account from '../pages/Account';
import { useAuth } from '../lib/auth';
/** Only these areas need an account. Everything else (home, shop, product pages, policies) can be browsed by anyone;
 *  login/registration is asked for when the visitor tries to buy (product page, cart and checkout all prompt for it). */
export const PROTECTED_PREFIXES = ['/order/'];
/** Visitors who open a protected page see the register / sign-in screen (in place, same URL) until signed in; then the page they asked for appears. */
export default function LoginGate({ children }) {
    const { status, user } = useAuth();
    const { pathname, search } = useLocation();
    if (!PROTECTED_PREFIXES.some((p) => pathname.startsWith(p)))
        return <>{children}</>;
    if (status === 'loading')
        return <div className="container-page max-w-md py-16 text-center text-sm text-neutral-600" role="status">Checking your session…</div>;
    if (status === 'anonymous' || !user || !user.name)
        return <Account nextPath={pathname === '/account' ? undefined : pathname + search}/>;
    return <>{children}</>;
}
