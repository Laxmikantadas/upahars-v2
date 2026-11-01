import { useEffect, useState } from 'react';
import { checkServiceability, isPincode, recallPincode, rememberPincode } from '../lib/shipping';
/** "Check delivery" box for a product page. The server decides the answer from the courier; only the product id and pincode are sent. */
export default function PincodeCheck({ productId }) {
    const [pin, setPin] = useState(() => recallPincode());
    const [res, setRes] = useState(null); // { status: 'checking' | 'ok' | 'no' | 'unknown' | 'error', message }
    // a different product (or a new pincode) makes the old answer stale
    useEffect(() => { setRes(null); }, [productId, pin]);
    const run = async (e) => {
        e.preventDefault();
        if (!isPincode(pin) || res?.status === 'checking')
            return;
        setRes({ status: 'checking', message: 'Checking…' });
        const r = await checkServiceability([{ productId, qty: 1 }], pin);
        if (r.status === 'ok' || r.status === 'no')
            rememberPincode(pin);
        setRes(r);
    };
    const tone = { ok: 'text-green-700', no: 'text-red-700', unknown: 'text-amber-800', error: 'text-red-700', checking: 'text-neutral-600' };
    return (<form onSubmit={(e) => void run(e)} className="mt-4 rounded-xl border border-gold/40 bg-white p-3" aria-label="Check delivery to your pincode">
      <label htmlFor="pdp-pin" className="label">Check delivery</label>
      <div className="flex gap-2">
        <input id="pdp-pin" inputMode="numeric" autoComplete="postal-code" maxLength={6} placeholder="Enter 6-digit pincode" className="input" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))} aria-invalid={pin.length === 6 && !isPincode(pin)}/>
        <button type="submit" className="btn-ghost shrink-0 disabled:opacity-60" disabled={!isPincode(pin) || res?.status === 'checking'}>Check</button>
      </div>
      {pin.length === 6 && !isPincode(pin) && <p role="alert" className="mt-1 text-xs text-red-700">Enter a valid 6-digit pincode.</p>}
      {res && <p role={res.status === 'checking' ? 'status' : 'alert'} aria-live="polite" className={`mt-2 text-sm font-medium ${tone[res.status]}`}>{res.status === 'ok' ? '✓ ' : res.status === 'no' ? '✗ ' : ''}{res.message}</p>}
    </form>);
}
