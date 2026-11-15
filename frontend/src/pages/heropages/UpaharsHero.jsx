import { useEffect, useState } from "react";
// Put the 3 images in ./assets (or pass your own via props)
import photo from "../../../assets/hero-photo.jpg";
import decor from "../../../assets/hero-decor.jpg";
import poster from "../../../assets/hero-poster.jpg";
// Demo product thumbnails (cropped from the hero photo). Use your real product images in `orders`.
import pEarrings from "../../../assets/prod-earrings.jpg";
import pBouquet from "../../../assets/prod-bouquet.jpg";
import pCandle from "../../../assets/prod-candle.jpg";
import pHamper from "../../../assets/prod-hamper.jpg";

/* Tailwind handles layout/colors. This small block only holds what Tailwind can't:
   fonts, keyframes and image masks. Everything lives in this one file. */
const CSS = `
@import url("https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=Inter:wght@400;500;600&display=swap");
.uh-drift{animation:uh-drift 26s ease-in-out infinite alternate}
.uh-settle{transform:scale(1.05);animation:uh-settle 2.4s ease-out forwards}
.uh-up{transform:translateY(105%);animation:uh-up .9s cubic-bezier(.2,.8,.2,1) forwards}
.uh-draw{stroke-dasharray:700;stroke-dashoffset:700;animation:uh-draw 1.4s .7s ease forwards}
.uh-pop{transform-origin:center;transform-box:fill-box;transform:scale(0);animation:uh-pop .6s 1.9s cubic-bezier(.3,1.6,.5,1) forwards}
.uh-spin{animation:uh-spin 22s linear infinite}
.uh-pulse::after{content:"";position:absolute;inset:-2px;border-radius:9999px;border:2px solid rgba(255,255,255,.7);animation:uh-pulse 2.2s ease-out infinite}
.uh-tw{opacity:0;animation:uh-tw 4.5s ease-in-out infinite}
@keyframes uh-drift{to{transform:scale(1.08) translateX(-1.5%)}}
@keyframes uh-settle{to{transform:none}}
@keyframes uh-up{to{transform:none}}
@keyframes uh-draw{to{stroke-dashoffset:0}}
@keyframes uh-pop{to{transform:scale(1)}}
@keyframes uh-spin{to{transform:rotate(360deg)}}
@keyframes uh-pulse{to{transform:scale(1.55);opacity:0}}
@keyframes uh-tw{0%,100%{opacity:0;transform:translateY(0)}50%{opacity:1;transform:translateY(-14px)}}
.uh-mask-photo{-webkit-mask-image:linear-gradient(180deg,#000 72%,transparent 100%);mask-image:linear-gradient(180deg,#000 72%,transparent 100%)}
.uh-mask-decor{-webkit-mask-image:linear-gradient(0deg,#000 55%,transparent 100%),linear-gradient(90deg,#000 55%,transparent 100%);-webkit-mask-composite:source-in;mask-image:linear-gradient(0deg,#000 55%,transparent 100%),linear-gradient(90deg,#000 55%,transparent 100%);mask-composite:intersect}
@media (min-width:768px){.uh-mask-photo{-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 40%),linear-gradient(0deg,transparent 0,#000 22%);-webkit-mask-composite:source-in;mask-image:linear-gradient(90deg,transparent 0,#000 40%),linear-gradient(0deg,transparent 0,#000 22%);mask-composite:intersect}}
@media (prefers-reduced-motion:reduce){.uh *{animation:none!important}.uh-up,.uh-pop,.uh-settle{transform:none!important}.uh-draw{stroke-dashoffset:0!important}}
`;

// "Who are you gifting?" options. picks = [category slug, icon, label]
const J = ["jewellery", "💍", "Jewellery"], D = ["home-decor", "🏺", "Home décor"], B = ["bouquets", "💐", "Bouquets"], H = ["hampers", "🎁", "Gift boxes"];
const RECIPIENTS = [
  { id: "kuchupuchu", label: "Kuchupuchu", icon: "🧸", picks: [B, J, H] },
  { id: "mom", label: "Mom", icon: "👩", picks: [J, D, B] },
  { id: "dad", label: "Dad", icon: "👨", picks: [D, H] },
  { id: "girlfriend", label: "Girlfriend", icon: "💖", picks: [J, B, H] },
  { id: "her", label: "Her", icon: "💃", picks: [J, B, D] },
  { id: "him", label: "Him", icon: "🧔", picks: [H, D] },
];

/* Recent orders for the pop-up. Replace with real data from your API:
   { name, city, product, price, minsAgo, image, href }  (pass orders={[]} to hide) */
const DEMO_ORDERS = [
  { name: "Priya S.", city: "Pune", product: "Handcrafted Pearl Jhumka Earrings", price: 1299, minsAgo: 2, image: pEarrings, href: "/jewellery" },
  { name: "Rohit M.", city: "Delhi", product: "Lotus Floating Candle Décor", price: 449, minsAgo: 6, image: pCandle, href: "/home-decor" },
  { name: "Sneha K.", city: "Mumbai", product: "Dried Baby’s-Breath Bouquet", price: 799, minsAgo: 11, image: pBouquet, href: "/bouquets" },
  { name: "Aman G.", city: "Jaipur", product: "Upahars Festive Gift Box", price: 1499, minsAgo: 15, image: pHamper, href: "/hampers" },
];

const Ico = ({ children }) => (
  <svg viewBox="0 0 48 48" fill="none" stroke="#b9812a" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-[34px] w-[34px] flex-none md:h-11 md:w-11">
    {children}
  </svg>
);

const TRUST = [
  { t: "100% Handmade", s: "with Love", i: <Ico><path d="M24 8c4 6 4 12 0 16-4-4-4-10 0-16zM10 18c8 0 12 5 14 12-8 0-13-4-14-12zM38 18c-8 0-12 5-14 12 8 0 13-4 14-12zM12 34c8 6 16 6 24 0" /></Ico> },
  { t: "Pan-India Delivery", s: "Across 100+ Cities", i: <Ico><path d="M4 12h26v20H4zM30 18h8l6 7v7H30z" /><circle cx="14" cy="35" r="4" /><circle cx="37" cy="35" r="4" /></Ico> },
  { t: "Secure Online Payment", s: "Shop with Confidence", i: <Ico><path d="M24 5l16 6v12c0 10-7 17-16 20C15 40 8 33 8 23V11z" /><path d="M16 24l6 6 11-12" /></Ico> },
  { t: "Free Gift Wrapping", s: "Make it Extra Special", i: <Ico><path d="M7 18h34v8H7zM10 26h28v16H10zM24 18v24M24 18c-6 0-10-3-8-6s8 0 8 6zM24 18c6 0 10-3 8-6s-8 0-8 6z" /></Ico> },
];

const SPARKS = [["44%", "22%", 0], ["58%", "12%", 1.4], ["90%", "30%", 2.6], ["30%", "68%", 0.8], ["12%", "60%", 3.2]];
const focus = "focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-[#b9812a]";

export default function UpaharsHero({
  posterSrc = poster, // blurred full-bleed back poster
  photoSrc = photo, // sharp hero photo
  decorSrc = decor, // bottom-left decor strip
  orders = DEMO_ORDERS,
  cutoffHour = 17, // same-day dispatch cutoff (24h clock). Set to null to hide, and only keep it if it is true for your store
  onWatchStory = () => {},
}) {
  const [pin, setPin] = useState("");
  const [pinMsg, setPinMsg] = useState("");
  const [toast, setToast] = useState({ i: 0, show: false });
  const [dismissed, setDismissed] = useState(false);
  const [who, setWho] = useState(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (cutoffHour == null) return;
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, [cutoffHour]);

  useEffect(() => {
    if (!orders.length || dismissed) return;
    let n = 0, hideT, loopT;
    const show = () => {
      setToast({ i: n % orders.length, show: true });
      n += 1;
      hideT = setTimeout(() => setToast((t) => ({ ...t, show: false })), 4500);
    };
    const startT = setTimeout(() => { show(); loopT = setInterval(show, 9000); }, 3500);
    return () => { clearTimeout(startT); clearTimeout(hideT); clearInterval(loopT); };
  }, [orders, dismissed]);

  const checkPin = (e) => {
    e.preventDefault();
    const v = pin.trim();
    if (!/^[1-9][0-9]{5}$/.test(v)) return setPinMsg("Enter a valid 6-digit pincode.");
    // TODO: call your courier / delivery API here
    setPinMsg(`Good news! We deliver to ${v} in 3–6 days, with free gift wrapping.`);
  };

  const o = orders[toast.i];
  const sel = RECIPIENTS.find((r) => r.id === who);
  let cutoffMsg = null;
  // if (cutoffHour != null) {
  //   const c = new Date(now); c.setHours(cutoffHour, 0, 0, 0);
  //   const ms = c - now;
  //   if (ms > 0) {
  //     const h = Math.floor(ms / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  //     cutoffMsg = `Order within ${h ? h + "h " : ""}${m}m for same-day dispatch`;
  //   } else cutoffMsg = "Order now. We dispatch first thing tomorrow";
  // }

  return (
    <section className="uh relative flex flex-col overflow-hidden bg-[#f5dfc4] font-['Inter',system-ui,sans-serif] text-[#4a1a1f] md:min-h-[min(860px,100vh)]">
      <style>{CSS}</style>

      {/* back poster + readability veil */}
      <div aria-hidden="true" className="uh-drift absolute -inset-[4%] bg-cover bg-center" style={{ backgroundImage: `url(${posterSrc})` }} />
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 70% at 18% 90%,rgba(255,200,120,.5),transparent 70%),linear-gradient(100deg,rgba(251,238,221,.95) 0%,rgba(245,223,196,.82) 46%,rgba(237,201,165,.3) 100%)",
        }}
      />

      {SPARKS.map(([l, t, d], k) => (
        <span key={k} aria-hidden="true" className="uh-tw absolute z-[2] hidden h-[5px] w-[5px] rounded-full bg-[#fff3c4] shadow-[0_0_12px_3px_rgba(255,214,120,.8)] md:block" style={{ left: l, top: t, animationDelay: `${d}s` }} />
      ))}

      {/* copy */}
      <div className="relative z-[3] mx-auto w-full max-w-[1320px] px-5 pt-1.5 md:flex-1 md:px-[6vw] md:pt-[130px]">
        <div className="flex items-center gap-3.5 text-[11px] uppercase tracking-[.2em] text-[#6a0f1c] md:text-[13.5px] md:tracking-[.28em] before:hidden after:hidden md:before:block md:after:block before:h-px before:w-12 before:bg-[#b9812a] after:h-px after:w-12 after:bg-[#b9812a]">
          Jewellery · Home décor · Bouquets
        </div>
        <h1 className="mb-1 mt-3.5 max-w-[9.5em] md:mt-[22px] font-['DM_Serif_Display',serif] text-[46px] md:text-[clamp(46px,6.2vw,92px)] font-normal leading-[.98] tracking-[-.015em] text-[#6a0f1c]">
          <span className="block overflow-hidden pb-[.06em]"><b className="uh-up block font-normal">Make Every</b></span>
          <span className="block overflow-hidden pb-[.06em]"><b className="uh-up block font-normal" style={{ animationDelay: ".18s" }}>Moment Special</b></span>
        </h1>
        <svg viewBox="0 0 600 50" aria-hidden="true" className="block h-9 w-[min(600px,80%)] md:h-[50px] overflow-visible">
          <path className="uh-draw" d="M4 30 C140 4 330 8 560 38 S590 36 585 30" fill="none" stroke="#b9812a" strokeWidth="2.5" strokeLinecap="round" />
          <path className="uh-pop" d="M585 32 c-12-14-30-4-20 8 l20 14 20-14 c10-12-8-22-20-8z" transform="translate(-16 -14) scale(.9)" fill="none" stroke="#b9812a" strokeWidth="2.5" strokeLinejoin="round" />
        </svg>
        <p className="mb-[22px] mt-1.5 max-w-[26em] text-base md:mb-8 md:mt-2.5 md:text-[clamp(17px,1.5vw,20px)] leading-[1.65]">
          Handmade jewellery, home décor and fresh bouquets, crafted by artisans for the moments you want to remember.
        </p>

        <div className="flex gap-3.5 md:flex-wrap">
          <a href="/jewellery" className={`group inline-flex items-center gap-2 whitespace-nowrap rounded-full border-[1.5px] border-[#6a0f1c] bg-gradient-to-br from-[#8a1526] to-[#6a0f1c] flex-1 justify-center px-2.5 py-3.5 text-[14.5px] md:flex-none md:px-[30px] md:py-4 md:text-base font-semibold text-white no-underline shadow-[0_12px_26px_rgba(106,15,28,.3)] transition hover:-translate-y-0.5 hover:shadow-[0_16px_32px_rgba(106,15,28,.4)] ${focus}`}>
            <span aria-hidden="true">💍</span> Shop Now
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="hidden transition-transform group-hover:translate-x-1 md:block"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </a>
          <a href="/home-decor" className={`inline-flex items-center rounded-full border-[1.5px] border-[#6a0f1c] bg-white/40 flex-1 justify-center px-2.5 py-3.5 text-[14.5px] md:flex-none md:px-[30px] md:py-4 md:text-base font-semibold text-[#6a0f1c] no-underline transition hover:bg-white ${focus}`}>
            <span aria-hidden="true" className="mr-1.5">🏺</span> Explore Collections
          </a>
        </div>

        {/* hooks */}
        <div className="mt-[26px] max-w-[38em] md:mt-[34px]">
          {cutoffMsg && (
            <p className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#6a0f1c] px-3.5 py-1.5 text-[13px] font-medium text-[#f6dca0]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[#ffb43a]" />{cutoffMsg}
            </p>
          )}
          <p id="uh-who" className="mb-2.5 text-sm font-semibold text-[#6a0f1c]">Who are you gifting?</p>
          <div role="radiogroup" aria-labelledby="uh-who" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0">
            {RECIPIENTS.map((r) => {
              const on = who === r.id;
              return (
                <button key={r.id} type="button" role="radio" aria-checked={on} onClick={() => setWho(on ? null : r.id)}
                  className={`flex flex-none cursor-pointer items-center gap-2 rounded-full border py-1 pl-1 pr-3.5 text-sm font-medium transition hover:-translate-y-0.5 ${on ? "border-[#6a0f1c] bg-[#6a0f1c] text-white shadow-[0_8px_18px_rgba(106,15,28,.3)]" : "border-[rgba(185,129,42,.5)] bg-white/65 text-[#6a0f1c] hover:bg-white"} ${focus}`}>
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-[#ffe3a6] to-[#f2b75a] text-sm">{r.icon}</span>
                  {r.label}
                </button>
              );
            })}
          </div>
          <div aria-live="polite" className="mt-3 min-h-[40px]">
            {sel && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] text-[#6a0f1c]">Loved by {sel.label}:</span>
                {sel.picks.map(([slug, ico, label]) => (
                  <a key={slug} href={`/shop?for=${sel.id}&cat=${slug}`} className={`rounded-full border border-[rgba(185,129,42,.5)] bg-white/80 px-3.5 py-1.5 text-[13.5px] font-semibold text-[#6a0f1c] no-underline transition hover:-translate-y-0.5 hover:bg-white ${focus}`}>{ico} {label}</a>
                ))}
                <a href={`/shop?for=${sel.id}&max=999`} className={`rounded-full bg-[#b9812a] px-3.5 py-1.5 text-[13.5px] font-semibold text-white no-underline transition hover:-translate-y-0.5 ${focus}`}>Under ₹999</a>
              </div>
            )}
          </div>
          <form onSubmit={checkPin} className="mt-4 flex gap-2 md:max-w-[360px]">
            <input
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              maxLength={6}
              placeholder="Enter pincode"
              aria-label="Delivery pincode"
              className={`min-w-0 flex-1 rounded-full border border-[rgba(185,129,42,.5)] bg-white/75 px-4 py-[11px] text-sm font-medium text-[#4a1a1f] ${focus}`}
            />
            <button type="submit" className={`cursor-pointer rounded-full border-0 bg-[#6a0f1c] px-[18px] py-[11px] text-sm font-semibold text-white ${focus}`}>Check delivery</button>
          </form>
          <p aria-live="polite" className="ml-1 mt-2 min-h-5 text-[13.5px] text-[#6a0f1c]">{pinMsg}</p>
        </div>
      </div>

      {/* photo: first on mobile, right side on desktop. Seal + play sit on it */}
      <div className="relative z-[1] order-first aspect-[947/710] w-full md:absolute md:bottom-[110px] md:right-0 md:top-0 md:order-none md:aspect-auto md:w-[57%]">
        <div className="uh-mask-photo absolute inset-0">
          <img src={photoSrc} alt="A woman smiling at an Upahars box with flowers and candles" className="uh-settle block h-full w-full object-cover [object-position:30%_35%]" />
        </div>
      <a href="/offers" aria-label="Up to 25 percent off" className={`absolute right-3 top-3 z-[4] grid h-[92px] w-[92px] place-items-center no-underline md:right-[9%] md:top-[112px] md:h-[132px] md:w-[132px] ${focus}`}>
        <svg className="uh-spin absolute inset-0" viewBox="0 0 132 132" aria-hidden="true">
          <defs><path id="uh-c" d="M66 66 m-54 0 a54 54 0 1 1 108 0 a54 54 0 1 1 -108 0" /></defs>
          <circle cx="66" cy="66" r="64" fill="#6a0f1c" />
          <text fontFamily="Inter" fontSize="10.5" fontWeight="600" letterSpacing="2.2" fill="#f3cf7a"><textPath href="#uh-c">FESTIVE OFFER • HANDMADE WITH LOVE •</textPath></text>
        </svg>
        <span className="relative grid h-[62px] w-[62px] place-items-center rounded-full bg-gradient-to-br from-[#f3cf7a] to-[#c4912f] text-center text-[9px] font-semibold leading-[1.15] text-[#4a1208] shadow-[0_10px_24px_rgba(106,15,28,.35)] md:h-[88px] md:w-[88px] md:text-xs">
          <span>Up to<b className="block font-['DM_Serif_Display',serif] text-[20px] font-normal leading-none md:text-[28px]">25%</b>off</span>
        </span>
      </a>


      <button onClick={onWatchStory} className={`absolute bottom-[30px] right-3.5 z-[4] flex cursor-pointer flex-col items-center gap-2.5 border-0 bg-transparent text-center text-sm text-white [text-shadow:0_1px_8px_rgba(0,0,0,.45)] md:bottom-auto md:right-[9%] md:top-[46%] ${focus}`}>
        <i className="uh-pulse relative grid h-[54px] w-[54px] place-items-center rounded-full border-2 border-white bg-[rgba(60,10,16,.35)] backdrop-blur-sm md:h-[78px] md:w-[78px]">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
        </i>
        <span className="hidden md:block">Watch Our<br />Brand Story</span>
      </button>

      </div>
      <div aria-hidden="true" className="uh-mask-decor pointer-events-none absolute bottom-[110px] left-0 z-[2] hidden w-[min(46%,640px)]">
        <img src={decorSrc} alt="" className="block w-full" />
      </div>

      {/* live order pop-up: real buyer name, city and product image */}
      {o && !dismissed && (
        <div role="status" aria-live="polite" className={`absolute left-3 right-[112px] top-3 z-[6] transition duration-500 md:bottom-[140px] md:left-auto md:right-[3%] md:top-auto md:w-[350px] ${toast.show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0"}`}>
          <a href={o.href} className="flex items-center gap-3 rounded-2xl border border-[rgba(185,129,42,.35)] bg-[rgba(255,248,238,.96)] p-2 pr-8 text-[#6a0f1c] no-underline shadow-[0_14px_34px_rgba(106,15,28,.25)] md:p-2.5 md:pr-9">
            <img src={o.image} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} className="h-11 w-11 flex-none rounded-xl object-cover md:h-[60px] md:w-[60px]" />
            <span className="min-w-0 text-xs leading-snug md:text-[13px]">
              <span className="block truncate"><b>{o.name}</b> from {o.city} bought</span>
              <span className="block truncate font-semibold text-[#4a1a1f] md:text-sm">{o.product}</span>
              <span className="hidden items-center gap-1.5 text-xs text-[#7a4b3a] md:flex">
                <span>₹{o.price.toLocaleString("en-IN")}</span>·<span>{o.minsAgo <= 1 ? "just now" : `${o.minsAgo} min ago`}</span>·<span className="font-medium text-[#2f7d4f]">✔ Verified</span>
              </span>
            </span>
          </a>
          <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss notification" className="absolute right-1.5 top-1.5 grid h-6 w-6 cursor-pointer place-items-center rounded-full border-0 bg-transparent text-lg leading-none text-[#7a4b3a] hover:bg-black/5">×</button>
        </div>
      )}

      {/* trust strip */}
      <div className="relative z-[5] mx-auto mt-5 mb-6 grid w-[92%] max-w-[1340px] grid-cols-2 gap-y-3.5 rounded-[30px] border border-[rgba(185,129,42,.35)] bg-[rgba(255,248,238,.9)] px-2 py-[18px] shadow-[0_20px_50px_rgba(106,15,28,.18)] backdrop-blur-md md:mb-11 md:mt-0 md:grid-cols-4 md:py-[22px]">
        {TRUST.map((x) => (
          <div key={x.t} className="flex items-center gap-3 px-3.5 py-1 text-[#6a0f1c] md:gap-4 md:border-l md:border-[rgba(185,129,42,.45)] md:px-7 md:first:border-l-0">
            {x.i}
            <span><b className="block text-sm font-semibold md:text-[16.5px]">{x.t}</b><small className="text-[12.5px] text-[#6b3a3a] md:text-sm">{x.s}</small></span>
          </div>
        ))}
      </div>
    </section>
  );
}