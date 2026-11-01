import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { CATEGORY_ICONS, DEMO_PRODUCTS, DEMO_SPECS } from '../data/demo';
import { loadLiveCatalog, rupees } from './catalog';
import { computeTotals } from './pricing';
import { useAuth } from './auth';
import { notify } from './notify';
/* MVP store: everything lives in this browser's localStorage so the app works with no backend.
   Next phase: replace the functions below with calls to the backend API (see ../backend). */
const KEY = 'upahars_mvp_v1';
export const ORDER_STATUSES = ['placed', 'confirmed', 'shipped', 'delivered', 'cancelled'];
const EMPTY = { cart: [], coupon: '', giftWrap: false, orders: [], inquiries: [], overrides: {} };
function load() {
    try {
        const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
        return raw && typeof raw === 'object' ? { ...EMPTY, ...raw } : EMPTY;
    }
    catch {
        return EMPTY;
    }
}
export const newId = (prefix) => `${prefix}-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
/* ---------- demo data for testing ---------- */
export function demoOrders() {
    const day = 86400000;
    const mk = (n, daysAgo, status, name, phone, city, items, payment, coupon) => {
        const lines = items.map(([id, qty, note]) => {
            const p = DEMO_PRODUCTS.find((x) => x.id === id);
            return { productId: id, name: p.name, qty, unitPrice: p.salePrice ?? p.price, note };
        });
        return {
            id: `UPH-DEMO-${1000 + n}`,
            createdAt: new Date(Date.now() - daysAgo * day).toISOString(),
            phone, items: lines, totals: computeTotals(lines, coupon, false), payment, status,
            address: { name, phone, email: '', line: '12 Demo Street, Saheed Nagar', city, state: 'Odisha', pincode: '751007' },
        };
    };
    return [
        mk(1, 0, 'placed', 'Demo Customer A', '9111111111', 'Bhubaneswar', [['jasmine-candle', 2], ['terracotta-diya-set', 1]], 'demo-online'),
        mk(2, 1, 'confirmed', 'Demo Customer B', '9222222222', 'Cuttack', [['photo-frame', 1, 'Happy Anniversary Maa & Papa']], 'demo-online', 'DEMOFIRST100'),
        mk(3, 3, 'shipped', 'Demo Customer C', '9333333333', 'Pune', [['diwali-grand-hamper', 2]], 'demo-online', 'DEMODIWALI15'),
        mk(4, 6, 'delivered', 'Demo Customer D', '9444444444', 'Puri', [['jute-wall-hanging', 1], ['macrame-planter', 2]], 'demo-online'),
        mk(5, 8, 'cancelled', 'Demo Customer E', '9555555555', 'Rourkela', [['name-mug', 3, 'Team Alpha']], 'demo-online'),
    ];
}
export function demoInquiries() {
    const now = Date.now();
    return [
        { id: 'BULK-DEMO-1', createdAt: new Date(now - 86400000).toISOString(), name: 'Demo Corporate Ltd', phone: '9666666666', email: 'hr@demo-corp.example', product: 'Corporate Gift Box', quantity: 120, message: 'Need boxes with our logo before Diwali.', status: 'new' },
        { id: 'BULK-DEMO-2', createdAt: new Date(now - 4 * 86400000).toISOString(), name: 'Demo Wedding Planner', phone: '9777777777', email: '', product: 'Rose Floating Candles', quantity: 300, message: 'Wedding in December, Bhubaneswar.', status: 'quoted' },
    ];
}
const Ctx = createContext(null);
export function StoreProvider({ children }) {
    const auth = useAuth();
    const user = auth.user ? { name: auth.user.name, phone: auth.user.phone, isAdmin: auth.isAdmin } : null;
    const [data, setData] = useState(() => { const d = load(); delete d.user; delete d.users; return d; });
    useEffect(() => {
        try {
            localStorage.setItem(KEY, JSON.stringify(data));
        }
        catch { /* storage full/unavailable */ }
    }, [data]);
    const update = useCallback((fn) => setData((d) => fn(d)), []);
    const [live, setLive] = useState(null);
    const refreshCatalog = useCallback(async () => {
        try {
            setLive(await loadLiveCatalog());
        }
        catch { /* server unreachable: keep what we have (sample catalogue on first load) */ }
    }, []);
    useEffect(() => { void refreshCatalog(); }, [refreshCatalog]);
    const products = useMemo(() => live ? live.products : DEMO_PRODUCTS.map((p) => {
        const o = data.overrides[p.id] ?? {};
        return {
            ...p,
            specs: DEMO_SPECS[p.id],
            price: o.price ?? p.price,
            salePrice: o.salePrice === null ? undefined : o.salePrice ?? p.salePrice,
            inStock: o.inStock ?? true,
        };
    }), [data.overrides, live]);
    const categories = useMemo(() => live ? live.categories : Object.entries(CATEGORY_ICONS).map(([name, icon]) => ({ name, slug: name, icon })), [live]);
    const offerCoupons = useMemo(() => live?.offers.map((o) => ({
        code: o.code, kind: o.type, value: o.type === 'percent' ? o.value : rupees(o.value), minPurchase: rupees(o.minOrderPaise), label: o.title || o.description,
    })), [live]);
    const getProduct = useCallback((key) => products.find((p) => p.id === key || p.slug === key), [products]);
    const cart = useMemo(() => data.cart.flatMap((l) => {
        const product = products.find((p) => p.id === l.productId);
        return product ? [{ ...l, product, unitPrice: product.salePrice ?? product.price }] : [];
    }), [data.cart, products]);
    const totals = useMemo(() => {
        const t = computeTotals(cart, data.coupon, data.giftWrap, offerCoupons);
        // Private coupons are not listed here; the server checks them at checkout, so don't call them invalid in the cart.
        return live && t.couponError === 'Invalid coupon code' ? { ...t, couponError: undefined } : t;
    }, [cart, data.coupon, data.giftWrap, offerCoupons, live]);
    const value = {
        products, categories, offers: live?.offers ?? [], banners: live?.banners ?? [], showcase: live?.showcase ?? [], isLive: live !== null, refreshCatalog, getProduct, cart,
        cartCount: cart.reduce((s, l) => s + l.qty, 0),
        coupon: data.coupon, giftWrap: data.giftWrap, totals,
        addToCart: (productId, qty = 1, note) => {
            if (!user)
                return false; // only verified, signed-in users can order
            const prod = products.find((x) => x.id === productId);
            const nKey = `${productId}::${note?.trim() || ''}`;
            const already = data.cart.find((l) => l.key === nKey);
            if (already && already.qty >= 20)
                notify.info('You can order up to 20 of one item at a time.', { title: 'That\'s the max!', emoji: '🙈' });
            else
                notify.cart(`${prod?.name ?? 'Your item'} is in your cart.`);
            update((d) => {
                const n = note?.trim() || undefined;
                const key = `${productId}::${n ?? ''}`;
                const found = d.cart.find((l) => l.key === key);
                const cartNext = found
                    ? d.cart.map((l) => (l.key === key ? { ...l, qty: Math.min(20, l.qty + qty) } : l))
                    : [...d.cart, { key, productId, qty: Math.min(20, qty), note: n }];
                return { ...d, cart: cartNext };
            });
            return true;
        },
        setQty: (key, qty) => {
            if (qty > 20)
                notify.info('You can order up to 20 of one item at a time.', { title: 'That\'s the max!', emoji: '🙈' });
            update((d) => ({
                ...d, cart: d.cart.map((l) => (l.key === key ? { ...l, qty: Math.max(1, Math.min(20, qty)) } : l)),
            }));
        },
        removeLine: (key) => {
            const gone = data.cart.find((l) => l.key === key);
            const prod = gone && products.find((x) => x.id === gone.productId);
            notify.remove(`${prod?.name ?? 'Item'} was removed from your cart.`);
            update((d) => ({ ...d, cart: d.cart.filter((l) => l.key !== key) }));
        },
        setCoupon: (coupon) => update((d) => ({ ...d, coupon })),
        setGiftWrap: (giftWrap) => update((d) => ({ ...d, giftWrap })),
        user,
        authLoading: auth.status === 'loading',
        logout: auth.logout,
        orders: data.orders,
        placeOrder: (address, payment) => {
            if (!user || !cart.length)
                return null;
            const order = {
                id: newId('UPH'),
                createdAt: new Date().toISOString(),
                phone: user.phone, // the verified account number
                items: cart.map((l) => ({ productId: l.productId, name: l.product.name, qty: l.qty, unitPrice: l.unitPrice, note: l.note })),
                totals,
                address,
                payment,
                status: 'placed',
            };
            update((d) => ({ ...d, orders: [order, ...d.orders], cart: [], coupon: '', giftWrap: false }));
            notify.celebrate('Your order has been placed. Thank you!');
            return order;
        },
        clearCart: () => update((d) => ({ ...d, cart: [], coupon: '', giftWrap: false })),
        setOrderStatus: (id, status) => update((d) => ({ ...d, orders: d.orders.map((o) => (o.id === id ? { ...o, status } : o)) })),
        inquiries: data.inquiries,
        addInquiry: (i) => update((d) => ({
            ...d, inquiries: [{ ...i, id: newId('BULK'), createdAt: new Date().toISOString(), status: 'new' }, ...d.inquiries],
        })),
        setInquiryStatus: (id, status) => update((d) => ({ ...d, inquiries: d.inquiries.map((q) => (q.id === id ? { ...q, status } : q)) })),
        setOverride: (productId, o) => update((d) => ({ ...d, overrides: { ...d.overrides, [productId]: { ...d.overrides[productId], ...o } } })),
        seedDemo: () => update((d) => ({
            ...d,
            orders: [...demoOrders(), ...d.orders.filter((o) => !o.id.startsWith('UPH-DEMO-'))],
            inquiries: [...demoInquiries(), ...d.inquiries.filter((q) => !q.id.startsWith('BULK-DEMO-'))],
        })),
        resetAll: () => setData({ ...EMPTY }),
    };
    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useStore() {
    const s = useContext(Ctx);
    if (!s)
        throw new Error('useStore must be used inside <StoreProvider>');
    return s;
}
