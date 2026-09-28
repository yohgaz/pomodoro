// Lecture/écriture d'une note : en-tête YAML minimal + corps Markdown.
//
// ---
// id: lq3x9a1b2c3d
// created: 2026-09-28T10:12:00.000Z
// updated: 2026-09-28T10:15:42.000Z
// container: projet-id      (absent = Inbox)
// pinned: true
// ---
// # Titre de la note
// …
//
// Comme dans Bear, le titre est la première ligne du texte (pas un champ à
// part). Les clés inconnues (ajoutées par un autre logiciel) sont conservées.
const KNOWN = {
    id: 'id', created: 'createdAt', updated: 'updatedAt', container: 'container',
    pinned: 'pinned', archived: 'archived', trashed: 'trashed', trashedAt: 'trashedAt',
    // Fiche d'une base de données : id de la base + propriétés (JSON sur une ligne).
    db: 'db', props: 'props'
};
const DATE_KEYS = new Set(['createdAt', 'updatedAt', 'trashedAt']);
const BOOL_KEYS = new Set(['pinned', 'archived', 'trashed']);

function parseValue(v) {
    v = v.trim();
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (/^".*"$/.test(v)) { try { return JSON.parse(v); } catch (e) { return v.slice(1, -1); } }
    return v;
}

function parse(text) {
    text = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n');
    const note = { body: text, extra: {} };
    const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
    if (m) {
        note.body = text.slice(m[0].length);
        for (const line of m[1].split('\n')) {
            const kv = line.match(/^([A-Za-z_][\w-]*):\s?(.*)$/);
            if (!kv) continue;
            const key = KNOWN[kv[1]];
            const val = parseValue(kv[2]);
            if (!key) { note.extra[kv[1]] = kv[2]; continue; }
            if (key === 'props') { try { note.props = JSON.parse(kv[2]); } catch (e) { note.props = {}; } continue; }
            if (DATE_KEYS.has(key)) { const t = Date.parse(val); if (!isNaN(t)) note[key] = t; }
            else if (BOOL_KEYS.has(key)) note[key] = val === true;
            else note[key] = String(val);
        }
    }
    return note;
}

function fmtValue(v) {
    const s = String(v);
    return /^[\w./@+-]*$/.test(s) && s !== 'true' && s !== 'false' ? s : JSON.stringify(s);
}

function serialize(note) {
    const lines = ['---'];
    lines.push(`id: ${fmtValue(note.id)}`);
    if (note.createdAt) lines.push(`created: ${new Date(note.createdAt).toISOString()}`);
    if (note.updatedAt) lines.push(`updated: ${new Date(note.updatedAt).toISOString()}`);
    if (note.container) lines.push(`container: ${fmtValue(note.container)}`);
    if (note.db) lines.push(`db: ${fmtValue(note.db)}`);
    if (note.db && note.props && Object.keys(note.props).length) lines.push(`props: ${JSON.stringify(note.props)}`);
    if (note.pinned) lines.push('pinned: true');
    if (note.archived) lines.push('archived: true');
    if (note.trashed) lines.push('trashed: true');
    if (note.trashed && note.trashedAt) lines.push(`trashedAt: ${new Date(note.trashedAt).toISOString()}`);
    for (const [k, v] of Object.entries(note.extra || {})) lines.push(`${k}: ${v}`);
    lines.push('---');
    let body = String(note.body || '');
    if (!body.endsWith('\n')) body += '\n';
    return lines.join('\n') + '\n' + body;
}

// "updated" d'un fichier brut (résolution de conflits de synchro).
function updatedOf(text) {
    const m = String(text).match(/^---\r?\n[\s\S]*?^updated:\s*(\S+)/m);
    const t = m ? Date.parse(m[1]) : NaN;
    return isNaN(t) ? 0 : t;
}

// ── Analyse du contenu (titre, tags, liens, tâches) ──
function titleOf(body) {
    for (const line of String(body || '').split('\n')) {
        const t = line.replace(/^#{1,6}\s+/, '').replace(/[*_`~]/g, '').trim();
        if (t) return t.slice(0, 160);
    }
    return '';
}

// Retire les blocs de code avant d'y chercher tags et liens.
function stripCode(body) {
    return String(body || '').replace(/```[\s\S]*?(```|$)/g, '').replace(/`[^`\n]*`/g, '');
}

// Tags à la Bear : #tag, #tag/sous-tag, #tag avec espaces# (forme fermée).
const TAG_RE = /(^|[\s(])#([^\s#][^#\n]*?[^\s#])#(?=$|[\s).,;!?])|(^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*[\p{L}\p{N}_]|[\p{L}\p{N}_])/gu;
function tagsOf(body) {
    const tags = new Set();
    const text = stripCode(body);
    for (const line of text.split('\n')) {
        if (/^\s{0,3}#{1,6}\s/.test(line)) continue; // titres Markdown
        let m;
        TAG_RE.lastIndex = 0;
        while ((m = TAG_RE.exec(line))) {
            const t = (m[2] || m[4] || '').trim().toLowerCase().replace(/\/+$/, '');
            if (t && !/^\d+$/.test(t)) tags.add(t);
        }
    }
    return [...tags];
}

function linksOf(body) {
    const out = new Set();
    const re = /\[\[([^\]\n|]+)(?:\|[^\]\n]*)?\]\]/g;
    let m;
    const text = stripCode(body);
    while ((m = re.exec(text))) out.add(m[1].trim().toLowerCase());
    return [...out];
}

function tasksOf(body) {
    let open = 0, done = 0;
    for (const line of String(body || '').split('\n')) {
        const m = line.match(/^\s*[-*+]\s+\[([ xX])\]\s/);
        if (m) { if (m[1] === ' ') open++; else done++; }
    }
    return { open, done };
}

function excerptOf(body) {
    const lines = String(body || '').split('\n');
    let skippedTitle = false;
    const out = [];
    for (const l of lines) {
        const t = l.trim();
        if (!t) continue;
        if (!skippedTitle) { skippedTitle = true; continue; }
        if (/^```/.test(t)) continue;
        out.push(t.replace(/^#{1,6}\s+/, '').replace(/^[-*+]\s+\[[ xX]\]\s+/, '').replace(/^[-*+>]\s+/, '')
            .replace(/!\[[^\]]*\]\([^)]*\)/g, '🖼️').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, '$1')
            .replace(/[*_~`]/g, ''));
        if (out.join(' ').length > 220) break;
    }
    return out.join(' ').slice(0, 220);
}

// Cases à cocher d'une note, avec échéance éventuelle :
//   - [ ] Appeler le garage 📅 2026-10-02    (ou @2026-10-02)
const DUE_RE = /(?:📅|@)\s?(\d{4}-\d{2}-\d{2})/;
function taskLinesOf(body) {
    const out = [];
    let inCode = false;
    String(body || '').split('\n').forEach((line, i) => {
        if (/^\s*```/.test(line)) { inCode = !inCode; return; }
        if (inCode) return;
        const m = line.match(/^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/);
        if (!m) return;
        const due = (m[2].match(DUE_RE) || [])[1] || null;
        out.push({ line: i, checked: m[1] !== ' ', raw: m[2], text: m[2].replace(DUE_RE, '').replace(/\s+/g, ' ').trim(), due });
    });
    return out;
}

// Coche/décoche la case de la ligne `line` (vérifiée par son texte : la note a
// pu bouger entre-temps). Renvoie le nouveau corps, ou null si introuvable.
function toggleTaskLine(body, line, raw, checked) {
    const lines = String(body || '').split('\n');
    const re = /^(\s*[-*+]\s+)\[([ xX])\](\s+)(.*)$/;
    let idx = -1;
    const at = lines[line] && lines[line].match(re);
    if (at && at[4] === raw) idx = line;
    else idx = lines.findIndex(l => { const m = l.match(re); return m && m[4] === raw; });
    if (idx < 0) return null;
    const m = lines[idx].match(re);
    const want = checked === undefined ? m[2] === ' ' : !!checked;
    lines[idx] = `${m[1]}[${want ? 'x' : ' '}]${m[3]}${m[4]}`;
    return lines.join('\n');
}

// Modèle → nouvelle note : retire le tag #modèle et remplit {{date}},
// {{date:iso}}, {{heure}}, {{semaine}}.
function applyTemplate(body, now = new Date()) {
    const pad = n => String(n).padStart(2, '0');
    const jan1 = new Date(now.getFullYear(), 0, 1);
    const vars = {
        date: now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
        'date:iso': `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
        heure: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
        semaine: String(Math.ceil(((now - jan1) / 86400000 + jan1.getDay() + 1) / 7))
    };
    return String(body || '')
        .replace(/(^|[\s(])#mod[eè]le(?![\p{L}\p{N}_/-])[ \t]?/giu, '$1')
        .replace(/\{\{\s*([\w:]+)\s*\}\}/g, (m, k) => vars[k.toLowerCase()] !== undefined ? vars[k.toLowerCase()] : m)
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\s+$/, '\n');
}

module.exports = { parse, serialize, updatedOf, titleOf, tagsOf, linksOf, tasksOf, excerptOf, taskLinesOf, toggleTaskLine, applyTemplate };
