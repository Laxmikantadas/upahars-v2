/* Cute notifications: a tiny event bus + soft synthesized sounds (Web Audio, no audio files).
   Works from anywhere (components, store, api) with no provider needed:
     notify.success('Saved!')   notify.error('Oops…')   notify.info('FYI')
     notify.cart('Added to cart')   notify.remove('Removed')   notify.celebrate('Order placed!')
   The <Toaster/> component (mounted once in main.jsx) draws them. */
const MUTE_KEY = 'upahars_sound_off';
const listeners = new Set();
let seq = 0;
let lastKey = '';
let lastAt = 0;
export const isMuted = () => {
    try { return localStorage.getItem(MUTE_KEY) === '1'; }
    catch { return false; }
};
export const setMuted = (m) => {
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); }
    catch { /* storage unavailable */ }
    listeners.forEach((l) => l({ type: 'mute', muted: m }));
};
export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/* ---------- sounds ---------- */
let ctx = null;
function audio() {
    if (typeof window === 'undefined')
        return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC)
        return null;
    ctx = ctx ?? new AC();
    if (ctx.state === 'suspended')
        void ctx.resume().catch(() => { });
    return ctx;
}
/** One soft bell-like note: [frequency Hz, start offset s, length s]. */
function tone(c, freq, at, len, type = 'sine', vol = 0.16, glideTo) {
    const o = c.createOscillator();
    const g = c.createGain();
    const t = c.currentTime + at;
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo)
        o.frequency.exponentialRampToValueAtTime(glideTo, t + len);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + len + 0.05);
}
const SOUNDS = {
    success: (c) => { tone(c, 784, 0, 0.18); tone(c, 988, 0.09, 0.18); tone(c, 1319, 0.18, 0.3); }, // ding-ding-dingg
    cart: (c) => { tone(c, 330, 0, 0.12, 'sine', 0.2, 880); tone(c, 1568, 0.12, 0.14, 'triangle', 0.1); tone(c, 2093, 0.2, 0.22, 'triangle', 0.08); }, // pop + sparkle
    remove: (c) => { tone(c, 660, 0, 0.1, 'sine', 0.14, 440); tone(c, 392, 0.09, 0.16, 'sine', 0.12); }, // soft blip-down
    info: (c) => { tone(c, 880, 0, 0.12); tone(c, 1175, 0.1, 0.2); }, // bloop
    error: (c) => { tone(c, 392, 0, 0.16, 'triangle', 0.17); tone(c, 294, 0.17, 0.3, 'triangle', 0.17, 262); }, // gentle "uh-oh"
    celebrate: (c) => { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(c, f, i * 0.09, 0.22, 'sine', 0.15)); tone(c, 1568, 0.5, 0.45, 'triangle', 0.1); },
};
export function playSound(kind) {
    if (isMuted() || (typeof document !== 'undefined' && document.hidden))
        return;
    try {
        const c = audio();
        if (c)
            (SOUNDS[kind] ?? SOUNDS.info)(c);
    }
    catch { /* sound is a nicety; never break the app */ }
}

/* ---------- toasts ---------- */
const LOOKS = {
    success: { emoji: '🎉', title: 'Yay!', ms: 3200 },
    cart: { emoji: '🛍️', title: 'Added!', ms: 3000 },
    remove: { emoji: '🗑️', title: 'Removed', ms: 2600 },
    info: { emoji: '💡', title: 'Just so you know', ms: 3600 },
    error: { emoji: '🥺', title: 'Oops!', ms: 5200 },
    celebrate: { emoji: '🥳', title: 'Hooray!', ms: 4200 },
};
function push(kind, message, opts = {}) {
    if (!message)
        return;
    const key = `${kind}:${message}`;
    const now = Date.now();
    if (key === lastKey && now - lastAt < 1200)
        return; // ignore accidental double-fires
    lastKey = key;
    lastAt = now;
    const look = LOOKS[kind];
    const toast = { id: ++seq, kind, message: String(message), title: opts.title ?? look.title, emoji: opts.emoji ?? look.emoji, ms: opts.ms ?? look.ms };
    playSound(kind);
    listeners.forEach((l) => l({ type: 'toast', toast }));
}
export const notify = {
    success: (m, o) => push('success', m, o),
    error: (m, o) => push('error', m, o),
    info: (m, o) => push('info', m, o),
    cart: (m, o) => push('cart', m, o),
    remove: (m, o) => push('remove', m, o),
    celebrate: (m, o) => push('celebrate', m, o),
};
