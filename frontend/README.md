# Upahars — Frontend (React (JavaScript) + Vite + Tailwind)

The customer storefront and admin panel UI.

> **Current state:** this app still runs in **demo mode** — products, cart, orders and the demo admin live in your browser
> (localStorage) and need **no backend**. It is *not yet connected* to the API in `../backend`; that integration (seller
> dashboard, `/store/:slug`, real login, Razorpay checkout) is the next phase. The dev server is already set up to forward
> `/api/*` to the backend, so it will work as soon as the screens call it.

## Run

```bash
npm install
npm run dev          # http://localhost:5173
```

Other commands: `npm test` (40 tests) · `npm run build` (production build in `dist/`) · `npm run preview`.

Optional: `cp .env.example .env` and set `VITE_API_TARGET` if your backend is not on `http://localhost:5000`.

## Demo logins (demo mode only)

* Any mobile number works; the 6-digit code is shown on screen (no SMS in demo mode).
* **Admin panel:** register with `9000000000` → open `/admin` (sidebar, orders, products, customers, inquiries, demo-data loader).
* Coupons: `DEMODIWALI15`, `DEMOFIRST100`, `FREEWRAP`.

## Run together with the backend

Terminal 1 — `cd ../backend && npm run dev`   ·   Terminal 2 — `cd frontend && npm run dev`.
Check the link: open `http://localhost:5173/api/health` — you should see `{"ok":true,...}`.
