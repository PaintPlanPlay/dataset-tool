/**
 * Lecture des aptitudes de datasheet.
 *
 * Le texte des aptitudes est de la prose : on n'en tire pas tout, mais les
 * formulations de la 10e/11e édition sont très stéréotypées et couvrent
 * l'essentiel de ce qui change un jet. Ce qui n'est pas reconnu n'est pas perdu
 * — l'aptitude reste affichée, et l'utilisateur pose la condition à la main.
 */
import type { SimModifiers as CombatOptions } from './modifiers.ts';
import type { Ability } from './types.ts';

/**
 * Un bonus isolé au sein d'une aptitude.
 *
 * Une même aptitude en porte souvent plusieurs, et ils ne se déclenchent pas
 * ensemble : « Prophet of Da Great Waaagh! » donne +1 pour toucher et +1 pour
 * blesser en permanence, mais le critique à 5+ seulement pendant le Waaagh!.
 * Chacun s'active donc séparément.
 */
export interface AbilityPart {
  /** Identifiant stable, pour mémoriser l'activation. */
  id: string;
  label: string;
  effects: Partial<CombatOptions>;
  /** Le texte pose une condition que l'appli ne peut pas vérifier (Waaagh!, objectif tenu…). */
  conditional: boolean;
  /** L'effet ne vaut que pour cette phase ; absent = les deux. */
  phase?: 'melee' | 'shooting';
}

/**
 * Une unité peut recevoir un chef et un soutien : ce sont deux aptitudes
 * distinctes dans les datasheets, de forme identique.
 */
export type AttachKind = 'leader' | 'support';

export interface ParsedAbility {
  name: string;
  text: string;
  /** Renseigné pour les aptitudes « Leader » et « Support ». */
  attachKind: AttachKind | null;
  /** Unités rejoignables, telles qu'écrites dans le texte. */
  attachTargets: string[];
  /** Bonus isolés, activables un par un. Vide si rien n'a été déduit du texte. */
  parts: AbilityPart[];
}

/**
 * Retire le balisage de BSData : gras markdown et marqueurs ^^…^^.
 *
 * Normalise aussi les espaces insécables, semés un peu partout dans le texte
 * source : « add 4 to the Attacks[U+00A0]characteristic » ne se reconnaissait
 * pas. Les retours à la ligne sont préservés, la liste des cibles de « Leader »
 * s'appuie dessus.
 */
export function cleanText(s: string): string {
  return s
    .replace(/\*\*/g, '')
    .replace(/\^\^/g, '')
    .replace(/<\/?ins>/g, '')
    .replace(/[‐-―−]/g, '-')
    .replace(/[^\S\r\n]+/g, ' ')
    .trim();
}

const CONDITIONAL = /\b(if the waaagh|while the waaagh|once per battle|if this unit is within range of an objective|below half-strength|below its starting strength|if that unit|you can select|roll one d6)/i;

/** Une aptitude qui ne parle que d'une phase ne doit pas s'appliquer à l'autre. */
function detectPhase(t: string): 'melee' | 'shooting' | undefined {
  const melee = /\bmelee (attack|weapon)/i.test(t);
  const ranged = /\b(ranged|shooting) (attack|weapon)/i.test(t);
  if (melee && !ranged) return 'melee';
  if (ranged && !melee) return 'shooting';
  return undefined;
}

interface Rule {
  re: RegExp;
  apply: (m: RegExpMatchArray, e: Partial<CombatOptions>) => string | null;
}

const RULES: Rule[] = [
  {
    re: /add (\d+) to the hit roll/i,
    apply: (m, e) => ((e.hitModifier = (e.hitModifier ?? 0) + Number(m[1])), `+${m[1]} to hit`),
  },
  {
    re: /subtract (\d+) from the hit roll/i,
    apply: (m, e) => ((e.hitModifier = (e.hitModifier ?? 0) - Number(m[1])), `-${m[1]} to hit`),
  },
  {
    re: /add (\d+) to the wound roll/i,
    apply: (m, e) => ((e.woundModifier = (e.woundModifier ?? 0) + Number(m[1])), `+${m[1]} to wound`),
  },
  {
    re: /subtract (\d+) from the wound roll/i,
    apply: (m, e) => ((e.woundModifier = (e.woundModifier ?? 0) - Number(m[1])), `-${m[1]} to wound`),
  },
  {
    re: /critical hit is scored on (?:a |an )?(?:successful )?unmodified hit roll of (\d)\+/i,
    apply: (m, e) => ((e.critHit = Number(m[1])), `crit hit ${m[1]}+`),
  },
  {
    re: /critical wound is scored on (?:a |an )?(?:successful )?unmodified wound roll of (\d)\+/i,
    apply: (m, e) => ((e.critWound = Number(m[1])), `crit wound ${m[1]}+`),
  },
  { re: /\[lethal hits\]/i, apply: (_m, e) => ((e.grantLethal = true), 'Lethal Hits') },
  { re: /\[devastating wounds\]/i, apply: (_m, e) => ((e.grantDevastating = true), 'Devastating Wounds') },
  { re: /\[twin-linked\]/i, apply: (_m, e) => ((e.grantTwinLinked = true), 'Twin-linked') },
  { re: /\[ignores cover\]/i, apply: (_m, e) => ((e.grantIgnoresCover = true), 'Ignores Cover') },
  {
    re: /\[sustained hits (\d+)\]/i,
    apply: (m, e) => ((e.sustainedBonus = (e.sustainedBonus ?? 0) + Number(m[1])), `Sustained Hits ${m[1]}`),
  },
  {
    re: /re-?roll (?:a |the )?hit rolls? of 1/i,
    apply: (_m, e) => ((e.rerollHits = 'ones'), 're-roll hit 1s'),
  },
  {
    re: /re-?roll (?:a |the )?hit rolls?(?! of)/i,
    apply: (_m, e) => ((e.rerollHits = 'all'), 're-roll hits'),
  },
  {
    re: /re-?roll (?:a |the )?wound rolls? of 1/i,
    apply: (_m, e) => ((e.rerollWounds = 'ones'), 're-roll wound 1s'),
  },
  {
    re: /re-?roll (?:a |the )?wound rolls?(?! of)/i,
    apply: (_m, e) => ((e.rerollWounds = 'all'), 're-roll wounds'),
  },
  {
    re: /add (\d+) to the strength characteristic/i,
    apply: (m, e) => ((e.bonusS = (e.bonusS ?? 0) + Number(m[1])), `+${m[1]} Str`),
  },
  {
    re: /improve the armou?r penetration characteristic[^.]*?by (\d+)/i,
    apply: (m, e) => ((e.bonusAP = (e.bonusAP ?? 0) + Number(m[1])), `+${m[1]} AP`),
  },
  {
    re: /add (\d+) to the damage characteristic/i,
    apply: (m, e) => ((e.bonusD = (e.bonusD ?? 0) + Number(m[1])), `+${m[1]} damage`),
  },
  {
    re: /add (\d+) to the attacks characteristic/i,
    apply: (m, e) => ((e.extraAttacks = (e.extraAttacks ?? 0) + Number(m[1])), `+${m[1]} attack`),
  },
];

/**
 * Découpe le texte en propositions. Chaque « and » ou fin de phrase sépare deux
 * bonus, ce qui permet de savoir lequel porte la condition : dans « add 1 to the
 * Hit roll and add 1 to the Wound roll and if the Waaagh! is active […] a
 * Critical Hit is scored on […] 5+ », seul le dernier dépend du Waaagh!.
 */
function segments(text: string): string[] {
  return text
    .split(/\s+and\s+|(?<=[.;])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Extrait les bonus chiffrables d'un texte d'aptitude, un par un. */
export function parseParts(raw: string, abilityName: string): AbilityPart[] {
  const text = cleanText(raw);
  const phase = detectPhase(text);
  const parts: AbilityPart[] = [];
  const covered = new Set<Rule>();

  const push = (rule: Rule, m: RegExpMatchArray, conditional: boolean) => {
    const effects: Partial<CombatOptions> = {};
    const label = rule.apply(m, effects);
    if (!label) return;
    parts.push({ id: `${abilityName}::${label}`, label, effects, conditional, phase });
    covered.add(rule);
  };

  for (const seg of segments(text)) {
    for (const rule of RULES) {
      if (covered.has(rule)) continue;
      const m = seg.match(rule.re);
      if (m) push(rule, m, CONDITIONAL.test(seg));
    }
  }

  // Filet de sécurité : une formulation que le découpage aurait coupée en deux.
  for (const rule of RULES) {
    if (covered.has(rule)) continue;
    const m = text.match(rule.re);
    if (m) push(rule, m, CONDITIONAL.test(text));
  }

  return parts;
}

const BULLET_LINE = /^[-•▪■►*]\s*/;

/**
 * Unités citées par une aptitude « Leader » ou « Support ».
 *
 * Deux écritures coexistent dans BSData et il faut les deux : une liste à puces
 * (Orks, Black Templars) et une énumération en ligne après les deux-points
 * (Custodes, Astra Militarum). Ne gérer que les puces laissait des armées
 * entières sans aucun chef détecté.
 */
export function parseAttachTargets(raw: string): string[] {
  const text = cleanText(raw);
  const colon = text.search(/units?\s*:/i);
  if (colon < 0) return [];
  const after = text.slice(text.indexOf(':', colon) + 1);
  const lines = after
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const bulleted = lines.filter((l) => BULLET_LINE.test(l)).map((l) => l.replace(BULLET_LINE, '').trim());
  if (bulleted.length) return bulleted;

  // En ligne : on s'arrête à la fin de la phrase, le texte reprend souvent après
  // (« You can attach this model even if one CHARACTER is already leading it »).
  const inline = (lines[0] ?? '').split(/\.(?:\s|$)/)[0];
  return inline
    .split(/\s*,\s*|\s+and\s+/i)
    .map((s) => s.replace(/[.;]+$/, '').trim())
    .filter((s) => s.length > 1);
}

export function parseAbility(a: Ability): ParsedAbility {
  const name = a.name.trim();
  const attachKind: AttachKind | null = /^leader$/i.test(name)
    ? 'leader'
    : /^support$/i.test(name)
      ? 'support'
      : null;
  return {
    name: a.name,
    text: cleanText(a.text),
    attachKind,
    attachTargets: attachKind ? parseAttachTargets(a.text) : [],
    // Les aptitudes de rattachement ne décrivent pas de bonus.
    parts: attachKind ? [] : parseParts(a.text, name),
  };
}

export const parseAbilities = (list: Ability[]): ParsedAbility[] => list.map(parseAbility);

/**
 * Fusionne plusieurs effets dans des options de combat.
 * Les bonus chiffrés s'additionnent, les règles octroyées se cumulent, et les
 * seuils critiques retiennent le plus favorable — deux sources de « critique 5+ »
 * ne donnent pas un 4+.
 */
export function applyEffects(base: CombatOptions, effects: Partial<CombatOptions>[]): CombatOptions {
  const out: CombatOptions = { ...base };
  for (const e of effects) {
    if (e.hitModifier) out.hitModifier += e.hitModifier;
    if (e.woundModifier) out.woundModifier += e.woundModifier;
    if (e.bonusS) out.bonusS += e.bonusS;
    if (e.bonusAP) out.bonusAP += e.bonusAP;
    if (e.bonusD) out.bonusD += e.bonusD;
    if (e.extraAttacks) out.extraAttacks += e.extraAttacks;
    if (e.sustainedBonus) out.sustainedBonus += e.sustainedBonus;
    if (e.critHit) out.critHit = Math.min(out.critHit, e.critHit);
    if (e.critWound) out.critWound = Math.min(out.critWound, e.critWound);
    if (e.grantLethal) out.grantLethal = true;
    if (e.grantDevastating) out.grantDevastating = true;
    if (e.grantTwinLinked) out.grantTwinLinked = true;
    if (e.grantIgnoresCover) out.grantIgnoresCover = true;
    // Une relance « toutes » l'emporte sur « les 1 ».
    if (e.rerollHits && (e.rerollHits === 'all' || out.rerollHits === 'none')) out.rerollHits = e.rerollHits;
    if (e.rerollWounds && (e.rerollWounds === 'all' || out.rerollWounds === 'none')) out.rerollWounds = e.rerollWounds;
  }
  return out;
}

/* ------------------------------------------------------------------ Feel No Pain

   Le FNP n'est pas un bonus d'attaquant : il appartient à la figurine qui
   encaisse, et le moteur le lit sur la cible. Il ne passe donc pas par les
   `CombatOptions` comme le reste de ce fichier.

   Sur 71 aptitudes qui le mentionnent dans BSData, la grande majorité est
   conditionnelle — « against Psychic Attacks », « against mortal wounds »,
   « while this model is within 6" », « once per battle ». Les appliquer d'office
   rendrait la moitié des unités du jeu artificiellement dures. On ne retient
   d'emblée que celles qui valent contre tout, tout le temps ; les autres sont
   rendues visibles pour que Florent les coche s'il juge la condition remplie. */

/** Une capacité à ignorer les blessures, telle qu'écrite sur la datasheet. */
export interface FnpOption {
  /** Seuil à égaler ou dépasser pour ignorer la blessure (2..6). */
  value: number;
  /** Aptitude d'origine, pour que le choix reste traçable à l'écran. */
  source: string;
  /**
   * Ce qui la limite : portée, phase, type d'attaque… Vide quand elle vaut
   * contre tout et en permanence — le seul cas qu'on active sans demander.
   */
  caveat: string;
}

/** Ce qui restreint un FNP au point de ne pas l'appliquer d'office. */
const FNP_CAVEATS: [RegExp, string][] = [
  [/against (?:psychic|mortal|[^.]*?attacks)/i, 'certaines attaques seulement'],
  [/\bwithin\b/i, 'de portée'],
  [/\bwhile\b/i, 'situationnel'],
  [/once per battle/i, 'une fois par bataille'],
  [/\bif\b/i, 'conditionnel'],
  [/\bcan use this ability\b/i, 'à déclencher'],
];

/** Extrait les FNP annoncés par une datasheet, conditionnels compris. */
export function fnpOptions(abilities: { name: string; text: string }[]): FnpOption[] {
  const out: FnpOption[] = [];
  for (const a of abilities) {
    const text = cleanText(a.text);
    const m = /feel no pain (\d)\+/i.exec(text);
    if (!m) continue;
    const value = Number(m[1]);
    if (value < 2 || value > 6) continue;
    const caveat = FNP_CAVEATS.find(([re]) => re.test(text))?.[1] ?? '';
    if (!out.some((o) => o.value === value && o.caveat === caveat)) out.push({ value, source: a.name, caveat });
  }
  return out;
}

/**
 * Le FNP à appliquer sans rien demander : le meilleur seuil inconditionnel.
 * `7` quand la datasheet n'en promet aucun — la valeur que le moteur lit comme
 * « aucune capacité ».
 */
export const defaultFnp = (abilities: { name: string; text: string }[]): number =>
  fnpOptions(abilities).filter((o) => !o.caveat).reduce((best, o) => Math.min(best, o.value), 7);
