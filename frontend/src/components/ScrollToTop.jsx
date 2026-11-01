import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
/** Scrolls to the top on every route change (but keeps back/forward position and #anchors). */
export default function ScrollToTop() {
    const { pathname, search, hash } = useLocation();
    const navType = useNavigationType();
    useEffect(() => {
        if (hash) {
            const el = document.getElementById(hash.slice(1));
            if (el) {
                el.scrollIntoView();
                return;
            }
        }
        if (navType === 'POP')
            return; // browser back/forward: let browser restore position
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }, [pathname, search, hash, navType]);
    return null;
}
