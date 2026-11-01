import { Taxonomy } from '../models/index.js';

const DEFAULT_CATEGORIES = [
  ['Candles', 'candles'], ['Hampers', 'hampers'], ['Gift Boxes', 'gift-boxes'],
  ['Handmade', 'handmade'], ['Home Decor', 'home-decor'], ['Personalised', 'personalised'],
];

/** A product cannot be saved without a category. On a brand-new database, create a starter set so "Add product" works at once.
 *  Does nothing once any category exists, so categories you rename or delete are never recreated. */
export async function ensureDefaultCategories(log = console) {
  if (await Taxonomy.exists({ type: 'category' })) return false;
  await Taxonomy.insertMany(DEFAULT_CATEGORIES.map(([name, slug], i) => ({ type: 'category', name, slug, sortOrder: i })));
  log.info?.('[bootstrap] created default product categories');
  return true;
}
