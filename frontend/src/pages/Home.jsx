import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BRAND } from '../lib/brand';
import Section, { Rail } from '../components/Section';
import ProductCard from '../components/ProductCard';
import { categoryPath } from '../lib/seo';
import CategoryAvatar from '../components/CategoryAvatar';
import { CATEGORY_ICONS, OCCASIONS, TESTIMONIALS, } from '../data/demo';
import { getRecent } from '../lib/recent';
import { describeOffer, rupees } from '../lib/catalog';
import { useStore } from '../lib/store';
import PolaroidLineCarousel from '../components/ui/polaroid-line-carousel';
// Fallback list used before the live (admin-managed) categories load.
export const LAUNCH_CATEGORIES = Object.keys(CATEGORY_ICONS);
/* ---------- 1. Hero carousel ---------- */
const SLIDES = [
    { kicker: 'Festival of Lights', title: 'Light up Diwali with handmade gifts', text: 'Festive hampers, hand-painted diyas and décor — up to 25% off (demo offer).', cta: 'Shop Diwali', to: '/categories?name=Diwali%20Gifts%20and%20Festive%20Hampers', bg: 'from-burgundy-800 via-burgundy to-burgundy-500' },
    { kicker: 'Made just for them', title: 'Personalize every gift', text: 'Add names, messages and themes to frames, mugs, journals and hampers.', cta: 'Customize a gift', to: '/categories?name=Customized%20Gifts', bg: 'from-[#5b3a1a] via-[#8a5a24] to-gold' },
    { kicker: 'Glow with fragrance', title: 'Scented & decorative candles', text: 'Soy wax, floating and pillar candles — also available in bulk for events.', cta: 'Explore candles', to: '/categories?name=Decorative%20and%20Scented%20Candles', bg: 'from-[#3b1d4a] via-[#6b2b6f] to-[#b83280]' },
];
function Hero() {
    const { banners } = useStore();
    // Banners the administrator created replace the built-in slides.
    const slides = useMemo(() => {
        const live = banners.filter((b) => b.placement === 'home_hero');
        return live.length
            ? live.map((b, n) => ({ kicker: 'Upahars', title: b.title, text: b.subtitle, cta: 'Shop now', to: b.link, bg: SLIDES[n % SLIDES.length].bg, image: b.image }))
            : SLIDES.map((s) => ({ ...s, image: null }));
    }, [banners]);
    const [i, setI] = useState(0);
    const [paused, setPaused] = useState(false);
    useEffect(() => {
        if (paused || slides.length < 2)
            return;
        const t = setInterval(() => setI((x) => (x + 1) % slides.length), 5500);
        return () => clearInterval(t);
    }, [paused, slides.length]);
    const s = slides[i % slides.length];
    const go = (n) => setI((n + slides.length) % slides.length);
    return (<section aria-roledescription="carousel" aria-label="Featured offers" className={`relative overflow-hidden bg-gradient-to-br ${s.bg} text-cream transition-colors duration-700`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="pointer-events-none absolute -right-16 -top-16 h-72 w-72 rounded-full bg-gold/25 blur-3xl"/>
      <div className="pointer-events-none absolute -bottom-20 left-10 h-64 w-64 rounded-full bg-white/10 blur-3xl"/>
      <div className="container-page relative grid items-center gap-4 py-10 md:grid-cols-[1.2fr_1fr] md:py-14">
        <div key={i} aria-live="polite">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-300">{s.kicker}</p>
          <h1 className="mt-2 text-4xl font-bold leading-tight !text-cream md:text-6xl">{s.title}</h1>
          <p className="mt-3 max-w-lg text-cream/90">{s.text}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link to={s.to} className="btn-gold">{s.cta}</Link>
            <Link to="/bulk-orders" className="btn-outline">Bulk &amp; corporate</Link>
          </div>
        </div>
        <div className="flex justify-center">
          {s.image
            ? <img src={s.image} alt="" className="h-44 w-full max-w-md rounded-[2rem] object-cover shadow-2xl ring-4 ring-gold/40 md:h-64"/>
            : (<div className="floaty rounded-[2rem] bg-cream/95 p-5 shadow-2xl ring-4 ring-gold/40">
                <img src={BRAND.logo} alt={`${BRAND.name} — ${BRAND.tagline}`} className="h-44 w-auto md:h-64"/>
              </div>)}
        </div>
      </div>
      <div className="relative flex items-center justify-center gap-3 pb-4">
        <button type="button" onClick={() => go(i - 1)} aria-label="Previous slide" className="rounded-full bg-white/15 px-3 py-1 text-lg hover:bg-white/25">‹</button>
        {slides.map((_, n) => (<button key={n} type="button" onClick={() => setI(n)} aria-label={`Go to slide ${n + 1}`} aria-current={n === i} className={`h-2.5 rounded-full transition-all ${n === i ? 'w-7 bg-gold' : 'w-2.5 bg-white/50'}`}/>))}
        <button type="button" onClick={() => go(i + 1)} aria-label="Next slide" className="rounded-full bg-white/15 px-3 py-1 text-lg hover:bg-white/25">›</button>
      </div>
    </section>);
}
/* ---------- trust strip ---------- */
const TRUST = [
    ['🤲', '100% handmade'], ['🚚', 'Pan-India delivery'], ['🔒', 'Secure online payment'], ['🎁', 'Free gift wrapping offers'],
];
function TrustStrip() {
    return (<div className="border-y border-gold/30 bg-white/70">
      <ul className="container-page grid grid-cols-2 gap-2 py-3 text-xs font-medium text-burgundy-700 md:grid-cols-4 md:text-sm">
        {TRUST.map(([e, t]) => (<li key={t} className="flex items-center justify-center gap-2"><span className="text-lg">{e}</span>{t}</li>))}
      </ul>
    </div>);
}
/* ---------- polaroid carousel under the hero (pictures, names and descriptions come from Admin → Home carousel) ---------- */
const PALETTE_CYCLE = ['dawn', 'dusk', 'mist', 'alpine'];
// Shown only while the server is unreachable (demo mode); pictures are painted placeholders.
const DEMO_SHOWCASE = [
    { id: 'd1', title: 'Hand-painted Diyas', caption: 'Terracotta lamps, painted one at a time.' },
    { id: 'd2', title: 'Festive Hampers', caption: 'Ready-to-gift boxes for every celebration.' },
    { id: 'd3', title: 'Scented Candles', caption: 'Soy wax, hand-poured in small batches.' },
    { id: 'd4', title: 'Handloom Ribbons', caption: 'A little Odisha in every wrapping.' },
];
function Moments() {
    const { showcase, isLive } = useStore();
    const slides = useMemo(() => (isLive ? showcase : DEMO_SHOWCASE).map((s, n) => ({
        id: s.id, image: s.image || undefined, title: s.title, caption: s.caption || undefined, alt: s.title,
        palette: PALETTE_CYCLE[n % PALETTE_CYCLE.length], seed: n + 3,
    })), [showcase, isLive]);
    // Live: show exactly what the administrator published (nothing published → no section).
    if (!slides.length)
        return null;
    return (<section aria-label="Moments from Upahars" className="reveal bg-cream-200 pt-8 md:pt-12">
      <div className="container-page">
        <h2 className="text-2xl font-bold md:text-3xl">Little Moments, Handmade</h2>
        <p className="mt-0.5 text-sm text-neutral-600">Drag the string, or tap a picture, to look closer</p>
        <span className="mt-2 flex items-center gap-1.5" aria-hidden="true"><span className="h-0.5 w-14 rounded bg-gold"/><span className="h-1.5 w-1.5 rotate-45 bg-gold"/></span>
      </div>
      <PolaroidLineCarousel slides={slides} height="clamp(440px, 72svh, 620px)" cardWidth={270} sag={40} autoplay={5000} string="#C58F3C" background="#F7EDD6" ink="#4A0A0F" ariaLabel="Moments from Upahars"/>
    </section>);
}
/* ---------- 3. Diwali offers with countdown ---------- */
const DIWALI_2026 = new Date('2026-11-08T00:00:00+05:30').getTime();
function useCountdown(target) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
    const diff = Math.max(0, target - now);
    return {
        d: Math.floor(diff / 86400000),
        h: Math.floor(diff / 3600000) % 24,
        m: Math.floor(diff / 60000) % 60,
        s: Math.floor(diff / 1000) % 60,
    };
}
const DIWALI_OFFERS = [
    { code: 'DEMODIWALI15', title: '15% off', note: 'On orders above ₹999' },
    { code: 'DEMOFIRST100', title: '₹100 off', note: 'First order, above ₹499' },
    { code: 'FREEWRAP', title: 'Free gift wrap', note: 'Tick gift wrap in cart' },
];
function DiwaliOffers() {
    const { isLive, offers } = useStore();
    const c = useCountdown(DIWALI_2026);
    const [copied, setCopied] = useState('');
    const copy = async (code) => {
        try {
            await navigator.clipboard.writeText(code);
            setCopied(code);
            setTimeout(() => setCopied(''), 1800);
        }
        catch {
            setCopied('');
        }
    };
    // Live: show exactly the offers the administrator published (none published → no section).
    const list = isLive
        ? offers.map((o) => ({ code: o.code, title: o.title || describeOffer(o), note: o.description || (o.minOrderPaise ? `On orders above ₹${rupees(o.minOrderPaise)}` : 'Apply in your cart') }))
        : DIWALI_OFFERS;
    if (isLive && !list.length)
        return null;
    return (<Section tone="dark" title="Diwali Special Offers" subtitle={isLive ? 'Apply a code in your cart at checkout' : 'Demo coupons — apply them in your cart to test checkout'} to="/categories?name=Diwali%20Gifts%20and%20Festive%20Hampers">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <span className="text-sm text-cream/80">Diwali starts in</span>
        {[['d', 'Days'], ['h', 'Hrs'], ['m', 'Min'], ['s', 'Sec']].map(([k, label]) => (<div key={k} className="min-w-[3.5rem] rounded-lg bg-cream/10 px-3 py-1.5 text-center ring-1 ring-gold/40">
            <div className="text-xl font-bold tabular-nums text-gold-300">{String(c[k]).padStart(2, '0')}</div>
            <div className="text-[10px] uppercase tracking-wider text-cream/70">{label}</div>
          </div>))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {list.map((o) => (<div key={o.code} className="rounded-2xl border border-gold/50 bg-gradient-to-br from-burgundy-600 to-burgundy-800 p-4">
            <p className="text-3xl font-bold text-gold-300">{o.title}</p>
            <p className="text-sm text-cream/80">{o.note}</p>
            <button type="button" onClick={() => copy(o.code)} className="mt-3 rounded-md border border-dashed border-gold px-3 py-1 font-mono text-xs tracking-wider text-gold-300 hover:bg-gold/10">
              {copied === o.code ? 'Copied ✓' : `Copy ${o.code}`}
            </button>
          </div>))}
      </div>
      {!isLive && <p className="mt-3 text-xs text-cream/60">Demo coupons work in this MVP. In production they will be validated on the server.</p>}
    </Section>);
}
/* ---------- 10. Recently viewed ---------- */
function RecentlyViewed() {
    const { products } = useStore();
    const [ids, setIds] = useState([]);
    useEffect(() => setIds(getRecent()), []);
    const items = useMemo(() => ids.map((id) => products.find((p) => p.id === id)).filter((p) => Boolean(p)), [ids, products]);
    return (<Section title="Recently Viewed" subtitle="Pick up where you left off">
      {items.length ? (<Rail>{items.map((p) => <ProductCard key={p.id} product={p}/>)}</Rail>) : (<p className="rounded-xl border border-dashed border-gold/50 bg-white/60 p-6 text-center text-sm text-neutral-600">
          Products you open will appear here.
        </p>)}
    </Section>);
}
/* ---------- 12. Newsletter ---------- */
function Newsletter() {
    const [email, setEmail] = useState('');
    const [state, setState] = useState('idle');
    const onSubmit = (e) => {
        e.preventDefault();
        const ok = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
        if (!ok)
            return setState('err');
        // Demo: no subscriber table/provider is connected yet, so nothing is sent anywhere.
        setState('ok');
        setEmail('');
    };
    return (<section className="bg-gradient-to-r from-burgundy-800 to-burgundy py-10 text-cream">
      <div className="container-page grid items-center gap-4 md:grid-cols-2">
        <div>
          <h2 className="text-3xl font-bold !text-gold-300">Join the Upahars family</h2>
          <p className="mt-1 text-cream/85">Festive offers and new handmade arrivals, straight to your inbox.</p>
        </div>
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="nl-email" className="sr-only">Email address</label>
          <input id="nl-email" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setState('idle'); }} placeholder="you@example.com" className="flex-1 rounded-lg px-4 py-2.5 text-sm text-neutral-800 outline-none ring-gold focus:ring-2"/>
          <button type="submit" className="btn-gold">Subscribe</button>
        </form>
        <p className="text-xs md:col-start-2" role="status">
          {state === 'ok' && <span className="text-gold-300">Thanks! (Demo mode — subscriptions are not stored until the newsletter backend is connected.)</span>}
          {state === 'err' && <span className="text-red-200">Please enter a valid email address.</span>}
        </p>
      </div>
    </section>);
}
/* ---------- new sections ---------- */
const COLLECTIONS = [
    { title: 'Festive Hampers', text: 'Ready-to-gift boxes for Diwali and beyond', emoji: '🎁', to: '/hampers', bg: 'from-burgundy-800 to-burgundy-500' },
    { title: 'Scented Candles', text: 'Soy, floating and pillar candles, hand-poured', emoji: '🕯️', to: '/categories?name=Decorative%20and%20Scented%20Candles', bg: 'from-[#3b1d4a] to-[#b83280]' },
    { title: 'Handmade Décor', text: 'Wall art and home pieces from Odisha artisans', emoji: '🖼️', to: '/categories?name=Wall%20D%C3%A9cor%20and%20Handcrafted%20Art', bg: 'from-[#8a5a24] to-gold' },
];
function Collections() {
    return (<section className="py-6 md:py-8">
      <div className="container-page grid gap-4 md:grid-cols-3">
        {COLLECTIONS.map((c) => (<Link key={c.title} to={c.to} className={`group relative flex min-h-[10rem] flex-col justify-end overflow-hidden rounded-3xl bg-gradient-to-br ${c.bg} p-5 text-cream shadow-lg ring-1 ring-gold/40 transition duration-300 hover:-translate-y-1 hover:shadow-2xl`}>
            <span aria-hidden="true" className="absolute -right-3 -top-3 text-[6.5rem] opacity-25 transition duration-300 group-hover:rotate-6 group-hover:scale-110">{c.emoji}</span>
            <h3 className="text-2xl font-bold !text-cream">{c.title}</h3>
            <p className="mt-1 max-w-[16rem] text-sm text-cream/85">{c.text}</p>
            <span className="mt-3 text-sm font-semibold text-gold-300">Shop now <span className="inline-block transition group-hover:translate-x-1">→</span></span>
          </Link>))}
      </div>
    </section>);
}
function Occasions() {
    return (<Section tone="soft" title="Shop by Occasion" subtitle="Find the right gift for every celebration" to="/categories?name=Customized%20Gifts" toLabel="Personalized gifts">
      <div className="grid grid-cols-3 gap-3 md:grid-cols-6 md:gap-4">
        {OCCASIONS.map((o) => (<Link key={o.name} to={`/search?q=${encodeURIComponent(o.name)}`} className="group flex flex-col items-center gap-2 rounded-2xl p-4 text-center text-white shadow-md ring-1 ring-white/40 transition duration-300 hover:-translate-y-1 hover:shadow-xl" style={{ background: `linear-gradient(135deg, ${o.from}, ${o.to})` }}>
            <span className="text-4xl drop-shadow transition duration-300 group-hover:scale-125">{o.emoji}</span>
            <span className="text-xs font-semibold md:text-sm">{o.name}</span>
          </Link>))}
      </div>
    </Section>);
}
const STEPS = [
    ['1', '🎁', 'Pick a gift', 'Choose a frame, mug, journal, candle or a hamper.'],
    ['2', '✍️', 'Add your touch', 'Type a name, a message or a theme on the product page.'],
    ['3', '🚚', 'We craft & deliver', 'Made to order in 3–5 working days, packed ready to gift.'],
];
function HowItWorks() {
    return (<Section title="Personalize in 3 Easy Steps" subtitle="Add a name, a message, a memory">
      <ol className="grid gap-4 md:grid-cols-3">
        {STEPS.map(([n, e, t, d]) => (<li key={n} className="relative rounded-2xl border border-gold/40 bg-white p-5 pt-8 text-center shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
            <span className="absolute -top-4 left-1/2 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full bg-burgundy text-sm font-bold text-gold-300 ring-4 ring-cream">{n}</span>
            <span className="text-4xl" aria-hidden="true">{e}</span>
            <h3 className="mt-2 text-xl font-bold">{t}</h3>
            <p className="mt-1 text-sm text-neutral-600">{d}</p>
          </li>))}
      </ol>
      <div className="mt-6 text-center">
        <Link to="/categories?name=Customized%20Gifts" className="btn-primary">Start personalizing</Link>
      </div>
    </Section>);
}
const WHY = [
    ['🤲', 'Handcrafted in Odisha', 'Every piece is made by hand using traditional techniques.'],
    ['✨', 'Made just for them', 'Names, messages and themes on frames, mugs, journals and more.'],
    ['🎀', 'Gift-ready packing', 'Arrives beautifully packed, with gift wrapping offers.'],
    ['💼', 'Bulk & corporate', 'Custom branding and quotations for events and teams.'],
];
function WhyUpahars() {
    return (<Section tone="soft" title="Why Upahars" subtitle="Gifts with a story, made with care">
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {WHY.map(([e, t, d]) => (<li key={t} className="rounded-2xl border border-gold/30 bg-white p-4 text-center shadow-sm transition hover:-translate-y-1 hover:border-gold hover:shadow-lg">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-cream-200 to-gold-300/60 text-3xl ring-2 ring-gold/40" aria-hidden="true">{e}</span>
            <h3 className="mt-3 text-lg font-bold leading-tight">{t}</h3>
            <p className="mt-1 text-xs text-neutral-600 md:text-sm">{d}</p>
          </li>))}
      </ul>
    </Section>);
}
function OurStory() {
    return (<section className="py-8 md:py-10">
      <div className="container-page">
        <div className="grid items-center gap-6 overflow-hidden rounded-3xl border border-gold/40 bg-gradient-to-br from-white to-cream-200 p-6 shadow-lg md:grid-cols-[auto_1fr] md:p-10">
          <img src={BRAND.logo} alt={BRAND.name} className="mx-auto h-36 w-auto md:h-48"/>
          <div className="text-center md:text-left">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-600">Our story</p>
            <h2 className="mt-1 text-3xl font-bold md:text-4xl">{BRAND.tagline}</h2>
            <p className="mt-2 max-w-xl text-neutral-700">Upahars brings handmade gifts, home décor and candles from skilled artisans to your doorstep. Each purchase supports traditional craft and the people behind it.</p>
            <div className="mt-4 flex flex-wrap justify-center gap-3 md:justify-start">
              <Link to="/about" className="btn-primary">Read our story</Link>
              <Link to="/bulk-orders" className="btn-ghost">Bulk &amp; corporate</Link>
            </div>
          </div>
        </div>
      </div>
    </section>);
}
export default function Home() {
    const { products, categories, isLive } = useStore();
    const byTag = (tag) => products.filter((p) => p.tags.includes(tag));
    return (<>
      <Hero /> {/* 1 */}
      <TrustStrip />

      <Moments />

      {/* 2 */}
      <Section title="Shop by Category" subtitle="Twelve ways to find the perfect handmade gift" to="/categories">
        <ul className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-6 md:gap-5 md:overflow-visible md:px-0">
          {categories.map((c) => { const { name, icon, image } = c; return (<li key={name} className="w-24 shrink-0 md:w-auto">
              <Link to={categoryPath(c)} className="group flex flex-col items-center gap-2 text-center">
                <CategoryAvatar image={image} icon={icon} name={name} className="h-20 w-20 transition group-hover:scale-105 group-hover:ring-burgundy md:h-24 md:w-24"/>
                <span className="text-xs font-medium leading-tight text-burgundy-700 md:text-sm">{name}</span>
              </Link>
            </li>); })}
        </ul>
      </Section>

      <Collections />

      <DiwaliOffers /> {/* 3 */}

      {/* 4 — products the administrator marks "Trending" */}
      {(!isLive || byTag('trending').length > 0) && (<Section title="Trending Handmade Products" subtitle="Loved by customers this week" to="/categories">
        <Rail>{byTag('trending').map((p) => <ProductCard key={p.id} product={p}/>)}</Rail>
      </Section>)}

      {/* 5 — products the administrator marks "Best seller" */}
      {(!isLive || byTag('best').length > 0) && (<Section tone="soft" title="Best Sellers" subtitle="Our most-gifted pieces" to="/categories">
        <Rail>{byTag('best').map((p) => <ProductCard key={p.id} product={p}/>)}</Rail>
      </Section>)}

      <Occasions />

      <Section tone="soft" title="Personalized Gift Hampers" subtitle="Build your own or pick a ready-made hamper" to="/hampers" toLabel="Build a hamper"> {/* 7 */}
        <Rail>{byTag('hamper').map((p) => <ProductCard key={p.id} product={p}/>)}</Rail>
      </Section>

      <Section title="Decorative Candle Collection" subtitle="Soy, floating, pillar and gel candles" to="/categories?name=Decorative%20and%20Scented%20Candles"> {/* 8 */}
        <Rail>{byTag('candle').map((p) => <ProductCard key={p.id} product={p}/>)}</Rail>
      </Section>

      {/* 9 */}
      <section className="py-8 md:py-10">
        <div className="container-page">
          <div className="grid overflow-hidden rounded-3xl bg-gradient-to-br from-burgundy-800 to-burgundy text-cream shadow-xl md:grid-cols-2">
            <div className="p-6 md:p-10">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold-300">Bulk &amp; corporate gifting</p>
              <h2 className="mt-2 text-3xl font-bold !text-cream md:text-4xl">Candles and gifts by the hundred</h2>
              <ul className="mt-3 space-y-1 text-sm text-cream/90">
                <li>✓ Custom branding and packaging</li>
                <li>✓ Quantity-based pricing through a personal quotation</li>
                <li>✓ Weddings, events, festivals and corporate gifting</li>
              </ul>
              <Link to="/bulk-orders" className="btn-gold mt-5">Request a quotation</Link>
            </div>
            <div className="grid grid-cols-3 place-items-center gap-3 bg-black/15 p-6 text-5xl md:text-6xl" aria-hidden="true">
              <span>🕯️</span><span>🎁</span><span>📦</span><span>💼</span><span>🪔</span><span>🎀</span>
            </div>
          </div>
        </div>
      </section>

      <HowItWorks />
      <WhyUpahars />
      <OurStory />

      <RecentlyViewed /> {/* 10 */}

      {/* 11 */}
      <Section tone="soft" title="What Our Customers Say" subtitle="Demo testimonials — real reviews appear once customers review purchases">
        <div className="grid gap-4 md:grid-cols-3">
          {TESTIMONIALS.map((t) => (<figure key={t.name} className="rounded-2xl border border-gold/30 bg-white p-5 shadow-sm">
              <p className="text-gold" aria-label={`${t.rating} out of 5 stars`}>{'★'.repeat(t.rating)}{'☆'.repeat(5 - t.rating)}</p>
              <blockquote className="mt-2 text-sm text-neutral-700">{t.text}</blockquote>
              <figcaption className="mt-3 text-xs font-semibold text-burgundy-700">{t.name} · {t.city}</figcaption>
            </figure>))}
        </div>
      </Section>

      <Newsletter /> {/* 12 */}
    </>);
}
