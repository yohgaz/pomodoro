// Bases de données façon Notion : vues galerie / tableau / tableau kanban,
// et page de fiche. Pour la base « Recettes », la fiche est une vraie page de
// recette (ingrédients ajustables aux portions, étapes numérotées,
// planification dans le calendrier).
import { get, post, put, del, on } from './api.js';
import { h, icon, toast, modal, confirmBox, promptBox, menu, debounce } from './ui.js';
import { createEditor, renderMarkdown } from '/vendor/editor.bundle.js?v=2';
import { scaleLine } from './kitchen-client.js';

const TYPE_LABEL = { text: 'Texte', number: 'Nombre', select: 'Sélection', multi: 'Multi-sélection', checkbox: 'Case à cocher', date: 'Date', url: 'Lien' };
const V = { root: null, ctx: null, db: null, rows: [], view: null, q: '', filters: {}, favOnly: false, sort: 'title', editor: null, rowId: null };

const reload = debounce(async () => {
    if (!V.root || !V.root.isConnected || !V.db || V.rowId) return;
    V.rows = await get(`/api/dbs/${V.db.id}/rows`);
    drawList();
}, 400);
on('notes', () => reload());

export async function render(container, ctx) {
    V.ctx = ctx;
    if (V.editor) { V.editor.destroy(); V.editor = null; }
    V.root = h('div', { class: 'wide-inner db-page' });
    container.replaceChildren(V.root);
    V.rowId = ctx.sub || null;
    try { V.db = await get(`/api/dbs/${ctx.tab}`); }
    catch (e) { V.root.replaceChildren(h('p', { class: 'help' }, 'Base introuvable.')); return; }
    if (V.rowId) return renderRow(V.rowId);
    V.rows = await get(`/api/dbs/${V.db.id}/rows`);
    const views = viewsOf(V.db);
    try { V.view = localStorage.getItem('pomodoro.dbview.' + V.db.id) || views[0].id; } catch (e) { V.view = views[0].id; }
    if (!views.some(v => v.id === V.view)) V.view = views[0].id;
    drawList();
}

function viewsOf(db) {
    const out = [...(db.views || [])];
    if (!out.some(v => v.type === 'gallery')) out.push({ id: 'gallery', name: 'Galerie', type: 'gallery' });
    if (!out.some(v => v.type === 'table')) out.push({ id: 'table', name: 'Tableau', type: 'table' });
    const sel = db.properties.find(p => p.type === 'select');
    if (sel && !out.some(v => v.type === 'board')) out.push({ id: 'board', name: `Par ${sel.name.toLowerCase()}`, type: 'board', groupBy: sel.id });
    return out;
}

// ── Utilitaires de propriétés ──
const propById = id => V.db.properties.find(p => p.id === id);
const optColor = (p, name) => ((p.options || []).find(o => o.name === name) || {}).color || '#A6A29B';
const isRecipes = () => V.db.kind === 'recipes';
const totalTime = r => (Number(r.props.preparation) || 0) + (Number(r.props.cuisson) || 0);
const fmtMin = m => !m ? '' : m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') : ''}` : `${m} min`;
const coverColor = r => { const p = V.db.properties.find(x => x.type === 'select'); return p && r.props[p.id] ? optColor(p, r.props[p.id]) : (V.db.color || '#F0653D'); };
const inline = md => renderMarkdown(md).replace(/^\s*<p>|<\/p>\s*$/g, '');

function chip(p, value) {
    const c = optColor(p, value);
    return h('span', { class: 'db-chip', style: { color: c, background: `color-mix(in srgb, ${c} 16%, transparent)` } }, value);
}

async function saveProps(rowId, patch) {
    const r = V.rows.find(x => x.id === rowId);
    if (r) Object.assign(r.props, patch);
    await put(`/api/rows/${rowId}/props`, patch);
    V.db = await get(`/api/dbs/${V.db.id}`);
}

// ── Liste (en-tête, vues, filtres) ──
function filtered() {
    let rows = V.rows.slice();
    if (V.q) { const q = V.q.toLowerCase(); rows = rows.filter(r => r.title.toLowerCase().includes(q) || (r.excerpt || '').toLowerCase().includes(q) || JSON.stringify(r.props).toLowerCase().includes(q)); }
    for (const [pid, val] of Object.entries(V.filters)) if (val) rows = rows.filter(r => [].concat(r.props[pid] || []).includes(val));
    if (V.favOnly) rows = rows.filter(r => r.props.favori);
    const cmp = {
        title: (a, b) => a.title.localeCompare(b.title, 'fr'),
        recent: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
        time: (a, b) => totalTime(a) - totalTime(b)
    }[V.sort] || (() => 0);
    return rows.sort(cmp);
}

function drawList() {
    const db = V.db;
    const views = viewsOf(db);
    const view = views.find(v => v.id === V.view) || views[0];
    const search = h('input', { class: 'input', type: 'search', placeholder: isRecipes() ? 'Chercher une recette, un ingrédient…' : 'Rechercher…', value: V.q, style: { maxWidth: '280px' } });
    search.addEventListener('input', debounce(() => { V.q = search.value; drawBody(view); }, 150));
    const filterProps = db.properties.filter(p => (p.type === 'select' || p.type === 'multi') && (p.options || []).length).slice(0, 3);
    const filters = filterProps.map(p => {
        const b = h('button', { class: `chip-btn ${V.filters[p.id] ? 'is-on' : ''}` }, h('span', {}, V.filters[p.id] ? `${p.name} : ${V.filters[p.id]}` : p.name), '▾');
        b.onclick = () => menu(b, [{ label: p.name }, { icon: V.filters[p.id] ? '' : '✓', text: 'Tout', run: () => { delete V.filters[p.id]; drawList(); } },
            ...p.options.map(o => ({ icon: V.filters[p.id] === o.name ? '✓' : '●', text: o.name, run: () => { V.filters[p.id] = o.name; drawList(); } }))]);
        return b;
    });
    const favBtn = propById('favori') ? h('button', { class: `chip-btn ${V.favOnly ? 'is-on' : ''}`, onclick: () => { V.favOnly = !V.favOnly; drawList(); } }, V.favOnly ? '★ Favoris' : '☆ Favoris') : null;
    const sortSel = h('select', { class: 'input', style: { width: 'auto' } },
        ...[['title', 'Nom'], ['recent', 'Modifiées récemment'], ...(isRecipes() ? [['time', 'Plus rapides']] : [])].map(([k, l]) => h('option', { value: k, selected: V.sort === k }, `Tri : ${l}`)));
    sortSel.onchange = () => { V.sort = sortSel.value; drawBody(view); };

    V.root.replaceChildren(
        h('div', { class: 'db-head' },
            h('div', { class: 'db-icon' }, db.icon || '🗃️'),
            h('div', { style: { flex: 1, minWidth: 0 } }, h('h1', {}, db.name), db.description ? h('p', { class: 'help', style: { margin: '4px 0 0' } }, db.description) : null),
            h('button', { class: 'btn primary', onclick: newRow }, icon('plus'), isRecipes() ? 'Nouvelle recette' : 'Nouvelle fiche'),
            h('button', { class: 'icon-btn', title: 'Propriétés et options', onclick: e => dbMenu(e.currentTarget) }, icon('more'))),
        h('div', { class: 'tabs', style: { marginBottom: '14px' } }, ...views.map(v => h('button', { class: `tab ${v.id === view.id ? 'is-on' : ''}`, onclick: () => {
            V.view = v.id; try { localStorage.setItem('pomodoro.dbview.' + db.id, v.id); } catch (e) { /* rien */ } drawList();
        } }, ({ gallery: '🖼️ ', table: '📋 ', board: '🗂️ ' }[v.type] || '') + v.name))),
        h('div', { class: 'row', style: { marginBottom: '16px', flexWrap: 'wrap' } }, search, ...filters, favBtn, h('span', { style: { flex: 1 } }), sortSel,
            h('span', { class: 'muted', style: { fontWeight: 800, fontSize: '13px' } }, `${V.rows.length} fiche${V.rows.length > 1 ? 's' : ''}`)),
        h('div', { id: 'dbBody' })
    );
    drawBody(view);
}

function drawBody(view) {
    const box = document.getElementById('dbBody');
    if (!box) return;
    const rows = filtered();
    if (!rows.length) { box.replaceChildren(h('div', { class: 'card', style: { textAlign: 'center', padding: '40px' } }, h('div', { style: { fontSize: '40px' } }, V.db.icon || '🗃️'), h('p', { class: 'help' }, V.rows.length ? 'Aucune fiche ne correspond.' : 'Aucune fiche pour l’instant.'))); return; }
    if (view.type === 'table') box.replaceChildren(tableView(rows));
    else if (view.type === 'board') box.replaceChildren(boardView(rows, view));
    else box.replaceChildren(galleryView(rows));
}

const openRow = r => V.ctx.navigate(`/db/${V.db.id}/${r.id}`);

// ── Galerie ──
function galleryView(rows) {
    return h('div', { class: 'db-gallery' }, ...rows.map(r => {
        const col = coverColor(r);
        const t = totalTime(r);
        const chips = [];
        for (const p of V.db.properties) {
            if (p.type === 'select' && r.props[p.id] && p.id !== 'categorie') chips.push(chip(p, r.props[p.id]));
            if (p.type === 'multi' && r.props[p.id]) r.props[p.id].slice(0, 2).forEach(v => chips.push(chip(p, v)));
        }
        return h('button', { class: 'db-card', onclick: () => openRow(r) },
            h('div', { class: 'db-cover', style: r.cover ? { backgroundImage: `url(${r.cover})` } : { background: `radial-gradient(circle at 30% 20%, color-mix(in srgb, ${col} 55%, transparent), color-mix(in srgb, ${col} 12%, #14161F) 70%)` } },
                r.cover ? null : h('span', { class: 'db-cover-emoji' }, r.props.emoji || V.db.icon || '📄'),
                r.props.favori ? h('span', { class: 'db-fav' }, '★') : null,
                r.props.categorie ? h('span', { class: 'db-cover-tag' }, r.props.categorie) : null),
            h('div', { class: 'db-card-body' },
                h('div', { class: 'db-card-title' }, r.title),
                isRecipes() ? h('div', { class: 'db-card-meta' }, t ? h('span', {}, `⏱ ${fmtMin(t)}`) : null, r.props.portions ? h('span', {}, `🍽 ${r.props.portions} portion${r.props.portions > 1 ? 's' : ''}`) : null) : (r.excerpt ? h('div', { class: 'db-card-ex' }, r.excerpt) : null),
                chips.length ? h('div', { class: 'db-card-chips' }, ...chips.slice(0, 4)) : null));
    }));
}

// ── Tableau (cellules modifiables) ──
function tableView(rows) {
    const props = V.db.properties;
    return h('div', { class: 'db-table-wrap' }, h('table', { class: 'db-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Nom'), ...props.map(p => h('th', {}, p.name)))),
        h('tbody', {}, ...rows.map(r => h('tr', {},
            h('td', { class: 'db-title-cell' }, h('button', { onclick: () => openRow(r) }, `${r.props.emoji || ''} ${r.title}`)),
            ...props.map(p => h('td', {}, propCell(r, p))))))));
}

// Éditeur d'une propriété (tableau, page de fiche)
function propCell(r, p, onChange) {
    const v = r.props[p.id];
    const set = async val => { await saveProps(r.id, { [p.id]: val }); if (onChange) onChange(); };
    if (p.type === 'checkbox') {
        const c = h('input', { type: 'checkbox', checked: !!v });
        c.onchange = () => set(c.checked);
        return c;
    }
    if (['number', 'text', 'url', 'date'].includes(p.type)) {
        const i = h('input', { class: 'db-cell-input', type: p.type === 'number' ? 'number' : p.type === 'date' ? 'date' : 'text', value: v ?? '', placeholder: '—' });
        i.onchange = () => set(p.type === 'number' ? (i.value === '' ? null : Number(i.value)) : i.value);
        return p.unit ? h('span', { class: 'db-num' }, i, h('small', {}, p.unit)) : i;
    }
    // sélection / multi-sélection : menu avec création d'option
    const vals = [].concat(v || []);
    const b = h('button', { class: 'db-cell-select' }, ...(vals.length ? vals.map(x => chip(p, x)) : [h('span', { class: 'muted' }, '—')]));
    b.onclick = () => {
        const refresh = () => { const nb = propCell(r, p, onChange); b.replaceWith(nb); };
        menu(b, [{ label: p.name },
            ...(p.options || []).map(o => ({ icon: vals.includes(o.name) ? '✓' : '●', text: o.name, run: async () => {
                if (p.type === 'select') await set(vals.includes(o.name) ? null : o.name);
                else await set(vals.includes(o.name) ? vals.filter(x => x !== o.name) : [...vals, o.name]);
                refresh();
            } })),
            '-', { icon: '➕', text: 'Nouvelle option…', run: async () => {
                const n = await promptBox(`Nouvelle option pour « ${p.name} »`, { placeholder: 'Nom' });
                if (!n) return;
                await set(p.type === 'select' ? n : [...vals, n]);
                p.options = (propById(p.id) || p).options;
                refresh();
            } }]);
    };
    return b;
}

// ── Tableau kanban ──
function boardView(rows, view) {
    const p = propById(view.groupBy) || V.db.properties.find(x => x.type === 'select');
    if (!p) return h('p', { class: 'help' }, 'Ajoute une propriété « Sélection » pour grouper les fiches.');
    const cols = [...(p.options || []).map(o => o.name), ''];
    return h('div', { class: 'db-board' }, ...cols.map(name => {
        const items = rows.filter(r => (r.props[p.id] || '') === name);
        if (!name && !items.length) return null;
        const col = h('div', { class: 'db-col' },
            h('div', { class: 'db-col-head' }, name ? chip(p, name) : h('span', { class: 'muted' }, 'Sans valeur'), h('small', {}, String(items.length))),
            ...items.map(r => {
                const c = h('button', { class: 'db-bcard', draggable: 'true', onclick: () => openRow(r) }, h('b', {}, `${r.props.emoji || ''} ${r.title}`),
                    isRecipes() && totalTime(r) ? h('small', {}, `⏱ ${fmtMin(totalTime(r))}`) : null);
                c.addEventListener('dragstart', e => e.dataTransfer.setData('text/row', r.id));
                return c;
            }));
        col.addEventListener('dragover', e => { e.preventDefault(); col.classList.add('is-drop'); });
        col.addEventListener('dragleave', () => col.classList.remove('is-drop'));
        col.addEventListener('drop', async e => {
            e.preventDefault(); col.classList.remove('is-drop');
            const id = e.dataTransfer.getData('text/row');
            if (id) { await saveProps(id, { [p.id]: name || null }); drawBody(view); }
        });
        return col;
    }).filter(Boolean));
}

async function newRow() {
    const title = await promptBox(isRecipes() ? 'Nouvelle recette' : 'Nouvelle fiche', { placeholder: 'Nom', ok: 'Créer' });
    if (title === null) return;
    const props = isRecipes() ? { portions: 2, emoji: '🍽️' } : {};
    const n = await post(`/api/dbs/${V.db.id}/rows`, { title, props });
    V.ctx.navigate(`/db/${V.db.id}/${n.id}?edit=1`);
}

// ── Réglages de la base ──
function dbMenu(anchor) {
    menu(anchor, [
        { icon: '🧩', text: 'Propriétés…', run: editProperties },
        { icon: '✏️', text: 'Renommer / icône…', run: async () => {
            const name = await promptBox('Nom de la base', { value: V.db.name });
            if (!name) return;
            const ic = await promptBox('Icône (un émoji)', { value: V.db.icon || '' });
            V.db = await put(`/api/dbs/${V.db.id}`, { name, icon: ic || V.db.icon });
            if (V.ctx.refreshCounts) V.ctx.refreshCounts();
            drawList();
        } },
        '-',
        { icon: '🗑️', text: 'Supprimer la base…', danger: true, run: async () => {
            if (!await confirmBox(`Supprimer « ${V.db.name} » ?`, 'Ses fiches partent à la corbeille (récupérables 30 jours).', { ok: 'Supprimer', danger: true })) return;
            await del(`/api/dbs/${V.db.id}`);
            if (V.ctx.refreshCounts) V.ctx.refreshCounts();
            V.ctx.navigate('/v/inbox');
        } }
    ], { align: 'right' });
}

function editProperties() {
    const props = V.db.properties.map(p => ({ ...p, options: (p.options || []).map(o => ({ ...o })) }));
    const list = h('div', {});
    const draw = () => list.replaceChildren(...props.map((p, i) => {
        const name = h('input', { class: 'input', value: p.name });
        name.oninput = () => { p.name = name.value; };
        const type = h('select', { class: 'input', style: { width: '170px' } }, ...Object.entries(TYPE_LABEL).map(([k, l]) => h('option', { value: k, selected: p.type === k }, l)));
        type.onchange = () => { p.type = type.value; };
        return h('div', { class: 'add-row', style: { marginTop: '6px' } }, name, type,
            h('button', { class: 'btn small ghost', onclick: () => { if (i) { [props[i - 1], props[i]] = [props[i], props[i - 1]]; draw(); } } }, '▲'),
            h('button', { class: 'btn small ghost danger', onclick: () => { props.splice(i, 1); draw(); } }, '✕'));
    }));
    draw();
    const m = modal({
        title: `🧩 Propriétés de « ${V.db.name} »`,
        body: [list, h('button', { class: 'btn small', style: { marginTop: '10px' }, onclick: () => { props.push({ id: 'p' + Date.now().toString(36), name: 'Nouvelle propriété', type: 'text' }); draw(); } }, '+ Ajouter une propriété'),
            h('p', { class: 'help' }, 'Les options des sélections se créent depuis les fiches (menu ▾ → « Nouvelle option »).')],
        foot: [h('button', { class: 'btn primary', onclick: async () => { V.db = await put(`/api/dbs/${V.db.id}`, { properties: props }); m.close(); drawList(); } }, 'Enregistrer')]
    });
}

// ══ Page de fiche ══
async function renderRow(rowId) {
    let note;
    try { note = await get(`/api/notes/${rowId}`); } catch (e) { V.root.replaceChildren(h('p', { class: 'help' }, 'Fiche introuvable.')); return; }
    const editMode = new URLSearchParams(location.search).get('edit') === '1';
    if (isRecipes() && !editMode) return recipePage(note);
    return editPage(note);
}

// Découpe le Markdown d'une recette : titre, intro, sections « ## ».
function sectionsOf(body) {
    const out = { title: '', intro: [], sections: [] };
    let cur = null;
    for (const l of String(body || '').split('\n')) {
        const h1 = l.match(/^#\s+(.*)$/);
        const h2 = l.match(/^#{2,3}\s+(.*)$/);
        if (h1 && !out.title) { out.title = h1[1]; continue; }
        if (h2) { cur = { title: h2[1].trim(), lines: [] }; out.sections.push(cur); continue; }
        (cur ? cur.lines : out.intro).push(l);
    }
    return out;
}

function recipePage(note) {
    const r = { id: note.id, props: note.props || {}, title: note.meta.title };
    const S = sectionsOf(note.body);
    const base = Number(r.props.portions) || 2;
    let portions = base;
    const col = coverColor(r);
    const ingSec = S.sections.find(s => /ingr[ée]dients?/i.test(s.title));
    const stepSec = S.sections.find(s => /pr[ée]paration|[ée]tapes/i.test(s.title));
    const others = S.sections.filter(s => s !== ingSec && s !== stepSec);
    const ingLines = ingSec ? ingSec.lines.filter(l => /^\s*[-*+]\s+\S/.test(l)) : [];
    const steps = stepSec ? stepSec.lines.filter(l => /^\s*(\d+[.)]|[-*+])\s+\S/.test(l)).map(l => l.replace(/^\s*(\d+[.)]|[-*+])\s+/, '')) : [];

    const ingList = h('div', { class: 'rc-ings' });
    const portionsLbl = h('b', {}, String(portions));
    const drawIngs = () => {
        portionsLbl.textContent = String(portions);
        ingList.replaceChildren(...ingLines.map(l => h('label', { class: 'rc-ing' }, h('input', { type: 'checkbox' }), h('span', { html: inline(scaleLine(l, portions / base)) }))));
    };
    drawIngs();
    const chips = [];
    for (const p of V.db.properties) {
        if (p.type === 'select' && r.props[p.id]) chips.push(chip(p, r.props[p.id]));
        if (p.type === 'multi' && r.props[p.id]) r.props[p.id].forEach(v => chips.push(chip(p, v)));
    }
    const prep = Number(r.props.preparation) || 0, cook = Number(r.props.cuisson) || 0;
    const favBtn = h('button', { class: `btn ${r.props.favori ? 'mint' : ''}` }, r.props.favori ? '★ Favori' : '☆ Favori');
    favBtn.onclick = async () => {
        r.props.favori = !r.props.favori;
        await put(`/api/rows/${r.id}/props`, { favori: r.props.favori });
        favBtn.textContent = r.props.favori ? '★ Favori' : '☆ Favori';
        favBtn.classList.toggle('mint', r.props.favori);
    };

    V.root.replaceChildren(
        h('div', { class: 'rc-top' },
            h('button', { class: 'btn ghost small', onclick: () => V.ctx.navigate(`/db/${V.db.id}`) }, icon('back'), `${V.db.icon || ''} ${V.db.name}`),
            h('span', { style: { flex: 1 } }),
            favBtn,
            h('button', { class: 'btn', onclick: () => V.ctx.navigate(`/db/${V.db.id}/${r.id}?edit=1`) }, icon('edit'), 'Modifier'),
            h('button', { class: 'btn primary', onclick: () => planDialog(r, portions, V.ctx) }, '📅 Planifier')),
        h('div', { class: 'rc-hero', style: { background: `radial-gradient(circle at 20% 10%, color-mix(in srgb, ${col} 50%, transparent), color-mix(in srgb, ${col} 10%, #14161F) 65%)` } },
            h('div', { class: 'rc-emoji' }, r.props.emoji || '🍽️'),
            h('div', { class: 'rc-hero-text' },
                h('h1', {}, S.title || r.title),
                h('p', { class: 'rc-intro' }, S.intro.join(' ').trim()),
                h('div', { class: 'rc-chips' }, ...chips))),
        h('div', { class: 'rc-stats' },
            h('div', { class: 'rc-stat' }, h('span', {}, '🔪 Préparation'), h('b', {}, fmtMin(prep) || '—')),
            h('div', { class: 'rc-stat' }, h('span', {}, '🔥 Cuisson'), h('b', {}, fmtMin(cook) || '—')),
            h('div', { class: 'rc-stat' }, h('span', {}, '⏱ Total'), h('b', {}, fmtMin(prep + cook) || '—')),
            h('div', { class: 'rc-stat' }, h('span', {}, '🍽 Portions'),
                h('div', { class: 'rc-stepper' },
                    h('button', { onclick: () => { if (portions > 1) { portions--; drawIngs(); } } }, '−'), portionsLbl,
                    h('button', { onclick: () => { portions++; drawIngs(); } }, '+')))),
        h('div', { class: 'rc-grid' },
            h('div', { class: 'card rc-ing-card' }, h('h3', {}, '🧺 Ingrédients', h('small', {}, 'coche en cuisinant')), ingList),
            h('div', {},
                h('h3', { class: 'rc-h' }, '👩‍🍳 Préparation'),
                h('ol', { class: 'rc-steps' }, ...steps.map((s, i) => h('li', {}, h('span', { class: 'rc-num' }, String(i + 1)), h('div', { html: inline(s) })))),
                ...others.map(s => h('div', { class: 'card rc-extra' }, h('h3', {}, /astuce/i.test(s.title) ? `💡 ${s.title}` : s.title), h('div', { class: 'md-render', html: renderMarkdown(s.lines.join('\n')) }))))
        )
    );
}

// Planifier une recette dans le calendrier (avec restes).
export function planDialog(r, portions, ctx, presetDate, presetSlot) {
    const d = new Date();
    const iso = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    const date = h('input', { class: 'input', type: 'date', value: presetDate || iso(d) });
    let slot = presetSlot || (d.getHours() >= 14 ? 'soir' : 'midi');
    const seg = h('div', { class: 'seg' });
    const drawSeg = () => seg.replaceChildren(...[['matin', 'Petit-déj'], ['midi', 'Midi'], ['soir', 'Soir']].map(([k, l]) => h('button', { class: slot === k ? 'is-on' : '', onclick: () => { slot = k; drawSeg(); } }, l)));
    drawSeg();
    const por = h('input', { class: 'input', type: 'number', min: 1, max: 20, value: portions || r.props.portions || 2, style: { width: '90px' } });
    const left = h('input', { type: 'checkbox', checked: true });
    return new Promise(resolve => {
        const m = modal({
            title: `📅 Planifier « ${r.title} »`,
            body: [
                h('div', { class: 'row' }, h('label', { class: 'field' }, h('span', {}, 'Jour'), date), h('label', { class: 'field', style: { flex: 0 } }, h('span', {}, 'Portions'), por)),
                h('div', { class: 'field' }, h('span', {}, 'Repas'), seg),
                h('label', { class: 'switch' }, h('span', { class: 'switch-text' }, h('b', {}, 'Placer les restes aux repas suivants'), h('small', {}, '2 portions = ce repas + le suivant (midi → soir → midi du lendemain).')), left),
                h('p', { class: 'help' }, 'Les ingrédients sont ajoutés automatiquement à la note « 🛒 Liste de courses ».')
            ],
            foot: [h('button', { class: 'btn primary', onclick: async () => {
                await post('/api/meals/plan', { recipeId: r.id, date: date.value, slot, portions: Number(por.value), leftovers: left.checked });
                m.close();
                resolve(true);
                toast('Planifié ✓ — ingrédients ajoutés à la liste de courses', 'ok', ctx ? { action: 'Calendrier', onAction: () => ctx.navigate('/calendar') } : {});
            } }, 'Planifier')],
            onClose: () => resolve(false)
        });
    });
}

// Page d'édition : propriétés + texte Markdown
function editPage(note) {
    const r = { id: note.id, props: note.props || {}, title: note.meta.title };
    V.rows = [r];
    const propsBox = h('div', { class: 'db-props' });
    const emojiInput = h('input', { class: 'db-cell-input', value: r.props.emoji || '', style: { width: '70px', fontSize: '20px' } });
    emojiInput.onchange = () => saveProps(r.id, { emoji: emojiInput.value });
    propsBox.replaceChildren(
        ...(isRecipes() ? [h('div', { class: 'db-prop' }, h('span', {}, 'Émoji'), emojiInput)] : []),
        ...V.db.properties.map(p => h('div', { class: 'db-prop' }, h('span', {}, p.name), propCell(r, p))));
    const host = h('div', {});
    let timer = null, base = note.updatedAt;
    V.root.replaceChildren(
        h('div', { class: 'rc-top' },
            h('button', { class: 'btn ghost small', onclick: () => V.ctx.navigate(`/db/${V.db.id}`) }, icon('back'), `${V.db.icon || ''} ${V.db.name}`),
            h('span', { style: { flex: 1 } }),
            h('span', { class: 'save-state', id: 'dbSave' }),
            isRecipes() ? h('button', { class: 'btn primary', onclick: () => V.ctx.navigate(`/db/${V.db.id}/${r.id}`) }, '👁 Voir la recette') : null,
            h('button', { class: 'icon-btn', title: 'Mettre à la corbeille', onclick: async () => {
                if (!await confirmBox('Mettre cette fiche à la corbeille ?', 'Récupérable pendant 30 jours.', { ok: 'Supprimer', danger: true })) return;
                await put(`/api/notes/${r.id}`, { trashed: true });
                V.ctx.navigate(`/db/${V.db.id}`);
            } }, icon('trash'))),
        h('div', { class: 'card', style: { marginBottom: '16px' } }, propsBox),
        isRecipes() ? h('p', { class: 'help' }, 'Garde les titres « ## Ingrédients » (une ligne par ingrédient, ex. « 200 g de riz ») et « ## Préparation » (étapes numérotées) : la page recette et la liste de courses s’en servent.') : null,
        h('div', { class: 'card db-editor' }, host));
    V.editor = createEditor(host, {
        doc: note.body,
        onChange: () => {
            clearTimeout(timer);
            const s0 = document.getElementById('dbSave'); if (s0) s0.textContent = 'Modifié';
            timer = setTimeout(async () => {
                const res = await put(`/api/notes/${r.id}`, { body: V.editor.getValue(), baseUpdatedAt: base, force: true });
                base = res.updatedAt;
                const s = document.getElementById('dbSave'); if (s) s.textContent = 'Enregistré';
            }, 700);
        }
    });
}
