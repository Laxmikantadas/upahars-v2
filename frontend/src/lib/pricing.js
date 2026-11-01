// Pure pricing rules for the MVP (demo mode). When Supabase/Razorpay are connected,
// the SAME rules must be re-checked on the server (Edge Function) — never trust the browser.
export const SHIPPING_FEE = 65;
export const FREE_SHIPPING_ABOVE = 699; // on the amount after discount
export const GIFT_WRAP_FEE = 49;
// Demo coupons. They are active in demo mode so you can test checkout.
export const COUPONS = [
    { code: 'DEMODIWALI15', kind: 'percent', value: 15, minPurchase: 999, label: '15% off on orders above ₹999' },
    { code: 'DEMOFIRST100', kind: 'fixed', value: 100, minPurchase: 499, label: '₹100 off on orders above ₹499' },
    { code: 'FREEWRAP', kind: 'freewrap', value: 0, minPurchase: 0, label: 'Free gift wrap' },
];
export function computeTotals(lines, couponCode, giftWrap = false, coupons = COUPONS) {
    const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
    let discount = 0;
    let wrapFee = giftWrap && subtotal > 0 ? GIFT_WRAP_FEE : 0;
    let couponApplied;
    let couponError;
    const code = couponCode?.trim().toUpperCase();
    if (code && subtotal > 0) {
        const c = coupons.find((x) => x.code === code);
        if (!c)
            couponError = 'Invalid coupon code';
        else if (subtotal < c.minPurchase)
            couponError = `Add ₹${c.minPurchase - subtotal} more to use ${c.code}`;
        else if (c.kind === 'freewrap' && !giftWrap)
            couponError = 'Tick "Add gift wrapping" to use this code';
        else {
            couponApplied = c.code;
            if (c.kind === 'percent')
                discount = Math.floor((subtotal * c.value) / 100);
            if (c.kind === 'fixed')
                discount = Math.min(c.value, subtotal);
            if (c.kind === 'freewrap')
                wrapFee = 0;
        }
    }
    const afterDiscount = subtotal - discount;
    const shipping = subtotal === 0 || afterDiscount >= FREE_SHIPPING_ABOVE ? 0 : SHIPPING_FEE;
    return {
        subtotal, discount, wrap: wrapFee, shipping,
        total: afterDiscount + wrapFee + shipping,
        couponApplied, couponError,
    };
}
