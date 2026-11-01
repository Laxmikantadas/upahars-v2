import { afterEach, describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import App from '../App';
import { AuthProvider } from '../lib/auth';
import { demoInquiries, demoOrders, StoreProvider } from '../lib/store';
const ADMIN = { id: 'a1', phone: '9000000000', name: 'Admin', email: '', roles: ['customer', 'admin'], twoFactorEnabled: true, twoFactorSetupRequired: false, seller: null };
const CUSTOMER = { id: 'c1', phone: '9111111111', name: 'Asha', email: '', roles: ['customer'], twoFactorEnabled: false, twoFactorSetupRequired: false, seller: null };
// The site is login-first: pages render for a signed-in customer unless told otherwise (the real app asks the backend /api/me).
const render = (path, user = CUSTOMER) => renderToString(<StaticRouter location={path}>
      <AuthProvider initial={{ status: user ? 'signedIn' : 'anonymous', user }}>
        <StoreProvider><App /></StoreProvider>
      </AuthProvider>
    </StaticRouter>);
// Smoke test: every route renders without throwing and shows its heading.
const cases = [
    ['/', 'Shop by Category'],
    ['/', 'Little Moments, Handmade'],
    ['/', 'Moments from Upahars'],
    ['/categories', 'Shop by Category'],
    ['/categories?name=Decorative%20and%20Scented%20Candles', 'Jasmine Soy Wax Jar Candle'],
    ['/search?q=candle', 'Results for'],
    ['/search?q=Birthday', 'Gift ideas for'],
    ['/search?q=zzzz', 'No products found'],
    ['/product/jasmine-candle', 'Jasmine Soy Wax Jar Candle'],
    ['/product/photo-frame', 'Name / message to print'],
    ['/product/does-not-exist', 'Product not found'],
    ['/cart', 'Your cart is empty'],
    ['/checkout', 'Nothing to check out'],
    ['/order/UPH-NOPE', 'Loading your order'],
    ['/account', 'Hello, Asha'],
    ['/bulk-orders', 'Bulk'],
    ['/admin/login', 'Admin login'],
    ['/about', 'About Upahars'],
    ['/faq', 'FAQ'],
    ['/terms-and-conditions', 'Terms'],
    ['/nope', 'Page not found'],
];
describe('routes', () => {
    it.each(cases)('%s renders', (path, text) => {
        expect(render(path)).toContain(text);
    });
});
// Browse freely; login/registration is required to buy or to see orders.
describe('login gate (visitors)', () => {
    it.each(['/', '/categories', '/product/jasmine-candle', '/bulk-orders', '/about'])('%s can be browsed without an account', (path) => {
        const h = render(path, null);
        expect(h).not.toContain('Send code');
    });
    it.each([['/cart', 'Sign in to view your cart'], ['/checkout', 'Sign in to check out']])('%s asks visitors to register / sign in', (path, text) => {
        const h = render(path, null);
        expect(h).toContain(text);
        expect(h).toContain('Register / Sign in');
    });
    it('a visitor cannot buy from a product page without signing in', () => {
        expect(render('/product/jasmine-candle', null)).toContain('Sign in to order');
    });
    it('order pages show the register / sign-in screen to visitors', () => {
        const h = render('/order/UPH-1', null);
        expect(h).toContain('Register / Sign in');
        expect(h).toContain('Send code');
    });
    it('a new account must finish with a name before viewing orders', () => {
        const h = render('/order/UPH-1', { ...CUSTOMER, name: '' });
        expect(h).toContain('Finish registration');
    });
});
// Admin pages: render as a signed-in admin with the sample data loaded.
describe('admin panel (signed in as admin)', () => {
    const g = globalThis;
    afterEach(() => { delete g.localStorage; });
    const asAdmin = () => {
        const data = JSON.stringify({
            orders: demoOrders(),
            inquiries: demoInquiries(),
        });
        g.localStorage = { getItem: () => data, setItem: () => undefined };
    };
    const adminCases = [
        ['/admin', 'Revenue — last 7 days'],
        ['/admin/orders', 'UPH-DEMO-1001'],
        ['/admin/orders/UPH-DEMO-1003', 'Order progress'],
        ['/admin/orders/NOPE', 'Order not found'],
        ['/admin/products', 'Products'],
        ['/admin/offers', 'Coupons and home-page banners'],
        ['/admin/carousel', 'Home carousel'],
        ['/admin/customers', 'Demo Customer A'],
        ['/admin/inquiries', 'Demo Corporate Ltd'],
        ['/admin/demo', 'Test coupons'],
    ];
    it.each(adminCases)('%s renders with a sidebar', (path, text) => {
        asAdmin();
        const html = render(path, ADMIN);
        expect(html).toContain(text);
        expect(html).toContain('Admin sidebar');
        expect(html).not.toContain('Search Upahars'); // no storefront header inside admin
    });
    it('blocks signed-in customers who are not admins', () => {
        asAdmin();
        // not an admin: the panel never renders (the guard redirects to /admin/login)
        const h = render('/admin/orders', { ...ADMIN, roles: ['customer'] });
        expect(h).not.toContain('Admin sidebar');
        expect(h).not.toContain('UPH-DEMO-1001');
    });
    it('asks administrators without two-factor to set it up first', () => {
        asAdmin();
        const h = render('/admin', { ...ADMIN, twoFactorEnabled: false, twoFactorSetupRequired: true });
        expect(h).toContain('Two-factor required');
        expect(h).not.toContain('Revenue — last 7 days');
    });
    it('blocks non-admin visitors', () => {
        const h = render('/admin/orders', null);
        expect(h).not.toContain('Admin sidebar');
        expect(h).not.toContain('UPH-DEMO-1001');
    });
    it('shows the separate admin login page, with no customer sign-up and no storefront header', () => {
        const h = render('/admin/login', null);
        expect(h).toContain('Admin login');
        expect(h).toContain('Admin mobile number');
        expect(h).not.toContain('Search Upahars');
    });
    it('sends an already signed-in admin from /admin/login straight into the panel', () => {
        const h = render('/admin/login', ADMIN);
        expect(h).not.toContain('Admin mobile number');
    });
});
