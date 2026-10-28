# Coordination Mac ↔ PC Windows — Pomodoro

Ce dépôt (le **code** de Pomodoro, `yohgaz/pomodoro`, public) est modifié depuis **deux machines**, chacune avec sa propre session Claude :

- **MacBook** : machine qui diffuse (Émilae Studio, bot Twitch), scripts `scripts/mac/`, et plus tard l'app native Apple (macOS d'abord, voir plus bas).
- **PC Windows** : machine de jeu. App Windows native (`windows/`), scripts `scripts/windows/`.

Les deux sessions ne se voient pas en direct. Le seul canal est **git** : ce fichier et `NOTES-MAC-PC.md`. Yohann écrit en français, les sessions aussi (y compris les descriptions d'outils).

## Début de session (obligatoire)
1. `git pull`, puis lire les dernières entrées de `NOTES-MAC-PC.md` (les plus récentes sont **en haut**).
2. Arbre pas propre ? **Ne pas stasher à l'aveugle** : `git status` / `git diff`, c'est peut-être le travail non commité de l'autre session ou de Yohann.
3. Si l'autre machine a laissé un « À faire », le faire (ou dire à Yohann pourquoi pas).

## Fin de session / après chaque lot de travail
1. `npm test` (simulation des commandes du chat) doit passer.
2. Si `editor-src/`, `lib/markdown-file.js`, `public/theme.css` ou `public/editor.css` ont changé : `npm run build` et commiter **aussi** `public/vendor/` et `docs/` (l'app mobile est publiée telle quelle par GitHub Pages depuis `docs/`).
3. Commiter **tout** ce qui est intentionnel, `git push` sur `main`. Jamais de fichier suivi modifié non commité : ça bloque le `git pull` de l'autre machine.
4. **Une entrée en haut de `NOTES-MAC-PC.md`** : date, machine, ce qui a changé, **ce que l'autre côté doit faire** (au minimum : pull + redémarrage, voir ci-dessous).
5. Mettre à jour `README.md` si l'utilisation change (c'est le mode d'emploi de Yohann).

## Après un `git pull` qui ramène du code
| Machine | Quoi faire |
|---|---|
| **Mac** | `./scripts/mac/redemarrer.sh` (service `com.yohgaz.pomodoro`). Nouvelle dépendance dans `package.json` → `npm install --omit=dev` d'abord. Interface d'overlay modifiée → recharger le calque dans Émilae Studio. |
| **PC** | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows\redemarrer.ps1` (relance **détachée** par une tâche temporaire du Planificateur : jamais `node server.js` ni `Start-Process` depuis un terminal de la session, le serveur mourrait avec l'appli Claude). Si `windows/` a changé, **ou après toute nouvelle fonctionnalité** (règle de Yohann) : `scripts\windows\installer-app.ps1` (recompile et relance l'app Windows). |
| **iPhone** | rien : l'app (GitHub Pages) se met à jour seule au lancement suivant. |

Le code se met à jour par `git pull` ; les **données**, elles, se synchronisent toutes seules (voir plus bas) : ne jamais les copier à la main.

## Qui est propriétaire de quoi
Pas d'interdiction, mais avant de modifier la zone de l'autre : `git pull`, changement minimal, entrée dans les notes.

| Zone | Propriétaire |
|---|---|
| `windows/`, `scripts/windows/`, `app-windows/` (non versionné) | **PC** |
| `scripts/mac/`, future app native Apple (`apple/`) | **Mac** |
| `server.js`, `lib/`, `public/`, `docs/`, `editor-src/`, `README.md` | **Partagé** : petits commits, push vite, pull avant d'éditer |

## Données : un dépôt séparé, jamais dans celui-ci
- Les notes, recettes, favoris, calendrier, tâches du stream vivent dans `data/` = clone du dépôt **privé** `yohgaz/pomodoro-data`, synchronisé automatiquement par `lib/sync.js` (commit + fetch + fusion + push toutes les 30 s). `data/` est dans `.gitignore`.
- Chaque serveur signe ses envois « Pomodoro (<machine>) », le téléphone « 📱 <appareil> · … ». Réglages → Synchronisation montre le **dernier envoi de chaque appareil** (`/api/sync/devices`) : un appareil muet = problème de son côté (le plus souvent un jeton GitHub expiré ; état `auth`).
- Ne jamais tester sur les vraies données sans les remettre en état après (les tests partent sur GitHub et reviennent sur les autres appareils). `npm test` travaille dans un dossier temporaire.

## Ce qui ne doit JAMAIS aller dans git
- `config.json` (propre à chaque machine : jeton du bot Twitch, `sync.token`, mode du bot, nom de la machine). Ne jamais afficher un jeton dans un terminal ni dans un message.
- `data/`, `logs/`, `export/`, `app-windows/`, `windows/**/bin|obj`.

## Pièges connus
- **Antislashs** : les scripts `node - <<'EOF'` qui contiennent des regex ou des `\n` dans des gabarits JS perdent leurs antislashs. Pour des éditions avec regex, utiliser l'outil d'édition direct ou un fichier de script dans le dossier temporaire.
- `GET /api/events` est le flux temps réel (SSE) : ne pas créer d'autre route sous ce nom (le calendrier est sous `/api/calendar`).
- Un fichier `require()`é par du code commité doit être commité avec lui.
- PC : `Get-NetTCPConnection` ne voit pas toujours les serveurs Node → `scripts/windows/arreter.ps1` reconnaît Pomodoro à sa ligne de commande, et ne touche pas au serveur du stream.
- Le bot Twitch en mode « auto » se connecte quand un overlay signale `window.obsstudio` : à vérifier avec Émilae Studio, qui a remplacé OBS sur le Mac.
- **App native Apple** : Yohann n'a pas de compte Apple Developer payant → pas d'app iOS (expirerait en 7 jours), l'iPhone garde l'app web `docs/`. L'app native se fera **sur macOS** (une app signée « Sign to Run Locally » n'expire pas), depuis la session du Mac, quand Yohann le demandera.
