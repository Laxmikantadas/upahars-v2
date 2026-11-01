import { useEffect, useRef, useState } from 'react';
import { isMuted, notify, setMuted, subscribe } from '../lib/notify';
const STYLE = {
    success: 'border-green-300 bg-green-50 text-green-900',
    cart: 'border-gold/60 bg-[#FFF6E3] text-burgundy-700',
    remove: 'border-neutral-300 bg-white text-neutral-800',
    info: 'border-sky-300 bg-sky-50 text-sky-900',
    error: 'border-red-300 bg-red-50 text-red-900',
    celebrate: 'border-pink-300 bg-pink-50 text-pink-900',
};
const BAR = { success: 'bg-green-400', cart: 'bg-gold', remove: 'bg-neutral-400', info: 'bg-sky-400', error: 'bg-red-400', celebrate: 'bg-pink-400' };
const MAX = 4;
function Toast({ t, onClose }) {
    const [paused, setPaused] = useState(false);
    const timer = useRef(null);
    const left = useRef(t.ms);
    const started = useRef(0);
    useEffect(() => {
        if (paused) {
            left.current -= Date.now() - started.current;
            clearTimeout(timer.current);
            return;
        }
        started.current = Date.now();
        timer.current = setTimeout(onClose, Math.max(400, left.current));
        return () => clearTimeout(timer.current);
    }, [paused, onClose]);
    return (<div role={t.kind === 'error' ? 'alert' : 'status'} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)} className={`cute-toast pointer-events-auto relative w-full overflow-hidden rounded-2xl border-2 shadow-lg ${STYLE[t.kind]}`}>
      <div className="flex items-start gap-3 p-3 pr-9">
        <span aria-hidden="true" className={`cute-toast-emoji flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/80 text-2xl shadow-inner ${t.kind === 'error' ? 'cute-wiggle' : ''}`}>{t.emoji}</span>
        <div className="min-w-0">
          <p className="text-sm font-extrabold leading-tight">{t.title}</p>
          <p className="mt-0.5 break-words text-sm leading-snug">{t.message}</p>
        </div>
      </div>
      <button type="button" onClick={onClose} aria-label="Dismiss notification" className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full text-base leading-none opacity-60 transition hover:bg-black/10 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-burgundy">×</button>
      <span aria-hidden="true" className={`cute-toast-bar absolute bottom-0 left-0 h-1 ${BAR[t.kind]}`} style={{ animationDuration: `${t.ms}ms`, animationPlayState: paused ? 'paused' : 'running' }}/>
    </div>);
}
export default function Toaster() {
    const [toasts, setToasts] = useState([]);
    useEffect(() => subscribe((e) => {
        if (e.type === 'toast')
            setToasts((l) => [...l.slice(-(MAX - 1)), e.toast]);
    }), []);
    const close = (id) => setToasts((l) => l.filter((x) => x.id !== id));
    return (<>
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-14 z-[100] mx-auto flex w-full max-w-sm flex-col gap-2 px-3 sm:inset-x-auto sm:right-4 sm:top-16 sm:mx-0 sm:px-0">
        {toasts.map((t) => <Toast key={t.id} t={t} onClose={() => close(t.id)}/>)}
      </div>
    </>);
}
/** Small bell button for the header: turns the notification sounds on/off (remembered on this device). */
export function SoundToggle({ className = '' }) {
    const [muted, setMute] = useState(isMuted);
    useEffect(() => subscribe((e) => { if (e.type === 'mute')
        setMute(e.muted); }), []);
    const flip = () => {
        const next = !muted;
        setMuted(next);
        if (!next)
            notify.info('Sounds are on', { title: 'Yay, sound!', emoji: '🔔' });
    };
    return (<button type="button" onClick={flip} aria-pressed={!muted} aria-label={muted ? 'Turn notification sounds on' : 'Turn notification sounds off'} title={muted ? 'Sounds off' : 'Sounds on'} className={`flex h-9 w-9 items-center justify-center rounded-full border border-gold/40 bg-white text-base transition hover:bg-gold/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold ${className}`}>
      <span aria-hidden="true">{muted ? '🔕' : '🔔'}</span>
    </button>);
}
