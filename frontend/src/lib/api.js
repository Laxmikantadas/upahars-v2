// Tiny fetch wrapper for the Upahars API.
// - Always sends the session cookie (credentials: 'include').
// - In development the Vite server forwards /api/* to the backend (see vite.config.js).
// - In production set VITE_API_BASE to the API origin (e.g. https://api.upahars.in) — or serve both from one domain.
const BASE = (import.meta.env?.VITE_API_BASE ?? '').replace(/\/$/, '');
export class ApiError extends Error {
    constructor(status, code, message) {
        super(message);
        this.status = status;
        this.code = code;
    }
}
export async function api(path, opts = {}) {
    let res;
    try {
        res = await fetch(`${BASE}/api${path}`, {
            method: opts.method ?? (opts.body ? 'POST' : 'GET'),
            credentials: 'include',
            headers: { ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers ?? {}) },
            body: opts.body ? JSON.stringify(opts.body) : undefined,
        });
    }
    catch {
        throw new ApiError(0, 'network', 'Cannot reach the server. Check your connection and try again.');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const e = data.error;
        throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? 'Something went wrong. Please try again.');
    }
    return data;
}
