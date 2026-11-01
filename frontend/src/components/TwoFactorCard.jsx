import { useState } from 'react';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
/** Security box on the account page: turn two-factor (authenticator app) on/off and manage backup codes. */
export default function TwoFactorCard() {
    const { user, startTwoFactorSetup, enableTwoFactor, newBackupCodes, disableTwoFactor } = useAuth();
    const [view, setView] = useState('idle');
    const [setup, setSetup] = useState(null);
    const [codes, setCodes] = useState([]);
    const [code, setCode] = useState('');
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    if (!user)
        return null;
    const isAdmin = user.roles.includes('admin');
    const run = async (fn) => {
        setBusy(true);
        setErr('');
        try {
            await fn();
        }
        catch (x) {
            setErr(x instanceof ApiError ? x.message : 'Something went wrong. Please try again.');
        }
        finally {
            setBusy(false);
        }
    };
    const reset = () => { setView('idle'); setCode(''); setErr(''); setSetup(null); };
    const begin = () => run(async () => { setSetup(await startTwoFactorSetup()); setCode(''); setView('setup'); });
    const enable = (e) => { e.preventDefault(); void run(async () => { setCodes(await enableTwoFactor(code.trim())); setCode(''); setView('codes'); }); };
    const regen = (e) => { e.preventDefault(); void run(async () => { setCodes(await newBackupCodes(code.trim())); setCode(''); setView('codes'); }); };
    const off = (e) => { e.preventDefault(); void run(async () => { await disableTwoFactor(code.trim()); reset(); }); };
    const codeField = (label, hint) => (<div>
      <label htmlFor="tfc" className="label">{label}</label>
      <input id="tfc" value={code} onChange={(e) => setCode(e.target.value)} className="input text-center font-mono text-lg tracking-widest" inputMode="text" autoComplete="one-time-code" autoFocus maxLength={20}/>
      {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>);
    const error = err && <p role="alert" className="text-xs text-red-700">{err}</p>;
    return (<section className="card mt-6 space-y-3" aria-labelledby="tf-title">
      <div className="flex items-center justify-between gap-2">
        <h2 id="tf-title" className="text-2xl font-bold">Two-factor authentication</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${user.twoFactorEnabled ? 'bg-green-100 text-green-800' : 'bg-gold/20 text-burgundy-700'}`}>{user.twoFactorEnabled ? 'ON ✓' : 'OFF'}</span>
      </div>

      {user.twoFactorSetupRequired && view === 'idle' && (<p role="alert" className="rounded-lg bg-red-50 p-2 text-sm text-red-800">Administrators must turn on two-factor authentication before the admin panel can be used.</p>)}

      {view === 'idle' && !user.twoFactorEnabled && (<>
          <p className="text-sm text-neutral-600">Add a second lock. After the SMS code you will also enter a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, Authy…).</p>
          {error}
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void begin()}>{busy ? 'Please wait…' : 'Turn on two-factor'}</button>
        </>)}

      {view === 'setup' && setup && (<form onSubmit={enable} noValidate className="space-y-3">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-700">
            <li>Open your authenticator app and add a new account.</li>
            <li>On this phone tap <a className="font-semibold text-burgundy underline" href={setup.otpauthUri}>Open in authenticator app</a>, or type this key by hand (time-based):</li>
          </ol>
          <p className="break-all rounded-lg bg-cream-200/70 p-3 text-center font-mono text-base tracking-wider" data-testid="tf-secret">{setup.secret.match(/.{1,4}/g)?.join(' ')}</p>
          <p className="text-sm text-neutral-700">3. Enter the 6-digit code the app shows to finish.</p>
          {codeField('Code from the app')}
          {error}
          <div className="flex gap-2"><button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Verify & turn on'}</button><button type="button" className="btn-ghost" onClick={reset}>Cancel</button></div>
        </form>)}

      {view === 'codes' && (<div className="space-y-3">
          <p className="text-sm font-semibold">Save your backup codes now.</p>
          <p className="text-sm text-neutral-600">Each code works once if you lose your phone. They are shown only this one time — store them somewhere safe (not on the same phone).</p>
          <ul className="grid grid-cols-2 gap-2 rounded-lg bg-cream-200/70 p-3 font-mono text-sm" data-testid="tf-backup-codes">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={() => void navigator.clipboard?.writeText(codes.join('\n'))}>Copy codes</button>
            <button type="button" className="btn-primary" onClick={() => { setCodes([]); reset(); }}>I’ve saved them</button>
          </div>
        </div>)}

      {view === 'idle' && user.twoFactorEnabled && (<>
          <p className="text-sm text-neutral-600">Signing in needs your SMS code and a code from your authenticator app.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost" onClick={() => { setView('confirm-codes'); setCode(''); setErr(''); }}>New backup codes</button>
            {!isAdmin && <button type="button" className="btn-ghost" onClick={() => { setView('confirm-off'); setCode(''); setErr(''); }}>Turn off</button>}
          </div>
        </>)}

      {(view === 'confirm-off' || view === 'confirm-codes') && (<form onSubmit={view === 'confirm-off' ? off : regen} noValidate className="space-y-3">
          {codeField('Enter a code to confirm', 'Use the 6-digit app code or one of your backup codes.')}
          {error}
          <div className="flex gap-2"><button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Checking…' : view === 'confirm-off' ? 'Turn off two-factor' : 'Create new codes'}</button><button type="button" className="btn-ghost" onClick={reset}>Cancel</button></div>
        </form>)}
    </section>);
}
