// Synchro entre machines via git.
//
// Le dossier de données est un dépôt git à part entière, relié à un dépôt
// PRIVÉ sur GitHub qui sert uniquement de point de rendez-vous. Chaque
// machine garde une copie COMPLÈTE des données et fonctionne seule : si
// l'autre est éteinte (ou s'il n'y a pas d'internet), rien ne bloque — les
// modifications s'accumulent en commits locaux et partent à la prochaine
// synchro réussie.
//
// Cycle (toutes les 30 s, et quelques secondes après chaque modification) :
//   1. commit local de ce qui a changé ;
//   2. fetch ;
//   3. fusion avec la version distante — en cas de conflit sur un même
//      fichier (même page modifiée des deux côtés entre deux synchros), la
//      version dont "updatedAt" est la plus récente gagne ; une modification
//      l'emporte toujours sur une suppression ;
//   4. push.
// Bonus : l'historique git sert d'historique des versions de chaque page.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const EventEmitter = require('events');
const md = require('./markdown-file');

function git(cwd, args, { timeout = 60000, allowFail = false } = {}) {
    return new Promise((resolve, reject) => {
        execFile('git', args, {
            cwd,
            timeout,
            maxBuffer: 64 * 1024 * 1024,
            windowsHide: true,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' }
        }, (err, stdout, stderr) => {
            const out = { code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) };
            if (err && !allowFail) {
                const e = new Error((stderr || err.message || '').toString().trim().split('\n').slice(-3).join(' | '));
                e.result = out;
                return reject(e);
            }
            resolve(out);
        });
    });
}

class GitSync extends EventEmitter {
    constructor({ store, dir, getConfig }) {
        super();
        this.store = store;
        this.dir = dir;
        this.getConfig = getConfig;
        this.running = false;
        this.rerun = false;
        this.timer = null;
        this.debounce = null;
        this.status = { state: 'init', lastSync: null, lastAttempt: null, lastError: null, remote: '', ahead: 0, behind: 0, gitAvailable: true };
    }

    cfg() { return this.getConfig().sync || {}; }
    branch() { return this.cfg().branch || 'main'; }

    setStatus(patch) {
        Object.assign(this.status, patch);
        this.emit('status', { ...this.status });
    }

    // Prépare le dossier de données : clone du dépôt distant s'il est
    // configuré et que le dossier n'existe pas encore, sinon dépôt local.
    async init() {
        try { await git(process.cwd(), ['--version']); }
        catch (e) {
            this.setStatus({ state: 'disabled', gitAvailable: false, lastError: 'git introuvable sur cette machine — synchro désactivée' });
            fs.mkdirSync(this.dir, { recursive: true });
            return;
        }
        const remote = (this.cfg().remote || '').trim();
        const hasGit = fs.existsSync(path.join(this.dir, '.git'));
        const isEmptyDir = !fs.existsSync(this.dir) || fs.readdirSync(this.dir).length === 0;
        if (!hasGit && remote && isEmptyDir) {
            try {
                console.log(`🔄 Clonage des données depuis ${remote}…`);
                await git(path.dirname(this.dir), ['clone', remote, path.basename(this.dir)], { timeout: 180000 });
            } catch (e) {
                console.error('⚠️  Clonage impossible, démarrage avec un dépôt local vide :', e.message);
            }
        }
        fs.mkdirSync(this.dir, { recursive: true });
        if (!fs.existsSync(path.join(this.dir, '.git'))) {
            await git(this.dir, ['init', '-q']);
            await git(this.dir, ['symbolic-ref', 'HEAD', `refs/heads/${this.branch()}`]);
        }
        const machine = this.getConfig().machineName || 'machine';
        await git(this.dir, ['config', 'user.name', `Pomodoro (${machine})`]);
        await git(this.dir, ['config', 'user.email', `pomodoro@${machine.replace(/[^a-zA-Z0-9.-]/g, '-')}.local`]);
        await git(this.dir, ['config', 'core.autocrlf', 'false']);
        await git(this.dir, ['config', 'core.quotepath', 'false']);
        // Une fusion interrompue (coupure pendant une synchro) est abandonnée
        // proprement ; elle sera rejouée au prochain cycle.
        if (fs.existsSync(path.join(this.dir, '.git', 'MERGE_HEAD'))) {
            await git(this.dir, ['merge', '--abort'], { allowFail: true });
        }
        await this.applyRemote();
        const gi = path.join(this.dir, '.gitignore');
        if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*.tmp\n.DS_Store\n');
        this.setStatus({ state: remote ? 'idle' : 'local', remote });
    }

    async applyRemote() {
        const remote = (this.cfg().remote || '').trim();
        const cur = await git(this.dir, ['remote', 'get-url', 'origin'], { allowFail: true });
        if (!remote) {
            if (cur.code === 0) await git(this.dir, ['remote', 'remove', 'origin'], { allowFail: true });
        } else if (cur.code !== 0) {
            await git(this.dir, ['remote', 'add', 'origin', remote]);
        } else if (cur.stdout.trim() !== remote) {
            await git(this.dir, ['remote', 'set-url', 'origin', remote]);
        }
        this.status.remote = remote;
    }

    start() {
        const every = Math.max(10, Number(this.cfg().intervalSeconds) || 30) * 1000;
        clearInterval(this.timer);
        this.timer = setInterval(() => this.run('périodique'), every);
        this.store.on('flushed', () => this.schedule());
        this.run('démarrage');
    }

    stop() { clearInterval(this.timer); clearTimeout(this.debounce); }

    // Synchro rapprochée après une modification locale (anti-rebond 4 s).
    schedule() {
        if (this.status.state === 'disabled' || !this.cfg().enabled) return;
        clearTimeout(this.debounce);
        this.debounce = setTimeout(() => this.run('modification'), 4000);
    }

    async run(reason = 'manuel') {
        if (this.status.state === 'disabled') return this.status;
        if (this.running) { this.rerun = true; return this.status; }
        this.running = true;
        this.store.flush();
        this.store.suspend();
        try {
            this.setStatus({ state: 'syncing', lastAttempt: Date.now() });
            await this._cycle(reason);
        } catch (e) {
            console.error('⚠️  Synchro :', e.message);
            this.setStatus({ state: /could not resolve|unable to access|timed out|network|connect/i.test(e.message) ? 'offline' : 'error', lastError: e.message });
        } finally {
            this.store.resume();
            this.running = false;
            if (this.rerun) { this.rerun = false; setTimeout(() => this.run('relance'), 500); }
        }
        return this.status;
    }

    async _commitLocal(message) {
        await git(this.dir, ['add', '-A']);
        const st = await git(this.dir, ['status', '--porcelain']);
        if (!st.stdout.trim()) return false;
        const n = st.stdout.trim().split('\n').length;
        await git(this.dir, ['commit', '-q', '-m', message || `${this.getConfig().machineName} · ${n} fichier${n > 1 ? 's' : ''} modifié${n > 1 ? 's' : ''}`]);
        return true;
    }

    async _cycle() {
        const cfg = this.cfg();
        await this.applyRemote();
        await this._commitLocal();
        const remote = (cfg.remote || '').trim();
        if (!remote || !cfg.enabled) {
            this.setStatus({ state: 'local', lastError: null, lastSync: Date.now() });
            return;
        }
        const branch = this.branch();
        await git(this.dir, ['fetch', '-q', 'origin', branch], { timeout: 45000 }).catch(async e => {
            // Dépôt distant tout neuf (vide) : la branche n'existe pas encore.
            if (/couldn't find remote ref|could not find remote ref/i.test(e.message)) return null;
            throw e;
        });
        const hasRemoteBranch = (await git(this.dir, ['rev-parse', '--verify', '-q', `refs/remotes/origin/${branch}`], { allowFail: true })).code === 0;
        const hasHead = (await git(this.dir, ['rev-parse', '--verify', '-q', 'HEAD'], { allowFail: true })).code === 0;
        if (!hasRemoteBranch) {
            if (hasHead) await git(this.dir, ['push', '-q', '-u', 'origin', `HEAD:${branch}`], { timeout: 90000 });
            this.setStatus({ state: 'idle', lastSync: Date.now(), lastError: null, ahead: 0, behind: 0 });
            return;
        }
        let ahead = 0, behind = 0;
        if (hasHead) {
            const counts = await git(this.dir, ['rev-list', '--left-right', '--count', `HEAD...origin/${branch}`]);
            [ahead, behind] = counts.stdout.trim().split(/\s+/).map(Number);
        } else {
            behind = 1;
        }
        let changed = [];
        if (behind > 0) {
            const before = hasHead ? (await git(this.dir, ['rev-parse', 'HEAD'])).stdout.trim() : null;
            if (!hasHead) {
                await git(this.dir, ['reset', '-q', '--hard', `origin/${branch}`]);
            } else if (ahead === 0) {
                await git(this.dir, ['merge', '-q', '--ff-only', `origin/${branch}`]);
            } else {
                const m = await git(this.dir, ['merge', '-q', '--no-ff', '--no-commit', '--allow-unrelated-histories', `origin/${branch}`], { allowFail: true });
                if (m.code !== 0) await this._resolveConflicts();
                await git(this.dir, ['commit', '-q', '--no-edit', '-m', `${this.getConfig().machineName} · fusion avec l'autre machine`], { allowFail: true });
            }
            const diffArgs = before ? ['diff', '--name-only', before, 'HEAD'] : ['ls-files'];
            changed = (await git(this.dir, diffArgs)).stdout.split('\n').map(s => s.trim()).filter(Boolean);
        }
        if (ahead > 0 || behind > 0) {
            const push = await git(this.dir, ['push', '-q', 'origin', `HEAD:${branch}`], { timeout: 90000, allowFail: true });
            if (push.code !== 0) {
                if (/rejected|fetch first|non-fast-forward/i.test(push.stderr)) this.rerun = true;
                else throw new Error(push.stderr.trim().split('\n').slice(-2).join(' | '));
            }
        }
        if (changed.length) this.store.reloadPaths(changed);
        this.setStatus({ state: 'idle', lastSync: Date.now(), lastError: null, ahead: 0, behind: 0 });
    }

    async _resolveConflicts() {
        const list = (await git(this.dir, ['diff', '--name-only', '--diff-filter=U'])).stdout.split('\n').map(s => s.trim()).filter(Boolean);
        for (const f of list) {
            const ours = await git(this.dir, ['show', `:2:${f}`], { allowFail: true });
            const theirs = await git(this.dir, ['show', `:3:${f}`], { allowFail: true });
            let pick = null;
            if (ours.code !== 0 && theirs.code !== 0) pick = null;
            else if (ours.code !== 0) pick = theirs.stdout;
            else if (theirs.code !== 0) pick = ours.stdout;
            else if (f.endsWith('.json')) {
                let a = null, b = null;
                try { a = JSON.parse(ours.stdout); } catch (e) { /* illisible */ }
                try { b = JSON.parse(theirs.stdout); } catch (e) { /* illisible */ }
                if (!a) pick = theirs.stdout;
                else if (!b) pick = ours.stdout;
                else pick = (b.updatedAt || 0) > (a.updatedAt || 0) ? theirs.stdout : ours.stdout;
            } else if (f.endsWith('.md')) {
                pick = md.updatedOf(theirs.stdout) > md.updatedOf(ours.stdout) ? theirs.stdout : ours.stdout;
            } else {
                pick = ours.stdout;
            }
            const full = path.join(this.dir, f);
            if (pick === null) {
                await git(this.dir, ['rm', '-q', '--cached', f], { allowFail: true });
                try { fs.unlinkSync(full); } catch (e) { /* rien */ }
            } else {
                fs.mkdirSync(path.dirname(full), { recursive: true });
                fs.writeFileSync(full, pick);
                await git(this.dir, ['add', f]);
            }
            console.log(`🔀 Conflit résolu automatiquement : ${f}`);
        }
    }

    // ── Historique des versions d'un fichier (pages) ──
    async history(rel, limit = 60) {
        if (this.status.state === 'disabled') return [];
        const r = await git(this.dir, ['log', `-n${limit}`, '--format=%H%x09%at%x09%an', '--', rel], { allowFail: true });
        if (r.code !== 0) return [];
        return r.stdout.split('\n').filter(Boolean).map(line => {
            const [sha, at, author] = line.split('\t');
            return { sha, at: Number(at) * 1000, author: author.replace(/^Pomodoro \((.*)\)$/, '$1') };
        });
    }

    async showVersion(rel, sha) {
        if (!/^[0-9a-f]{7,40}$/.test(sha)) throw new Error('version invalide');
        const r = await git(this.dir, ['show', `${sha}:${rel}`]);
        return r.stdout;
    }
}

module.exports = { GitSync, git };
