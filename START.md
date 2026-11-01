# Quick start (3 terminals)
1. MongoDB:   `docker compose up -d`   (or use a free MongoDB Atlas URL in backend/.env -> MONGODB_URI)
2. Backend:   `cd backend && npm install && npm run seed && npm run dev`   -> http://localhost:5000/api/health
3. Frontend:  `cd frontend && npm install && npm run dev`                  -> http://localhost:5173

Sign in with any 10-digit mobile number (starts 6-9). The OTP appears on screen. OTP is sent through MSG91: put the real `MSG91_WIDGET_ID`, `MSG91_WIDGET_TOKEN`, `MSG91_AUTH_KEY` in backend/.env (set the widget's OTP length to 6) — the server will not start while they are still the `your_*` placeholders. Razorpay is configured in backend/.env too.
**Admin login:** open `/admin/login` (separate from the customer sign-in). The number **8018811056** is an administrator by default (`ADMIN_PHONES` in backend/.env, comma-separated for more numbers) — enter it, then the SMS code, and you land in the admin panel. Only admin numbers get a code on that page. Anyone else going to `/admin` is sent to `/admin/login`.
Other ways to make yourself admin: `cd backend && npm run make-admin -- 9876543210`, then sign in with that number. No authenticator app / two-factor anywhere.

## Admin: products and offers (server-backed)
Sign in as admin, then:
- **Products** — add, edit (name, description, category, price, offer price via "Original price", stock, tags, images, visibility) and delete any product, including seller listings. A product that already has orders is archived instead of deleted. Image upload needs the Cloudinary keys in `backend/.env`; without them products show a coloured placeholder.
- **Offers** — create, edit, switch off and delete coupons (everything except the code), choose which are shown on the shop, and manage home-page banners.
The shop reads the same server data, so changes appear immediately. If the server cannot be reached the shop falls back to its built-in sample catalogue.
Backend tests: `cd backend && npm test` (new file: `test/api.admincatalog.test.js`).

## Admin: home carousel (polaroid pictures under the banner)
Sign in as admin → **Home carousel** in the sidebar. Each entry is a **picture + name + description**:
- **Add / edit** — upload a square JPG, PNG or WebP (needs the Cloudinary keys in `backend/.env`; without a picture the website paints a soft placeholder), type a name (shown under the print) and a short description (shown at the bottom while that print is in front).
- **Position** sets the order (0 = first); **Hide/Show** and **Delete** work like categories.
- It appears on the home page right below the banner and trust strip. With no active pictures the section is hidden. `npm run seed` adds 4 demo entries (no pictures).
- API: public `GET /api/showcase`; admin `GET/POST /api/admin/showcase`, `PATCH/DELETE /api/admin/showcase/:id`. Tests: `backend/test/api.showcase.test.js`.
- Frontend: `frontend/src/components/ui/polaroid-line-carousel.jsx` (the component), `pages/admin/Showcase.jsx` (admin screen), `Moments` in `pages/Home.jsx` (the section).



## Courier pincode check (Shipex)
Customers type a pincode on the product page and at checkout; the server asks the Shipex courier API whether it can deliver there.
1. **Connect (admin):** open **Admin → Shipping**, enter your Shipex e-mail + password, press *Generate token*. The token (valid ~24 h) is saved **encrypted** in the database together with its expiry time. The password is used once and never stored.
2. **Watch the expiry:** the Shipping page shows a live countdown; every admin page shows a small chip in the top bar (green → amber 2 h before expiry → red when expired) and a banner when action is needed. When it expires, generate a new token the same way (the password is not stored, so this cannot be automatic).
3. **Pickup pincode:** *Admin → Products → Add/Edit product* has a required **Pickup pincode** (where the courier collects the parcel) plus weight and parcel size. These are what Shipex needs to answer.
4. **What the customer sees:** ✓ delivery available / ✗ cannot deliver. At checkout an order to a pincode Shipex says it cannot reach is refused (`SHIPEX_ENFORCE_AT_CHECKOUT=false` turns this off). If the token is missing/expired or Shipex is down, the customer is told it could not be confirmed and the **order is still allowed**.
5. Payment type sent to Shipex is always `Prepaid`. Request (POST): `pickUpPincode` (entered by the admin on the product), `deliveryPincode` (typed by the customer), `applicableWeight`, `length`, `width`, `height` (from the product's parcel fields), `paymentType`, `declaredValue` (from the product price).
Settings are in `backend/.env.example` (`SHIPEX_*`). Tests: `backend/test/api.shipping.test.js`.
