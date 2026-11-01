import { useState } from 'react';
import { useStore } from '../lib/store';
export default function BulkOrders() {
    const { addInquiry } = useStore();
    const [f, setF] = useState({ name: '', phone: '', email: '', product: '', quantity: '50', message: '' });
    const [err, setErr] = useState('');
    const [done, setDone] = useState(false);
    const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
    const submit = (e) => {
        e.preventDefault();
        const q = Number(f.quantity);
        if (f.name.trim().length < 2)
            return setErr('Enter your name or company');
        if (!/^[6-9]\d{9}$/.test(f.phone))
            return setErr('Enter a valid 10-digit mobile number');
        if (!Number.isInteger(q) || q < 10)
            return setErr('Minimum bulk quantity is 10');
        if (!f.product.trim())
            return setErr('Tell us what you need (e.g. candles, gift boxes)');
        setErr('');
        addInquiry({ name: f.name.trim(), phone: f.phone, email: f.email.trim(), product: f.product.trim(), quantity: q, message: f.message.trim() });
        setDone(true);
    };
    if (done)
        return <div className="container-page max-w-lg py-16 text-center"><p className="text-5xl">📨</p><h1 className="text-3xl font-bold">Request received</h1><p className="mt-2 text-neutral-600">Our team will send you a quotation. (Demo mode: saved in this browser; view it in Admin → Inquiries.)</p></div>;
    return (<div className="container-page max-w-xl py-8">
      <h1 className="text-3xl font-bold">Bulk &amp; corporate quotation</h1>
      <p className="mt-1 text-sm text-neutral-600">Candles, gift boxes and hampers by the hundred — with custom branding.</p>
      <form onSubmit={submit} noValidate className="card mt-4 grid gap-3 sm:grid-cols-2">
        <div><label htmlFor="b1" className="label">Name / company *</label><input id="b1" className="input" value={f.name} onChange={set('name')}/></div>
        <div><label htmlFor="b2" className="label">Mobile *</label><input id="b2" className="input" inputMode="numeric" maxLength={10} value={f.phone} onChange={set('phone')}/></div>
        <div><label htmlFor="b3" className="label">Email</label><input id="b3" type="email" className="input" value={f.email} onChange={set('email')}/></div>
        <div><label htmlFor="b4" className="label">Quantity *</label><input id="b4" type="number" min={10} className="input" value={f.quantity} onChange={set('quantity')}/></div>
        <div className="sm:col-span-2"><label htmlFor="b5" className="label">What do you need? *</label><input id="b5" className="input" placeholder="e.g. Jasmine candles with our logo" value={f.product} onChange={set('product')}/></div>
        <div className="sm:col-span-2"><label htmlFor="b6" className="label">Details / event date</label><textarea id="b6" rows={3} className="input" value={f.message} onChange={set('message')}/></div>
        {err && <p role="alert" className="text-xs text-red-700 sm:col-span-2">{err}</p>}
        <button className="btn-primary sm:col-span-2" type="submit">Request quotation</button>
      </form>
    </div>);
}
