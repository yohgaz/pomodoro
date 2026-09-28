// Accès au serveur local + flux d'évènements temps réel.
export async function api(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
        if (body instanceof Blob) { opts.body = body; }
        else { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
    }
    const r = await fetch(url, opts);
    if (r.status === 401) { location.reload(); throw new Error('non autorisé'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Erreur ${r.status}`);
    return data;
}
export const get = url => api('GET', url);
export const post = (url, body = {}) => api('POST', url, body);
export const put = (url, body) => api('PUT', url, body);
export const del = url => api('DELETE', url);

const handlers = {};
let es = null;
export function on(type, fn) {
    (handlers[type] = handlers[type] || []).push(fn);
    if (es) es.addEventListener(type, ev => fn(JSON.parse(ev.data)));
}
export function connect() {
    es = new EventSource('/api/events');
    for (const [type, fns] of Object.entries(handlers)) {
        for (const fn of fns) es.addEventListener(type, ev => fn(JSON.parse(ev.data)));
    }
    es.onerror = () => { (handlers.offline || []).forEach(fn => fn()); };
    es.addEventListener('hello', () => { (handlers.online || []).forEach(fn => fn()); });
}

export async function uploadFile(file) {
    const r = await api('POST', `/api/files?name=${encodeURIComponent(file.name || 'image.png')}`, file);
    return r.url;
}
