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
        const req = indexedDB.open('pomodoro', 2);
        req.onupgradeneeded = () => {
            const d = req.result;
            for (const name of ['notes', 'para', 'users']) if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath: 'id' });
            if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
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
    clear: () => Promise.all(['notes', 'para', 'users', 'kv'].map(n => tx(n, 'readwrite', s => s.clear())))
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
        this.users = new Map();  // listes de tâches : « _perso » et celle du streamer
        this.settings = {};      // settings.json partagé (lecture seule ici)
        this.cfg = null;         // { owner, repo, branch, token, demo }
        this.status = { state: 'idle', lastSync: null, error: null, pending: 0 };
        this.syncing = false;
        this.again = false;
        this.imageCache = new Map();
    }

    // Types de fichiers synchronisés : dossier, format, carte en mémoire.
    kinds() {
        return {
            note: { map: this.notes, store: 'notes', path: id => `notes/${id}.md`, re: /^notes\/([^/]+)\.md$/, read: t => parse(t), write: o => serialize(o), label: o => (o.body.split('\n').find(l => l.trim()) || 'note').replace(/^#+\s*/, '').slice(0, 50) },
            para: { map: this.para, store: 'para', path: id => `para/${id}.json`, re: /^para\/([^/]+)\.json$/, read: t => JSON.parse(t), write: o => JSON.stringify(o, null, 2) + '\n', label: o => o.name },
            user: { map: this.users, store: 'users', path: id => `stream/users/${id}.json`, re: /^stream\/users\/([^/]+)\.json$/, read: t => JSON.parse(t), write: o => JSON.stringify(o, null, 2) + '\n', label: o => o.id === '_perso' ? 'tâches perso' : 'tâches de stream' }
        };
    }
    streamerLogin() { return (this.settings.streamerLogin || '').toLowerCase(); }
    // Seules deux listes intéressent le téléphone (pas celles des viewers).
    wantsUser(id) { return id === '_perso' || (id && id === this.streamerLogin()); }

    emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }
    setStatus(p) {
        Object.assign(this.status, p);
        this.status.pending = [...this.notes.values(), ...this.para.values(), ...this.users.values()].filter(x => x._dirty).length;
        this.emit('status', this.status);
    }

    async load() {
        this.cfg = await idb.kvGet('cfg') || null;
        for (const n of await idb.all('notes')) this.notes.set(n.id, n);
        for (const p of await idb.all('para')) this.para.set(p.id, p);
        for (const u of await idb.all('users')) this.users.set(u.id, u);
        this.settings = await idb.kvGet('settings') || {};
        this.status.lastSync = await idb.kvGet('lastSync') || null;
        this.setStatus({});
    }

    async configure(cfg) {
        const changedRepo = !this.cfg || this.cfg.owner !== cfg.owner || this.cfg.repo !== cfg.repo || !!this.cfg.demo !== !!cfg.demo;
        if (changedRepo) { await idb.clear(); this.notes.clear(); this.para.clear(); this.users.clear(); this.settings = {}; }
        this.cfg = cfg;
        await idb.kvSet('cfg', cfg);
    }
    async logout() { await idb.clear(); this.cfg = null; this.notes.clear(); this.para.clear(); this.users.clear(); this.settings = {}; }

    // ── Notes ──
    list() { return [...this.notes.values()]; }
    get(id) { return this.notes.get(id) || null; }

    async saveObj(kind, o, delay) {
        const K = this.kinds()[kind];
        o.updatedAt = Date.now();
        if (!o.createdAt) o.createdAt = o.updatedAt;
        o._dirty = true;
        K.map.set(o.id, o);
        await idb.put(K.store, o);
        this.emit('change', { kind, id: o.id });
        this.setStatus({});
        this.scheduleSync(delay);
        return o;
    }
    saveNote(n) { return this.saveObj('note', n, 2500); }
    saveContainer(c) { return this.saveObj('para', c, 1500); }
    saveUser(u) { return this.saveObj('user', u, 1500); }

    async createNote({ body = '# ', container = null } = {}) {
        return this.saveNote({ id: newId(), body, container, extra: {}, _sha: null });
    }

    // Liste de tâches (même format que le serveur, voir lib/stream.js).
    user(id) {
        let u = this.users.get(id);
        if (!u) {
            u = { id, login: id, displayName: id === '_perso' ? 'Perso' : id, color: null,
                projects: [{ id: 'general', name: 'Général', active: null, backlog: [], done: [] }],
                currentProject: 'general', totalDone: 0, memory: {}, pomo: null, sessionFirstAt: null, _sha: null };
        }
        return u;
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

    async blob(sha) {
        const b = await fetch(this.url(`git/blobs/${sha}`), { headers: this.headers() });
        if (!b.ok) throw new Error(`Téléchargement impossible (${b.status})`);
        return b64decode((await b.json()).content);
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
        let changed = false;

        // Réglages partagés d'abord (ils disent quelle liste est celle du streamer).
        const st = (tree.tree || []).find(e => e.path === 'settings.json');
        if (st && st.sha !== await idb.kvGet('settingsSha')) {
            try { this.settings = JSON.parse(await this.blob(st.sha)); await idb.kvSet('settings', this.settings); await idb.kvSet('settingsSha', st.sha); changed = true; }
            catch (e) { /* réglages illisibles : on garde les précédents */ }
        }

        const K = this.kinds();
        const remote = new Map(); // chemin -> { kind, id, sha }
        for (const e of tree.tree || []) {
            if (e.type !== 'blob') continue;
            for (const [kind, k] of Object.entries(K)) {
                const m = e.path.match(k.re);
                if (!m) continue;
                if (kind === 'user' && !this.wantsUser(m[1])) break;
                remote.set(e.path, { kind, id: m[1], sha: e.sha });
                break;
            }
        }
        // Nouveaux fichiers / fichiers modifiés ailleurs
        const jobs = [];
        for (const [, { kind, id, sha }] of remote) {
            const k = K[kind];
            const local = k.map.get(id);
            if (local && local._sha === sha) continue;
            jobs.push(async () => {
                const obj = k.read(await this.blob(sha));
                obj.id = obj.id || id;
                obj._sha = sha;
                const cur = k.map.get(id);
                if (cur && cur._dirty && (cur.updatedAt || 0) >= (obj.updatedAt || 0)) {
                    cur._sha = sha; // on garde la version locale, plus récente : elle écrasera la distante
                    await idb.put(k.store, cur);
                    return;
                }
                obj._dirty = false;
                k.map.set(id, obj);
                await idb.put(k.store, obj);
                changed = true;
            });
        }
        // 6 téléchargements en parallèle au plus
        const run = async () => { while (jobs.length) await jobs.shift()(); };
        await Promise.all(Array.from({ length: 6 }, run));
        // Fichiers supprimés ailleurs (connus ici, plus présents là-bas)
        for (const k of Object.values(K)) {
            for (const [id, obj] of k.map) {
                if (obj._sha && !obj._dirty && !remote.has(k.path(id))) {
                    k.map.delete(id); await idb.del(k.store, id); changed = true;
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
        const K = this.kinds();
        const dirty = [];
        for (const kind of ['para', 'user', 'note']) for (const x of K[kind].map.values()) if (x._dirty) dirty.push({ x, kind });
        for (const { x, kind } of dirty) {
            const k = K[kind];
            const path = k.path(x.id);
            const clean = { ...x }; delete clean._dirty; delete clean._sha;
            const text = k.write(clean);
            const msg = `📱 ${this.cfg.device || 'Téléphone'} · ${k.label(x)}`;
            let r = await this.putFile(path, b64encode(text), x._sha, msg);
            if (r.status === 409 || r.status === 422) {
                // Modifié ailleurs entre-temps : on relit la version distante.
                const cur = await fetch(this.url(`contents/${path}?ref=${encodeURIComponent(this.cfg.branch || 'main')}`), { headers: this.headers(), cache: 'no-store' });
                if (cur.ok) {
                    const d = await cur.json();
                    const remoteObj = k.read(b64decode(d.content));
                    if ((remoteObj.updatedAt || 0) > (x.updatedAt || 0)) {
                        remoteObj.id = remoteObj.id || x.id; remoteObj._sha = d.sha; remoteObj._dirty = false;
                        k.map.set(x.id, remoteObj);
                        await idb.put(k.store, remoteObj);
                        this.emit('change', { kind, id: x.id, remoteWon: true });
                        continue;
                    }
                    r = await this.putFile(path, b64encode(text), d.sha, msg);
                }
            }
            if (r.status === 401) throw new Error('Jeton GitHub refusé — reconnecte-toi dans les réglages.');
            if (r.status === 403) throw new Error('Le jeton n’a pas le droit d’écrire (Contents : Read and write).');
            if (!r.ok) throw new Error(`Envoi impossible (${r.status})`);
            const d = await r.json();
            x._sha = d.content && d.content.sha;
            x._dirty = false;
            await idb.put(k.store, x);
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
