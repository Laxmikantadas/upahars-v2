import { useEffect, useRef, useState } from 'react';
/** Big picture + thumbnail strip for every product image (up to 8). Falls back to the emoji when there is no photo. */
export default function ProductGallery({ images = [], name, from, to, emoji, demo }) {
    const list = images.filter(Boolean);
    const [i, setI] = useState(0);
    const [broken, setBroken] = useState(() => new Set());
    const touchX = useRef(null);
    useEffect(() => { setI(0); setBroken(new Set()); }, [list[0], list.length]); // eslint-disable-line react-hooks/exhaustive-deps
    const n = list.length;
    const go = (d) => setI((x) => (x + d + n) % n);
    const onKey = (e) => {
        if (n < 2)
            return;
        if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    };
    const onTouchEnd = (e) => {
        if (touchX.current == null || n < 2)
            return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        touchX.current = null;
        if (Math.abs(dx) > 40)
            go(dx < 0 ? 1 : -1);
    };
    const showPhoto = n > 0 && !broken.has(i);
    const arrow = 'absolute top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-2xl leading-none text-burgundy-700 shadow transition hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-gold';
    return (<div>
      <div role="group" aria-roledescription="carousel" aria-label={`${name} pictures`} tabIndex={n > 1 ? 0 : undefined} onKeyDown={onKey} onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }} onTouchEnd={onTouchEnd} className="relative flex aspect-square items-center justify-center overflow-hidden rounded-3xl text-[8rem] shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-gold" style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}>
        {showPhoto
            ? <img key={list[i]} src={list[i]} alt={`${name} — picture ${i + 1} of ${n}`} className="absolute inset-0 h-full w-full object-cover" onError={() => setBroken((b) => new Set(b).add(i))}/>
            : <span aria-hidden="true" className="drop-shadow-lg">{emoji}</span>}
        {n > 1 && (<>
            <button type="button" aria-label="Previous picture" onClick={() => go(-1)} className={`${arrow} left-2`}>‹</button>
            <button type="button" aria-label="Next picture" onClick={() => go(1)} className={`${arrow} right-2`}>›</button>
            <span aria-live="polite" className="absolute bottom-3 left-3 rounded-full bg-black/55 px-2.5 py-0.5 text-xs font-semibold text-white">{i + 1} / {n}</span>
          </>)}
        {demo && <span className="absolute bottom-3 right-3 rounded bg-white/80 px-2 py-0.5 text-[10px] font-semibold uppercase text-neutral-600">Demo image</span>}
      </div>
      {n > 1 && (<ul className="no-scrollbar mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Choose a picture">
          {list.map((src, k) => (<li key={src + k} className="shrink-0">
              <button type="button" onClick={() => setI(k)} aria-label={`Show picture ${k + 1} of ${n}`} aria-current={k === i ? 'true' : undefined} className={`block h-16 w-16 overflow-hidden rounded-xl border-2 bg-white transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gold sm:h-20 sm:w-20 ${k === i ? 'border-burgundy shadow' : 'border-gold/30 opacity-75 hover:opacity-100'}`}>
                <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}/>
              </button>
            </li>))}
        </ul>)}
    </div>);
}
