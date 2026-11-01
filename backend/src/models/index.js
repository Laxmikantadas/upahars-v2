import mongoose from 'mongoose';
const { Schema, model } = mongoose;
const oid = Schema.Types.ObjectId;
const img = { _id: false, url: { type: String, required: true }, publicId: { type: String, required: true } };
const int = (extra = {}) => ({ type: Number, validate: { validator: (v) => v == null || Number.isInteger(v), message: '{PATH} must be an integer' }, ...extra });
const paise = (extra = {}) => int({ min: 0, ...extra });

/* ───────────── people ───────────── */
export const User = model('User', new Schema({
  phone: { type: String, required: true, unique: true, match: /^[6-9]\d{9}$/ },
  name: { type: String, trim: true, maxlength: 80, default: '' },
  email: { type: String, trim: true, lowercase: true, maxlength: 120, default: '' },
  roles: { type: [String], enum: ['customer', 'seller', 'admin'], default: ['customer'] },
  isSuspended: { type: Boolean, default: false }, isDemo: { type: Boolean, default: false },
  wishlist: [{ type: oid, ref: 'Product' }],
  lastLoginAt: Date,
  // Two-factor authentication (authenticator app). The secret is AES-GCM encrypted; backup codes are stored only as hashes.
  twoFactor: {
    enabled: { type: Boolean, default: false },
    secretEnc: { type: String, default: '' },
    pendingSecretEnc: { type: String, default: '' }, // set by /setup, promoted by /enable
    lastStep: { type: Number, default: 0 },          // last accepted 30-second step (stops code re-use)
    backupCodes: { type: [String], default: [] },
    failedAttempts: { type: Number, default: 0 },
    lockedUntil: Date,
    enabledAt: Date,
  },
}, { timestamps: true }));

/** The code itself. Valid for 15 minutes; MongoDB then deletes the row on its own (TTL index), so a code is never kept longer. */
export const OtpChallenge = model('OtpChallenge', new Schema({
  phone: { type: String, required: true, unique: true },
  codeHash: { type: String, required: true }, // HMAC of the code (never the code); unused placeholder when the provider manages the code
  reqId: { type: String, default: '' }, // provider request id (MSG91 widget mode)
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } },
  attempts: { type: Number, default: 0 },
}, { timestamps: true }));

/** Resend gap + "5 codes per hour" counters. Kept apart from the code so they still apply after the code has been deleted. */
export const OtpThrottle = model('OtpThrottle', new Schema({
  phone: { type: String, required: true, unique: true },
  sendCount: { type: Number, default: 0 },
  windowStart: { type: Date, default: Date.now },
  lastSentAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true, index: { expireAfterSeconds: 0 } }, // cleaned up an hour after the last send
}));

/* ───────────── sellers & stores ───────────── */
export const Seller = model('Seller', new Schema({
  userId: { type: oid, ref: 'User', required: true, unique: true },
  isDemo: { type: Boolean, default: false },
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'suspended'], default: 'pending', index: true },
  statusNote: { type: String, default: '' },
  statusChangedAt: Date, statusChangedBy: { type: oid, ref: 'User' },
  application: {
    businessName: { type: String, required: true, trim: true, maxlength: 100 },
    ownerName: { type: String, required: true, trim: true, maxlength: 80 },
    businessType: { type: String, enum: ['individual', 'proprietorship', 'partnership', 'company'], required: true },
    city: { type: String, required: true, trim: true, maxlength: 60 },
    state: { type: String, required: true, trim: true, maxlength: 60 },
    instagram: { type: String, trim: true, maxlength: 80, default: '' },
    website: { type: String, trim: true, maxlength: 200, default: '' },
    gstin: { type: String, trim: true, uppercase: true, maxlength: 15, default: '' },
    panEnc: { type: String, default: '' }, panLast4: { type: String, default: '' },
    about: { type: String, trim: true, maxlength: 1000, default: '' },
    categories: [String],
  },
  store: {
    storeName: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, unique: true },
    tagline: { type: String, trim: true, maxlength: 120, default: '' },
    description: { type: String, trim: true, maxlength: 2000, default: '' },
    logo: { type: new Schema(img), default: null },
    banner: { type: new Schema(img), default: null },
    shipsFrom: { type: String, trim: true, maxlength: 80, default: '' },
    processingDays: { type: Number, min: 0, max: 30, default: 3 },
    shippingNote: { type: String, trim: true, maxlength: 300, default: '' },
    isPaused: { type: Boolean, default: false },
  },
  // "verified" is only ever set by an administrator after reviewing the seller (see admin routes)
  verification: { verified: { type: Boolean, default: false }, verifiedAt: Date, verifiedBy: { type: oid, ref: 'User' }, note: { type: String, default: '' } },
  commissionOverride: { linkBps: { type: Number, min: 0, max: 10000, default: null }, marketplaceBps: { type: Number, min: 0, max: 10000, default: null } },
  payoutEnc: { type: String, default: '' }, payoutHint: { type: String, default: '' },
}, { timestamps: true }));

/* ───────────── catalogue ───────────── */
export const Taxonomy = model('Taxonomy', (() => {
  const s = new Schema({
    type: { type: String, enum: ['category', 'occasion', 'collection'], required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true },
    description: { type: String, default: '', maxlength: 300 },
    image: { type: new Schema(img), default: null },
    sortOrder: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  }, { timestamps: true });
  s.index({ type: 1, slug: 1 }, { unique: true });
  return s;
})());

const variantSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  sku: { type: String, trim: true, maxlength: 40, default: '' },
  pricePaise: paise({ required: true, min: 100 }),
  compareAtPaise: paise({ default: null }),
});
export const PRODUCT_TYPES = ['candle', 'hamper', 'gift_box', 'handmade', 'decor', 'personalized', 'other'];
export const PRODUCT_STATUSES = ['draft', 'pending_review', 'published', 'paused', 'rejected', 'archived'];
export const Product = model('Product', (() => {
  const s = new Schema({
    ownerType: { type: String, enum: ['upahars', 'seller'], required: true, immutable: true },
    sellerId: { type: oid, ref: 'Seller', default: null, immutable: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true },
    description: { type: String, trim: true, maxlength: 5000, default: '' },
    images: { type: [new Schema(img)], validate: (v) => v.length <= 8 },
    category: { type: String, required: true },
    occasions: [String], collections: [String], tags: { type: [String], validate: (v) => v.length <= 15 },
    productType: { type: String, enum: PRODUCT_TYPES, default: 'other' },
    pricePaise: paise({ required: true, min: 100 }),
    compareAtPaise: paise({ default: null }),
    variants: { type: [variantSchema], validate: (v) => v.length <= 30 },
    packQuantity: { type: Number, default: 1, min: 1, max: 10000, validate: (v) => Number.isInteger(v) }, // pieces inside one pack, shown on the product page
    isCustomizable: { type: Boolean, default: false },
    customization: { prompt: { type: String, default: '', maxlength: 120 }, maxLength: { type: Number, default: 60, min: 1, max: 200 } },
    // pickupPincode = where the courier collects the parcel (the 6-digit pincode entered when the product is added). Never shown to customers.
    pickupPincode: { type: String, match: /^[1-9]\d{5}$/, default: '' },
    shipping: {
      weightGrams: { type: Number, min: 0, default: 0 }, processingDays: { type: Number, min: 0, max: 30, default: 3 },
      lengthCm: { type: Number, min: 0, max: 300, default: 0 }, widthCm: { type: Number, min: 0, max: 300, default: 0 }, heightCm: { type: Number, min: 0, max: 300, default: 0 },
    },
    status: { type: String, enum: PRODUCT_STATUSES, default: 'draft' },
    moderation: { note: { type: String, default: '' }, reviewedBy: { type: oid, ref: 'User' }, reviewedAt: Date },
    commissionOverrideBps: { type: Number, min: 0, max: 10000, default: null }, // admin only
    sellerActive: { type: Boolean, default: true }, // denormalised: false while the seller is suspended/paused
    soldCount: { type: Number, default: 0 }, isDemo: { type: Boolean, default: false },
    publishedAt: Date,
  }, { timestamps: true });
  s.index({ status: 1, sellerActive: 1, category: 1 });
  s.index({ sellerId: 1, status: 1 });
  return s;
})());

export const Inventory = model('Inventory', (() => {
  const s = new Schema({
    productId: { type: oid, ref: 'Product', required: true },
    variantId: { type: oid, default: null },
    stock: { type: Number, required: true, min: 0, validate: (v) => Number.isInteger(v) },
  }, { timestamps: true });
  s.index({ productId: 1, variantId: 1 }, { unique: true });
  return s;
})());

/* ───────────── orders ───────────── */
const orderItem = new Schema({
  productId: { type: oid, required: true }, variantId: { type: oid, default: null },
  title: String, variantName: { type: String, default: '' }, image: { type: String, default: '' },
  ownerType: { type: String, enum: ['upahars', 'seller'] }, sellerId: { type: oid, default: null },
  qty: int({ min: 1 }), unitPaise: paise(), discountPaise: paise({ default: 0 }),
  customization: { type: String, default: '' }, refundedQty: { type: Number, default: 0 },
});
const shipment = new Schema({
  sellerId: { type: oid, default: null }, ownerType: { type: String, enum: ['upahars', 'seller'] },
  shippingPaise: paise({ default: 0 }),
  status: { type: String, enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'], default: 'pending' },
  itemIds: [oid], shippingRefunded: { type: Boolean, default: false },
  tracking: { carrier: { type: String, default: '' }, trackingNumber: { type: String, default: '' }, trackingUrl: { type: String, default: '' }, enteredBy: { type: String, default: '' } },
  shippedAt: Date, deliveredAt: Date,
});
export const Order = model('Order', (() => {
  const s = new Schema({
    orderNumber: { type: String, required: true }, // unique via the partial index below
    userId: { type: oid, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['pending_payment', 'paid', 'cancelled', 'payment_failed', 'expired'], default: 'pending_payment', index: true },
    items: [orderItem], shipments: [shipment],
    totals: { subtotalPaise: paise(), discountPaise: paise(), shippingPaise: paise(), totalPaise: paise() },
    coupon: { code: { type: String, default: '' }, discountPaise: { type: Number, default: 0 } },
    address: { name: String, phone: String, email: { type: String, default: '' }, line: String, city: String, state: String, pincode: String },
    payment: {
      provider: String, status: { type: String, enum: ['created', 'paid', 'failed', 'refunded', 'partially_refunded'], default: 'created' },
      providerOrderId: { type: String, index: true }, providerPaymentId: { type: String, default: '' },
      amountPaise: paise(), paidAt: Date, method: { type: String, default: '' }, failureReason: { type: String, default: '' },
    },
    refundedPaise: paise({ default: 0 }),
    refunds: [{ amountPaise: Number, items: [{ itemId: oid, qty: Number }], reason: String, status: { type: String, enum: ['processed', 'failed'] }, providerRefundId: String, error: String, by: oid, at: { type: Date, default: Date.now } }],
    attribution: { type: new Schema({ sellerId: oid, touchId: oid, landingPath: String, touchedAt: Date, policy: String, windowDays: Number }, { _id: false }), default: null },
    idemRef: { type: String, unique: true, sparse: true }, // `${userId}:${Idempotency-Key}` — stops double submits
    reservationExpiresAt: Date,
    lockUntil: { type: Date, default: null },
    history: [{ at: { type: Date, default: Date.now }, by: String, action: String, note: String, _id: false }],
  }, { timestamps: true });
  s.index({ 'shipments.sellerId': 1, createdAt: -1 });
  // Partial unique index: legacy/incomplete order documents with no orderNumber (null) can't break index creation.
  s.index({ orderNumber: 1 }, { unique: true, partialFilterExpression: { orderNumber: { $type: 'string' } } });
  return s;
})());

/* ───────────── money ledger ───────────── */
export const Ledger = model('Ledger', (() => {
  const s = new Schema({
    orderId: { type: oid, required: true }, orderNumber: String, sellerId: { type: oid, required: true, index: true },
    source: { type: String, enum: ['seller_link', 'marketplace'], required: true },
    lines: [{ _id: false, itemId: oid, title: String, qty: Number, refundedQty: Number, unitPaise: Number, grossPaise: Number, discountBorneBySellerPaise: Number, eligiblePaise: Number, rateBps: Number, rateBasis: String, commissionPaise: Number }],
    shippingPaise: paise({ default: 0 }),
    grossPaise: paise({ default: 0 }), eligiblePaise: paise({ default: 0 }), commissionPaise: paise({ default: 0 }),
    paymentFeePaise: paise({ default: 0 }), sellerPayablePaise: paise({ default: 0 }),
    attribution: { type: Object, default: null }, // evidence snapshot for disputes
    policy: { type: Object, default: null },      // the commission rules in force when the order was paid
    status: { type: String, enum: ['pending', 'in_payout', 'paid', 'reversed', 'disputed'], default: 'pending', index: true },
    deliveredAt: Date, payableAfter: Date,
    adjustmentPaise: { type: Number, default: 0 },     // manual dispute adjustment by an administrator (audited)
    settledPaise: { type: Number, default: 0 },        // already paid out
    pendingSettlePaise: { type: Number, default: 0 },  // locked in an open payout
    payoutId: { type: oid, default: null },
    history: [{ at: { type: Date, default: Date.now }, by: String, action: String, note: String, _id: false }],
  }, { timestamps: true });
  s.index({ orderId: 1, sellerId: 1 }, { unique: true }); // a seller is charged commission once per order
  return s;
})());

export const Payout = model('Payout', new Schema({
  sellerId: { type: oid, required: true, index: true },
  ledgerIds: [oid],
  amountPaise: { type: Number, required: true },
  status: { type: String, enum: ['processing', 'paid', 'failed'], default: 'processing' },
  reference: { type: String, default: '' }, method: { type: String, default: '' }, note: { type: String, default: '' },
  createdBy: { type: oid, ref: 'User' }, paidAt: Date,
}, { timestamps: true }));

/* ───────────── attribution ───────────── */
export const Touch = model('Touch', new Schema({
  sellerId: { type: oid, required: true, index: true },
  landingPath: { type: String, maxlength: 300 }, referrer: { type: String, maxlength: 300, default: '' },
  ipHash: String, uaHash: String, userId: { type: oid, default: null },
  applied: { type: Boolean, default: true }, // false when ignored by the first-touch policy
}, { timestamps: true }));

/* ───────────── promotions & content ───────────── */
export const Coupon = model('Coupon', new Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true, match: /^[A-Z0-9_-]{3,24}$/ },
  type: { type: String, enum: ['percent', 'fixed'], required: true },
  value: int({ required: true, min: 1 }), // percent (1-100) or paise
  minOrderPaise: paise({ default: 0 }), maxDiscountPaise: paise({ default: null }),
  startsAt: Date, endsAt: Date, usageLimit: { type: Number, default: null }, perUserLimit: { type: Number, default: 1 },
  usedCount: { type: Number, default: 0 }, isActive: { type: Boolean, default: true }, isDemo: { type: Boolean, default: false },
  title: { type: String, trim: true, maxlength: 80, default: '' }, description: { type: String, trim: true, maxlength: 200, default: '' },
  isPublic: { type: Boolean, default: false }, // shown on the storefront as an offer
}, { timestamps: true }));

export const Banner = model('Banner', new Schema({
  title: { type: String, required: true, maxlength: 100 }, subtitle: { type: String, default: '', maxlength: 200 },
  image: { type: new Schema(img), default: null }, link: { type: String, default: '/', maxlength: 200 },
  placement: { type: String, enum: ['home_hero', 'home_strip'], default: 'home_hero' },
  sortOrder: { type: Number, default: 0 }, isActive: { type: Boolean, default: true },
}, { timestamps: true }));

// "Moments" polaroid carousel on the home page (right after the hero). Name = title, description = caption.
export const Showcase = model('Showcase', new Schema({
  title: { type: String, required: true, trim: true, maxlength: 60 }, caption: { type: String, default: '', trim: true, maxlength: 160 },
  image: { type: new Schema(img), default: null },
  sortOrder: { type: Number, default: 0 }, isActive: { type: Boolean, default: true }, isDemo: { type: Boolean, default: false },
}, { timestamps: true }));

/** Shipex (courier) API token. One row per provider. The token is AES-GCM encrypted at rest; the Shipex password is NEVER stored
 *  (the administrator types it once, we exchange it for a token, then forget it). The token lasts ~24 h; expiresAt comes from the JWT itself. */
export const ShippingToken = model('ShippingToken', new Schema({
  provider: { type: String, required: true, unique: true, default: 'shipex' },
  tokenEnc: { type: String, default: '' },
  email: { type: String, default: '' }, // which Shipex account the token belongs to (shown in the admin panel)
  issuedAt: Date, expiresAt: Date,
  generatedBy: { type: oid, ref: 'User' },
  expiredAt: Date, // set when Shipex answered 401 before expiresAt (token revoked / rotated elsewhere)
  lastError: { type: String, default: '' }, lastErrorAt: Date,
  lastCheckAt: Date,
}, { timestamps: true }));

export const Setting = model('Setting', new Schema({ key: { type: String, unique: true }, value: Object, updatedBy: { type: oid, ref: 'User' } }, { timestamps: true }));
export const Counter = model('Counter', new Schema({ key: { type: String, unique: true }, n: { type: Number, default: 0 } }));
export const AuditLog = model('AuditLog', (() => {
  const s = new Schema({ actorId: { type: oid, ref: 'User' }, actorRole: String, action: { type: String, index: true }, entity: String, entityId: String, details: Object, ip: String }, { timestamps: { createdAt: true, updatedAt: false } });
  s.index({ createdAt: -1 });
  return s;
})());
export const PaymentEvent = model('PaymentEvent', new Schema({ eventId: { type: String, unique: true }, type: String, processedAt: { type: Date, default: Date.now } }));

export const Ticket = model('Ticket', new Schema({
  userId: { type: oid, ref: 'User', required: true, index: true }, sellerId: { type: oid, default: null }, orderId: { type: oid, default: null },
  type: { type: String, enum: ['support', 'dispute'], default: 'support' }, subject: { type: String, required: true, maxlength: 120 },
  status: { type: String, enum: ['open', 'pending', 'resolved', 'closed'], default: 'open', index: true },
  messages: [{ by: oid, role: { type: String, enum: ['customer', 'seller', 'admin'] }, text: { type: String, maxlength: 2000 }, at: { type: Date, default: Date.now } }],
}, { timestamps: true }));

export const nextOrderNumber = async () => {
  const c = await Counter.findOneAndUpdate({ key: 'order' }, { $inc: { n: 1 } }, { upsert: true, new: true });
  return `UPH-${String(10000 + c.n)}`;
};
