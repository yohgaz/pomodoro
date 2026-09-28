// Réglages LOCAUX à la machine (config.json, jamais synchronisé ni versionné) :
// port, dossier de données, dépôt de synchro, identité du bot Twitch, mode du
// bot. Les réglages partagés entre machines (apparence de l'overlay, textes,
// modération…) vivent dans data/settings.json et passent par la synchro.
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'config.json');

const DEFAULTS = {
    port: 3210,
    // 127.0.0.1 = accessible uniquement depuis cette machine. Mettre
    // "0.0.0.0" pour ouvrir l'espace de travail au réseau local (téléphone…).
    host: '127.0.0.1',
    machineName: os.hostname().replace(/\.local$/, ''),
    dataDir: 'data',
    sync: {
        enabled: true,
        // URL du dépôt git PRIVÉ qui sert de point de rendez-vous entre les
        // machines (ex. https://github.com/yohgaz/pomodoro-data.git).
        remote: '',
        branch: 'main',
        intervalSeconds: 30
    },
    twitch: {
        channel: '',
        botUsername: '',
        botToken: ''
    },
    // "auto" : le bot ne se connecte au chat que si un overlay est ouvert dans
    // OBS sur CETTE machine — seule la machine qui diffuse répond au chat, sans
    // doublon si les deux serveurs tournent en même temps.
    // "on" : toujours connecté. "off" : jamais.
    bot: {
        mode: 'auto'
    }
};

function deepMerge(base, extra) {
    const out = Array.isArray(base) ? [...base] : { ...base };
    for (const [k, v] of Object.entries(extra || {})) {
        if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
            out[k] = deepMerge(base[k], v);
        } else {
            out[k] = v;
        }
    }
    return out;
}

let current = null;

function load() {
    let raw = {};
    if (fs.existsSync(CONFIG_PATH)) {
        try { raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
        catch (e) { console.error('⚠️  config.json illisible, valeurs par défaut utilisées :', e.message); }
    }
    current = deepMerge(DEFAULTS, raw);
    if (process.env.POMODORO_PORT) current.port = Number(process.env.POMODORO_PORT);
    if (process.env.POMODORO_DATA) current.dataDir = process.env.POMODORO_DATA;
    return current;
}

function get() { return current || load(); }

function save(patch) {
    let raw = {};
    if (fs.existsSync(CONFIG_PATH)) {
        try { raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch (e) { raw = {}; }
    }
    raw = deepMerge(raw, patch);
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(raw, null, 2) + '\n');
    return load();
}

function dataDir() {
    const d = get().dataDir;
    return path.isAbsolute(d) ? d : path.join(ROOT, d);
}

// Version présentable au navigateur : le jeton du bot n'est jamais renvoyé,
// seulement le fait qu'il soit renseigné.
function publicView() {
    const c = get();
    return {
        port: c.port,
        host: c.host,
        machineName: c.machineName,
        dataDir: dataDir(),
        sync: { ...c.sync },
        twitch: {
            channel: c.twitch.channel,
            botUsername: c.twitch.botUsername,
            hasToken: !!c.twitch.botToken
        },
        bot: { ...c.bot }
    };
}

module.exports = { load, get, save, dataDir, publicView, ROOT };
