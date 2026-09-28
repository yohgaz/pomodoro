// Cuisine : lecture des ingrédients d'une recette (section « ## Ingrédients »
// du Markdown), mise à l'échelle selon les portions, addition entre recettes
// et classement par rayon pour la liste de courses.

const FRACTIONS = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };

// Unités reconnues → forme canonique (et conversion éventuelle vers g / ml).
const UNITS = [
    { re: /^(kg|kilos?|kilogrammes?)(?![\p{L}\p{N}])/iu, unit: 'g', factor: 1000 },
    { re: /^(g|gr|grammes?)(?![\p{L}\p{N}])/iu, unit: 'g', factor: 1 },
    { re: /^(l|litres?)(?![\p{L}\p{N}])/iu, unit: 'ml', factor: 1000 },
    { re: /^(cl|centilitres?)(?![\p{L}\p{N}])/iu, unit: 'ml', factor: 10 },
    { re: /^(ml|millilitres?)(?![\p{L}\p{N}])/iu, unit: 'ml', factor: 1 },
    { re: /^(c\.?\s?à\s?s\.?|c\.?\s?à\s?soupe|cuill[eè]res?\s+à\s+soupe|càs|cas|cs)(?![\p{L}\p{N}])/iu, unit: 'c. à soupe', factor: 1 },
    { re: /^(c\.?\s?à\s?c\.?|c\.?\s?à\s?café|cuill[eè]res?\s+à\s+café|càc|cac|cc)(?![\p{L}\p{N}])/iu, unit: 'c. à café', factor: 1 },
    { re: /^(pinc[ée]es?)(?![\p{L}\p{N}])/iu, unit: 'pincée', factor: 1 },
    { re: /^(gousses?)(?![\p{L}\p{N}])/iu, unit: 'gousse', factor: 1 },
    { re: /^(tranches?)(?![\p{L}\p{N}])/iu, unit: 'tranche', factor: 1 },
    { re: /^(bo[iî]tes?)(?![\p{L}\p{N}])/iu, unit: 'boîte', factor: 1 },
    { re: /^(sachets?)(?![\p{L}\p{N}])/iu, unit: 'sachet', factor: 1 },
    { re: /^(bouquets?)(?![\p{L}\p{N}])/iu, unit: 'bouquet', factor: 1 },
    { re: /^(brins?)(?![\p{L}\p{N}])/iu, unit: 'brin', factor: 1 },
    { re: /^(pots?)(?![\p{L}\p{N}])/iu, unit: 'pot', factor: 1 },
    { re: /^(bottes?)(?![\p{L}\p{N}])/iu, unit: 'botte', factor: 1 },
    { re: /^(feuilles?)(?![\p{L}\p{N}])/iu, unit: 'feuille', factor: 1 },
    { re: /^(tasses?)(?![\p{L}\p{N}])/iu, unit: 'tasse', factor: 1 },
    { re: /^(poign[ée]es?)(?![\p{L}\p{N}])/iu, unit: 'poignée', factor: 1 },
    { re: /^(filets?)(?![\p{L}\p{N}])/iu, unit: 'filet', factor: 1 },
    { re: /^(pav[ée]s?)(?![\p{L}\p{N}])/iu, unit: 'pavé', factor: 1 },
    { re: /^(rouleaux?|rouleau)(?![\p{L}\p{N}])/iu, unit: 'rouleau', factor: 1 }
];

// Rayons du magasin : mots-clés → rayon (premier trouvé).
const AISLES = [
    ['🥫 Épicerie', /(?<![\p{L}\p{N}])(lait de coco|cr[eè]me de coco|thon en bo[iî]te|sauce soja|sauce tomate|concentr[ée] de tomates?|tomates? concass[ée]es|bouillon)(?![\p{L}\p{N}])/iu],
    ['🥕 Fruits & légumes', /(?<![\p{L}\p{N}])(carotte|oignon|[ée]chalote|ail|poireau|courgette|aubergine|poivron|tomate|salade|laitue|roquette|[ée]pinard|brocoli|chou|champignon|pomme de terre|patate|citron|lime|orange|pomme|poire|banane|fraise|framboise|myrtille|avocat|concombre|radis|betterave|c[ée]leri|fenouil|potiron|butternut|courge|persil|coriandre|basilic|menthe|ciboulette|thym|romarin|gingembre|haricots? verts?|petits? pois|ma[iï]s frais|mangue|ananas|kiwi|raisin|herbes)(?![\p{L}\p{N}])/iu],
    ['🥩 Viandes & poissons', /(?<![\p{L}\p{N}])(poulet|dinde|b[oœ]uf|steak|hach[ée]|porc|lardons?|jambon|saucisses?|chorizo|veau|agneau|canard|saumon|thon frais|cabillaud|colin|crevettes?|moules|poisson|lieu|merlu|filet mignon|escalope)(?![\p{L}\p{N}])/iu],
    ['🧀 Crémerie & œufs', /(?<![\p{L}\p{N}])(lait|beurre|cr[eè]me|yaourts?|fromage|parmesan|mozzarella|feta|ch[eè]vre|comt[ée]|emmental|gruy[eè]re|ricotta|mascarpone|[œo]eufs?|skyr|fromage blanc|cheddar|reblochon)(?![\p{L}\p{N}])/iu],
    ['🥖 Boulangerie', /(?<![\p{L}\p{N}])(pain|baguette|tortillas?|wraps?|pita|brioche|burger)(?![\p{L}\p{N}])/iu],
    ['❄️ Surgelés', /(?<![\p{L}\p{N}])(surgel[ée]s?)(?![\p{L}\p{N}])/iu],
    ['🥫 Épicerie', /(?<![\p{L}\p{N}])(riz|p[âa]tes|spaghetti|penne|lentilles|pois chiches|haricots? rouges|haricots? blancs|quinoa|boulgour|semoule|farine|sucre|sel|poivre|huile|vinaigre|moutarde|sauce|bouillon|cube|lait de coco|coco|conserve|tomates? concass[ée]es|coulis|concentr[ée]|cumin|curry|paprika|curcuma|cannelle|muscade|herbes de provence|origan|piment|levure|chocolat|miel|confiture|flocons|avoine|noix|amandes|noisettes|graines|s[ée]same|soja|nouilles|thon|sardines|ma[iï]s|olives|c[aâ]pres|cornichons|bl[ée]|vermicelles|chapelure|caf[ée]|th[ée]|cacao|maple|sirop|vanille)(?![\p{L}\p{N}])/iu],
    ['🥤 Boissons', /(?<![\p{L}\p{N}])(jus|eau gazeuse|vin|bi[eè]re|cidre)(?![\p{L}\p{N}])/iu]
];
const OTHER_AISLE = '🧺 Autres';
const AISLE_ORDER = [...AISLES.map(a => a[0]), OTHER_AISLE];

function parseQty(s) {
    s = s.trim();
    if (FRACTIONS[s] !== undefined) return FRACTIONS[s];
    let m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
    m = s.match(/^(\d+)\s*([½¼¾⅓⅔])$/);
    if (m) return Number(m[1]) + FRACTIONS[m[2]];
    m = s.match(/^(\d+)\/(\d+)$/);
    if (m) return Number(m[1]) / Number(m[2]);
    return Number(s.replace(',', '.'));
}

// « 200 g de riz basmati » → { qty: 200, unit: 'g', name: 'riz basmati', raw }
function parseIngredient(line) {
    let raw = String(line).replace(/^\s*[-*+]\s+(\[[ xX]\]\s+)?/, '').trim();
    if (!raw) return null;
    let rest = raw;
    let qty = null, unit = '', factor = 1;
    const q = rest.match(/^(\d+\s+\d+\/\d+|\d+\s*[½¼¾⅓⅔]|\d+\/\d+|\d+(?:[.,]\d+)?|[½¼¾⅓⅔])\s*(?:à\s*\d+(?:[.,]\d+)?\s*)?/);
    if (q) {
        qty = parseQty(q[1]);
        rest = rest.slice(q[0].length);
        for (const u of UNITS) {
            const m = rest.match(u.re);
            if (m) { unit = u.unit; factor = u.factor; rest = rest.slice(m[0].length).trim(); break; }
        }
        // « 1 boîte (400 g) de pois chiches » : la précision reste accolée au nom
        const paren = rest.match(/^\(([^)]*)\)\s*/);
        if (paren) rest = rest.slice(paren[0].length);
        rest = rest.replace(/^(de |d['’]|des |du )/i, '').trim();
        if (paren) rest = `${rest} (${paren[1]})`;
        qty *= factor;
    }
    // Précision entre parenthèses conservée pour l'affichage, ignorée pour le regroupement.
    const name = rest.replace(/\s+/g, ' ').trim();
    const key = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(.*?\)/g, '').replace(/[,;].*$/, '').replace(/s\b/g, '').trim();
    return { qty, unit, name, key, raw };
}

// Ingrédients d'une recette : liste sous le titre « Ingrédients ».
function ingredientsOf(body) {
    const lines = String(body || '').split('\n');
    const out = [];
    let inSection = false;
    for (const l of lines) {
        const h = l.match(/^#{1,6}\s+(.*)$/);
        if (h) { inSection = /ingr[ée]dients?/i.test(h[1]); continue; }
        if (!inSection) continue;
        if (/^\s*[-*+]\s+/.test(l)) { const ing = parseIngredient(l); if (ing) out.push(ing); }
    }
    return out;
}

function aisleOf(name) {
    const singular = String(name).replace(/(\p{L})[sx]\b/gu, '$1');
    for (const [aisle, re] of AISLES) if (re.test(name) || re.test(singular)) return aisle;
    return OTHER_AISLE;
}

function roundQty(q) {
    if (q >= 100) return Math.round(q / 5) * 5;
    if (q >= 10) return Math.round(q);
    return Math.round(q * 4) / 4;
}

function fmtQty(qty, unit) {
    if (qty === null || qty === undefined || isNaN(qty)) return '';
    let q = qty, u = unit;
    if (u === 'g' && q >= 1000) { q = q / 1000; u = 'kg'; }
    if (u === 'ml' && q >= 1000) { q = q / 1000; u = 'l'; }
    q = roundQty(q);
    const whole = Math.floor(q), frac = q - whole;
    const fracTxt = { 0.25: '¼', 0.5: '½', 0.75: '¾' }[Math.round(frac * 4) / 4] || '';
    const num = u === 'kg' || u === 'l' ? String(Number(q.toFixed(2))).replace('.', ',') : (fracTxt ? `${whole || ''}${fracTxt}` : String(Math.round(q)));
    const plural = q > 1 && !['g', 'kg', 'ml', 'l', 'c. à soupe', 'c. à café'].includes(u) ? 's' : '';
    return u ? `${num} ${u}${plural}` : num;
}

// « 200 g de lentilles », « 2 c. à soupe d'huile », « 3 oignons »
function ingredientText(qty, unit, name) {
    if (qty === null || qty === undefined || !qty) return name;
    const q = fmtQty(qty, unit);
    if (unit) return `${q} ${/^[aeiouyhàâéèêîôû]/i.test(name) ? 'd’' : 'de '}${name}`;
    // pluriel du premier mot : « 3 oignons », « 2 pommes de terre », « 2 poireaux »
    const plural = roundQty(qty) > 1;
    const n = plural ? name.replace(/^(\p{L}+)/u, w => /[sxz]$/i.test(w) ? w : /(eau|au|eu)$/i.test(w) ? w + 'x' : w + 's') : name;
    return `${q} ${n}`;
}

// Liste de courses : additionne les ingrédients de repas planifiés.
// meals = [{ recipe: { id, title, body, portions }, portions }]
function shoppingList(meals) {
    const items = new Map();
    for (const { recipe, portions } of meals) {
        const base = Number(recipe.portions) || 2;
        const ratio = (Number(portions) || base) / base;
        for (const ing of ingredientsOf(recipe.body)) {
            const k = `${ing.key}|${ing.qty === null ? '-' : ing.unit}`;
            const cur = items.get(k) || { name: ing.name, unit: ing.unit, qty: ing.qty === null ? null : 0, recipes: new Set(), key: ing.key };
            if (ing.qty !== null && cur.qty !== null) cur.qty += ing.qty * ratio;
            cur.recipes.add(recipe.title);
            items.set(k, cur);
        }
    }
    const byAisle = new Map(AISLE_ORDER.map(a => [a, []]));
    for (const it of items.values()) byAisle.get(aisleOf(it.name)).push(it);
    for (const list of byAisle.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return [...byAisle.entries()].filter(([, l]) => l.length).map(([aisle, list]) => ({
        aisle,
        items: list.map(it => ({ key: it.key, text: ingredientText(it.qty, it.unit, it.name), recipes: [...it.recipes] }))
    }));
}

// Met à l'échelle une ligne d'ingrédient pour l'affichage (page recette).
function scaleLine(line, ratio) {
    const ing = parseIngredient(line);
    if (!ing || ing.qty === null) return ing ? ing.raw : line;
    return ingredientText(ing.qty * ratio, ing.unit, ing.name);
}

module.exports = { parseIngredient, ingredientsOf, shoppingList, aisleOf, fmtQty, scaleLine, AISLE_ORDER };
