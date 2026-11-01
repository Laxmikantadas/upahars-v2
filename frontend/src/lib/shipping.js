import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
/* ───────── courier (Shipex) helpers ───────── */
export const isPincode = (v) => /^[1-9]\d{5}$/.test(v);
const PIN_KEY = 'upahars_pincode';
/** Remember the customer's pincode between the product page and checkout (best effort: storage can be blocked). */
export const rememberPincode = (v) => { try {
    localStorage.setItem(PIN_KEY, v);
}
catch { /* ignore */ } };
export const recallPincode = () => { try {
    const v = localStorage.getItem(PIN_KEY) ?? '';
    return isPincode(v) ? v : '';
}
catch {
    return '';
} };
// Courier-side problems: we cannot say yes or no, but the shop still sells (the server only blocks a definite "cannot deliver").
const SOFT = new Set(['shipex_not_configured', 'shipex_token_expired', 'shipex_unreachable', 'shipex_rejected', 'no_pickup_pincode', 'network']);
/** items: [{ productId, variantId?, qty }] → { status: 'ok' | 'no' | 'unknown', message } */
export async function checkServiceability(items, deliveryPincode) {
    try {
        const body = { deliveryPincode, items: items.map((i) => ({ productId: i.productId, ...(i.variantId ? { variantId: i.variantId } : {}), qty: i.qty ?? 1 })) };
        const r = await api('/shipping/serviceability', { body });
        const why = r.shipments?.find((x) => !x.serviceable)?.message;
        return r.serviceable
            ? { status: 'ok', message: `Delivery is available to ${deliveryPincode}.` }
            : { status: 'no', message: `Sorry, we cannot deliver to ${deliveryPincode} yet.${why ? ` (${why})` : ''}` };
    }
    catch (e) {
        if (e instanceof ApiError && SOFT.has(e.code))
            return { status: 'unknown', message: `We could not confirm delivery to this pincode right now. You can still continue — we will confirm after you order. (${e.code}: ${e.message})` };
        if (e instanceof ApiError)
            return { status: 'error', message: e.message };
        return { status: 'error', message: 'Something went wrong. Please try again.' };
    }
}
export function formatCountdown(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const two = (n) => String(n).padStart(2, '0');
    return d > 0 ? `${d}d ${h}h ${two(m)}m` : `${h}h ${two(m)}m ${two(sec)}s`;
}
export const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
/**
 * Admin: the stored courier token's status with a live countdown.
 * The server sends its own clock, so the countdown is right even when this computer's clock is off.
 * Re-reads from the server every minute (and on refresh()), and flips to "expired" by itself the moment the countdown hits zero.
 */
export function useShippingToken() {
    const [raw, setRaw] = useState(null);
    const [error, setError] = useState('');
    const [now, setNow] = useState(Date.now());
    const refresh = useCallback(async () => {
        try {
            const r = await api('/admin/shipping/token');
            const offset = r.token.serverTime ? new Date(r.token.serverTime).getTime() - Date.now() : 0;
            setRaw({ token: r.token, offset });
            setError('');
        }
        catch (e) {
            setError(e instanceof ApiError ? e.message : 'Could not load the courier token status.');
        }
    }, []);
    useEffect(() => { void refresh(); const t = setInterval(() => void refresh(), 60_000); return () => clearInterval(t); }, [refresh]);
    const configured = Boolean(raw?.token.configured);
    useEffect(() => { if (!configured)
        return undefined; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [configured]);
    if (!raw)
        return { loading: !error, error, refresh, state: 'none', configured: false, secondsLeft: 0, token: null };
    const t = raw.token;
    if (!t.configured)
        return { loading: false, error, refresh, state: 'none', configured: false, secondsLeft: 0, token: t };
    const secondsLeft = Math.max(0, Math.floor((new Date(t.expiresAt).getTime() - (now + raw.offset)) / 1000));
    const state = t.expiredEarly || secondsLeft <= 30 ? 'expired' : secondsLeft <= t.warnSeconds ? 'expiring' : 'active';
    const total = Math.max(1, (new Date(t.expiresAt).getTime() - new Date(t.issuedAt).getTime()) / 1000);
    return { loading: false, error, refresh, state, configured: true, secondsLeft: state === 'expired' ? 0 : secondsLeft, token: t, percentLeft: state === 'expired' ? 0 : Math.min(100, (secondsLeft / total) * 100) };
}
export const STATE_STYLE = {
    active: { label: 'Active', chip: 'bg-green-100 text-green-800', bar: 'bg-green-500' },
    expiring: { label: 'Expiring soon', chip: 'bg-amber-100 text-amber-900', bar: 'bg-amber-500' },
    expired: { label: 'Expired', chip: 'bg-red-100 text-red-800', bar: 'bg-red-500' },
    none: { label: 'Not connected', chip: 'bg-neutral-200 text-neutral-700', bar: 'bg-neutral-400' },
};
