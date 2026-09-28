// Réglages partagés (data/settings.json, synchronisés entre machines) et
// valeurs par défaut de l'état du stream.

const DEFAULT_SETTINGS = {
    workspaceName: 'Pomodoro',
    streamerLogin: '',
    // Revue hebdomadaire IPARA : date de la dernière et fréquence souhaitée.
    review: { lastAt: 0, everyDays: 7 },
    overlay: {
        title: 'Tâches du chat',
        subtitle: 'Tape !task pour rejoindre',
        width: 560,
        maxHeight: 960,
        fontSize: 19,
        accent: '#F0653D',
        bgOpacity: 0.9,
        showHeader: true,
        showDone: true,
        maxDonePerUser: 6,
        showBacklogCount: true,
        showPomo: true,
        showProject: true,
        streamerFirst: true,
        // Nombre de tâches du backlog du streamer affichées sous sa tâche active.
        streamerNext: 3,
        // Bandeau tournant en bas de la liste : une commande à la fois.
        commandsFooter: true,
        scrollSpeed: 38,
        useTwitchColors: true,
        autoNewSessionHours: 10
    },
    timer: {
        focusLabel: 'Focus',
        breakLabel: 'Pause',
        doneLabel: 'Terminé',
        idleLabel: 'Prêt',
        defaultWork: 50,
        defaultBreak: 10,
        defaultGoal: 4,
        announce: true,
        sound: true
    },
    // Scène tout-en-un (/overlay/scene) : une seule source OBS avec tous les
    // panneaux. zone = coin où le panneau s'empile (tl, tr, bl, br) ou
    // « free » (position x/y libre, en pixels d'un écran 1920×1080).
    scene: {
        margin: 36,
        gap: 16,
        chatRotateSeconds: 30,
        mineDone: 3,
        socialsCycleMinutes: 10,
        socialsShowSeconds: 18,
        socials: [
            { platform: 'twitch', label: 'Twitch', handle: '@emilae_tv' },
            { platform: 'youtube', label: 'YouTube', handle: '@emilae_tv' },
            { platform: 'youtube', label: 'YouTube', handle: '@etpourquoipasg' },
            { platform: 'bluesky', label: 'Bluesky', handle: '@emilae-tv.eurosky.social' }
        ],
        layout: {
            chat: { zone: 'tl', order: 0, width: 430, x: 36, y: 36 },
            mine: { zone: 'tl', order: 1, width: 430, x: 36, y: 400 },
            commands: { zone: 'bl', order: 0, width: 430, x: 36, y: 700 },
            timer: { zone: 'tr', order: 0, width: 280, x: 1604, y: 36 },
            socials: { zone: 'br', order: 0, width: 380, x: 1504, y: 960 }
        }
    },
    // Overlay « Commandes » : un thème par page, qui tourne.
    commands: {
        title: 'Commandes du chat',
        rotateSeconds: 12,
        showMods: false,
        groups: ['tasks', 'backlog', 'projects', 'pomo', 'memory', 'help']
    },
    chat: {
        enabled: true,
        frenchAliases: true,
        maxTaskLength: 120,
        maxBacklog: 30,
        blockLinks: true,
        bannedWords: [],
        viewersLocked: false,
        disabledCommands: []
    }
};

function withDefaults(obj, defs) {
    const out = { ...defs, ...(obj || {}) };
    for (const [k, v] of Object.entries(defs)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = withDefaults((obj || {})[k], v);
    }
    return out;
}

const DEFAULT_META = () => ({
    sessionStart: Date.now(),
    lastActivity: Date.now(),
    overlayHidden: false,
    timerHidden: false,
    mineHidden: false,
    socialsHidden: false,
    commandsHidden: false,
    timer: null,
    allTimeDone: 0
});

module.exports = { DEFAULT_SETTINGS, DEFAULT_META, withDefaults };
