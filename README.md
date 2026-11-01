# Upahars — gifting marketplace

```
upahars/
├── frontend/   React + Vite storefront & admin UI      (port 5173)
├── backend/    Node.js + Express + MongoDB API          (port 5000)
└── README.md   this file
```

The two projects are independent: each has its own `package.json`, `.env.example` and README.
You need Node.js 18 or newer (18, 20, 22, 24 all work) and a MongoDB (Docker: `docker run -d -p 27017:27017 mongo:7`, or a free MongoDB Atlas URL).

## Run the backend
```bash
cd backend
cp .env.example .env          # set JWT_SECRET to a long random text (32+ chars); set MONGODB_URI if not local
npm install
npm run seed                  # optional demo data (24 Upahars products, 2 demo seller stores, 2 coupons)
npm run dev                   # check: http://localhost:5000/api/health
```
First admin: `npm run make-admin -- 9876543210`, then sign in with that number on the website (in dev the code is shown on screen).
Admins must turn on two-factor (authenticator app) the first time — the website walks you through it (Account → Two-factor authentication).

## Run the frontend (second terminal)
```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173
```
The frontend dev server forwards `/api/*` to the backend, so `http://localhost:5173/api/health` shows the API reply.

## Status
* **Login + two-factor are done and connected.** The whole site is *login-first*: visitors see Register / Sign in (policy pages stay public).
  1. Mobile number → SMS code (new numbers are registered automatically, then asked for a name).
  2. If the account has two-factor on: a 6-digit code from an authenticator app (Google Authenticator, Authy, …) or a one-time backup code.
  3. The session is an HttpOnly cookie; the browser keeps no login data.
* **Two-factor rules:** optional for customers (Account page → turn on, 10 backup codes shown once); **required for administrators**
  (the admin API refuses every call until it is on; admins cannot turn it off). Codes can't be re-used, 5 wrong codes lock for 15 minutes,
  secrets are encrypted at rest and backup codes are stored hashed. Set `REQUIRE_ADMIN_2FA=false` only for local experiments.
* **Payments are connected (Razorpay).** Checkout creates a real order on the server; the server prices it (its own catalogue, shipping, coupons) and the
  customer pays in the Razorpay window (UPI, cards and wallets — net banking is switched off). The server verifies the signature *and* re-checks the payment with Razorpay before
  the order counts as paid; the webhook is a safety net. "My orders" and the order page show real server orders (cancel, tracking).
  Online payment is the only payment method (no cash on delivery).
* The storefront pages still list built-in sample products; checkout matches them **by title** to the products created by `npm run seed`, so run the seed first.
* Still demo (browser localStorage, not yet on the API): product pages, cart, admin data, bulk inquiries.
* Backend: sellers, stores, products, attribution, commission ledger, orders, payments, refunds, payouts and the admin API are built and tested.
  Three concurrency tests need a real MongoDB — run `TEST_REAL_MONGO=1 npm test` inside `backend/` before launch. Razorpay, MSG91 and Cloudinary
  have not been tested live. Details: `backend/README.md`.

## Payments setup
**No online payment (simplest):** `PAYMENT_PROVIDER=none` — checkout needs no gateway; the order is confirmed the moment it is placed (pay on delivery / later). Login still uses the phone OTP; with `OTP_PROVIDER=console` + `OTP_DEV_ECHO=true` no SMS account is needed (the code is shown on screen).

**Development (default):** `PAYMENT_PROVIDER=mock` — checkout completes with a *test payment* (no money, no Razorpay account). Run `npm run seed` first.

**Razorpay Test Mode** (real pop-up, fake money) — in `backend/.env`:
```
PAYMENT_PROVIDER=razorpay
RAZORPAY_KEY_ID=rzp_test_xxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxx
RAZORPAY_WEBHOOK_SECRET=any-long-random-text-you-also-type-in-the-dashboard
```
Get the keys in Razorpay Dashboard → Account & Settings → API Keys (Test Mode). Restart the backend; `/api/health` should show `"payments":"razorpay"`.
Test UPI: `success@razorpay`; test card: `4111 1111 1111 1111`, any future expiry and CVV.

**Webhook** (Dashboard → Webhooks → Add): URL `https://<your-api-domain>/api/payments/webhook/razorpay`, secret = `RAZORPAY_WEBHOOK_SECRET`,
events `payment.captured`, `order.paid`, `payment.failed`. It must be a public https URL (for local tests use a tunnel such as ngrok).

**Going live:** switch to Live keys, set `NODE_ENV=production`, `OTP_PROVIDER=msg91`, `OTP_DEV_ECHO=false`, `ENCRYPTION_KEY`, https `CLIENT_ORIGINS`.
The server refuses to start in production with the mock gateway or any other unsafe setting.

## Deploying (read before going live)
* Put the website and the API on the **same site** (e.g. `upahars.in` and `api.upahars.in`). The login cookie is `SameSite=Lax`, so a frontend and API on
  unrelated domains (e.g. `*.vercel.app` + `*.onrender.com`) would not stay signed in. Set `VITE_API_BASE=https://api.upahars.in` in the frontend build.
* On a host/proxy set `TRUST_PROXY=true` in the backend, otherwise all visitors share one IP and one rate limit.
* Before launch run `npm test` in both folders, and `TEST_REAL_MONGO=1 npm test` in `backend/` against a real MongoDB.
