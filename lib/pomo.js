// Minuteur pomodoro — partagé par le minuteur principal du stream et les
// petits minuteurs individuels du chat. Tout repose sur des horodatages
// absolus (endsAt) : un redémarrage du serveur ou une synchro ne décale rien.
const MIN = 60 * 1000;

function create({ work = 25, brk = 5, goal = 1, label = '' } = {}, now = Date.now()) {
    return {
        label: String(label || '').slice(0, 60),
        work, brk, goal,
        completed: 0,
        phase: 'work',
        phaseDuration: work * MIN,
        endsAt: now + work * MIN,
        remaining: null,
        paused: false,
        startedAt: now,
        doneAt: null
    };
}

function remaining(p, now = Date.now()) {
    if (!p) return 0;
    if (p.phase === 'done') return 0;
    if (p.paused) return Math.max(0, p.remaining || 0);
    return Math.max(0, p.endsAt - now);
}

function startPhase(p, phase, now) {
    p.phase = phase;
    const dur = (phase === 'work' ? p.work : p.brk) * MIN;
    p.phaseDuration = dur;
    p.endsAt = now + dur;
    p.remaining = null;
    p.paused = false;
}

// Passe à la phase suivante. Renvoie l'évènement : 'break' | 'work' | 'done'.
function advance(p, now = Date.now()) {
    if (p.phase === 'work') {
        p.completed++;
        // La pause suit aussi le dernier focus (!pomo 25/5 = 25 min puis 5 min).
        if (p.brk > 0) { startPhase(p, 'break', now); return 'break'; }
        if (p.completed >= p.goal) return finish(p, now, false);
        startPhase(p, 'work', now);
        return 'work';
    }
    if (p.phase === 'break') {
        if (p.completed >= p.goal) return finish(p, now, false);
        startPhase(p, 'work', now);
        return 'work';
    }
    return 'done';
}

function finish(p, now = Date.now(), countWork = true) {
    if (countWork && p.phase === 'work') p.completed = Math.min(p.goal, p.completed + 1);
    p.phase = 'done';
    p.paused = false;
    p.remaining = null;
    p.endsAt = now;
    p.doneAt = now;
    return 'done';
}

function pause(p, now = Date.now()) {
    if (p.paused || p.phase === 'done') return false;
    p.remaining = Math.max(0, p.endsAt - now);
    p.paused = true;
    return true;
}

function resume(p, now = Date.now()) {
    if (!p.paused) return false;
    p.endsAt = now + (p.remaining || 0);
    p.remaining = null;
    p.paused = false;
    return true;
}

function adjust(p, minutes, now = Date.now()) {
    if (p.phase === 'done') return false;
    const delta = minutes * MIN;
    if (p.paused) p.remaining = Math.max(5000, (p.remaining || 0) + delta);
    else p.endsAt = Math.max(now + 5000, p.endsAt + delta);
    p.phaseDuration = Math.max(p.phaseDuration + delta, remaining(p, now));
    return true;
}

// Fait avancer un minuteur dont l'échéance est dépassée. Renvoie la liste
// des évènements (plusieurs si le serveur était éteint longtemps) et si le
// dernier est "frais" (à annoncer dans le chat).
function catchUp(p, now = Date.now()) {
    const events = [];
    let guard = 0;
    while (p && p.phase !== 'done' && !p.paused && now >= p.endsAt && guard++ < 100) {
        const late = now - p.endsAt;
        const at = p.endsAt;
        const ev = advance(p, at);
        events.push({ ev, late });
        if (p.phase !== 'done') {
            // on recale la phase suivante sur l'échéance réelle
            const dur = p.phaseDuration;
            p.endsAt = at + dur;
        }
    }
    return events;
}

function fmt(ms) {
    const s = Math.ceil(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(sec).padStart(2, '0');
}

// Analyse "25", "25/5", "50/10/4" (+ libellé éventuel).
function parseSpec(str) {
    const m = String(str || '').trim().match(/^(\d{1,3})(?:\s*\/\s*(\d{1,3}))?(?:\s*\/\s*(\d{1,2}))?(?:\s+(.*))?$/);
    if (!m) return null;
    const work = Number(m[1]);
    const brk = m[2] !== undefined ? Number(m[2]) : 0;
    const goal = m[3] !== undefined ? Number(m[3]) : 1;
    if (work < 1 || work > 240 || brk > 120 || goal < 1 || goal > 24) return { error: true };
    return { work, brk, goal, label: (m[4] || '').trim() };
}

module.exports = { create, remaining, advance, finish, pause, resume, adjust, catchUp, fmt, parseSpec, MIN };
