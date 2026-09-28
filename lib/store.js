// Stockage : un fichier JSON par entité (une page, un membre du chat…) dans
// le dossier de données. Un fichier par entité plutôt qu'un gros fichier
// unique : deux machines qui modifient deux pages différentes ne se marchent
// jamais dessus lors de la synchro git (voir lib/sync.js).
//
// La mémoire fait foi pendant l'exécution ; l'écriture disque est différée
// (quelques centaines de ms) et suspendue pendant une synchro, pour que git
// ne voie jamais un fichier à moitié écrit.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventEmitter = require('events');

const md = require('./markdown-file');

// Collections : dossier + format. Les notes sont de vrais fichiers Markdown
// (en-tête YAML + corps), lisibles tels quels par Bear, Obsidian, etc.
const COLLECTIONS = {
    notes: 'notes',
    para: 'para',
    users: 'stream/users'
};
const EXT = { notes: '.md' };
const extOf = col => EXT[col] || '.json';
const encode = (col, obj) => col === 'notes' ? md.serialize(obj) : JSON.stringify(obj, null, 2) + '\n';
const decode = (col, text) => col === 'notes' ? md.parse(text) : JSON.parse(text);

function newId() {
    return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function safeId(id) {
    return String(id).toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 80);
}

class Store extends EventEmitter {
    constructor(dir) {
        super();
        this.dir = dir;
        this.cols = {};
        for (const name of Object.keys(COLLECTIONS)) this.cols[name] = new Map();
        this.docs = new Map();          // chemin relatif -> objet (fichiers uniques)
        this.dirty = new Set();         // chemins relatifs à écrire
        this.deleted = new Set();       // chemins relatifs à supprimer
        this.suspended = 0;
        this._flushTimer = null;
    }

    init() {
        fs.mkdirSync(this.dir, { recursive: true });
        for (const [name, sub] of Object.entries(COLLECTIONS)) {
            const d = path.join(this.dir, sub);
            fs.mkdirSync(d, { recursive: true });
            this.cols[name].clear();
            for (const f of fs.readdirSync(d)) {
                if (!f.endsWith(extOf(name))) continue;
                const obj = this._read(path.posix.join(sub, f), name);
                if (obj && obj.id) this.cols[name].set(obj.id, obj);
            }
        }
    }

    _read(rel, col) {
        try { return decode(col, fs.readFileSync(path.join(this.dir, rel), 'utf8')); }
        catch (e) { return null; }
    }

    relOf(col, id) { return path.posix.join(COLLECTIONS[col], safeId(id) + extOf(col)); }

    // Retrouve collection + id à partir d'un chemin relatif (pour la synchro).
    parseRel(rel) {
        rel = rel.replace(/\\/g, '/');
        for (const [name, sub] of Object.entries(COLLECTIONS)) {
            if (rel.startsWith(sub + '/') && rel.endsWith(extOf(name)) && !rel.slice(sub.length + 1).includes('/')) {
                return { col: name, file: rel };
            }
        }
        if (rel.endsWith('.json')) return { doc: rel };
        return null;
    }

    // ── Collections ──
    list(col) { return [...this.cols[col].values()]; }
    get(col, id) { return this.cols[col].get(id) || null; }

    put(col, obj, { touch = true, source = 'local' } = {}) {
        if (!obj.id) obj.id = newId();
        const now = Date.now();
        if (!obj.createdAt) obj.createdAt = now;
        if (touch) obj.updatedAt = now;
        this.cols[col].set(obj.id, obj);
        const rel = this.relOf(col, obj.id);
        this.deleted.delete(rel);
        this.dirty.add(rel);
        this._scheduleFlush();
        this.emit('change', { col, id: obj.id, obj, source });
        return obj;
    }

    remove(col, id, { source = 'local' } = {}) {
        if (!this.cols[col].has(id)) return false;
        this.cols[col].delete(id);
        const rel = this.relOf(col, id);
        this.dirty.delete(rel);
        this.deleted.add(rel);
        this._scheduleFlush();
        this.emit('change', { col, id, obj: null, source });
        return true;
    }

    // ── Fichiers uniques (réglages, état du minuteur…) ──
    getDoc(rel, fallback) {
        if (!this.docs.has(rel)) {
            const obj = this._read(rel);
            this.docs.set(rel, obj || (typeof fallback === 'function' ? fallback() : fallback) || {});
        }
        return this.docs.get(rel);
    }

    putDoc(rel, obj, { touch = true, source = 'local' } = {}) {
        if (touch) obj.updatedAt = Date.now();
        this.docs.set(rel, obj);
        this.deleted.delete(rel);
        this.dirty.add(rel);
        this._scheduleFlush();
        this.emit('change', { doc: rel, obj, source });
        return obj;
    }

    // ── Écriture disque ──
    _scheduleFlush() {
        if (this._flushTimer) return;
        this._flushTimer = setTimeout(() => { this._flushTimer = null; this.flush(); }, 300);
    }

    _objForRel(rel) {
        const p = this.parseRel(rel);
        if (!p) return null;
        if (p.doc) return { obj: this.docs.get(rel) || null };
        for (const obj of this.cols[p.col].values()) {
            if (this.relOf(p.col, obj.id) === rel) return { obj, col: p.col };
        }
        return null;
    }

    flush() {
        if (this.suspended) return false;
        const wrote = this.dirty.size + this.deleted.size;
        for (const rel of this.dirty) {
            const found = this._objForRel(rel);
            if (!found || !found.obj) continue;
            const full = path.join(this.dir, rel);
            fs.mkdirSync(path.dirname(full), { recursive: true });
            const data = found.col ? encode(found.col, found.obj) : JSON.stringify(found.obj, null, 2) + '\n';
            const tmp = full + '.tmp';
            try {
                fs.writeFileSync(tmp, data);
                fs.renameSync(tmp, full);
            } catch (e) {
                // Windows : un rename peut échouer si un autre processus tient
                // le fichier ouvert une fraction de seconde — écriture directe.
                try { fs.writeFileSync(full, data); } catch (e2) { console.error('Écriture impossible', rel, e2.message); continue; }
                try { fs.unlinkSync(tmp); } catch (e3) { /* rien */ }
            }
        }
        this.dirty.clear();
        for (const rel of this.deleted) {
            try { fs.unlinkSync(path.join(this.dir, rel)); } catch (e) { /* déjà absent */ }
        }
        this.deleted.clear();
        if (wrote) this.emit('flushed');
        return true;
    }

    suspend() { this.suspended++; }
    resume() {
        this.suspended = Math.max(0, this.suspended - 1);
        if (!this.suspended && (this.dirty.size || this.deleted.size)) this._scheduleFlush();
    }

    // Relit depuis le disque des fichiers modifiés par la synchro. Une entité
    // modifiée localement entre-temps (encore "sale") n'est écrasée que si la
    // version du disque est plus récente.
    reloadPaths(rels) {
        for (let rel of rels) {
            rel = rel.replace(/\\/g, '/');
            const p = this.parseRel(rel);
            if (!p) continue;
            const obj = this._read(rel, p.col);
            if (p.doc) {
                const mem = this.docs.get(rel);
                if (this.dirty.has(rel) && mem && obj && (mem.updatedAt || 0) > (obj.updatedAt || 0)) continue;
                if (obj) this.docs.set(rel, obj); else this.docs.delete(rel);
                this.emit('change', { doc: rel, obj, source: 'sync' });
                continue;
            }
            const col = this.cols[p.col];
            if (obj && obj.id) {
                const mem = col.get(obj.id);
                if (mem && this.dirty.has(rel) && (mem.updatedAt || 0) > (obj.updatedAt || 0)) continue;
                col.set(obj.id, obj);
                this.emit('change', { col: p.col, id: obj.id, obj, source: 'sync' });
            } else {
                for (const [id] of col) {
                    if (this.relOf(p.col, id) === rel && !this.dirty.has(rel)) {
                        col.delete(id);
                        this.emit('change', { col: p.col, id, obj: null, source: 'sync' });
                    }
                }
            }
        }
    }
}

module.exports = { Store, newId, safeId, COLLECTIONS };
