import '../src/lib/loadEnv.js';
// npm run clean-demo          -> preview only
// npm run clean-demo -- --yes -> really delete
import mongoose from 'mongoose';
import { loadConfig } from '../src/config.js';
import { connectDb } from '../src/db.js';
import { Coupon, Inventory, Product, Seller, Showcase, User } from '../src/models/index.js';

const config = loadConfig();
const really = process.argv.includes('--yes');
await connectDb(config.MONGODB_URI);
console.log('Database:', mongoose.connection.name);

const productIds = (await Product.find({ isDemo: true }, { _id: 1 }).lean()).map((p) => p._id);
const counts = {
  products: productIds.length,
  inventory: await Inventory.countDocuments({ productId: { $in: productIds } }),
  sellers: await Seller.countDocuments({ isDemo: true }),
  users: await User.countDocuments({ isDemo: true }),
  coupons: await Coupon.countDocuments({ isDemo: true }),
  showcase: await Showcase.countDocuments({ isDemo: true }),
};
console.log(really ? 'Deleting:' : 'Would delete (add --yes):', counts);
if (really) {
  await Inventory.deleteMany({ productId: { $in: productIds } });
  await Product.deleteMany({ isDemo: true });
  await Seller.deleteMany({ isDemo: true });
  await User.deleteMany({ isDemo: true });
  await Coupon.deleteMany({ isDemo: true });
  await Showcase.deleteMany({ isDemo: true });
  console.log('✓ demo data removed');
}
await mongoose.disconnect();