import '../src/lib/loadEnv.js'; // loads .env (works on every Node 18+)
// Usage: npm run make-admin -- 9876543210      (the person must then sign in with that number via OTP)
import mongoose from 'mongoose';
import { loadConfig } from '../src/config.js';
import { connectDb } from '../src/db.js';
import { User } from '../src/models/index.js';

const phone = process.argv[2];
if (!/^[6-9]\d{9}$/.test(phone ?? '')) { console.error('Usage: npm run make-admin -- <10-digit mobile>'); process.exit(1); }
const config = loadConfig();
await connectDb(config.MONGODB_URI);
const u = await User.findOneAndUpdate({ phone }, { $addToSet: { roles: { $each: ['customer', 'admin'] } } }, { upsert: true, new: true });
console.log(`✓ ${phone} is now an administrator (${u.roles.join(', ')})`);
await mongoose.disconnect();
