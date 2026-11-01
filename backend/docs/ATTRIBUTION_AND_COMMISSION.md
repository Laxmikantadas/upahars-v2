# Attribution & commission policy (as implemented)

All of this is decided **on the server**. The browser never sends a seller id, a price, a total or a commission —
the API rejects those fields (`400`), and the attribution cookie is HMAC-signed.

## 1. Who owns an item

| Product owner | Created by | Commission |
|---|---|---|
| **Upahars Originals** (`ownerType: upahars`) | administrators only | none (Upahars is the seller) |
| **Independent seller** (`ownerType: seller`) | the approved seller; ownership is immutable | yes, see below |

## 2. Rates (admin-configurable)

Defaults live in `Settings → commission`: **5 %** (`linkBps: 500`) when the order came through that seller's own link,
**12 %** (`marketplaceBps: 1200`) otherwise. Precedence, highest first:

1. **Product override** set by an administrator (`PATCH /api/admin/products/:id/commission`) — applies to every source
2. **Seller override** set by an administrator (`PATCH /api/admin/sellers/:id/commission`), separately for link / marketplace
3. **Platform default**

Every override needs a written reason and is audit-logged with before/after values. The rate used is **frozen on the
ledger line** at payment time, so later changes never rewrite history.

## 3. Attribution

1. Visiting `/store/<slug>?ref=<slug>` (or a product link carrying `?ref=`) makes the app call `POST /api/attribution/touch`.
2. The server checks the store is **approved and not paused**, stores a `Touch` (landing path, referrer, hashed IP/UA) and sets
   a signed HttpOnly cookie `upahars_ref`.
3. At checkout the server verifies signature + window and **copies the evidence onto the order** (`order.attribution`).
4. Settings: `attribution.windowDays` (default 14) and `attribution.policy` (`last_touch` default | `first_touch`).

**Multi-seller carts.** The link rate applies only to the *referring seller's own items*. Other sellers' items in the same
cart pay the marketplace rate; Upahars Originals carry no seller commission. Switching links before buying moves the
referral (last-touch) or keeps the first (first-touch). One ledger per (order, seller) is enforced by a unique index,
so no item is ever charged twice.

**Abuse controls.** Unknown / paused / suspended stores are rejected; a forged or expired cookie is ignored; sellers cannot
buy their own products; touch endpoint is rate-limited; admins can read the touch evidence of any order
(`GET /api/admin/orders/:orderNumber`).

## 4. What the commission is calculated on

* Amounts are **integer paise**; commission is rounded half-up **per line**.
* **Base** = price of the units not refunded.
* **Coupons** (`settings.discountFunding`): `platform` (default — Upahars funds the coupon, seller base unchanged) or
  `seller` (the line's coupon share reduces the base).
* **Shipping** is never commissionable. `settings.shipping.paidTo` = `seller` (default) passes the shipping fee to the seller
  (returned if the whole shipment is refunded) or `platform`.
* **Taxes**: prices are treated as tax-inclusive; no separate GST is modelled (see "Not implemented").
* **Gateway fee**: `settings.paymentFee` is an *estimate* (`bps`), deducted from the seller only when `bearer = seller`.
* `sellerPayable = base − commission − fee(if seller-borne) + shipping(if seller-owned)`, never below 0.

## 5. Refunds, holds and payouts

* A refund recomputes the seller ledger from the refunded quantities; a fully refunded ledger becomes `reversed`.
* Earnings become **payable after delivery + `payoutHoldDays`** (default 7).
* If a refund happens **after** the seller was paid, the ledger's outstanding turns negative; the next payout **nets it off**.
  A payout is only created when the net is positive.
* Administrators can put a ledger on **hold** (dispute) or make a signed, reasoned **adjustment**.
* Payouts are *recorded*, not executed: the admin pays outside the platform (UPI/bank) and records the transaction reference.
  A payout is shown to the seller as **paid only once a reference has been recorded**.
