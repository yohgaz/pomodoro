// Éditeur Markdown « live » à la Bear, basé sur CodeMirror 6.
// Le texte reste du Markdown pur ; seule l'AFFICHAGE est enrichi : titres en
// grand, **gras** mis en forme avec les symboles masqués hors de la ligne en
// cours, cases à cocher cliquables, #tags et [[liens]] cliquables, images.
//
// Compilé en un seul fichier (public/vendor/editor.bundle.js) par
// `npm run build:editor` — le bundle est versionné, aucune compilation n'est
// nécessaire pour faire tourner le projet.
import { EditorView, Decoration, ViewPlugin, WidgetType, keymap, placeholder, drawSelection, dropCursor } from '@codemirror/view';
import { EditorState, EditorSelection, Prec } from '@codemirror/state';
import { history, historyKeymap, defaultKeymap, indentMore, indentLess, undo, redo } from '@codemirror/commands';
import { markdown, markdownLanguage, markdownKeymap } from '@codemirror/lang-markdown';
import { syntaxTree, syntaxHighlighting, HighlightStyle, indentUnit } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { autocompletion, closeBrackets } from '@codemirror/autocomplete';
import { search, searchKeymap } from '@codemirror/search';
import { marked } from 'marked';

const TAG_RE = /(^|[\s(])(#([^\s#][^#\n]*?[^\s#])#)(?=$|[\s).,;!?])|(^|[\s(])(#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*[\p{L}\p{N}_]|[\p{L}\p{N}_]))/gu;
const WIKI_RE = /\[\[([^\]\n|]+)(\|([^\]\n]*))?\]\]/g;
const HL_RE = /==([^=\n]+)==/g;

// ── Widgets ──
class CheckboxWidget extends WidgetType {
    constructor(checked, pos) { super(); this.checked = checked; this.pos = pos; }
    eq(o) { return o.checked === this.checked && o.pos === this.pos; }
    toDOM() {
        const w = document.createElement('span');
        w.className = 'cm-checkbox' + (this.checked ? ' is-checked' : '');
        w.dataset.pos = this.pos;
        w.setAttribute('role', 'checkbox');
        w.setAttribute('aria-checked', this.checked);
        w.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        return w;
    }
    ignoreEvent() { return false; }
}

class BulletWidget extends WidgetType {
    constructor(depth) { super(); this.depth = depth; }
    eq(o) { return o.depth === this.depth; }
    toDOM() {
        const s = document.createElement('span');
        s.className = 'cm-bullet';
        s.textContent = ['•', '◦', '▪'][this.depth % 3];
        return s;
    }
}

class HrWidget extends WidgetType {
    toDOM() { const s = document.createElement('span'); s.className = 'cm-hr'; return s; }
}

class ImageWidget extends WidgetType {
    constructor(src, alt, resolve) { super(); this.src = src; this.alt = alt; this.resolve = resolve; }
    eq(o) { return o.src === this.src; }
    toDOM() {
        const w = document.createElement('span');
        w.className = 'cm-image';
        const img = document.createElement('img');
        img.alt = this.alt || ''; img.loading = 'lazy';
        // Sur mobile, les images du dépôt privé passent par l'API (jeton) :
        // la fonction resolveImage renvoie une URL locale (blob:).
        if (this.resolve) Promise.resolve(this.resolve(this.src)).then(u => { img.src = u || this.src; }).catch(() => { img.src = this.src; });
        else img.src = this.src;
        w.appendChild(img);
        return w;
    }
}

class SendWidget extends WidgetType {
    constructor(text) { super(); this.text = text; }
    eq(o) { return o.text === this.text; }
    toDOM() {
        const b = document.createElement('span');
        b.className = 'cm-send-task';
        b.title = 'Envoyer dans ma liste de tâches du stream';
        b.dataset.sendTask = this.text;
        b.textContent = '🎥';
        return b;
    }
    ignoreEvent() { return false; }
}

const hide = Decoration.replace({});
const markCls = cls => Decoration.mark({ class: cls });

function activeLines(view) {
    const lines = new Set();
    if (!view.hasFocus) return lines;
    for (const r of view.state.selection.ranges) {
        const a = view.state.doc.lineAt(r.from).number;
        const b = view.state.doc.lineAt(r.to).number;
        for (let i = a; i <= b; i++) lines.add(i);
    }
    return lines;
}

function buildDecorations(view, opts) {
    const decos = [];
    const { state } = view;
    const doc = state.doc;
    const active = activeLines(view);
    const isActive = pos => active.has(doc.lineAt(pos).number);
    const codeRanges = [];

    for (const { from, to } of view.visibleRanges) {
        syntaxTree(state).iterate({
            from, to,
            enter(node) {
                const name = node.name;
                const nf = node.from, nt = node.to;
                if (/^ATXHeading(\d)$/.test(name)) {
                    const lvl = name.slice(-1);
                    const line = doc.lineAt(nf);
                    decos.push(Decoration.line({ class: `cm-h cm-h${lvl}` }).range(line.from));
                    if (line.number === 1) decos.push(Decoration.line({ class: 'cm-title-line' }).range(line.from));
                } else if (name === 'HeaderMark') {
                    const after = doc.sliceString(nt, nt + 1) === ' ' ? nt + 1 : nt;
                    if (!isActive(nf)) decos.push(hide.range(nf, after));
                    else decos.push(markCls('cm-md-mark').range(nf, nt));
                } else if (name === 'Emphasis') decos.push(markCls('cm-em').range(nf, nt));
                else if (name === 'StrongEmphasis') decos.push(markCls('cm-strong').range(nf, nt));
                else if (name === 'Strikethrough') decos.push(markCls('cm-strike').range(nf, nt));
                else if (name === 'InlineCode') { decos.push(markCls('cm-inline-code').range(nf, nt)); codeRanges.push([nf, nt]); }
                else if (name === 'EmphasisMark' || name === 'StrikethroughMark' || (name === 'CodeMark' && node.node.parent && node.node.parent.name === 'InlineCode')) {
                    if (!isActive(nf)) decos.push(hide.range(nf, nt));
                    else decos.push(markCls('cm-md-mark').range(nf, nt));
                } else if (name === 'FencedCode' || name === 'CodeBlock') {
                    codeRanges.push([nf, nt]);
                    const first = doc.lineAt(nf).number, last = doc.lineAt(nt).number;
                    for (let i = first; i <= last; i++) {
                        const l = doc.line(i);
                        let cls = 'cm-codeblock';
                        if (i === first) cls += ' cm-codeblock-first';
                        if (i === last) cls += ' cm-codeblock-last';
                        decos.push(Decoration.line({ class: cls }).range(l.from));
                    }
                } else if ((name === 'CodeMark' || name === 'CodeInfo')) {
                    decos.push(markCls('cm-md-mark').range(nf, nt));
                } else if (name === 'Blockquote') {
                    const first = doc.lineAt(nf).number, last = doc.lineAt(nt).number;
                    for (let i = first; i <= last; i++) decos.push(Decoration.line({ class: 'cm-quote' }).range(doc.line(i).from));
                } else if (name === 'QuoteMark') {
                    const after = doc.sliceString(nt, nt + 1) === ' ' ? nt + 1 : nt;
                    if (!isActive(nf)) decos.push(hide.range(nf, after));
                    else decos.push(markCls('cm-md-mark').range(nf, nt));
                } else if (name === 'HorizontalRule') {
                    if (!isActive(nf)) decos.push(Decoration.replace({ widget: new HrWidget() }).range(nf, nt));
                } else if (name === 'ListItem') {
                    const item = node.node;
                    const mark = item.getChild('ListMark');
                    const task = item.getChild('Task');
                    const line = doc.lineAt(nf);
                    if (task) {
                        const marker = task.getChild('TaskMarker');
                        if (mark && marker) {
                            const checked = /x/i.test(doc.sliceString(marker.from, marker.to));
                            const end = doc.sliceString(marker.to, marker.to + 1) === ' ' ? marker.to + 1 : marker.to;
                            decos.push(Decoration.replace({ widget: new CheckboxWidget(checked, marker.from) }).range(mark.from, end));
                            decos.push(Decoration.line({ class: 'cm-task-line' + (checked ? ' cm-task-done' : '') }).range(line.from));
                            if (checked && task.to > end) decos.push(markCls('cm-task-done-text').range(end, Math.min(task.to, line.to)));
                            if (opts.onSendTask && !checked && line.to > end) {
                                const text = doc.sliceString(end, line.to).trim();
                                if (text) decos.push(Decoration.widget({ widget: new SendWidget(text), side: 1 }).range(line.to));
                            }
                        }
                    } else if (mark) {
                        const txt = doc.sliceString(mark.from, mark.to);
                        if (/^[-*+]$/.test(txt) && !isActive(nf)) {
                            let depth = 0;
                            for (let p = item.parent; p; p = p.parent) if (p.name === 'BulletList' || p.name === 'OrderedList') depth++;
                            decos.push(Decoration.replace({ widget: new BulletWidget(depth - 1) }).range(mark.from, mark.to));
                        } else {
                            decos.push(markCls('cm-list-mark').range(mark.from, mark.to));
                        }
                    }
                } else if (name === 'Link') {
                    const n = node.node;
                    const marks = n.getChildren('LinkMark');
                    const url = n.getChild('URL');
                    const lineActive = isActive(nf);
                    if (marks.length >= 2) {
                        const textFrom = marks[0].to, textTo = marks[1].from;
                        decos.push(Decoration.mark({ class: 'cm-link', attributes: url ? { 'data-href': doc.sliceString(url.from, url.to) } : {} }).range(textFrom, textTo));
                        if (!lineActive) {
                            decos.push(hide.range(marks[0].from, marks[0].to));
                            decos.push(hide.range(marks[1].from, nt));
                        } else {
                            decos.push(markCls('cm-md-mark').range(marks[1].from, nt));
                        }
                    }
                    return false;
                } else if (name === 'Image') {
                    const n = node.node;
                    const url = n.getChild('URL');
                    if (url && !isActive(nf)) {
                        const marks = n.getChildren('LinkMark');
                        const alt = marks.length >= 2 ? doc.sliceString(marks[0].to, marks[1].from) : '';
                        decos.push(Decoration.replace({ widget: new ImageWidget(doc.sliceString(url.from, url.to), alt, opts.resolveImage) }).range(nf, nt));
                    } else decos.push(markCls('cm-md-mark').range(nf, nt));
                    return false;
                } else if (name === 'URL' && node.node.parent && node.node.parent.name === 'Autolink') {
                    decos.push(Decoration.mark({ class: 'cm-link', attributes: { 'data-href': doc.sliceString(nf, nt) } }).range(nf, nt));
                } else if (name === 'Table') {
                    const first = doc.lineAt(nf).number, last = doc.lineAt(nt).number;
                    for (let i = first; i <= last; i++) decos.push(Decoration.line({ class: 'cm-table' }).range(doc.line(i).from));
                }
            }
        });

        // Tags, liens wiki et surlignage : par expressions régulières, hors code.
        const inCode = pos => codeRanges.some(([a, b]) => pos >= a && pos < b);
        const text = doc.sliceString(from, to);
        const lineStartOk = idx => {
            const l = doc.lineAt(from + idx);
            return !/^\s{0,3}#{1,6}\s/.test(l.text);
        };
        let m;
        TAG_RE.lastIndex = 0;
        while ((m = TAG_RE.exec(text))) {
            const pre = m[1] !== undefined ? m[1] : m[4];
            const tagText = m[2] || m[5];
            const tag = (m[3] || m[6] || '').toLowerCase();
            const start = from + m.index + pre.length;
            if (/^\d+$/.test(tag) || inCode(start) || !lineStartOk(m.index + pre.length)) continue;
            decos.push(Decoration.mark({ class: 'cm-tag', attributes: { 'data-tag': tag } }).range(start, start + tagText.length));
        }
        WIKI_RE.lastIndex = 0;
        while ((m = WIKI_RE.exec(text))) {
            const s = from + m.index, e = s + m[0].length;
            if (inCode(s)) continue;
            const title = m[1].trim();
            if (!isActive(s)) {
                decos.push(hide.range(s, s + 2));
                if (m[2]) {
                    decos.push(hide.range(s + 2, s + 2 + m[1].length + 1));
                    decos.push(Decoration.mark({ class: 'cm-wikilink', attributes: { 'data-wiki': title } }).range(s + 3 + m[1].length, e - 2));
                } else {
                    decos.push(Decoration.mark({ class: 'cm-wikilink', attributes: { 'data-wiki': title } }).range(s + 2, e - 2));
                }
                decos.push(hide.range(e - 2, e));
            } else {
                decos.push(Decoration.mark({ class: 'cm-wikilink is-editing', attributes: { 'data-wiki': title } }).range(s, e));
            }
        }
        HL_RE.lastIndex = 0;
        while ((m = HL_RE.exec(text))) {
            const s = from + m.index, e = s + m[0].length;
            if (inCode(s)) continue;
            decos.push(markCls('cm-highlight').range(s, e));
            if (!isActive(s)) { decos.push(hide.range(s, s + 2)); decos.push(hide.range(e - 2, e)); }
        }
    }
    try { return Decoration.set(decos, true); }
    catch (e) { console.warn('Décorations', e); return Decoration.none; }
}

function livePreview(opts) {
    return ViewPlugin.fromClass(class {
        constructor(view) { this.decorations = buildDecorations(view, opts); }
        update(u) {
            if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
                this.decorations = buildDecorations(u.view, opts);
            }
        }
    }, { decorations: v => v.decorations });
}

// Coloration de base (le reste est porté par les classes ci-dessus).
const highlight = HighlightStyle.define([
    { tag: t.heading, fontWeight: '800' },
    { tag: t.strong, fontWeight: '800' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: t.link, color: 'var(--ed-link)' },
    { tag: t.url, color: 'var(--ed-muted)' },
    { tag: t.monospace, fontFamily: 'var(--font-mono)' },
    { tag: t.processingInstruction, color: 'var(--ed-muted)' },
    { tag: t.quote, color: 'var(--ed-quote)' },
    { tag: t.contentSeparator, color: 'var(--ed-muted)' }
]);

// ── Commandes d'édition ──
function wrap(view, before, after = before) {
    const changes = view.state.changeByRange(range => {
        const text = view.state.sliceDoc(range.from, range.to);
        const outerB = view.state.sliceDoc(range.from - before.length, range.from);
        const outerA = view.state.sliceDoc(range.to, range.to + after.length);
        if (outerB === before && outerA === after) {
            return {
                changes: [{ from: range.from - before.length, to: range.from, insert: '' }, { from: range.to, to: range.to + after.length, insert: '' }],
                range: EditorSelection.range(range.from - before.length, range.to - before.length)
            };
        }
        return {
            changes: [{ from: range.from, insert: before }, { from: range.to, insert: after }],
            range: text ? EditorSelection.range(range.from + before.length, range.to + before.length) : EditorSelection.cursor(range.from + before.length)
        };
    });
    view.dispatch(changes, { scrollIntoView: true, userEvent: 'input' });
    view.focus();
    return true;
}

const PREFIX_RE = /^(\s*)(#{1,6}\s+|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+|>\s+)?/;
function setLinePrefix(view, prefix) {
    const { state } = view;
    const lines = new Set();
    for (const r of state.selection.ranges) {
        for (let p = r.from; p <= r.to;) { const l = state.doc.lineAt(p); lines.add(l.number); p = l.to + 1; }
    }
    const changes = [];
    for (const n of lines) {
        const l = state.doc.line(n);
        const m = l.text.match(PREFIX_RE);
        const indent = m[1] || '';
        const cur = m[2] || '';
        const same = cur.trim() === prefix.trim() || (prefix.startsWith('- [') && /^[-*+]\s+\[[ xX]\]/.test(cur));
        changes.push({ from: l.from + indent.length, to: l.from + indent.length + cur.length, insert: same ? '' : prefix });
    }
    view.dispatch({ changes, userEvent: 'input' });
    view.focus();
    return true;
}

function toggleCheckbox(view, pos) {
    const text = view.state.sliceDoc(pos, pos + 3);
    if (!/^\[[ xX]\]$/.test(text)) return false;
    view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: text[1] === ' ' ? 'x' : ' ' }, userEvent: 'input' });
    return true;
}

function toggleTaskAtCursor(view) {
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    const m = line.text.match(/^(\s*[-*+]\s+)\[([ xX])\]/);
    if (m) return toggleCheckbox(view, line.from + m[1].length);
    return setLinePrefix(view, '- [ ] ');
}

// ── Création ──
export function createEditor(parent, opts = {}) {
    const listeners = [];
    let touch = null;
    // Case à cocher, envoi au stream, tag ou lien [[…]] sous le doigt/la souris.
    const activate = (target, view, e) => {
        if (!target || !target.closest) return false;
        const cb = target.closest('.cm-checkbox');
        if (cb) { toggleCheckbox(view, Number(cb.dataset.pos)); return true; }
        const send = target.closest('[data-send-task]');
        if (send) { opts.onSendTask && opts.onSendTask(send.dataset.sendTask); return true; }
        const tag = target.closest('[data-tag]');
        if (tag && opts.onTagClick && !e.shiftKey) { opts.onTagClick(tag.dataset.tag); return true; }
        const wiki = target.closest('[data-wiki]');
        if (wiki && opts.onWikiClick && !wiki.classList.contains('is-editing')) { opts.onWikiClick(wiki.dataset.wiki); return true; }
        return false;
    };
    const completionSource = ctx => {
        const before = ctx.matchBefore(/\[\[[^\]\n]*$/);
        if (before && opts.complete) {
            const qy = before.text.slice(2);
            return Promise.resolve(opts.complete('link', qy)).then(items => ({
                from: before.from + 2,
                options: (items || []).map(title => ({ label: title, type: 'text', apply: (view, c, from, to) => {
                    const hasClose = view.state.sliceDoc(to, to + 2) === ']]';
                    view.dispatch({ changes: { from, to: hasClose ? to + 2 : to, insert: title + ']]' }, selection: { anchor: from + title.length + 2 } });
                } })),
                validFor: /^[^\]\n]*$/
            }));
        }
        const tag = ctx.matchBefore(/(^|[\s(])#[\p{L}\p{N}_\-/]*$/u);
        if (tag && opts.complete) {
            const hashAt = tag.text.lastIndexOf('#');
            const qy = tag.text.slice(hashAt + 1);
            if (!qy && !ctx.explicit) return null;
            return Promise.resolve(opts.complete('tag', qy)).then(items => ({
                from: tag.from + hashAt + 1,
                options: (items || []).map(tg => ({ label: tg, type: 'keyword' })),
                validFor: /^[\p{L}\p{N}_\-/]*$/u
            }));
        }
        return null;
    };

    const uploadAndInsert = async (files, view, pos) => {
        if (!opts.upload) return;
        for (const f of files) {
            if (!/^image\//.test(f.type) && !opts.acceptAnyFile) continue;
            const placeholderText = `![Envoi de ${f.name}…]()`;
            view.dispatch({ changes: { from: pos, insert: placeholderText + '\n' } });
            try {
                const url = await opts.upload(f);
                const doc = view.state.doc.toString();
                const i = doc.indexOf(placeholderText);
                if (i >= 0) view.dispatch({ changes: { from: i, to: i + placeholderText.length, insert: `![${f.name.replace(/\.[^.]+$/, '')}](${url})` } });
            } catch (e) {
                const doc = view.state.doc.toString();
                const i = doc.indexOf(placeholderText);
                if (i >= 0) view.dispatch({ changes: { from: i, to: i + placeholderText.length + 1, insert: '' } });
                opts.onError && opts.onError(e);
            }
        }
    };

    const extensions = [
        history(),
        drawSelection(),
        dropCursor(),
        indentUnit.of('  '),
        EditorState.tabSize.of(2),
        EditorView.lineWrapping,
        closeBrackets(),
        search({ top: true }),
        markdown({ base: markdownLanguage, addKeymap: true }),
        syntaxHighlighting(highlight),
        livePreview(opts),
        autocompletion({ override: [completionSource], icons: false, activateOnTyping: true }),
        placeholder(opts.placeholder || 'Commence par un titre…'),
        Prec.high(keymap.of([
            { key: 'Mod-b', run: v => wrap(v, '**') },
            { key: 'Mod-i', run: v => wrap(v, '*') },
            { key: 'Mod-u', run: v => wrap(v, '==') },
            { key: 'Mod-Shift-x', run: v => wrap(v, '~~') },
            { key: 'Mod-e', run: v => wrap(v, '`') },
            { key: 'Mod-Enter', run: toggleTaskAtCursor },
            { key: 'Mod-Shift-t', run: toggleTaskAtCursor },
            { key: 'Mod-1', run: v => setLinePrefix(v, '# ') },
            { key: 'Mod-2', run: v => setLinePrefix(v, '## ') },
            { key: 'Mod-3', run: v => setLinePrefix(v, '### ') },
            { key: 'Tab', run: indentMore },
            { key: 'Shift-Tab', run: indentLess }
        ])),
        keymap.of([...markdownKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
        EditorView.updateListener.of(u => {
            if (u.docChanged) {
                const val = u.state.doc.toString();
                listeners.forEach(fn => fn(val, u));
                opts.onChange && opts.onChange(val, u);
            }
            if (u.focusChanged && opts.onFocus) opts.onFocus(u.view.hasFocus);
        }),
        EditorView.domEventHandlers({
            // Écrans tactiles : un appui court sur une case / un tag / un lien
            // agit directement, sans ouvrir le clavier (liste de courses…).
            touchstart(e) {
                const t = e.touches[0];
                touch = t && e.target.closest('.cm-checkbox, [data-send-task], [data-tag], [data-wiki]') ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
                return false;
            },
            touchend(e, view) {
                if (!touch) return false;
                const t = e.changedTouches[0];
                const moved = !t || Math.hypot(t.clientX - touch.x, t.clientY - touch.y) > 10 || Date.now() - touch.at > 600;
                touch = null;
                if (moved) return false;
                const target = document.elementFromPoint(t.clientX, t.clientY) || e.target;
                if (activate(target, view, e)) { e.preventDefault(); return true; }
                return false;
            },
            mousedown(e, view) {
                if (activate(e.target, view, e)) { e.preventDefault(); return true; }
                const link = e.target.closest('[data-href]');
                if (link && (e.metaKey || e.ctrlKey)) { e.preventDefault(); window.open(link.dataset.href, '_blank', 'noopener'); return true; }
                return false;
            },
            paste(e, view) {
                const files = [...(e.clipboardData && e.clipboardData.files || [])];
                if (files.length && opts.upload) { e.preventDefault(); uploadAndInsert(files, view, view.state.selection.main.head); return true; }
                return false;
            },
            drop(e, view) {
                const files = [...(e.dataTransfer && e.dataTransfer.files || [])].filter(f => /^image\//.test(f.type));
                if (files.length && opts.upload) {
                    e.preventDefault();
                    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head;
                    uploadAndInsert(files, view, pos);
                    return true;
                }
                return false;
            }
        }),
        EditorView.contentAttributes.of({ spellcheck: 'true', autocorrect: 'on', autocapitalize: 'sentences', lang: 'fr' })
    ];

    const view = new EditorView({ parent, state: EditorState.create({ doc: opts.doc || '', extensions }) });

    return {
        view,
        getValue: () => view.state.doc.toString(),
        setValue(text, { keepCursor = false } = {}) {
            const cur = view.state.selection.main.head;
            view.setState(EditorState.create({ doc: text, extensions }));
            if (keepCursor) view.dispatch({ selection: { anchor: Math.min(cur, text.length) } });
        },
        // Remplace le contenu en conservant l'historique d'annulation (mise à
        // jour venue d'une autre machine pendant qu'on lit la note).
        replaceAll(text) {
            view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
        },
        focus(atEnd) {
            view.focus();
            if (atEnd) view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true });
        },
        insert(text) {
            const r = view.state.selection.main;
            view.dispatch({ changes: { from: r.from, to: r.to, insert: text }, selection: { anchor: r.from + text.length }, scrollIntoView: true });
            view.focus();
        },
        wrap: (b, a) => wrap(view, b, a),
        linePrefix: p => setLinePrefix(view, p),
        toggleTask: () => toggleTaskAtCursor(view),
        undo: () => undo(view),
        redo: () => redo(view),
        insertImage: files => uploadAndInsert(files, view, view.state.selection.main.head),
        onChange: fn => listeners.push(fn),
        destroy: () => view.destroy()
    };
}

// ── Rendu HTML (aperçu, impression) ──
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

marked.use({
    gfm: true,
    breaks: false,
    renderer: {
        html(token) { return escapeHtml(token.text || token.raw || ''); }
    },
    extensions: [
        {
            name: 'wikilink', level: 'inline',
            start(src) { const i = src.indexOf('[['); return i < 0 ? undefined : i; },
            tokenizer(src) {
                const m = /^\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]/.exec(src);
                if (m) return { type: 'wikilink', raw: m[0], target: m[1].trim(), label: (m[2] || m[1]).trim() };
            },
            renderer(tok) { return `<a class="wikilink" data-wiki="${escapeHtml(tok.target)}" href="#">${escapeHtml(tok.label)}</a>`; }
        },
        {
            name: 'hashtag', level: 'inline',
            start(src) { const m = /(^|[\s(])#[^\s#]/u.exec(src); return m ? m.index + m[1].length : undefined; },
            tokenizer(src) {
                const m = /^#([^\s#][^#\n]*?[^\s#])#(?=$|[\s).,;!?])/u.exec(src) || /^#([\p{L}\p{N}_][\p{L}\p{N}_\-/]*[\p{L}\p{N}_]|[\p{L}\p{N}_])/u.exec(src);
                if (m && !/^\d+$/.test(m[1])) return { type: 'hashtag', raw: m[0], tag: m[1].toLowerCase() };
            },
            renderer(tok) { return `<a class="tag" data-tag="${escapeHtml(tok.tag)}" href="#">#${escapeHtml(tok.tag)}</a>`; }
        },
        {
            name: 'highlight', level: 'inline',
            start(src) { const i = src.indexOf('=='); return i < 0 ? undefined : i; },
            tokenizer(src) {
                const m = /^==([^=\n]+)==/.exec(src);
                if (m) return { type: 'highlight', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
            },
            renderer(tok) { return `<mark>${this.parser.parseInline(tok.tokens)}</mark>`; }
        }
    ]
});

export function renderMarkdown(text) {
    return marked.parse(String(text || ''));
}
