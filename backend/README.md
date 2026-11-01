# Upahars — Backend API (Node.js · Express · MongoDB · Cloudinary · Razorpay)

Hybrid marketplace backend: **Upahars Originals** + approved **independent seller stores**, server-side pricing,
attribution, commission ledger, verified payments, refunds, payouts and an admin API.

```
backend/
  src/config.js          env validation (refuses unsafe production settings)
  src/models/            Mongoose models (money = integer paise)
  src/services/          settings, pricing, commission, attribution, orders/payments/refunds, payouts, products
  src/routes/            auth, public, orders, seller, admin, misc (uploads, wishlist, support)
  src/lib/               cloudinary signing, payment + SMS providers, crypto, money helpers
  scripts/               seed.js (dev demo data) · make-admin.js
  test/                  unit + API tests (supertest)
```

## Run it

```bash
cp .env.example .env      # then edit
npm install
npm run seed                           # dev only: taxonomy, 24 Originals, 2 demo seller stores, coupons
npm run make-admin -- 9876543210       # make a phone number an administrator, then sign in with it via OTP
npm run dev                            # http://localhost:5000/api/health
```

Needs a MongoDB (local `docker run -p 27017:27017 mongo:7`, or Atlas). In development `OTP_DEV_ECHO=true` returns the
OTP in the API response and `PAYMENT_PROVIDER=mock` enables `POST /api/dev/payments/simulate`. **Both are refused in
production** (`NODE_ENV=production` fails to boot with them).

## Environment

| Variable | Purpose |
|---|---|
| `MONGODB_URI`, `JWT_SECRET` (≥32 chars), `CLIENT_ORIGINS` | core; origins are also the CSRF allow-list |
| `ENCRYPTION_KEY` | base64 of 32 random bytes (`openssl rand -base64 32`); encrypts PAN + payout details. **Required in production** |
| `OTP_PROVIDER` (`msg91`\|`console`), `MSG91_WIDGET_ID` `MSG91_WIDGET_TOKEN` `MSG91_AUTH_KEY` | phone login SMS |
| `CLOUDINARY_CLOUD_NAME/API_KEY/API_SECRET` | signed image uploads |
| `PAYMENT_PROVIDER` (`mock`\|`razorpay`), `RAZORPAY_KEY_ID/KEY_SECRET/WEBHOOK_SECRET` | payments |

## Manual setup you must do

1. **MongoDB Atlas** (or self-hosted) → set `MONGODB_URI`. Indexes are created on boot.
2. **Cloudinary**: create an account, copy cloud name/key/secret. Browsers upload to `upload.uploadUrl` with the fields
   returned by `POST /api/uploads/sign` (`file, api_key, timestamp, signature, folder, allowed_formats`).
3. **Razorpay**: create keys; enable **auto-capture**; add a webhook → `https://<api-host>/api/payments/webhook/razorpay`
   with events `payment.captured`, `order.paid`, `payment.failed`, and put its secret in `RAZORPAY_WEBHOOK_SECRET`.
4. **MSG91** OTP widget for production OTP (`OTP_PROVIDER=msg91`).
5. `npm run make-admin -- <phone>` for the first administrator. Use HTTPS and set `TRUST_PROXY=true` behind a proxy.

## API overview

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/otp/request` · `/auth/otp/verify` · `/auth/logout` · `GET/PATCH /api/me` |

### Phone login with MSG91 (`OTP_PROVIDER=msg91`)
**Recommended — our backend owns the code (`MSG91_TEMPLATE_ID` set):** the server makes a random code, stores only its HMAC hash with a 15-minute expiry (MongoDB then deletes it), a 5-attempt limit and resend limits (30 s gap, 5 per hour, kept in a separate record so they still apply after the code is gone), and MSG91's OTP API (`/api/v5/otp`, needs the DLT-approved template containing `##OTP##` and `MSG91_AUTH_KEY`) only delivers the SMS. `/auth/otp/verify` checks the code against our own hash.

**Without a template id** the server uses MSG91's widget service instead:
1. `POST /api/auth/otp/request` — the server asks MSG91 (OTP Widget API) to SMS a code to the number and stores MSG91's request id against that number.
2. `POST /api/auth/otp/verify` — the server sends the typed code and that request id to MSG91, then confirms MSG91's access token with the secret `MSG91_AUTH_KEY`. Only then does it start the session.
Because the server sends the code, it knows which number a request id belongs to (MSG91's token itself does not name the number). Resend gaps and attempt limits are enforced by our server.

In the MSG91 dashboard (OTP → Widget) **switch Captcha validation OFF** (the server API does not support captcha) and enable SMS as a channel; make sure your DLT template is approved. Run `node scripts/test-msg91.js send 9XXXXXXXXX` then `node scripts/test-msg91.js verify <request id> <code>` to see MSG91's raw replies.
| Catalogue | `GET /api/products` (filters: q, category, occasion, collection, type, seller, owner, price, sort, page) · `/products/:slug` · `/stores` · `/stores/:slug` · `/taxonomy` · `/banners` |
| Attribution | `POST /api/attribution/touch` · `GET /api/attribution/current` |
| Shopping | `POST /api/orders/quote` · `/orders/checkout` (+`Idempotency-Key`) · `GET /api/orders[/:no]` · `POST /orders/:no/cancel` · `POST /api/payments/verify` · `POST /api/payments/webhook/razorpay` |
| Customer | wishlist `PUT/DELETE /api/me/wishlist/:id` · support tickets `/api/support/tickets` |
| Seller | `POST /api/seller/apply` · `GET /seller/me` · `PATCH /seller/store` · `PUT /seller/payout-details` · products CRUD + `/submit /pause /resume /inventory` · `/seller/orders` + shipment updates · `/seller/earnings` · `/seller/payouts` |
| Admin | dashboard · sellers (approve/reject/suspend/reinstate/verify/commission) · products (Originals CRUD, approve/reject, commission, collections, stock) · taxonomy · settings · coupons · banners · orders (+refund, shipments) · ledgers (hold/release/adjust) · payouts · users · tickets · audit · reports |

## Security model (what the code enforces)

* **Roles** checked server-side on every request, re-read from the DB each time (suspension is immediate). Seller routes derive
  the seller from the session, never from a parameter; other sellers' ids simply return `404`.
* **Never trusts the client** for prices, totals, ownership, seller ids, commission or attribution — write schemas are `.strict()`.
* **Orders** are scoped to their owner in the query itself (no IDOR); sellers see only their own items/shipments, and the
  delivery address only after payment.
* **Payments**: signature check → gateway status/amount check → atomic `pending→paid` transition; webhooks verified over the raw
  body, de-duplicated by event id; late payments after expiry are re-reserved or refunded; amount mismatches are refused.
* **Images**: only URLs inside our Cloudinary cloud *and the caller's own folder* are accepted.
* OTP: hashed, 15-minute expiry (auto-deleted), 5 attempts, resend limits. CSRF: `SameSite=Lax` + Origin check. Helmet, rate limits, audit log.

## Tests

```bash
npm test                                   # needs a MongoDB at TEST_MONGODB_URI (default mongodb://127.0.0.1:27017/upahars_test)
TEST_REAL_MONGO=1 npm test                 # also runs the concurrency tests (stock races, simultaneous refunds)
```

**Verification status — please read.**

| | Status |
|---|---|
| 122 automated tests (unit + API: auth, seller isolation, IDOR, checkout, payments/webhooks, attribution, commission, refunds, payouts, admin) | ✅ passing |
| Ran against | **FerretDB** (MongoDB wire-compatible) — real MongoDB was not available where this was built |
| 3 concurrency tests (two shoppers racing for the last unit, simultaneous confirm, simultaneous refunds) | ⏭ **skipped, not yet run.** They need MongoDB's single-document atomic updates, which FerretDB does not provide (I measured up to 20 "winners" on a 1-unit stock). The code uses the standard atomic pattern; **run `TEST_REAL_MONGO=1 npm test` against real MongoDB before launch** |
| Razorpay / MSG91 / Cloudinary live calls | ⚠ not exercised against the real services. Razorpay provider is unit-tested with a fake HTTP layer, Cloudinary signing against the documented algorithm; test with sandbox keys first |
| Real server boot + seed + purchase through HTTP | ✅ smoke-tested |

## Not implemented yet (be aware)

* React screens for sellers/admin/stores and the Razorpay Checkout.js step (**next phase**; the current React app is still the localStorage demo).
* Customer **return requests** (admins can refund; sellers can cancel before shipping), KYC **document** upload (admin verifies manually), automated payouts (RazorpayX), courier/shipping-provider APIs (sellers enter tracking by hand; nothing is invented), GST invoices/tax lines, COD, email/WhatsApp notifications, admin MFA, demo-data purge endpoint.
