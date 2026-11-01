import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import App from '../App';
import { AuthProvider } from '../lib/auth';
import { StoreProvider } from '../lib/store';
const html = (path) => renderToString(<StaticRouter location={path}><AuthProvider initial={{ status: 'anonymous', user: null }}><StoreProvider><App /></StoreProvider></AuthProvider></StaticRouter>);
describe('clean category route', () => {
    it('renders the category by clean URL', () => {
        const h = html('/category/decorative-and-scented-candles');
        expect(h).toContain('Decorative and Scented Candles');
        expect(h).toContain('Jasmine Soy Wax Jar Candle');
    });
    it('shows not found for an unknown category', () => { expect(html('/category/nope')).toContain('Page not found'); });
    it('product page shows breadcrumb with clean category link', () => { expect(html('/product/jasmine-candle')).toContain('/category/decorative-and-scented-candles'); });
});
