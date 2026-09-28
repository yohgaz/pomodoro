// Petits composants d'interface : éléments, icônes, menus, fenêtres, toasts.
export function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
    }
    for (const c of children.flat(Infinity)) {
        if (c === null || c === undefined || c === false) continue;
        el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICONS = {
    search: '<path d="M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Zm10 2-4.35-4.35"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    pin: '<path d="M9 4h6l-1 6 4 3v2H6v-2l4-3-1-6ZM12 15v6"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
    more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"/>',
    back: '<path d="M15 18l-6-6 6-6"/>',
    sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
    expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    sync: '<path d="M20 12a8 8 0 0 1-14.3 4.9M4 12A8 8 0 0 1 18.3 7.1M18 3v4.5h-4.5M6 21v-4.5h4.5"/>',
    archive: '<path d="M3 5h18v4H3zM5 9v10h14V9M10 13h4"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    sort: '<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    play: '<path d="M7 4l13 8-13 8V4Z"/>',
    pause: '<path d="M7 4h4v16H7zM13 4h4v16h-4z"/>',
    skip: '<path d="M5 4l10 8-10 8V4ZM19 5v14"/>',
    stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
    grip: '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
    undo: '<path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    inbox: '<path d="M3 13h5l1.5 3h5L16 13h5M5 5h14l2 8v6H3v-6l2-8Z"/>',
    bolt: '<path d="M13 3 4 14h7l-1 7 9-11h-7l1-7Z"/>'
};
export function icon(name, cls = '') {
    const span = document.createElement('span');
    span.style.display = 'contents';
    span.innerHTML = `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
    return span.firstElementChild;
}

export const TOMATO = `<svg viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="tg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF8A5C"/><stop offset="1" stop-color="#E24A22"/></linearGradient></defs><circle cx="32" cy="36" r="23" fill="url(#tg)"/><path d="M32 14c-3 0-6 1.5-8 4 3 0 5 .5 6.5 2-3 .5-6 2.5-7.5 5 3.5-1 7-1 9 0 2-1 5.5-1 9 0-1.5-2.5-4.5-4.5-7.5-5 1.5-1.5 3.5-2 6.5-2-2-2.5-5-4-8-4Z" fill="#6FDA9A"/><path d="M32 8v8" stroke="#6FDA9A" stroke-width="3.5" stroke-linecap="round"/><ellipse cx="23" cy="33" rx="4" ry="6" fill="#fff" opacity=".22" transform="rotate(25 23 33)"/></svg>`;

// ── Dates relatives ──
const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
export function ago(ts) {
    if (!ts) return '';
    const d = (ts - Date.now()) / 1000;
    const a = Math.abs(d);
    if (a < 45) return 'à l’instant';
    if (a < 3600) return rtf.format(Math.round(d / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(d / 3600), 'hour');
    if (a < 86400 * 7) return rtf.format(Math.round(d / 86400), 'day');
    return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: new Date(ts).getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
}
export function fullDate(ts) {
    return ts ? new Date(ts).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
}

// ── Toasts ──
export function toast(msg, type = '', { action, onAction, ms = 3500 } = {}) {
    const box = document.getElementById('toasts');
    const t = h('div', { class: `toast ${type}` }, msg, action ? h('button', { class: 'btn small', onclick: () => { onAction && onAction(); t.remove(); } }, action) : null);
    box.appendChild(t);
    setTimeout(() => t.remove(), ms);
}

// ── Menus contextuels ──
let openMenu = null;
export function closeMenu() { if (openMenu) { openMenu.remove(); openMenu = null; } }
document.addEventListener('mousedown', e => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
export function menu(anchor, items, { align = 'left' } = {}) {
    closeMenu();
    const m = h('div', { class: 'menu', role: 'menu' });
    for (const it of items) {
        if (!it) continue;
        if (it === '-') { m.appendChild(h('div', { class: 'menu-sep' })); continue; }
        if (it.label && !it.run) { m.appendChild(h('div', { class: 'menu-label' }, it.label)); continue; }
        m.appendChild(h('button', {
            class: `menu-item ${it.danger ? 'danger' : ''}`, role: 'menuitem',
            onclick: () => { closeMenu(); it.run(); }
        }, h('span', { class: 'mi-ico' }, it.icon || ''), h('span', {}, it.text), it.hint ? h('span', { class: 'mi-hint' }, it.hint) : null));
    }
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, bottom: anchor.y, top: anchor.y };
    const mw = m.offsetWidth, mh = m.offsetHeight;
    let left = align === 'right' ? r.right - mw : r.left;
    let top = r.bottom + 6;
    if (top + mh > innerHeight - 10) top = Math.max(10, r.top - mh - 6);
    left = Math.max(10, Math.min(left, innerWidth - mw - 10));
    m.style.left = left + 'px';
    m.style.top = top + 'px';
    openMenu = m;
    return m;
}

// ── Fenêtres modales ──
export function modal({ title, body, foot, wide = false, onClose }) {
    const bg = h('div', { class: 'overlay-bg' });
    const close = () => { bg.remove(); document.removeEventListener('keydown', onKey); onClose && onClose(); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    const box = h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true' },
        h('div', { class: 'modal-head' }, h('h3', {}, title), h('button', { class: 'icon-btn', onclick: close, 'aria-label': 'Fermer' }, icon('x'))),
        h('div', { class: 'modal-body' }, body),
        foot ? h('div', { class: 'modal-foot' }, foot) : null
    );
    bg.appendChild(box);
    bg.addEventListener('mousedown', e => { if (e.target === bg) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(bg);
    setTimeout(() => { const f = box.querySelector('input, textarea, select'); if (f) f.focus(); }, 30);
    return { close, box };
}

export function confirmBox(title, text, { ok = 'Confirmer', danger = false } = {}) {
    return new Promise(resolve => {
        let done = false;
        const m = modal({
            title,
            body: h('p', { class: 'help', style: { margin: 0 } }, text),
            foot: [
                h('button', { class: 'btn ghost', onclick: () => { done = true; m.close(); resolve(false); } }, 'Annuler'),
                h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => { done = true; m.close(); resolve(true); } }, ok)
            ],
            onClose: () => { if (!done) resolve(false); }
        });
    });
}

export function promptBox(title, { value = '', placeholder = '', ok = 'OK', hint = '' } = {}) {
    return new Promise(resolve => {
        let done = false;
        const input = h('input', { class: 'input', value, placeholder });
        const submit = () => { done = true; m.close(); resolve(input.value.trim()); };
        input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
        const m = modal({
            title,
            body: [input, hint ? h('p', { class: 'help' }, hint) : null],
            foot: [h('button', { class: 'btn ghost', onclick: () => { done = true; m.close(); resolve(null); } }, 'Annuler'), h('button', { class: 'btn primary', onclick: submit }, ok)],
            onClose: () => { if (!done) resolve(null); }
        });
        setTimeout(() => input.select(), 40);
    });
}

export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? '⌘' : 'Ctrl';

export const COLORS = ['#F0653D', '#E8B84D', '#6FDA9A', '#5FD4D4', '#7AB8FF', '#C792EA', '#FF8FB1', '#A6A29B'];
