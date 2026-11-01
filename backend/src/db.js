import mongoose from 'mongoose';
import '../src/models/index.js';
export async function connectDb(uri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
  await Promise.all(Object.values(mongoose.models).map(async (m) => {
    try { await m.init(); } catch (e) {
      // An index with the same name but different options already exists (e.g. an old non-partial unique index): replace it.
      if (e.code === 85 || e.code === 86) { await m.syncIndexes(); } else throw e;
    }
  }));
  return mongoose.connection;
}
