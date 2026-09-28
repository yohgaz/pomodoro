// Réglages : machine, synchro entre PC/Mac/téléphone, app mobile, apparence, données.
import { get, post, put } from './api.js';
import { h, toast, ago, fullDate, icon } from './ui.js';

export async function render(container, ctx) {
    let st = await get('/api/state');
    const root = h('div', { class: 'wide-inner' });
    container.replaceChildren(root);

    const draw = () => {
        const cfg = st.config;
        const sync = st.sync;
        const machine = h('input', { value: cfg.machineName });
        const remote = h('input', { value: cfg.sync.remote || '', placeholder: 'https://github.com/yohgaz/pomodoro-data.git' });
        const syncOn = h('input', { type: 'checkbox', checked: cfg.sync.enabled });
        const wsName = h('input', { value: st.settings.workspaceName || 'Pomodoro' });
        const lan = h('input', { type: 'checkbox', checked: cfg.host === '0.0.0.0' });
        const code = h('input', { type: 'password', placeholder: st.hasAccessCode ? '•••• (déjà défini)' : 'ex. 4 à 8 chiffres', autocomplete: 'new-password' });

        const stateLabel = { idle: '✅ Synchronisé', syncing: '🔄 En cours…', local: '💾 Local uniquement', offline: '📴 Hors ligne', error: '⚠️ Erreur', disabled: '⛔ Désactivée', init: '…' }[sync.state] || sync.state;
        const mobileUrl = 'https://yohgaz.github.io/pomodoro/';
        const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';

        root.replaceChildren(
            h('div', { class: 'wide-head' }, h('h1', {}, '⚙️ Réglages')),
            h('div', { class: 'grid-2', style: { alignItems: 'start' } },
                h('div', { class: 'stack' },
                    h('div', { class: 'card' }, h('h3', {}, '🔄 Synchronisation', h('small', {}, stateLabel)),
                        h('p', { class: 'help', style: { marginTop: 0 } }, 'Chaque machine garde une copie complète de tes notes et fonctionne seule. Un dépôt GitHub privé sert de point de rendez-vous : le PC, le Mac et le téléphone s’y retrouvent, même si les autres sont éteints.'),
                        h('label', { class: 'field' }, h('span', {}, 'Dépôt git des données'), remote, h('small', {}, 'Dépôt PRIVÉ, vide au départ (ex. pomodoro-data). Laisse vide pour rester en local.')),
                        h('label', { class: 'switch' }, h('span', { class: 'switch-text' }, h('b', {}, 'Synchro automatique'), h('small', {}, 'Toutes les 30 s et quelques secondes après chaque modification')), syncOn),
                        h('table', { class: 'cmd-table', style: { margin: '10px 0' } }, h('tbody', {},
                            h('tr', {}, h('td', {}, 'Dernière synchro'), h('td', {}, sync.lastSync ? `${ago(sync.lastSync)} (${fullDate(sync.lastSync)})` : 'jamais')),
                            h('tr', {}, h('td', {}, 'Dossier local'), h('td', {}, h('code', {}, cfg.dataDir))),
                            sync.lastError ? h('tr', {}, h('td', {}, 'Erreur'), h('td', { style: { color: 'var(--danger)' } }, sync.lastError)) : null)),
                        h('div', { class: 'row' },
                            h('button', { class: 'btn primary', onclick: async () => { st = await put('/api/config', { sync: { remote: remote.value, enabled: syncOn.checked } }); toast('Enregistré — synchro lancée', 'ok'); setTimeout(async () => { st = await get('/api/state'); draw(); }, 2500); draw(); } }, 'Enregistrer'),
                            h('button', { class: 'btn', onclick: async () => { toast('Synchronisation…'); await post('/api/sync/now'); st = await get('/api/state'); draw(); } }, icon('sync'), 'Synchroniser maintenant'))
                    ),
                    h('div', { class: 'card' }, h('h3', {}, '📱 App mobile (partout, même en 4G)'),
                        h('p', { class: 'help', style: { marginTop: 0 } }, 'L’app mobile lit et écrit directement dans le dépôt GitHub privé : elle marche partout (liste de courses au magasin…), hors ligne compris, sans que le PC ou le Mac soient allumés.'),
                        h('div', { class: 'code-line' }, h('span', {}, mobileUrl), h('button', { class: 'btn small', onclick: () => { navigator.clipboard.writeText(mobileUrl); toast('Adresse copiée'); } }, icon('copy'), 'Copier')),
                        h('ol', { class: 'help', style: { paddingLeft: '18px' } },
                            h('li', {}, 'Sur l’iPhone, ouvre cette adresse dans Safari.'),
                            h('li', {}, 'Partager → « Sur l’écran d’accueil ».'),
                            h('li', {}, 'Au premier lancement, colle un jeton GitHub (fine-grained) limité au seul dépôt de données — voir le README.'))
                    ),
                    h('div', { class: 'card' }, h('h3', {}, '🏠 Accès en Wi-Fi à cette machine'),
                        h('label', { class: 'switch' }, h('span', { class: 'switch-text' }, h('b', {}, 'Ouvrir au réseau local'), h('small', {}, 'Accès depuis une tablette ou un téléphone de la maison (redémarrage du serveur nécessaire)')), lan),
                        h('label', { class: 'field', style: { marginTop: '10px' } }, h('span', {}, 'Code d’accès'), code, h('small', {}, 'Demandé aux appareils du réseau local (jamais sur cette machine).')),
                        st.lanUrls.length ? h('div', {}, ...st.lanUrls.map(u => h('div', { class: 'code-line' }, h('span', {}, u)))) : null,
                        h('button', { class: 'btn', onclick: async () => { const p = { host: lan.checked ? '0.0.0.0' : '127.0.0.1' }; if (code.value) p.accessCode = code.value; st = await put('/api/config', p); toast('Enregistré — redémarre le serveur pour appliquer', 'ok'); draw(); } }, 'Enregistrer')
                    )
                ),
                h('div', { class: 'stack' },
                    h('div', { class: 'card' }, h('h3', {}, '🖥️ Cette machine'),
                        h('label', { class: 'field' }, h('span', {}, 'Nom de la machine'), machine, h('small', {}, 'Affiché dans l’historique des versions (« modifiée sur … »).')),
                        h('button', { class: 'btn', onclick: async () => { st = await put('/api/config', { machineName: machine.value }); toast('Enregistré', 'ok'); draw(); } }, 'Enregistrer')),
                    h('div', { class: 'card' }, h('h3', {}, '🎨 Apparence'),
                        h('label', { class: 'field' }, h('span', {}, 'Nom de l’espace'), wsName),
                        h('button', { class: 'btn small', onclick: async () => { st.settings = await put('/api/settings', { workspaceName: wsName.value }); toast('Enregistré', 'ok'); ctx.refreshState(); } }, 'Enregistrer'),
                        h('div', { class: 'field', style: { marginTop: '16px' } }, h('span', {}, 'Thème (propre à ce navigateur)'),
                            h('div', { class: 'seg' }, ...[['dark', '🌙 Sombre'], ['light', '☀️ Clair']].map(([k, l]) => h('button', { class: theme === k ? 'is-on' : '', onclick: () => { document.documentElement.dataset.theme = k; try { localStorage.setItem('pomodoro.theme', k); } catch (e) { /* rien */ } draw(); } }, l))))),
                    h('div', { class: 'card' }, h('h3', {}, '📦 Données'),
                        h('p', { class: 'help', style: { marginTop: 0 } }, 'Tes notes sont de simples fichiers Markdown. L’export les range dans des dossiers IPARA lisibles (0 - Inbox, 1 - Projets…), importables tels quels dans Bear ou Obsidian.'),
                        h('div', { class: 'row', style: { flexWrap: 'wrap' } },
                            h('button', { class: 'btn', onclick: async () => { const r = await post('/api/export'); toast(`${r.count} notes exportées dans ${r.path}`, 'ok', { ms: 8000 }); } }, icon('download'), 'Exporter en Markdown'),
                            h('label', { class: 'btn' }, '📥 Importer des .md', h('input', { type: 'file', accept: '.md,.markdown,.txt', multiple: true, hidden: true, onchange: async e => {
                                const files = await Promise.all([...e.target.files].map(async f => ({ name: f.name, content: await f.text() })));
                                const r = await post('/api/import', { files });
                                toast(`${r.created} notes importées dans l’Inbox`, 'ok');
                            } }))),
                        h('p', { class: 'help' }, 'Astuce : tu peux aussi glisser des fichiers .md directement sur la fenêtre.')),
                    h('div', { class: 'card' }, h('h3', {}, 'ℹ️ À propos'),
                        h('p', { class: 'help', style: { margin: 0 } }, `Pomodoro ${st.version} · serveur sur le port ${cfg.port} · machine « ${cfg.machineName} »`))
                )
            )
        );
    };
    draw();
}
