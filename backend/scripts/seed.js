import '../src/lib/loadEnv.js'; // loads .env (works on every Node 18+)
// DEVELOPMENT DATA. Everything it creates is flagged isDemo. Usage: npm run seed
import mongoose from 'mongoose';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { connectDb } from '../src/db.js';
import { Coupon, Inventory, Product, Seller, Showcase, Taxonomy, User } from '../src/models/index.js';

const data = JSON.parse(readFileSync(new URL('./demo-products.json', import.meta.url), 'utf8'));
const config = loadConfig();
if (config.isProd) { console.error('Refusing to seed demo data in production'); process.exit(1); }
await connectDb(config.MONGODB_URI);

const occasions = ['For Mom', 'For Her', 'For Him', 'Best Friend', 'Birthday', 'Anniversary', 'Diwali', 'Housewarming'];
const collections = ['Diwali Gifting', 'Corporate Gifting', 'Festive Hampers', 'Designer Candles'];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
for (const c of data.categories) await Taxonomy.updateOne({ type: 'category', slug: c.slug }, { $setOnInsert: { name: c.name, sortOrder: c.sortOrder } }, { upsert: true });
for (const [i, n] of occasions.entries()) await Taxonomy.updateOne({ type: 'occasion', slug: slug(n) }, { $setOnInsert: { name: n, sortOrder: i } }, { upsert: true });
for (const [i, n] of collections.entries()) await Taxonomy.updateOne({ type: 'collection', slug: slug(n) }, { $setOnInsert: { name: n, sortOrder: i } }, { upsert: true });

async function addProduct(p, owner) {
  const s = slug(p.title) + (owner.sellerId ? `-${slug(owner.tag)}` : '');
  if (await Product.exists({ slug: s })) return;
  const doc = await Product.create({ ownerType: owner.type, sellerId: owner.sellerId ?? null, title: p.title, slug: s, description: p.description, category: p.category, occasions: p.occasions ?? [], collections: p.collections ?? [],
    tags: p.tags ?? [], productType: p.productType, pricePaise: p.pricePaise, compareAtPaise: p.compareAtPaise ?? null, isCustomizable: p.isCustomizable, customization: p.isCustomizable ? { prompt: 'Name or message to print', maxLength: 60 } : undefined, status: 'published', publishedAt: new Date(), isDemo: true });
  await Inventory.create({ productId: doc._id, variantId: null, stock: 25 });
}
for (const p of data.products) await addProduct({ ...p, occasions: p.tags.includes('diwali') ? ['diwali'] : [], collections: p.tags.includes('diwali') ? ['diwali-gifting'] : [] }, { type: 'upahars' });

const demoSellers = [
  { phone: '9100000001', storeName: 'RoseCraft Candles', slug: 'rosecraft', city: 'Bhubaneswar', items: [['Rose Petal Soy Candle', 'decorative-and-scented-candles', 34900, 'candle'], ['Lavender Jar Candle', 'decorative-and-scented-candles', 29900, 'candle']] },
  { phone: '9100000002', storeName: 'Clay & Co', slug: 'clay-and-co', city: 'Cuttack', items: [['Hand-painted Terracotta Pot', 'home-decor', 44900, 'decor'], ['Madhubani Coaster Set', 'handmade-gift-sets', 39900, 'handmade']] },
];
for (const d of demoSellers) {
  const u = await User.findOneAndUpdate({ phone: d.phone }, { $setOnInsert: { name: d.storeName + ' owner', roles: ['customer', 'seller'], isDemo: true } }, { upsert: true, new: true });
  let s = await Seller.findOne({ userId: u._id });
  if (!s) s = await Seller.create({ userId: u._id, status: 'approved', isDemo: true, application: { businessName: d.storeName, ownerName: u.name, businessType: 'individual', city: d.city, state: 'Odisha' }, store: { storeName: d.storeName, slug: d.slug, tagline: 'Demo store', description: 'Demo seller store created by the seed script.' } });
  for (const [title, category, pricePaise, productType] of d.items) await addProduct({ title, category, pricePaise, productType, description: `${title} — demo product from ${d.storeName}.`, isCustomizable: false, tags: [] }, { type: 'seller', sellerId: s._id, tag: d.slug });
}
await Coupon.updateOne({ code: 'WELCOME100' }, { $setOnInsert: { type: 'fixed', value: 10000, minOrderPaise: 49900, perUserLimit: 1, isActive: true, isDemo: true } }, { upsert: true });
await Coupon.updateOne({ code: 'DIWALI10' }, { $setOnInsert: { type: 'percent', value: 10, minOrderPaise: 99900, maxDiscountPaise: 50000, perUserLimit: 3, isActive: true, isDemo: true } }, { upsert: true });
// Home-page polaroid carousel. No pictures: the storefront paints a placeholder until the admin uploads real photos (Admin → Carousel).
const showcaseDemo = [['Hand-painted Diyas', 'Terracotta lamps, painted one at a time.'], ['Festive Hampers', 'Ready-to-gift boxes for every celebration.'], ['Scented Candles', 'Soy wax, hand-poured in small batches.'], ['Handloom Ribbons', 'A little Odisha in every wrapping.']];
for (const [i, [title, caption]] of showcaseDemo.entries()) await Showcase.updateOne({ title, isDemo: true }, { $setOnInsert: { caption, sortOrder: i, isActive: true } }, { upsert: true });
console.log('✓ seeded taxonomy, Upahars Originals, 2 demo seller stores (rosecraft, clay-and-co) and 2 coupons and 4 carousel pictures');
await mongoose.disconnect();
