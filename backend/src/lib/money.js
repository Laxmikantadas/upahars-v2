// All money is an integer number of paise (₹1 = 100 paise). Never floats.
export const bpsOf = (amount, bps) => Math.round((amount * bps) / 10000); // half-up, per line
export const inr = (paise) => '₹' + (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Split `total` across `weights` proportionally with no paise lost (largest remainder). */
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!weights.length) return [];
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const base = raw.map(Math.floor);
  let rest = total - base.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest--) base[order[k][1]] += 1;
  return base;
}
