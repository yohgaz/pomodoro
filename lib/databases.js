// Bases de données façon Notion. Une base = un fichier db/<id>.json (nom,
// icône, propriétés, vues). Chaque fiche est une NOTE Markdown ordinaire
// (notes/<id>.md) portant « db: <id> » et ses propriétés dans l'en-tête :
// on garde la recherche, les liens [[…]], l'historique et le téléphone.
const { newId } = require('./store');
const md = require('./markdown-file');

const TYPES = ['text', 'number', 'select', 'multi', 'checkbox', 'date', 'url'];
const COLORS = ['#F0653D', '#E8B84D', '#6FDA9A', '#5FD4D4', '#7AB8FF', '#C792EA', '#FF8FB1', '#A6A29B'];

const RECIPE_SCHEMA = [
    { id: 'categorie', name: 'Catégorie', type: 'select', options: [
        { name: 'Plat', color: '#F0653D' }, { name: 'Soupe', color: '#E8B84D' }, { name: 'Salade', color: '#6FDA9A' },
        { name: 'Accompagnement', color: '#5FD4D4' }, { name: 'Petit-déjeuner', color: '#7AB8FF' }, { name: 'Dessert', color: '#FF8FB1' }] },
    { id: 'preparation', name: 'Préparation', type: 'number', unit: 'min' },
    { id: 'cuisson', name: 'Cuisson', type: 'number', unit: 'min' },
    { id: 'portions', name: 'Portions', type: 'number' },
    { id: 'difficulte', name: 'Difficulté', type: 'select', options: [
        { name: 'Facile', color: '#6FDA9A' }, { name: 'Moyen', color: '#E8B84D' }, { name: 'Avancé', color: '#F0653D' }] },
    { id: 'regime', name: 'Régime', type: 'multi', options: [
        { name: 'Végétarien', color: '#6FDA9A' }, { name: 'Vegan', color: '#5FD4D4' }, { name: 'Sans gluten', color: '#E8B84D' }, { name: 'Riche en protéines', color: '#F0653D' }] },
    { id: 'tags', name: 'Tags', type: 'multi', options: [] },
    { id: 'favori', name: 'Favori', type: 'checkbox' },
    { id: 'source', name: 'Source', type: 'url' }
];

class Databases {
    constructor({ store, notes }) {
        this.store = store;
        this.notes = notes;
    }

    list() { return this.store.list('dbs').sort((a, b) => (a.order || 0) - (b.order || 0)); }
    get(id) { return this.store.get('dbs', id); }
    byKind(kind) { return this.list().find(d => d.kind === kind) || null; }

    save(data) {
        const cur = data.id ? this.get(data.id) : null;
        const db = cur || { id: newId(), kind: 'generic', order: Date.now(), properties: [], views: [{ id: 'table', name: 'Tableau', type: 'table' }] };
        for (const k of ['name', 'icon', 'description', 'kind', 'properties', 'views', 'order', 'color']) if (data[k] !== undefined) db[k] = data[k];
        db.name = String(db.name || 'Sans nom').slice(0, 80);
        db.properties = (db.properties || []).filter(p => p && p.id && TYPES.includes(p.type));
        return this.store.put('dbs', db);
    }

    // Supprimer une base met ses fiches à la corbeille (récupérables 30 jours).
    remove(id) {
        for (const n of this.notes.all()) if (n.db === id && !n.trashed) this.notes.update(n.id, { trashed: true });
        return this.store.remove('dbs', id);
    }

    rows(dbId) {
        return this.notes.all().filter(n => n.db === dbId && !n.trashed).map(n => this.row(n));
    }

    row(n) {
        const m = this.notes.meta(n);
        return { id: n.id, title: m.title, excerpt: m.excerpt, props: n.props || {}, updatedAt: n.updatedAt, createdAt: n.createdAt, cover: firstImage(n.body) };
    }

    createRow(dbId, { title = '', props = {}, body } = {}) {
        const db = this.get(dbId);
        if (!db) throw Object.assign(new Error('base introuvable'), { status: 404 });
        const text = body !== undefined ? body : (db.kind === 'recipes'
            ? `# ${title || 'Nouvelle recette'}\n\nQuelques mots sur la recette.\n\n## Ingrédients\n- \n\n## Préparation\n1. \n`
            : `# ${title}\n\n`);
        const n = { id: newId(), body: text, container: null, db: dbId, props: { ...props }, extra: {} };
        return this.store.put('notes', n);
    }

    setProps(noteId, props) {
        const n = this.notes.get(noteId);
        if (!n) return null;
        n.props = { ...(n.props || {}), ...props };
        for (const [k, v] of Object.entries(n.props)) if (v === null || v === '' || (Array.isArray(v) && !v.length)) delete n.props[k];
        // Les nouvelles options de sélection sont ajoutées au schéma de la base.
        const db = this.get(n.db);
        if (db) {
            let changed = false;
            for (const p of db.properties) {
                if (p.type !== 'select' && p.type !== 'multi') continue;
                const vals = [].concat(n.props[p.id] || []);
                p.options = p.options || [];
                for (const v of vals) if (v && !p.options.some(o => o.name === v)) { p.options.push({ name: v, color: COLORS[p.options.length % COLORS.length] }); changed = true; }
            }
            if (changed) this.store.put('dbs', db);
        }
        return this.store.put('notes', n);
    }

    // Base « Recettes » d'exemple (créée une seule fois, à la demande).
    seedRecipes() {
        let db = this.byKind('recipes');
        if (db && this.rows(db.id).length) return { db, created: 0 };
        if (!db) db = this.save({
            name: 'Recettes', icon: '🍳', kind: 'recipes', color: '#F0653D',
            description: 'Tes recettes : clique sur une carte pour l’ouvrir, planifie-la dans le calendrier et ses ingrédients arrivent dans la liste de courses.',
            properties: RECIPE_SCHEMA,
            views: [
                { id: 'gallery', name: 'Galerie', type: 'gallery' },
                { id: 'table', name: 'Tableau', type: 'table' },
                { id: 'board', name: 'Par catégorie', type: 'board', groupBy: 'categorie' }
            ]
        });
        const seed = require('./recipes-seed');
        const tagsProp = db.properties.find(p => p.id === 'tags');
        const tags = new Set();
        for (const r of seed) {
            this.createRow(db.id, { title: r.title, props: { ...r.props, emoji: r.emoji }, body: r.body });
            (r.props.tags || []).forEach(t => tags.add(t));
        }
        tagsProp.options = [...tags].map((t, i) => ({ name: t, color: COLORS[i % COLORS.length] }));
        this.store.put('dbs', db);
        return { db, created: seed.length };
    }
}

function firstImage(body) {
    const m = String(body || '').match(/!\[[^\]]*\]\(([^)\s]+)\)/);
    return m ? m[1] : null;
}

module.exports = { Databases, TYPES, RECIPE_SCHEMA };
