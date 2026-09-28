// Réglages partagés (data/settings.json, synchronisés entre machines) et
// valeurs par défaut de l'état du stream.

const DEFAULT_SETTINGS = {
    workspaceName: 'Pomodoro',
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
    timer: null,
    allTimeDone: 0
});

module.exports = { DEFAULT_SETTINGS, DEFAULT_META, withDefaults };
