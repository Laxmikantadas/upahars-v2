import { Inventory, Product, Seller } from '../models/index.js';

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const publicFilter = () => ({ status: 'published', sellerActive: true });
export const sellerIsActive = (s) => s.status === 'approved' && !s.store.isPaused;

/** Keep the denormalised product visibility flag in step with the seller's status/pause state. */
export const syncSellerProducts = (seller) => Product.updateMany({ sellerId: seller._id }, { $set: { sellerActive: sellerIsActive(seller) } });

export async function stockMap(productIds) {
  const rows = await Inventory.find({ productId: { $in: productIds } }).lean();
  return new Map(rows.map((r) => [`${r.productId}:${r.variantId ?? ''}`, r.stock]));
}

export const sellerBadge = (s) => s && ({
  slug: s.store.slug, storeName: s.store.storeName, logo: s.store.logo?.url ?? null,
  verified: Boolean(s.verification?.verified), city: s.application.city,
});

/** Public shape of a product — no moderation notes, commission overrides or seller ids. Exact stock stays private except a "only N left" hint once 5 or fewer remain. */
const LOW_STOCK_AT = 5;
export function publicProduct(p, stocks, sellersById) {
  const hasVariants = p.variants?.length > 0;
  const variants = (p.variants ?? []).map((v) => ({
    id: String(v._id), name: v.name, sku: v.sku, pricePaise: v.pricePaise, compareAtPaise: v.compareAtPaise,
    inStock: (stocks.get(`${p._id}:${v._id}`) ?? 0) > 0,
  }));
  const inStock = hasVariants ? variants.some((v) => v.inStock) : (stocks.get(`${p._id}:`) ?? 0) > 0;
  const stockLeft = hasVariants ? (p.variants ?? []).reduce((a, v) => a + (stocks.get(`${p._id}:${v._id}`) ?? 0), 0) : (stocks.get(`${p._id}:`) ?? 0);
  const fromPaise = hasVariants ? Math.min(...variants.map((v) => v.pricePaise)) : p.pricePaise;
  return {
    id: String(p._id), slug: p.slug, title: p.title, description: p.description, images: (p.images ?? []).map((i) => i.url),
    category: p.category, occasions: p.occasions, collections: p.collections, tags: p.tags, productType: p.productType,
    pricePaise: fromPaise, compareAtPaise: hasVariants ? null : p.compareAtPaise, variants, inStock,
    packQuantity: p.packQuantity ?? 1, lowStock: stockLeft > 0 && stockLeft <= LOW_STOCK_AT ? stockLeft : null,
    isCustomizable: p.isCustomizable, customization: p.isCustomizable ? p.customization : null,
    shipping: p.shipping, soldBy: p.ownerType === 'upahars' ? { type: 'upahars', label: 'Upahars Originals' } : { type: 'seller', ...sellerBadge(sellersById.get(String(p.sellerId))) },
    createdAt: p.createdAt,
  };
}

export async function publicProducts(docs) {
  const stocks = await stockMap(docs.map((d) => d._id));
  const ids = [...new Set(docs.filter((d) => d.sellerId).map((d) => String(d.sellerId)))];
  const sellers = ids.length ? await Seller.find({ _id: { $in: ids } }).lean() : [];
  const byId = new Map(sellers.map((s) => [String(s._id), s]));
  return docs.map((d) => publicProduct(d, stocks, byId));
}
