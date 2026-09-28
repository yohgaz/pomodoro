// Pomodoro — espace de notes IPARA (Inbox, Projets, Domaines, Ressources, Archives).
import { get, post, put, del, on, connect, uploadFile } from './api.js';
import { h, icon, esc, ago, fullDate, toast, menu, modal, confirmBox, promptBox, debounce, modKey, COLORS, TOMATO } from './ui.js';
import { createEditor, renderMarkdown } from '/vendor/editor.bundle.js?v=2';

const KIND = {
    project: { label: 'Projets', one: 'Projet', letter: 'P', color: 'var(--gold)', bg: 'var(--gold-soft)', ico: '🎯', help: 'Un objectif précis, avec une échéance.' },
    area: { label: 'Domaines', one: 'Domaine', letter: 'A', color: 'var(--mint)', bg: 'var(--mint-soft)', ico: '🧭', help: 'Une responsabilité continue, sans date de fin.' },
    resource: { label: 'Ressources', one: 'Ressource', letter: 'R', color: 'var(--sky)', bg: 'rgba(122,184,255,.14)', ico: '📚', help: 'Un sujet d’intérêt, de la documentation.' }
};
const FILTERS = [
    { view: 'all', label: 'Toutes les notes', ico: '🗂️' },
    { view: 'todo', label: 'À faire', ico: '☑️' },
    { view: 'today', label: 'Aujourd’hui', ico: '📅' },
    { view: 'untagged', label: 'Sans tag', ico: '🏷️' },
    { view: 'trash', label: 'Corbeille', ico: '🗑️' }
];

const S = {
    view: 'inbox', noteId: null, q: '', sort: 'updated',
    counts: null, tags: [], containers: [], list: [],
    note: null, editor: null, dirty: false, saveTimer: null, preview: false, conflict: null,
    server: null, stream: null, wide: null,
    ui: loadUi()
};

function loadUi() {
    try { return { open: { project: true, area: true, resource: false }, tags: {}, sort: 'updated', ...JSON.parse(localStorage.getItem('pomodoro.ui') || '{}') }; }
    catch (e) { return { open: { project: true, area: true, resource: false }, tags: {}, sort: 'updated' }; }
}
function saveUi() { try { localStorage.setItem('pomodoro.ui', JSON.stringify(S.ui)); } catch (e) { /* rien */ } }

const $ = id => document.getElementById(id);
const app = $('app');
const isNarrow = () => matchMedia('(max-width: 820px)').matches;
const setScreen = s => { app.dataset.screen = s; };
const cont = id => S.containers.find(c => c.id === id) || null;

// ── Navigation ──
function navigate(path, { replace = false } = {}) {
    if (location.pathname !== path) history[replace ? 'replaceState' : 'pushState']({}, '', path);
    route();
}
window.addEventListener('popstate', route);
export { navigate };

function viewPath(view, noteId) { return `/v/${encodeURIComponent(view)}${noteId ? '/' + noteId : ''}`; }

async function route() {
    const p = location.pathname;
    if (p.startsWith('/stream') || p.startsWith('/db/') || ['/timer', '/settings', '/tasks', '/review', '/calendar'].includes(p)) {
        await flushSave();
        app.classList.add('is-wide');
        $('widePane').hidden = false;
        const which = p === '/settings' ? 'settings' : p === '/tasks' ? 'tasks' : p === '/review' ? 'review' : p === '/calendar' ? 'calendar' : p.startsWith('/db/') ? 'db' : 'stream';
        const parts = p.split('/');
        const tab = p === '/timer' ? 'timer' : parts[2];
        const mod = await import(`./${which}.js`);
        S.wide = which;
        S.wideDb = which === 'db' ? parts[2] : null;
        mod.render($('widePane'), { S, navigate, tab, sub: parts[3] || null, refreshState, refreshCounts });
        renderSidebar();
        return;
    }
    app.classList.remove('is-wide');
    $('widePane').hidden = true;
    if (S.wide) { S.wide = null; $('widePane').innerHTML = ''; }
    const m = p.match(/^\/v\/([^/]+)(?:\/([^/]+))?/);
    if (!m) return navigate(viewPath('inbox'), { replace: true });
    const view = decodeURIComponent(m[1]);
    const noteId = m[2] || null;
    const viewChanged = view !== S.view || !S.list.length;
    S.view = view;
    renderSidebar();
    if (viewChanged) { S.q = ''; await loadList(); } else renderList();
    if (noteId !== S.noteId || !S.note) await openNote(noteId);
    if (isNarrow()) setScreen(noteId ? 'note' : (m ? 'list' : 'side'));
}

// ── Données ──
async function refreshCounts() {
    const [r, tasks, perso, dbs] = await Promise.all([get('/api/notes/counts'), get('/api/tasks'), get('/api/stream/users/_perso').catch(() => null), get('/api/dbs').catch(() => [])]);
    S.dbs = dbs;
    S.counts = r.counts; S.tags = r.tags; S.containers = r.containers;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const persoOpen = perso ? perso.projects.reduce((n, p) => n + (p.active ? 1 : 0) + p.backlog.length, 0) : 0;
    S.taskCount = tasks.length + persoOpen;
    S.taskUrgent = tasks.filter(t => t.due && t.due <= iso).length;
    renderSidebar();
    renderListHead();
}
async function loadList() {
    const qs = new URLSearchParams({ view: S.view, sort: S.ui.sort || 'updated' });
    if (S.q) qs.set('q', S.q);
    S.list = await get('/api/notes?' + qs);
    renderList();
}
const refreshAll = debounce(async () => { S.templates = null; await Promise.all([refreshCounts(), S.wide ? null : loadList()]); }, 250);

async function refreshState() {
    S.server = await get('/api/state');
    renderSidebar();
}

// ── Barre latérale ──
function navItem({ label, ico, view, count, active, cls = '', color, letter, onclick, drop, extra }) {
    const el = h('a', {
        class: `nav-item ${active ? 'is-active' : ''} ${cls}`,
        href: view ? viewPath(view) : '#',
        onclick: e => { e.preventDefault(); if (onclick) onclick(); else navigate(viewPath(view)); if (isNarrow()) setScreen('list'); }
    },
        letter ? h('span', { class: 'ipara-letter', style: { color: letter.color, background: letter.bg } }, letter.l) :
            color ? h('span', { class: 'dot', style: { background: color } }) : h('span', { class: 'nav-ico' }, ico || ''),
        h('span', { class: 'nav-label' }, label),
        extra || null,
        h('span', { class: 'nav-count' }, count ? String(count) : '')
    );
    if (drop !== undefined) {
        el.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/note-id')) { e.preventDefault(); el.classList.add('is-drop'); } });
        el.addEventListener('dragleave', () => el.classList.remove('is-drop'));
        el.addEventListener('drop', async e => {
            e.preventDefault(); el.classList.remove('is-drop');
            const id = e.dataTransfer.getData('text/note-id');
            if (id) await moveNote(id, drop);
        });
    }
    return el;
}

function renderSidebar() {
    const sb = $('sidebar');
    const c = S.counts || { containers: {} };
    const active = S.wide ? null : S.view;
    const machine = S.server ? S.server.config.machineName : '';
    const frag = [];

    frag.push(h('div', { class: 'brand' },
        h('span', { class: 'brand-logo', html: TOMATO }),
        h('div', {}, h('div', { class: 'brand-name' }, (S.server && S.server.settings.workspaceName) || 'Pomodoro'), h('div', { class: 'brand-machine' }, machine ? `sur ${machine}` : ''))
    ));
    frag.push(h('div', { class: 'capture-row' },
        h('button', { class: 'capture-btn', onclick: () => newNote() }, icon('plus'), 'Nouvelle note', h('kbd', {}, `${modKey} N`)),
        h('button', { class: 'capture-more', title: `Depuis un modèle (${modKey}⇧N)`, onclick: e => templateMenu(e.currentTarget) }, '🧩')));

    const scroll = h('div', { class: 'side-scroll' });
    // Tableau de bord : tâches + revue hebdomadaire
    const rv = (S.server && S.server.settings.review) || { lastAt: 0, everyDays: 7 };
    const reviewDue = Date.now() - (rv.lastAt || 0) > (rv.everyDays || 7) * 86400000;
    const top = h('div', { class: 'side-group', style: { marginTop: '4px' } });
    top.appendChild(navItem({ label: 'Tâches', ico: '☑️', active: S.wide === 'tasks', onclick: () => navigate('/tasks'), count: S.taskCount || '',
        extra: S.taskUrgent ? h('span', { class: 'pill accent', title: 'En retard ou pour aujourd’hui' }, `🔥 ${S.taskUrgent}`) : null }));
    top.appendChild(navItem({ label: 'Calendrier', ico: '📅', active: S.wide === 'calendar', onclick: () => navigate('/calendar') }));
    top.appendChild(navItem({ label: 'Revue hebdo', ico: '🔁', active: S.wide === 'review', onclick: () => navigate('/review'),
        extra: reviewDue ? h('span', { class: 'pill gold' }, 'à faire') : null }));
    scroll.appendChild(top);

    // Bases de données
    const dbg = h('div', { class: 'side-group' }, h('div', { class: 'side-title' }, h('span', {}, 'Bases de données'),
        h('button', { title: 'Nouvelle base', onclick: async e => {
            e.preventDefault();
            const name = await promptBox('Nouvelle base de données', { placeholder: 'Ex. Lectures, Jeux à faire, Idées de vidéos…', ok: 'Créer' });
            if (!name) return;
            const db = await post('/api/dbs', { name, icon: '🗃️', properties: [{ id: 'statut', name: 'Statut', type: 'select', options: [{ name: 'À faire', color: '#A6A29B' }, { name: 'En cours', color: '#E8B84D' }, { name: 'Terminé', color: '#6FDA9A' }] }, { id: 'date', name: 'Date', type: 'date' }] });
            await refreshCounts();
            navigate(`/db/${db.id}`);
        } }, '+')));
    for (const d of S.dbs || []) dbg.appendChild(navItem({ label: d.name, ico: d.icon || '🗃️', active: S.wide === 'db' && S.wideDb === d.id, onclick: () => navigate(`/db/${d.id}`) }));
    if (!(S.dbs || []).length) dbg.appendChild(h('div', { class: 'muted', style: { fontSize: '12.5px', padding: '2px 9px 6px', fontWeight: 600 } }, 'Aucune base pour l’instant.'));
    scroll.appendChild(dbg);
    // IPARA
    const g = h('div', { class: 'side-group' }, h('div', { class: 'side-title' }, h('span', {}, 'IPARA')));
    g.appendChild(navItem({ label: 'Inbox', view: 'inbox', count: c.inbox, active: active === 'inbox', cls: 'is-inbox', letter: { l: 'I', color: '#fff', bg: 'var(--accent)' }, drop: { container: null, archived: false } }));
    for (const [kind, K] of Object.entries(KIND)) {
        const items = S.containers.filter(x => x.kind === kind && !x.archived);
        const open = S.ui.open[kind];
        const caret = h('button', { class: `nav-caret ${open ? 'is-open' : ''}`, onclick: e => { e.preventDefault(); e.stopPropagation(); S.ui.open[kind] = !open; saveUi(); renderSidebar(); }, 'aria-label': 'Déplier' }, '▶');
        const add = h('button', { class: 'nav-caret', title: `Nouveau ${K.one.toLowerCase()}`, onclick: e => { e.preventDefault(); e.stopPropagation(); editContainer({ kind }); } }, '+');
        g.appendChild(navItem({ label: K.label, view: `kind:${kind}`, active: active === `kind:${kind}`, letter: { l: K.letter, color: K.color, bg: K.bg }, extra: h('span', { style: { display: 'flex', gap: '2px' } }, add, caret), count: items.length || '' }));
        if (open && items.length) {
            const sub = h('div', { class: 'nav-sub' });
            for (const it of items) {
                sub.appendChild(navItem({
                    label: it.name, ico: it.icon || K.ico, view: `container:${it.id}`, count: c.containers[it.id],
                    active: active === `container:${it.id}`, drop: { container: it.id, archived: false }
                }));
            }
            g.appendChild(sub);
        }
    }
    g.appendChild(navItem({ label: 'Archives', view: 'archive', count: c.archive, active: active === 'archive', letter: { l: 'A', color: 'var(--mu)', bg: 'var(--c3)' }, drop: { archived: true } }));
    scroll.appendChild(g);

    // Filtres
    const f = h('div', { class: 'side-group' }, h('div', { class: 'side-title' }, h('span', {}, 'Filtres')));
    for (const it of FILTERS) {
        f.appendChild(navItem({ label: it.label, ico: it.ico, view: it.view, count: c[it.view], active: active === it.view, drop: it.view === 'trash' ? { trashed: true } : undefined }));
    }
    scroll.appendChild(f);

    // Tags (arborescence #a/b)
    if (S.tags.length) {
        const tg = h('div', { class: 'side-group' }, h('div', { class: 'side-title' }, h('span', {}, 'Tags')));
        const byParent = {};
        for (const t of S.tags) {
            const i = t.tag.lastIndexOf('/');
            const parent = i < 0 ? '' : t.tag.slice(0, i);
            (byParent[parent] = byParent[parent] || []).push(t);
        }
        const addLevel = (parent, container, depth) => {
            for (const t of byParent[parent] || []) {
                const hasKids = !!byParent[t.tag];
                const open = !!S.ui.tags[t.tag];
                const caret = hasKids ? h('button', { class: `nav-caret ${open ? 'is-open' : ''}`, onclick: e => { e.preventDefault(); e.stopPropagation(); S.ui.tags[t.tag] = !open; saveUi(); renderSidebar(); } }, '▶') : null;
                const item = navItem({ label: t.tag.slice(parent ? parent.length + 1 : 0), ico: '#', view: `tag:${t.tag}`, count: t.count, active: active === `tag:${t.tag}`, extra: caret });
                item.style.paddingLeft = (9 + depth * 14) + 'px';
                item.addEventListener('contextmenu', e => { e.preventDefault(); tagMenu(e, t.tag); });
                container.appendChild(item);
                if (hasKids && open) addLevel(t.tag, container, depth + 1);
            }
        };
        addLevel('', tg, 0);
        scroll.appendChild(tg);
    }

    const foot = h('div', { class: 'side-foot' });
    const t = S.stream && S.stream.timer;
    let timerExtra = null;
    if (t && t.phase !== 'done') {
        const rem = t.paused ? t.remaining : Math.max(0, t.endsAt - Date.now());
        timerExtra = h('span', { class: `pill ${t.phase === 'work' ? 'accent' : 'mint'}`, id: 'sideTimer' }, fmt(rem));
    }
    foot.appendChild(navItem({ label: 'Stream', ico: '🎥', active: S.wide === 'stream', onclick: () => navigate('/stream'), extra: S.server && S.server.bot && S.server.bot.connected ? h('span', { class: 'pill mint' }, 'live') : null }));
    foot.appendChild(navItem({ label: 'Minuteur', ico: '🍅', onclick: () => navigate('/stream/timer'), extra: timerExtra }));
    foot.appendChild(navItem({ label: 'Réglages', ico: '⚙️', active: S.wide === 'settings', onclick: () => navigate('/settings') }));
    foot.appendChild(syncChip());

    sb.replaceChildren(...frag, scroll, foot);
}

function syncChip() {
    const st = S.server && S.server.sync;
    let cls = '', txt = 'Synchro…';
    if (st) {
        if (st.state === 'syncing') { cls = 'busy'; txt = 'Synchronisation…'; }
        else if (st.state === 'idle') { cls = 'ok'; txt = `Synchronisé ${ago(st.lastSync)}`; }
        else if (st.state === 'local') { cls = 'local'; txt = 'Local uniquement (pas de dépôt)'; }
        else if (st.state === 'offline') { cls = 'err'; txt = 'Hors ligne — en attente'; }
        else if (st.state === 'error') { cls = 'err'; txt = 'Erreur de synchro'; }
        else if (st.state === 'disabled') { cls = 'err'; txt = 'Synchro désactivée'; }
    }
    return h('div', { class: 'sync-chip', title: st && st.lastError ? st.lastError : 'Synchroniser maintenant', onclick: async () => { toast('Synchronisation…'); await post('/api/sync/now'); } },
        h('span', { class: `sync-dot ${cls}` }), h('span', {}, txt));
}

function tagMenu(e, tag) {
    menu({ x: e.clientX, y: e.clientY, getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }) }, [
        { icon: '✏️', text: 'Renommer le tag…', run: () => renameTag(tag) },
        { icon: '📝', text: 'Nouvelle note avec ce tag', run: () => newNote({ body: `# \n\n#${tag}` }) }
    ]);
}

async function renameTag(tag) {
    const to = await promptBox(`Renommer #${tag}`, { value: tag, ok: 'Renommer', hint: 'Le tag (et ses sous-tags) est remplacé dans toutes les notes.' });
    if (!to || to === tag) return;
    const r = await post('/api/tags/rename', { from: tag, to });
    toast(`#${tag} → #${to} dans ${r.changed} note${r.changed > 1 ? 's' : ''}`, 'ok');
    if (S.view === `tag:${tag}`) navigate(viewPath(`tag:${to}`));
    refreshAll();
}

// ── Liste des notes ──
function viewInfo() {
    const v = S.view;
    if (v === 'inbox') return { title: '📥 Inbox', sub: 'Tout ce qui arrive ici attend d’être rangé : dans un projet, un domaine, une ressource ou les archives.' };
    if (v === 'archive') return { title: '🗄️ Archives', sub: 'Projets, domaines et notes terminés ou en pause. Rien n’est perdu.' };
    if (v.startsWith('kind:')) { const K = KIND[v.slice(5)]; return { title: `${K.ico} ${K.label}`, sub: K.help }; }
    if (v.startsWith('tag:')) return { title: `#${v.slice(4)}`, sub: 'Notes portant ce tag (et ses sous-tags).', tag: v.slice(4) };
    if (v.startsWith('container:')) {
        const c = cont(v.slice(10));
        if (!c) return { title: 'Introuvable', sub: '' };
        return { title: `${c.icon || KIND[c.kind].ico} ${c.name}`, container: c };
    }
    const f = FILTERS.find(x => x.view === v);
    return { title: f ? `${f.ico} ${f.label}` : v, sub: v === 'trash' ? 'Les notes sont supprimées définitivement après 30 jours.' : '' };
}

function renderListHead() {
    const head = document.querySelector('.list-head');
    if (!head) return;
    const info = viewInfo();
    const titleRow = h('div', { class: 'list-title-row' },
        h('button', { class: 'icon-btn mobile-back', onclick: () => setScreen('side'), 'aria-label': 'Retour' }, icon('back')),
        h('div', { class: 'list-title', title: info.title }, info.title)
    );
    const actions = [];
    if (info.container) actions.push(h('button', { class: 'icon-btn', title: 'Modifier', onclick: () => editContainer(info.container) }, icon('edit')));
    if (info.tag) actions.push(h('button', { class: 'icon-btn', title: 'Renommer le tag', onclick: () => renameTag(info.tag) }, icon('edit')));
    if (S.view === 'trash' && S.list.length) actions.push(h('button', { class: 'btn small danger', onclick: emptyTrash }, 'Vider'));
    actions.push(h('button', { class: 'icon-btn', title: 'Trier', onclick: e => sortMenu(e.currentTarget) }, icon('sort')));
    if (S.view !== 'trash') actions.push(h('button', { class: 'icon-btn', title: `Nouvelle note (${modKey} N)`, onclick: () => newNote() }, icon('plus')));
    titleRow.append(...actions);

    let sub = null;
    if (info.container) {
        const c = info.container;
        const K = KIND[c.kind];
        const area = c.areaId ? cont(c.areaId) : null;
        const parts = [h('span', { class: 'pill', style: { color: K.color, background: K.bg } }, K.one)];
        if (area) parts.push(h('span', { class: 'pill' }, `${area.icon || '🧭'} ${area.name}`));
        if (c.due) {
            const days = Math.ceil((new Date(c.due + 'T23:59:59') - Date.now()) / 86400000);
            parts.push(h('span', { class: `pill ${days < 0 ? 'accent' : days <= 3 ? 'gold' : ''}` }, days < 0 ? `en retard de ${-days} j` : days === 0 ? 'échéance aujourd’hui' : `échéance dans ${days} j`));
        }
        if (c.archived) parts.push(h('span', { class: 'pill' }, 'archivé'));
        sub = h('div', { class: 'list-sub' }, ...parts, c.description ? h('div', { style: { marginTop: '6px' } }, c.description) : null);
        let open = 0, done = 0;
        for (const n of S.list) { open += n.tasks.open; done += n.tasks.done; }
        if (open + done) sub.appendChild(h('div', { class: 'cont-progress', title: `${done}/${open + done} tâches` }, h('b', { style: { width: `${Math.round(done * 100 / (open + done))}%` } })));
    } else if (info.sub) sub = h('div', { class: 'list-sub' }, info.sub);

    const input = h('input', { type: 'search', placeholder: 'Rechercher (#tag pour filtrer)', value: S.q });
    input.addEventListener('input', debounce(() => { S.q = input.value; loadList(); }, 180));
    head.replaceChildren(titleRow, sub || '', h('label', { class: 'search' }, icon('search'), input));
}

function sortMenu(anchor) {
    const set = s => { S.ui.sort = s; saveUi(); loadList(); };
    const cur = S.ui.sort || 'updated';
    menu(anchor, [
        { label: 'Trier par' },
        { icon: cur === 'updated' ? '✓' : '', text: 'Date de modification', run: () => set('updated') },
        { icon: cur === 'created' ? '✓' : '', text: 'Date de création', run: () => set('created') },
        { icon: cur === 'title' ? '✓' : '', text: 'Titre', run: () => set('title') }
    ], { align: 'right' });
}

function renderList() {
    const pane = $('listPane');
    if (!pane.querySelector('.list-head')) {
        pane.replaceChildren(h('div', { class: 'list-head' }), h('div', { class: 'list-scroll', id: 'listScroll' }));
    }
    renderListHead();
    const box = $('listScroll');
    if (!S.list.length) {
        const empty = S.q ? ['🔍', 'Aucune note ne correspond.'] :
            S.view === 'inbox' ? ['🎉', 'Inbox vide : tout est rangé !'] :
                S.view === 'trash' ? ['🗑️', 'La corbeille est vide.'] :
                    S.view === 'todo' ? ['☑️', 'Aucune case à cocher en attente.'] : ['📝', 'Aucune note ici pour l’instant.'];
        box.replaceChildren(h('div', { class: 'list-empty' }, h('span', { class: 'big' }, empty[0]), empty[1],
            S.view !== 'trash' && !S.q ? h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn small', onclick: () => newNote() }, icon('plus'), 'Nouvelle note')) : null));
        return;
    }
    const showCont = !S.view.startsWith('container:');
    const cards = [];
    let pinnedHeader = false, othersHeader = false;
    const hasPinned = S.list.some(n => n.pinned) && S.view !== 'trash' && !S.q;
    for (const n of S.list) {
        if (hasPinned && n.pinned && !pinnedHeader) { cards.push(h('div', { class: 'list-section-label' }, '📌 Épinglées')); pinnedHeader = true; }
        if (hasPinned && !n.pinned && !othersHeader) { cards.push(h('div', { class: 'list-section-label' }, 'Notes')); othersHeader = true; }
        cards.push(noteCard(n, showCont));
    }
    box.replaceChildren(...cards);
}

function noteCard(n, showCont) {
    const c = showCont && n.container ? cont(n.container) : null;
    const total = n.tasks.open + n.tasks.done;
    const card = h('a', {
        class: `note-card ${n.id === S.noteId ? 'is-active' : ''}`, href: viewPath(S.view, n.id), draggable: 'true', 'data-id': n.id,
        onclick: e => { e.preventDefault(); navigate(viewPath(S.view, n.id)); }
    },
        h('div', { class: 'note-card-title' }, n.pinned ? h('span', { class: 'pin', style: { flex: '0' } }, '📌') : null, h('span', {}, n.title)),
        n.excerpt ? h('div', { class: 'note-card-excerpt' }, n.excerpt) : null,
        h('div', { class: 'note-card-meta' },
            h('span', {}, ago(n.updatedAt)),
            c ? h('span', { class: 'cont' }, c.icon || KIND[c.kind].ico, c.name) : null,
            total ? h('span', { class: 'progress-mini', title: `${n.tasks.done}/${total} tâches` }, h('i', {}, h('b', { style: { width: `${Math.round(n.tasks.done * 100 / total)}%` } })), `${n.tasks.done}/${total}`) : null,
            ...n.tags.slice(0, 3).map(t => h('span', { class: 'tagchip' }, '#' + t))
        )
    );
    card.addEventListener('dragstart', e => { e.dataTransfer.setData('text/note-id', n.id); e.dataTransfer.effectAllowed = 'move'; });
    card.addEventListener('contextmenu', e => { e.preventDefault(); noteMenu({ x: e.clientX, y: e.clientY, getBoundingClientRect: () => ({ left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY }) }, n); });
    return card;
}

// ── Actions sur les notes ──
async function newNote({ body, container } = {}) {
    await flushSave();
    let cid = container;
    if (cid === undefined) cid = S.view.startsWith('container:') ? S.view.slice(10) : null;
    let text = body;
    if (text === undefined) text = S.view.startsWith('tag:') ? `# \n\n#${S.view.slice(4)}` : '# ';
    const n = await post('/api/notes', { body: text, container: cid });
    const view = ['trash', 'archive'].includes(S.view) || (S.view.startsWith('kind:')) ? (cid ? `container:${cid}` : 'inbox') : S.view;
    if (view !== S.view) S.view = view;
    S.list.unshift(n.meta);
    navigate(viewPath(view, n.id));
    refreshAll();
    setTimeout(() => { if (S.editor) { S.editor.focus(false); S.editor.view.dispatch({ selection: { anchor: 2 } }); } }, 60);
}

// ── Modèles de notes (notes portant le tag #modèle) ──
async function newFromTemplate(t) {
    await flushSave();
    const container = S.view.startsWith('container:') ? S.view.slice(10) : null;
    const n = await post('/api/notes/from-template', { templateId: t.id, container });
    const view = container ? S.view : 'inbox';
    S.view = view;
    navigate(viewPath(view, n.id));
    refreshAll();
    toast(`📝 Note créée depuis « ${t.title} »`, 'ok');
}

async function templateMenu(anchor) {
    const list = await get('/api/templates');
    const items = [{ label: 'Nouvelle note depuis un modèle' }];
    if (!list.length) {
        items.push({ icon: '✨', text: 'Créer les modèles de base', run: async () => {
            const r = await post('/api/templates/seed');
            toast(`${r.created} modèles créés dans la ressource « Modèles »`, 'ok');
            refreshAll();
        } });
    } else {
        for (const t of list) items.push({ icon: '🧩', text: t.title || 'Sans titre', run: () => newFromTemplate(t) });
    }
    items.push('-', { icon: 'ℹ️', text: 'Astuce : ajoute #modèle à une note pour en faire un modèle', run: () => {} });
    menu(anchor, items);
}

async function moveNote(id, dest) {
    const patch = {};
    if ('container' in dest) patch.container = dest.container;
    if ('archived' in dest) patch.archived = dest.archived;
    if ('trashed' in dest) patch.trashed = dest.trashed;
    const r = await put(`/api/notes/${id}`, patch);
    if (S.note && S.note.id === id) Object.assign(S.note, { container: r.container, archived: r.archived, trashed: r.trashed });
    const where = dest.trashed ? 'la corbeille' : dest.archived ? 'les archives' : dest.container ? (cont(dest.container) || {}).name : 'l’Inbox';
    toast(`Note déplacée dans ${where}`, 'ok');
    refreshAll();
    if (S.note && S.note.id === id) renderEditor();
}

async function togglePin(n) {
    const r = await put(`/api/notes/${n.id}`, { pinned: !n.pinned });
    if (S.note && S.note.id === n.id) { S.note.pinned = r.pinned; renderToolbar(); }
    refreshAll();
}

async function trashNote(n) {
    await flushSave();
    await put(`/api/notes/${n.id}`, { trashed: true });
    toast('Note mise à la corbeille', '', { action: 'Annuler', onAction: async () => { await put(`/api/notes/${n.id}`, { trashed: false }); refreshAll(); } });
    const idx = S.list.findIndex(x => x.id === n.id);
    const next = S.list[idx + 1] || S.list[idx - 1];
    S.list = S.list.filter(x => x.id !== n.id);
    navigate(viewPath(S.view, next && next.id !== n.id ? next.id : null));
    refreshAll();
}

async function emptyTrash() {
    if (!await confirmBox('Vider la corbeille ?', 'Les notes seront supprimées définitivement de toutes tes machines.', { ok: 'Vider', danger: true })) return;
    await post('/api/notes/trash/empty');
    navigate(viewPath('trash'));
    refreshAll();
}

function noteMenu(anchor, n) {
    const items = [
        { icon: '📁', text: 'Ranger dans…', hint: `${modKey}⇧M`, run: () => fileNote(n) },
        { icon: n.pinned ? '📍' : '📌', text: n.pinned ? 'Désépingler' : 'Épingler', run: () => togglePin(n) },
        n.archived ? { icon: '📤', text: 'Sortir des archives', run: () => moveNote(n.id, { archived: false }) } : { icon: '🗄️', text: 'Archiver la note', run: () => moveNote(n.id, { archived: true }) },
        '-',
        { icon: '🔗', text: 'Copier le lien [[…]]', run: () => { navigator.clipboard.writeText(`[[${n.title}]]`); toast('Lien copié'); } },
        { icon: '⬇️', text: 'Télécharger en .md', run: () => downloadNote(n.id) },
        { icon: '🕘', text: 'Historique des versions', run: () => showHistory(n.id) },
        '-',
        n.trashed ? { icon: '♻️', text: 'Restaurer', run: () => moveNote(n.id, { trashed: false }) } : { icon: '🗑️', text: 'Mettre à la corbeille', danger: true, run: () => trashNote(n) }
    ];
    if (n.trashed) items.push({ icon: '💥', text: 'Supprimer définitivement', danger: true, run: () => destroyNote(n) });
    menu(anchor, items, { align: 'right' });
}

async function destroyNote(n) {
    if (!await confirmBox('Supprimer définitivement ?', 'Cette note disparaîtra de toutes tes machines.', { ok: 'Supprimer', danger: true })) return;
    await del(`/api/notes/${n.id}`);
    navigate(viewPath(S.view));
    refreshAll();
}

async function downloadNote(id) {
    const n = await get(`/api/notes/${id}`);
    const a = h('a', { href: URL.createObjectURL(new Blob([n.body], { type: 'text/markdown' })), download: `${n.meta.title.replace(/[\\/:*?"<>|]/g, ' ').slice(0, 80) || 'note'}.md` });
    a.click();
}

// Choisir où ranger une note (traitement de l'Inbox).
function fileNote(n) {
    const options = [
        { id: null, label: 'Inbox', ico: '📥', kind: 'Inbox' },
        ...['project', 'area', 'resource'].flatMap(k => S.containers.filter(c => c.kind === k && !c.archived).map(c => ({ id: c.id, label: c.name, ico: c.icon || KIND[k].ico, kind: KIND[k].one }))),
        { id: '__archive', label: 'Archives', ico: '🗄️', kind: 'Archives' }
    ];
    palettePicker({
        placeholder: 'Ranger dans… (tape pour filtrer)',
        items: q => {
            const f = q.toLowerCase();
            const res = options.filter(o => !f || o.label.toLowerCase().includes(f));
            const create = q.trim() ? ['project', 'area', 'resource'].map(k => ({ create: k, label: `Créer ${KIND[k].one.toLowerCase()} « ${q.trim()} »`, ico: '➕', kind: '' })) : [];
            return [...res, ...create];
        },
        render: o => [h('span', { class: 'mi-ico' }, o.ico), h('div', {}, o.label, o.kind ? h('small', {}, o.kind) : null), (o.id === (n.container || null) && !o.create) ? h('span', { class: 'mi-hint' }, 'actuel') : null],
        pick: async (o, q) => {
            if (o.create) {
                const c = await post('/api/para', { kind: o.create, name: q.trim(), icon: KIND[o.create].ico, color: COLORS[Math.floor(Math.random() * COLORS.length)] });
                await refreshCounts();
                return moveNote(n.id, { container: c.id, archived: false });
            }
            if (o.id === '__archive') return moveNote(n.id, { archived: true });
            return moveNote(n.id, { container: o.id, archived: false });
        }
    });
}

// ── Palette générique (recherche partout, rangement…) ──
function palettePicker({ placeholder, items, render, pick, async: isAsync }) {
    const bg = h('div', { class: 'overlay-bg' });
    const input = h('input', { placeholder, 'aria-label': placeholder });
    const list = h('div', { class: 'palette-list' });
    bg.appendChild(h('div', { class: 'palette' }, input, list));
    let current = [], sel = 0, seq = 0;
    const close = () => bg.remove();
    const draw = () => {
        list.replaceChildren(...current.map((o, i) => {
            if (o.section) return h('div', { class: 'menu-label' }, o.section);
            const b = h('button', { class: `menu-item ${i === sel ? 'is-sel' : ''}`, onclick: () => { close(); pick(o, input.value); } }, ...render(o));
            b.addEventListener('mousemove', () => { if (sel !== i) { sel = i; draw(); } });
            return b;
        }));
        const s = list.querySelector('.is-sel');
        if (s) s.scrollIntoView({ block: 'nearest' });
    };
    const refresh = async () => {
        const my = ++seq;
        const r = await items(input.value);
        if (my !== seq) return;
        current = r;
        sel = current.findIndex(o => !o.section);
        draw();
    };
    input.addEventListener('input', isAsync ? debounce(refresh, 120) : refresh);
    input.addEventListener('keydown', e => {
        const move = d => { let i = sel; do { i = (i + d + current.length) % current.length; } while (current[i] && current[i].section && i !== sel); sel = i; draw(); };
        if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
        else if (e.key === 'Enter') { e.preventDefault(); const o = current[sel]; if (o && !o.section) { close(); pick(o, input.value); } }
        else if (e.key === 'Escape') close();
    });
    bg.addEventListener('mousedown', e => { if (e.target === bg) close(); });
    document.body.appendChild(bg);
    input.focus();
    refresh();
}

function commandPalette() {
    const actions = [
        { act: 'new', label: 'Nouvelle note', ico: '📝', hint: `${modKey} N` },
        { act: 'go', to: viewPath('inbox'), label: 'Aller à l’Inbox', ico: '📥' },
        { act: 'go', to: '/tasks', label: 'Toutes mes tâches', ico: '☑️' },
        { act: 'go', to: '/review', label: 'Revue hebdomadaire', ico: '🔁' },
        { act: 'go', to: '/stream', label: 'Ouvrir le stream', ico: '🎥' },
        { act: 'go', to: '/stream/timer', label: 'Minuteur pomodoro', ico: '🍅' },
        { act: 'go', to: '/settings', label: 'Réglages', ico: '⚙️' },
        { act: 'container', kind: 'project', label: 'Nouveau projet', ico: '🎯' },
        { act: 'container', kind: 'area', label: 'Nouveau domaine', ico: '🧭' },
        { act: 'container', kind: 'resource', label: 'Nouvelle ressource', ico: '📚' },
        { act: 'theme', label: 'Basculer thème clair / sombre', ico: '🌓' },
        { act: 'focus', label: 'Mode concentration (masquer les colonnes)', ico: '🎧', hint: `${modKey}⇧F` }
    ];
    if (S.note) actions.splice(1, 0, { act: 'file', label: 'Ranger la note actuelle…', ico: '📁', hint: `${modKey}⇧M` });
    palettePicker({
        placeholder: 'Rechercher une note, un projet, une action…',
        async: true,
        items: async q => {
            const f = q.trim().toLowerCase();
            const acts = actions.filter(a => !f || a.label.toLowerCase().includes(f));
            const conts = S.containers.filter(c => f && c.name.toLowerCase().includes(f)).map(c => ({ act: 'go', to: viewPath(`container:${c.id}`), label: c.name, ico: c.icon || KIND[c.kind].ico, sub: KIND[c.kind].one + (c.archived ? ' · archivé' : '') }));
            const notes = f ? (await get('/api/notes?' + new URLSearchParams({ view: 'all', q }))).slice(0, 12).map(n => ({ act: 'note', id: n.id, label: n.title, ico: '📄', sub: n.excerpt })) : S.list.slice(0, 6).map(n => ({ act: 'note', id: n.id, label: n.title, ico: '📄', sub: ago(n.updatedAt) }));
            if (!S.templates) S.templates = await get('/api/templates').catch(() => []);
            const tpls = S.templates.filter(t => !f || `modèle ${t.title}`.toLowerCase().includes(f)).map(t => ({ act: 'template', t, label: `Nouvelle note : ${t.title}`, ico: '🧩' }));
            const out = [];
            if (notes.length) out.push({ section: f ? 'Notes' : 'Récentes' }, ...notes);
            if (conts.length) out.push({ section: 'IPARA' }, ...conts);
            if (acts.length) out.push({ section: 'Actions' }, ...acts);
            if (tpls.length && f) out.push({ section: 'Modèles' }, ...tpls);
            if (f) out.push({ act: 'create', label: `Créer la note « ${q.trim()} »`, ico: '➕' });
            return out;
        },
        render: o => [h('span', { class: 'mi-ico' }, o.ico), h('div', {}, o.label, o.sub ? h('small', {}, o.sub) : null), o.hint ? h('span', { class: 'mi-hint' }, o.hint) : null],
        pick: (o, q) => {
            if (o.act === 'new') newNote();
            else if (o.act === 'template') newFromTemplate(o.t);
            else if (o.act === 'create') newNote({ body: `# ${q.trim()}\n\n` });
            else if (o.act === 'go') navigate(o.to);
            else if (o.act === 'note') navigate(viewPath(S.view === 'trash' ? 'all' : S.view, o.id));
            else if (o.act === 'container') editContainer({ kind: o.kind });
            else if (o.act === 'file' && S.note) fileNote(S.note.meta || S.note);
            else if (o.act === 'theme') toggleTheme();
            else if (o.act === 'focus') app.classList.toggle('focus-mode');
        }
    });
}

function toggleTheme() {
    const cur = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = cur;
    try { localStorage.setItem('pomodoro.theme', cur); } catch (e) { /* rien */ }
}
export { toggleTheme };

// ── Conteneurs IPARA : création / modification ──
function editContainer(c) {
    const isNew = !c.id;
    const data = { kind: 'project', icon: '', color: COLORS[0], name: '', description: '', due: '', areaId: '', ...c };
    const name = h('input', { value: data.name, placeholder: 'Nom' });
    const ico = h('input', { value: data.icon || '', placeholder: KIND[data.kind].ico, style: { width: '70px', textAlign: 'center', fontSize: '20px' }, maxlength: '4' });
    const kindSeg = h('div', { class: 'seg' });
    const due = h('input', { type: 'date', value: data.due || '' });
    const area = h('select', {}, h('option', { value: '' }, '— aucun —'), ...S.containers.filter(x => x.kind === 'area' && !x.archived).map(a => h('option', { value: a.id, selected: a.id === data.areaId }, `${a.icon || '🧭'} ${a.name}`)));
    const desc = h('textarea', { placeholder: 'Objectif, contexte… (facultatif)' }, data.description || '');
    const sw = h('div', { class: 'swatches' });
    const projOnly = h('div', { class: 'row' }, h('label', { class: 'field' }, h('span', {}, 'Échéance'), due), h('label', { class: 'field' }, h('span', {}, 'Domaine parent'), area));
    const drawKind = () => {
        kindSeg.replaceChildren(...Object.entries(KIND).map(([k, K]) => h('button', { class: data.kind === k ? 'is-on' : '', onclick: () => { data.kind = k; ico.placeholder = K.ico; drawKind(); } }, `${K.ico} ${K.one}`)));
        projOnly.hidden = data.kind !== 'project';
    };
    const drawSw = () => sw.replaceChildren(...COLORS.map(col => h('span', { class: `swatch ${data.color === col ? 'is-on' : ''}`, style: { background: col }, onclick: () => { data.color = col; drawSw(); } })));
    drawKind(); drawSw();
    const save = async () => {
        if (!name.value.trim()) { name.focus(); return; }
        const body = { kind: data.kind, name: name.value.trim(), icon: ico.value.trim(), color: data.color, description: desc.value.trim(), due: data.kind === 'project' ? due.value : '', areaId: data.kind === 'project' ? area.value || null : null };
        const r = isNew ? await post('/api/para', body) : await put(`/api/para/${c.id}`, body);
        m.close();
        await refreshCounts();
        if (isNew) navigate(viewPath(`container:${r.id}`));
    };
    name.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
    const foot = [];
    if (!isNew) {
        foot.push(h('button', { class: 'btn ghost left', onclick: async () => { await put(`/api/para/${c.id}`, { archived: !c.archived }); m.close(); toast(c.archived ? 'Sorti des archives' : 'Archivé avec ses notes 🗄️', 'ok'); refreshAll(); } }, c.archived ? '📤 Désarchiver' : '🗄️ Archiver'));
        foot.push(h('button', { class: 'btn ghost danger', onclick: async () => {
            if (!await confirmBox(`Supprimer « ${c.name} » ?`, 'Ses notes ne sont pas supprimées : elles retournent dans l’Inbox.', { ok: 'Supprimer', danger: true })) return;
            await del(`/api/para/${c.id}`); m.close(); navigate(viewPath('inbox')); refreshAll();
        } }, 'Supprimer'));
    }
    foot.push(h('button', { class: 'btn primary', onclick: save }, isNew ? 'Créer' : 'Enregistrer'));
    const m = modal({
        title: isNew ? `Nouveau ${KIND[data.kind].one.toLowerCase()}` : `Modifier ${c.name}`,
        body: [
            isNew ? h('div', { class: 'field' }, kindSeg) : null,
            h('div', { class: 'row' }, h('label', { class: 'field', style: { flex: '0' } }, h('span', {}, 'Icône'), ico), h('label', { class: 'field' }, h('span', {}, 'Nom'), name)),
            h('div', { class: 'field' }, h('span', {}, 'Couleur'), sw),
            projOnly,
            h('label', { class: 'field' }, h('span', {}, 'Description'), desc),
            h('p', { class: 'help', style: { margin: 0 } }, KIND[data.kind].help)
        ],
        foot
    });
}

// ── Éditeur ──
async function flushSave() {
    if (S.saveTimer) { clearTimeout(S.saveTimer); S.saveTimer = null; }
    if (S.dirty) await save();
}

async function openNote(id) {
    await flushSave();
    S.noteId = id;
    S.conflict = null;
    document.querySelectorAll('.note-card').forEach(c => c.classList.toggle('is-active', c.dataset.id === id));
    if (!id) { S.note = null; destroyEditor(); renderEditor(); return; }
    try { S.note = await get(`/api/notes/${id}`); }
    catch (e) { S.note = null; toast('Note introuvable', 'err'); }
    renderEditor();
}

function destroyEditor() { if (S.editor) { S.editor.destroy(); S.editor = null; } }

function setSaveState(txt) { const el = $('saveState'); if (el) el.textContent = txt; }

async function save() {
    if (!S.note || !S.editor) return;
    const body = S.editor.getValue();
    const id = S.note.id;
    S.dirty = false;
    setSaveState('Enregistrement…');
    try {
        const r = await put(`/api/notes/${id}`, { body, baseUpdatedAt: S.note.updatedAt });
        if (r.conflict) { S.conflict = r.note; S.dirty = true; renderBanner(); setSaveState('Conflit'); return; }
        if (S.note && S.note.id === id) { S.note.updatedAt = r.updatedAt; S.note.body = r.body; S.note.meta = r.meta; }
        const i = S.list.findIndex(n => n.id === id);
        if (i >= 0) { S.list[i] = r.meta; const old = document.querySelector(`.note-card[data-id="${id}"]`); if (old) old.replaceWith(noteCard(r.meta, !S.view.startsWith('container:'))); }
        setSaveState('Enregistré');
        renderMeta();
    } catch (e) {
        S.dirty = true;
        setSaveState('Hors ligne…');
        S.saveTimer = setTimeout(save, 3000);
    }
}

function renderToolbar() {
    const tb = document.querySelector('.ed-toolbar');
    if (!tb || !S.note) return;
    const n = S.note;
    const c = cont(n.container);
    const where = n.trashed ? '🗑️ Corbeille' : n.archived ? '🗄️ Archives' : c ? `${c.icon || KIND[c.kind].ico} ${c.name}` : '📥 Inbox';
    tb.replaceChildren(
        h('button', { class: 'icon-btn mobile-back', onclick: () => { flushSave(); setScreen('list'); history.pushState({}, '', viewPath(S.view)); S.noteId = null; }, 'aria-label': 'Retour' }, icon('back')),
        h('button', { class: 'icon-btn', title: 'Afficher/masquer la liste', onclick: () => app.classList.toggle('list-collapsed') }, icon('sidebar')),
        h('button', { class: 'chip-btn', title: `Ranger dans… (${modKey}⇧M)`, onclick: () => fileNote(n.meta || n) }, h('span', {}, where), '▾'),
        h('span', { class: 'spacer' }),
        h('span', { class: 'save-state', id: 'saveState' }),
        h('button', { class: `icon-btn ${n.pinned ? 'is-on' : ''}`, title: n.pinned ? 'Désépingler' : 'Épingler', onclick: () => togglePin(n) }, icon('pin')),
        h('button', { class: `icon-btn ${S.preview ? 'is-on' : ''}`, title: `Aperçu (${modKey}⇧P)`, onclick: togglePreview }, icon(S.preview ? 'edit' : 'eye')),
        h('button', { class: 'icon-btn', title: 'Historique des versions', onclick: () => showHistory(n.id) }, icon('history')),
        h('button', { class: 'icon-btn', title: 'Plus', onclick: e => noteMenu(e.currentTarget, { ...(n.meta || {}), ...n }) }, icon('more'))
    );
}

function renderMeta() {
    const el = document.querySelector('.ed-meta');
    if (!el || !S.note || !S.note.meta) return;
    const m = S.note.meta;
    const total = m.tasks.open + m.tasks.done;
    el.replaceChildren(...[
        h('span', { title: `Créée ${fullDate(S.note.createdAt)}` }, `Modifiée ${ago(S.note.updatedAt)}`),
        h('span', {}, '·'), h('span', {}, `${m.words} mot${m.words > 1 ? 's' : ''}`),
        total ? h('span', {}, '·') : null, total ? h('span', { class: 'pill mint' }, `☑ ${m.tasks.done}/${total}`) : null
    ].filter(Boolean));
}

function renderBanner() {
    const box = $('edBanner');
    if (!box) return;
    box.replaceChildren();
    if (S.note && S.note.trashed) {
        box.appendChild(h('div', { class: 'banner danger' }, '🗑️ Cette note est dans la corbeille.', h('span', { class: 'spacer' }),
            h('button', { class: 'btn small', onclick: () => moveNote(S.note.id, { trashed: false }) }, 'Restaurer'),
            h('button', { class: 'btn small danger', onclick: () => destroyNote(S.note) }, 'Supprimer')));
    }
    if (S.conflict) {
        box.appendChild(h('div', { class: 'banner' }, '⚠️ Cette note a été modifiée sur une autre machine pendant que tu écrivais.', h('span', { class: 'spacer' }),
            h('button', { class: 'btn small', onclick: () => { const other = S.conflict; S.conflict = null; S.dirty = false; S.note = other; renderEditor(); } }, 'Prendre l’autre version'),
            h('button', { class: 'btn small primary', onclick: async () => {
                const r = await put(`/api/notes/${S.note.id}`, { body: S.editor.getValue(), force: true });
                S.conflict = null; S.dirty = false; S.note.updatedAt = r.updatedAt; renderBanner(); setSaveState('Enregistré'); refreshAll();
            } }, 'Garder la mienne')));
    }
}

function renderEditor() {
    const pane = $('editorPane');
    destroyEditor();
    if (!S.note) {
        pane.replaceChildren(h('div', { class: 'ed-empty' }, h('div', {},
            h('div', { class: 'tomato', html: TOMATO }),
            h('h2', {}, 'Aucune note ouverte'),
            h('p', {}, 'Choisis une note à gauche, ou capture une idée : elle arrivera dans l’Inbox.'),
            h('button', { class: 'btn primary', onclick: () => newNote() }, icon('plus'), 'Nouvelle note'),
            h('p', { class: 'help', style: { marginTop: '22px' } },
                h('span', { class: 'kbd' }, `${modKey} K`), ' tout rechercher · ', h('span', { class: 'kbd' }, `${modKey} N`), ' nouvelle note · ', h('span', { class: 'kbd' }, `${modKey} ⇧ M`), ' ranger')
        )));
        return;
    }
    const n = S.note;
    const scroll = h('div', { class: 'ed-scroll' });
    pane.replaceChildren(h('div', { class: 'ed-toolbar' }), h('div', { id: 'edBanner' }), scroll);
    renderToolbar();
    renderBanner();
    scroll.appendChild(h('div', { class: 'ed-meta' }));
    renderMeta();
    if (S.preview) {
        const r = h('div', { class: 'md-render preview-pane', html: renderMarkdown(n.body) });
        wireRendered(r);
        scroll.appendChild(r);
    } else {
        const host = h('div', {});
        scroll.appendChild(host);
        S.editor = createEditor(host, {
            doc: n.body,
            placeholder: 'Un titre, puis tes idées… (#tag, [[lien]], - [ ] tâche)',
            onChange: () => {
                if (S.applyingRemote) return;
                S.dirty = true;
                setSaveState('Modifié');
                clearTimeout(S.saveTimer);
                S.saveTimer = setTimeout(() => { S.saveTimer = null; save(); }, 700);
            },
            onTagClick: tag => navigate(viewPath(`tag:${tag}`)),
            onWikiClick: title => openWiki(title),
            onSendTask: text => sendTask(text),
            upload: uploadFile,
            onError: e => toast(e.message, 'err'),
            complete: async (kind, q) => {
                if (kind === 'tag') return S.tags.map(t => t.tag).filter(t => t.startsWith(q.toLowerCase())).slice(0, 12);
                const list = await get('/api/notes?' + new URLSearchParams({ view: 'all', q: q || '' }));
                return list.filter(x => x.id !== S.noteId).slice(0, 12).map(x => x.title);
            }
        });
        if (n.trashed) S.editor.view.contentDOM.setAttribute('contenteditable', 'false');
    }
    loadBacklinks(scroll);
}

function wireRendered(root) {
    root.addEventListener('click', e => {
        const tag = e.target.closest('a.tag'); if (tag) { e.preventDefault(); navigate(viewPath(`tag:${tag.dataset.tag}`)); return; }
        const wiki = e.target.closest('a.wikilink'); if (wiki) { e.preventDefault(); openWiki(wiki.dataset.wiki); return; }
        const a = e.target.closest('a[href]'); if (a && /^https?:/.test(a.getAttribute('href'))) { e.preventDefault(); window.open(a.href, '_blank', 'noopener'); }
    });
}

async function loadBacklinks(scroll) {
    if (!S.note) return;
    const id = S.note.id;
    const links = await get(`/api/notes/${id}/backlinks`).catch(() => []);
    if (!S.note || S.note.id !== id || !links.length) return;
    scroll.appendChild(h('div', { class: 'backlinks' }, h('h4', {}, `Mentionnée dans ${links.length} note${links.length > 1 ? 's' : ''}`),
        ...links.map(l => h('button', { class: 'backlink', onclick: () => navigate(viewPath(S.view, l.id)) }, '📄 ', h('b', {}, l.title), h('small', {}, l.context.replace(/\[\[|\]\]/g, ''))))));
}

async function openWiki(title) {
    const r = await get('/api/resolve?title=' + encodeURIComponent(title));
    if (r.id) return navigate(viewPath(S.list.some(n => n.id === r.id) ? S.view : 'all', r.id));
    if (await confirmBox(`Créer « ${title} » ?`, 'Aucune note ne porte encore ce titre. Elle sera créée dans l’Inbox.', { ok: 'Créer la note' })) {
        await newNote({ body: `# ${title}\n\n`, container: null });
    }
}

async function sendTask(text) {
    if (!S.note) return;
    await flushSave();
    const r = await post(`/api/notes/${S.note.id}/send-task`, { text });
    if (r.ok) toast(`🎥 « ${text} » ajoutée à ta liste du stream`, 'ok'); else toast(r.error || 'Impossible d’envoyer', 'err');
}

function togglePreview() {
    if (S.editor && S.note) S.note.body = S.editor.getValue();
    S.preview = !S.preview;
    renderEditor();
}

async function showHistory(id) {
    await flushSave();
    const versions = await get(`/api/notes/${id}/history`);
    const preview = h('div', { class: 'history-preview' }, h('p', { class: 'help' }, versions.length ? 'Choisis une version à gauche.' : 'Pas encore d’historique : les versions sont enregistrées à chaque synchro (toutes les 30 s environ).'));
    let chosen = null;
    const restoreBtn = h('button', { class: 'btn primary', disabled: true, onclick: async () => {
        if (!chosen) return;
        const r = await put(`/api/notes/${id}`, { body: chosen, force: true });
        m.close();
        if (S.note && S.note.id === id) { S.note = { ...S.note, ...r }; renderEditor(); }
        toast('Version restaurée', 'ok');
        refreshAll();
    } }, 'Restaurer cette version');
    const list = h('div', { class: 'history-list' }, ...versions.map(v => {
        const b = h('button', { class: 'menu-item', onclick: async () => {
            list.querySelectorAll('.menu-item').forEach(x => x.classList.remove('is-sel'));
            b.classList.add('is-sel');
            const r = await get(`/api/notes/${id}/history/${v.sha}`);
            chosen = r.body;
            restoreBtn.disabled = false;
            const md = h('div', { class: 'md-render', html: renderMarkdown(r.body) });
            preview.replaceChildren(md);
        } }, h('div', {}, fullDate(v.at), h('small', { style: { display: 'block', color: 'var(--mu)', fontWeight: 600 } }, `${ago(v.at)} · ${v.author}`)));
        return b;
    }));
    const m = modal({ title: '🕘 Historique des versions', wide: true, body: h('div', { class: 'history-grid' }, list, preview), foot: [restoreBtn] });
}

// ── Temps réel ──
function fmt(ms) {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export { fmt };

on('notes', async ev => {
    refreshAll();
    // Note ouverte modifiée ailleurs (autre machine, !done du stream…).
    if (S.note && ev.id === S.note.id && (ev.updatedAt || 0) > (S.note.updatedAt || 0)) {
        if (ev.deleted) { toast('Cette note a été supprimée ailleurs', 'err'); return; }
        if (S.dirty || S.saveTimer) return;
        const fresh = await get(`/api/notes/${ev.id}`).catch(() => null);
        if (!fresh || !S.note || fresh.id !== S.note.id || S.dirty) return;
        const changed = S.editor && fresh.body !== S.editor.getValue();
        if (changed) { S.applyingRemote = true; S.editor.replaceAll(fresh.body); S.applyingRemote = false; }
        S.note = fresh;
        renderMeta();
        if (changed) toast(ev.source === 'sync' ? 'Note mise à jour depuis l’autre machine 🔄' : 'Note mise à jour 🔄');
    }
});
on('para', () => refreshAll());
on('sync', st => { if (S.server) { S.server.sync = st; renderSidebar(); } });
on('bot', st => { if (S.server) { S.server.bot = st; renderSidebar(); } });
on('settings', st => { if (S.server) S.server.settings = st; });
on('stream', snap => {
    const live = x => !!(x && x.timer && x.timer.phase !== 'done');
    const had = live(S.stream);
    S.stream = snap;
    if (had !== live(snap) && !S.wide) renderSidebar();
});
setInterval(() => {
    const t = S.stream && S.stream.timer;
    const el = $('sideTimer');
    if (el && t && t.phase !== 'done') el.textContent = fmt(t.paused ? t.remaining : Math.max(0, t.endsAt - Date.now()));
}, 1000);

// ── Raccourcis clavier ──
document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 'k' && !e.shiftKey) { e.preventDefault(); commandPalette(); }
    else if (k === 'n' && !e.shiftKey) { e.preventDefault(); newNote(); }
    else if (k === 'n' && e.shiftKey) { e.preventDefault(); templateMenu(document.querySelector('.capture-more') || { x: innerWidth / 2, y: 80, getBoundingClientRect: () => ({ left: innerWidth / 2, right: innerWidth / 2, top: 80, bottom: 80 }) }); }
    else if (k === 'p' && e.shiftKey) { e.preventDefault(); if (S.note) togglePreview(); }
    else if (k === 'm' && e.shiftKey) { e.preventDefault(); if (S.note) fileNote(S.note.meta || S.note); }
    else if (k === 'f' && e.shiftKey) { e.preventDefault(); app.classList.toggle('focus-mode'); }
    else if (k === 's') { e.preventDefault(); flushSave(); }
});
window.addEventListener('beforeunload', () => { if (S.dirty && S.note && S.editor) navigator.sendBeacon && fetch(`/api/notes/${S.note.id}`, { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: S.editor.getValue(), baseUpdatedAt: S.note.updatedAt }) }); });

// Glisser-déposer de fichiers .md depuis le Finder/Explorateur : import.
document.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files') && !e.target.closest('.cm-editor')) e.preventDefault(); });
document.addEventListener('drop', async e => {
    if (e.target.closest && e.target.closest('.cm-editor')) return;
    const files = [...(e.dataTransfer && e.dataTransfer.files || [])].filter(f => /\.(md|markdown|txt)$/i.test(f.name));
    if (!files.length) return;
    e.preventDefault();
    const payload = await Promise.all(files.map(async f => ({ name: f.name, content: await f.text() })));
    const r = await post('/api/import', { files: payload, container: S.view.startsWith('container:') ? S.view.slice(10) : null });
    toast(`${r.created} note${r.created > 1 ? 's' : ''} importée${r.created > 1 ? 's' : ''} 📥`, 'ok');
    refreshAll();
});

// ── Démarrage ──
(async function start() {
    connect();
    await refreshState();
    await refreshCounts();
    S.stream = await get('/api/stream').catch(() => null);
    if (isNarrow()) setScreen(location.pathname.match(/^\/v\/[^/]+\/[^/]+/) ? 'note' : 'side');
    await route();
    renderSidebar();
    setInterval(() => { if (!S.wide) renderSidebar(); }, 30000);
})();
