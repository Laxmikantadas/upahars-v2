import { Link, useLocation } from 'react-router-dom';
import { useSeo } from '../components/Seo';
// Used for unknown routes / missing products.
export default function ComingSoon({ notFound = false }) {
    const { pathname } = useLocation();
    useSeo({ title: notFound ? 'Product not found' : 'Page not found', noindex: true });
    return (<div className="container-page py-16 text-center">
      <h1 className="text-3xl font-bold">{notFound ? 'Product not found' : 'Page not found'}</h1>
      <p className="mt-2 text-neutral-600"><code>{pathname}</code> does not exist in this build.</p>
      <Link to="/" className="btn-primary mt-5">Back to home</Link>
    </div>);
}
