import { Link, useLocation } from 'react-router-dom';
import { useStore } from '../lib/store';
/** Shown instead of cart/checkout when the visitor has not signed in with a verified phone number. */
export default function SignInPrompt({ title = 'Sign in to order' }) {
    const { pathname } = useLocation();
    const { authLoading } = useStore();
    if (authLoading)
        return <div className="container-page max-w-md py-16 text-center text-sm text-neutral-600" role="status">Checking your session…</div>;
    return (<div className="container-page max-w-md py-16 text-center">
      <p className="text-5xl">🔐</p>
      <h1 className="mt-2 text-3xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-neutral-600">You can browse all products freely. To order, register or sign in with your mobile number and a one-time code.</p>
      <Link to={`/account?next=${encodeURIComponent(pathname)}`} className="btn-primary mt-5">Register / Sign in</Link>
    </div>);
}
