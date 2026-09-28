// App mobile — stockage hors ligne (IndexedDB) + synchro directe avec le
// dépôt GitHub privé des données (le même que celui du PC et du Mac).
//
// Le téléphone est une « machine » de plus : il garde une copie complète des
// notes, fonctionne sans réseau, et échange avec GitHub dès que possible :
//   - lecture : un seul appel « arbre git » (gratuit s'il n'a pas changé,
//     grâce à l'ETag), puis téléchargement des seuls fichiers modifiés ;
//   - écriture : un commit par note modifiée (API Contents) ;
//   - conflit (même note modifiée ailleurs entre-temps) : la version la plus
//     récente gagne, comme sur le PC et le Mac.
import { parse, serialize } from './md.js';

// ── IndexedDB minimal ──
let dbp = null;
function db() {
    if (!dbp) dbp = new Promise((resolve, reject) => {
        const req = indexedDB.open('pomodoro', 1);
        req.onupgradeneeded = () => {
            const d = req.result;
            d.createObjectStore('notes', { keyPath: 'id' });
            d.createObjectStore('para', { keyPath: 'id' });
            d.createObjectStore('kv');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbp;
}
async function tx(store, mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
        const t = d.transaction(store, mode);
        const s = t.objectStore(store);
        const r = fn(s);
        t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
        t.onerror = () => reject(t.error);
    });
}
const idb = {
    all: store => tx(store, 'readonly', s => s.getAll()),
    put: (store, v) => tx(store, 'readwrite', s => s.put(v)),
    del: (store, k) => tx(store, 'readwrite', s => s.delete(k)),
    get: (store, k) => tx(store, 'readonly', s => s.get(k)),
    kvGet: k => tx('kv', 'readonly', s => s.get(k)),
    kvSet: (k, v) => tx('kv', 'readwrite', s => s.put(v, k)),
    clear: () => Promise.all(['notes', 'para', 'kv'].map(n => tx(n, 'readwrite', s => s.clear())))
};

// ── Encodage ──
function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
}
function b64decode(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}
async function blobToB64(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(bin);
}

export function newId() {
    const r = new Uint8Array(4);
    crypto.getRandomValues(r);
    return Date.now().toString(36) + [...r].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Magasin ──
export class Store extends EventTarget {
    constructor() {
        super();
        this.notes = new Map();
        this.para = new Map();
        this.cfg = null;         // { owner, repo, branch, token, demo }
        this.status = { state: 'idle', lastSync: null, error: null, pending: 0 };
        this.syncing = false;
        this.again = false;
        this.imageCache = new Map();
    }

    emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
    setStatus(p) { Object.assign(this.status, p); this.status.pending = [...this.notes.values(), ...this.para.values()].filter(x => x._dirty).length; this.emit('status', this.status); }

    async load() {
        this.cfg = await idb.kvGet('cfg') || null;
        for (const n of await idb.all('notes')) this.notes.set(n.id, n);
        for (const p of await idb.all('para')) this.para.set(p.id, p);
        this.status.lastSync = await idb.kvGet('lastSync') || null;
        this.setStatus({});
    }

    async configure(cfg) {
        const changedRepo = !this.cfg || this.cfg.owner !== cfg.owner || this.cfg.repo !== cfg.repo || !!this.cfg.demo !== !!cfg.demo;
        if (changedRepo) { await idb.clear(); this.notes.clear(); this.para.clear(); }
        this.cfg = cfg;
        await idb.kvSet('cfg', cfg);
    }
    async logout() { await idb.clear(); this.cfg = null; this.notes.clear(); this.para.clear(); }

    // ── Notes ──
    list() { return [...this.notes.values()]; }
    get(id) { return this.notes.get(id) || null; }

    async saveNote(n, { touch = true } = {}) {
        if (touch) n.updatedAt = Date.now();
        if (!n.createdAt) n.createdAt = n.updatedAt;
        n._dirty = true;
        this.notes.set(n.id, n);
        await idb.put('notes', n);
        this.emit('change', { kind: 'note', id: n.id });
        this.setStatus({});
        this.scheduleSync(2500);
        return n;
    }

    async createNote({ body = '# ', container = null } = {}) {
        return this.saveNote({ id: newId(), body, container, extra: {}, _sha: null });
    }

    async saveContainer(c) {
        c.updatedAt = Date.now();
        if (!c.createdAt) c.createdAt = c.updatedAt;
        c._dirty = true;
        this.para.set(c.id, c);
        await idb.put('para', c);
        this.emit('change', { kind: 'para', id: c.id });
        this.setStatus({});
        this.scheduleSync(1500);
        return c;
    }

    // ── GitHub ──
    headers(extra = {}) {
        return { Authorization: `Bearer ${this.cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...extra };
    }
    url(p) { return `https://api.github.com/repos/${this.cfg.owner}/${this.cfg.repo}/${p}`; }

    async testConnection(cfg) {
        const r = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}`, { headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json' } });
        if (r.status === 401) throw new Error('Jeton refusé par GitHub (expiré ou mal copié).');
        if (r.status === 404) throw new Error('Dépôt introuvable : vérifie le nom, et que le jeton y a bien accès.');
        if (!r.ok) throw new Error(`GitHub répond ${r.status}`);
        const d = await r.json();
        if (d.permissions && !d.permissions.push) throw new Error('Le jeton peut lire mais pas écrire : donne-lui « Contents : Read and write ».');
        return d;
    }

    scheduleSync(ms = 1500) {
        clearTimeout(this._t);
        this._t = setTimeout(() => this.sync(), ms);
    }

    async sync() {
        if (!this.cfg || this.cfg.demo) { this.setStatus({ state: this.cfg && this.cfg.demo ? 'demo' : 'idle' }); return; }
        if (!navigator.onLine) { this.setStatus({ state: 'offline' }); return; }
        if (this.syncing) { this.again = true; return; }
        this.syncing = true;
        this.setStatus({ state: 'syncing', error: null });
        try {
            await this.pull();
            await this.push();
            const now = Date.now();
            await idb.kvSet('lastSync', now);
            this.setStatus({ state: 'idle', lastSync: now });
        } catch (e) {
            console.warn('Synchro', e);
            this.setStatus({ state: navigator.onLine ? 'error' : 'offline', error: e.message });
        } finally {
            this.syncing = false;
            if (this.again) { this.again = false; this.scheduleSync(500); }
        }
    }

    async pull() {
        const etag = await idb.kvGet('treeEtag');
        const r = await fetch(this.url(`git/trees/${encodeURIComponent(this.cfg.branch || 'main')}?recursive=1`), {
            headers: this.headers(etag ? { 'If-None-Match': etag } : {}), cache: 'no-store'
        });
        if (r.status === 304) return;
        if (r.status === 404 || r.status === 409) return; // dépôt encore vide
        if (r.status === 401) throw new Error('Jeton GitHub refusé — reconnecte-toi dans les réglages.');
        if (!r.ok) throw new Error(`Lecture GitHub impossible (${r.status})`);
        const tree = await r.json();
        const remote = new Map();
        for (const e of tree.tree || []) {
            if (e.type !== 'blob') continue;
            if (/^notes\/[^/]+\.md$/.test(e.path) || /^para\/[^/]+\.json$/.test(e.path)) remote.set(e.path, e.sha);
        }
        let changed = false;
        // Nouveaux fichiers / fichiers modifiés ailleurs
        const jobs = [];
        for (const [p, sha] of remote) {
            const isNote = p.startsWith('notes/');
            const id = p.replace(/^(notes|para)\//, '').replace(/\.(md|json)$/, '');
            const local = (isNote ? this.notes : this.para).get(id);
            if (local && local._sha === sha) continue;
            jobs.push(async () => {
                const b = await fetch(this.url(`git/blobs/${sha}`), { headers: this.headers() });
                if (!b.ok) throw new Error(`Téléchargement impossible (${b.status})`);
                const text = b64decode((await b.json()).content);
                let obj;
                if (isNote) { obj = parse(text); obj.id = obj.id || id; }
                else obj = JSON.parse(text);
                obj._sha = sha;
                const cur = (isNote ? this.notes : this.para).get(id);
                if (cur && cur._dirty && (cur.updatedAt || 0) >= (obj.updatedAt || 0)) {
                    cur._sha = sha; // on garde la version locale, plus récente ; elle écrasera la distante
                    await idb.put(isNote ? 'notes' : 'para', cur);
                    return;
                }
                obj._dirty = false;
                (isNote ? this.notes : this.para).set(id, obj);
                await idb.put(isNote ? 'notes' : 'para', obj);
                changed = true;
            });
        }
        // 6 téléchargements en parallèle au plus
        const run = async () => { while (jobs.length) await jobs.shift()(); };
        await Promise.all(Array.from({ length: 6 }, run));
        // Fichiers supprimés ailleurs (connus ici, plus présents là-bas)
        for (const [map, dir, ext, store] of [[this.notes, 'notes', '.md', 'notes'], [this.para, 'para', '.json', 'para']]) {
            for (const [id, obj] of map) {
                if (obj._sha && !obj._dirty && !remote.has(`${dir}/${id}${ext}`)) {
                    map.delete(id); await idb.del(store, id); changed = true;
                }
            }
        }
        if (r.headers.get('ETag')) await idb.kvSet('treeEtag', r.headers.get('ETag'));
        if (changed) this.emit('change', { kind: 'pull' });
    }

    async putFile(path, contentB64, sha, message) {
        const r = await fetch(this.url(`contents/${path}`), {
            method: 'PUT',
            headers: this.headers({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ message, content: contentB64, branch: this.cfg.branch || 'main', ...(sha ? { sha } : {}) })
        });
        return r;
    }

    async push() {
        const dirty = [
            ...[...this.para.values()].filter(x => x._dirty).map(x => ({ x, kind: 'para' })),
            ...[...this.notes.values()].filter(x => x._dirty).map(x => ({ x, kind: 'note' }))
        ];
        for (const { x, kind } of dirty) {
            const path = kind === 'note' ? `notes/${x.id}.md` : `para/${x.id}.json`;
            const clean = { ...x }; delete clean._dirty; delete clean._sha;
            const text = kind === 'note' ? serialize(clean) : JSON.stringify(clean, null, 2) + '\n';
            const title = kind === 'note' ? (x.body.split('\n').find(l => l.trim()) || 'note').replace(/^#+\s*/, '').slice(0, 50) : x.name;
            let r = await this.putFile(path, b64encode(text), x._sha, `📱 ${this.cfg.device || 'Téléphone'} · ${title}`);
            if (r.status === 409 || r.status === 422) {
                // Modifiée ailleurs entre-temps : on relit la version distante.
                const cur = await fetch(this.url(`contents/${path}?ref=${encodeURIComponent(this.cfg.branch || 'main')}`), { headers: this.headers(), cache: 'no-store' });
                if (cur.ok) {
                    const d = await cur.json();
                    const remoteText = b64decode(d.content);
                    const remoteObj = kind === 'note' ? parse(remoteText) : JSON.parse(remoteText);
                    if ((remoteObj.updatedAt || 0) > (x.updatedAt || 0)) {
                        remoteObj.id = remoteObj.id || x.id; remoteObj._sha = d.sha; remoteObj._dirty = false;
                        (kind === 'note' ? this.notes : this.para).set(x.id, remoteObj);
                        await idb.put(kind === 'note' ? 'notes' : 'para', remoteObj);
                        this.emit('change', { kind, id: x.id, remoteWon: true });
                        continue;
                    }
                    r = await this.putFile(path, b64encode(text), d.sha, `📱 ${this.cfg.device || 'Téléphone'} · ${title}`);
                }
            }
            if (r.status === 401) throw new Error('Jeton GitHub refusé — reconnecte-toi dans les réglages.');
            if (r.status === 403) throw new Error('Le jeton n’a pas le droit d’écrire (Contents : Read and write).');
            if (!r.ok) throw new Error(`Envoi impossible (${r.status})`);
            const d = await r.json();
            x._sha = d.content && d.content.sha;
            x._dirty = false;
            await idb.put(kind === 'note' ? 'notes' : 'para', x);
        }
        if (dirty.length) await idb.kvSet('treeEtag', null);
    }

    // Images du dépôt privé : récupérées avec le jeton, gardées en cache.
    async resolveImage(src) {
        if (!/^\/files\//.test(src) || !this.cfg || this.cfg.demo) return src;
        if (this.imageCache.has(src)) return this.imageCache.get(src);
        const p = (async () => {
            const cached = await idb.kvGet('img:' + src);
            if (cached) return URL.createObjectURL(cached);
            const r = await fetch(this.url(`contents${src}?ref=${encodeURIComponent(this.cfg.branch || 'main')}`), { headers: this.headers({ Accept: 'application/vnd.github.raw' }) });
            if (!r.ok) return src;
            const blob = await r.blob();
            idb.kvSet('img:' + src, blob).catch(() => {});
            return URL.createObjectURL(blob);
        })();
        this.imageCache.set(src, p);
        return p;
    }

    async uploadImage(file) {
        if (!this.cfg || this.cfg.demo) return URL.createObjectURL(file);
        if (!navigator.onLine) throw new Error('Pas de réseau : les photos s’ajoutent une fois en ligne.');
        const ext = ((file.name || '').match(/\.[a-z0-9]{1,5}$/i) || ['.' + ((file.type || 'image/jpeg').split('/')[1] || 'jpg')])[0].toLowerCase();
        const name = `/files/${newId()}${ext}`;
        const r = await this.putFile(name.slice(1), await blobToB64(file), null, `📱 ${this.cfg.device || 'Téléphone'} · image`);
        if (!r.ok) throw new Error(`Envoi de l’image impossible (${r.status})`);
        idb.kvSet('img:' + name, file).catch(() => {});
        return name;
    }
}
