/* One short "how it's made" line for product cards.
   Order: explicit per-product note -> keyword match on the name -> product type / tags -> generic fallback.
   Edit the lists below to change the wording. */
const BY_ID = {
    'jute-wall-hanging': 'Hand-woven by Odisha artisans from natural jute',
    'terracotta-diya-set': 'Hand-shaped and hand-painted by village potters',
    'madhubani-tray': 'Hand-painted Madhubani art on a wooden tray',
    'macrame-planter': 'Hand-knotted from cotton cord',
    'pattachitra-frame': 'Hand-painted by Pattachitra artists of Raghurajpur',
    'dhokra-elephant': 'Cast by hand using lost-wax Dhokra brass craft',
    'jasmine-candle': 'Hand-poured in small batches with soy wax',
    'photo-frame': 'Crafted from wood and personalised to order',
    'name-mug': 'Ceramic mug, printed with your name and message',
    'story-journal': 'Bound by hand with handmade paper',
};
const BY_KEYWORD = [
    [/candle/i, 'Hand-poured in small batches'],
    [/diya|terracotta/i, 'Hand-shaped and painted by local potters'],
    [/madhubani|pattachitra|painted|painting/i, 'Hand-painted by skilled artisans'],
    [/dhokra|brass/i, 'Cast by hand using traditional metal craft'],
    [/jute|macram|woven|weav/i, 'Hand-woven by artisans from natural fibres'],
    [/engrav/i, 'Engraved by hand on natural wood'],
    [/hamper|basket|box/i, 'Packed by hand with carefully chosen items'],
    [/toran|rangoli/i, 'Handmade by local craftspeople'],
];
const BY_TYPE = {
    candle: 'Hand-poured in small batches',
    hamper: 'Packed by hand with carefully chosen items',
    gift_box: 'Packed by hand with carefully chosen items',
    handmade: 'Handmade by skilled artisans',
    decor: 'Handcrafted décor piece',
    personalized: 'Made to order with your personal touch',
};
export function madeNote(p) {
    if (BY_ID[p.id])
        return BY_ID[p.id];
    const hit = BY_KEYWORD.find(([re]) => re.test(p.name));
    if (hit)
        return hit[1];
    if (p.tags?.includes('custom') || p.customizable)
        return 'Made to order with your personal touch';
    if (p.tags?.includes('hamper'))
        return BY_TYPE.hamper;
    if (p.tags?.includes('candle'))
        return BY_TYPE.candle;
    return BY_TYPE[p.productType] ?? 'Handmade with care in India';
}
/** 'best' tag wins over 'trending' so a card only ever carries one ribbon. */
export function popularBadge(p) {
    const t = p.tags ?? [];
    if (t.includes('best'))
        return { label: 'Bestseller', icon: '🏆', cls: 'bg-gold text-burgundy-900' };
    if (t.includes('trending'))
        return { label: 'Trending', icon: '🔥', cls: 'bg-orange-500 text-white' };
    return null;
}
