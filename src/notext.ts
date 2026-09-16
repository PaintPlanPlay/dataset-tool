/**
 * Le contrôle « aucun texte de règles » : le garde-fou juridique de l'ADR 0005.
 *
 * Il ne fait confiance ni à l'outil ni à la relecture : tout ce qui entre dans
 * le Dataset — sortie de construction, Corrections, résumés, contributions —
 * passe par lui, et un seul constat suffit à refuser. Il cherche trois choses :
 *
 *  - une **clé** qui annonce un texte (`text`, `description`…) ;
 *  - une **prose longue**, qu'aucun champ structuré n'a de raison de porter ;
 *  - des **formulations typiques des règles** (« each time », « add 1 to the
 *    Hit roll »), même dans une phrase courte.
 *
 * Les valeurs d'énumération des Effects (« once-per-battle », « crit-on ») sont
 * écrites en kebab-case et ne ressemblent pas à une phrase : elles passent.
 */

export interface TextFinding {
  /** Emplacement du constat : fichier puis pointeur JSON. */
  where: string;
  reason: string;
  /** Extrait de la valeur incriminée, tronqué. */
  excerpt: string;
}

/** Clés qui ne peuvent porter qu'un texte, quelle que soit leur valeur. */
const TEXT_KEYS = new Set(['text', 'description', 'ruletext', 'rules_text', 'rulestext', 'flavour', 'flavor', 'lore', 'legend', 'body']);

/** Au-delà, une chaîne est de la prose : aucun nom ni champ structuré n'est si long. */
const MAX_WORDS = 30;
const MAX_CHARS = 240;

/** Un résumé écrit par nous reste une ligne : il résume, il ne recopie pas. */
export const MAX_SUMMARY_CHARS = 160;

/** Formulations des règles de Warhammer 40,000, en anglais. Une seule suffit. */
const RULES_PHRASES: [RegExp, string][] = [
  [/\beach time\b/i, '« each time »'],
  [/\b(?:until|at) the (?:end|start) of (?:the|your|a|this|that|each)\b/i, '« until the end of… »'],
  [/\b(?:add|subtract) \d+ (?:to|from) (?:the|its|that|this|their|your)\b/i, '« add N to the… »'],
  [/\bre-?roll (?:a|the|one|that|any)\b/i, '« re-roll the… »'],
  [/\broll (?:one|a|two|three|\d) d(?:3|6)\b/i, '« roll one D6 »'],
  [/\b(?:this|that|the bearer'?s?) (?:unit|model|weapon)(?:'s)? (?:can|must|has|have|gains?|is|makes?)\b/i, '« this unit can… »'],
  [/\byou can (?:use|select|re-?roll|target|choose)\b/i, '« you can select… »'],
  [/\b(?:select|target) one (?:unit|model|enemy|friendly)\b/i, '« select one unit »'],
  [/\bwhile this (?:unit|model)\b/i, '« while this unit »'],
  [/\bin (?:your|the|your opponent'?s) (?:command|movement|shooting|charge|fight) phase\b/i, '« in your Shooting phase »'],
  [/\bmortal wounds?\b.*\b(?:suffers?|inflicts?|allocate)/i, '« suffers mortal wounds »'],
  // « once per battle » n'y figure pas : BSData l'accole au nom d'une aptitude
  // (« Fix Dat Armour Up (Once per battle, per unit) »), ce qui reste un nom.
  [/\b(?:characteristic|characteristics) of\b/i, '« characteristic of »'],
  [/\bwithin (?:engagement range|\d+" of)\b/i, '« within 6" of »'],
  [/\b(?:hit|wound|saving|damage) rolls? of \d\+?/i, '« Hit roll of 6 »'],
];

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

const excerpt = (s: string) => (s.length > 90 ? `${s.slice(0, 87)}…` : s);

/** Constats sur une seule chaîne ; `summary` durcit la limite de longueur. */
export function inspectString(value: string, options: { summary?: boolean } = {}): string[] {
  const reasons: string[] = [];
  if (words(value) > MAX_WORDS) reasons.push(`prose longue (${words(value)} mots)`);
  else if (value.length > MAX_CHARS) reasons.push(`texte long (${value.length} caractères)`);
  if (options.summary && value.length > MAX_SUMMARY_CHARS) reasons.push(`résumé trop long (${value.length} > ${MAX_SUMMARY_CHARS})`);
  for (const [re, label] of RULES_PHRASES) if (re.test(value)) reasons.push(`formulation de règle ${label}`);
  return reasons;
}

/**
 * Parcourt une valeur JSON et rend tous les constats. `where` préfixe les
 * emplacements rendus, typiquement le chemin du fichier.
 */
export function findRulesText(data: unknown, where = ''): TextFinding[] {
  const out: TextFinding[] = [];
  const walk = (node: unknown, pointer: string, key: string) => {
    if (typeof node === 'string') {
      for (const reason of inspectString(node, { summary: key === 'summary' }))
        out.push({ where: `${where}${pointer || '/'}`, reason, excerpt: excerpt(node) });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${pointer}/${i}`, key));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        const here = `${pointer}/${k}`;
        if (TEXT_KEYS.has(k.toLowerCase()) && v !== '' && v !== null)
          out.push({ where: `${where}${here}`, reason: `clé de texte « ${k} »`, excerpt: excerpt(typeof v === 'string' ? v : JSON.stringify(v)) });
        walk(v, here, k);
      }
    }
  };
  walk(data, '', '');
  return out;
}
