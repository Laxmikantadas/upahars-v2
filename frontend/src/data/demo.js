// DEMO DATA ONLY — placeholder catalogue shown until the Supabase `products` table is connected.
// None of these are real products, prices or reviews.
const p = (id, name, category, price, salePrice, rating, reviews, emoji, from, to, tags) => ({ id, slug: id, name, category, price, salePrice, rating, reviews, emoji, from, to, tags });
export const DEMO_PRODUCTS = [
    p('jute-wall-hanging', 'Handwoven Jute Wall Hanging', 'Wall Décor and Handcrafted Art', 1199, 899, 4.6, 128, '🧶', '#F5D9A8', '#C58F3C', ['trending', 'best']),
    p('terracotta-diya-set', 'Hand-painted Terracotta Diya Set (12)', 'Diwali Gifts and Festive Hampers', 449, 349, 4.8, 342, '🪔', '#FBD38D', '#DD6B20', ['trending', 'diwali', 'best']),
    p('madhubani-tray', 'Madhubani Art Serving Tray', 'Handmade Products', 1499, 1199, 4.7, 87, '🎨', '#FEB2B2', '#9B1B24', ['trending']),
    p('macrame-planter', 'Macramé Plant Hanger', 'Home Décor', 599, 449, 4.4, 203, '🪴', '#C6F6D5', '#2F855A', ['trending', 'best']),
    p('pattachitra-frame', 'Pattachitra Painted Wall Frame', 'Wall Décor and Handcrafted Art', 2199, 1799, 4.9, 56, '🖼️', '#FAD6A5', '#7A2E14', ['trending']),
    p('dhokra-elephant', 'Dhokra Brass Elephant Figurine', 'Handmade Products', 1299, undefined, 4.5, 64, '🐘', '#F6E05E', '#B7791F', ['trending']),
    p('jasmine-candle', 'Jasmine Soy Wax Jar Candle', 'Decorative and Scented Candles', 499, 399, 4.7, 410, '🕯️', '#FEFCBF', '#D69E2E', ['candle', 'best']),
    p('rose-floating-candles', 'Rose Floating Candles (Set of 6)', 'Decorative and Scented Candles', 349, 279, 4.6, 190, '🌹', '#FED7E2', '#B83280', ['candle']),
    p('sandalwood-pillar', 'Sandalwood Pillar Candle', 'Decorative and Scented Candles', 399, undefined, 4.5, 143, '🪵', '#E9D8A6', '#8B5E34', ['candle']),
    p('lavender-tin', 'Lavender Calm Travel Tin', 'Decorative and Scented Candles', 249, 199, 4.3, 98, '💜', '#E9D8FD', '#6B46C1', ['candle', 'best']),
    p('lotus-gel-candle', 'Lotus Gel Candle', 'Decorative and Scented Candles', 299, undefined, 4.4, 77, '🪷', '#FED7E2', '#D53F8C', ['candle']),
    p('photo-frame', 'Personalized Wooden Photo Frame', 'Customized Gifts', 799, undefined, 4.7, 156, '📸', '#E2C9A0', '#7B4B2A', ['custom', 'best']),
    p('name-mug', 'Custom Name & Message Ceramic Mug', 'Customized Gifts', 399, 329, 4.5, 301, '☕', '#BEE3F8', '#2B6CB0', ['custom']),
    p('engraved-pen', 'Engraved Wooden Pen Set', 'Customized Gifts', 549, undefined, 4.6, 89, '🖋️', '#D6BCFA', '#553C9A', ['custom']),
    p('custom-keychain', 'Handcrafted Name Keychain', 'Customized Gifts', 199, 149, 4.3, 220, '🔑', '#FEEBC8', '#C05621', ['custom']),
    p('story-journal', 'Personalized Handmade-paper Journal', 'Customized Gifts', 649, 549, 4.8, 112, '📔', '#C6F6D5', '#276749', ['custom', 'trending']),
    p('diwali-grand-hamper', 'Diwali Grand Festive Hamper', 'Diwali Gifts and Festive Hampers', 1999, 1599, 4.8, 264, '🎁', '#FBB6CE', '#97266D', ['hamper', 'diwali', 'best']),
    p('sweets-diya-hamper', 'Sweets & Diya Celebration Box', 'Diwali Gifts and Festive Hampers', 1299, 1099, 4.7, 178, '🍬', '#FEEBC8', '#DD6B20', ['hamper', 'diwali']),
    p('wellness-hamper', 'Self-care Wellness Hamper', 'Personalized Gift Hampers', 1799, undefined, 4.6, 93, '🧴', '#B2F5EA', '#2C7A7B', ['hamper']),
    p('eco-hamper', 'Eco-friendly Gift Basket', 'Eco-Friendly and Sustainable Gifts', 1499, 1299, 4.5, 71, '🌿', '#C6F6D5', '#38A169', ['hamper']),
    p('rangoli-kit', 'Reusable Wooden Rangoli Stencil Kit', 'Festival Decorations', 699, 549, 4.4, 134, '🌸', '#FED7D7', '#C53030', ['diwali', 'trending']),
    p('toran-door', 'Marigold & Bead Door Toran', 'Festival Decorations', 499, 399, 4.6, 205, '🏵️', '#FEFCBF', '#DD6B20', ['diwali', 'best']),
    p('brass-diya-lamp', 'Brass Peacock Diya Lamp', 'Diwali Gifts and Festive Hampers', 899, 749, 4.9, 118, '🦚', '#FAF089', '#975A16', ['diwali']),
    p('corporate-box', 'Corporate Gift Box (min. 25)', 'Corporate and Bulk Gifting', 899, undefined, 4.6, 44, '💼', '#E2E8F0', '#2D3748', ['hamper']),
];
export const OCCASIONS = [
    { name: 'Birthday', emoji: '🎂', from: '#FED7E2', to: '#D53F8C' },
    { name: 'Wedding', emoji: '💍', from: '#FEEBC8', to: '#C58F3C' },
    { name: 'Anniversary', emoji: '💞', from: '#FED7D7', to: '#9B1B24' },
    { name: 'Housewarming', emoji: '🏡', from: '#C6F6D5', to: '#2F855A' },
    { name: 'Baby Shower', emoji: '🧸', from: '#BEE3F8', to: '#2B6CB0' },
    { name: 'Thank You', emoji: '🙏', from: '#E9D8FD', to: '#6B46C1' },
];
export const CATEGORY_ICONS = {
    'Handmade Products': '🧵',
    'Home Décor': '🏠',
    'Wall Décor and Handcrafted Art': '🖼️',
    'Customized Gifts': '✨',
    'Personalized Gift Hampers': '🎁',
    'Diwali Gifts and Festive Hampers': '🪔',
    'Decorative and Scented Candles': '🕯️',
    'Bulk Candle Orders': '📦',
    'Corporate and Bulk Gifting': '💼',
    'Handmade Gift Sets': '🎀',
    'Eco-Friendly and Sustainable Gifts': '🌿',
    'Festival Decorations': '🎆',
};
export const TESTIMONIALS = [
    { name: 'Demo Customer A', city: 'Bhubaneswar', text: 'Sample review: the candle smelled wonderful and the packaging felt truly premium.', rating: 5 },
    { name: 'Demo Customer B', city: 'Cuttack', text: 'Sample review: the personalized frame arrived on time and my parents loved it.', rating: 5 },
    { name: 'Demo Customer C', city: 'Pune', text: 'Sample review: ordered 60 gift boxes for our team. Smooth quotation and delivery.', rating: 4 },
];
export const discountPct = (pr) => pr.salePrice ? Math.round(((pr.price - pr.salePrice) / pr.price) * 100) : 0;
export const inr = (n) => '₹' + n.toLocaleString('en-IN');
/* ---------- extra helpers used by the MVP pages ---------- */
const CATEGORY_BLURB = {
    'Handmade Products': 'Crafted by hand by artisans in Odisha using traditional techniques.',
    'Home Décor': 'A handmade touch for living rooms, balconies and workspaces.',
    'Wall Décor and Handcrafted Art': 'Handcrafted wall art that turns a plain wall into a story.',
    'Customized Gifts': 'Personalise it with a name or message — made to order in 3–5 working days.',
    'Personalized Gift Hampers': 'A thoughtfully packed hamper, ready to gift.',
    'Diwali Gifts and Festive Hampers': 'Festive favourites to light up your Diwali.',
    'Decorative and Scented Candles': 'Hand-poured candles for gifting and for glowing evenings.',
    'Bulk Candle Orders': 'Candles in bulk for weddings, events and festivals.',
    'Corporate and Bulk Gifting': 'Premium gift boxes with optional custom branding.',
    'Handmade Gift Sets': 'Curated handmade sets, beautifully packed.',
    'Eco-Friendly and Sustainable Gifts': 'Natural, reusable and plastic-light gifting.',
    'Festival Decorations': 'Decorations that make every festival feel special.',
};
export const describe = (p) => p.live ? (p.description?.trim() || `${p.name}. ${CATEGORY_BLURB[p.category] ?? ''}`)
    : `${p.name}. ${CATEGORY_BLURB[p.category] ?? ''} (Demo description — replace with your real product details.)`;
export const isCustomizable = (p) => p.customizable ?? (p.tags.includes('custom') || p.category === 'Customized Gifts');

/* Sample size/weight/pack data for the demo catalogue: [pieces in pack, weight g, length cm, width cm, height cm]. */
const SPEC_ROWS = {
    'jute-wall-hanging': [1, 350, 45, 4, 70], 'terracotta-diya-set': [12, 900, 20, 15, 8], 'madhubani-tray': [1, 600, 35, 25, 4],
    'macrame-planter': [1, 250, 20, 20, 60], 'pattachitra-frame': [1, 900, 40, 3, 30], 'dhokra-elephant': [1, 750, 14, 8, 12],
    'jasmine-candle': [1, 300, 8, 8, 9], 'rose-floating-candles': [6, 220, 12, 8, 4], 'sandalwood-pillar': [1, 280, 7, 7, 12],
    'lavender-tin': [1, 120, 6, 6, 4], 'lotus-gel-candle': [1, 260, 8, 8, 9], 'photo-frame': [1, 500, 24, 3, 20],
    'name-mug': [1, 380, 12, 9, 10], 'engraved-pen': [2, 120, 18, 6, 3], 'custom-keychain': [1, 40, 8, 4, 0.5],
    'story-journal': [1, 320, 21, 15, 2], 'diwali-grand-hamper': [8, 2200, 40, 30, 15], 'sweets-diya-hamper': [6, 1500, 32, 24, 10],
    'wellness-hamper': [5, 1400, 30, 22, 12], 'eco-hamper': [6, 1600, 34, 26, 16], 'rangoli-kit': [8, 450, 30, 25, 4],
    'toran-door': [1, 300, 100, 15, 3], 'brass-diya-lamp': [1, 650, 15, 10, 20], 'corporate-box': [4, 1000, 30, 22, 8],
};
export const DEMO_SPECS = Object.fromEntries(Object.entries(SPEC_ROWS).map(([id, [packQty, weightGrams, lengthCm, widthCm, heightCm]]) => [id, { packQty, weightGrams, lengthCm, widthCm, heightCm, processingDays: 3 }]));
