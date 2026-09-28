// Prépare l'app mobile (dossier docs/, publié par GitHub Pages) à partir des
// sources partagées avec le bureau : thème, styles de l'éditeur, icône,
// lecture/écriture des notes Markdown. Le bundle de l'éditeur est produit par
// `npm run build:editor`. Lancer : npm run build:mobile
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
fs.mkdirSync(path.join(DOCS, 'vendor'), { recursive: true });

for (const f of ['theme.css', 'editor.css', 'icon.svg']) {
    fs.copyFileSync(path.join(ROOT, 'public', f), path.join(DOCS, f));
}

// lib/markdown-file.js (CommonJS) → docs/md.js (module ES)
let md = fs.readFileSync(path.join(ROOT, 'lib', 'markdown-file.js'), 'utf8');
md = md.replace(/module\.exports\s*=\s*\{([^}]*)\};?\s*$/, 'export {$1};\n');
fs.writeFileSync(path.join(DOCS, 'md.js'), '// Généré par scripts/build-mobile.js depuis lib/markdown-file.js — ne pas modifier.\n' + md);

// Numéro de version du cache hors ligne : change à chaque construction pour
// que le téléphone récupère la nouvelle version de l'app.
const swPath = path.join(DOCS, 'sw.js');
const sw = fs.readFileSync(swPath, 'utf8').replace(/const VERSION = '[^']*';/, `const VERSION = '${Date.now().toString(36)}';`);
fs.writeFileSync(swPath, sw);
fs.writeFileSync(path.join(DOCS, '.nojekyll'), '');
console.log('✅ App mobile prête dans docs/');
