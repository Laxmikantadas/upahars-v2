import { z } from 'zod';
import { Setting } from '../models/index.js';

export const DEFAULT_SETTINGS = {
  commission: { linkBps: 500, marketplaceBps: 1200 }, // 5% via a seller's own link, 12% via the marketplace
  attribution: { windowDays: 14, policy: 'last_touch' }, // 'last_touch' | 'first_touch'
  discountFunding: 'platform', // coupons are paid by Upahars ('platform') or reduce the seller's base ('seller')
  shipping: { flatFeePaise: 6500, freeAbovePaise: 69900, paidTo: 'seller' }, // per shipment (per seller)
  paymentFee: { bps: 0, bearer: 'platform' }, // estimated gateway fee; 'seller' deducts it from payouts
  payoutHoldDays: 7, // days after delivery before earnings become payable (return window)
  requireProductApproval: true,
  reservationMinutes: 30, // how long stock is held for an unpaid order
  maxQtyPerLine: 20,
};

const bps = z.number().int().min(0).max(10000);
export const settingsPatchSchema = z.object({
  commission: z.object({ linkBps: bps, marketplaceBps: bps }).partial().strict(),
  attribution: z.object({ windowDays: z.number().int().min(1).max(90), policy: z.enum(['last_touch', 'first_touch']) }).partial().strict(),
  discountFunding: z.enum(['platform', 'seller']),
  shipping: z.object({ flatFeePaise: z.number().int().min(0), freeAbovePaise: z.number().int().min(0), paidTo: z.enum(['seller', 'platform']) }).partial().strict(),
  paymentFee: z.object({ bps: z.number().int().min(0).max(1000), bearer: z.enum(['platform', 'seller']) }).partial().strict(),
  payoutHoldDays: z.number().int().min(0).max(60),
  requireProductApproval: z.boolean(),
  reservationMinutes: z.number().int().min(5).max(240),
  maxQtyPerLine: z.number().int().min(1).max(100),
}).partial().strict();

const merge = (base, patch) => {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch ?? {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...base[k], ...v } : v;
  return out;
};

export async function getSettings() {
  const doc = await Setting.findOne({ key: 'platform' }).lean();
  return merge(DEFAULT_SETTINGS, doc?.value);
}

export async function updateSettings(patch, userId) {
  const current = await getSettings();
  const next = merge(current, patch);
  await Setting.findOneAndUpdate({ key: 'platform' }, { $set: { value: next, updatedBy: userId } }, { upsert: true });
  return { before: current, after: next };
}
