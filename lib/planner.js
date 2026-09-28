// Calendrier (événements + repas planifiés) et liste de courses automatique.
//
// Un événement = calendar/<id>.json. Un repas planifié est un événement de
// type « meal » lié à une recette ; s'il est cuisiné pour plusieurs portions,
// les portions en trop deviennent des « restes » placés aux repas suivants
// (midi → soir → midi du lendemain…), sans ingrédients en double.
//
// La note « 🛒 Liste de courses » est régénérée dès que le planning (ou une
// recette planifiée) change : ingrédients des repas à venir additionnés et
// rangés par rayon, cases déjà cochées conservées, section « À ajouter à la
// main » jamais touchée.
const { newId } = require('./store');
const kitchen = require('./kitchen');
const md = require('./markdown-file');

const SLOTS = ['matin', 'midi', 'gouter', 'soir'];
const SLOT_LABEL = { matin: 'Petit-déj', midi: 'Midi', gouter: 'Goûter', soir: 'Soir' };
const MANUAL_HEADING = '## ✍️ À ajouter à la main';

const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const frDay = s => new Date(s + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const frShort = s => new Date(s + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });

class Planner {
    constructor({ store, notes, dbs, getSettings }) {
        this.store = store;
        this.notes = notes;
        this.dbs = dbs;
        this.getSettings = getSettings;
        this._timer = null;
        this._lastDay = iso(new Date());
        // Changement de jour : la fenêtre de la liste de courses avance.
        setInterval(() => { const d = iso(new Date()); if (d !== this._lastDay) { this._lastDay = d; this.scheduleShopping(); } }, 60 * 1000);
        store.on('change', ev => {
            if (ev.col === 'events') this.scheduleShopping();
            else if (ev.col === 'notes' && ev.obj && ev.obj.db && !this._writing) {
                const db = this.dbs.get(ev.obj.db);
                if (db && db.kind === 'recipes' && this.events().some(e => e.recipeId === ev.id)) this.scheduleShopping();
            }
        });
    }

    events() { return this.store.list('events'); }
    between(from, to) { return this.events().filter(e => e.date >= from && e.date <= to).sort((a, b) => (a.date + (a.time || slotTime(a.slot))).localeCompare(b.date + (b.time || slotTime(b.slot)))); }

    save(data) {
        const cur = data.id ? this.store.get('events', data.id) : null;
        const e = cur || { id: newId(), kind: 'event' };
        for (const k of ['title', 'date', 'time', 'endTime', 'allDay', 'color', 'kind', 'slot', 'recipeId', 'portions', 'leftoverOf', 'notes', 'emoji']) if (data[k] !== undefined) e[k] = data[k];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) throw Object.assign(new Error('date invalide'), { status: 400 });
        e.title = String(e.title || '').slice(0, 120);
        const saved = this.store.put('events', e);
        // Déplacer un repas déplace aussi ses restes ; changer ses portions les recrée.
        if (cur && e.kind === 'meal' && !e.leftoverOf && (data.date !== undefined || data.slot !== undefined || data.portions !== undefined)) this.placeLeftovers(e, data.leftovers !== false);
        return saved;
    }

    remove(id) {
        for (const l of this.events().filter(x => x.leftoverOf === id)) this.store.remove('events', l.id);
        return this.store.remove('events', id);
    }

    // Planifie une recette : un repas + ses restes.
    planMeal({ recipeId, date, slot = 'midi', portions, leftovers = true }) {
        const n = this.notes.get(recipeId);
        if (!n) throw Object.assign(new Error('recette introuvable'), { status: 404 });
        const p = Number(portions) || Number((n.props || {}).portions) || 2;
        const meal = this.store.put('events', {
            id: newId(), kind: 'meal', date, slot, recipeId, portions: p,
            title: this.notes.meta(n).title, emoji: (n.props || {}).emoji || '🍽️'
        });
        this.placeLeftovers(meal, leftovers);
        return meal;
    }

    placeLeftovers(meal, enabled = true) {
        for (const l of this.events().filter(x => x.leftoverOf === meal.id)) this.store.remove('events', l.id);
        if (!enabled) return [];
        const extra = Math.max(0, (Number(meal.portions) || 1) - 1);
        const out = [];
        let date = meal.date, slot = meal.slot === 'soir' || meal.slot === 'gouter' ? 'soir' : 'midi';
        for (let i = 0; i < extra; i++) {
            if (slot === 'midi') slot = 'soir'; else { slot = 'midi'; date = addDays(date, 1); }
            out.push(this.store.put('events', { id: newId(), kind: 'meal', date, slot, recipeId: meal.recipeId, leftoverOf: meal.id, portions: 1, title: meal.title, emoji: '🍱' }));
        }
        return out;
    }

    // ── Liste de courses ──
    scheduleShopping() {
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.refreshShopping(), 800);
    }

    shoppingNote() {
        return this.notes.all().find(n => n.extra && n.extra.role === 'shopping' && !n.trashed) || null;
    }

    horizon() {
        const days = Number(((this.getSettings() || {}).kitchen || {}).horizonDays) || 7;
        const from = iso(new Date());
        return { from, to: addDays(from, days - 1), days };
    }

    // Repas cuisinés (hors restes) dans la fenêtre à venir.
    upcomingMeals() {
        const { from, to } = this.horizon();
        return this.between(from, to).filter(e => e.kind === 'meal');
    }

    buildShoppingBody(prevBody) {
        const { from, to } = this.horizon();
        const meals = this.upcomingMeals();
        const cooked = meals.filter(m => !m.leftoverOf).map(m => {
            const n = this.notes.get(m.recipeId);
            return n ? { event: m, recipe: { id: n.id, title: this.notes.meta(n).title, body: n.body, portions: (n.props || {}).portions || 2 }, portions: m.portions } : null;
        }).filter(Boolean);
        const list = kitchen.shoppingList(cooked);

        // Cases cochées et section manuelle de la version précédente.
        const checked = new Set();
        let manual = '- [ ] ';
        if (prevBody) {
            const i = prevBody.indexOf(MANUAL_HEADING);
            if (i >= 0) {
                manual = prevBody.slice(i + MANUAL_HEADING.length).replace(/\n#courses\s*$/, '').replace(/^\s*\n/, '').replace(/\s+$/, '') || '- [ ] ';
            }
            for (const t of md.taskLinesOf(i >= 0 ? prevBody.slice(0, i) : prevBody)) {
                if (!t.checked) continue;
                const ing = kitchen.parseIngredient(t.raw.split(' · ')[0]);
                if (ing) checked.add(ing.key);
            }
        }

        const lines = ['# 🛒 Liste de courses', ''];
        const nMeals = meals.length;
        lines.push(`> 🗓️ Du ${frDay(from)} au ${frDay(to)} · ${nMeals ? `${nMeals} repas planifié${nMeals > 1 ? 's' : ''}` : 'aucun repas planifié'}`);
        lines.push('> Mise à jour automatique depuis le calendrier. Coche au fur et à mesure : tes cases restent cochées.');
        lines.push('');
        if (meals.length) {
            lines.push('## 🍽️ Au menu');
            const byDay = new Map();
            for (const m of meals) { if (!byDay.has(m.date)) byDay.set(m.date, []); byDay.get(m.date).push(m); }
            for (const [day, list2] of byDay) {
                const parts = list2.map(m => `${SLOT_LABEL[m.slot] || m.slot} : ${m.leftoverOf ? `🍱 restes de [[${m.title}]]` : `${m.emoji || '🍽️'} [[${m.title}]]${m.portions > 1 ? ` *(${m.portions} portions)*` : ''}`}`);
                lines.push(`- **${cap(frShort(day))}** — ${parts.join(' · ')}`);
            }
            lines.push('');
        }
        if (list.length) {
            for (const { aisle, items } of list) {
                lines.push(`## ${aisle}`);
                for (const it of items) lines.push(`- [${checked.has(it.key) ? 'x' : ' '}] ${it.text} · *${it.recipes.join(', ')}*`);
                lines.push('');
            }
        } else {
            lines.push('*Planifie des repas dans le 📅 calendrier : leurs ingrédients apparaîtront ici, rangés par rayon.*', '');
        }
        lines.push(MANUAL_HEADING, manual, '', '#courses');
        return lines.join('\n') + '\n';
    }

    refreshShopping() {
        let n = this.shoppingNote();
        const body = this.buildShoppingBody(n ? n.body : null);
        if (n && n.body.trim() === body.trim()) return n;
        this._writing = true;
        try {
            if (!n) {
                const area = this.notes.containers().find(c => c.kind === 'area' && /^maison$/i.test(c.name)) ||
                    this.notes.saveContainer({ kind: 'area', name: 'Maison', icon: '🏠', color: '#E8B84D', description: 'Courses, repas, logement.' });
                n = { id: newId(), body, container: area.id, pinned: true, extra: { role: 'shopping' } };
                return this.store.put('notes', n);
            }
            n.body = body;
            return this.store.put('notes', n);
        } finally { this._writing = false; }
    }
}

function slotTime(slot) { return { matin: '08:00', midi: '12:30', gouter: '16:30', soir: '19:30' }[slot] || '23:59'; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

module.exports = { Planner, SLOTS, SLOT_LABEL };
