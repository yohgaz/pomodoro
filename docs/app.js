// Pomodoro mobile — notes IPARA partout, même hors ligne.
import { Store, newId } from './store.js';
import { titleOf, tagsOf, tasksOf, excerptOf, taskLinesOf, toggleTaskLine, applyTemplate } from './md.js';
import { createEditor, renderMarkdown } from './vendor/editor.bundle.js';

const store = new Store();
const app = document.getElementById('app');
let editor = null, current = null, saveTimer = null;

const TOMATO = `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="tg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF8A5C"/><stop offset="1" stop-color="#E24A22"/></linearGradient></defs><circle cx="32" cy="36" r="23" fill="url(#tg)"/><path d="M32 14c-3 0-6 1.5-8 4 3 0 5 .5 6.5 2-3 .5-6 2.5-7.5 5 3.5-1 7-1 9 0 2-1 5.5-1 9 0-1.5-2.5-4.5-4.5-7.5-5 1.5-1.5 3.5-2 6.5-2-2-2.5-5-4-8-4Z" fill="#6FDA9A"/><path d="M32 8v8" stroke="#6FDA9A" stroke-width="3.5" stroke-linecap="round"/></svg>`;
const I = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.35-4.35"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/></svg>'
};
const KIND = {
    project: { label: 'Projets', one: 'Projet', letter: 'P', color: 'var(--gold)', bg: 'var(--gold-soft)', ico: '🎯' },
    area: { label: 'Domaines', one: 'Domaine', letter: 'A', color: 'var(--mint)', bg: 'var(--mint-soft)', ico: '🧭' },
    resource: { label: 'Ressources', one: 'Ressource', letter: 'R', color: 'var(--sky)', bg: 'rgba(122,184,255,.14)', ico: '📚' }
};

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fold = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
function ago(ts) {
    if (!ts) return '';
    const d = (ts - Date.now()) / 1000, a = Math.abs(d);
    if (a < 45) return 'à l’instant';
    if (a < 3600) return rtf.format(Math.round(d / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(d / 3600), 'hour');
    if (a < 604800) return rtf.format(Math.round(d / 86400), 'day');
    return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.getElementById('toasts').appendChild(t);
    setTimeout(() => t.remove(), 2600);
}

// ── Données dérivées ──
const metaCache = new Map();
function meta(n) {
    const c = metaCache.get(n.id);
    if (c && c.body === n.body) return c.m;
    const m = { title: titleOf(n.body) || 'Sans titre', excerpt: excerptOf(n.body), tags: tagsOf(n.body), tasks: tasksOf(n.body) };
    metaCache.set(n.id, { body: n.body, m });
    return m;
}
const cont = id => id ? store.para.get(id) || null : null;
const isTemplate = n => meta(n).tags.some(t => t === 'modèle' || t === 'modele');
const isArchived = n => !!(n.archived || (cont(n.container) && cont(n.container).archived));
const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

function notesFor(view, q = '') {
    let list = store.list();
    const [k, arg] = view.includes(':') ? [view.slice(0, view.indexOf(':')), view.slice(view.indexOf(':') + 1)] : [view, ''];
    if (k === 'trash') list = list.filter(n => n.trashed);
    else {
        list = list.filter(n => !n.trashed);
        if (k === 'inbox') list = list.filter(n => !n.container && !n.archived && !isTemplate(n));
        else if (k === 'archive') list = list.filter(isArchived);
        else if (k === 'container') list = list.filter(n => n.container === arg);
        else if (k === 'kind') list = list.filter(n => cont(n.container) && cont(n.container).kind === arg && !isArchived(n));
        else if (k === 'tag') list = list.filter(n => meta(n).tags.some(t => t === arg || t.startsWith(arg + '/')));
        else if (k === 'todo') list = list.filter(n => meta(n).tasks.open > 0 && !isArchived(n) && !isTemplate(n));
        else if (k === 'today') list = list.filter(n => (n.updatedAt || 0) >= startOfDay());
        else list = list.filter(n => !isArchived(n));
    }
    if (q.trim()) {
        const terms = fold(q).split(/\s+/).filter(Boolean);
        list = list.filter(n => terms.every(t => t.startsWith('#') ? meta(n).tags.some(x => fold(x).startsWith(t.slice(1))) : fold(n.body).includes(t)));
    }
    return list.sort((a, b) => (a.pinned !== b.pinned && k !== 'trash') ? (a.pinned ? -1 : 1) : (b.updatedAt || 0) - (a.updatedAt || 0));
}

function viewTitle(view) {
    if (view === 'inbox') return '📥 Inbox';
    if (view === 'archive') return '🗄️ Archives';
    if (view === 'todo') return '☑️ À faire';
    if (view === 'today') return '📅 Aujourd’hui';
    if (view === 'trash') return '🗑️ Corbeille';
    if (view === 'all') return '🗂️ Toutes les notes';
    if (view.startsWith('tag:')) return '#' + view.slice(4);
    if (view.startsWith('kind:')) { const K = KIND[view.slice(5)]; return `${K.ico} ${K.label}`; }
    if (view.startsWith('container:')) { const c = cont(view.slice(10)); return c ? `${c.icon || KIND[c.kind].ico} ${c.name}` : 'Introuvable'; }
    return view;
}

// ── Navigation (#/, #/v/<vue>, #/n/<id>) ──
function go(hash, replace = false) {
    if (replace) history.replaceState(null, '', hash); else history.pushState(null, '', hash);
    route();
}
window.addEventListener('popstate', route);

async function route() {
    await flush();
    if (!store.cfg) return renderSetup();
    const h = location.hash || '#/';
    let m;
    if ((m = h.match(/^#\/n\/([^/]+)/))) return renderNote(m[1]);
    if ((m = h.match(/^#\/v\/(.+)$/))) return renderList(decodeURIComponent(m[1]));
    if (h.startsWith('#/tasks')) return renderTasks();
    return renderHome();
}

function syncDot() {
    const s = store.status;
    const cls = s.state === 'syncing' ? 'busy' : s.state === 'error' ? 'err' : s.state === 'offline' || s.state === 'demo' ? 'off' : 'ok';
    return `<span class="sync-dot ${cls}"></span>`;
}
function syncLabel() {
    const s = store.status;
    if (s.state === 'demo') return 'Mode démo (local)';
    if (s.state === 'syncing') return 'Synchronisation…';
    if (s.state === 'offline') return `Hors ligne${s.pending ? ` · ${s.pending} en attente` : ''}`;
    if (s.state === 'error') return 'Erreur : ' + (s.error || '');
    return s.lastSync ? `Synchronisé ${ago(s.lastSync)}${s.pending ? ` · ${s.pending} en attente` : ''}` : 'Jamais synchronisé';
}

// ── Accueil ──
function renderHome() {
    destroyEditor();
    const all = store.list();
    const count = v => notesFor(v).length;
    const urgent = openTasks().filter(t => t.due && t.due <= todayIso()).length;
    const rows = [];
    rows.push(`<div class="group"><button class="row" data-go="#/v/inbox"><span class="ico" style="background:var(--accent);color:#fff">I</span><span class="lbl">Inbox</span><span class="cnt ${count('inbox') ? 'hot' : ''}">${count('inbox') || ''}</span><span class="chev">›</span></button>`);
    for (const [k, K] of Object.entries(KIND)) {
        const items = [...store.para.values()].filter(c => c.kind === k && !c.archived).sort((a, b) => (a.order || 0) - (b.order || 0));
        rows.push(`<button class="row" data-go="#/v/${encodeURIComponent('kind:' + k)}"><span class="ico" style="background:${K.bg};color:${K.color}">${K.letter}</span><span class="lbl">${K.label}</span><span class="cnt">${items.length || ''}</span><span class="chev">›</span></button>`);
        for (const c of items) {
            const n = all.filter(x => x.container === c.id && !x.trashed).length;
            rows.push(`<button class="row sub" data-go="#/v/${encodeURIComponent('container:' + c.id)}"><span class="lbl">${esc(c.icon || K.ico)} ${esc(c.name)}</span><span class="cnt">${n || ''}</span></button>`);
        }
    }
    rows.push(`<button class="row" data-go="#/v/archive"><span class="ico" style="background:var(--c3);color:var(--mu)">A</span><span class="lbl">Archives</span><span class="cnt">${count('archive') || ''}</span><span class="chev">›</span></button></div>`);

    const filters = [['todo', '☑️', 'À faire'], ['today', '📅', 'Aujourd’hui'], ['all', '🗂️', 'Toutes les notes'], ['trash', '🗑️', 'Corbeille']];
    const tagCounts = new Map();
    for (const n of all) if (!n.trashed) for (const t of meta(n).tags) { const top = t.split('/')[0]; tagCounts.set(top, (tagCounts.get(top) || 0) + 1); }
    app.innerHTML = `
    <div class="screen">
        <div class="topbar"><h1>${TOMATO} Pomodoro</h1>
            <button class="tb-btn" id="syncBtn" title="Synchroniser">${syncDot()}</button>
            <button class="tb-btn" id="settingsBtn" title="Réglages">${I.gear}</button></div>
        <div class="scroll">
            <label class="search">${I.search}<input id="q" type="search" placeholder="Rechercher partout" enterkeyhint="search"></label>
            <div id="results"></div>
            <div id="homeGroups">
                <div class="group" style="margin-top:14px"><button class="row" data-go="#/tasks"><span class="ico">☑️</span><span class="lbl">Tâches</span><span class="cnt ${urgent ? 'hot' : ''}">${openTasks().length || ''}</span><span class="chev">›</span></button><button class="row" id="tplBtn"><span class="ico">🧩</span><span class="lbl">Nouvelle note depuis un modèle</span><span class="chev">›</span></button></div>
                <div class="group-title">IPARA</div>${rows.join('')}
                <div class="group-title">Filtres</div><div class="group">${filters.map(([v, ico, l]) => `<button class="row" data-go="#/v/${v}"><span class="ico">${ico}</span><span class="lbl">${l}</span><span class="cnt">${count(v) || ''}</span><span class="chev">›</span></button>`).join('')}</div>
                ${tagCounts.size ? `<div class="group-title">Tags</div><div class="group">${[...tagCounts].sort((a, b) => a[0].localeCompare(b[0], 'fr')).map(([t, n]) => `<button class="row" data-go="#/v/${encodeURIComponent('tag:' + t)}"><span class="ico" style="color:var(--ed-tag)">#</span><span class="lbl">${esc(t)}</span><span class="cnt">${n}</span></button>`).join('')}</div>` : ''}
                <p class="list-head" style="text-align:center;margin-top:18px">${esc(syncLabel())}</p>
            </div>
        </div>
        <button class="fab" id="fab" aria-label="Nouvelle note">${I.plus}</button>
    </div>`;
    wireGo();
    app.querySelector('#fab').onclick = () => newNote();
    app.querySelector('#tplBtn').onclick = () => templateSheet();
    app.querySelector('#syncBtn').onclick = () => { toast('Synchronisation…'); store.sync(); };
    app.querySelector('#settingsBtn').onclick = settingsSheet;
    const q = app.querySelector('#q');
    q.oninput = () => {
        const v = q.value.trim();
        app.querySelector('#homeGroups').hidden = !!v;
        app.querySelector('#results').innerHTML = v ? cardsHtml(notesFor('all', v)) || '<div class="empty">Aucun résultat</div>' : '';
        wireGo();
    };
}

function wireGo() { app.querySelectorAll('[data-go]').forEach(b => { b.onclick = () => go(b.dataset.go); }); }

function cardsHtml(list) {
    return list.map(n => {
        const m = meta(n);
        const c = cont(n.container);
        const total = m.tasks.open + m.tasks.done;
        return `<button class="note-card" data-go="#/n/${n.id}">
            <div class="nc-title">${n.pinned ? '📌' : ''}<span>${esc(m.title)}</span></div>
            ${m.excerpt ? `<div class="nc-ex">${esc(m.excerpt)}</div>` : ''}
            <div class="nc-meta"><span>${ago(n.updatedAt)}</span>${c ? `<span>${esc(c.icon || KIND[c.kind].ico)} ${esc(c.name)}</span>` : ''}${total ? `<span class="todo">☑ ${m.tasks.done}/${total}</span>` : ''}${m.tags.slice(0, 3).map(t => `<span class="tag">#${esc(t)}</span>`).join('')}${n._dirty ? '<span>⏳</span>' : ''}</div>
        </button>`;
    }).join('');
}

// ── Liste ──
let listView = 'inbox';
function renderList(view) {
    destroyEditor();
    listView = view;
    const list = notesFor(view);
    const c = view.startsWith('container:') ? cont(view.slice(10)) : null;
    const help = view === 'inbox' ? 'À trier : range chaque note dans un projet, un domaine ou une ressource.' : c && c.description ? esc(c.description) : '';
    app.innerHTML = `
    <div class="screen">
        <div class="topbar"><button class="tb-btn" id="back">${I.back}</button><h1>${esc(viewTitle(view))}</h1></div>
        <div class="scroll">
            ${help ? `<div class="list-head">${help}</div>` : ''}
            ${list.length ? cardsHtml(list) : `<div class="empty"><b>${view === 'inbox' ? '🎉' : '📝'}</b>${view === 'inbox' ? 'Inbox vide, tout est rangé !' : 'Aucune note ici.'}</div>`}
        </div>
        ${view !== 'trash' ? `<button class="fab" id="fab" aria-label="Nouvelle note">${I.plus}</button>` : ''}
    </div>`;
    wireGo();
    app.querySelector('#back').onclick = () => go('#/');
    const fab = app.querySelector('#fab');
    if (fab) fab.onclick = () => newNote({ container: c ? c.id : null, body: view.startsWith('tag:') ? `# \n\n#${view.slice(4)}` : '# ' });
}

async function newNote({ container = null, body = '# ' } = {}) {
    const n = await store.createNote({ body, container });
    go(`#/n/${n.id}`);
    setTimeout(() => { if (editor) { editor.view.focus(); editor.view.dispatch({ selection: { anchor: body.startsWith('# \n') ? 2 : body.length } }); } }, 80);
}

// ── Tâches de toutes les notes ──
const pad2 = n => String(n).padStart(2, '0');
const isoOf = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayIso = () => isoOf(new Date());
function openTasks() {
    const out = [];
    for (const n of store.list()) {
        if (n.trashed || isArchived(n) || isTemplate(n) || !meta(n).tasks.open) continue;
        for (const t of taskLinesOf(n.body)) if (!t.checked && t.text) out.push({ ...t, note: n });
    }
    return out;
}
// Page Tâches : onglets Perso (liste privée), Stream (ma liste sur
// l'overlay) et Notes (cases à cocher de toutes les notes).
let tasksTab = 'perso';
try { tasksTab = localStorage.getItem('pomodoro.m.tasksTab') || 'perso'; } catch (e) { /* rien */ }

function renderTasks() {
    destroyEditor();
    if (tasksTab !== 'notes') return renderMyList(tasksTab);
    const list = openTasks();
    const today = todayIso();
    const w = new Date(); w.setDate(w.getDate() + 7);
    const week = isoOf(w);
    const groups = [
        ['🔥 En retard', list.filter(t => t.due && t.due < today)],
        ['☀️ Aujourd’hui', list.filter(t => t.due === today)],
        ['🗓️ 7 prochains jours', list.filter(t => t.due && t.due > today && t.due <= week)],
        ['🔭 Plus tard', list.filter(t => t.due && t.due > week)]
    ];
    // Sans date : regroupées par note (liste de courses, projet…)
    const byNote = new Map();
    for (const t of list.filter(t => !t.due)) { if (!byNote.has(t.note.id)) byNote.set(t.note.id, []); byNote.get(t.note.id).push(t); }
    for (const [, ts] of [...byNote].sort((a, b) => (b[1][0].note.updatedAt || 0) - (a[1][0].note.updatedAt || 0))) groups.push([`📄 ${meta(ts[0].note).title}`, ts, ts[0].note.id]);
    const flat = [];
    const rowHtml = t => { flat.push(t); return `<div class="row task-row" data-i="${flat.length - 1}"><span class="cm-checkbox"></span><span class="lbl" style="white-space:normal">${esc(t.text)}${t.due ? ` <span class="cnt">📅 ${t.due.slice(5).split('-').reverse().join('/')}</span>` : ''}</span></div>`; };
    const html = groups.filter(([, l]) => l.length).map(([title, l, noteId]) =>
        `<div class="group-title">${noteId ? `<a data-go="#/n/${noteId}" style="color:inherit;text-decoration:none">${esc(title)} ›</a>` : esc(title)}</div><div class="group">${l.map(rowHtml).join('')}</div>`).join('');
    app.innerHTML = `
    <div class="screen">
        <div class="topbar"><button class="tb-btn" id="back">${I.back}</button><h1>☑️ Tâches</h1></div>
        <div class="scroll">${tabsHtml()}${html || '<div class="empty"><b>🎉</b>Aucune case à cocher en attente dans tes notes.</div>'}
            <p class="list-head" style="text-align:center">Astuce : ajoute 📅 2026-10-02 au bout d’une case pour lui donner une échéance.</p></div>
    </div>`;
    wireGo();
    wireTabs();
    app.querySelector('#back').onclick = () => go('#/');
    app.querySelectorAll('.task-row').forEach(row => row.onclick = async () => {
        const t = flat[Number(row.dataset.i)];
        const body = toggleTaskLine(t.note.body, t.line, t.raw, true);
        if (body === null) return toast('Case introuvable');
        row.querySelector('.cm-checkbox').classList.add('is-checked');
        row.style.opacity = '.45';
        t.note.body = body;
        await store.saveNote(t.note);
        setTimeout(() => { if ((location.hash || '').startsWith('#/tasks')) renderTasks(); }, 450);
    });
}

function tabsHtml() {
    const tabs = [['perso', '🏠 Perso'], ['stream', '🎥 Stream'], ['notes', '📝 Notes']];
    return `<div class="seg-tabs">${tabs.map(([k, l]) => `<button data-tab="${k}" class="${tasksTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
}
function wireTabs() {
    app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
        tasksTab = b.dataset.tab;
        try { localStorage.setItem('pomodoro.m.tasksTab', tasksTab); } catch (e) { /* rien */ }
        renderTasks();
    });
}

// Opérations sur une liste (même format et même logique que lib/stream.js).
const listOps = {
    proj(u) { return u.projects.find(p => p.id === u.currentProject) || u.projects[0]; },
    detach(u, t) {
        for (const p of u.projects) {
            if (p.active && p.active.id === t.id) { p.active = null; return p; }
            for (const key of ['backlog', 'done']) { const i = p[key].findIndex(x => x.id === t.id); if (i >= 0) { p[key].splice(i, 1); return p; } }
        }
        return null;
    },
    add(u, text, now) {
        const p = listOps.proj(u);
        const t = { id: newId(), text: text.slice(0, 200), createdAt: Date.now() };
        if (now) { if (p.active) p.backlog.unshift(p.active); t.startedAt = Date.now(); p.active = t; }
        else p.backlog.push(t);
    },
    done(u, t) { const p = listOps.detach(u, t) || listOps.proj(u); t.doneAt = Date.now(); p.done.push(t); u.totalDone = (u.totalDone || 0) + 1; },
    undone(u, t) { const p = listOps.detach(u, t) || listOps.proj(u); delete t.doneAt; u.totalDone = Math.max(0, (u.totalDone || 0) - 1); p.backlog.unshift(t); },
    activate(u, t) { const p = listOps.detach(u, t) || listOps.proj(u); if (p.active) p.backlog.unshift(p.active); t.startedAt = Date.now(); p.active = t; },
    remove(u, t) { listOps.detach(u, t); }
};

function renderMyList(kind) {
    const streamer = store.streamerLogin();
    const id = kind === 'perso' ? '_perso' : streamer;
    const head = `<div class="topbar"><button class="tb-btn" id="back">${I.back}</button><h1>☑️ Tâches</h1></div>`;
    if (!id) {
        app.innerHTML = `<div class="screen">${head}<div class="scroll">${tabsHtml()}<div class="empty"><b>🎥</b>Ta liste de stream apparaîtra ici après la prochaine synchro du Mac.</div></div></div>`;
        wireTabs(); app.querySelector('#back').onclick = () => go('#/');
        return;
    }
    const u = store.user(id);
    const p = listOps.proj(u);
    const since = new Date().setHours(0, 0, 0, 0);
    const done = p.done.filter(t => t.doneAt >= since).slice().reverse();
    const items = [];
    const rowHtml = (t, where) => { items.push({ t, where }); const i = items.length - 1;
        return `<div class="row my-row ${where}" data-i="${i}"><span class="cm-checkbox ${where === 'done' ? 'is-checked' : ''}" data-check="${i}"></span><span class="lbl" style="white-space:normal">${where === 'active' ? '⚡ ' : ''}${esc(t.text)}</span><span class="chev" data-more="${i}">⋯</span></div>`; };
    app.innerHTML = `
    <div class="screen">
        ${head}
        <div class="scroll">${tabsHtml()}
            <div class="list-head">${kind === 'perso' ? 'Ta liste personnelle, jamais affichée en live.' : 'Ta liste de stream : ta tâche en cours et les suivantes s’affichent sur l’overlay.'}${u.projects.length > 1 ? ` · 📁 ${esc(p.name)}` : ''}</div>
            <div class="group-title">⚡ En cours</div>
            <div class="group">${p.active ? rowHtml(p.active, 'active') : '<div class="list-head" style="padding:14px 16px">Aucune tâche en cours.</div>'}</div>
            <div class="group-title">📋 ${kind === 'perso' ? 'À faire' : 'Backlog'}</div>
            <div class="group">${p.backlog.map(t => rowHtml(t, 'backlog')).join('')}
                <form class="add-inline" id="addForm"><input id="addInput" placeholder="Ajouter une tâche…" enterkeyhint="done" autocomplete="off"><button>+</button></form></div>
            ${done.length ? `<div class="group-title">✅ Faites aujourd’hui</div><div class="group">${done.map(t => rowHtml(t, 'done')).join('')}</div>` : ''}
        </div>
    </div>`;
    wireTabs();
    app.querySelector('#back').onclick = () => go('#/');
    const save = async () => { await store.saveUser(u); renderMyList(kind); };
    app.querySelector('#addForm').onsubmit = async e => {
        e.preventDefault();
        const input = app.querySelector('#addInput');
        const text = input.value.trim();
        if (!text) return;
        listOps.add(u, text, false);
        await store.saveUser(u);
        renderMyList(kind);
        app.querySelector('#addInput').focus();
    };
    app.querySelectorAll('[data-check]').forEach(el => el.onclick = e => {
        e.stopPropagation();
        const { t, where } = items[Number(el.dataset.check)];
        if (where === 'done') listOps.undone(u, t); else listOps.done(u, t);
        el.classList.toggle('is-checked');
        setTimeout(save, 250);
    });
    app.querySelectorAll('.my-row').forEach(row => row.onclick = () => {
        const { t, where } = items[Number(row.dataset.i)];
        const otherId = kind === 'perso' ? streamer : '_perso';
        sheet(`<h3>${esc(t.text)}</h3>
            ${where === 'backlog' ? '<button class="row" data-a="start"><span class="lbl">⚡ Commencer maintenant</span></button>' : ''}
            ${where !== 'done' ? '<button class="row" data-a="done"><span class="lbl">✅ Terminer</span></button>' : '<button class="row" data-a="undone"><span class="lbl">↺ Pas encore fait</span></button>'}
            ${where !== 'done' && otherId ? `<button class="row" data-a="move"><span class="lbl">${kind === 'perso' ? '🎥 Déplacer vers Stream' : '🏠 Déplacer vers Perso'}</span></button>` : ''}
            <button class="row" data-a="rename"><span class="lbl">✏️ Renommer</span></button>
            <button class="row danger" data-a="delete"><span class="lbl">🗑️ Supprimer</span></button>`, (bg, close) => {
            bg.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
                close();
                const a = b.dataset.a;
                if (a === 'start') listOps.activate(u, t);
                if (a === 'done') listOps.done(u, t);
                if (a === 'undone') listOps.undone(u, t);
                if (a === 'delete') listOps.remove(u, t);
                if (a === 'rename') { const v = prompt('Renommer la tâche', t.text); if (!v) return; t.text = v.trim(); }
                if (a === 'move') {
                    listOps.detach(u, t);
                    const o = store.user(otherId);
                    listOps.proj(o).backlog.unshift(t);
                    await store.saveUser(o);
                    toast(kind === 'perso' ? 'Déplacée vers Stream 🎥' : 'Déplacée vers Perso 🏠');
                }
                await save();
            });
        });
    });
}

// ── Modèles (notes portant le tag #modèle) ──
function templateSheet() {
    const tpls = store.list().filter(n => !n.trashed && isTemplate(n)).sort((a, b) => meta(a).title.localeCompare(meta(b).title, 'fr'));
    const label = t => meta(t).title.split('{{')[0].replace(/[s:—-]+$/, '') || 'Sans titre';
    sheet(`<h3>Nouvelle note depuis un modèle</h3>
        ${tpls.length ? tpls.map(t => `<button class="row" data-id="${t.id}"><span class="ico">🧩</span><span class="lbl">${esc(label(t))}</span></button>`).join('') : '<div class="list-head">Aucun modèle pour l’instant : ajoute le tag #modèle à une note.</div>'}`, (bg, close) => {
        bg.querySelectorAll('[data-id]').forEach(b => b.onclick = async () => {
            const t = store.get(b.dataset.id);
            close();
            const n = await store.createNote({ body: applyTemplate(t.body), container: null });
            go(`#/n/${n.id}`);
        });
    });
}

// ── Note ──
function destroyEditor() { if (editor) { editor.destroy(); editor = null; } current = null; }

async function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (editor && current && editor.getValue() !== current.body) {
        current.body = editor.getValue();
        await store.saveNote(current);
    }
}

function renderNote(id) {
    const n = store.get(id);
    if (!n) { toast('Note introuvable'); return go('#/', true); }
    destroyEditor();
    current = n;
    const c = cont(n.container);
    const where = n.trashed ? '🗑️ Corbeille' : n.archived ? '🗄️ Archives' : c ? `${c.icon || KIND[c.kind].ico} ${c.name}` : '📥 Inbox';
    app.innerHTML = `
    <div class="screen note-screen">
        <div class="topbar"><button class="tb-btn" id="back">${I.back}</button>
            <button class="chip" id="fileBtn"><span>${esc(where)}</span>▾</button><span style="flex:1"></span>
            <button class="tb-btn" id="moreBtn">${I.more}</button></div>
        ${n.trashed ? '<div class="banner">Cette note est dans la corbeille.</div>' : ''}
        <div class="editor-wrap" id="ew"></div>
        <div class="kbd-bar" id="kbd" hidden>
            <button data-k="task" title="Case à cocher">☑</button>
            <button data-k="h" title="Titre">H</button>
            <button data-k="bold" title="Gras"><b>B</b></button>
            <button data-k="italic" title="Italique"><i>I</i></button>
            <button data-k="list" title="Liste">•</button>
            <button data-k="tag" title="Tag">#</button>
            <button data-k="link" title="Lien vers une note">[[ ]]</button>
            <button data-k="hl" title="Surligner">▆</button>
            <button data-k="img" title="Photo">📷</button>
            <span class="sep"></span>
            <button data-k="undo" title="Annuler">↶</button>
            <button data-k="redo" title="Rétablir">↷</button>
            <button class="done-btn" data-k="done">OK</button>
        </div>
    </div>`;
    app.querySelector('#back').onclick = () => history.length > 1 ? history.back() : go('#/');
    app.querySelector('#fileBtn').onclick = () => fileSheet(n);
    app.querySelector('#moreBtn').onclick = () => noteSheet(n);
    editor = createEditor(app.querySelector('#ew'), {
        doc: n.body,
        placeholder: 'Un titre, puis tes idées…',
        onChange: () => {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(async () => { saveTimer = null; if (current && editor) { current.body = editor.getValue(); await store.saveNote(current); } }, 900);
        },
        onFocus: f => { app.querySelector('#kbd').hidden = !f; placeBar(); },
        onTagClick: t => go('#/v/' + encodeURIComponent('tag:' + t)),
        onWikiClick: title => {
            const t = fold(title);
            const hit = store.list().find(x => !x.trashed && fold(meta(x).title) === t);
            if (hit) go('#/n/' + hit.id);
            else if (confirm(`Créer la note « ${title} » ?`)) newNote({ body: `# ${title}\n\n` });
        },
        resolveImage: src => store.resolveImage(src),
        upload: f => store.uploadImage(f),
        onError: e => toast(e.message),
        complete: (kind, q) => {
            if (kind === 'tag') { const s = new Set(); store.list().forEach(x => meta(x).tags.forEach(t => s.add(t))); return [...s].filter(t => t.startsWith(q.toLowerCase())).slice(0, 10); }
            return store.list().filter(x => x.id !== n.id && !x.trashed && fold(meta(x).title).includes(fold(q))).slice(0, 10).map(x => meta(x).title);
        }
    });
    const kbd = app.querySelector('#kbd');
    kbd.addEventListener('mousedown', e => e.preventDefault()); // garder le clavier ouvert
    kbd.addEventListener('touchstart', e => { if (e.target.closest('button')) e.preventDefault(); }, { passive: false });
    const act = k => {
        if (!editor) return;
        ({
            task: () => editor.toggleTask(), h: () => editor.linePrefix('## '), bold: () => editor.wrap('**'), italic: () => editor.wrap('*'),
            list: () => editor.linePrefix('- '), tag: () => editor.insert('#'), link: () => editor.wrap('[[', ']]'), hl: () => editor.wrap('=='),
            undo: () => editor.undo(), redo: () => editor.redo(), done: () => editor.view.contentDOM.blur(),
            img: () => { const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*'; i.onchange = () => editor.insertImage([...i.files]); i.click(); }
        })[k]();
    };
    kbd.querySelectorAll('button').forEach(b => {
        b.addEventListener('touchend', e => { e.preventDefault(); act(b.dataset.k); });
        b.addEventListener('click', () => act(b.dataset.k));
    });
}

// Barre d'outils collée au-dessus du clavier iOS.
function placeBar() {
    const bar = document.getElementById('kbd');
    if (!bar || !window.visualViewport) return;
    const vv = window.visualViewport;
    const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    bar.style.transform = `translateY(${-offset}px)`;
    bar.style.paddingBottom = offset > 0 ? '6px' : '';
}
if (window.visualViewport) { visualViewport.addEventListener('resize', placeBar); visualViewport.addEventListener('scroll', placeBar); }

// ── Feuilles (menus du bas) ──
function sheet(html, onReady) {
    const bg = document.createElement('div');
    bg.className = 'sheet-bg';
    bg.innerHTML = `<div class="sheet"><div class="sheet-grip"></div>${html}</div>`;
    const close = () => bg.remove();
    bg.addEventListener('click', e => { if (e.target === bg) close(); });
    document.body.appendChild(bg);
    onReady && onReady(bg, close);
    return close;
}

function fileSheet(n) {
    const opts = [{ id: null, label: '📥 Inbox', sub: '' }];
    for (const [k, K] of Object.entries(KIND)) {
        const items = [...store.para.values()].filter(c => c.kind === k && !c.archived);
        if (items.length) opts.push({ section: K.label }, ...items.map(c => ({ id: c.id, label: `${c.icon || K.ico} ${c.name}` })));
    }
    opts.push({ section: 'Autre' }, { id: '__archive', label: '🗄️ Archives' });
    sheet(`<h3>Ranger dans…</h3>
        ${opts.map(o => o.section ? `<div class="sheet-label">${esc(o.section)}</div>` : `<button class="row" data-id="${o.id ?? ''}"><span class="lbl">${esc(o.label)}</span>${(n.container || null) === o.id && !n.archived ? '<span class="cnt">✓</span>' : ''}</button>`).join('')}
        <div class="sheet-label">Nouveau</div>
        ${Object.entries(KIND).map(([k, K]) => `<button class="row" data-new="${k}"><span class="lbl">➕ ${K.one}…</span></button>`).join('')}`, (bg, close) => {
        bg.querySelectorAll('[data-id]').forEach(b => b.onclick = async () => {
            const id = b.dataset.id;
            if (id === '__archive') n.archived = true; else { n.container = id || null; n.archived = false; }
            await flush(); await store.saveNote(n); close(); toast('Note rangée ✓'); renderNote(n.id);
        });
        bg.querySelectorAll('[data-new]').forEach(b => b.onclick = async () => {
            const name = prompt(`Nom du ${KIND[b.dataset.new].one.toLowerCase()}`);
            if (!name) return;
            const { newId } = await import('./store.js');
            const c = await store.saveContainer({ id: newId(), kind: b.dataset.new, name: name.trim(), icon: KIND[b.dataset.new].ico, color: '#F0653D', order: Date.now() });
            n.container = c.id; n.archived = false;
            await flush(); await store.saveNote(n); close(); renderNote(n.id);
        });
    });
}

function noteSheet(n) {
    sheet(`
        <button class="row" data-a="pin"><span class="lbl">${n.pinned ? '📍 Désépingler' : '📌 Épingler'}</span></button>
        <button class="row" data-a="preview"><span class="lbl">👁️ Aperçu</span></button>
        <button class="row" data-a="share"><span class="lbl">📤 Partager le texte</span></button>
        <button class="row" data-a="archive"><span class="lbl">${n.archived ? '📤 Sortir des archives' : '🗄️ Archiver'}</span></button>
        ${n.trashed ? '<button class="row" data-a="restore"><span class="lbl">♻️ Restaurer</span></button>' : '<button class="row danger" data-a="trash"><span class="lbl">🗑️ Mettre à la corbeille</span></button>'}
        <div class="list-head">Modifiée ${ago(n.updatedAt)} · créée ${ago(n.createdAt)}</div>`, (bg, close) => {
        bg.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
            await flush();
            const a = b.dataset.a;
            close();
            if (a === 'pin') { n.pinned = !n.pinned; await store.saveNote(n); toast(n.pinned ? 'Épinglée' : 'Désépinglée'); }
            if (a === 'archive') { n.archived = !n.archived; await store.saveNote(n); renderNote(n.id); }
            if (a === 'trash') { n.trashed = true; n.trashedAt = Date.now(); await store.saveNote(n); toast('Mise à la corbeille'); history.back(); }
            if (a === 'restore') { n.trashed = false; await store.saveNote(n); renderNote(n.id); }
            if (a === 'share') { try { await navigator.share({ title: meta(n).title, text: n.body }); } catch (e) { /* annulé */ } }
            if (a === 'preview') sheet(`<div class="md-render" style="padding:0 20px 20px">${renderMarkdown(n.body)}</div>`);
        });
    });
}

function settingsSheet() {
    const c = store.cfg;
    sheet(`<h3>Réglages</h3>
        <div class="list-head">${syncDot()} ${esc(syncLabel())}</div>
        ${c.demo ? '<div class="list-head">Mode démo : les notes restent sur ce téléphone.</div>' : `<div class="list-head">Dépôt : <b>${esc(c.owner)}/${esc(c.repo)}</b> · appareil « ${esc(c.device || 'Téléphone')} »</div>`}
        <button class="row" data-a="sync"><span class="lbl">🔄 Synchroniser maintenant</span></button>
        <button class="row" data-a="theme"><span class="lbl">🌓 Thème ${document.documentElement.dataset.theme === 'light' ? 'sombre' : 'clair'}</span></button>
        <button class="row danger" data-a="logout"><span class="lbl">🚪 Se déconnecter de ce téléphone</span></button>`, (bg, close) => {
        bg.querySelectorAll('[data-a]').forEach(b => b.onclick = async () => {
            const a = b.dataset.a;
            close();
            if (a === 'sync') { toast('Synchronisation…'); await store.sync(); toast(syncLabel()); }
            if (a === 'theme') { const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'; document.documentElement.dataset.theme = t; try { localStorage.setItem('pomodoro.theme', t); } catch (e) { /* rien */ } }
            if (a === 'logout') {
                if (store.status.pending && !confirm(`${store.status.pending} modification(s) pas encore envoyée(s) seront perdues. Continuer ?`)) return;
                await store.logout(); route();
            }
        });
    });
}

// ── Connexion ──
function renderSetup() {
    destroyEditor();
    app.innerHTML = `<div class="setup">
        <div class="logo">${TOMATO}</div>
        <h1>Pomodoro</h1>
        <p>Tes notes IPARA dans la poche, même sans réseau. Le téléphone se synchronise directement avec ton dépôt GitHub privé — le PC et le Mac peuvent être éteints.</p>
        <div class="two"><label class="field"><span>Compte GitHub</span><input id="owner" value="yohgaz" autocapitalize="off" autocorrect="off"></label>
        <label class="field"><span>Dépôt des données</span><input id="repo" value="pomodoro-data" autocapitalize="off" autocorrect="off"></label></div>
        <label class="field"><span>Jeton d’accès GitHub</span><input id="token" type="password" placeholder="github_pat_…" autocapitalize="off" autocorrect="off" autocomplete="off"></label>
        <label class="field"><span>Nom de cet appareil</span><input id="device" value="iPhone"></label>
        <button class="btn primary" id="connect">Connecter</button>
        <div class="err" id="err"></div>
        <details class="help"><summary>Comment créer le jeton ?</summary><ol>
            <li>Sur github.com : photo de profil → <b>Settings</b> → <b>Developer settings</b> → <b>Personal access tokens</b> → <b>Fine-grained tokens</b> → <b>Generate new token</b>.</li>
            <li>Nom : <code>Pomodoro iPhone</code> · Expiration : 1 an (ou « No expiration »).</li>
            <li><b>Repository access</b> : <i>Only select repositories</i> → <code>pomodoro-data</code>.</li>
            <li><b>Permissions</b> → Repository → <b>Contents : Read and write</b>.</li>
            <li>Génère, copie le jeton et colle-le ici. Il reste uniquement sur ce téléphone.</li>
        </ol></details>
        <button class="btn" id="demo">Essayer sans compte (notes locales)</button>
    </div>`;
    const $ = id => app.querySelector('#' + id);
    $('connect').onclick = async () => {
        const cfg = { owner: $('owner').value.trim(), repo: $('repo').value.trim(), token: $('token').value.trim(), device: $('device').value.trim() || 'iPhone', branch: 'main' };
        if (!cfg.token) { $('err').textContent = 'Colle le jeton GitHub.'; return; }
        $('connect').disabled = true; $('connect').textContent = 'Connexion…'; $('err').textContent = '';
        try {
            const repo = await store.testConnection(cfg);
            cfg.branch = repo.default_branch || 'main';
            await store.configure(cfg);
            go('#/', true);
            toast('Connecté ✓ — récupération des notes…');
            await store.sync();
        } catch (e) {
            $('err').textContent = e.message;
            $('connect').disabled = false; $('connect').textContent = 'Connecter';
        }
    };
    $('demo').onclick = async () => {
        await store.configure({ demo: true, device: 'démo' });
        if (!store.list().length) await store.createNote({ body: '# Liste de courses 🛒\n\n- [ ] Pain\n- [ ] Tomates\n- [x] Café\n\n#courses' });
        go('#/', true);
    };
}

// ── Rafraîchissements ──
store.addEventListener('change', e => {
    const d = e.detail || {};
    const h = location.hash || '#/';
    if (h.startsWith('#/n/')) {
        if (current && editor && (d.kind === 'pull' || d.remoteWon) ) {
            const fresh = store.get(current.id);
            if (fresh && fresh !== current && fresh.body !== editor.getValue() && !saveTimer) { current = fresh; editor.replaceAll(fresh.body); toast('Note mise à jour 🔄'); }
            else if (fresh) current = fresh;
        }
        return;
    }
    if (d.kind === 'pull' || d.kind === 'para') route();
});
store.addEventListener('status', () => {
    const b = document.getElementById('syncBtn');
    if (b) b.innerHTML = syncDot();
});
window.addEventListener('online', () => store.sync());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') store.sync(); else flush(); });
window.addEventListener('pagehide', () => { flush(); });
setInterval(() => { if (document.visibilityState === 'visible') store.sync(); }, 60000);

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

(async () => {
    await store.load();
    route();
    store.sync();
})();
