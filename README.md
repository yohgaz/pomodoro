# 🍅 Pomodoro

Deux outils dans un seul projet, auto-hébergé, sur le PC Windows **et** le MacBook :

1. **Liste de tâches du stream** : reprise complète de *Super Sweet Task List / Pomo Timer* (toutes les commandes du chat Twitch, overlays OBS, minuteur pomodoro), avec son propre design.
2. **Notes Markdown façon Bear, organisées en IPARA** : Inbox, Projets, Domaines, Ressources, Archives. Tags `#tag/sous-tag`, liens `[[Titre]]`, rétroliens, cases à cocher, images, historique des versions… Les notes sont de vrais fichiers `.md`.

Sur l'iPhone, une **app mobile** (installable depuis Safari) donne accès aux notes partout (4G, hors ligne), sans que le PC ou le Mac soient allumés.

---

## Comment les données circulent

```
        PC Windows                      MacBook                      iPhone
  ┌───────────────────┐        ┌───────────────────┐        ┌──────────────────┐
  │ serveur + données │        │ serveur + données │        │ app mobile       │
  │ (copie complète)  │        │ (copie complète)  │        │ (copie complète) │
  └─────────┬─────────┘        └─────────┬─────────┘        └────────┬─────────┘
            │   git, toutes les 30 s     │                           │ API GitHub
            └──────────────►  dépôt GitHub PRIVÉ « pomodoro-data » ◄──┘
```

- Chaque appareil garde **toutes** les données et fonctionne seul. Si l'un est éteint, les autres continuent ; il rattrape tout au démarrage.
- Une modification est envoyée quelques secondes après, et les autres la reçoivent en 30 s environ (60 s pour le téléphone).
- **Conflit** (même note modifiée sur deux appareils entre deux synchros) : c'est la version la plus récente qui gagne. L'historique git conserve de toute façon toutes les versions (bouton 🕘 sur une note).
- Le jeton du bot Twitch et les réglages propres à chaque machine sont dans `config.json`. Ce fichier n'est jamais synchronisé.

---

## 1. Créer les deux dépôts GitHub (une seule fois, 2 minutes)

Sur https://github.com/new :

| Dépôt | Visibilité | Contenu |
|---|---|---|
| `pomodoro-data` | **Private**, vide (sans README) | tes notes et l'état du stream |
| `pomodoro` | **Public**, vide (sans README) | le code (aucun secret dedans) + l'app mobile |

Le dépôt de code est public uniquement pour que GitHub Pages puisse héberger gratuitement l'app mobile. Il ne contient aucune note ni aucun jeton.

Ensuite, **sur le PC** (déjà installé), dans un terminal :

```bash
cd ~/Documents/Pomodoro
```

```bash
git push -u origin main
```

Puis ouvre http://localhost:3210/settings → **Synchronisation** → colle `https://github.com/yohgaz/pomodoro-data.git` → **Enregistrer**. Le PC envoie ses notes dans le dépôt privé.

Enfin, active l'app mobile : dépôt `pomodoro` sur GitHub → **Settings → Pages** → *Source : Deploy from a branch* → branche `main`, dossier **`/docs`** → *Save*. Une à deux minutes plus tard, l'app est disponible sur https://yohgaz.github.io/pomodoro/

---

## 2. Installation sur le MacBook

Pré-requis : Node.js 18 ou plus (`node -v`) et git (`xcode-select --install` s'il manque).

```bash
cd ~/Documents && git clone https://github.com/yohgaz/pomodoro.git Pomodoro && cd Pomodoro
```

```bash
npm install --omit=dev
```

Crée le fichier de réglages de la machine (remplace le jeton par celui du bot, le même que dans `config.js` du projet stream, clé `BOT.TOKEN`) :

```bash
cat > config.json <<'EOF'
{
  "machineName": "MacBook",
  "sync": { "remote": "https://github.com/yohgaz/pomodoro-data.git" },
  "twitch": { "channel": "emilae_tv", "botUsername": "emilaebot", "botToken": "oauth:COLLE_LE_JETON_ICI" },
  "bot": { "mode": "auto" }
}
EOF
```

Installe le démarrage automatique (LaunchAgent) et lance le serveur :

```bash
chmod +x scripts/mac/*.sh && ./scripts/mac/installer.sh
```

Au premier lancement, le Mac **clone** le dépôt de données : tu retrouves les notes du PC. Tu peux aussi saisir le jeton du bot depuis l'interface (Stream → Chat & bot) au lieu de l'écrire dans `config.json`.

- Redémarrer après une mise à jour : `git pull && ./scripts/mac/redemarrer.sh`
- Journal : `logs/server.log` · Retirer le démarrage auto : `./scripts/mac/desinstaller.sh`

---

## 3. L'app mobile sur l'iPhone

1. Crée un jeton GitHub réservé au téléphone : **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   - *Repository access* : **Only select repositories** → `pomodoro-data`
   - *Permissions → Repository → Contents* : **Read and write**
   - Expiration : 1 an (ou sans expiration)
2. Sur l'iPhone, ouvre https://yohgaz.github.io/pomodoro/ dans **Safari** → bouton Partager → **Sur l'écran d'accueil**.
3. Lance l'app depuis l'icône 🍅, colle le jeton → **Connecter**.

L'app fonctionne hors ligne : les modifications (cocher la liste de courses au magasin…) partent dès que le réseau revient. Le jeton reste uniquement sur le téléphone.

---

## 4. Overlays OBS

Ajoute une **Source navigateur** dans OBS :

| Overlay | URL | Taille (1080p) | Taille (canevas 4K) |
|---|---|---|---|
| Liste de tâches du chat | `http://localhost:3210/overlay/tasks` | 600 × 1100 | `?scale=2` → 1200 × 2200 |
| Minuteur (anneau) | `http://localhost:3210/overlay/timer` | 420 × 420 | `?scale=2` → 840 × 840 |
| Minuteur (bandeau) | `http://localhost:3210/overlay/timer?style=bar` | 900 × 120 | `&scale=2` |

| Commandes du chat | `http://localhost:3210/overlay/commands` | 600 × 620 | `?scale=2` → 1200 × 1240 |
| Commandes (bandeau) | `http://localhost:3210/overlay/commands?style=ticker` | 940 × 110 | `&scale=2` |

Autres options : `?user=pseudo` (la liste d'une seule personne), `?hideIdle=1` (minuteur caché quand il ne tourne pas), `?sound=0` (sans carillon), `?group=pomo` (overlay Commandes figé sur un thème), `?mods=1` (commandes des modos incluses).

### Panneau de contrôle dans OBS

OBS → menu **Docks → Custom Browser Docks** → Nom : `Pomodoro`, URL : `http://localhost:3210/dock` → **Appliquer**. Le panneau s'ancre où tu veux dans OBS et permet de :

- afficher ou masquer chaque overlay (tâches, minuteur, commandes) ;
- activer ou couper le bandeau de commandes, les tâches terminées et les minuteurs du chat ;
- régler en direct la taille du texte, la vitesse de défilement, le nombre de tes tâches à venir et la rotation des commandes ;
- piloter le minuteur (presets, pause, phase suivante, ±5 min, arrêt) ;
- gérer ta liste de stream (ajouter, terminer, enchaîner) et valider ou retirer les tâches du chat ;
- taper une commande comme dans le chat.

Depuis le chat (modos) : `!overlay hide/show`, `!overlay timer hide/show`, `!overlay commands hide/show`.

Couleurs, titre, taille du texte, vitesse de défilement… se règlent dans **Stream → Overlays OBS**, avec un aperçu en direct.

**Le bot se connecte automatiquement au chat dès qu'OBS affiche un de ces overlays sur la machine** (mode « auto »). Si le PC et le Mac tournent en même temps, seul celui qui diffuse répond au chat : pas de réponses en double. Tu peux forcer « Toujours » ou « Jamais » par machine dans **Stream → Chat & bot**.

> Si un overlay ne se met pas à jour dans OBS après une mise à jour du code : clic droit sur la source → *Actualiser le cache de la page actuelle*.

---

## 5. Commandes du chat

Toutes les commandes de Super Sweet Bot sont reprises (liste complète, avec interrupteurs pour les désactiver, dans **Stream → Commandes**). L'essentiel :

| | |
|---|---|
| `!task <tâche>` / `!done` / `!done next` | tâche active, la terminer, enchaîner |
| `!later a; b; c` / `!soon x` / `!backlog` / `!now` | backlog |
| `!done 2; 3` / `!remove 2` / `!rename <texte>` | par numéro (0 = active) |
| `!project Nom: a; b` / `!projects` / `!addto` / `!getfrom` / `!peek` | projets |
| `!pomo 25/5/4 <nom>` / `!pomo pause · continue · +5 · finish` | pomodoro perso |
| `!remember pronoms iel` / `!ask task @pseudo` | mémoire |
| `!mydone` / `!ourdone` / `!randomtask` / `!sweet` | stats, aide |
| **Modos** : `!timer 50/10/4 <nom>` · `pause` · `skip` · `+5` · `!timerpomo 1/4` | minuteur du stream |
| **Modos** : `!newsession` · `!cleartasks @x` · `!tasklock on` · `!overlay hide` | modération |
| **Toi** : `!note <idée>` | envoie une idée dans l'Inbox des notes |

Alias français : `!fait`, `!plustard`, `!bientot`, `!maintenant`, `!renommer`, `!retirer`, `!projet`, `!minuteur`… Ils ne touchent pas aux commandes du bot principal du stream (`!tache`, `!rs`, `!cmd`…).

**Notes ↔ stream** : survole une case à cocher dans une note et clique sur 🎥 pour l'ajouter à ta liste du stream. Quand tu fais `!done` en live, la case se coche toute seule dans la note.

---

## 6. Raccourcis de l'espace de notes

| | |
|---|---|
| `Ctrl/⌘ + N` | nouvelle note (dans l'Inbox ou le projet affiché) |
| `Ctrl/⌘ + K` | tout rechercher / actions |
| `Ctrl/⌘ + ⇧ + M` | ranger la note (Inbox → projet, domaine…) |
| `Ctrl/⌘ + ⇧ + P` | aperçu |
| `Ctrl/⌘ + ⇧ + F` | mode concentration |
| `Ctrl/⌘ + B / I / U / E` | gras / italique / surligné / code |
| `Ctrl/⌘ + Entrée` | case à cocher |

Glisser une note sur un projet dans la barre latérale la range. Glisser des fichiers `.md` (export Bear, Obsidian…) sur la fenêtre les importe. **Réglages → Exporter en Markdown** écrit toutes les notes dans `export/AAAA-MM-JJ/` rangées par dossiers IPARA.

---

## 7. Mes tâches : Perso et Stream

Page **☑️ Tâches**, trois onglets :

- **🏠 Perso** : ta liste personnelle, avec une tâche en cours, les suivantes et celles faites aujourd'hui. Elle n'apparaît jamais sur l'overlay ni dans le chat.
- **🎥 Stream** : ta liste de stream. Ta tâche en cours et les 3 suivantes s'affichent en tête de l'overlay, comme celles du chat. Tu peux aussi la piloter depuis le chat (`!task`, `!done`…).
- **📝 Cases des notes** : toutes les cases à cocher de tes notes, classées par échéance (`📅 2026-10-02`).

Le bouton 🏠/🎥 d'une tâche la fait passer d'une liste à l'autre. Les trois onglets existent aussi dans l'app iPhone.

## 8. App Windows native

`app-windows\Pomodoro.exe`, avec des raccourcis dans le Menu Démarrer et sur le Bureau. Elle apporte :

- sa propre fenêtre, qui démarre le serveur s'il ne tourne pas ;
- une icône 🍅 dans la zone de notification : fermer la fenêtre la range là, et le minuteur s'affiche au survol ;
- **Ctrl+Alt+N**, depuis n'importe quelle application : capture rapide d'une note (Inbox), d'une tâche perso ou d'une tâche de stream. *Tab* change de type, *Entrée* enregistre ;
- une notification Windows à chaque fin de focus ou de pause ;
- clic droit sur l'icône → *Lancer avec Windows* pour qu'elle démarre avec la session, directement dans la zone de notification.

Après une mise à jour du code : `powershell -File scripts\windows\installer-app.ps1` (nécessite le SDK .NET 8).

## Sur le PC Windows (déjà fait)

- Installé dans `C:\Users\yohan\Documents\Pomodoro`, `config.json` rempli (chaîne `emilae_tv`, bot `emilaebot`, mode auto).
- Démarrage automatique à l'ouverture de session (raccourci « Pomodoro » dans le dossier Démarrage) : `scripts\windows\pomodoro-silencieux.vbs`, qui relance le serveur en cas de plantage.
- Redémarrer : `powershell -File scripts\windows\redemarrer.ps1` · Arrêter : `scripts\windows\arreter.ps1` · Journal : `logs\server.log`.

## Développement

```bash
npm test
```

```bash
npm run build
```

`npm test` simule une conversation de chat complète contre le moteur de commandes. `npm run build` reconstruit l'éditeur (CodeMirror, `editor-src/`) et l'app mobile (`docs/`) : à relancer après avoir modifié l'éditeur, `lib/markdown-file.js` ou les styles partagés, puis commiter `public/vendor` et `docs/`.

| Dossier | Rôle |
|---|---|
| `server.js` | serveur HTTP, API, évènements temps réel |
| `lib/stream.js` | moteur des commandes du chat |
| `lib/notes.js`, `lib/markdown-file.js` | notes IPARA, format Markdown |
| `lib/store.js`, `lib/sync.js` | stockage fichier par fichier, synchro git |
| `lib/twitch.js` | connexion au chat (mode auto/on/off) |
| `public/app/` | espace de notes + panneau Stream |
| `public/overlay/` | overlays OBS |
| `docs/` | app mobile (GitHub Pages) |
