// Moteur de la liste de tâches du stream — reprise complète des commandes de
// Super Sweet Bot (tâches, backlog, projets, pomodoros individuels, mémoire,
// statistiques) + minuteur principal du streamer. Indépendant de Twitch :
// il reçoit un message et renvoie les réponses à écrire dans le chat, ce qui
// permet aussi de le piloter depuis l'espace web (console de test).
const EventEmitter = require('events');
const P = require('./pomo');
const { newId, safeId } = require('./store');
const { DEFAULT_SETTINGS, DEFAULT_META, withDefaults } = require('./defaults');
const { commandsFor } = require('./commands-list');

const META = 'stream/meta.json';
const SETTINGS = 'settings.json';

const FR_ALIASES = {
    fait: 'done', fini: 'done', tache: null,
    plustard: 'later', bientot: 'soon', 'bientôt': 'soon',
    maintenant: 'now', renommer: 'rename', retirer: 'remove', supprimer: 'remove',
    projet: 'project', projets: 'projects', mestaches: 'mytasks', 'mestâches': 'mytasks',
    minuteur: 'timer', afficher: 'display'
};

const MEMORY_KEYS = {
    pronouns: 'pronoms', pronoms: 'pronoms',
    country: 'pays', pays: 'pays',
    food: 'plat', plat: 'plat', nourriture: 'plat',
    pet: 'animal', animal: 'animal',
    astrology: 'signe', signe: 'signe', astro: 'signe'
};

const RANDOM_TASKS = [
    'Boire un grand verre d’eau 💧', 'S’étirer pendant 2 minutes 🧘', 'Ranger une chose sur son bureau 🗂️',
    'Prendre 5 grandes respirations 🌬️', 'Ouvrir la fenêtre pour aérer 🪟', 'Envoyer un message gentil à quelqu’un 💌',
    'Se lever et marcher un peu 🚶', 'Noter une chose dont on est fier·e ✨', 'Détendre ses épaules 💆',
    'Regarder au loin 20 secondes 👀', 'Prendre un fruit 🍎', 'Vider sa corbeille / ses téléchargements 🧹',
    'Écrire la prochaine petite étape de son projet 📝', 'Sourire, c’est gratuit 😄', 'Se servir un thé ou un café ☕'
];

const USER_COLORS = ['#F0653D', '#6FDA9A', '#E8B84D', '#7AB8FF', '#C792EA', '#FF8FB1', '#5FD4D4', '#FFB86B', '#A0E57A', '#F4F2ED'];

function hashColor(login) {
    let h = 0;
    for (const c of login) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return USER_COLORS[h % USER_COLORS.length];
}

const splitList = s => String(s || '').split(';').map(x => x.trim()).filter(Boolean);
const isNumList = s => /^\s*\d+(\s*[;,]\s*\d+)*\s*$/.test(s);
const nums = s => String(s).split(/[;,]/).map(x => parseInt(x.trim(), 10)).filter(n => !isNaN(n));
const q = t => `« ${t} »`;
const plural = (n, w, pl) => `${n} ${n > 1 ? (pl || w + 's') : w}`;

class StreamEngine extends EventEmitter {
    constructor({ store, getConfig, onTaskDone, onNote }) {
        super();
        this.store = store;
        this.getConfig = getConfig;
        this.onTaskDone = onTaskDone || (() => {});
        this.onNote = onNote || null;
        this.tickTimer = null;
    }

    // ── Accès aux données ──
    settings() { return withDefaults(this.store.getDoc(SETTINGS, {}), DEFAULT_SETTINGS); }
    saveSettings(patch) {
        const cur = this.store.getDoc(SETTINGS, {});
        const merged = withDefaults(patch, withDefaults(cur, DEFAULT_SETTINGS));
        this.store.putDoc(SETTINGS, merged);
        this.changed();
        return merged;
    }
    meta() { return this.store.getDoc(META, DEFAULT_META); }
    saveMeta() { this.store.putDoc(META, this.meta()); }
    streamerLogin() { return (this.getConfig().twitch.channel || '').toLowerCase().replace(/^#/, ''); }

    changed() { this.emit('changed'); }

    getUser(login, info = {}, create = true) {
        const id = safeId(login);
        let u = this.store.get('users', id);
        if (!u && !create) return null;
        if (!u) {
            u = {
                id, login: login.toLowerCase(), displayName: info.displayName || login, color: info.color || null,
                projects: [{ id: 'general', name: 'Général', active: null, backlog: [], done: [] }],
                currentProject: 'general', totalDone: 0, memory: {}, pomo: null, sessionFirstAt: null
            };
        }
        if (info.displayName) u.displayName = info.displayName;
        if (info.color) u.color = info.color;
        return u;
    }
    saveUser(u) { this.store.put('users', u); this.changed(); }

    proj(u) {
        let p = u.projects.find(x => x.id === u.currentProject);
        if (!p) { p = u.projects[0]; u.currentProject = p.id; }
        return p;
    }
    findProject(u, name) {
        const n = name.trim().toLowerCase();
        return u.projects.find(p => p.name.toLowerCase() === n) || null;
    }
    ensureProject(u, name) {
        let p = this.findProject(u, name);
        if (!p) {
            p = { id: newId(), name: name.trim().slice(0, 40), active: null, backlog: [], done: [] };
            u.projects.push(p);
        }
        return p;
    }

    touchSession(u) {
        const m = this.meta();
        const s = this.settings();
        const now = Date.now();
        const idleH = Number(s.overlay.autoNewSessionHours) || 0;
        if (idleH > 0 && now - (m.lastActivity || 0) > idleH * 3600 * 1000) {
            m.sessionStart = now;
        }
        m.lastActivity = now;
        this.saveMeta();
        if (u && (!u.sessionFirstAt || u.sessionFirstAt < m.sessionStart)) u.sessionFirstAt = now;
    }

    sessionDone(u) {
        const start = this.meta().sessionStart || 0;
        let n = 0;
        for (const p of u.projects) n += p.done.filter(t => t.doneAt >= start).length;
        return n;
    }

    // Nettoie le texte d'une tâche. Renvoie { text } ou { error }.
    clean(text) {
        const s = this.settings().chat;
        let t = String(text || '').replace(/\s+/g, ' ').trim();
        if (!t) return { error: 'la tâche est vide' };
        if (s.blockLinks && /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|fr|net|org|io|gg|tv|ly|be)\b)/i.test(t)) return { error: 'les liens ne sont pas autorisés dans les tâches' };
        const low = t.toLowerCase();
        if ((s.bannedWords || []).some(w => w && low.includes(String(w).toLowerCase()))) return { error: 'cette tâche contient un mot interdit' };
        const max = Number(s.maxTaskLength) || 120;
        if (t.length > max) t = t.slice(0, max - 1) + '…';
        return { text: t };
    }

    newTask(text, extra = {}) { return { id: newId(), text, createdAt: Date.now(), ...extra }; }

    completeTask(u, p, task) {
        task.doneAt = Date.now();
        p.done.push(task);
        if (p.done.length > 200) p.done.splice(0, p.done.length - 200);
        u.totalDone = (u.totalDone || 0) + 1;
        const m = this.meta();
        m.allTimeDone = (m.allTimeDone || 0) + 1;
        this.saveMeta();
        if (task.noteId) {
            try { this.onTaskDone(task); } catch (e) { console.error('Lien page', e.message); }
        }
    }

    // ── Point d'entrée : un message du chat ──
    // user = { login, displayName, color, isMod, isBroadcaster }
    // Renvoie un tableau de réponses (chaînes) à écrire dans le chat.
    handle(user, text) {
        const s = this.settings();
        if (!s.chat.enabled) return [];
        const m = String(text || '').trim().match(/^!([^\s]+)\s*([\s\S]*)$/);
        if (!m) return [];
        let cmd = m[1].toLowerCase();
        const rest = m[2].trim();
        if (s.chat.frenchAliases && FR_ALIASES[cmd]) cmd = FR_ALIASES[cmd];
        if ((s.chat.disabledCommands || []).includes(cmd)) return [];
        const login = (user.login || '').toLowerCase();
        const isStreamer = user.isBroadcaster || login === this.streamerLogin();
        const isMod = isStreamer || !!user.isMod;
        const ctx = { ...user, login, isStreamer, isMod, name: user.displayName || user.login };
        const handler = this.commands[cmd];
        if (!handler) return [];
        const modOnly = ['note', 'timer', 'timerpomo', 'newsession', 'tasksreset', 'cleartasks', 'tasklock', 'overlay'];
        if (modOnly.includes(cmd) && !isMod) return [];
        const viewerLockExempt = ['sweet', 'sweetbacklog', 'sweetpomo', 'ourdone'];
        if (s.chat.viewersLocked && !isMod && !viewerLockExempt.includes(cmd) && !modOnly.includes(cmd)) {
            return [`@${ctx.name} la liste de tâches est en pause pour le moment 🔒`];
        }
        let out;
        try { out = handler.call(this, ctx, rest); }
        catch (e) { console.error('Commande', cmd, e); out = `oups, erreur interne (${e.message})`; }
        if (!out) return [];
        const list = Array.isArray(out) ? out : [out];
        return list.filter(Boolean).map(r => this.fit(r.startsWith('!raw ') ? r.slice(5) : `@${ctx.name} ${r}`));
    }

    fit(msg) { return msg.length > 490 ? msg.slice(0, 488) + '…' : msg; }

    // Accès utilisateur + session pour une commande de tâche.
    u(ctx) {
        const u = this.getUser(ctx.login, { displayName: ctx.displayName, color: ctx.color });
        return u;
    }

    addToBacklog(u, p, texts, front = false) {
        const max = Number(this.settings().chat.maxBacklog) || 30;
        const added = [];
        const errors = [];
        for (const raw of texts) {
            const c = this.clean(raw);
            if (c.error) { errors.push(c.error); continue; }
            if (p.backlog.length >= max) { errors.push(`ton backlog est plein (${max} max)`); break; }
            const t = this.newTask(c.text);
            added.push(t);
        }
        if (front) p.backlog.unshift(...added); else p.backlog.push(...added);
        return { added, errors };
    }

    setActive(u, p, task) {
        if (p.active) p.backlog.unshift(p.active);
        task.startedAt = Date.now();
        p.active = task;
    }

    listBacklog(p) {
        if (!p.backlog.length) return 'ton backlog est vide 📭';
        const parts = p.backlog.map((t, i) => `${i + 1}. ${t.text}`);
        let msg = `📋 backlog${p.id === 'general' ? '' : ` (${p.name})`} : `;
        for (let i = 0; i < parts.length; i++) {
            if ((msg + parts[i]).length > 440) { msg += ` … (+${parts.length - i})`; break; }
            msg += (i ? ' | ' : '') + parts[i];
        }
        return msg;
    }

    // "Projet: 1; 2" → { project, list }
    projectPrefix(u, rest) {
        const m = rest.match(/^([^:;]{1,40}):\s*(.*)$/);
        if (!m) return null;
        const p = this.findProject(u, m[1]);
        return { name: m[1].trim(), p, rest: m[2].trim() };
    }

    doneByIndexes(u, p, idx) {
        const done = [];
        const bl = [...p.backlog];
        const removeIds = new Set();
        for (const i of [...new Set(idx)].sort((a, b) => a - b)) {
            if (i === 0 && p.active) { done.push(p.active); }
            else if (i >= 1 && i <= bl.length) { done.push(bl[i - 1]); removeIds.add(bl[i - 1].id); }
        }
        if (done.includes(p.active)) p.active = null;
        p.backlog = p.backlog.filter(t => !removeIds.has(t.id));
        for (const t of done) this.completeTask(u, p, t);
        return done;
    }

    removeByIndexes(p, idx) {
        const bl = [...p.backlog];
        const removed = [];
        const removeIds = new Set();
        for (const i of new Set(idx)) {
            if (i === 0 && p.active) { removed.push(p.active); p.active = null; }
            else if (i >= 1 && i <= bl.length) { removed.push(bl[i - 1]); removeIds.add(bl[i - 1].id); }
        }
        p.backlog = p.backlog.filter(t => !removeIds.has(t.id));
        return removed;
    }

    pomoStatus(p) {
        if (!p) return null;
        const label = p.label ? ` ${q(p.label)}` : '';
        if (p.phase === 'done') return `pomo${label} terminé ✅ (${p.completed}/${p.goal})`;
        const phase = p.phase === 'work' ? 'focus' : 'pause';
        const cyc = p.goal > 1 ? ` · ${p.phase === 'work' ? Math.min(p.completed + 1, p.goal) : p.completed}/${p.goal}` : '';
        return `${p.paused ? '⏸️' : p.phase === 'work' ? '🍅' : '☕'} pomo${label} : ${phase} — ${P.fmt(P.remaining(p))} restantes${cyc}${p.paused ? ' (en pause)' : ''}`;
    }

    // ── Minuteurs : tick chaque seconde ──
    startTicking(say) {
        this.say = say;
        clearInterval(this.tickTimer);
        this.tickTimer = setInterval(() => this.tick(), 1000);
    }

    tick() {
        const now = Date.now();
        const s = this.settings();
        // minuteur principal
        const m = this.meta();
        if (m.timer && m.timer.phase !== 'done' && !m.timer.paused && now >= m.timer.endsAt) {
            const evs = P.catchUp(m.timer, now);
            this.saveMeta();
            this.emit('timer', { events: evs, timer: m.timer });
            const last = evs[evs.length - 1];
            if (last && last.late < 60000 && s.timer.announce && this.say) {
                const t = m.timer;
                if (last.ev === 'break') this.say(`⏰ Fin du ${s.timer.focusLabel.toLowerCase()} (${t.completed}/${t.goal}) ! ${s.timer.breakLabel} de ${t.brk} min — étirez-vous, buvez un coup 💧`);
                else if (last.ev === 'work') this.say(`🍅 C'est reparti : ${s.timer.focusLabel.toLowerCase()} de ${t.work} min (${t.completed + 1}/${t.goal}) ! Bon courage à tout le monde 💪`);
                else if (last.ev === 'done') this.say(`🎉 Session terminée : ${plural(t.completed, 'pomodoro')} bouclé${t.completed > 1 ? 's' : ''} ! Bravo à tout le monde ✨`);
            }
            this.changed();
        }
        // minuteurs individuels
        for (const u of this.store.list('users')) {
            const p = u.pomo;
            if (!p) continue;
            if (p.phase === 'done') {
                if (now - (p.doneAt || 0) > 5 * 60 * 1000) { u.pomo = null; this.store.put('users', u, { touch: false }); this.changed(); }
                continue;
            }
            if (p.paused || now < p.endsAt) continue;
            const evs = P.catchUp(p, now);
            this.store.put('users', u, { touch: false });
            this.changed();
            const last = evs[evs.length - 1];
            if (!last || last.late > 60000 || !this.say) continue;
            const n = u.displayName;
            const lbl = p.label ? ` ${q(p.label)}` : '';
            if (last.ev === 'break') this.say(`@${n} ⏰ focus terminé${p.goal > 1 ? ` (${p.completed}/${p.goal})` : ''} ! Pause de ${p.brk} min ☕`);
            else if (last.ev === 'work') this.say(`@${n} 🍅 c'est reparti pour ${p.work} min${p.goal > 1 ? ` (${p.completed + 1}/${p.goal})` : ''} !`);
            else if (last.ev === 'done') this.say(`@${n} 🎉 pomo${lbl} terminé ! Bien joué ✨`);
        }
    }

    // ── Instantané pour l'overlay et l'espace web ──
    snapshot() {
        const s = this.settings();
        const m = this.meta();
        const start = m.sessionStart || 0;
        const streamer = this.streamerLogin();
        const users = [];
        let done = 0, total = 0;
        for (const u of this.store.list('users')) {
            // Listes privées (« _perso ») : jamais sur l'overlay ni dans les totaux.
            if (u.login.startsWith('_')) continue;
            const p = this.proj(u);
            const isStreamer = u.login === streamer;
            const doneList = [];
            for (const pr of u.projects) for (const t of pr.done) if (t.doneAt >= start && !t.hidden) doneList.push(t);
            doneList.sort((a, b) => a.doneAt - b.doneAt);
            const sessionDone = u.projects.reduce((n, pr) => n + pr.done.filter(t => t.doneAt >= start).length, 0);
            done += sessionDone;
            total += sessionDone + (p.active ? 1 : 0);
            // Le streamer reste visible dès qu'il a une tâche, même seulement en
            // backlog (ajoutée depuis l'espace web ou une note).
            const visible = p.active || doneList.length || (u.pomo && u.pomo.phase !== 'done') || (isStreamer && p.backlog.length);
            if (!visible) continue;
            const nextCount = isStreamer ? Math.max(0, Number(s.overlay.streamerNext) || 0) : 0;
            users.push({
                next: p.backlog.slice(0, nextCount).map(t => ({ id: t.id, text: t.text })),
                login: u.login,
                name: u.displayName,
                color: u.color || hashColor(u.login),
                isStreamer,
                project: p.id === 'general' ? null : p.name,
                active: p.active ? { id: p.active.id, text: p.active.text, startedAt: p.active.startedAt } : null,
                done: doneList.slice(-Math.max(0, Number(s.overlay.maxDonePerUser) || 0)).map(t => ({ id: t.id, text: t.text })),
                doneCount: doneList.length,
                backlogCount: p.backlog.length - Math.min(p.backlog.length, nextCount),
                pomo: u.pomo,
                firstAt: u.sessionFirstAt || u.createdAt
            });
        }
        users.sort((a, b) => {
            if (s.overlay.streamerFirst && a.isStreamer !== b.isStreamer) return a.isStreamer ? -1 : 1;
            return (a.firstAt || 0) - (b.firstAt || 0);
        });
        return {
            now: Date.now(),
            sessionStart: start,
            hidden: !!m.overlayHidden,
            timerHidden: !!m.timerHidden,
            mineHidden: !!m.mineHidden,
            socialsHidden: !!m.socialsHidden,
            mine: this.mineSnapshot(s, start, streamer),
            scene: s.scene,
            commandsHidden: !!m.commandsHidden,
            commands: commandsFor(s.chat),
            commandsSettings: s.commands,
            users,
            totals: { done, total, allTime: m.allTimeDone || 0 },
            timer: m.timer,
            overlay: s.overlay,
            timerSettings: s.timer,
            streamer
        };
    }

    // Liste du streamer pour le panneau « Mes tâches » (toujours affiché).
    mineSnapshot(s, start, streamer) {
        if (!streamer) return null;
        const u = this.store.get('users', safeId(streamer));
        if (!u) return { name: streamer, color: null, project: null, active: null, next: [], backlogCount: 0, done: [], doneCount: 0, pomo: null };
        const p = this.proj(u);
        const done = [];
        for (const pr of u.projects) for (const t of pr.done) if (t.doneAt >= start && !t.hidden) done.push(t);
        done.sort((a, b) => a.doneAt - b.doneAt);
        const nNext = Math.max(0, Number(s.overlay.streamerNext) || 0);
        const nDone = Math.max(0, Number(s.scene.mineDone) || 0);
        return {
            name: u.displayName,
            color: u.color || hashColor(u.login),
            project: p.id === 'general' ? null : p.name,
            active: p.active ? { id: p.active.id, text: p.active.text } : null,
            next: p.backlog.slice(0, nNext).map(t => ({ id: t.id, text: t.text })),
            backlogCount: p.backlog.length,
            done: done.slice(-nDone).map(t => ({ id: t.id, text: t.text })),
            doneCount: done.length,
            pomo: u.pomo
        };
    }

    // ── Actions depuis l'espace web (tâche par tâche) ──
    locate(u, taskId) {
        for (const p of u.projects) {
            if (p.active && p.active.id === taskId) return { p, where: 'active', task: p.active };
            const bi = p.backlog.findIndex(t => t.id === taskId);
            if (bi >= 0) return { p, where: 'backlog', index: bi, task: p.backlog[bi] };
            const di = p.done.findIndex(t => t.id === taskId);
            if (di >= 0) return { p, where: 'done', index: di, task: p.done[di] };
        }
        return null;
    }

    web(op, a = {}) {
        const login = (a.login || this.streamerLogin() || 'moi').toLowerCase();
        if (op === 'newSession') {
            const m = this.meta(); m.sessionStart = Date.now(); this.saveMeta(); this.changed(); return { ok: true };
        }
        if (op === 'overlayVisible') return this.web('visibility', { target: 'tasks', visible: a.visible });
        if (op === 'visibility') {
            const key = { tasks: 'overlayHidden', chat: 'overlayHidden', timer: 'timerHidden', commands: 'commandsHidden', mine: 'mineHidden', socials: 'socialsHidden' }[a.target];
            if (!key) return { ok: false, error: 'overlay inconnu' };
            const m = this.meta(); m[key] = !a.visible; this.saveMeta(); this.changed(); return { ok: true };
        }
        if (op === 'timer') return this.webTimer(a);
        if (op === 'say') {
            const replies = this.handle({ login, displayName: a.displayName || login, isBroadcaster: login === this.streamerLogin(), isMod: !!a.asMod }, a.text);
            if (a.sendToChat && this.say) replies.forEach(r => this.say(r));
            return { ok: true, replies };
        }
        const u = this.getUser(login, { displayName: a.displayName || (login === '_perso' ? 'Perso' : undefined) });
        if (op === 'removeUser') {
            this.store.remove('users', u.id); this.changed(); return { ok: true };
        }
        if (op === 'setUser') {
            if (a.color !== undefined) u.color = a.color || null;
            if (a.displayName) u.displayName = a.displayName;
            this.saveUser(u); return { ok: true };
        }
        if (op === 'project') {
            if (a.action === 'switch') { const p = this.ensureProject(u, a.name); u.currentProject = p.id; }
            if (a.action === 'create') { this.ensureProject(u, a.name); }
            if (a.action === 'rename') { const p = u.projects.find(x => x.id === a.projectId); if (p && a.name) p.name = a.name.slice(0, 40); }
            if (a.action === 'remove') {
                if (u.projects.length > 1) {
                    u.projects = u.projects.filter(x => x.id !== a.projectId);
                    if (u.currentProject === a.projectId) u.currentProject = u.projects[0].id;
                }
            }
            this.saveUser(u); return { ok: true };
        }
        if (op === 'add') {
            const p = a.projectId ? (u.projects.find(x => x.id === a.projectId) || this.proj(u)) : this.proj(u);
            const c = this.clean(a.text);
            if (c.error) return { ok: false, error: c.error };
            const t = this.newTask(c.text, a.noteId ? { noteId: a.noteId } : {});
            this.touchSession(u);
            if (a.where === 'active') this.setActive(u, p, t);
            else if (a.where === 'soon') p.backlog.unshift(t);
            else if (a.where === 'done') this.completeTask(u, p, t);
            else p.backlog.push(t);
            this.saveUser(u); return { ok: true, task: t };
        }
        const loc = a.taskId ? this.locate(u, a.taskId) : null;
        if (!loc) return { ok: false, error: 'tâche introuvable' };
        const { p, task } = loc;
        const detach = () => {
            if (loc.where === 'active') p.active = null;
            else if (loc.where === 'backlog') p.backlog.splice(p.backlog.indexOf(task), 1);
            else p.done.splice(p.done.indexOf(task), 1);
        };
        if (op === 'rename') { const c = this.clean(a.text); if (c.error) return { ok: false, error: c.error }; task.text = c.text; }
        else if (op === 'done') { if (loc.where === 'done') return { ok: true }; detach(); this.touchSession(u); this.completeTask(u, p, task); }
        else if (op === 'undone') {
            if (loc.where !== 'done') return { ok: true };
            detach(); delete task.doneAt; u.totalDone = Math.max(0, (u.totalDone || 0) - 1);
            if (!p.active) p.active = task; else p.backlog.unshift(task);
        }
        else if (op === 'activate') { if (loc.where === 'active') return { ok: true }; detach(); delete task.doneAt; this.touchSession(u); this.setActive(u, p, task); }
        else if (op === 'toBacklog') { if (loc.where === 'backlog') return { ok: true }; detach(); delete task.doneAt; p.backlog.unshift(task); }
        else if (op === 'remove') { detach(); }
        else if (op === 'hide') { task.hidden = !task.hidden; }
        else if (op === 'move') {
            if (loc.where !== 'backlog') return { ok: false, error: 'seul le backlog se réordonne' };
            p.backlog.splice(loc.index, 1);
            const to = Math.max(0, Math.min(p.backlog.length, Number(a.toIndex) || 0));
            p.backlog.splice(to, 0, task);
        }
        else if (op === 'transfer') {
            // Passe une tâche d'une liste à l'autre (Stream ↔ Perso).
            const to = String(a.toLogin || '').toLowerCase();
            if (!to || to === login) return { ok: false, error: 'liste de destination invalide' };
            const tu = this.getUser(to, { displayName: to === '_perso' ? 'Perso' : to });
            const tp = this.proj(tu);
            detach();
            if (loc.where === 'done') tp.done.push(task);
            else if (loc.where === 'active' && !tp.active) tp.active = task;
            else tp.backlog.unshift(task);
            this.saveUser(tu);
        }
        else if (op === 'moveProject') {
            const target = u.projects.find(x => x.id === a.projectId);
            if (!target) return { ok: false, error: 'projet introuvable' };
            detach(); if (loc.where === 'done') target.done.push(task); else target.backlog.push(task);
        }
        else return { ok: false, error: 'action inconnue' };
        this.saveUser(u);
        return { ok: true };
    }

    webTimer(a) {
        const m = this.meta();
        const s = this.settings().timer;
        const now = Date.now();
        switch (a.cmd) {
            case 'start':
                m.timer = P.create({
                    work: Number(a.work) || s.defaultWork,
                    brk: a.brk !== undefined ? Number(a.brk) : s.defaultBreak,
                    goal: Number(a.goal) || s.defaultGoal,
                    label: a.label || ''
                }, now);
                break;
            case 'pause': m.timer && P.pause(m.timer, now); break;
            case 'resume': m.timer && P.resume(m.timer, now); break;
            case 'toggle': if (m.timer) { if (m.timer.paused) P.resume(m.timer, now); else P.pause(m.timer, now); } break;
            case 'skip': if (m.timer && m.timer.phase !== 'done') { const was = m.timer.paused; P.advance(m.timer, now); if (was) P.pause(m.timer, now); } break;
            case 'adjust': m.timer && P.adjust(m.timer, Number(a.minutes) || 0, now); break;
            case 'stop': m.timer = null; break;
            case 'finish': m.timer && P.finish(m.timer, now); break;
            case 'set':
                if (m.timer) {
                    if (a.completed !== undefined) m.timer.completed = Math.max(0, Number(a.completed) || 0);
                    if (a.goal !== undefined) m.timer.goal = Math.max(1, Number(a.goal) || 1);
                    if (a.label !== undefined) m.timer.label = String(a.label).slice(0, 60);
                }
                break;
            default: return { ok: false, error: 'commande minuteur inconnue' };
        }
        this.saveMeta();
        this.changed();
        return { ok: true, timer: m.timer };
    }
}

// ── Les commandes du chat ──
// Chaque fonction reçoit (ctx, reste du message) et renvoie une réponse
// (préfixée automatiquement de @pseudo), un tableau de réponses, ou rien.
StreamEngine.prototype.commands = {
    sweet(ctx, rest) {
        const r = rest.toLowerCase();
        if (r === 'backlog') return this.commands.sweetbacklog.call(this, ctx);
        if (r === 'pomo') return this.commands.sweetpomo.call(this, ctx);
        if (r === 'help' || r === 'aide') return [
            'tâches 📝 !task <tâche> (tâche active) · !done · !done next · !rename <texte> · !remove · !now · !later <tâche> · !soon <tâche> · !backlog · !mytasks · !mydone · !ourdone · !randomtask',
            '!raw ➕ plusieurs tâches d\'un coup avec des « ; » (!later a; b; c) · !done 2; 3 · projets : !project <nom> · !projects · !addto <projet>: <tâche> · pomodoro : !pomo 25/5 <nom> · mémoire : !remember pronoms il/lui · !ask task @pseudo'
        ];
        return 'liste de tâches ✨ !task <ta tâche> pour commencer, !done quand c\'est fini, !later <tâche> pour le backlog, !pomo 25 pour un minuteur. Tout le détail : !sweet help';
    },
    sweetbacklog() {
        return 'backlog 📋 !later <tâche> ajoute à la fin · !soon <tâche> ajoute en tête · !backlog liste · !now récupère la suivante · !now 2 active la n°2 · !now skip passe la tâche · !now raffle en tire une au hasard · !done 2; 3 termine plusieurs tâches (0 = active) · !remove 2 · !display 2 · !backlog clear';
    },
    sweetpomo() {
        return 'pomodoro 🍅 !pomo 25 <nom> (minuteur de 25 min) · !pomo 25/5 (focus/pause) · !pomo 25/5/4 (4 cycles) · !pomo pour voir le tien · !pomo pause · !pomo continue · !pomo +5 / -5 · !pomo rename <nom> · !pomo finish · !pomo cancel · !ask pomo @pseudo';
    },

    task(ctx, rest) {
        if (rest.toLowerCase() === 'help' || rest.toLowerCase() === 'aide') return this.commands.sweet.call(this, ctx, '');
        const u = this.u(ctx);
        const p = this.proj(u);
        if (!rest) {
            if (p.active) return `ta tâche actuelle : ${q(p.active.text)}${p.backlog.length ? ` (+${p.backlog.length} dans le backlog)` : ''}`;
            return 'tu n\'as pas de tâche en cours — lance-toi avec !task <ta tâche> ✍️';
        }
        const items = splitList(rest);
        const c = this.clean(items[0]);
        if (c.error) return c.error;
        this.touchSession(u);
        const hadActive = p.active;
        this.setActive(u, p, this.newTask(c.text));
        let extra = '';
        if (items.length > 1) {
            const r = this.addToBacklog(u, p, items.slice(1));
            if (r.added.length) extra = ` · ${plural(r.added.length, 'tâche')} ajoutée${r.added.length > 1 ? 's' : ''} au backlog`;
        }
        this.saveUser(u);
        return `tâche créée : ${q(c.text)} ✍️${hadActive ? ` (${q(hadActive.text)} remise en tête du backlog)` : ''}${extra}`;
    },

    now(ctx, rest) {
        const u = this.u(ctx);
        const p = this.proj(u);
        const r = rest.toLowerCase();
        this.touchSession(u);
        if (!rest || r === 'next') {
            if (!p.backlog.length) return p.active ? `tu es sur ${q(p.active.text)} et ton backlog est vide` : 'ton backlog est vide — ajoute des tâches avec !later <tâche>';
            if (p.active && !rest) return `tu es déjà sur ${q(p.active.text)} — !done pour la terminer ou !now skip pour passer à la suivante`;
            const t = p.backlog.shift();
            this.setActive(u, p, t);
            this.saveUser(u);
            return `c'est parti pour ${q(t.text)} 🚀`;
        }
        if (r === 'skip') {
            if (!p.backlog.length) return 'rien à passer : ton backlog est vide';
            const t = p.backlog.shift();
            if (p.active) p.backlog.push(p.active);
            t.startedAt = Date.now();
            p.active = t;
            this.saveUser(u);
            return `tâche passée ⏭️ maintenant : ${q(t.text)}`;
        }
        if (r === 'raffle' || r === 'random' || r === 'hasard') {
            if (!p.backlog.length) return 'ton backlog est vide 🎲';
            const i = Math.floor(Math.random() * p.backlog.length);
            const [t] = p.backlog.splice(i, 1);
            this.setActive(u, p, t);
            this.saveUser(u);
            return `🎲 le hasard a choisi : ${q(t.text)}`;
        }
        if (/^\d+$/.test(rest)) {
            const i = Number(rest);
            if (i < 1 || i > p.backlog.length) return `il n'y a pas de tâche n°${i} dans ton backlog`;
            const [t] = p.backlog.splice(i - 1, 1);
            this.setActive(u, p, t);
            this.saveUser(u);
            return `c'est parti pour ${q(t.text)} 🚀`;
        }
        return this.commands.task.call(this, ctx, rest);
    },

    later(ctx, rest) {
        if (!rest) return this.commands.sweetbacklog.call(this, ctx);
        const u = this.u(ctx);
        const p = this.proj(u);
        const r = this.addToBacklog(u, p, splitList(rest));
        if (!r.added.length) return r.errors[0] || 'rien à ajouter';
        this.touchSession(u);
        this.saveUser(u);
        return r.added.length === 1
            ? `ajouté au backlog (n°${p.backlog.length}) : ${q(r.added[0].text)} 📋`
            : `${plural(r.added.length, 'tâche')} ajoutée${r.added.length > 1 ? 's' : ''} au backlog 📋${r.errors.length ? ` (${r.errors[0]})` : ''}`;
    },

    soon(ctx, rest) {
        if (!rest) return this.commands.sweetbacklog.call(this, ctx);
        const u = this.u(ctx);
        const p = this.proj(u);
        const r = this.addToBacklog(u, p, splitList(rest), true);
        if (!r.added.length) return r.errors[0] || 'rien à ajouter';
        this.touchSession(u);
        this.saveUser(u);
        return r.added.length === 1 ? `ajouté en tête du backlog : ${q(r.added[0].text)} ⏫` : `${plural(r.added.length, 'tâche')} ajoutées en tête du backlog ⏫`;
    },

    backlog(ctx, rest) {
        const u = this.u(ctx);
        const p = this.proj(u);
        const r = rest.toLowerCase();
        if (!rest) return this.listBacklog(p);
        if (r === 'help' || r === 'aide') return this.commands.sweetbacklog.call(this, ctx);
        if (r === 'clear' || r === 'vider') {
            const n = p.backlog.length;
            p.backlog = [];
            this.saveUser(u);
            return `backlog vidé 🧹 (${plural(n, 'tâche')} retirée${n > 1 ? 's' : ''})`;
        }
        if (/^\d+$/.test(rest)) return this.commands.now.call(this, ctx, rest);
        return this.commands.later.call(this, ctx, rest);
    },

    done(ctx, rest) {
        const u = this.u(ctx);
        let p = this.proj(u);
        const r = rest.toLowerCase();
        this.touchSession(u);
        if (!rest || r === 'next' || r === 'suivante') {
            if (!p.active) {
                if (!rest) return 'tu n\'as pas de tâche active — !task <tâche> pour en créer une';
            }
            const doneTask = p.active;
            if (doneTask) { p.active = null; this.completeTask(u, p, doneTask); }
            let next = '';
            if (rest && p.backlog.length) {
                const t = p.backlog.shift();
                t.startedAt = Date.now();
                p.active = t;
                next = ` · suivante : ${q(t.text)} 🚀`;
            } else if (rest) next = ' · ton backlog est vide 🎉';
            this.saveUser(u);
            const n = this.sessionDone(u);
            return doneTask ? `bravo ! ✅ ${q(doneTask.text)} (${plural(n, 'tâche')} aujourd'hui)${next}` : `aucune tâche active${next}`;
        }
        if (r === 'all' || r === 'tout') {
            const idx = [0, ...p.backlog.map((_, i) => i + 1)];
            const done = this.doneByIndexes(u, p, idx);
            this.saveUser(u);
            return done.length ? `incroyable ! ${plural(done.length, 'tâche')} terminée${done.length > 1 ? 's' : ''} d'un coup 🏆` : 'rien à terminer';
        }
        const pre = this.projectPrefix(u, rest);
        if (pre && isNumList(pre.rest)) {
            if (!pre.p) return `pas de projet ${q(pre.name)}`;
            p = pre.p;
            const done = this.doneByIndexes(u, p, nums(pre.rest));
            this.saveUser(u);
            return done.length ? `✅ ${done.map(t => q(t.text)).join(', ')} (projet ${p.name})` : 'aucun numéro valide';
        }
        if (isNumList(rest)) {
            const done = this.doneByIndexes(u, p, nums(rest));
            this.saveUser(u);
            return done.length ? `✅ ${done.map(t => q(t.text)).join(', ')}` : 'aucun numéro valide (0 = tâche active, 1+ = backlog)';
        }
        // Texte libre : on enregistre directement une tâche terminée.
        const items = splitList(rest);
        const made = [];
        for (const it of items) {
            const c = this.clean(it);
            if (c.error) return c.error;
            const t = this.newTask(c.text);
            this.completeTask(u, p, t);
            made.push(t);
        }
        this.saveUser(u);
        return `bravo ! ✅ ${made.map(t => q(t.text)).join(', ')}`;
    },

    rename(ctx, rest) {
        if (!rest) return 'utilise !rename <nouveau nom> (ou !rename 2 <nom> pour le backlog)';
        const u = this.u(ctx);
        const p = this.proj(u);
        const m = rest.match(/^(\d+)\s+(.+)$/);
        const c = this.clean(m ? m[2] : rest);
        if (c.error) return c.error;
        if (m) {
            const i = Number(m[1]);
            const t = i === 0 ? p.active : p.backlog[i - 1];
            if (!t) return `pas de tâche n°${i}`;
            t.text = c.text;
        } else {
            if (!p.active) return 'tu n\'as pas de tâche active à renommer';
            p.active.text = c.text;
        }
        this.saveUser(u);
        return `tâche renommée : ${q(c.text)} ✏️`;
    },

    remove(ctx, rest) {
        const u = this.u(ctx);
        let p = this.proj(u);
        const r = rest.toLowerCase();
        if (!rest) {
            if (!p.active) return 'tu n\'as pas de tâche active';
            const t = p.active; p.active = null;
            this.saveUser(u);
            return `tâche retirée : ${q(t.text)} 🗑️`;
        }
        if (r === 'all' || r === 'tout') {
            const n = (p.active ? 1 : 0) + p.backlog.length;
            p.active = null; p.backlog = [];
            p.done.forEach(t => { t.hidden = true; });
            this.saveUser(u);
            return `tout est effacé 🧹 (${plural(n, 'tâche')})`;
        }
        const pre = this.projectPrefix(u, rest);
        if (pre && isNumList(pre.rest)) {
            if (!pre.p) return `pas de projet ${q(pre.name)}`;
            p = pre.p;
            const rm = this.removeByIndexes(p, nums(pre.rest));
            this.saveUser(u);
            return rm.length ? `retiré de ${p.name} : ${rm.map(t => q(t.text)).join(', ')} 🗑️` : 'aucun numéro valide';
        }
        if (isNumList(rest)) {
            const rm = this.removeByIndexes(p, nums(rest));
            this.saveUser(u);
            return rm.length ? `retiré : ${rm.map(t => q(t.text)).join(', ')} 🗑️` : 'aucun numéro valide';
        }
        return 'utilise !remove, !remove 2 ou !remove all';
    },

    display(ctx, rest) {
        const u = this.u(ctx);
        const p = this.proj(u);
        const i = parseInt(rest, 10);
        if (isNaN(i)) return 'utilise !display <numéro>';
        const t = i === 0 ? p.active : p.backlog[i - 1];
        return t ? `n°${i} : ${t.text}` : `pas de tâche n°${i}`;
    },

    mytasks(ctx) {
        const u = this.u(ctx);
        const p = this.proj(u);
        const n = this.sessionDone(u);
        return `${p.id === 'general' ? '' : `[${p.name}] `}⚡ ${p.active ? q(p.active.text) : 'aucune tâche active'} · 📋 ${p.backlog.length} en attente · ✅ ${n} faite${n > 1 ? 's' : ''} aujourd'hui`;
    },

    mydone(ctx) {
        const u = this.u(ctx);
        const n = this.sessionDone(u);
        return `tu as terminé ${plural(n, 'tâche')} aujourd'hui et ${u.totalDone || 0} au total 🏅`;
    },

    ourdone(ctx) {
        const snap = this.snapshot();
        return `la communauté a terminé ${plural(snap.totals.done, 'tâche')} pendant ce stream (${snap.totals.allTime} depuis le début) 💪`;
    },

    randomtask(ctx) {
        const u = this.u(ctx);
        const p = this.proj(u);
        const text = RANDOM_TASKS[Math.floor(Math.random() * RANDOM_TASKS.length)];
        this.touchSession(u);
        if (p.active) { p.backlog.unshift(this.newTask(text)); this.saveUser(u); return `petite tâche ajoutée en tête du backlog : ${q(text)}`; }
        this.setActive(u, p, this.newTask(text));
        this.saveUser(u);
        return `petite tâche du moment : ${q(text)} ✨`;
    },

    ask(ctx, rest) {
        const [what, target] = rest.split(/\s+/);
        if (!what) return 'utilise !ask task @pseudo, !ask pomo @pseudo ou !ask pronoms @pseudo';
        const tLogin = (target || ctx.login).replace(/^@/, '').toLowerCase();
        const tu = this.getUser(tLogin, {}, false);
        const who = tu ? tu.displayName : tLogin;
        const w = what.toLowerCase();
        if (w === 'task' || w === 'tache' || w === 'tâche') {
            if (!tu) return `${who} n'a pas encore de tâche`;
            const p = this.proj(tu);
            return p.active ? `${who} travaille sur ${q(p.active.text)}` : `${who} n'a pas de tâche active`;
        }
        if (w === 'pomo') {
            if (!tu || !tu.pomo) return `${who} n'a pas de pomo en cours`;
            return `${who} — ${this.pomoStatus(tu.pomo)}`;
        }
        const key = MEMORY_KEYS[w];
        if (!key) return `je ne connais pas ${q(what)} — clés possibles : pronoms, pays, plat, animal, signe`;
        const v = tu && tu.memory && tu.memory[key];
        return v ? `${key} de ${who} : ${v}` : `${who} n'a pas renseigné ${key}`;
    },

    remember(ctx, rest) {
        const m = rest.match(/^(\S+)\s+(.+)$/);
        if (!m) return 'utilise !remember <clé> <valeur> — clés : pronoms, pays, plat, animal, signe';
        const key = MEMORY_KEYS[m[1].toLowerCase()];
        if (!key) return 'clés possibles : pronoms, pays, plat, animal, signe';
        const c = this.clean(m[2]);
        if (c.error) return c.error;
        const u = this.u(ctx);
        u.memory = u.memory || {};
        u.memory[key] = c.text.slice(0, 60);
        this.saveUser(u);
        return `c'est noté : ${key} = ${u.memory[key]} 🧠`;
    },

    forget(ctx, rest) {
        const u = this.u(ctx);
        const r = rest.toLowerCase();
        if (r === 'all' || r === 'tout') { u.memory = {}; this.saveUser(u); return 'j\'ai tout oublié 🫥'; }
        const key = MEMORY_KEYS[r];
        if (!key) return 'utilise !forget <clé> ou !forget all';
        if (u.memory) delete u.memory[key];
        this.saveUser(u);
        return `${key} oublié 🫥`;
    },

    memory(ctx, rest) {
        if (rest.toLowerCase() === 'stats') {
            const counts = {};
            for (const u of this.store.list('users')) for (const k of Object.keys(u.memory || {})) counts[k] = (counts[k] || 0) + 1;
            const parts = Object.entries(counts).map(([k, n]) => `${k} : ${n}`);
            return parts.length ? `mémoire 🧠 ${parts.join(' · ')}` : 'personne n\'a encore rien enregistré 🧠';
        }
        return 'mémoire 🧠 !remember pronoms elle/iel · !ask pronoms @pseudo · !forget pronoms · !forget all · !memory stats — clés : pronoms, pays, plat, animal, signe';
    },

    pomo(ctx, rest) {
        const u = this.u(ctx);
        const r = rest.toLowerCase();
        const now = Date.now();
        const p = u.pomo;
        if (!rest) return p ? this.pomoStatus(p) : 'pas de pomo en cours — !pomo 25 <nom> pour en lancer un (!sweetpomo pour l\'aide)';
        if (r === 'help' || r === 'aide') return this.commands.sweetpomo.call(this, ctx);
        const needs = () => (!p || p.phase === 'done') ? 'tu n\'as pas de pomo en cours' : null;
        if (r === 'pause') { const e = needs(); if (e) return e; P.pause(p, now); this.saveUser(u); return `pomo en pause ⏸️ (${P.fmt(P.remaining(p, now))} restantes)`; }
        if (['continue', 'resume', 'reprendre', 'go'].includes(r)) { const e = needs(); if (e) return e; P.resume(p, now); this.saveUser(u); return 'c\'est reparti ▶️'; }
        if (['finish', 'fin', 'finir', 'end'].includes(r)) { const e = needs(); if (e) return e; P.finish(p, now); this.saveUser(u); return 'pomo terminé 🎉'; }
        if (['cancel', 'stop', 'annuler'].includes(r)) { if (!p) return 'tu n\'as pas de pomo'; u.pomo = null; this.saveUser(u); return 'pomo annulé 🗑️'; }
        if (r === 'skip') { const e = needs(); if (e) return e; P.advance(p, now); this.saveUser(u); return this.pomoStatus(p); }
        const adj = rest.match(/^([+-])\s*(\d{1,3})$/);
        if (adj) {
            const e = needs(); if (e) return e;
            P.adjust(p, (adj[1] === '-' ? -1 : 1) * Number(adj[2]), now);
            this.saveUser(u);
            return `c'est noté : ${P.fmt(P.remaining(p, now))} restantes ⏱️`;
        }
        const ren = rest.match(/^(?:rename|renommer)\s+(.+)$/i);
        if (ren) { if (!p) return 'tu n\'as pas de pomo'; p.label = ren[1].slice(0, 60); this.saveUser(u); return `pomo renommé : ${q(p.label)}`; }
        const spec = P.parseSpec(rest);
        if (!spec) return 'format : !pomo 25 <nom>, !pomo 25/5 <nom> ou !pomo 25/5/4 <nom>';
        if (spec.error) return 'durées possibles : focus 1–240 min, pause 0–120 min, 1–24 cycles';
        if (spec.label) { const c = this.clean(spec.label); if (c.error) return c.error; spec.label = c.text; }
        u.pomo = P.create(spec, now);
        this.touchSession(u);
        this.saveUser(u);
        const extra = spec.brk ? ` puis ${spec.brk} min de pause` : '';
        return `pomo lancé 🍅 ${spec.work} min${extra}${spec.goal > 1 ? ` × ${spec.goal}` : ''}${spec.label ? ` — ${q(spec.label)}` : ''}`;
    },

    project(ctx, rest) {
        const u = this.u(ctx);
        const r = rest.toLowerCase();
        if (!rest || r === 'help' || r === 'aide') {
            return `projet actuel : ${this.proj(u).name} 📁 · !project <nom> (change/crée) · !projects · !project rename <nom> · !project remove · !addto <projet>: <tâche> · !getfrom <projet> · !peek <projet> · !project tutorial`;
        }
        if (r === 'tutorial' || r === 'tuto') return [
            'tuto projets 1/2 📁 chaque projet a sa propre tâche active et son backlog. !project Ménage crée le projet « Ménage » et bascule dessus ; tes !task / !later / !done s\'y appliquent.',
            '!raw tuto projets 2/2 📁 !project Ménage: vaisselle; aspirateur crée le projet avec ses tâches · !addto Ménage: linge ajoute sans changer de projet · !getfrom Ménage ramène sa prochaine tâche · !project Général pour revenir'
        ];
        const ren = rest.match(/^(?:rename|renommer)\s+(.+)$/i);
        if (ren) {
            const p = this.proj(u);
            const name = ren[1].trim().slice(0, 40);
            if (this.findProject(u, name)) return `le projet ${q(name)} existe déjà`;
            p.name = name;
            this.saveUser(u);
            return `projet renommé : ${name} 📁`;
        }
        if (r === 'remove' || r === 'supprimer') {
            const p = this.proj(u);
            if (u.projects.length === 1) { p.active = null; p.backlog = []; this.saveUser(u); return 'c\'était ton seul projet : il est vidé 🧹'; }
            u.projects = u.projects.filter(x => x !== p);
            u.currentProject = u.projects[0].id;
            this.saveUser(u);
            return `projet ${q(p.name)} supprimé — retour sur ${u.projects[0].name}`;
        }
        const quick = rest.match(/^([^:;]{1,40}):\s*(.+)$/);
        const name = (quick ? quick[1] : rest).trim();
        if (u.projects.length >= 15 && !this.findProject(u, name)) return 'tu as déjà 15 projets, supprime-en un d\'abord';
        const p = this.ensureProject(u, name);
        u.currentProject = p.id;
        this.touchSession(u);
        let extra = '';
        if (quick) {
            const items = splitList(quick[2]);
            const res = this.addToBacklog(u, p, items);
            if (!p.active && p.backlog.length) { const t = p.backlog.shift(); t.startedAt = Date.now(); p.active = t; }
            extra = ` avec ${plural(res.added.length, 'tâche')}`;
        }
        this.saveUser(u);
        return `projet ${q(p.name)} actif 📁${extra}${p.active ? ` · tâche : ${q(p.active.text)}` : ''}`;
    },

    projects(ctx) {
        const u = this.u(ctx);
        return 'tes projets 📁 ' + u.projects.map(p => `${p.id === u.currentProject ? '▶ ' : ''}${p.name} (${(p.active ? 1 : 0) + p.backlog.length})`).join(' · ');
    },

    fullreset(ctx, rest) {
        if (rest.toLowerCase() !== 'confirm' && rest.toLowerCase() !== 'confirmer') return '⚠️ ça supprime TOUS tes projets et tâches. Tape !fullreset confirm pour valider';
        const u = this.u(ctx);
        u.projects = [{ id: 'general', name: 'Général', active: null, backlog: [], done: [] }];
        u.currentProject = 'general';
        u.pomo = null;
        this.saveUser(u);
        return 'tout a été remis à zéro 🧼';
    },

    addto(ctx, rest) {
        const m = rest.match(/^([^:;]{1,40}):\s*(.+)$/);
        if (!m) return 'utilise !addto <projet>: <tâche>; <tâche>';
        const u = this.u(ctx);
        const p = this.ensureProject(u, m[1]);
        const r = this.addToBacklog(u, p, splitList(m[2]));
        if (!r.added.length) return r.errors[0] || 'rien à ajouter';
        this.saveUser(u);
        return `${plural(r.added.length, 'tâche')} ajoutée${r.added.length > 1 ? 's' : ''} à ${p.name} 📁`;
    },

    getfrom(ctx, rest) {
        const u = this.u(ctx);
        const src = this.findProject(u, rest);
        if (!src) return `pas de projet ${q(rest)} — !projects pour la liste`;
        const cur = this.proj(u);
        if (src === cur) return 'c\'est déjà ton projet actuel — utilise !now';
        const t = src.active || src.backlog[0];
        if (!t) return `le projet ${src.name} est vide`;
        if (src.active === t) src.active = null; else src.backlog.shift();
        this.touchSession(u);
        if (!cur.active) { t.startedAt = Date.now(); cur.active = t; } else cur.backlog.unshift(t);
        this.saveUser(u);
        return `${q(t.text)} récupéré depuis ${src.name}${cur.active === t ? ' et activé 🚀' : ' (en tête du backlog)'}`;
    },

    peek(ctx, rest) {
        const u = this.u(ctx);
        const p = this.findProject(u, rest);
        if (!p) return `pas de projet ${q(rest)}`;
        const bl = p.backlog.slice(0, 5).map((t, i) => `${i + 1}. ${t.text}`).join(' | ');
        return `👀 ${p.name} — ⚡ ${p.active ? q(p.active.text) : 'aucune'}${bl ? ` · ${bl}` : ''}${p.backlog.length > 5 ? ` … (+${p.backlog.length - 5})` : ''}`;
    },

    clearold(ctx, rest) {
        const u = this.u(ctx);
        const start = this.meta().sessionStart;
        const visible = [];
        for (const p of u.projects) for (const t of p.done) if (!t.hidden && t.doneAt >= start) visible.push(t);
        visible.sort((a, b) => a.doneAt - b.doneAt);
        const n = /^\d+$/.test(rest) ? Math.min(Number(rest), visible.length) : visible.length;
        visible.slice(0, n).forEach(t => { t.hidden = true; });
        this.saveUser(u);
        return n ? `${plural(n, 'tâche terminée', 'tâches terminées')} retirée${n > 1 ? 's' : ''} de l'affichage 🧹` : 'rien à nettoyer';
    },

    // ── Streamer / modos ──
    // Capture rapide d'une idée dans l'Inbox des notes (méthode IPARA).
    note(ctx, rest) {
        if (!ctx.isStreamer) return null;
        if (!rest) return 'utilise !note <idée> pour l’envoyer dans l’Inbox 📥';
        if (!this.onNote) return 'les notes ne sont pas disponibles';
        this.onNote(rest, ctx);
        return 'idée notée dans l’Inbox 📥';
    },

    timer(ctx, rest) {
        const s = this.settings().timer;
        const r = rest.toLowerCase();
        const m = this.meta();
        const t = m.timer;
        const act = (cmd, extra) => this.webTimer({ cmd, ...extra });
        if (!rest) {
            if (!t) return 'aucun minuteur — !timer 50/10/4 <nom> pour en lancer un';
            return this.pomoStatus(t).replace('pomo', 'minuteur');
        }
        if (r === 'pause') { act('pause'); return 'minuteur en pause ⏸️'; }
        if (['resume', 'continue', 'reprendre', 'go', 'start'].includes(r) && t) { act('resume'); return 'minuteur relancé ▶️'; }
        if (r === 'skip' || r === 'next') { if (!t) return 'aucun minuteur'; act('skip'); return `phase suivante ⏭️ ${this.pomoStatus(this.meta().timer).replace('pomo', 'minuteur')}`; }
        if (['stop', 'cancel', 'reset', 'annuler'].includes(r)) { act('stop'); return 'minuteur arrêté ⏹️'; }
        if (['finish', 'fin'].includes(r)) { act('finish'); return 'minuteur terminé 🎉'; }
        const adj = rest.match(/^([+-])\s*(\d{1,3})$/);
        if (adj) { if (!t) return 'aucun minuteur'; act('adjust', { minutes: (adj[1] === '-' ? -1 : 1) * Number(adj[2]) }); return `c'est noté ⏱️ ${P.fmt(P.remaining(this.meta().timer))} restantes`; }
        const ren = rest.match(/^(?:rename|renommer|label)\s+(.+)$/i);
        if (ren) { act('set', { label: ren[1] }); return 'minuteur renommé ✏️'; }
        const goal = rest.match(/^(?:goal|objectif)\s+(\d{1,2})$/i);
        if (goal) { act('set', { goal: Number(goal[1]) }); return `objectif : ${goal[1]} pomodoros 🎯`; }
        const spec = P.parseSpec(rest);
        if (!spec) return 'format : !timer 50/10/4 <nom> · pause · resume · skip · stop · +5 · -5 · goal 4 · rename <nom>';
        if (spec.error) return 'durées possibles : focus 1–240 min, pause 0–120 min, 1–24 cycles';
        const brk = /\//.test(rest) ? spec.brk : s.defaultBreak;
        const g = rest.split(/\s+/)[0].split('/').length >= 3 ? spec.goal : s.defaultGoal;
        act('start', { work: spec.work, brk, goal: g, label: spec.label });
        return `minuteur lancé 🍅 ${spec.work} min de ${s.focusLabel.toLowerCase()}${brk ? ` / ${brk} min de pause` : ''} × ${g}${spec.label ? ` — ${q(spec.label)}` : ''}`;
    },

    timerpomo(ctx, rest) {
        const m = rest.match(/^(\d{1,2})\s*\/\s*(\d{1,2})$/);
        if (!m) return 'utilise !timerpomo <faits>/<objectif>, ex. !timerpomo 0/4';
        if (!this.meta().timer) return 'aucun minuteur en cours — !timer 50/10 d\'abord';
        this.webTimer({ cmd: 'set', completed: Number(m[1]), goal: Number(m[2]) });
        return `compteur de pomodoros : ${m[1]}/${m[2]} 🍅`;
    },

    newsession() {
        this.web('newSession');
        return 'nouvelle session : les tâches terminées sont retirées de l\'overlay ✨';
    },
    tasksreset(ctx) { return this.commands.newsession.call(this, ctx); },

    cleartasks(ctx, rest) {
        const target = rest.replace(/^@/, '').trim().toLowerCase();
        if (!target) return 'utilise !cleartasks @pseudo';
        const u = this.getUser(target, {}, false);
        if (!u) return `${target} n'a pas de tâches`;
        for (const p of u.projects) { p.active = null; p.backlog = []; p.done.forEach(t => { t.hidden = true; }); }
        u.pomo = null;
        this.saveUser(u);
        return `tâches de ${u.displayName} effacées 🧹`;
    },

    tasklock(ctx, rest) {
        const r = rest.toLowerCase();
        const on = r === 'on' || r === '' ? !this.settings().chat.viewersLocked : r !== 'off';
        this.saveSettings({ chat: { viewersLocked: r === 'on' ? true : r === 'off' ? false : on } });
        return this.settings().chat.viewersLocked ? 'liste verrouillée 🔒 (seuls les modos peuvent l\'utiliser)' : 'liste ouverte à tout le monde 🔓';
    },

    // !overlay hide · !overlay timer show · !overlay commands hide
    overlay(ctx, rest) {
        const words = rest.toLowerCase().split(/\s+/).filter(Boolean);
        const TARGETS = { tasks: 'tasks', taches: 'tasks', 'tâches': 'tasks', chat: 'tasks', timer: 'timer', minuteur: 'timer', commands: 'commands', commandes: 'commands', cmd: 'commands', mine: 'mine', moi: 'mine', socials: 'socials', reseaux: 'socials', 'réseaux': 'socials' };
        const target = TARGETS[words[0]] || 'tasks';
        const action = TARGETS[words[0]] ? words[1] : words[0];
        const NAMES = { tasks: 'overlay des tâches', timer: 'overlay du minuteur', commands: 'overlay des commandes', mine: 'panneau de tes tâches', socials: 'panneau des réseaux' };
        if (['hide', 'off', 'masquer'].includes(action)) { this.web('visibility', { target, visible: false }); return `${NAMES[target]} masqué 🙈`; }
        if (['show', 'on', 'afficher'].includes(action)) { this.web('visibility', { target, visible: true }); return `${NAMES[target]} affiché 👀`; }
        return 'utilise !overlay show/hide, !overlay timer show/hide ou !overlay commands show/hide';
    }
};

module.exports = { StreamEngine, hashColor, RANDOM_TASKS };
