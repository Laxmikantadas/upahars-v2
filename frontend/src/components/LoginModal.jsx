import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { isValidPhone, useAuth } from '../lib/auth';
import { BRAND } from '../lib/brand';
import { notify } from '../lib/notify';

const RESEND_SECONDS = 30;

/* any component can open the modal with:  const { openLogin } = useLoginModal(); */
const Ctx = createContext({ openLogin: () => { }, closeLogin: () => { } });
export const useLoginModal = () => useContext(Ctx);

export function LoginModalProvider({ children }) {
    const [open, setOpen] = useState(false);
    const [next, setNext] = useState(null);
    const openLogin = useCallback((opts = {}) => { setNext(opts.next ?? null); setOpen(true); }, []);
    const closeLogin = useCallback(() => setOpen(false), []);
    const value = useMemo(() => ({ openLogin, closeLogin }), [openLogin, closeLogin]);
    return (<Ctx.Provider value={value}>
      {children}
      {open && <LoginModal next={next} onClose={closeLogin} />}
    </Ctx.Provider>);
}

/* the modal: phone → OTP → (2FA) → (name, new users only) */
function LoginModal({ next, onClose }) {
    const { user, requestOtp, verifyOtp, verifyTwoFactor, updateProfile } = useAuth();
    const navigate = useNavigate();
    const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : null;
    const [step, setStep] = useState(user && !user.name ? 'name' : 'phone');
    const [phone, setPhone] = useState('');
    const [code, setCode] = useState('');
    const [devCode, setDevCode] = useState('');
    const [challenge, setChallenge] = useState('');
    const [mfaCode, setMfaCode] = useState('');
    const [name, setName] = useState('');
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    const [cooldown, setCooldown] = useState(0);
    const inputRef = useRef(null);

    // Esc closes, page behind does not scroll
    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
    }, [onClose]);
    // resend countdown
    useEffect(() => {
        if (cooldown <= 0) return;
        const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
        return () => clearTimeout(t);
    }, [cooldown]);
    useEffect(() => { inputRef.current?.focus(); }, [step]);

    const fail = (e) => { const m = e instanceof ApiError ? e.message : 'Something went wrong. Please try again.'; setErr(m); notify.error(m); };
    // login complete → close modal and go home (or to the page that asked for login)
    const finish = () => { onClose(); navigate(safeNext ?? '/'); };

    const sendCode = async (e) => {
        e?.preventDefault();
        if (!isValidPhone(phone)) return setErr('Enter a valid 10-digit mobile number');
        setBusy(true);
        setErr('');
        try {
            const r = await requestOtp(phone);
            setCode('');
            setDevCode(r.devCode ?? '');
            setStep('otp');
            setCooldown(RESEND_SECONDS);
        }
        catch (x) {
            fail(x);
            if (x instanceof ApiError && x.code === 'otp_too_soon') setStep('otp');
        }
        finally { setBusy(false); }
    };
    const verify = async (e) => {
        e.preventDefault();
        if (!/^\d{4,8}$/.test(code)) return setErr('Enter the code from the SMS');
        setBusy(true);
        setErr('');
        try {
            const r = await verifyOtp(phone, code);
            if (r.kind === 'twoFactor') {
                setChallenge(r.challenge);
                setMfaCode('');
                setStep('mfa');
            }
            else if (!r.user.name) setStep('name'); // brand-new account
            else finish();
        }
        catch (x) { fail(x); }
        finally { setBusy(false); }
    };
    const verifyMfa = async (e) => {
        e.preventDefault();
        if (mfaCode.trim().length < 6) return setErr('Enter the 6-digit code from your authenticator app');
        setBusy(true);
        setErr('');
        try {
            const u = await verifyTwoFactor(challenge, mfaCode.trim());
            if (!u.name) setStep('name');
            else finish();
        }
        catch (x) {
            fail(x);
            if (x instanceof ApiError && x.code === 'challenge_expired') { setStep('phone'); setCode(''); }
        }
        finally { setBusy(false); }
    };
    const saveName = async (e) => {
        e.preventDefault();
        if (name.trim().length < 2) return setErr('Enter your name (at least 2 letters)');
        setBusy(true);
        setErr('');
        try {
            await updateProfile({ name: name.trim() });
            notify.success('Your name has been saved.', { title: 'Nice to meet you!', emoji: '😊' });
            finish();
        }
        catch (x) { fail(x); }
        finally { setBusy(false); }
    };

    const title = { phone: 'Login / Register', otp: 'Verify your number', mfa: 'Two-factor check', name: 'One last step' }[step];
    const stepNo = { phone: 1, otp: 2, mfa: 2, name: 3 }[step];

    return createPortal(<div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="login-title" className="relative w-full max-w-md rounded-t-2xl bg-cream p-6 shadow-2xl sm:rounded-2xl">
        <button type="button" onClick={onClose} aria-label="Close" className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-xl text-neutral-500 hover:bg-black/5">×</button>

        <div className="flex items-center gap-2">
          <img src={BRAND.icon} alt="" className="h-10 w-auto" />
          <div className="leading-tight">
            <h2 id="login-title" className="text-xl font-bold text-burgundy-800">{title}</h2>
            <p className="text-xs text-neutral-500">Step {stepNo} of 3</p>
          </div>
        </div>
        <div className="mt-3 flex gap-1" aria-hidden="true">
          {[1, 2, 3].map((n) => <span key={n} className={`h-1 flex-1 rounded-full ${n <= stepNo ? 'bg-burgundy' : 'bg-gold/30'}`} />)}
        </div>

        {step === 'phone' && (<form onSubmit={sendCode} noValidate className="mt-4 space-y-3">
            <p className="text-sm text-neutral-600">Enter your mobile number. We’ll send a one-time code by SMS. New here? Your account is created after you verify.</p>
            <div>
              <label htmlFor="lm-phone" className="label">Mobile number</label>
              <div className="flex">
                <span className="inline-flex items-center rounded-l-lg border border-r-0 border-gold/40 bg-cream-200/60 px-3 text-sm text-neutral-600">+91</span>
                <input id="lm-phone" ref={inputRef} value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} maxLength={10} inputMode="numeric" autoComplete="tel-national" className="input rounded-l-none" />
              </div>
            </div>
            {err && <p role="alert" className="text-xs text-red-700">{err}</p>}
            <button className="btn-primary w-full" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
          </form>)}

        {step === 'otp' && (<form onSubmit={verify} noValidate className="mt-4 space-y-3">
            <p className="text-sm">Enter the code sent by SMS to <b>+91 {phone}</b>.</p>
            <div>
              <label htmlFor="lm-code" className="label">One-time code</label>
              <input id="lm-code" ref={inputRef} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} maxLength={8} inputMode="numeric" autoComplete="one-time-code" className="input text-center font-mono text-lg tracking-[0.4em]" />
            </div>
            {devCode && <p className="rounded-lg bg-gold/15 p-2 text-xs text-burgundy-700">Development mode: no SMS is sent. Your code is <b className="font-mono">{devCode}</b>.</p>}
            {err && <p role="alert" className="text-xs text-red-700">{err}</p>}
            <button className="btn-primary w-full" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Verify & login'}</button>
            <div className="flex justify-between text-xs">
              <button type="button" className="underline" onClick={() => { setStep('phone'); setErr(''); setCode(''); }}>Change number</button>
              <button type="button" className="underline disabled:no-underline disabled:opacity-50" disabled={cooldown > 0 || busy} onClick={() => sendCode()}>
                {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
              </button>
            </div>
          </form>)}

        {step === 'mfa' && (<form onSubmit={verifyMfa} noValidate className="mt-4 space-y-3">
            <p className="text-sm">Open your authenticator app and enter the 6-digit code for Upahars.</p>
            <div>
              <label htmlFor="lm-mfa" className="label">Authenticator code</label>
              <input id="lm-mfa" ref={inputRef} value={mfaCode} onChange={(e) => setMfaCode(e.target.value)} maxLength={20} autoComplete="one-time-code" className="input text-center font-mono text-lg tracking-[0.3em]" />
              <p className="mt-1 text-xs text-neutral-500">Lost your phone? Type one of your backup codes instead.</p>
            </div>
            {err && <p role="alert" className="text-xs text-red-700">{err}</p>}
            <button className="btn-primary w-full" type="submit" disabled={busy}>{busy ? 'Checking…' : 'Verify & login'}</button>
            <button type="button" className="text-xs underline" onClick={() => { setStep('phone'); setErr(''); setMfaCode(''); setChallenge(''); }}>Start over</button>
          </form>)}

        {step === 'name' && (<form onSubmit={saveName} noValidate className="mt-4 space-y-3">
            <p className="text-sm text-neutral-600">Your number is verified. What should we call you?</p>
            <div>
              <label htmlFor="lm-name" className="label">Your name</label>
              <input id="lm-name" ref={inputRef} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="input" />
            </div>
            {err && <p role="alert" className="text-xs text-red-700">{err}</p>}
            <button className="btn-primary w-full" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Finish registration'}</button>
          </form>)}
      </div>
    </div>, document.body);
}