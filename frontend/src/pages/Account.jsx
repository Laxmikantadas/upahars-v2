import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../lib/api";
import { isValidPhone, useAuth } from "../lib/auth";
import { listOrders, orderLabel, paiseToInr } from "../lib/orders";
import { notify } from "../lib/notify";
const RESEND_SECONDS = 30;
/** `nextPath` is set when the login gate shows this page in place of a protected page. */
export default function Account({ nextPath } = {}) {
  const {
    status,
    user,
    requestOtp,
    verifyOtp,
    verifyTwoFactor,
    updateProfile,
    logout,
  } = useAuth();
  const [orders, setOrders] = useState(null);
  const [ordersErr, setOrdersErr] = useState(false);
  // the customer's real orders, from the server
  useEffect(() => {
    if (!user?.name) return;
    let alive = true;
    listOrders()
      .then((o) => alive && setOrders(o))
      .catch(() => alive && setOrdersErr(true));
    return () => {
      alive = false;
    };
  }, [user?.name]);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = nextPath ?? params.get("next");
  const safeNext =
    next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  const [step, setStep] = useState("phone");
  const [challenge, setChallenge] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [justLoggedIn, setJustLoggedIn] = useState(false);
  const codeRef = useRef(null);
  useEffect(() => {
    if (justLoggedIn && user?.name && !safeNext)
      navigate("/", { replace: true });
  }, [justLoggedIn, user, safeNext, navigate]);
  // resend countdown
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  useEffect(() => {
    if (step === "otp" || step === "mfa") codeRef.current?.focus();
  }, [step]);
  // Once signed in AND the profile has a name, go back to where the visitor came from (cart, product…)
  useEffect(() => {
    if (user?.name && safeNext) navigate(safeNext, { replace: true });
  }, [user, safeNext, navigate]);
  const fail = (e) => {
    const m =
      e instanceof ApiError
        ? e.message
        : "Something went wrong. Please try again.";
    setErr(m);
    notify.error(m);
  };
  const sendCode = async (e) => {
    e?.preventDefault();
    if (!isValidPhone(phone))
      return setErr("Enter a valid 10-digit mobile number");
    setBusy(true);
    setErr("");
    try {
      const r = await requestOtp(phone);
      setCode("");
      setDevCode(r.devCode ?? "");
      setStep("otp");
      setCooldown(RESEND_SECONDS);
    } catch (x) {
      fail(x);
      // the server tells us when to wait — show the countdown instead of a dead button
      if (x instanceof ApiError && x.code === "otp_too_soon") setStep("otp");
    } finally {
      setBusy(false);
    }
  };
  const verify = async (e) => {
    e.preventDefault();
    if (!/^\d{4,8}$/.test(code)) return setErr("Enter the code from the SMS");
    setBusy(true);
    setErr("");
    try {
      const r = await verifyOtp(phone, code);
      if (r.kind === "twoFactor") {
        setChallenge(r.challenge);
        setMfaCode("");
        setStep("mfa");
      } else setJustLoggedIn(true);
    } catch (x) {
      fail(x);
    } finally {
      setBusy(false);
    }
  };
  const verifyMfa = async (e) => {
    e.preventDefault();
    if (mfaCode.trim().length < 6)
      return setErr("Enter the 6-digit code from your authenticator app");
    setBusy(true);
    setErr("");
    try {
      await verifyTwoFactor(challenge, mfaCode.trim());
      setJustLoggedIn(true);
    } catch (x) {
      fail(x);
      if (x instanceof ApiError && x.code === "challenge_expired") {
        setStep("phone");
        setCode("");
      } // sign-in timed out: start over
    } finally {
      setBusy(false);
    }
  };
  const saveName = async (e) => {
    e.preventDefault();
    if (name.trim().length < 2)
      return setErr("Enter your name (at least 2 letters)");
    setBusy(true);
    setErr("");
    try {
      await updateProfile({ name: name.trim() });
      setJustLoggedIn(true);
      notify.success("Your name has been saved.", {
        title: "Nice to meet you!",
        emoji: "😊",
      });
    } catch (x) {
      fail(x);
    } finally {
      setBusy(false);
    }
  };
  if (status === "loading") {
    return (
      <div
        className="container-page max-w-md py-16 text-center text-sm text-neutral-600"
        role="status"
      >
        Checking your session…
      </div>
    );
  }
  /* ── signed in, but new account without a name yet: finish registration ── */
  if (user && !user.name) {
    return (
      <div className="container-page max-w-md py-10">
        <h1 className="text-3xl font-bold">Welcome to Upahars 🎁</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Your number <b>{user.phone}</b> is verified. One last step — what
          should we call you?
        </p>
        <form onSubmit={saveName} noValidate className="card mt-4 space-y-3">
          <div>
            <label htmlFor="an" className="label">
              Your name
            </label>
            <input
              id="an"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              autoComplete="name"
              autoFocus
            />
          </div>
          {err && (
            <p role="alert" className="text-xs text-red-700">
              {err}
            </p>
          )}
          <button className="btn-primary w-full" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Finish registration"}
          </button>
        </form>
      </div>
    );
  }
  /* ── signed out: phone → code ── */
  if (!user) {
    return (
      <div className="container-page max-w-md py-10">
        <h1 className="text-3xl font-bold">
          {step === "phone"
            ? "Register / Sign in"
            : step === "otp"
              ? "Verify your number"
              : "Two-factor check"}
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          Browsing is open to everyone. Ordering needs a verified mobile number.
          New here? Just enter your number — we’ll create your account after you
          verify it.
        </p>

        {step === "mfa" ? (
          <form onSubmit={verifyMfa} noValidate className="card mt-4 space-y-3">
            <p className="text-sm">
              Your number <b>+91 {phone}</b> is verified. Now open your
              authenticator app and enter the 6-digit code for Upahars.
            </p>
            <div>
              <label htmlFor="am" className="label">
                Authenticator code
              </label>
              <input
                id="am"
                ref={codeRef}
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)}
                maxLength={20}
                inputMode="text"
                autoComplete="one-time-code"
                className="input text-center font-mono text-lg tracking-[0.3em]"
              />
              <p className="mt-1 text-xs text-neutral-500">
                Lost your phone? Type one of your backup codes instead.
              </p>
            </div>
            {err && (
              <p role="alert" className="text-xs text-red-700">
                {err}
              </p>
            )}
            <button
              className="btn-primary w-full"
              type="submit"
              disabled={busy}
            >
              {busy ? "Checking…" : "Verify & sign in"}
            </button>
            <button
              type="button"
              className="text-xs underline"
              onClick={() => {
                setStep("phone");
                setErr("");
                setMfaCode("");
                setChallenge("");
              }}
            >
              Start over
            </button>
          </form>
        ) : step === "phone" ? (
          <form onSubmit={sendCode} noValidate className="card mt-4 space-y-3">
            <div>
              <label htmlFor="ap" className="label">
                Mobile number
              </label>
              <div className="flex">
                <span className="inline-flex items-center rounded-l-lg border border-r-0 border-gold/40 bg-cream-200/60 px-3 text-sm text-neutral-600">
                  +91
                </span>
                <input
                  id="ap"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                  maxLength={10}
                  inputMode="numeric"
                  className="input rounded-l-none"
                  autoComplete="tel-national"
                  autoFocus
                />
              </div>
            </div>
            {err && (
              <p role="alert" className="text-xs text-red-700">
                {err}
              </p>
            )}
            <button
              className="btn-primary w-full"
              type="submit"
              disabled={busy}
            >
              {busy ? "Sending…" : "Send code"}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} noValidate className="card mt-4 space-y-3">
            <p className="text-sm">
              Enter the code sent by SMS to <b>+91 {phone}</b>.
            </p>
            <div>
              <label htmlFor="ac" className="label">
                One-time code
              </label>
              <input
                id="ac"
                ref={codeRef}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                maxLength={8}
                inputMode="numeric"
                autoComplete="one-time-code"
                className="input text-center font-mono text-lg tracking-[0.4em]"
              />
            </div>
            {devCode && (
              <p className="rounded-lg bg-gold/15 p-2 text-xs text-burgundy-700">
                Development mode: no SMS is sent. Your code is{" "}
                <b className="font-mono">{devCode}</b>.
              </p>
            )}
            {err && (
              <p role="alert" className="text-xs text-red-700">
                {err}
              </p>
            )}
            <button
              className="btn-primary w-full"
              type="submit"
              disabled={busy}
            >
              {busy ? "Checking…" : "Verify & continue"}
            </button>
            <div className="flex justify-between text-xs">
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setStep("phone");
                  setErr("");
                  setCode("");
                }}
              >
                Change number
              </button>
              <button
                type="button"
                className="underline disabled:no-underline disabled:opacity-50"
                disabled={cooldown > 0 || busy}
                onClick={() => sendCode()}
              >
                {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
              </button>
            </div>
          </form>
        )}
      </div>
    );
  }
  /* ── signed in ── */
  return (
    <div className="container-page max-w-3xl py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">{`Hello, ${user.name}`}</h1>
          <p className="text-sm text-neutral-600">{user.phone} · verified ✓</p>
        </div>
        <div className="flex gap-2">
          {user.roles.includes("admin") && (
            <Link to="/admin" className="btn-gold">
              Admin panel
            </Link>
          )}
          <button
            type="button"
            className="btn-ghost"
            onClick={() => void logout()}
          >
            Sign out
          </button>
        </div>
      </div>
      <h2 className="mt-6 text-2xl font-bold">My orders</h2>
      {ordersErr ? (
        <p role="alert" className="card mt-3 text-sm text-red-700">
          Could not load your orders. Please refresh.
        </p>
      ) : orders === null ? (
        <p className="card mt-3 text-sm text-neutral-600" role="status">
          Loading your orders…
        </p>
      ) : orders.length === 0 ? (
        <p className="card mt-3 text-sm text-neutral-600">No orders yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {orders.map((o) => (
            <li key={o.orderNumber}>
              <Link
                to={`/order/${o.orderNumber}`}
                className="card flex items-center justify-between text-sm hover:shadow-md"
              >
                <span>
                  <b className="font-mono">{o.orderNumber}</b>
                  <br />
                  <span className="text-neutral-500">
                    {new Date(o.createdAt).toLocaleDateString("en-IN")} ·{" "}
                    {o.items.length} item(s)
                  </span>
                </span>
                <span className="text-right">
                  <b>{paiseToInr(o.totals.totalPaise)}</b>
                  <br />
                  <span className="text-xs uppercase text-burgundy-700">
                    {orderLabel(o)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
