# Journal de passation Mac ↔ PC — Pomodoro

Entrées les plus récentes **en haut**. Format : date · machine · ce qui a changé · ce que l'autre côté doit faire.
Règles générales : voir `CLAUDE.md`.

---

## 2026-10-28 · PC Windows — synchro : diagnostic des appareils, jetons GitHub, règles de coordination
**Demande de Yohann.** « Pomodoro ne se synchronise plus entre mes appareils. » Le PC synchronise normalement (gestionnaire d'identifiants Windows). D'après l'historique de `pomodoro-data` : **le Mac n'a jamais rien envoyé**, l'iPhone plus rien depuis le 28/09. Cause probable : jetons GitHub « fine-grained » créés le 28/09, avec 30 jours d'expiration par défaut, donc expirés aujourd'hui. Non vérifié côté Mac.
**Ce qui a changé** (commit `be50fcc` + ce commit)
- `lib/sync.js` : un refus de GitHub (401/403, « Authentication failed », « could not read Username »…) donne l'état **`auth`** avec un message clair. Avant, c'était classé à tort « hors ligne ». Nouvelle méthode `devices()` : dernier envoi par appareil.
- Jeton propre à chaque machine, **sans trousseau** : `config.json → sync.token`, saisi dans Réglages → Synchronisation (« Jeton GitHub de cette machine »), envoyé en en-tête HTTP par la synchro. Jamais renvoyé au navigateur (`hasToken` seulement).
- Réglages : tableau « Derniers envois sur GitHub, par appareil » (`/api/sync/devices`).
- App mobile : bandeau rouge sur l'accueil en cas d'erreur, et *⚙️ → 🔑 Changer le jeton GitHub*, qui garde les notes, y compris les envois en attente.
- PC : `scripts/windows/arreter.ps1` reconnaît le serveur à sa ligne de commande ; `redemarrer.ps1`, `installer-demarrage.ps1` et `installer-app.ps1` lancent par tâche temporaire du Planificateur.
- Nouveaux `CLAUDE.md` (règles de coordination) et ce journal.
**À faire côté Mac :**
1. `git pull` puis `./scripts/mac/redemarrer.sh`.
2. Ouvrir http://localhost:3210/settings → Synchronisation, regarder l'état et l'erreur affichée. Si « 🔑 Accès refusé par GitHub » : Yohann crée un nouveau jeton (dépôt `pomodoro-data` uniquement, Contents : Read and write, **No expiration**), puis le colle dans « Jeton GitHub de cette machine » → Enregistrer. **Ne pas** modifier le trousseau macOS : le dépôt du stream utilise peut-être le même identifiant github.com.
3. Vérifier que « 💻 MacBook » (ou le nom de la machine dans `config.json`) apparaît dans « Derniers envois par appareil » après une modification. Si le Mac n'a toujours jamais envoyé : regarder `logs/server.log` et `git -C data status -sb` / `git -C data log origin/main..HEAD`, puis noter la cause ici.
4. Vérifier que le bot Pomodoro (mode « auto ») se connecte bien quand Émilae Studio affiche `/overlay/scene` (détection de `window.obsstudio`). Si Studio ne l'expose pas, proposer à Yohann une solution (mode « Toujours » sur le Mac, ou détection propre à Studio) et la noter ici.

---

## 2026-10-04 · PC Windows — rubrique Favoris
Liens saisis à la main (aucune importation de navigateur), rangés par dossier, épinglés, tags, recherche ; aussi sur mobile (`#/favoris`) et dans le menu de l'app Windows. Correction de `h()` (`public/app/js/ui.js`) : les variables CSS (`--c`) passent par `setProperty`, ce qui rend les couleurs des dossiers et du calendrier.
**À faire côté Mac :** `git pull` + `./scripts/mac/redemarrer.sh`.

---

## 2026-09-28 · PC Windows — création du projet
Pomodoro créé et développé depuis le PC : liste de tâches du stream façon Super Sweet (bot Twitch, scène OBS tout-en-un 4K native, panneau de contrôle `/dock`), notes Markdown IPARA façon Bear, tâches Perso/Stream, revue hebdo, modèles, bases de données (Recettes), calendrier avec repas et liste de courses automatique, app mobile `docs/`, app Windows `windows/`. Mode d'emploi complet : `README.md`.
