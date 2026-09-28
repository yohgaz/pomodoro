// Pomodoro — serveur local.
//   http://localhost:3210/                 → notes IPARA + gestion du stream
//   http://localhost:3210/overlay/tasks    → overlay OBS : liste de tâches du chat
//   http://localhost:3210/overlay/timer    → overlay OBS : minuteur pomodoro
// Voir README.md pour l'installation (PC Windows + MacBook).
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const config = require('./lib/config');
const { Store, newId } = require('./lib/store');
const { GitSync } = require('./lib/sync');
const { StreamEngine } = require('./lib/stream');
const { TwitchBot } = require('./lib/twitch');
const { Notes, KINDS } = require('./lib/notes');

config.load();
const DATA = config.dataDir();
const PUBLIC = path.join(__dirname, 'public');
const VERSION = require('./package.json').version;

const store = new Store(DATA);
const sync = new GitSync({ store, dir: DATA, getConfig: config.get });
const notes = new Notes({ store });
const { Databases } = require('./lib/databases');
const { Planner } = require('./lib/planner');
const dbs = new Databases({ store, notes });
let planner = null;
let bot = null;

const engine = new StreamEngine({
    store,
    getConfig: config.get,
    onTaskDone: task => { if (task.noteId) notes.checkTask(task.noteId, task.text); },
    onNote: (text) => {
        const clean = String(text).trim();
        notes.create({ body: `# ${clean}\n\nCapturé depuis le chat du stream le ${new Date().toLocaleString('fr-FR')}.\n\n#stream/idées\n` });
    }
});

// ── Évènements temps réel (Server-Sent Events) ──
const clients = new Set();
function broadcast(type, data) {
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of clients) {
        if (c.overlay && !['stream', 'hello'].includes(type)) continue;
        try { c.res.write(payload); } catch (e) { /* client parti */ }
    }
}
let streamPending = null;
function pushStream() {
    if (streamPending) return;
    streamPending = setTimeout(() => { streamPending = null; broadcast('stream', engine.snapshot()); }, 120);
}
engine.on('changed', pushStream);
store.on('change', ev => {
    if (ev.col === 'users' || ev.doc === 'stream/meta.json' || ev.doc === 'settings.json') pushStream();
    if (ev.col === 'notes') broadcast('notes', { id: ev.id, updatedAt: ev.obj ? ev.obj.updatedAt : null, deleted: !ev.obj, source: ev.source });
    if (ev.col === 'para') broadcast('para', { id: ev.id, source: ev.source });
    if (ev.doc === 'settings.json') broadcast('settings', engine.settings());
});
sync.on('status', st => broadcast('sync', st));

// ── Accès depuis le réseau local (téléphone) ──
function isLoopback(req) {
    const a = req.socket.remoteAddress || '';
    return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}
const authToken = () => {
    const code = config.get().accessCode;
    return code ? crypto.createHash('sha256').update('pomodoro:' + code).digest('hex') : null;
};
function authorized(req) {
    if (isLoopback(req)) return true;
    const tok = authToken();
    if (!tok) return true;
    const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(p => p.length === 2));
    return cookies.pomodoro_auth === tok;
}

// ── Outils HTTP ──
const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
    '.md': 'text/markdown; charset=utf-8', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.pdf': 'application/pdf'
};

function send(res, status, body, headers = {}) {
    const isObj = typeof body === 'object' && !Buffer.isBuffer(body);
    res.writeHead(status, { 'Content-Type': isObj ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(isObj ? JSON.stringify(body) : body);
}

function readBody(req, limit = 2 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', c => {
            size += c.length;
            if (size > limit) { reject(Object.assign(new Error('contenu trop volumineux'), { status: 413 })); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}
async function readJson(req) {
    const b = await readBody(req);
    if (!b.length) return {};
    try { return JSON.parse(b.toString('utf8')); }
    catch (e) { throw Object.assign(new Error('JSON invalide'), { status: 400 }); }
}

function serveFile(res, file, { cache = false } = {}) {
    fs.stat(file, (err, st) => {
        if (err || !st.isFile()) return send(res, 404, 'Introuvable');
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Content-Length': st.size,
            'Cache-Control': cache ? 'public, max-age=86400' : 'no-cache'
        });
        fs.createReadStream(file).pipe(res);
    });
}

function safeJoin(base, rel) {
    const p = path.normalize(path.join(base, rel));
    return p.startsWith(base) ? p : null;
}

function lanUrls() {
    const c = config.get();
    const out = [];
    if (c.host === '0.0.0.0' || c.host === '::') {
        for (const list of Object.values(os.networkInterfaces())) {
            for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${c.port}`);
        }
        out.push(`http://${os.hostname().replace(/\.local$/, '')}.local:${c.port}`);
    }
    return out;
}

function state() {
    return {
        version: VERSION,
        config: config.publicView(),
        lanUrls: lanUrls(),
        hasAccessCode: !!config.get().accessCode,
        sync: sync.status,
        bot: bot ? bot.status() : null,
        settings: engine.settings()
    };
}

// ── Routes API ──
const routes = [];
const route = (method, pattern, fn) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, fn });
};

route('GET', '/api/state', () => state());

// Notes
route('GET', '/api/notes', ({ query }) => notes.list({ view: query.get('view') || 'all', q: query.get('q') || '', sort: query.get('sort') || 'updated' }));
route('GET', '/api/notes/counts', () => ({ counts: notes.counts(), tags: notes.tags(), containers: notes.containers().sort((a, b) => (a.order || 0) - (b.order || 0)) }));
route('POST', '/api/notes', async ({ req }) => {
    const b = await readJson(req);
    const n = notes.create({ body: b.body || '', container: b.container || null });
    return { ...n, meta: notes.meta(n) };
});
route('GET', '/api/notes/:id', ({ params }) => {
    const n = notes.get(params.id);
    if (!n) throw Object.assign(new Error('note introuvable'), { status: 404 });
    return { ...n, meta: notes.meta(n) };
});
route('PUT', '/api/notes/:id', async ({ req, params }) => {
    const b = await readJson(req);
    const cur = notes.get(params.id);
    if (!cur) throw Object.assign(new Error('note introuvable'), { status: 404 });
    // Garde-fou : si la note a été modifiée ailleurs (autre machine, autre
    // onglet) depuis que le navigateur l'a chargée, on le signale au lieu
    // d'écraser silencieusement.
    if (b.body !== undefined && b.baseUpdatedAt && cur.updatedAt > b.baseUpdatedAt && cur.body !== b.body && !b.force) {
        return { conflict: true, note: { ...cur, meta: notes.meta(cur) } };
    }
    const n = notes.update(params.id, b);
    return { ...n, meta: notes.meta(n) };
});
route('DELETE', '/api/notes/:id', ({ params }) => ({ ok: notes.remove(params.id) }));
route('POST', '/api/notes/trash/empty', () => ({ removed: notes.emptyTrash() }));
route('GET', '/api/notes/:id/backlinks', ({ params }) => notes.backlinks(params.id));
route('GET', '/api/notes/:id/history', async ({ params }) => sync.history(store.relOf('notes', params.id)));
route('GET', '/api/notes/:id/history/:sha', async ({ params }) => {
    const raw = await sync.showVersion(store.relOf('notes', params.id), params.sha);
    return { body: require('./lib/markdown-file').parse(raw).body };
});
route('GET', '/api/resolve', ({ query }) => {
    const n = notes.findByTitle(query.get('title') || '');
    return n ? { id: n.id } : { id: null };
});
route('POST', '/api/notes/:id/send-task', async ({ req, params }) => {
    const b = await readJson(req);
    const text = String(b.text || '').replace(/\s*🎥\s*$/, '').trim();
    return engine.web('add', { login: engine.streamerLogin() || 'moi', text, where: b.where || 'backlog', noteId: params.id });
});
route('GET', '/api/tags', () => notes.tags());

// Tâches de toutes les notes, modèles, revue hebdomadaire
route('GET', '/api/tasks', () => notes.openTasks());
route('POST', '/api/tasks/toggle', async ({ req }) => {
    const b = await readJson(req);
    const n = notes.toggleTask(b.noteId, Number(b.line), String(b.raw || ''), b.checked);
    if (!n) throw Object.assign(new Error('case introuvable (la note a changé ?)'), { status: 409 });
    return { ok: true, updatedAt: n.updatedAt };
});
route('GET', '/api/templates', () => notes.templates());
route('POST', '/api/templates/seed', () => ({ created: notes.seedTemplates() }));
route('POST', '/api/notes/from-template', async ({ req }) => {
    const b = await readJson(req);
    const n = notes.fromTemplate(b.templateId, { container: b.container });
    if (!n) throw Object.assign(new Error('modèle introuvable'), { status: 404 });
    return { ...n, meta: notes.meta(n) };
});
route('GET', '/api/review', () => ({ ...notes.reviewData(), review: engine.settings().review }));
route('POST', '/api/review/done', () => engine.saveSettings({ review: { lastAt: Date.now() } }).review);
route('POST', '/api/tags/rename', async ({ req }) => { const b = await readJson(req); return { changed: notes.renameTag(b.from, b.to) }; });

// Conteneurs IPARA
route('GET', '/api/para', () => notes.containers());
route('POST', '/api/para', async ({ req }) => notes.saveContainer(await readJson(req)));
route('PUT', '/api/para/:id', async ({ req, params }) => {
    if (!notes.container(params.id)) throw Object.assign(new Error('introuvable'), { status: 404 });
    return notes.saveContainer({ ...(await readJson(req)), id: params.id });
});
route('DELETE', '/api/para/:id', ({ params }) => ({ ok: notes.removeContainer(params.id) }));

// Import / export Markdown
route('POST', '/api/import', async ({ req }) => {
    const b = await readJson(req);
    const created = [];
    for (const f of (b.files || []).slice(0, 500)) {
        let body = String(f.content || '');
        const parsed = require('./lib/markdown-file').parse(body);
        body = parsed.body;
        if (!require('./lib/markdown-file').titleOf(body) && f.name) body = `# ${f.name.replace(/\.(md|markdown|txt)$/i, '')}\n\n${body}`;
        created.push(notes.create({ body, container: b.container || null }).id);
    }
    return { created: created.length };
});
route('POST', '/api/export', () => {
    const out = path.join(config.ROOT, 'export', new Date().toISOString().slice(0, 10));
    const folders = { inbox: '0 - Inbox', project: '1 - Projets', area: '2 - Domaines', resource: '3 - Ressources', archive: '4 - Archives' };
    const clean = s => String(s).replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90) || 'Sans titre';
    fs.rmSync(out, { recursive: true, force: true });
    let count = 0;
    for (const n of notes.all()) {
        if (n.trashed) continue;
        const c = notes.container(n.container);
        const dir = notes.isArchived(n)
            ? path.join(out, folders.archive, c ? clean(c.name) : '')
            : c ? path.join(out, folders[c.kind], clean(c.name)) : path.join(out, folders.inbox);
        fs.mkdirSync(dir, { recursive: true });
        let file = path.join(dir, clean(notes.meta(n).title) + '.md');
        let i = 2;
        while (fs.existsSync(file)) file = path.join(dir, `${clean(notes.meta(n).title)} (${i++}).md`);
        fs.writeFileSync(file, n.body);
        try { fs.utimesSync(file, new Date(n.updatedAt), new Date(n.updatedAt)); } catch (e) { /* rien */ }
        count++;
    }
    const files = path.join(DATA, 'files');
    if (fs.existsSync(files)) fs.cpSync(files, path.join(out, 'files'), { recursive: true });
    return { count, path: out };
});

// Pièces jointes (images collées/déposées dans une note)
route('POST', '/api/files', async ({ req, query }) => {
    const buf = await readBody(req, 25 * 1024 * 1024);
    const name = String(query.get('name') || 'fichier').toLowerCase();
    const ext = (path.extname(name).match(/^\.[a-z0-9]{1,5}$/) || ['.bin'])[0];
    const file = `${newId()}${ext}`;
    fs.mkdirSync(path.join(DATA, 'files'), { recursive: true });
    fs.writeFileSync(path.join(DATA, 'files', file), buf);
    sync.schedule();
    return { url: `/files/${file}` };
});

// Bases de données
route('GET', '/api/dbs', () => dbs.list());
route('POST', '/api/dbs', async ({ req }) => dbs.save(await readJson(req)));
route('POST', '/api/dbs/seed-recipes', () => { const r = dbs.seedRecipes(); return { id: r.db.id, created: r.created }; });
route('GET', '/api/dbs/:id', ({ params }) => { const d = dbs.get(params.id); if (!d) throw Object.assign(new Error('base introuvable'), { status: 404 }); return d; });
route('PUT', '/api/dbs/:id', async ({ req, params }) => dbs.save({ ...(await readJson(req)), id: params.id }));
route('DELETE', '/api/dbs/:id', ({ params }) => ({ ok: dbs.remove(params.id) }));
route('GET', '/api/dbs/:id/rows', ({ params }) => dbs.rows(params.id));
route('POST', '/api/dbs/:id/rows', async ({ req, params }) => { const n = dbs.createRow(params.id, await readJson(req)); return { ...n, meta: notes.meta(n) }; });
route('PUT', '/api/rows/:id/props', async ({ req, params }) => { const n = dbs.setProps(params.id, await readJson(req)); if (!n) throw Object.assign(new Error('fiche introuvable'), { status: 404 }); return n.props; });

// Calendrier, repas, liste de courses
route('GET', '/api/calendar', ({ query }) => planner.between(query.get('from') || '0000-00-00', query.get('to') || '9999-12-31'));
route('POST', '/api/calendar', async ({ req }) => planner.save(await readJson(req)));
route('PUT', '/api/calendar/:id', async ({ req, params }) => planner.save({ ...(await readJson(req)), id: params.id }));
route('DELETE', '/api/calendar/:id', ({ params }) => ({ ok: planner.remove(params.id) }));
route('POST', '/api/meals/plan', async ({ req }) => planner.planMeal(await readJson(req)));
route('POST', '/api/shopping/refresh', () => { const n = planner.refreshShopping(); return { id: n.id }; });

// Stream
route('GET', '/api/stream', () => engine.snapshot());
route('GET', '/api/stream/users', () => engine.store.list('users').filter(u => !u.login.startsWith('_')).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
route('GET', '/api/stream/users/:login', ({ params }) => {
    const u = engine.getUser(params.login, {}, false);
    return u || engine.getUser(params.login, {}, true);
});
route('POST', '/api/stream/action', async ({ req }) => {
    const b = await readJson(req);
    return engine.web(b.op, b);
});
route('GET', '/api/settings', () => engine.settings());
route('GET', '/api/commands', () => require('./lib/commands-list').commandsFor(engine.settings().chat));
route('PUT', '/api/settings', async ({ req }) => engine.saveSettings(await readJson(req)));

// Réglages locaux de la machine
route('GET', '/api/config', () => config.publicView());
route('PUT', '/api/config', async ({ req }) => {
    const b = await readJson(req);
    const patch = {};
    if (b.machineName) patch.machineName = String(b.machineName).slice(0, 40);
    if (b.sync) patch.sync = {
        ...(b.sync.remote !== undefined ? { remote: String(b.sync.remote).trim() } : {}),
        ...(b.sync.enabled !== undefined ? { enabled: !!b.sync.enabled } : {})
    };
    if (b.twitch) {
        patch.twitch = {};
        if (b.twitch.channel !== undefined) patch.twitch.channel = String(b.twitch.channel).trim().toLowerCase().replace(/^#/, '');
        if (b.twitch.botUsername !== undefined) patch.twitch.botUsername = String(b.twitch.botUsername).trim().toLowerCase();
        if (b.twitch.botToken) patch.twitch.botToken = String(b.twitch.botToken).trim();
        if (b.twitch.clearToken) patch.twitch.botToken = '';
    }
    if (b.bot && ['auto', 'on', 'off'].includes(b.bot.mode)) patch.bot = { mode: b.bot.mode };
    if (b.accessCode !== undefined) patch.accessCode = String(b.accessCode).trim();
    if (b.host && ['127.0.0.1', '0.0.0.0'].includes(b.host)) patch.host = b.host;
    config.save(patch);
    if (bot) bot.reconcile();
    if (patch.sync) sync.run('réglages');
    return state();
});

// Synchro
route('GET', '/api/sync', () => sync.status);
route('POST', '/api/sync/now', async () => sync.run('manuel'));

// Connexion depuis le téléphone
route('POST', '/api/login', async ({ req, res }) => {
    const b = await readJson(req);
    const tok = authToken();
    if (!tok || b.code !== config.get().accessCode) throw Object.assign(new Error('code incorrect'), { status: 401 });
    res.setHeader('Set-Cookie', `pomodoro_auth=${tok}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`);
    return { ok: true };
});

// ── Serveur ──
async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);

    if (!authorized(req) && p !== '/api/login' && !p.startsWith('/login') && !/^\/(icon|manifest)/.test(p)) {
        if (p.startsWith('/api/')) return send(res, 401, { error: 'code d’accès requis' });
        return serveFile(res, path.join(PUBLIC, 'app', 'login.html'));
    }

    if (p === '/api/events') return events(req, res, url);

    if (p.startsWith('/api/')) {
        for (const r of routes) {
            if (r.method !== req.method) continue;
            const m = p.match(r.re);
            if (!m) continue;
            const params = {};
            r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
            try {
                const out = await r.fn({ req, res, params, query: url.searchParams });
                return send(res, 200, out === undefined ? { ok: true } : out);
            } catch (e) {
                if (!e.status) console.error('API', req.method, p, e);
                return send(res, e.status || 500, { error: e.message });
            }
        }
        return send(res, 404, { error: 'route inconnue' });
    }

    // lib/kitchen.js servi au navigateur (même calcul d'ingrédients que le serveur)
    if (p === '/app/js/kitchen-client.js') {
        const src = fs.readFileSync(path.join(__dirname, 'lib', 'kitchen.js'), 'utf8').replace(/module\.exports\s*=\s*\{([^}]*)\};?\s*$/, 'export {$1};\n');
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(src);
    }
    if (p.startsWith('/files/')) {
        const f = safeJoin(path.join(DATA, 'files'), p.slice(7));
        return f ? serveFile(res, f, { cache: true }) : send(res, 400, 'Chemin invalide');
    }
    if (['/overlay/tasks', '/overlay/timer', '/overlay/commands', '/overlay/scene'].includes(p)) return serveFile(res, path.join(PUBLIC, 'overlay', p.slice(9) + '.html'));
    // Panneau de contrôle à ancrer dans OBS (Docks → Custom Browser Docks).
    if (p === '/dock') return serveFile(res, path.join(PUBLIC, 'dock', 'index.html'));
    if (p === '/' || p === '/index.html' || p.startsWith('/n/') || p.startsWith('/v/') || p.startsWith('/stream') || p.startsWith('/db/') || ['/timer', '/settings', '/tasks', '/review', '/calendar'].includes(p)) {
        return serveFile(res, path.join(PUBLIC, 'app', 'index.html'));
    }
    // Aperçu local de l'app mobile (publiée sur GitHub Pages depuis docs/).
    if (p === '/m') { res.writeHead(302, { Location: '/m/' }); return res.end(); }
    if (p.startsWith('/m/')) {
        const f = safeJoin(path.join(__dirname, 'docs'), p.endsWith('/') ? p.slice(3) + 'index.html' : p.slice(3));
        return f ? serveFile(res, f) : send(res, 400, 'Chemin invalide');
    }
    if (p === '/sw.js' || p === '/manifest.webmanifest') return serveFile(res, path.join(PUBLIC, p.slice(1)));
    const f = safeJoin(PUBLIC, p);
    if (!f) return send(res, 400, 'Chemin invalide');
    return serveFile(res, f);
}

function events(req, res, url) {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    const client = { res, overlay: url.searchParams.get('overlay') === '1', obs: url.searchParams.get('obs') === '1' };
    clients.add(client);
    if (client.obs && bot) bot.obsHeartbeat();
    res.write(`retry: 2000\nevent: hello\ndata: ${JSON.stringify({ version: VERSION })}\n\n`);
    res.write(`event: stream\ndata: ${JSON.stringify(engine.snapshot())}\n\n`);
    if (!client.overlay) {
        res.write(`event: sync\ndata: ${JSON.stringify(sync.status)}\n\n`);
        if (bot) res.write(`event: bot\ndata: ${JSON.stringify(bot.status())}\n\n`);
    }
    req.on('close', () => clients.delete(client));
}

// Ping régulier : garde les connexions ouvertes et signale au bot qu'un
// overlay OBS est toujours affiché sur cette machine.
setInterval(() => {
    let obs = 0;
    for (const c of clients) { if (c.obs) obs++; try { c.res.write(': ping\n\n'); } catch (e) { /* rien */ } }
    if (obs && bot) bot.obsHeartbeat();
}, 25000);

async function main() {
    console.log(`🍅 Pomodoro ${VERSION} — machine « ${config.get().machineName} »`);
    console.log(`📁 Données : ${DATA}`);
    await sync.init();
    store.init();
    if (notes.seed()) console.log('🌱 Espace de notes d’exemple créé');
    notes.purgeTrash();
    planner = new Planner({ store, notes, dbs, getSettings: () => engine.settings() });
    // L'app mobile a besoin de savoir quelle liste est celle du streamer.
    const chan = engine.streamerLogin();
    if (chan && engine.settings().streamerLogin !== chan) engine.saveSettings({ streamerLogin: chan });
    store.flush();

    bot = new TwitchBot({ getConfig: config.get, engine });
    bot.on('status', () => broadcast('bot', bot.status()));
    engine.startTicking(msg => bot.say(msg));
    bot.start();
    sync.start();

    const c = config.get();
    const server = http.createServer((req, res) => {
        handle(req, res).catch(e => { console.error(e); try { send(res, 500, { error: e.message }); } catch (e2) { /* rien */ } });
    });
    server.on('error', e => {
        // Code 3 = déjà lancé : les lanceurs (Windows/Mac) ne réessaient pas.
        if (e.code === 'EADDRINUSE') { console.error(`❌ Le port ${c.port} est déjà utilisé — Pomodoro tourne sans doute déjà.`); process.exit(3); }
        console.error('❌', e);
        process.exit(1);
    });
    server.listen(c.port, c.host, () => {
        console.log(`✅ Espace de travail : http://localhost:${c.port}/`);
        console.log(`🎥 Overlay tâches    : http://localhost:${c.port}/overlay/tasks`);
        console.log(`⏱️  Overlay minuteur  : http://localhost:${c.port}/overlay/timer`);
        for (const u of lanUrls()) console.log(`📱 Réseau local      : ${u}`);
    });

    let stopping = false;
    const stop = async () => {
        if (stopping) return;
        stopping = true;
        console.log('\n👋 Arrêt : dernière synchro…');
        try { store.flush(); await Promise.race([sync.run('arrêt'), new Promise(r => setTimeout(r, 8000))]); } catch (e) { /* rien */ }
        process.exit(0);
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
}

main().catch(e => { console.error('❌ Démarrage impossible :', e); process.exit(1); });
