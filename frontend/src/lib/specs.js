/* Helpers that turn a product's raw numbers into the rows shown in "Product details". */
const trim = (n) => String(Math.round(n * 100) / 100);
export const formatWeight = (g) => (!g || g <= 0 ? '' : g >= 1000 ? `${trim(g / 1000)} kg` : `${trim(g)} g`);
export const formatCm = (cm) => (!cm || cm <= 0 ? '' : `${trim(cm)} cm`);
/** Rows for the product page. A row is left out when the shop has not filled in that number. */
export function productFacts(p) {
    const s = p.specs;
    if (!s)
        return [];
    const rows = [];
    if (s.packQty > 0)
        rows.push(['Quantity in 1 pack', `${s.packQty} ${s.packQty === 1 ? 'piece' : 'pieces'}`]);
    if (s.weightGrams > 0)
        rows.push(['Weight', formatWeight(s.weightGrams)]);
    if (s.heightCm > 0)
        rows.push(['Height', formatCm(s.heightCm)]);
    if (s.lengthCm > 0)
        rows.push(['Length', formatCm(s.lengthCm)]);
    if (s.widthCm > 0)
        rows.push(['Width', formatCm(s.widthCm)]);
    if (s.processingDays > 0)
        rows.push(['Ready to ship in', `${s.processingDays} ${s.processingDays === 1 ? 'day' : 'days'}`]);
    return rows;
}
