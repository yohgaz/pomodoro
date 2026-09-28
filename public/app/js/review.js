// Revue hebdomadaire IPARA guidée (Tiago Forte) : vider l'Inbox, passer les
// projets en revue, jeter un œil aux domaines, traiter les tâches en retard.
import { get, post, put } from './api.js';
import { h, toast, ago } from './ui.js';

const KIND = { project: { one: 'Projet', ico: '🎯' }, area: { one: 'Domaine', ico: '🧭' }, resource: { one: 'Ressource', ico: '📚' } };
const STEPS = [
    { id: 'inbox', title: 'Vider l’Inbox', ico: '📥', help: 'Pour chaque note : range-la dans un projet, un domaine ou une ressource — ou archive-la, ou jette-la. Objectif : Inbox à zéro.' },
    { id: 'projects', title: 'Passer les projets en revue', ico: '🎯', help: 'Chaque projet a-t-il encore un sens ? A-t-il une prochaine action claire ? Un projet terminé part aux archives, avec ses notes.' },
    { id: 'areas', title: 'Jeter un œil aux domaines', ico: '🧭', help: 'Tes responsabilités continues. Quelque chose à lancer, un nouveau projet à créer ?' },
    { id: 'late', title: 'Tâches en retard', ico: '🔥', help: 'Fais-les, replanifie-les, ou supprime-les si elles n’ont plus lieu d’être.' },
    { id: 'done', title: 'Terminé', ico: '🎉' }
];
const V = { root: null, ctx: null, step: 0, data: null, tasks: [], handled: new Set() };

export async function render(container, ctx) {
    V.ctx = ctx;
    V.step = 0;
    V.handled = new Set();
    V.root = h('div', { class: 'wide-inner', style: { maxWidth: '900px' } });
    container.replaceChildren(V.root);
    await load();
    draw();
}

async function load() {
    [V.data, V.tasks] = await Promise.all([get('/api/review'), get('/api/tasks')]);
}

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

function draw() {
    const st = STEPS[V.step];
    const last = V.data.review.lastAt;
    V.root.replaceChildren(
        h('div', { class: 'wide-head' }, h('h1', {}, '🔁 Revue hebdomadaire'),
            h('span', { class: 'muted', style: { fontWeight: 700, fontSize: '13px' } }, last ? `Dernière revue ${ago(last)}` : 'Première revue')),
        h('div', { class: 'review-steps' }, ...STEPS.map((s, i) => h('button', {
            class: `review-step ${i === V.step ? 'is-on' : ''} ${i < V.step ? 'is-done' : ''}`,
            onclick: () => { V.step = i; draw(); }
        }, h('span', {}, i < V.step ? '✓' : s.ico), s.title))),
        st.help ? h('p', { class: 'help' }, st.help) : null,
        h('div', { id: 'reviewBody' }),
        h('div', { class: 'row', style: { justifyContent: 'space-between', marginTop: '20px' } },
            V.step > 0 ? h('button', { class: 'btn ghost', onclick: () => { V.step--; draw(); } }, '← Étape précédente') : h('span'),
            st.id !== 'done' ? h('button', { class: 'btn primary', onclick: async () => { await load(); V.step++; draw(); } }, V.step === STEPS.length - 2 ? 'Terminer la revue →' : 'Étape suivante →') : null)
    );
    const body = document.getElementById('reviewBody');
    ({ inbox: drawInbox, projects: drawProjects, areas: drawAreas, late: drawLate, done: drawDone })[st.id](body);
}

function containerSelect(onPick) {
    const S = V.ctx.S;
    const sel = h('select', { class: 'input', style: { width: 'auto', maxWidth: '220px' } },
        h('option', { value: '' }, '📁 Ranger dans…'),
        ...['project', 'area', 'resource'].map(k => h('optgroup', { label: KIND[k].one + 's' },
            ...S.containers.filter(c => c.kind === k && !c.archived).map(c => h('option', { value: c.id }, `${c.icon || KIND[k].ico} ${c.name}`)))));
    sel.addEventListener('change', () => { if (sel.value) onPick(sel.value); });
    return sel;
}

function drawInbox(body) {
    const items = V.data.inbox.filter(n => !V.handled.has(n.id));
    if (!items.length) {
        body.replaceChildren(h('div', { class: 'card', style: { textAlign: 'center', padding: '36px' } }, h('div', { style: { fontSize: '44px' } }, '🎉'), h('b', {}, 'Inbox à zéro !'), h('p', { class: 'help' }, 'Passe à l’étape suivante.')));
        return;
    }
    const done = id => { V.handled.add(id); drawInbox(body); V.ctx.refreshCounts && V.ctx.refreshCounts(); };
    body.replaceChildren(
        h('div', { class: 'muted', style: { fontWeight: 800, margin: '0 0 10px' } }, `${items.length} note${items.length > 1 ? 's' : ''} à trier`),
        ...items.map(n => h('div', { class: 'card review-item' },
            h('div', { class: 'review-item-main' },
                h('a', { href: '#', class: 'review-title', onclick: e => { e.preventDefault(); V.ctx.navigate(`/v/inbox/${n.id}`); } }, n.title),
                n.excerpt ? h('div', { class: 'help', style: { margin: '4px 0 0', fontSize: '13px' } }, n.excerpt) : null,
                h('div', { class: 'muted', style: { fontSize: '12px', fontWeight: 700, marginTop: '6px' } }, `Capturée ${ago(n.createdAt)}`)),
            h('div', { class: 'review-actions' },
                containerSelect(async cid => { await put(`/api/notes/${n.id}`, { container: cid, archived: false }); toast('Rangée ✓', 'ok'); done(n.id); }),
                h('button', { class: 'btn small', title: 'Archiver', onclick: async () => { await put(`/api/notes/${n.id}`, { archived: true }); done(n.id); } }, '🗄️'),
                h('button', { class: 'btn small', title: 'Corbeille', onclick: async () => { await put(`/api/notes/${n.id}`, { trashed: true }); done(n.id); } }, '🗑️'),
                h('button', { class: 'btn small ghost', title: 'Garder dans l’Inbox pour l’instant', onclick: () => done(n.id) }, 'Plus tard'))
        ))
    );
}

function containerCard(c, actions) {
    const s = c.stats;
    const total = s.open + s.done;
    const stale = s.lastActivity && Date.now() - s.lastActivity > 21 * 86400000;
    let dueTxt = null;
    if (c.due) {
        const days = Math.ceil((new Date(c.due + 'T23:59:59') - Date.now()) / 86400000);
        dueTxt = h('span', { class: `pill ${days < 0 ? 'accent' : days <= 7 ? 'gold' : ''}` }, days < 0 ? `en retard de ${-days} j` : `échéance dans ${days} j`);
    }
    return h('div', { class: 'card review-item' },
        h('div', { class: 'review-item-main' },
            h('a', { href: '#', class: 'review-title', onclick: e => { e.preventDefault(); V.ctx.navigate(`/v/${encodeURIComponent('container:' + c.id)}`); } }, `${c.icon || KIND[c.kind].ico} ${c.name}`),
            h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap', marginTop: '6px' } },
                h('span', { class: 'pill' }, `${s.notes} note${s.notes > 1 ? 's' : ''}`),
                total ? h('span', { class: 'pill mint' }, `☑ ${s.done}/${total}`) : h('span', { class: 'pill' }, 'aucune tâche'),
                dueTxt,
                h('span', { class: `pill ${stale ? 'accent' : ''}` }, s.lastActivity ? `activité ${ago(s.lastActivity)}` : 'jamais touché')),
            c.kind === 'project' && !s.open ? h('div', { class: 'help', style: { fontSize: '13px', margin: '8px 0 0' } }, '⚠️ Aucune prochaine action : ajoute une case à cocher, ou archive-le s’il est terminé.') : null,
            total ? h('div', { class: 'cont-progress' }, h('b', { style: { width: `${Math.round(s.done * 100 / total)}%` } })) : null),
        h('div', { class: 'review-actions' }, ...actions));
}

function drawProjects(body) {
    const list = V.data.projects.filter(c => !V.handled.has(c.id));
    if (!V.data.projects.length) { body.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'help', style: { margin: 0 } }, 'Aucun projet actif. Un projet = un objectif avec une échéance : crée-en un avec le + à côté de « Projets ».'))); return; }
    body.replaceChildren(...list.map(c => containerCard(c, [
        h('button', { class: 'btn small', onclick: () => { V.handled.add(c.id); drawProjects(body); } }, '✓ Toujours actif'),
        h('button', { class: 'btn small', onclick: async () => { await put(`/api/para/${c.id}`, { archived: true }); toast(`🏁 ${c.name} archivé avec ses notes`, 'ok'); V.handled.add(c.id); drawProjects(body); } }, '🏁 Terminé')
    ])), list.length ? '' : h('div', { class: 'card', style: { textAlign: 'center' } }, h('p', { class: 'help', style: { margin: 0 } }, '✓ Tous les projets sont passés en revue.')));
}

function drawAreas(body) {
    if (!V.data.areas.length) { body.replaceChildren(h('div', { class: 'card' }, h('p', { class: 'help', style: { margin: 0 } }, 'Aucun domaine. Exemples : Stream, Santé, Maison, Finances.'))); return; }
    body.replaceChildren(...V.data.areas.map(c => containerCard(c, [
        h('button', { class: 'btn small', onclick: () => V.ctx.navigate(`/v/${encodeURIComponent('container:' + c.id)}`) }, 'Ouvrir')
    ])));
}

function drawLate(body) {
    const late = V.tasks.filter(t => t.due && t.due < today());
    if (!late.length) { body.replaceChildren(h('div', { class: 'card', style: { textAlign: 'center', padding: '30px' } }, h('div', { style: { fontSize: '40px' } }, '👌'), h('p', { class: 'help' }, 'Aucune tâche en retard.'))); return; }
    body.replaceChildren(h('div', { class: 'card' }, ...late.map(t => {
        const row = h('div', { class: 'dash-task' });
        const date = h('input', { class: 'input', type: 'date', value: t.due, style: { width: '160px' } });
        date.addEventListener('change', async () => {
            const n = await get(`/api/notes/${t.noteId}`);
            const lines = n.body.split('\n');
            const i = lines[t.line] && lines[t.line].includes(t.raw) ? t.line : lines.findIndex(l => l.includes(t.raw));
            if (i < 0) return toast('Tâche introuvable', 'err');
            lines[i] = lines[i].replace(/(📅|@)\s?\d{4}-\d{2}-\d{2}/, `📅 ${date.value}`);
            await put(`/api/notes/${t.noteId}`, { body: lines.join('\n'), force: true });
            toast('Replanifiée 📅', 'ok');
            V.tasks = await get('/api/tasks'); drawLate(body);
        });
        row.append(
            h('button', { class: 'dash-check', onclick: async () => { await post('/api/tasks/toggle', { noteId: t.noteId, line: t.line, raw: t.raw, checked: true }); V.tasks = V.tasks.filter(x => x !== t); drawLate(body); } }),
            h('div', { class: 'dash-body' }, h('div', { class: 'dash-text' }, t.text), h('div', { class: 'dash-meta' }, h('span', { class: 'pill accent' }, `📅 ${t.due}`), h('span', {}, `📄 ${t.noteTitle}`))),
            date);
        return row;
    })));
}

async function drawDone(body) {
    const r = await post('/api/review/done');
    V.data.review = r;
    V.ctx.refreshState && V.ctx.refreshState();
    body.replaceChildren(h('div', { class: 'card', style: { textAlign: 'center', padding: '40px' } },
        h('div', { style: { fontSize: '56px' } }, '🎉'),
        h('h2', { style: { margin: '8px 0' } }, 'Revue terminée !'),
        h('p', { class: 'help' }, 'Ton système est à jour. Prochaine revue dans une semaine — la barre latérale te le rappellera.'),
        h('button', { class: 'btn primary', onclick: () => V.ctx.navigate('/tasks') }, '☑️ Voir mes tâches')));
}
