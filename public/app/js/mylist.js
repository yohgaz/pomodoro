// Mes listes de tâches : « Stream » (la mienne, visible sur l'overlay comme
// celles du chat) et « Perso » (privée, jamais affichée en live). Même
// fonctionnement : une tâche en cours, un backlog réordonnable, les faites.
import { get, post } from './api.js';
import { h, toast, confirmBox, promptBox } from './ui.js';

export const PERSO = '_perso';

const act = (op, body = {}) => post('/api/stream/action', { op, ...body }).then(r => { if (r && r.ok === false) toast(r.error || 'Action impossible', 'err'); return r; });

// opts : { login, other: { login, label }, kind: 'stream' | 'perso', sessionStart, onChange }
export async function renderMyList(container, opts) {
    const { login, other, kind } = opts;
    const u = await get(`/api/stream/users/${encodeURIComponent(login)}`);
    const cur = u.projects.find(p => p.id === u.currentProject) || u.projects[0];
    const redraw = async () => { await renderMyList(container, opts); opts.onChange && opts.onChange(); };
    const run = async (op, body) => { await act(op, { login, ...body }); redraw(); };

    const row = (t, where, index) => {
        const actions = [];
        if (where === 'active') {
            actions.push(h('button', { title: 'Terminer', onclick: () => run('done', { taskId: t.id }) }, '✓'));
            actions.push(h('button', { title: 'Remettre en attente', onclick: () => run('toBacklog', { taskId: t.id }) }, '↩'));
        } else if (where === 'backlog') {
            actions.push(h('button', { title: 'Commencer maintenant', onclick: () => run('activate', { taskId: t.id }) }, '▶'));
            actions.push(h('button', { title: 'Terminer', onclick: () => run('done', { taskId: t.id }) }, '✓'));
        } else {
            actions.push(h('button', { title: 'Pas encore fait', onclick: () => run('undone', { taskId: t.id }) }, '↺'));
        }
        if (other && where !== 'done') actions.push(h('button', { title: `Déplacer vers ${other.label}`, onclick: async () => { await run('transfer', { taskId: t.id, toLogin: other.login }); toast(`Déplacée vers ${other.label}`, 'ok'); } }, other.login === PERSO ? '🏠' : '🎥'));
        actions.push(h('button', { title: 'Renommer', onclick: async () => { const v = await promptBox('Renommer la tâche', { value: t.text, ok: 'Renommer' }); if (v) run('rename', { taskId: t.id, text: v }); } }, '✎'));
        actions.push(h('button', { title: 'Supprimer', onclick: () => run('remove', { taskId: t.id }) }, '🗑'));
        const el = h('div', { class: `task-row is-${where}`, draggable: where === 'backlog' ? 'true' : null },
            h('span', { class: 't-ico' }, where === 'active' ? '⚡' : where === 'done' ? '✓' : `${index + 1}.`),
            h('span', { class: 't-text' }, t.text, t.noteId ? h('span', { class: 'muted', title: 'Liée à une note' }, ' 📝') : null),
            h('span', { class: 't-actions' }, ...actions));
        if (where === 'backlog') {
            el.addEventListener('dragstart', e => e.dataTransfer.setData('text/task', t.id));
            el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag-over'); });
            el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
            el.addEventListener('drop', e => {
                e.preventDefault(); el.classList.remove('drag-over');
                const id = e.dataTransfer.getData('text/task');
                if (id && id !== t.id) run('move', { taskId: id, toIndex: index });
            });
        }
        return el;
    };

    const input = h('input', { class: 'input', placeholder: kind === 'perso' ? 'Nouvelle tâche perso… (Entrée = à faire, Maj+Entrée = maintenant)' : 'Nouvelle tâche de stream… (Entrée = backlog, Maj+Entrée = maintenant)' });
    const add = async where => {
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        await act('add', { login, text, where, projectId: cur.id });
        await redraw();
        container.querySelector('input.input')?.focus();
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') add(e.shiftKey ? 'active' : 'backlog'); });

    // Faites : pendant la session de stream pour « Stream », aujourd'hui pour « Perso ».
    const since = kind === 'perso' ? new Date().setHours(0, 0, 0, 0) : (opts.sessionStart || 0);
    const done = cur.done.filter(t => t.doneAt >= since).slice().reverse();

    const projTabs = h('div', { class: 'seg' },
        ...u.projects.map(p => h('button', { class: p.id === cur.id ? 'is-on' : '', onclick: () => run('project', { action: 'switch', name: p.name }) }, `📁 ${p.name}`)),
        h('button', { title: 'Nouvelle liste', onclick: async () => { const n = await promptBox(kind === 'perso' ? 'Nouvelle liste perso' : 'Nouveau projet de stream', { placeholder: kind === 'perso' ? 'Maison, Administratif, Courses…' : 'Nom du projet' }); if (n) run('project', { action: 'switch', name: n }); } }, '+'));

    container.replaceChildren(
        h('div', { class: 'row', style: { marginBottom: '14px', flexWrap: 'wrap' } }, projTabs,
            cur.id !== 'general' ? h('button', { class: 'btn small ghost danger', onclick: async () => { if (await confirmBox(`Supprimer « ${cur.name} » ?`, 'Ses tâches seront supprimées.', { ok: 'Supprimer', danger: true })) run('project', { action: 'remove', projectId: cur.id }); } }, 'Supprimer cette liste') : null),
        h('div', { class: 'grid-2', style: { alignItems: 'start' } },
            h('div', { class: 'stack' },
                h('div', { class: 'card' }, h('h3', {}, '⚡ En cours'),
                    cur.active ? row(cur.active, 'active') : h('p', { class: 'help', style: { margin: '4px 8px' } }, 'Aucune tâche en cours.'),
                    h('div', { class: 'add-row' }, input, h('button', { class: 'btn', onclick: () => add('backlog') }, 'À faire'), h('button', { class: 'btn primary', onclick: () => add('active') }, 'Maintenant'))),
                h('div', { class: 'card' }, h('h3', {}, kind === 'perso' ? '📋 À faire' : '📋 Backlog', h('small', {}, `${cur.backlog.length} · glisser pour réordonner`)),
                    ...(cur.backlog.length ? cur.backlog.map((t, i) => row(t, 'backlog', i)) : [h('p', { class: 'help', style: { margin: '4px 8px' } }, kind === 'perso' ? 'Rien en attente 🌿' : 'Vide. Astuce : dans une note, survole une case à cocher et clique sur 🎥 pour l’envoyer ici.')]))
            ),
            h('div', { class: 'card' }, h('h3', {}, kind === 'perso' ? '✅ Faites aujourd’hui' : '✅ Faites pendant ce stream', h('small', {}, `${u.totalDone || 0} au total`)),
                ...(done.length ? done.map(t => row(t, 'done')) : [h('p', { class: 'help', style: { margin: '4px 8px' } }, 'Rien pour l’instant — courage ! 💪')]))
        )
    );
}
