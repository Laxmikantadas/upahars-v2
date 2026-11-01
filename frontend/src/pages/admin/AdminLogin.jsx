import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../../lib/api';
import { isValidPhone, useAuth } from '../../lib/auth';
import { BRAND } from '../../lib/brand';
const RESEND_SECONDS = 30;
/** Separate sign-in for administrators at /admin/login. Only administrator numbers receive a code here;
 *  customers cannot register through this page (they use /account). */
export default function AdminLogin() {
    const { status, user, isAdmin, requestAdminOtp, verifyAdminOtp, verifyTwoFactor, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const from = location.state?.from;
    const dest = from && from.startsWith('/admin') && from !== '/admin/login' ? from : '/admin';
    const [step, setStep] = useState('phone');
    const [phone, setPhone] = useState('');
    const [code, setCode] = useState('');
    const [challenge, setChallenge] = useState('');
    const [mfaCode, setMfaCode] = useState('');
    const [devCode, setDevCode] = useState('');
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    const [cooldown, setCooldown] = useState(0);
    const codeRef = useRef(null);
    useEffect(() => {
        if (cooldown <= 0)
            return;
        const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
        return () => clearTimeout(t);
    }, [cooldown]);
    useEffect(() => { if (step !== 'phone')
        codeRef.current?.focus(); }, [step]);
    const fail = (e) => setErr(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    const sendCode = async (e) => {
        e?.preventDefault();
        if (!isValidPhone(phone))
            return setErr('Enter a valid 10-digit mobile number');
        setBusy(true);
        setErr('');
        try {
            const r = await requestAdminOtp(phone);
            setCode('');
            setDevCode(r.devCode ?? '');
            setStep('otp');
            setCooldown(RESEND_SECONDS);
        }
        catch (x) {
            fail(x);
            if (x instanceof ApiError && x.code === 'otp_too_soon')
                setStep('otp');
        }
        finally {
            setBusy(false);
        }
    };
    const verify = async (e) => {
        e.preventDefault();
        if (!/^\d{4,8}$/.test(code))
            return setErr('Enter the code from the SMS');
        setBusy(true);
        setErr('');
        try {
            const r = await verifyAdminOtp(phone, code);
            if (r.kind === 'twoFactor') {
                setChallenge(r.challenge);
                setMfaCode('');
                setStep('mfa');
            }
        }
        catch (x) {
            fail(x);
        }
        finally {
            setBusy(false);
        }
    };
    const verifyMfa = async (e) => {
        e.preventDefault();
        if (mfaCode.trim().length < 6)
            return setErr('Enter the 6-digit code from your authenticator app');
        setBusy(true);
        setErr('');
        try {
            await verifyTwoFactor(challenge, mfaCode.trim());
        }
        catch (x) {
            fail(x);
            if (x instanceof ApiError && x.code === 'challenge_expired') {
                setStep('phone');
                setCode('');
            }
        }
        finally {
            setBusy(false);
        }
    };
    if (status === 'loading')
        return <div className="container-page max-w-md py-16 text-center text-sm text-neutral-600" role="status">Checking your session…</div>;
    // already an administrator: straight into the panel
    if (isAdmin)
        return <Navigate to={dest} replace/>;
    return (<div className="min-h-screen bg-cream-100 px-4 py-12">
      <div className="mx-auto max-w-md">
        <div className="flex items-center justify-center gap-2">
          <img src={BRAND.icon} alt="" className="h-12 w-auto"/>
          <div className="leading-tight"><p className="font-display text-2xl font-bold text-burgundy-800">{BRAND.name}</p><p className="text-xs text-neutral-600">Admin sign-in</p></div>
        </div>

        {user && !isAdmin && (<p role="alert" className="mt-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            You are signed in as {user.phone}, which is not an administrator account.{' '}
            <button type="button" className="underline" onClick={() => void logout()}>Sign out</button> and use an admin number.
          </p>)}

        {step === 'mfa' ? (<form onSubmit={verifyMfa} noValidate className="card mt-6 space-y-3">
            <p className="text-sm">Number <b>+91 {phone}</b> verified. Enter the 6-digit code from your authenticator app.</p>
            <div>
              <label htmlFor="am" className="label">Authenticator code</label>
              <input id="am" ref={codeRef} value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} maxLength={20} autoComplete="one-time-code" className="input text-center font-mono text-lg tracking-[0.3em]"/>
              <p className="mt-1 text-xs text-neutral-500">Lost your phone? Type one of your backup codes instead.</p>
            </div>
            {err && <p role="alert" className="text-xs text-red-700">{err}</p>}
            <button className="btn-primary w-full" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Verify & open admin'}</button>
            <button type="button" className="text-xs underline" onClick={() => { setStep('phone'); setErr(''); setMfaCode(''); setChallenge(''); }}>Start over</button>
          </form>) : step === 'phone' ? (<form onSubmit={sendCode} noValidate className="card mt-6 space-y-3">
            <h1 className="text-2xl font-bold">Admin login</h1>
            <p className="text-sm text-neutral-600">Enter the administrator mobile number. We will send a one-time code by SMS.</p>
            <div>
              <label htmlFor="ap" className="label">Admin mobile number</label>
              <div className="flex">
                <span className="inline-flex items-center rounded-l-lg border border-r-0 border-gold/40 bg-cream-200/60 px-3 text-sm text-neutral-600">+91</span>
                <input id="ap" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} maxLength={10} inputMode="numeric" className="input rounded-l-none" autoComplete="tel-national" autoFocus/>
              </div>
            </div>
            {err && <p role="alert" className="text-xs text-red-700">{err}</p>}
            <button className="btn-primary w-full" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
          </form>) : (<form onSubmit={verify} noValidate className="card mt-6 space-y-3">
            <p className="text-sm">Enter the code sent by SMS to <b>+91 {phone}</b>.</p>
            {devCode && <p className="rounded bg-gold/20 px-2 py-1 text-xs">Development code: <b className="font-mono">{devCode}</b></p>}
            <div>
              <label htmlFor="ac" className="label">One-time code</label>
              <input id="ac" ref={codeRef} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} maxLength={8} inputMode="numeric" autoComplete="one-time-code" className="input text-center font-mono text-lg tracking-[0.3em]"/>
            </div>
            {err && <p role="alert" className="text-xs text-red-700">{err}</p>}
            <button className="btn-primary w-full" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Verify & open admin'}</button>
            <div className="flex items-center justify-between text-xs">
              <button type="button" className="underline" onClick={() => { setStep('phone'); setErr(''); setCode(''); }}>Change number</button>
              <button type="button" className="underline disabled:no-underline disabled:opacity-50" disabled={cooldown > 0 || busy} onClick={() => void sendCode()}>{cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}</button>
            </div>
          </form>)}

        <p className="mt-6 text-center"><Link to="/" className="text-sm text-burgundy underline">Back to store</Link></p>
      </div>
    </div>);
}
