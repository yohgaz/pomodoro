// Liste de référence des commandes du chat — utilisée par l'overlay
// « Commandes », le panneau OBS et l'onglet Commandes de l'espace web.
// name = nom interne de la commande (pour savoir si elle est désactivée),
// short = description courte affichée à l'écran.
const GROUPS = [
    { id: 'tasks', icon: '📝', title: 'Tâches', cmds: [
        { cmd: '!task <tâche>', name: 'task', short: 'créer ta tâche', desc: 'Crée ta tâche active (l’ancienne repasse en tête du backlog)' },
        { cmd: '!done', name: 'done', alias: 'fait', short: 'terminer', desc: 'Termine la tâche active' },
        { cmd: '!done next', name: 'done', short: 'terminer et enchaîner', desc: 'Termine et passe à la suivante du backlog' },
        { cmd: '!done 2; 3', name: 'done', short: 'terminer par numéros', desc: 'Termine plusieurs tâches (0 = active, 1+ = backlog)' },
        { cmd: '!done all', name: 'done', short: 'tout terminer', desc: 'Termine tout' },
        { cmd: '!done <texte>', name: 'done', short: 'noter une tâche déjà faite', desc: 'Enregistre directement une tâche faite' },
        { cmd: '!rename <texte>', name: 'rename', alias: 'renommer', short: 'renommer', desc: 'Renomme la tâche active (!rename 2 <texte> pour le backlog)' },
        { cmd: '!remove', name: 'remove', alias: 'retirer', short: 'supprimer', desc: 'Supprime la tâche active (!remove 2, !remove all)' },
        { cmd: '!mytasks', name: 'mytasks', alias: 'mestaches', short: 'résumé de tes tâches', desc: 'Résumé : active, backlog, faites' },
        { cmd: '!mydone', name: 'mydone', short: 'tes stats', desc: 'Nombre de tâches faites aujourd’hui et au total' },
        { cmd: '!ourdone', name: 'ourdone', short: 'stats du chat', desc: 'Total de la communauté' },
        { cmd: '!randomtask', name: 'randomtask', short: 'petite tâche surprise', desc: 'Une petite tâche positive au hasard' },
        { cmd: '!clearold', name: 'clearold', short: 'nettoyer tes tâches faites', desc: 'Retire tes tâches faites de l’overlay (!clearold 3)' }
    ] },
    { id: 'backlog', icon: '📋', title: 'Backlog', cmds: [
        { cmd: '!later a; b; c', name: 'later', alias: 'plustard', short: 'ajouter pour plus tard', desc: 'Ajoute à la fin du backlog' },
        { cmd: '!soon <tâche>', name: 'soon', alias: 'bientot', short: 'ajouter en priorité', desc: 'Ajoute en tête du backlog' },
        { cmd: '!backlog', name: 'backlog', short: 'voir ton backlog', desc: 'Liste le backlog (!backlog clear pour vider)' },
        { cmd: '!now', name: 'now', alias: 'maintenant', short: 'prendre la suivante', desc: 'Prend la tâche suivante du backlog' },
        { cmd: '!now 2', name: 'now', short: 'activer la n°2', desc: 'Active la tâche n°2' },
        { cmd: '!now skip', name: 'now', short: 'passer la tâche', desc: 'Passe la tâche actuelle en fin de backlog' },
        { cmd: '!now raffle', name: 'now', short: 'tirer au sort', desc: 'Tire une tâche au hasard' },
        { cmd: '!display 2', name: 'display', alias: 'afficher', short: 'texte complet', desc: 'Affiche le texte complet d’une tâche' }
    ] },
    { id: 'projects', icon: '📁', title: 'Projets', cmds: [
        { cmd: '!project <nom>', name: 'project', alias: 'projet', short: 'changer de projet', desc: 'Crée ou bascule sur un projet' },
        { cmd: '!project Nom: a; b', name: 'project', short: 'projet + tâches', desc: 'Crée un projet avec ses tâches' },
        { cmd: '!projects', name: 'projects', alias: 'projets', short: 'tes projets', desc: 'Liste tes projets' },
        { cmd: '!addto Nom: a; b', name: 'addto', short: 'ajouter ailleurs', desc: 'Ajoute à un autre projet sans basculer' },
        { cmd: '!getfrom <nom>', name: 'getfrom', short: 'ramener une tâche', desc: 'Ramène la prochaine tâche d’un autre projet' },
        { cmd: '!peek <nom>', name: 'peek', short: 'jeter un œil', desc: 'Jette un œil à un projet' },
        { cmd: '!project rename · remove', name: 'project', short: 'renommer / supprimer', desc: 'Renomme ou supprime le projet actuel' },
        { cmd: '!fullreset confirm', name: 'fullreset', short: 'tout effacer', desc: 'Efface tous tes projets et tâches' }
    ] },
    { id: 'pomo', icon: '🍅', title: 'Pomodoro perso', cmds: [
        { cmd: '!pomo 25 <nom>', name: 'pomo', short: 'minuteur de 25 min', desc: 'Minuteur de 25 min' },
        { cmd: '!pomo 25/5/4', name: 'pomo', short: 'focus / pause / cycles', desc: 'Focus / pause / nombre de cycles' },
        { cmd: '!pomo', name: 'pomo', short: 'où en est ton pomo', desc: 'Où en est ton pomo' },
        { cmd: '!pomo pause · continue', name: 'pomo', short: 'pause / reprise', desc: 'Pause / reprise' },
        { cmd: '!pomo +5 · -5', name: 'pomo', short: 'ajuster le temps', desc: 'Ajoute / retire des minutes' },
        { cmd: '!pomo finish · cancel', name: 'pomo', short: 'terminer / annuler', desc: 'Termine / annule (!pomo rename <nom> pour renommer)' },
        { cmd: '!ask pomo @pseudo', name: 'ask', short: 'le pomo de quelqu’un', desc: 'Le pomo de quelqu’un' }
    ] },
    { id: 'memory', icon: '🧠', title: 'Mémoire', cmds: [
        { cmd: '!remember pronoms iel', name: 'remember', short: 'retenir une info', desc: 'Clés : pronoms, pays, plat, animal, signe' },
        { cmd: '!ask pronoms @pseudo', name: 'ask', short: 'demander', desc: 'Lire la valeur de quelqu’un (!ask task @pseudo aussi)' },
        { cmd: '!forget pronoms · all', name: 'forget', short: 'oublier', desc: 'Oublier' },
        { cmd: '!memory stats', name: 'memory', short: 'statistiques', desc: 'Statistiques' }
    ] },
    { id: 'mods', icon: '🛡️', title: 'Streamer & modos', mod: true, cmds: [
        { cmd: '!timer 50/10/4 <nom>', name: 'timer', alias: 'minuteur', short: 'lancer le minuteur', desc: 'Lance le minuteur du stream' },
        { cmd: '!timer pause · resume · skip · stop', name: 'timer', short: 'contrôler le minuteur', desc: 'Contrôle du minuteur' },
        { cmd: '!timer +5 · -5 · goal 6', name: 'timer', short: 'ajuster le minuteur', desc: 'Ajustements (!timer rename <nom> aussi)' },
        { cmd: '!timerpomo 1/4', name: 'timerpomo', short: 'compteur de pomodoros', desc: 'Règle le compteur de pomodoros' },
        { cmd: '!note <idée>', name: 'note', short: 'idée → Inbox', desc: 'Streamer : envoie une idée dans l’Inbox des notes' },
        { cmd: '!newsession', name: 'newsession', short: 'nouvelle session', desc: 'Nettoie les tâches faites de l’overlay' },
        { cmd: '!cleartasks @pseudo', name: 'cleartasks', short: 'effacer ses tâches', desc: 'Efface les tâches de quelqu’un' },
        { cmd: '!tasklock on · off', name: 'tasklock', short: 'réserver aux modos', desc: 'Réserve la liste aux modos' },
        { cmd: '!overlay hide · show', name: 'overlay', short: 'masquer / afficher', desc: 'Masque / affiche un overlay (!overlay timer hide, !overlay commands show)' }
    ] },
    { id: 'help', icon: '💡', title: 'Aide', cmds: [
        { cmd: '!sweet', name: 'sweet', short: 'aide rapide', desc: 'Aide courte (!sweet help, !sweet backlog, !sweet pomo)' },
        { cmd: '!sweetbacklog · !sweetpomo', name: 'sweetbacklog', short: 'aides détaillées', desc: 'Aides détaillées' }
    ] }
];

// Liste filtrée selon les réglages (commandes désactivées, alias français).
function commandsFor(chatSettings = {}) {
    const disabled = new Set(chatSettings.disabledCommands || []);
    return GROUPS.map(g => ({
        ...g,
        cmds: g.cmds.map(c => ({ ...c, enabled: !disabled.has(c.name), alias: chatSettings.frenchAliases === false ? undefined : c.alias }))
    }));
}

module.exports = { GROUPS, commandsFor };
