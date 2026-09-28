// Panneau « Stream » : pilotage de la liste de tâches du chat, du minuteur,
// de l'apparence des overlays OBS et du bot Twitch.
import { get, post, put, on } from './api.js';
import { h, icon, toast, confirmBox, ago, debounce } from './ui.js';

const TABS = [
    { id: 'live', label: '🎥 En direct' },
    { id: 'mine', label: '✍️ Mes tâches' },
    { id: 'timer', label: '🍅 Minuteur' },
    { id: 'overlay', label: '🖼️ Overlays OBS' },
    { id: 'commands', label: '💬 Commandes' },
    { id: 'bot', label: '🤖 Chat & bot' }
];

const V = { root: null, tab: 'live', snap: null, state: null, ctx: null, consoleLog: [], timerTick: null };

on('stream', snap => {
    V.snap = snap;
    if (!V.root || !V.root.isConnected) return;
    if (V.tab === 'live') drawLive();
    if (V.tab === 'mine') drawMine();
    if (V.tab === 'timer') drawTimer();
});
on('bot', st => { if (V.state) V.state.bot = st; if (V.root && V.root.isConnected && (V.tab === 'bot' || V.tab === 'live')) drawHeader(); });

const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); const hh = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return (hh ? hh + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };
const act = (op, body = {}) => post('/api/stream/action', { op, ...body }).then(r => { if (r && r.ok === false) toast(r.error || 'Action impossible', 'err'); return r; });

export async function render(container, ctx) {
    V.ctx = ctx;
    V.tab = TABS.some(t => t.id === ctx.tab) ? ctx.tab : 'live';
    [V.snap, V.state] = await Promise.all([get('/api/stream'), get('/api/state')]);
    V.root = h('div', { class: 'wide-inner' });
    container.replaceChildren(V.root);
    V.root.append(h('div', { class: 'wide-head', id: 'stHead' }), h('div', { class: 'tabs', id: 'stTabs' }), h('div', { id: 'stBody' }));
    drawHeader();
    drawTabs();
    drawBody();
    clearInterval(V.timerTick);
    V.timerTick = setInterval(() => {
        if (!V.root.isConnected) return clearInterval(V.timerTick);
        document.querySelectorAll('[data-countdown]').forEach(el => {
            const t = V.snap && V.snap.timer;
            if (el.dataset.countdown === 'main' && t) el.textContent = fmt(t.paused ? t.remaining : t.endsAt - Date.now());
        });
        if (V.tab === 'timer') updateRing();
    }, 500);
}

function drawHeader() {
    const head = document.getElementById('stHead');
    if (!head) return;
    const bot = V.state.bot || {};
    const cfg = V.state.config;
    let pill;
    if (!cfg.twitch.channel) pill = h('span', { class: 'pill gold' }, '⚠️ Chaîne Twitch non configurée');
    else if (bot.connected) pill = h('span', { class: 'pill mint' }, `● Connecté à #${bot.channel}${bot.anonymous ? ' (lecture seule)' : ''}`);
    else if (bot.mode === 'auto') pill = h('span', { class: 'pill' }, '○ En veille — se connecte quand OBS affiche un overlay');
    else if (bot.mode === 'off') pill = h('span', { class: 'pill' }, '○ Bot désactivé sur cette machine');
    else pill = h('span', { class: 'pill accent' }, `○ Déconnecté${bot.lastError ? ' — ' + bot.lastError : ''}`);
    head.replaceChildren(
        h('h1', {}, '🎥 Stream'),
        pill,
        h('button', { class: 'btn small', onclick: () => V.ctx.navigate('/stream/bot') }, 'Réglages du bot')
    );
}

function drawTabs() {
    const tabs = document.getElementById('stTabs');
    tabs.replaceChildren(...TABS.map(t => h('button', { class: `tab ${V.tab === t.id ? 'is-on' : ''}`, onclick: () => { V.tab = t.id; history.replaceState({}, '', '/stream/' + t.id); drawTabs(); drawBody(); } }, t.label)));
}

function drawBody() {
    const body = document.getElementById('stBody');
    body.replaceChildren();
    ({ live: drawLive, mine: drawMine, timer: drawTimer, overlay: drawOverlay, commands: drawCommands, bot: drawBot })[V.tab]();
}

// ── En direct ──
function taskRow(u, t, where, { draggable = false, index } = {}) {
    const actions = [];
    if (where === 'active') {
        actions.push(h('button', { title: 'Terminer', onclick: () => act('done', { login: u.login, taskId: t.id }) }, '✓'));
        actions.push(h('button', { title: 'Remettre dans le backlog', onclick: () => act('toBacklog', { login: u.login, taskId: t.id }) }, '↩'));
    } else if (where === 'backlog') {
        actions.push(h('button', { title: 'Commencer', onclick: () => act('activate', { login: u.login, taskId: t.id }) }, '▶'));
        actions.push(h('button', { title: 'Terminer', onclick: () => act('done', { login: u.login, taskId: t.id }) }, '✓'));
    } else if (where === 'done') {
        actions.push(h('button', { title: 'Annuler « terminé »', onclick: () => act('undone', { login: u.login, taskId: t.id }) }, '↺'));
        actions.push(h('button', { title: t.hidden ? 'Réafficher sur l’overlay' : 'Masquer de l’overlay', onclick: () => act('hide', { login: u.login, taskId: t.id }) }, t.hidden ? '👁' : '🙈'));
    }
    actions.push(h('button', { title: 'Renommer', onclick: () => rename(u, t) }, '✎'));
    actions.push(h('button', { title: 'Supprimer', onclick: () => act('remove', { login: u.login, taskId: t.id }) }, '🗑'));
    const row = h('div', { class: `task-row is-${where} ${t.hidden ? 'is-hidden' : ''}`, draggable: draggable ? 'true' : null },
        h('span', { class: 't-ico' }, where === 'active' ? '⚡' : where === 'done' ? '✓' : `${index + 1}.`),
        h('span', { class: 't-text' }, t.text, t.noteId ? h('span', { class: 'muted', title: 'Liée à une note' }, ' 📝') : null),
        h('span', { class: 't-actions' }, ...actions)
    );
    if (draggable) {
        row.addEventListener('dragstart', e => { e.dataTransfer.setData('text/task', JSON.stringify({ login: u.login, taskId: t.id })); });
        row.addEventListener('dragover', e => { e.preventDefault(); row.classList.add('drag-over'); });
        row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
        row.addEventListener('drop', e => {
            e.preventDefault(); row.classList.remove('drag-over');
            const d = JSON.parse(e.dataTransfer.getData('text/task') || '{}');
            if (d.login === u.login && d.taskId !== t.id) act('move', { login: u.login, taskId: d.taskId, toIndex: index });
        });
    }
    return row;
}

async function rename(u, t) {
    const { promptBox } = await import('./ui.js');
    const v = await promptBox('Renommer la tâche', { value: t.text, ok: 'Renommer' });
    if (v) act('rename', { login: u.login, taskId: t.id, text: v });
}

function drawLive() {
    const body = document.getElementById('stBody');
    if (!body) return;
    const s = V.snap;
    const focused = document.activeElement && body.contains(document.activeElement) ? document.activeElement : null;
    if (focused && focused.tagName === 'INPUT') return; // ne pas perdre la saisie en cours
    const stats = h('div', { class: 'grid-3', style: { marginBottom: '16px' } },
        h('div', { class: 'stat' }, h('b', {}, `${s.totals.done}/${s.totals.total}`), h('span', {}, 'Tâches faites ce stream')),
        h('div', { class: 'stat' }, h('b', {}, String(s.users.length)), h('span', {}, 'Personnes dans la liste')),
        h('div', { class: 'stat' }, h('b', {}, String(s.totals.allTime)), h('span', {}, 'Tâches depuis le début'))
    );
    const toolbar = h('div', { class: 'row', style: { marginBottom: '16px', flexWrap: 'wrap' } },
        h('button', { class: 'btn', onclick: async () => { if (await confirmBox('Nouvelle session ?', 'Les tâches terminées disparaissent de l’overlay (elles restent comptées dans les statistiques).', { ok: 'Nouvelle session' })) act('newSession'); } }, '✨ Nouvelle session'),
        h('button', { class: 'btn', onclick: () => act('overlayVisible', { visible: s.hidden }) }, s.hidden ? '👀 Afficher l’overlay' : '🙈 Masquer l’overlay'),
        h('span', { class: 'muted', style: { fontSize: '13px', fontWeight: 700 } }, `Session commencée ${ago(s.sessionStart)}`)
    );
    const cards = s.users.length ? h('div', { class: 'users-grid' }, ...s.users.map(userCard)) :
        h('div', { class: 'card', style: { textAlign: 'center', padding: '40px' } }, h('div', { style: { fontSize: '40px' } }, '🌙'), h('p', { class: 'help' }, 'Personne n’a encore de tâche pendant cette session. Dans le chat : !task <ma tâche>'));
    body.replaceChildren(stats, toolbar, h('div', { class: 'grid-2', style: { gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', alignItems: 'start' } }, cards, consoleCard()));
}

function userCard(u) {
    return h('div', { class: `ucard ${u.isStreamer ? 'is-streamer' : ''}` },
        h('div', { class: 'ucard-head' },
            h('span', { class: 'dot', style: { width: '10px', height: '10px', borderRadius: '50%', background: u.color } }),
            h('span', { class: 'ucard-name', style: { color: u.color } }, u.name),
            u.isStreamer ? h('span', { class: 'pill gold' }, 'hôte') : null,
            u.project ? h('span', { class: 'pill' }, `📁 ${u.project}`) : null,
            u.pomo && u.pomo.phase !== 'done' ? h('span', { class: `pill ${u.pomo.phase === 'work' ? 'accent' : 'mint'}` }, `🍅 ${fmt(u.pomo.paused ? u.pomo.remaining : u.pomo.endsAt - Date.now())}`) : null
        ),
        ...u.done.map(t => taskRow(u, t, 'done')),
        u.active ? taskRow(u, u.active, 'active') : null,
        u.backlogCount ? h('div', { class: 'muted', style: { fontSize: '12.5px', fontWeight: 700, padding: '4px 8px' } }, `+ ${u.backlogCount} dans le backlog`) : null,
        h('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } },
            h('button', { class: 'btn small ghost', onclick: () => { V.tab = 'mine'; V.mineLogin = u.login; drawTabs(); drawBody(); } }, 'Tout voir'),
            u.isStreamer ? null : h('button', { class: 'btn small ghost danger', onclick: async () => { if (await confirmBox(`Retirer ${u.name} ?`, 'Toutes ses tâches et son historique seront supprimés.', { ok: 'Retirer', danger: true })) act('removeUser', { login: u.login }); } }, 'Retirer'))
    );
}

// Console : tester les commandes comme si on les tapait dans le chat.
function consoleCard() {
    const log = h('div', { class: 'console-log', id: 'stConsole' });
    const drawLog = () => {
        log.replaceChildren(...(V.consoleLog.length ? V.consoleLog : [{ me: '', bot: ['Tape une commande (ex. !task Monter l’overlay) : elle est exécutée comme si tu l’écrivais dans le chat.'] }]).map(l => h('div', {}, l.me ? h('div', { class: 'me' }, `${l.who} : ${l.me}`) : null, ...l.bot.map(b => h('div', { class: 'bot' }, '↳ ' + b)))));
        log.scrollTop = log.scrollHeight;
    };
    drawLog();
    const who = h('input', { class: 'input', placeholder: V.snap.streamer || 'pseudo', value: V.consoleWho || '', style: { width: '120px' }, title: 'Pseudo (vide = toi, le streamer)' });
    const input = h('input', { class: 'input', placeholder: '!task …' });
    const send = h('input', { type: 'checkbox' });
    const run = async () => {
        const text = input.value.trim();
        if (!text) return;
        V.consoleWho = who.value.trim();
        const login = (V.consoleWho || V.snap.streamer || 'moi').toLowerCase();
        const r = await act('say', { login, displayName: V.consoleWho || undefined, text, sendToChat: send.checked });
        V.consoleLog.push({ who: V.consoleWho || 'toi', me: text, bot: (r.replies && r.replies.length ? r.replies : ['(pas de réponse)']) });
        V.consoleLog = V.consoleLog.slice(-40);
        input.value = '';
        drawLog();
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
    return h('div', { class: 'card' },
        h('h3', {}, '💬 Console de commandes'),
        log,
        h('div', { class: 'add-row' }, who, input, h('button', { class: 'btn primary', onclick: run }, 'Envoyer')),
        h('label', { class: 'switch', style: { borderBottom: 0 } }, h('span', { class: 'switch-text' }, h('small', {}, 'Publier aussi la réponse dans le chat Twitch')), send)
    );
}

// ── Mes tâches (ou celles d'un membre) ──
async function drawMine() {
    const body = document.getElementById('stBody');
    if (!body) return;
    if (document.activeElement && body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    const login = (V.mineLogin || V.snap.streamer || 'moi').toLowerCase();
    const u = await get(`/api/stream/users/${encodeURIComponent(login)}`);
    const cur = u.projects.find(p => p.id === u.currentProject) || u.projects[0];
    const users = await get('/api/stream/users');
    const who = h('select', { class: 'input', style: { width: 'auto' }, onchange: e => { V.mineLogin = e.target.value; drawMine(); } },
        ...[{ login: V.snap.streamer || 'moi', displayName: `${V.snap.streamer || 'moi'} (toi)` }, ...users.filter(x => x.login !== (V.snap.streamer || 'moi'))].map(x => h('option', { value: x.login, selected: x.login === login }, x.displayName)));
    const projTabs = h('div', { class: 'seg' }, ...u.projects.map(p => h('button', { class: p.id === cur.id ? 'is-on' : '', onclick: () => act('project', { login, action: 'switch', name: p.name }) }, `📁 ${p.name}`)),
        h('button', { title: 'Nouveau projet', onclick: async () => { const { promptBox } = await import('./ui.js'); const n = await promptBox('Nouveau projet de stream', { placeholder: 'Nom du projet' }); if (n) act('project', { login, action: 'switch', name: n }); } }, '+'));
    const input = h('input', { class: 'input', placeholder: 'Nouvelle tâche… (Entrée = backlog, Maj+Entrée = tout de suite)' });
    const add = where => { const t = input.value.trim(); if (!t) return; act('add', { login, text: t, where, projectId: cur.id }); input.value = ''; };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') add(e.shiftKey ? 'active' : 'backlog'); });
    const uu = { login };
    const start = V.snap.sessionStart;
    const doneToday = cur.done.filter(t => t.doneAt >= start).slice().reverse();
    body.replaceChildren(
        h('div', { class: 'row', style: { marginBottom: '14px', flexWrap: 'wrap' } }, who, projTabs,
            cur.id !== 'general' ? h('button', { class: 'btn small ghost danger', onclick: async () => { if (await confirmBox(`Supprimer le projet « ${cur.name} » ?`, 'Ses tâches seront supprimées.', { ok: 'Supprimer', danger: true })) act('project', { login, action: 'remove', projectId: cur.id }); } }, 'Supprimer ce projet') : null),
        h('div', { class: 'grid-2', style: { alignItems: 'start' } },
            h('div', { class: 'stack' },
                h('div', { class: 'card' }, h('h3', {}, '⚡ En cours'),
                    cur.active ? taskRow(uu, cur.active, 'active') : h('p', { class: 'help', style: { margin: '4px 8px' } }, 'Aucune tâche active.'),
                    h('div', { class: 'add-row' }, input, h('button', { class: 'btn', onclick: () => add('backlog') }, 'Backlog'), h('button', { class: 'btn primary', onclick: () => add('active') }, 'Maintenant'))),
                h('div', { class: 'card' }, h('h3', {}, '📋 Backlog', h('small', {}, `${cur.backlog.length} tâche${cur.backlog.length > 1 ? 's' : ''} · glisser pour réordonner`)),
                    ...(cur.backlog.length ? cur.backlog.map((t, i) => taskRow(uu, t, 'backlog', { draggable: true, index: i })) : [h('p', { class: 'help', style: { margin: '4px 8px' } }, 'Vide. Astuce : dans une note, survole une case à cocher et clique sur 🎥 pour l’envoyer ici.')]))
            ),
            h('div', { class: 'card' }, h('h3', {}, '✅ Terminées pendant ce stream', h('small', {}, `${u.totalDone || 0} au total`)),
                ...(doneToday.length ? doneToday.map(t => taskRow(uu, t, 'done')) : [h('p', { class: 'help', style: { margin: '4px 8px' } }, 'Rien pour l’instant — courage ! 💪')]))
        )
    );
}

// ── Minuteur ──
const PRESETS = [
    { label: 'Classique 25/5 × 4', work: 25, brk: 5, goal: 4 },
    { label: 'Long 50/10 × 4', work: 50, brk: 10, goal: 4 },
    { label: 'Deep work 90/15 × 2', work: 90, brk: 15, goal: 2 },
    { label: 'Sprint 15/3 × 6', work: 15, brk: 3, goal: 6 }
];

function drawTimer() {
    const body = document.getElementById('stBody');
    if (!body) return;
    if (document.activeElement && body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') { updateRing(); return; }
    const t = V.snap.timer;
    const ts = V.snap.timerSettings;
    const ring = h('div', { class: 'timer-ring', id: 'bigRing', html: `<svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" fill="none" stroke="var(--c4)" stroke-width="8"/><circle id="ringArc" cx="60" cy="60" r="52" fill="none" stroke="var(--accent)" stroke-width="8" stroke-linecap="round" stroke-dasharray="326.7" stroke-dashoffset="0"/></svg>` });
    ring.appendChild(h('div', { class: 't-center' }, h('div', { class: 't-phase', id: 'ringPhase' }), h('div', { class: 't-time', id: 'ringTime' }), h('div', { class: 't-cycles', id: 'ringCycles' })));
    const T = cmd => (extra = {}) => act('timer', { cmd, ...extra });
    const controls = t && t.phase !== 'done' ? h('div', { class: 'row', style: { flexWrap: 'wrap' } },
        h('button', { class: 'btn primary', onclick: () => T('toggle')() }, icon(t.paused ? 'play' : 'pause'), t.paused ? 'Reprendre' : 'Pause'),
        h('button', { class: 'btn', onclick: () => T('skip')() }, icon('skip'), 'Phase suivante'),
        h('button', { class: 'btn', onclick: () => T('adjust')({ minutes: -5 }) }, '−5 min'),
        h('button', { class: 'btn', onclick: () => T('adjust')({ minutes: 5 }) }, '+5 min'),
        h('button', { class: 'btn ghost danger', onclick: () => T('stop')() }, icon('stop'), 'Arrêter')
    ) : null;
    const w = h('input', { class: 'input', type: 'number', min: 1, max: 240, value: ts.defaultWork, style: { width: '80px' } });
    const b = h('input', { class: 'input', type: 'number', min: 0, max: 120, value: ts.defaultBreak, style: { width: '80px' } });
    const g = h('input', { class: 'input', type: 'number', min: 1, max: 24, value: ts.defaultGoal, style: { width: '80px' } });
    const l = h('input', { class: 'input', placeholder: 'Nom (facultatif) — ex. Écriture du script', value: (t && t.label) || '' });
    const startCustom = () => T('start')({ work: +w.value, brk: +b.value, goal: +g.value, label: l.value });
    body.replaceChildren(
        h('div', { class: 'grid-2', style: { alignItems: 'start' } },
            h('div', { class: 'card' },
                h('div', { class: 'timer-hero' }, ring, h('div', { class: 'stack', style: { flex: 1, minWidth: '220px' } },
                    h('div', {}, h('div', { style: { fontSize: '20px', fontWeight: 900 } }, t ? (t.label || 'Minuteur du stream') : 'Aucun minuteur en cours'),
                        h('div', { class: 'help' }, t ? `${t.work} min de focus · ${t.brk} min de pause · objectif ${t.goal}` : 'Lance un preset ou règle tes durées. Le chat voit tout sur l’overlay minuteur.')),
                    controls,
                    t ? h('div', { class: 'row' }, h('span', { class: 'help' }, 'Compteur :'),
                        h('button', { class: 'btn small', onclick: () => T('set')({ completed: Math.max(0, t.completed - 1) }) }, '−'),
                        h('b', {}, `${t.completed}/${t.goal}`),
                        h('button', { class: 'btn small', onclick: () => T('set')({ completed: t.completed + 1 }) }, '+'),
                        h('button', { class: 'btn small ghost', onclick: () => T('set')({ goal: t.goal + 1 }) }, 'objectif +1')) : null
                ))
            ),
            h('div', { class: 'card' }, h('h3', {}, '▶️ Lancer'),
                h('div', { class: 'preset-row' }, ...PRESETS.map(p => h('button', { class: 'btn', onclick: () => T('start')({ ...p, label: l.value }) }, p.label))),
                h('div', { class: 'row', style: { flexWrap: 'wrap', marginBottom: '10px' } },
                    h('label', { class: 'field', style: { margin: 0 } }, h('span', {}, 'Focus (min)'), w),
                    h('label', { class: 'field', style: { margin: 0 } }, h('span', {}, 'Pause (min)'), b),
                    h('label', { class: 'field', style: { margin: 0 } }, h('span', {}, 'Cycles'), g)),
                l,
                h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: startCustom }, icon('play'), 'Démarrer')),
                h('p', { class: 'help' }, 'Dans le chat (modos) : !timer 50/10/4 Écriture · !timer pause · !timer skip · !timer +5 · !timerpomo 1/4')
            )
        )
    );
    updateRing();
}

function updateRing() {
    const t = V.snap && V.snap.timer;
    const ts = V.snap && V.snap.timerSettings;
    const arc = document.getElementById('ringArc');
    if (!arc) return;
    const time = document.getElementById('ringTime'), phase = document.getElementById('ringPhase'), cycles = document.getElementById('ringCycles');
    if (!t) { time.textContent = '--:--'; phase.textContent = ts.idleLabel; arc.style.strokeDashoffset = 326.7; cycles.replaceChildren(); return; }
    const rem = t.phase === 'done' ? 0 : t.paused ? t.remaining : Math.max(0, t.endsAt - Date.now());
    const frac = t.phase === 'done' ? 1 : 1 - rem / (t.phaseDuration || 1);
    arc.style.strokeDashoffset = String(326.7 * (1 - frac));
    arc.style.stroke = t.phase === 'break' ? 'var(--mint)' : t.phase === 'done' ? 'var(--gold)' : 'var(--accent)';
    time.textContent = fmt(rem);
    phase.textContent = t.paused ? '⏸ en pause' : t.phase === 'work' ? ts.focusLabel : t.phase === 'break' ? ts.breakLabel : ts.doneLabel;
    phase.style.color = t.phase === 'break' ? 'var(--mint)' : t.phase === 'done' ? 'var(--gold)' : 'var(--accent)';
    if (cycles.childElementCount !== t.goal || cycles.dataset.c !== String(t.completed)) {
        cycles.dataset.c = t.completed;
        cycles.replaceChildren(...Array.from({ length: Math.min(t.goal, 12) }, (_, i) => h('i', { class: i < t.completed ? 'on' : '' })));
    }
}

// ── Overlays OBS ──
function drawOverlay() {
    const body = document.getElementById('stBody');
    const s = V.state.settings;
    const o = { ...s.overlay };
    const tm = { ...s.timer };
    const base = `http://localhost:${V.state.config.port}`;
    const saveO = debounce(async () => { const r = await put('/api/settings', { overlay: o, timer: tm }); V.state.settings = r; reloadFrames(); }, 400);
    const field = (label, key, type = 'text', attrs = {}, obj = o) => {
        const input = h('input', { type, value: obj[key], ...attrs });
        input.addEventListener('input', () => { obj[key] = type === 'number' || type === 'range' ? Number(input.value) : input.value; saveO(); });
        return h('label', { class: 'field' }, h('span', {}, label), input);
    };
    const toggle = (label, hint, key, obj = o) => {
        const input = h('input', { type: 'checkbox', checked: !!obj[key] });
        input.addEventListener('change', () => { obj[key] = input.checked; saveO(); });
        return h('label', { class: 'switch' }, h('span', { class: 'switch-text' }, h('b', {}, label), hint ? h('small', {}, hint) : null), input);
    };
    const tasksFrame = h('iframe', { src: '/overlay/tasks?preview=1', title: 'Aperçu overlay tâches' });
    const timerFrame = h('iframe', { src: '/overlay/timer?preview=1', title: 'Aperçu overlay minuteur' });
    const reloadFrames = () => { [tasksFrame, timerFrame].forEach(f => { try { f.contentWindow.postMessage({ type: 'reload-settings' }, '*'); } catch (e) { /* rien */ } }); };
    const frameBox = (frame, w, hgt, scale) => {
        frame.style.width = w + 'px'; frame.style.height = hgt + 'px'; frame.style.transform = `scale(${scale})`;
        return h('div', { class: 'preview-frame', style: { height: (hgt * scale) + 'px' } }, frame);
    };
    const urlLine = (label, url, size) => h('div', {}, h('div', { class: 'help', style: { margin: '10px 0 4px' } }, h('b', {}, label), ` — source navigateur OBS, ${size}`),
        h('div', { class: 'code-line' }, h('span', {}, url), h('button', { class: 'btn small', onclick: () => { navigator.clipboard.writeText(url); toast('Adresse copiée'); } }, icon('copy'), 'Copier')));
    body.replaceChildren(h('div', { class: 'grid-2', style: { alignItems: 'start' } },
        h('div', { class: 'stack' },
            h('div', { class: 'card' }, h('h3', {}, '🔗 Adresses pour OBS'),
                urlLine('Liste de tâches', `${base}/overlay/tasks`, `largeur ${o.width + 40} × hauteur ${o.maxHeight + 140}`),
                urlLine('Liste de tâches en 4K', `${base}/overlay/tasks?scale=2`, `largeur ${(o.width + 40) * 2} × hauteur ${(o.maxHeight + 140) * 2}`),
                urlLine('Minuteur', `${base}/overlay/timer`, '420 × 420 (ou ?style=bar : 900 × 120)'),
                urlLine('Minuteur en 4K', `${base}/overlay/timer?scale=2`, '840 × 840'),
                h('p', { class: 'help' }, 'Options d’URL : ?scale=2 (4K), ?user=pseudo (une seule personne), ?style=bar (minuteur en bandeau), ?sound=0 (sans son). Le bot se connecte automatiquement dès qu’OBS affiche un de ces overlays sur cette machine.')),
            h('div', { class: 'card' }, h('h3', {}, '📝 Liste de tâches'),
                field('Titre', 'title'), field('Sous-titre', 'subtitle'),
                h('div', { class: 'row' }, field('Largeur (px)', 'width', 'number', { min: 280, max: 1400 }), field('Hauteur max (px)', 'maxHeight', 'number', { min: 200, max: 2000 })),
                h('div', { class: 'row' }, field('Taille du texte', 'fontSize', 'number', { min: 12, max: 40 }), field('Vitesse de défilement (px/s)', 'scrollSpeed', 'number', { min: 5, max: 200 })),
                h('div', { class: 'row' }, field('Couleur d’accent', 'accent', 'color'), field('Opacité du fond', 'bgOpacity', 'range', { min: 0, max: 1, step: 0.05 })),
                h('div', { class: 'row' }, field('Tâches faites visibles par personne', 'maxDonePerUser', 'number', { min: 0, max: 50 }), field('Nouvelle session après (h d’inactivité)', 'autoNewSessionHours', 'number', { min: 0, max: 72 })),
                toggle('En-tête', 'Titre et compteur de tâches faites', 'showHeader'),
                toggle('Tâches terminées', 'Barrées sous le pseudo', 'showDone'),
                toggle('Nombre de tâches en attente', 'Le « +3 » du backlog', 'showBacklogCount'),
                toggle('Minuteurs individuels', 'Le petit pomodoro de chaque personne', 'showPomo'),
                toggle('Nom du projet', 'Quand quelqu’un n’est pas sur « Général »', 'showProject'),
                toggle('Toi en premier', 'Ta carte reste en haut de la liste', 'streamerFirst'),
                h('div', { class: 'row' }, field('Tâches à venir affichées sous la tienne', 'streamerNext', 'number', { min: 0, max: 10 })),
                toggle('Couleurs Twitch des pseudos', 'Sinon : palette du thème', 'useTwitchColors')),
            h('div', { class: 'card' }, h('h3', {}, '🍅 Minuteur'),
                h('div', { class: 'row' }, field('Libellé focus', 'focusLabel', 'text', {}, tm), field('Libellé pause', 'breakLabel', 'text', {}, tm)),
                h('div', { class: 'row' }, field('Libellé fin', 'doneLabel', 'text', {}, tm), field('Libellé au repos', 'idleLabel', 'text', {}, tm)),
                h('div', { class: 'row' }, field('Focus par défaut', 'defaultWork', 'number', {}, tm), field('Pause par défaut', 'defaultBreak', 'number', {}, tm), field('Cycles', 'defaultGoal', 'number', {}, tm)),
                toggle('Annonces dans le chat', 'Fin de focus, début de pause…', 'announce', tm),
                toggle('Son de fin de phase', 'Joué par l’overlay dans OBS', 'sound', tm))
        ),
        h('div', { class: 'stack', style: { position: 'sticky', top: '0' } },
            h('div', { class: 'card' }, h('h3', {}, 'Aperçu en direct'), frameBox(tasksFrame, o.width + 40, 620, Math.min(1, 480 / (o.width + 40)))),
            h('div', { class: 'card' }, frameBox(timerFrame, 420, 420, 0.8))
        )
    ));
}

// ── Commandes ──
const COMMANDS = [
    ['Tâches', [
        ['!task <tâche>', 'Crée ta tâche active (l’ancienne repasse en tête du backlog)'],
        ['!task', 'Affiche ta tâche actuelle'],
        ['!done', 'Termine la tâche active', 'fait'],
        ['!done next', 'Termine et enchaîne sur la suivante du backlog'],
        ['!done 2; 3', 'Termine plusieurs tâches (0 = active, 1+ = backlog)'],
        ['!done all', 'Termine tout'],
        ['!done <texte>', 'Enregistre directement une tâche faite'],
        ['!rename <texte>', 'Renomme la tâche active (!rename 2 <texte> pour le backlog)', 'renommer'],
        ['!remove', 'Supprime la tâche active (!remove 2, !remove all)', 'retirer'],
        ['!mytasks', 'Résumé : active, backlog, faites', 'mestaches'],
        ['!mydone', 'Nombre de tâches faites aujourd’hui et au total'],
        ['!ourdone', 'Total de la communauté'],
        ['!randomtask', 'Une petite tâche positive au hasard'],
        ['!clearold [n]', 'Retire tes tâches faites de l’overlay']
    ]],
    ['Backlog', [
        ['!later a; b; c', 'Ajoute à la fin du backlog', 'plustard'],
        ['!soon <tâche>', 'Ajoute en tête du backlog', 'bientot'],
        ['!backlog', 'Liste le backlog (!backlog clear pour vider)'],
        ['!now', 'Prend la tâche suivante du backlog', 'maintenant'],
        ['!now 2', 'Active la tâche n°2'],
        ['!now skip', 'Passe la tâche actuelle en fin de backlog'],
        ['!now raffle', 'Tire une tâche au hasard'],
        ['!display 2', 'Affiche le texte complet d’une tâche']
    ]],
    ['Projets', [
        ['!project <nom>', 'Crée ou bascule sur un projet', 'projet'],
        ['!project Nom: a; b', 'Crée un projet avec ses tâches'],
        ['!projects', 'Liste tes projets', 'projets'],
        ['!project rename <nom>', 'Renomme le projet actuel'],
        ['!project remove', 'Supprime le projet actuel'],
        ['!addto Nom: a; b', 'Ajoute à un autre projet sans basculer'],
        ['!getfrom <nom>', 'Ramène la prochaine tâche d’un autre projet'],
        ['!peek <nom>', 'Jette un œil à un projet'],
        ['!fullreset confirm', 'Efface tous tes projets et tâches']
    ]],
    ['Pomodoro perso', [
        ['!pomo 25 <nom>', 'Minuteur de 25 min'],
        ['!pomo 25/5/4 <nom>', 'Focus / pause / nombre de cycles'],
        ['!pomo', 'Où en est ton pomo'],
        ['!pomo pause · continue', 'Pause / reprise'],
        ['!pomo +5 · -5', 'Ajoute / retire des minutes'],
        ['!pomo rename · finish · cancel', 'Renomme / termine / annule'],
        ['!ask pomo @pseudo', 'Le pomo de quelqu’un']
    ]],
    ['Mémoire', [
        ['!remember pronoms iel', 'Clés : pronoms, pays, plat, animal, signe'],
        ['!ask pronoms @pseudo', 'Lire la valeur de quelqu’un (!ask task @pseudo aussi)'],
        ['!forget pronoms · all', 'Oublier'],
        ['!memory stats', 'Statistiques']
    ]],
    ['Streamer & modos', [
        ['!timer 50/10/4 <nom>', 'Lance le minuteur du stream', 'minuteur'],
        ['!timer pause · resume · skip · stop', 'Contrôle du minuteur'],
        ['!timer +5 · -5 · goal 6 · rename <nom>', 'Ajustements'],
        ['!timerpomo 1/4', 'Règle le compteur de pomodoros'],
        ['!note <idée>', 'Streamer : envoie une idée dans l’Inbox des notes'],
        ['!newsession', 'Nettoie les tâches faites de l’overlay'],
        ['!cleartasks @pseudo', 'Efface les tâches de quelqu’un'],
        ['!tasklock on · off', 'Réserve la liste aux modos'],
        ['!overlay hide · show', 'Masque / affiche l’overlay']
    ]],
    ['Aide', [
        ['!sweet', 'Aide courte (!sweet help, !sweet backlog, !sweet pomo)'],
        ['!sweetbacklog · !sweetpomo', 'Aides détaillées']
    ]]
];

function drawCommands() {
    const body = document.getElementById('stBody');
    const chat = { ...V.state.settings.chat };
    const save = debounce(async () => { V.state.settings = await put('/api/settings', { chat }); toast('Enregistré', 'ok', { ms: 1200 }); }, 400);
    const disabled = new Set(chat.disabledCommands || []);
    const toggle = (label, hint, key) => {
        const i = h('input', { type: 'checkbox', checked: !!chat[key] });
        i.addEventListener('change', () => { chat[key] = i.checked; save(); });
        return h('label', { class: 'switch' }, h('span', { class: 'switch-text' }, h('b', {}, label), h('small', {}, hint)), i);
    };
    const num = (label, key) => { const i = h('input', { type: 'number', value: chat[key] }); i.addEventListener('input', () => { chat[key] = Number(i.value); save(); }); return h('label', { class: 'field' }, h('span', {}, label), i); };
    const banned = h('textarea', { placeholder: 'un mot par ligne' }, (chat.bannedWords || []).join('\n'));
    banned.addEventListener('input', () => { chat.bannedWords = banned.value.split('\n').map(s => s.trim()).filter(Boolean); save(); });
    const cmdName = c => c.split(' ')[0].slice(1).toLowerCase();
    body.replaceChildren(h('div', { class: 'grid-2', style: { gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)', alignItems: 'start' } },
        h('div', { class: 'stack' }, ...COMMANDS.map(([group, cmds]) => h('div', { class: 'card' }, h('h3', {}, group),
            h('table', { class: 'cmd-table' }, h('tbody', {}, ...cmds.map(([c, d, alias]) => {
                const name = cmdName(c);
                const box = h('input', { type: 'checkbox', checked: !disabled.has(name), title: 'Activer / désactiver' });
                box.addEventListener('change', () => { if (box.checked) disabled.delete(name); else disabled.add(name); chat.disabledCommands = [...disabled]; save(); });
                return h('tr', {}, h('td', {}, h('code', {}, c), alias ? h('div', { class: 'muted', style: { fontSize: '12px', marginTop: '4px' } }, `alias : !${alias}`) : null), h('td', { class: 'help' }, d), h('td', { style: { width: '30px' } }, box));
            }))))),
        ),
        h('div', { class: 'stack', style: { position: 'sticky', top: '0' } },
            h('div', { class: 'card' }, h('h3', {}, '🛡️ Modération'),
                toggle('Commande activées', 'Coupe tout le module de tâches du chat', 'enabled'),
                toggle('Alias français', '!fait, !plustard, !bientot, !projet…', 'frenchAliases'),
                toggle('Bloquer les liens', 'Refuse les tâches contenant une adresse web', 'blockLinks'),
                toggle('Réservé aux modos', 'Équivaut à !tasklock on', 'viewersLocked'),
                h('div', { class: 'row', style: { marginTop: '10px' } }, num('Longueur max d’une tâche', 'maxTaskLength'), num('Backlog max', 'maxBacklog')),
                h('label', { class: 'field' }, h('span', {}, 'Mots interdits'), banned))
        )
    ));
}

// ── Chat & bot ──
function drawBot() {
    const body = document.getElementById('stBody');
    const cfg = V.state.config;
    const bot = V.state.bot || {};
    const channel = h('input', { value: cfg.twitch.channel || '', placeholder: 'emilae_tv' });
    const user = h('input', { value: cfg.twitch.botUsername || '', placeholder: 'emilaebot' });
    const token = h('input', { type: 'password', placeholder: cfg.twitch.hasToken ? '•••••••• (déjà enregistré — laisser vide pour le garder)' : 'oauth:xxxxxxxx', autocomplete: 'off' });
    let mode = cfg.bot.mode;
    const seg = h('div', { class: 'seg' });
    const drawSeg = () => seg.replaceChildren(...[['auto', 'Auto (OBS)'], ['on', 'Toujours'], ['off', 'Jamais']].map(([k, l]) => h('button', { class: mode === k ? 'is-on' : '', onclick: () => { mode = k; drawSeg(); } }, l)));
    drawSeg();
    const save = async () => {
        const patch = { twitch: { channel: channel.value, botUsername: user.value }, bot: { mode } };
        if (token.value.trim()) patch.twitch.botToken = token.value.trim();
        V.state = await put('/api/config', patch);
        toast('Réglages du bot enregistrés', 'ok');
        drawHeader(); drawBot();
    };
    body.replaceChildren(h('div', { class: 'grid-2', style: { alignItems: 'start' } },
        h('div', { class: 'card' }, h('h3', {}, '🤖 Connexion au chat Twitch', h('small', {}, `machine : ${cfg.machineName}`)),
            h('label', { class: 'field' }, h('span', {}, 'Chaîne'), channel),
            h('label', { class: 'field' }, h('span', {}, 'Compte du bot'), user, h('small', {}, 'Peut être ta propre chaîne ou un compte bot dédié. Sans jeton, le bot lit le chat mais ne répond pas.')),
            h('label', { class: 'field' }, h('span', {}, 'Jeton OAuth du bot'), token, h('small', {}, 'Jeton de chat (scopes chat:read et chat:edit), stocké uniquement dans config.json sur cette machine, jamais synchronisé.')),
            h('div', { class: 'field' }, h('span', {}, 'Quand connecter le bot sur CETTE machine ?'), seg,
                h('small', {}, 'Auto : seulement quand OBS affiche un overlay ici. Idéal si le PC et le Mac tournent en même temps : seul le poste qui diffuse répond au chat, sans doublon.')),
            cfg.twitch.hasToken ? h('button', { class: 'btn small ghost danger', onclick: async () => { V.state = await put('/api/config', { twitch: { clearToken: true } }); drawBot(); } }, 'Oublier le jeton') : null,
            h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: save }, 'Enregistrer'))
        ),
        h('div', { class: 'card' }, h('h3', {}, '📡 État'),
            h('table', { class: 'cmd-table' }, h('tbody', {},
                h('tr', {}, h('td', {}, 'Mode'), h('td', {}, bot.mode)),
                h('tr', {}, h('td', {}, 'Connexion souhaitée'), h('td', {}, bot.wanted ? 'oui' : 'non')),
                h('tr', {}, h('td', {}, 'Connecté'), h('td', {}, bot.connected ? `oui, #${bot.channel}` : 'non')),
                h('tr', {}, h('td', {}, 'Réponses dans le chat'), h('td', {}, bot.connected ? (bot.anonymous ? 'non (pas de jeton)' : 'oui') : '—')),
                h('tr', {}, h('td', {}, 'Dernier overlay OBS vu'), h('td', {}, bot.obsSeenAt ? ago(bot.obsSeenAt) : 'jamais')),
                bot.lastError ? h('tr', {}, h('td', {}, 'Dernière erreur'), h('td', { style: { color: 'var(--danger)' } }, bot.lastError)) : null
            )),
            h('p', { class: 'help' }, 'Le bot ne répond pas à ses propres messages ni aux commandes du bot principal du stream (!rs, !tache, !cmd…) : les deux peuvent tourner ensemble.'))
    ));
}
