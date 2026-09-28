// Tableau de bord : toutes les cases à cocher ouvertes de toutes les notes,
// classées par échéance (📅 AAAA-MM-JJ ou @AAAA-MM-JJ dans la ligne).
import { get, post, put, on } from './api.js';
import { h, toast, debounce } from './ui.js';

const KIND_ICO = { project: '🎯', area: '🧭', resource: '📚' };
const V = { root: null, ctx: null, tasks: [], q: '', filter: 'all' };

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayIso = () => iso(new Date());
const plusDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
const fmtDue = s => {
    const d = new Date(s + 'T12:00:00');
    const diff = Math.round((new Date(s + 'T00:00:00') - new Date(todayIso() + 'T00:00:00')) / 86400000);
    if (diff === 0) return 'aujourd’hui';
    if (diff === 1) return 'demain';
    if (diff === -1) return 'hier';
    if (diff < 0) return `il y a ${-diff} j`;
    if (diff < 7) return d.toLocaleDateString('fr-FR', { weekday: 'long' });
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
};
// Affichage : on retire la syntaxe Markdown la plus courante.
const plain = s => String(s).replace(/\*\*|__|==|~~|`/g, '').replace(/\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

const reload = debounce(async () => { if (V.root && V.root.isConnected) { V.tasks = await get('/api/tasks'); draw(); } }, 300);
on('notes', () => reload());

export async function render(container, ctx) {
    V.ctx = ctx;
    V.root = h('div', { class: 'wide-inner' });
    container.replaceChildren(V.root);
    V.tasks = await get('/api/tasks');
    draw();
}

function groupOf(t) {
    if (!t.due) return 'none';
    const today = todayIso();
    if (t.due < today) return 'late';
    if (t.due === today) return 'today';
    if (t.due <= plusDays(7)) return 'week';
    return 'later';
}

async function toggle(t, row) {
    row.classList.add('is-leaving');
    try {
        await post('/api/tasks/toggle', { noteId: t.noteId, line: t.line, raw: t.raw, checked: true });
        V.tasks = V.tasks.filter(x => x !== t);
        setTimeout(draw, 250);
        toast(`✓ ${plain(t.text)}`, 'ok', { action: 'Annuler', onAction: async () => { await post('/api/tasks/toggle', { noteId: t.noteId, line: t.line, raw: t.raw, checked: false }); reload(); } });
    } catch (e) { row.classList.remove('is-leaving'); toast(e.message, 'err'); reload(); }
}

function taskRow(t) {
    const S = V.ctx.S;
    const c = S.containers.find(x => x.id === t.container);
    const g = groupOf(t);
    const row = h('div', { class: 'dash-task' });
    row.append(
        h('button', { class: 'dash-check', title: 'Terminer', onclick: () => toggle(t, row) }),
        h('div', { class: 'dash-body' },
            h('div', { class: 'dash-text' }, plain(t.text) || '(vide)'),
            h('div', { class: 'dash-meta' },
                t.due ? h('span', { class: `pill ${g === 'late' ? 'accent' : g === 'today' ? 'gold' : ''}` }, `📅 ${fmtDue(t.due)}`) : null,
                h('a', { href: '#', onclick: e => { e.preventDefault(); V.ctx.navigate(`/v/all/${t.noteId}`); } }, `📄 ${t.noteTitle}`),
                c ? h('span', {}, `${c.icon || KIND_ICO[c.kind]} ${c.name}`) : h('span', {}, '📥 Inbox')
            )
        ),
        h('button', { class: 'icon-btn dash-stream', title: 'Envoyer dans ma liste du stream', onclick: async () => {
            const r = await post(`/api/notes/${t.noteId}/send-task`, { text: t.raw });
            toast(r.ok ? `🎥 Ajoutée à ta liste du stream` : (r.error || 'Impossible'), r.ok ? 'ok' : 'err');
        } }, '🎥')
    );
    return row;
}

function draw() {
    const S = V.ctx.S;
    let list = V.tasks;
    if (V.q) { const q = V.q.toLowerCase(); list = list.filter(t => t.text.toLowerCase().includes(q) || t.noteTitle.toLowerCase().includes(q)); }
    if (V.filter === 'dated') list = list.filter(t => t.due);
    if (V.filter === 'projects') list = list.filter(t => { const c = S.containers.find(x => x.id === t.container); return c && c.kind === 'project'; });
    const groups = [
        ['late', '🔥 En retard'], ['today', '☀️ Aujourd’hui'], ['week', '🗓️ Les 7 prochains jours'], ['later', '🔭 Plus tard']
    ].map(([k, label]) => [label, list.filter(t => groupOf(t) === k).sort((a, b) => a.due.localeCompare(b.due))]).filter(([, l]) => l.length);

    // Sans date : regroupées par conteneur IPARA (Inbox d'abord, puis projets…)
    const undated = list.filter(t => !t.due);
    const byCont = new Map();
    for (const t of undated) { const k = t.container || ''; if (!byCont.has(k)) byCont.set(k, []); byCont.get(k).push(t); }
    const order = k => { if (!k) return '0'; const c = S.containers.find(x => x.id === k); return c ? ({ project: '1', area: '2', resource: '3' }[c.kind] || '4') + c.name : '9'; };

    const input = h('input', { class: 'input', placeholder: 'Nouvelle tâche… (ex. Appeler le garage demain)' });
    const date = h('input', { class: 'input', type: 'date', style: { width: '170px' } });
    const add = async () => {
        let text = input.value.trim();
        if (!text) return;
        let due = date.value;
        const m = text.match(/\s+(aujourd'?hui|aujourd’hui|demain|après-demain)$/i);
        if (!due && m) { due = plusDays(/après/i.test(m[1]) ? 2 : /demain/i.test(m[1]) ? 1 : 0); text = text.slice(0, m.index); }
        await addQuickTask(text + (due ? ` 📅 ${due}` : ''));
        input.value = ''; date.value = '';
        V.tasks = await get('/api/tasks'); draw();
        setTimeout(() => document.querySelector('.dash-add input')?.focus(), 50);
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
    const search = h('input', { class: 'input', type: 'search', placeholder: 'Filtrer…', value: V.q, style: { width: '200px' } });
    search.addEventListener('input', debounce(() => { V.q = search.value; draw(); document.querySelector('.dash-search')?.focus(); }, 200));
    search.className = 'input dash-search';

    const section = (title, items) => h('div', { class: 'card', style: { marginBottom: '14px' } }, h('h3', {}, title, h('small', {}, String(items.length))), ...items.map(taskRow));

    V.root.replaceChildren(
        h('div', { class: 'wide-head' }, h('h1', {}, '☑️ Tâches'),
            h('div', { class: 'seg' }, ...[['all', 'Toutes'], ['dated', 'Avec échéance'], ['projects', 'Projets']].map(([k, l]) => h('button', { class: V.filter === k ? 'is-on' : '', onclick: () => { V.filter = k; draw(); } }, l))),
            search),
        h('p', { class: 'help', style: { marginTop: '-8px' } }, `${V.tasks.length} case${V.tasks.length > 1 ? 's' : ''} à cocher dans tes notes. Ajoute une échéance en écrivant 📅 2026-10-02 (ou @2026-10-02) au bout d’une tâche.`),
        h('div', { class: 'card dash-add', style: { marginBottom: '16px' } }, h('div', { class: 'add-row', style: { marginTop: 0 } }, input, date, h('button', { class: 'btn primary', onclick: add }, 'Ajouter')),
            h('div', { class: 'help', style: { marginTop: '6px', fontSize: '12.5px' } }, 'Les tâches rapides vont dans la note « Tâches rapides » de l’Inbox — range-les ensuite pendant ta revue.')),
        ...(list.length ? [] : [h('div', { class: 'card', style: { textAlign: 'center', padding: '40px' } }, h('div', { style: { fontSize: '40px' } }, '🎉'), h('p', { class: 'help' }, 'Aucune tâche en attente.'))]),
        ...groups.map(([label, items]) => section(label, items)),
        ...[...byCont.keys()].sort((a, b) => order(a).localeCompare(order(b))).map(k => {
            const c = S.containers.find(x => x.id === k);
            return section(c ? `${c.icon || KIND_ICO[c.kind]} ${c.name}` : '📥 Inbox', byCont.get(k));
        })
    );
}

async function addQuickTask(line) {
    const r = await get('/api/resolve?title=' + encodeURIComponent('Tâches rapides'));
    if (r.id) {
        const n = await get(`/api/notes/${r.id}`);
        const body = n.body.replace(/\s*$/, '') + `\n- [ ] ${line}\n`;
        await put(`/api/notes/${r.id}`, { body, baseUpdatedAt: n.updatedAt, force: true });
    } else {
        await post('/api/notes', { body: `# Tâches rapides\n\n- [ ] ${line}\n`, container: null });
    }
}
