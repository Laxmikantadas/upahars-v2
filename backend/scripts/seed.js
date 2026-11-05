import '../src/lib/loadEnv.js';
// Starter lists only. No demo products, sellers, coupons or carousel pictures.
import mongoose from 'mongoose';
import { loadConfig } from '../src/config.js';
import { connectDb } from '../src/db.js';
import { Taxonomy } from '../src/models/index.js';

const config = loadConfig();
if (config.isProd) { console.error('Refusing to seed in production'); process.exit(1); }
await connectDb(config.MONGODB_URI);

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const categories = ['Candles', 'Hampers', 'Gift Boxes', 'Handmade', 'Home Decor', 'Personalised'];
const occasions = ['For Mom', 'For Her', 'For Him', 'Best Friend', 'Birthday', 'Anniversary', 'Diwali', 'Housewarming'];
const collections = ['Diwali Gifting', 'Corporate Gifting', 'Festive Hampers', 'Designer Candles'];
for (const [type, list] of [['category', categories], ['occasion', occasions], ['collection', collections]])
  for (const [i, name] of list.entries())
    await Taxonomy.updateOne({ type, slug: slug(name) }, { $setOnInsert: { name, sortOrder: i } }, { upsert: true });
console.log('✓ seeded categories, occasions and collections only');
await mongoose.disconnect();