// Notes Markdown organisées selon la méthode IPARA (Tiago Forte + Inbox) :
//   I — Inbox      : tout ce qui est capturé sans être encore classé
//   P — Projets    : objectif précis avec une échéance
//   A — Domaines   : responsabilités continues (santé, stream, maison…)
//   R — Ressources : sujets d'intérêt, documentation
//   A — Archives   : projets/domaines/ressources terminés ou en pause
//
// Les conteneurs (projets, domaines, ressources) sont des fichiers JSON dans
// para/ ; une note appartient à au plus un conteneur (champ "container" de
// son en-tête). Pas de conteneur = Inbox. Les tags (#tag, #tag/sous-tag) et
// les liens [[Titre]] restent dans le texte, comme dans Bear.
const md = require('./markdown-file');
const { newId } = require('./store');

const KINDS = ['project', 'area', 'resource'];

const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

class Notes {
    constructor({ store }) {
        this.store = store;
        this.cache = new Map(); // id -> { updatedAt, meta }
    }

    all() { return this.store.list('notes'); }
    get(id) { return this.store.get('notes', id); }
    containers() { return this.store.list('para'); }
    container(id) { return id ? this.store.get('para', id) : null; }

    meta(n) {
        const c = this.cache.get(n.id);
        if (c && c.updatedAt === n.updatedAt && c.body === n.body) return c.meta;
        const meta = {
            id: n.id,
            title: md.titleOf(n.body) || 'Sans titre',
            excerpt: md.excerptOf(n.body),
            tags: md.tagsOf(n.body),
            links: md.linksOf(n.body),
            tasks: md.tasksOf(n.body),
            words: (String(n.body).match(/[\p{L}\p{N}’'-]+/gu) || []).length,
            hasImage: /!\[[^\]]*\]\(/.test(n.body),
            container: n.container || null,
            pinned: !!n.pinned,
            archived: !!n.archived,
            trashed: !!n.trashed,
            createdAt: n.createdAt,
            updatedAt: n.updatedAt
        };
        this.cache.set(n.id, { updatedAt: n.updatedAt, body: n.body, meta });
        return meta;
    }

    // Une note est "archivée" si elle l'est elle-même ou si son conteneur l'est.
    isArchived(n) {
        if (n.archived) return true;
        const c = this.container(n.container);
        return !!(c && c.archived);
    }

    list({ view = 'all', q = '', sort = 'updated' } = {}) {
        let notes = this.all();
        const [kind, arg] = view.includes(':') ? [view.slice(0, view.indexOf(':')), view.slice(view.indexOf(':') + 1)] : [view, ''];
        if (kind === 'trash') notes = notes.filter(n => n.trashed);
        else {
            notes = notes.filter(n => !n.trashed);
            if (kind === 'inbox') notes = notes.filter(n => !n.container && !n.archived);
            else if (kind === 'archive') notes = notes.filter(n => this.isArchived(n));
            else if (kind === 'container') notes = notes.filter(n => n.container === arg);
            else if (kind === 'kind') notes = notes.filter(n => { const c = this.container(n.container); return c && c.kind === arg && !this.isArchived(n); });
            else if (kind === 'tag') {
                const t = arg.toLowerCase();
                notes = notes.filter(n => this.meta(n).tags.some(x => x === t || x.startsWith(t + '/')));
            }
            else if (kind === 'untagged') notes = notes.filter(n => !this.meta(n).tags.length && !this.isArchived(n));
            else if (kind === 'todo') notes = notes.filter(n => this.meta(n).tasks.open > 0 && !this.isArchived(n));
            else if (kind === 'today') { const t0 = startOfDay(); notes = notes.filter(n => (n.updatedAt || 0) >= t0 || (n.createdAt || 0) >= t0); }
            else if (kind === 'all') notes = notes.filter(n => !this.isArchived(n));
        }
        let metas = notes.map(n => this.meta(n));
        if (q && q.trim()) {
            const terms = fold(q).split(/\s+/).filter(Boolean);
            const scored = [];
            for (const n of notes) {
                const m = this.meta(n);
                const title = fold(m.title);
                const body = fold(n.body);
                let score = 0;
                let ok = true;
                for (const t of terms) {
                    if (t.startsWith('#')) { if (!m.tags.some(x => fold(x).startsWith(t.slice(1)))) { ok = false; break; } score += 3; continue; }
                    const inTitle = title.includes(t);
                    if (!inTitle && !body.includes(t)) { ok = false; break; }
                    score += inTitle ? 10 : 1;
                }
                if (ok) {
                    const mm = { ...m };
                    const i = body.indexOf(terms.find(t => !t.startsWith('#')) || '\u0000');
                    if (i > 0) mm.excerpt = '…' + n.body.slice(Math.max(0, i - 50), i + 150).replace(/\s+/g, ' ');
                    scored.push({ m: mm, score });
                }
            }
            scored.sort((a, b) => b.score - a.score || b.m.updatedAt - a.m.updatedAt);
            metas = scored.map(s => s.m);
            return metas;
        }
        const cmp = {
            updated: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
            created: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
            title: (a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' })
        }[sort] || ((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        metas.sort((a, b) => (kind !== 'trash' && a.pinned !== b.pinned) ? (a.pinned ? -1 : 1) : cmp(a, b));
        return metas;
    }

    counts() {
        const out = { inbox: 0, all: 0, todo: 0, today: 0, trash: 0, archive: 0, untagged: 0, containers: {}, kinds: { project: 0, area: 0, resource: 0 } };
        const t0 = startOfDay();
        for (const n of this.all()) {
            if (n.trashed) { out.trash++; continue; }
            const m = this.meta(n);
            const arch = this.isArchived(n);
            if (arch) out.archive++;
            else {
                out.all++;
                if (!n.container && !n.archived) out.inbox++;
                if (m.tasks.open) out.todo++;
                if (!m.tags.length) out.untagged++;
            }
            if ((n.updatedAt || 0) >= t0 || (n.createdAt || 0) >= t0) out.today++;
            if (n.container) out.containers[n.container] = (out.containers[n.container] || 0) + 1;
        }
        return out;
    }

    tags() {
        const counts = new Map();
        for (const n of this.all()) {
            if (n.trashed) continue;
            for (const t of this.meta(n).tags) {
                // chaque niveau de #a/b/c est compté pour l'arborescence
                const parts = t.split('/');
                for (let i = 1; i <= parts.length; i++) {
                    const k = parts.slice(0, i).join('/');
                    counts.set(k, (counts.get(k) || 0) + 1);
                }
            }
        }
        return [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => a.tag.localeCompare(b.tag, 'fr'));
    }

    create({ body = '', container = null } = {}) {
        const n = { id: newId(), body: String(body), container: container || null, extra: {} };
        return this.store.put('notes', n);
    }

    update(id, patch) {
        const n = this.get(id);
        if (!n) return null;
        if (patch.body !== undefined) n.body = String(patch.body);
        if (patch.container !== undefined) n.container = patch.container || null;
        if (patch.pinned !== undefined) n.pinned = !!patch.pinned;
        if (patch.archived !== undefined) n.archived = !!patch.archived;
        if (patch.trashed !== undefined) { n.trashed = !!patch.trashed; n.trashedAt = n.trashed ? Date.now() : null; }
        return this.store.put('notes', n);
    }

    remove(id) { return this.store.remove('notes', id); }

    emptyTrash() {
        let n = 0;
        for (const note of this.all()) if (note.trashed) { this.store.remove('notes', note.id); n++; }
        return n;
    }

    // Corbeille : purge automatique après 30 jours.
    purgeTrash(days = 30) {
        const limit = Date.now() - days * 86400000;
        for (const n of this.all()) if (n.trashed && (n.trashedAt || n.updatedAt || 0) < limit) this.store.remove('notes', n.id);
    }

    findByTitle(title) {
        const t = fold(title).trim();
        const hits = this.all().filter(n => !n.trashed && fold(this.meta(n).title) === t);
        hits.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        return hits[0] || null;
    }

    backlinks(id) {
        const n = this.get(id);
        if (!n) return [];
        const title = fold(this.meta(n).title);
        const out = [];
        for (const o of this.all()) {
            if (o.id === id || o.trashed) continue;
            if (this.meta(o).links.some(l => fold(l) === title)) {
                const line = o.body.split('\n').find(l => fold(l).includes('[[' + title)) || '';
                out.push({ ...this.meta(o), context: line.trim().slice(0, 200) });
            }
        }
        return out;
    }

    // Renomme un tag partout (#ancien → #nouveau, sous-tags compris).
    renameTag(from, to) {
        from = String(from).replace(/^#/, '').trim();
        to = String(to).replace(/^#/, '').trim().replace(/\s+/g, '-');
        if (!from || !to) return 0;
        const re = new RegExp(`(^|[\\s(])#${escapeRe(from)}(?=$|[\\s/).,;!?#])`, 'giu');
        let changed = 0;
        for (const n of this.all()) {
            if (!this.meta(n).tags.some(t => t === from.toLowerCase() || t.startsWith(from.toLowerCase() + '/'))) continue;
            const body = n.body.replace(re, (m, pre) => `${pre}#${to}`);
            if (body !== n.body) { n.body = body; this.store.put('notes', n); changed++; }
        }
        return changed;
    }

    // Coche la case "- [ ] texte" correspondant à une tâche du stream terminée.
    checkTask(noteId, text) {
        const n = this.get(noteId);
        if (!n) return false;
        const lines = n.body.split('\n');
        const target = fold(text).trim();
        for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(/^(\s*[-*+]\s+)\[ \](\s+)(.*)$/);
            if (m && fold(m[3]).replace(/\s*🎥\s*$/, '').trim() === target) {
                lines[i] = `${m[1]}[x]${m[2]}${m[3]}`;
                n.body = lines.join('\n');
                this.store.put('notes', n);
                return true;
            }
        }
        return false;
    }

    // ── Conteneurs IPARA ──
    saveContainer(data) {
        const cur = data.id ? this.container(data.id) : null;
        if (data.kind && !KINDS.includes(data.kind)) throw new Error('type de conteneur inconnu');
        const c = cur || { id: newId(), kind: data.kind || 'project', order: Date.now() };
        for (const k of ['name', 'icon', 'color', 'description', 'due', 'areaId', 'kind', 'order', 'status']) {
            if (data[k] !== undefined) c[k] = data[k];
        }
        if (data.archived !== undefined) { c.archived = !!data.archived; c.archivedAt = c.archived ? Date.now() : null; }
        c.name = String(c.name || 'Sans nom').slice(0, 80);
        return this.store.put('para', c);
    }

    removeContainer(id, { moveTo = null } = {}) {
        for (const n of this.all()) if (n.container === id) { n.container = moveTo; this.store.put('notes', n); }
        for (const c of this.containers()) if (c.areaId === id) { c.areaId = null; this.store.put('para', c); }
        return this.store.remove('para', id);
    }

    // Premier lancement : un petit espace d'exemple qui explique le système.
    seed() {
        if (this.all().length || this.containers().length) return false;
        const area = this.saveContainer({ kind: 'area', name: 'Stream', icon: '🎥', color: '#F0653D', description: 'Tout ce qui touche à la chaîne' });
        this.saveContainer({ kind: 'area', name: 'Santé', icon: '🌿', color: '#6FDA9A' });
        const proj = this.saveContainer({ kind: 'project', name: 'Prendre en main Pomodoro', icon: '🍅', color: '#E8B84D', areaId: area.id, description: 'Découvrir l’outil de notes et la liste de tâches du stream' });
        const res = this.saveContainer({ kind: 'resource', name: 'Markdown', icon: '📚', color: '#7AB8FF' });
        this.create({ container: null, body: `# Bienvenue dans ton Inbox 📥

L'Inbox (le **I** d'IPARA) reçoit tout ce que tu captures sans réfléchir : idées, liens, choses à faire. Une fois par semaine, vide-la en rangeant chaque note dans un projet, un domaine, une ressource — ou les archives.

- [ ] Lire la note [[La méthode IPARA]]
- [ ] Essayer le raccourci **Ctrl + N** (ou **⌘ + N**) pour une nouvelle note
- [ ] Taper \`!note une idée\` dans le chat pendant un stream : elle atterrit ici

#démarrage` });
        this.create({ container: proj.id, body: `# La méthode IPARA

Méthode **PARA** de Tiago Forte, précédée d'une **Inbox** :

1. **Inbox** — la boîte d'entrée, tout arrive ici
2. **Projets** — un objectif précis *avec une échéance* (« Préparer le stream du 12 »)
3. **Domaines** — une responsabilité *sans fin* à entretenir (Stream, Santé, Maison)
4. **Ressources** — des sujets qui t'intéressent, de la documentation
5. **Archives** — ce qui est terminé ou en pause, sans être supprimé

> Un projet se termine ; un domaine s'entretient. Quand un projet est fini, archive-le d'un clic : ses notes partent avec lui.

## Tags à la Bear
Écris #idée, #stream/overlay (sous-tag) ou #tag avec espaces# (forme fermée) n'importe où. Ils apparaissent dans la barre latérale.

## Liens entre notes
\`[[Titre d'une note]]\` crée un lien ; la note liée affiche ses *rétroliens* en bas de page. Voir [[Aide-mémoire Markdown]].

## Cases à cocher ↔ stream
Survole une case à cocher et clique sur 🎥 pour l'envoyer dans ta liste de tâches du stream. Quand tu tapes \`!done\` en live, la case se coche toute seule ici.

- [ ] Envoyer cette tâche au stream pour essayer

#démarrage #méthode` });
        this.create({ container: res.id, body: `# Aide-mémoire Markdown

Tout est du Markdown standard : tes notes s'ouvrent aussi dans Bear, Obsidian ou n'importe quel éditeur.

## Mise en forme
**gras** · *italique* · ~~barré~~ · \`code\` · ==surligné== · [lien](https://exemple.com)

## Listes
- puce
  - sous-puce
1. numérotée
- [ ] à faire
- [x] fait

## Blocs
> citation

\`\`\`js
console.log('bloc de code');
\`\`\`

---

| Tableau | Markdown |
|---------|----------|
| cellule | cellule  |

## Raccourcis
- **Ctrl/⌘ + B / I** : gras / italique
- **Ctrl/⌘ + K** : recherche partout
- **Ctrl/⌘ + N** : nouvelle note
- **Ctrl/⌘ + Maj + P** : aperçu

#démarrage` });
        return true;
    }
}

module.exports = { Notes, KINDS };
