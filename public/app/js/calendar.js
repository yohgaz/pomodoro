// Calendrier : événements + repas planifiés (depuis la base Recettes).
// Vue mois (vue d'ensemble) et vue semaine (planning des repas midi/soir).
import { get, post, put, del, on } from './api.js';
import { h, icon, toast, modal, confirmBox, debounce, COLORS } from './ui.js';
import { planDialog } from './db.js';

const SLOTS = [['matin', 'Petit-déj', '☀️'], ['midi', 'Midi', '🍽️'], ['soir', 'Soir', '🌙']];
const SLOT_LABEL = { matin: 'Petit-déj', midi: 'Midi', gouter: 'Goûter', soir: 'Soir' };
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => new Date(s + 'T12:00:00');
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const mondayOf = s => { const d = parse(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return iso(d); };
const today = () => iso(new Date());

const V = { root: null, ctx: null, mode: 'week', cursor: today(), events: [], recipes: [], recipesDb: null, q: '' };
try { V.mode = localStorage.getItem('pomodoro.calmode') || 'week'; } catch (e) { /* rien */ }

const reload = debounce(async () => { if (V.root && V.root.isConnected) { await load(); draw(); } }, 300);
on('notes', () => reload());

export async function render(container, ctx) {
    V.ctx = ctx;
    V.root = h('div', { class: 'wide-inner cal-page' });
    container.replaceChildren(V.root);
    const dbs = await get('/api/dbs');
    V.recipesDb = dbs.find(d => d.kind === 'recipes') || null;
    V.recipes = V.recipesDb ? await get(`/api/dbs/${V.recipesDb.id}/rows`) : [];
    await load();
    draw();
}

function range() {
    if (V.mode === 'week') { const from = mondayOf(V.cursor); return { from, to: addDays(from, 6) }; }
    const d = parse(V.cursor);
    const first = iso(new Date(d.getFullYear(), d.getMonth(), 1));
    const from = mondayOf(first);
    return { from, to: addDays(from, 41) };
}

async function load() {
    const { from, to } = range();
    V.events = await get(`/api/calendar?from=${from}&to=${to}`);
}

function title() {
    if (V.mode === 'week') {
        const { from, to } = range();
        const a = parse(from), b = parse(to);
        return `${a.getDate()} ${a.getMonth() !== b.getMonth() ? a.toLocaleDateString('fr-FR', { month: 'short' }) : ''} – ${b.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}`;
    }
    const t = parse(V.cursor).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    return t.charAt(0).toUpperCase() + t.slice(1);
}

function move(dir) {
    const d = parse(V.cursor);
    if (V.mode === 'week') d.setDate(d.getDate() + 7 * dir);
    else d.setMonth(d.getMonth() + dir, 1);
    V.cursor = iso(d);
    load().then(draw);
}

async function openShopping() {
    const r = await post('/api/shopping/refresh');
    V.ctx.navigate(`/v/all/${r.id}`);
}

function draw() {
    const seg = h('div', { class: 'seg' }, ...[['week', 'Semaine'], ['month', 'Mois']].map(([k, l]) => h('button', { class: V.mode === k ? 'is-on' : '', onclick: () => {
        V.mode = k; try { localStorage.setItem('pomodoro.calmode', k); } catch (e) { /* rien */ } load().then(draw);
    } }, l)));
    V.root.replaceChildren(
        h('div', { class: 'wide-head' },
            h('h1', {}, '📅 ', title()),
            h('div', { class: 'row' },
                h('button', { class: 'icon-btn', title: 'Précédent', onclick: () => move(-1) }, icon('back')),
                h('button', { class: 'btn small', onclick: () => { V.cursor = today(); load().then(draw); } }, 'Aujourd’hui'),
                h('button', { class: 'icon-btn', title: 'Suivant', onclick: () => move(1), style: { transform: 'scaleX(-1)' } }, icon('back'))),
            seg,
            h('button', { class: 'btn', onclick: () => editEvent({ date: V.mode === 'week' ? mondayOf(V.cursor) < today() && addDays(mondayOf(V.cursor), 6) >= today() ? today() : mondayOf(V.cursor) : today() }) }, icon('plus'), 'Événement'),
            h('button', { class: 'btn mint', onclick: openShopping }, '🛒 Liste de courses')),
        V.mode === 'week' ? weekView() : monthView());
}

// ── Pastilles d'événements ──
function evChip(e, { compact = false } = {}) {
    const meal = e.kind === 'meal';
    const color = meal ? (e.leftoverOf ? '#A6A29B' : '#E8B84D') : (e.color || '#7AB8FF');
    const label = meal
        ? `${e.leftoverOf ? '🍱' : (e.emoji || '🍽️')} ${compact ? '' : (SLOT_LABEL[e.slot] || '') + ' · '}${e.leftoverOf ? 'restes : ' : ''}${e.title}`
        : `${e.time ? e.time + ' ' : ''}${e.title}`;
    const c = h('button', { class: `cal-ev ${meal ? 'is-meal' : ''} ${e.leftoverOf ? 'is-left' : ''}`, draggable: 'true', title: label, style: { '--c': color },
        onclick: ev => { ev.stopPropagation(); editEvent(e); } }, label);
    c.addEventListener('dragstart', ev => { ev.stopPropagation(); ev.dataTransfer.setData('text/event', e.id); });
    return c;
}

function dropTarget(el, date, slot) {
    el.addEventListener('dragover', e => { if ([...e.dataTransfer.types].some(t => t === 'text/event' || t === 'text/recipe')) { e.preventDefault(); el.classList.add('is-drop'); } });
    el.addEventListener('dragleave', () => el.classList.remove('is-drop'));
    el.addEventListener('drop', async e => {
        e.preventDefault(); el.classList.remove('is-drop');
        const evId = e.dataTransfer.getData('text/event');
        const recId = e.dataTransfer.getData('text/recipe');
        if (evId) {
            const ev = V.events.find(x => x.id === evId);
            await put(`/api/calendar/${evId}`, slot && ev && ev.kind === 'meal' ? { date, slot } : { date });
            toast('Déplacé ✓', 'ok');
        } else if (recId) {
            const r = V.recipes.find(x => x.id === recId);
            if (r) await planDialog(r, r.props.portions, V.ctx, date, slot || 'midi');
        }
        await load(); draw();
    });
}

// ── Vue semaine : planning des repas ──
function weekView() {
    const from = mondayOf(V.cursor);
    const days = Array.from({ length: 7 }, (_, i) => addDays(from, i));
    const grid = h('div', { class: 'cal-week' },
        h('div', { class: 'cal-corner' }),
        ...days.map(d => {
            const dt = parse(d);
            return h('div', { class: `cal-dayhead ${d === today() ? 'is-today' : ''}` }, h('span', {}, dt.toLocaleDateString('fr-FR', { weekday: 'short' })), h('b', {}, String(dt.getDate())));
        }),
        // ligne « événements »
        h('div', { class: 'cal-rowlabel' }, '📌 Agenda'),
        ...days.map(d => {
            const cell = h('div', { class: 'cal-cell cal-agenda', onclick: () => editEvent({ date: d }) },
                ...V.events.filter(e => e.date === d && e.kind !== 'meal').map(e => evChip(e)));
            dropTarget(cell, d, null);
            return cell;
        }),
        // lignes repas
        ...SLOTS.flatMap(([slot, label, ico]) => [
            h('div', { class: 'cal-rowlabel' }, `${ico} ${label}`),
            ...days.map(d => {
                const meals = V.events.filter(e => e.date === d && e.kind === 'meal' && e.slot === slot);
                const cell = h('div', { class: 'cal-cell cal-meal', onclick: () => pickRecipe(d, slot) },
                    ...meals.map(e => evChip(e, { compact: true })),
                    meals.length ? null : h('span', { class: 'cal-add' }, '+'));
                dropTarget(cell, d, slot);
                return cell;
            })
        ])
    );
    return h('div', { class: 'cal-layout' }, grid, recipeSidebar());
}

// ── Vue mois ──
function monthView() {
    const { from } = range();
    const month = parse(V.cursor).getMonth();
    const days = Array.from({ length: 42 }, (_, i) => addDays(from, i));
    return h('div', { class: 'cal-month' },
        ...['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'].map(d => h('div', { class: 'cal-mhead' }, d)),
        ...days.map(d => {
            const dt = parse(d);
            const evs = V.events.filter(e => e.date === d).sort((a, b) => (a.kind === 'meal') - (b.kind === 'meal'));
            const cell = h('div', { class: `cal-mcell ${dt.getMonth() !== month ? 'is-out' : ''} ${d === today() ? 'is-today' : ''}`, onclick: () => editEvent({ date: d }) },
                h('span', { class: 'cal-mnum' }, String(dt.getDate())),
                ...evs.slice(0, 4).map(e => evChip(e, { compact: true })),
                evs.length > 4 ? h('span', { class: 'cal-more' }, `+ ${evs.length - 4}`) : null);
            dropTarget(cell, d, null);
            return cell;
        }));
}

// ── Recettes à glisser sur le planning ──
function recipeSidebar() {
    const list = h('div', { class: 'cal-rlist' });
    const q = h('input', { class: 'input', type: 'search', placeholder: 'Chercher une recette…', value: V.q });
    const drawList = () => {
        const f = V.q.toLowerCase();
        list.replaceChildren(...V.recipes.filter(r => !f || r.title.toLowerCase().includes(f) || JSON.stringify(r.props).toLowerCase().includes(f))
            .sort((a, b) => (b.props.favori ? 1 : 0) - (a.props.favori ? 1 : 0) || a.title.localeCompare(b.title, 'fr'))
            .map(r => {
                const t = (Number(r.props.preparation) || 0) + (Number(r.props.cuisson) || 0);
                const b = h('button', { class: 'cal-recipe', draggable: 'true', title: 'Glisse sur un repas, ou clique pour planifier', onclick: async () => { if (await planDialog(r, r.props.portions, V.ctx)) { await load(); draw(); } } },
                    h('span', { class: 'cal-remoji' }, r.props.emoji || '🍽️'),
                    h('span', { class: 'cal-rtitle' }, r.title, h('small', {}, [r.props.favori ? '★' : '', t ? `⏱ ${t} min` : '', r.props.portions ? `🍽 ${r.props.portions}` : ''].filter(Boolean).join(' · '))));
                b.addEventListener('dragstart', e => e.dataTransfer.setData('text/recipe', r.id));
                return b;
            }));
    };
    q.addEventListener('input', () => { V.q = q.value; drawList(); });
    drawList();
    return h('div', { class: 'card cal-side' },
        h('h3', {}, `${V.recipesDb ? V.recipesDb.icon : '🍳'} Recettes`, h('small', {}, 'glisse sur un repas')),
        V.recipesDb ? q : h('p', { class: 'help' }, 'Aucune base de recettes.'),
        list,
        V.recipesDb ? h('button', { class: 'btn small ghost', style: { marginTop: '8px' }, onclick: () => V.ctx.navigate(`/db/${V.recipesDb.id}`) }, 'Voir toutes les recettes →') : null);
}

// Choisir une recette pour un créneau de repas
function pickRecipe(date, slot) {
    if (!V.recipes.length) return editEvent({ date });
    const q = h('input', { class: 'input', placeholder: 'Chercher une recette…' });
    const grid = h('div', { class: 'cal-pick' });
    const drawGrid = () => {
        const f = q.value.toLowerCase();
        grid.replaceChildren(...V.recipes.filter(r => !f || r.title.toLowerCase().includes(f) || JSON.stringify(r.props).toLowerCase().includes(f))
            .sort((a, b) => (b.props.favori ? 1 : 0) - (a.props.favori ? 1 : 0) || a.title.localeCompare(b.title, 'fr'))
            .map(r => h('button', { class: 'cal-recipe', onclick: async () => { m.close(); if (await planDialog(r, r.props.portions, V.ctx, date, slot)) { await load(); draw(); } } },
                h('span', { class: 'cal-remoji' }, r.props.emoji || '🍽️'), h('span', { class: 'cal-rtitle' }, r.title, h('small', {}, r.props.categorie || '')))));
    };
    q.addEventListener('input', drawGrid);
    drawGrid();
    const m = modal({
        title: `🍽️ ${SLOT_LABEL[slot]} — ${parse(date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}`,
        wide: true, body: [q, grid],
        foot: [h('button', { class: 'btn ghost', onclick: () => { m.close(); editEvent({ date, kind: 'meal-free', slot }); } }, 'Repas sans recette…')]
    });
}

// ── Créer / modifier un événement ──
function editEvent(e) {
    const isNew = !e.id;
    const meal = e.kind === 'meal';
    const data = { title: '', date: today(), time: '', endTime: '', color: COLORS[4], notes: '', ...e };
    if (e.kind === 'meal-free') { data.kind = 'meal'; data.emoji = '🍽️'; }
    const t = h('input', { class: 'input', value: data.title, placeholder: e.kind === 'meal-free' ? 'Ex. Restaurant avec Léa' : 'Titre de l’événement' });
    const date = h('input', { class: 'input', type: 'date', value: data.date });
    const time = h('input', { class: 'input', type: 'time', value: data.time || '' });
    const end = h('input', { class: 'input', type: 'time', value: data.endTime || '' });
    const notes = h('textarea', { placeholder: 'Notes (facultatif)' }, data.notes || '');
    const sw = h('div', { class: 'swatches' });
    const drawSw = () => sw.replaceChildren(...COLORS.map(c => h('span', { class: `swatch ${data.color === c ? 'is-on' : ''}`, style: { background: c }, onclick: () => { data.color = c; drawSw(); } })));
    drawSw();
    let slot = data.slot || 'midi';
    const slotSeg = h('div', { class: 'seg' });
    const drawSlot = () => slotSeg.replaceChildren(...SLOTS.map(([k, l]) => h('button', { class: slot === k ? 'is-on' : '', onclick: () => { slot = k; drawSlot(); } }, l)));
    drawSlot();
    const por = h('input', { class: 'input', type: 'number', min: 1, max: 20, value: data.portions || 1, style: { width: '90px' } });
    const recipe = meal && e.recipeId ? V.recipes.find(r => r.id === e.recipeId) : null;
    const save = async () => {
        const body = { title: t.value.trim() || (meal ? data.title : 'Sans titre'), date: date.value, notes: notes.value };
        if (data.kind === 'meal') Object.assign(body, { kind: 'meal', slot, emoji: data.emoji, ...(e.leftoverOf ? {} : { portions: Number(por.value) }) });
        else Object.assign(body, { time: time.value, endTime: end.value, color: data.color, kind: 'event' });
        if (isNew) await post('/api/calendar', body); else await put(`/api/calendar/${e.id}`, body);
        m.close(); await load(); draw();
    };
    const foot = [];
    if (!isNew) foot.push(h('button', { class: 'btn ghost danger left', onclick: async () => {
        if (!await confirmBox('Supprimer ?', e.kind === 'meal' && !e.leftoverOf ? 'Le repas et ses restes seront retirés (et leurs ingrédients de la liste de courses).' : 'Cet élément sera retiré du calendrier.', { ok: 'Supprimer', danger: true })) return;
        await del(`/api/calendar/${e.id}`); m.close(); await load(); draw();
    } }, 'Supprimer'));
    if (recipe) foot.push(h('button', { class: 'btn', onclick: () => { m.close(); V.ctx.navigate(`/db/${V.recipesDb.id}/${recipe.id}`); } }, '📖 Ouvrir la recette'));
    foot.push(h('button', { class: 'btn primary', onclick: save }, isNew ? 'Ajouter' : 'Enregistrer'));
    const m = modal({
        title: isNew ? (data.kind === 'meal' ? '🍽️ Repas' : '📌 Nouvel événement') : (meal ? `${e.leftoverOf ? '🍱 Restes' : (e.emoji || '🍽️')} ${e.title}` : '📌 Événement'),
        body: data.kind === 'meal' ? [
            recipe ? null : h('label', { class: 'field' }, h('span', {}, 'Repas'), t),
            h('div', { class: 'row' }, h('label', { class: 'field' }, h('span', {}, 'Jour'), date), e.leftoverOf ? null : h('label', { class: 'field', style: { flex: 0 } }, h('span', {}, 'Portions'), por)),
            h('div', { class: 'field' }, h('span', {}, 'Créneau'), slotSeg),
            e.leftoverOf ? h('p', { class: 'help' }, 'Ce sont les restes d’un repas cuisiné plus tôt : pas d’ingrédients en plus dans la liste de courses.') : (recipe ? h('p', { class: 'help' }, 'Changer les portions recalcule les restes et la liste de courses.') : null),
            h('label', { class: 'field' }, h('span', {}, 'Notes'), notes)
        ] : [
            h('label', { class: 'field' }, h('span', {}, 'Titre'), t),
            h('div', { class: 'row' }, h('label', { class: 'field' }, h('span', {}, 'Jour'), date), h('label', { class: 'field' }, h('span', {}, 'Début'), time), h('label', { class: 'field' }, h('span', {}, 'Fin'), end)),
            h('div', { class: 'field' }, h('span', {}, 'Couleur'), sw),
            h('label', { class: 'field' }, h('span', {}, 'Notes'), notes)
        ],
        foot
    });
    t.addEventListener('keydown', ev => { if (ev.key === 'Enter') save(); });
}
