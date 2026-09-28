// Commun aux overlays OBS : connexion temps réel, échelle (4K), utilitaires.
export const params = new URLSearchParams(location.search);
export const isObs = !!window.obsstudio;
export const isPreview = params.get('preview') === '1';

const scale = Number(params.get('scale')) || 1;
if (scale !== 1) document.documentElement.style.zoom = scale;

export function connect(onSnap) {
    // obs=1 : signale au serveur qu'OBS affiche un overlay sur cette machine,
    // ce qui réveille le bot en mode « auto ».
    const url = `/api/events?overlay=1${isObs ? '&obs=1' : ''}`;
    let es;
    const open = () => {
        es = new EventSource(url);
        es.addEventListener('stream', ev => onSnap(JSON.parse(ev.data)));
        es.onerror = () => { es.close(); setTimeout(open, 3000); };
    };
    open();
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fmt(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0');
}

export function remaining(p, now = Date.now()) {
    if (!p || p.phase === 'done') return 0;
    return p.paused ? (p.remaining || 0) : Math.max(0, p.endsAt - now);
}

// Rend une couleur de pseudo Twitch lisible sur fond sombre.
export function readable(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#F4F2ED';
    let [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (lum < 0.45) {
        const k = (0.45 - lum) / (1 - lum) + 0.25;
        r = Math.round(r + (255 - r) * k); g = Math.round(g + (255 - g) * k); b = Math.round(b + (255 - b) * k);
    }
    return `rgb(${r}, ${g}, ${b})`;
}

// Petit carillon (WebAudio, aucun fichier) pour les changements de phase.
let ctx = null;
export function chime(kind = 'break') {
    try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        const notes = kind === 'work' ? [523.25, 659.25, 783.99] : kind === 'done' ? [523.25, 659.25, 783.99, 1046.5] : [783.99, 659.25, 523.25];
        notes.forEach((f, i) => {
            const o = ctx.createOscillator(), g = ctx.createGain();
            o.type = 'sine'; o.frequency.value = f;
            const t = ctx.currentTime + i * 0.16;
            g.gain.setValueAtTime(0, t);
            g.gain.linearRampToValueAtTime(0.22, t + 0.02);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
            o.connect(g).connect(ctx.destination);
            o.start(t); o.stop(t + 1);
        });
    } catch (e) { /* audio indisponible */ }
}
