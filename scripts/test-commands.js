// Simulation d'une conversation de chat contre le moteur de commandes, dans
// un dossier temporaire (n'écrit jamais dans les vraies données).
// Usage : npm test
const os = require('os');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { Store } = require('../lib/store');
const { StreamEngine } = require('../lib/stream');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pomodoro-test-'));
const store = new Store(dir);
store.init();
const cfg = { twitch: { channel: 'emilae_tv' } };
const engine = new StreamEngine({ store, getConfig: () => cfg });

const viewer = { login: 'alice', displayName: 'Alice', color: '#ff0000' };
const streamer = { login: 'emilae_tv', displayName: 'Emilae_TV', isBroadcaster: true };
const say = (u, t) => {
    const r = engine.handle(u, t);
    console.log(`  ${u.displayName}: ${t}\n    → ${r.join('\n    → ') || '(rien)'}`);
    return r.join(' ');
};

say(viewer, '!sweet');
assert.match(say(viewer, '!task Lire le chapitre 3'), /tâche créée/);
assert.match(say(viewer, '!task'), /Lire le chapitre 3/);
assert.match(say(viewer, '!later Vaisselle; Courses; Sport'), /3 tâches/);
assert.match(say(viewer, '!soon Urgent'), /en tête/);
assert.match(say(viewer, '!backlog'), /1\. Urgent \| 2\. Vaisselle/);
assert.match(say(viewer, '!done next'), /Lire le chapitre 3.*suivante.*Urgent/);
assert.match(say(viewer, '!done 1; 2'), /Vaisselle.*Courses/);
assert.match(say(viewer, '!now skip'), /Sport/);
assert.match(say(viewer, '!rename Sport 30 min'), /renommée/);
assert.match(say(viewer, '!display 1'), /Urgent/);
assert.match(say(viewer, '!mytasks'), /Sport 30 min/);
assert.match(say(viewer, '!mydone'), /3 tâches/);
assert.match(say(viewer, '!done J\'ai bu de l\'eau'), /bravo/);
assert.match(say(viewer, '!pomo 25/5/2 Révisions'), /pomo lancé/);
assert.match(say(viewer, '!pomo'), /Révisions/);
assert.match(say(viewer, '!pomo +5'), /restantes/);
assert.match(say(viewer, '!pomo pause'), /pause/);
assert.match(say(viewer, '!pomo continue'), /reparti/);
assert.match(say(viewer, '!project Ménage: aspirateur; linge'), /Ménage.*2 tâches.*aspirateur/);
assert.match(say(viewer, '!projects'), /▶ Ménage/);
assert.match(say(viewer, '!addto Général: repasser'), /Général/);
assert.match(say(viewer, '!peek Général'), /repasser/);
assert.match(say(viewer, '!getfrom Général'), /récupéré/);
assert.match(say(viewer, '!done Ménage: 0'), /aspirateur/);
assert.match(say(viewer, '!remember pronoms elle/la'), /noté/);
assert.match(say(streamer, '!ask pronoms @alice'), /elle\/la/);
assert.match(say(viewer, '!now'), /Sport/);
assert.match(say(streamer, '!ask task @alice'), /travaille sur/);
assert.match(say(viewer, '!fait vider le lave-vaisselle'), /bravo/);
assert.match(say(viewer, '!task voir https://exemple.com'), /liens/);
assert.equal(say(viewer, '!timer 50/10'), '');
assert.match(say(streamer, '!timer 50/10/4 Écriture'), /minuteur lancé/);
assert.match(say(streamer, '!timerpomo 1/4'), /1\/4/);
assert.match(say(streamer, '!timer +5'), /restantes/);
assert.match(say(streamer, '!timer skip'), /phase suivante/);
assert.match(say(viewer, '!ourdone'), /communauté/);
assert.match(say(viewer, '!randomtask'), /tâche/);
assert.match(say(viewer, '!clearold 2'), /retirées/);
assert.match(say(viewer, '!remove all'), /effacé/);
assert.match(say(viewer, '!fullreset'), /confirm/);
assert.match(say(streamer, '!tasklock on'), /verrouillée/);
assert.match(say(viewer, '!task test'), /en pause/);
assert.match(say(streamer, '!tasklock off'), /ouverte/);

const snap = engine.snapshot();
assert.ok(snap.users.length >= 1);
console.log('\nInstantané overlay :', JSON.stringify(snap.totals), snap.users.map(u => `${u.name} (${u.doneCount} faites)`).join(', '));
store.flush();
fs.rmSync(dir, { recursive: true, force: true });
console.log('\n✅ Toutes les commandes répondent comme prévu.');
