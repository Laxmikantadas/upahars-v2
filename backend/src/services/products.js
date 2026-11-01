import mongoose from 'mongoose';
import { z } from 'zod';
import { badRequest, conflict } from '../lib/errors.js';
import { parseOwnedImage } from '../lib/cloudinary.js';
import { slugify } from '../lib/slug.js';
import { Inventory, Product, Taxonomy } from '../models/index.js';
import { PRODUCT_TYPES } from '../models/index.js';

const slugRx = /^[a-z0-9][a-z0-9-]{0,58}$/;
const productInputBase = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().max(5000).default(''),
  images: z.array(z.object({ url: z.string().url().max(500) }).strict()).max(8).default([]),
  category: z.string().regex(slugRx), occasions: z.array(z.string().regex(slugRx)).max(10).default([]),
  tags: z.array(z.string().trim().min(1).max(30)).max(15).default([]),
  productType: z.enum(PRODUCT_TYPES).default('other'),
  pricePaise: z.number().int().min(100).max(10_000_000).optional(),
  compareAtPaise: z.number().int().min(100).max(10_000_000).nullable().optional(),
  variants: z.array(z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i).optional(), name: z.string().trim().min(1).max(80), sku: z.string().trim().max(40).default(''), pricePaise: z.number().int().min(100).max(10_000_000), compareAtPaise: z.number().int().min(100).nullable().optional(), stock: z.number().int().min(0).max(1_000_000).optional() }).strict()).max(30).default([]),
  stock: z.number().int().min(0).max(1_000_000).optional(),
  packQuantity: z.number().int().min(1).max(10_000).default(1), // how many pieces come in one pack
  isCustomizable: z.boolean().default(false),
  customization: z.object({ prompt: z.string().trim().max(120).default(''), maxLength: z.number().int().min(1).max(200).default(60) }).strict().default({}),
  // pickupPincode: where the courier collects this product. The admin form requires it; the API accepts '' so older products and the seller API keep working.
  pickupPincode: z.string().regex(/^[1-9]\d{5}$/, 'Pickup pincode must be exactly 6 digits').or(z.literal('')).default(''),
  shipping: z.object({
    weightGrams: z.number().int().min(0).max(50000).default(0), processingDays: z.number().int().min(0).max(30).default(3),
    lengthCm: z.number().min(0).max(300).default(0), widthCm: z.number().min(0).max(300).default(0), heightCm: z.number().min(0).max(300).default(0),
  }).strict().default({}),
}).strict();
export const refineProduct = (schema) => schema.superRefine((v, ctx) => {
  if (!v.variants.length && v.pricePaise == null) ctx.addIssue({ code: 'custom', path: ['pricePaise'], message: 'Price is required' });
  if (v.compareAtPaise != null && v.pricePaise != null && v.compareAtPaise <= v.pricePaise) ctx.addIssue({ code: 'custom', path: ['compareAtPaise'], message: 'Compare-at price must be higher than the price' });
});
export const productBase = productInputBase;
export const productInput = refineProduct(productInputBase);
export const productPatch = productInputBase.partial().strict();

export const MATERIAL_FIELDS = ['title', 'description', 'images', 'category', 'occasions', 'isCustomizable', 'customization', 'productType'];

/** category/occasion slugs must exist and be active; only administrators may use curated collections */
export async function checkTaxonomy({ category, occasions = [], collections = [] }) {
  if (category && !(await Taxonomy.exists({ type: 'category', slug: category, isActive: true }))) throw badRequest(`Unknown category “${category}”`, 'bad_category');
  if (occasions.length) {
    const n = await Taxonomy.countDocuments({ type: 'occasion', slug: { $in: occasions }, isActive: true });
    if (n !== new Set(occasions).size) throw badRequest('Unknown occasion', 'bad_occasion');
  }
  if (collections.length) {
    const n = await Taxonomy.countDocuments({ type: 'collection', slug: { $in: collections }, isActive: true });
    if (n !== new Set(collections).size) throw badRequest('Unknown collection', 'bad_collection');
  }
}

export const toImages = (cfg, folder, list) => list.map((i) => {
  const ok = parseOwnedImage(cfg, i.url, folder);
  if (!ok) throw badRequest('Images must be uploaded through Upahars image upload', 'bad_image');
  return ok;
});

async function uniqueSlug(title) {
  const base = slugify(title) || 'product';
  for (let i = 0; i < 6; i++) {
    const s = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    if (!(await Product.exists({ slug: s }))) return s;
  }
  return `${base}-${Date.now().toString(36)}`;
}

const buildVariants = (list) => list.map((v) => ({ _id: v.id ? new mongoose.Types.ObjectId(v.id) : new mongoose.Types.ObjectId(), name: v.name, sku: v.sku ?? '', pricePaise: v.pricePaise, compareAtPaise: v.compareAtPaise ?? null }));

/** Keeps one inventory row per product (no variants) or per variant, creating/removing rows as the shape changes. */
export async function syncInventory(product, input) {
  const keep = [];
  if (product.variants.length) {
    for (const v of product.variants) {
      const stock = input.variants?.find((x) => (x.id && String(x.id) === String(v._id)) || x.name === v.name)?.stock;
      await Inventory.findOneAndUpdate({ productId: product._id, variantId: v._id }, (stock != null ? { $set: { stock } } : { $setOnInsert: { stock: 0 } }), { upsert: true });
      keep.push(String(v._id));
    }
    await Inventory.deleteMany({ productId: product._id, variantId: null });
  } else {
    await Inventory.findOneAndUpdate({ productId: product._id, variantId: null }, (input.stock != null ? { $set: { stock: input.stock } } : { $setOnInsert: { stock: 0 } }), { upsert: true });
  }
  const rows = await Inventory.find({ productId: product._id, variantId: { $ne: null } });
  for (const r of rows) if (!keep.includes(String(r.variantId))) await r.deleteOne();
}

export async function createProduct({ input, owner, imageFolder, cfg, status = 'draft' }) {
  await checkTaxonomy({ category: input.category, occasions: input.occasions, collections: input.collections ?? [] });
  const variants = buildVariants(input.variants);
  const p = await Product.create({
    ownerType: owner.type, sellerId: owner.sellerId ?? null, sellerActive: owner.sellerActive ?? true,
    title: input.title, slug: await uniqueSlug(input.title), description: input.description, images: toImages(cfg, imageFolder, input.images),
    category: input.category, occasions: input.occasions, collections: input.collections ?? [], tags: input.tags, productType: input.productType,
    pricePaise: variants.length ? Math.min(...variants.map((v) => v.pricePaise)) : input.pricePaise, compareAtPaise: variants.length ? null : input.compareAtPaise ?? null,
    variants, packQuantity: input.packQuantity ?? 1, isCustomizable: input.isCustomizable, customization: input.customization, shipping: input.shipping, pickupPincode: input.pickupPincode ?? '', status,
  });
  await syncInventory(p, { ...input, variants: input.variants.map((v, i) => ({ ...v, id: String(p.variants[i]._id) })) });
  return p;
}

export async function updateProduct({ product, patch, imageFolder, cfg }) {
  if (patch.category || patch.occasions || patch.collections) await checkTaxonomy({ category: patch.category, occasions: patch.occasions, collections: patch.collections });
  const set = {};
  for (const k of ['title', 'description', 'category', 'occasions', 'collections', 'tags', 'productType', 'packQuantity', 'isCustomizable', 'customization', 'shipping', 'pickupPincode']) if (patch[k] !== undefined) set[k] = patch[k];
  if (patch.images) set.images = toImages(cfg, imageFolder, patch.images);
  if (patch.variants) {
    set.variants = buildVariants(patch.variants);
    if (set.variants.length) { set.pricePaise = Math.min(...set.variants.map((v) => v.pricePaise)); set.compareAtPaise = null; }
  }
  const hasVariants = (set.variants ?? product.variants).length > 0;
  if (!hasVariants) {
    if (patch.pricePaise != null) set.pricePaise = patch.pricePaise;
    if (patch.compareAtPaise !== undefined) set.compareAtPaise = patch.compareAtPaise;
    const price = set.pricePaise ?? product.pricePaise, cmp = set.compareAtPaise !== undefined ? set.compareAtPaise : product.compareAtPaise;
    if (cmp != null && cmp <= price) throw badRequest('Compare-at price must be higher than the price');
  }
  Object.assign(product, set);
  await product.save();
  if (patch.variants || patch.stock !== undefined || (!hasVariants)) await syncInventory(product, { ...patch, variants: patch.variants?.map((v, i) => ({ ...v, id: String(product.variants[i]._id) })) });
  return product;
}

export async function setStocks(product, stocks) {
  for (const s of stocks) {
    const variantId = s.variantId ?? null;
    if (product.variants.length ? !product.variants.some((v) => String(v._id) === String(variantId)) : variantId) throw badRequest('Unknown option', 'bad_variant');
    await Inventory.findOneAndUpdate({ productId: product._id, variantId }, { $set: { stock: s.stock } }, { upsert: true });
  }
}

export async function withStock(docs) {
  const rows = await Inventory.find({ productId: { $in: docs.map((d) => d._id) } }).lean();
  return docs.map((d) => ({ ...d, stocks: rows.filter((r) => String(r.productId) === String(d._id)).map((r) => ({ variantId: r.variantId ? String(r.variantId) : null, stock: r.stock })) }));
}

export const canPublish = (product) => {
  if (!product.images.length) throw conflict('Add at least one image before publishing', 'needs_image');
};
