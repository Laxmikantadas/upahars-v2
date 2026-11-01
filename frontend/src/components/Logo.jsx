import { Link } from 'react-router-dom';
import { BRAND } from '../lib/brand';
/** Emblem + lettering, both as images (no text), on a transparent background. */
export default function Logo({ size = 'sm' }) {
    const iconH = size === 'sm' ? 'h-10 md:h-12' : 'h-14';
    const wordH = size === 'sm' ? 'h-4 md:h-5' : 'h-6';
    return (<Link to="/" aria-label={`${BRAND.name} home`} className="flex shrink-0 items-center gap-2">
      <img src={BRAND.icon} alt="" className={`${iconH} w-auto`}/>
      <img src={BRAND.wordmark} alt={BRAND.name} className={`${wordH} hidden w-auto sm:block`}/>
    </Link>);
}
