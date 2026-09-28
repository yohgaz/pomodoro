// Cache hors ligne de l'app mobile (le code de l'app ; les notes sont dans
// IndexedDB). La version change à chaque « npm run build:mobile ».
const VERSION = 'mul4xklr';
const CACHE = 'pomodoro-' + VERSION;
const SHELL = ['./', 'index.html', 'icon-180.png', 'app.js', 'store.js', 'md.js', 'mobile.css', 'theme.css', 'editor.css', 'icon.svg', 'manifest.webmanifest', 'vendor/editor.bundle.js'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
    const url = new URL(e.request.url);
    if (e.request.method !== 'GET' || url.hostname === 'api.github.com') return;
    // Code de l'app : réseau d'abord (pour les mises à jour), cache si hors ligne.
    // Polices Google : cache d'abord.
    const fonts = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
    if (fonts) {
        e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); return r; })));
        return;
    }
    if (url.origin !== location.origin) return;
    e.respondWith(fetch(e.request).then(r => {
        if (r.ok) { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); }
        return r;
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match('index.html'))));
});
