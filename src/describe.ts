/**
 * Ce qu'une Rule fait, dit comme les apps le disent aux joueurs : une
 * ligne générée à partir de ses Modifiers, jamais d'un texte de règles.
 *
 * C'est une imitation de l'affichage des apps, tenue à la main : le tableau de
 * bord montre ce que les joueurs liront, pour corriger avant publication ce qui
 * serait incompréhensible. Quand les apps changent leur façon de dire, ceci suit.
 */
import {
  DISPLAYED_MODIFIERS,
  SIMULATED_CONDITIONS,
  SIMULATED_MODIFIERS,
  STRATAGEM_TRIGGERS,
  UNIT_MODIFIERS,
  type Condition,
  type KeywordFilter,
  type Modifier,
  type RuleBody,
  type Stratagem,
  type Unit,
  type WargearOption,
  wargearSentence,
} from '@paintplanplay/dataset-schema';

const humanize = (s: string) => s.replace(/[-_]+/g, ' ').trim();
const signed = (n: number) => (n < 0 ? `${n}` : `+${n}`);

export function filterLabel(k: KeywordFilter | undefined): string {
  if (!k) return '';
  const any = k.anyOf.length ? [k.anyOf.join(' or ')] : [];
  const none = k.noneOf.map((w) => `non-${w}`);
  return [...k.allOf, ...any, ...none].join(' ');
}

function targetSuffix(m: Modifier): string {
  const who = filterLabel(m.keywords);
  switch (m.target) {
    case 'enemy':
      return ` (${who ? `${who} ` : ''}enemy)`;
    case 'attached':
      return ` (${who ? `${who} ` : ''}attached unit)`;
    case 'aura':
      return ` (${who || 'friendly units'}${m.range ? ` within ${m.range}"` : ' nearby'})`;
    default:
      return '';
  }
}

/** Les statuts Core : dits par leur nom de règle, valeur à la suite (« Scouts 6" »). */
const STATUS_LABELS: Record<string, string> = {
  'deep-strike': 'Deep Strike',
  'lone-operative': 'Lone Operative',
  scouts: 'Scouts',
  infiltrators: 'Infiltrators',
  'fights-first': 'Fights First',
  'deadly-demise': 'Deadly Demise',
  'firing-deck': 'Firing Deck',
  hover: 'Hover',
};

/** Les clés qui s'ajoutent à un jet, dés compris. */
const ROLL_KEYS = new Set(['advance', 'charge']);

/** Un Modifier dit par sa clé et sa valeur, sans sa cible. */
function modifierCore(m: Modifier): string {
  if (m.key === 'fight-on-death') {
    const t = typeof m.value === 'number' ? m.value : Number(String(m.value ?? '').match(/^(\d)\+$/)?.[1] ?? 1);
    return t > 1 ? `Fight on Death ${t}+` : 'Fight on Death';
  }
  const status = STATUS_LABELS[m.key];
  if (status) return m.value === undefined ? status : `${status} ${m.value}${m.key === 'scouts' ? '"' : ''}`;
  if (m.key === 'invulnerable-save' && m.value !== undefined) return `${m.value} invulnerable save`;
  if (m.key === 'M' && typeof m.value === 'number') return `${signed(m.value)}" Move`;
  const known = SIMULATED_MODIFIERS[m.key] ?? UNIT_MODIFIERS[m.key] ?? DISPLAYED_MODIFIERS[m.key];
  const label = known?.label ?? humanize(m.key);
  const v = m.value;
  if (v === undefined) return label;
  if (m.key.startsWith('reroll-')) return v === '1' || v === 1 ? `${label} rolls of 1` : label;
  if (typeof v === 'number') {
    if (m.key === 'sustained-hits') return `${label} ${v}`;
    return `${signed(v)} ${label}`;
  }
  if (ROLL_KEYS.has(m.key) && /^\d*D\d/.test(v)) return `+${v} ${label}`;
  return `${label} ${v}`;
}

const describeCondition = (c: Condition) => `${SIMULATED_CONDITIONS[c.key]?.label ?? humanize(c.key)}${c.value !== undefined ? ` ${c.value}` : ''}`;
const conditionSuffix = (m: Modifier) => (m.conditions?.length ? ` — if ${m.conditions.map(describeCondition).join(', ')}` : '');

export const describeModifier = (m: Modifier) => `${modifierCore(m)}${targetSuffix(m)}${conditionSuffix(m)}`;
export const describeModifiers = (ms: Modifier[]) => ms.map(describeModifier).join('; ');

/**
 * Ce que fait une Rule, Modifiers ou Options, sans la borne de longueur de
 * l'affichage : un changement au-delà doit rester visible. `—` sans rien.
 */
export function describeEffect(body: RuleBody): string {
  if (body.options?.length) return `one of: ${body.options.map((o) => `${o.name}: ${describeModifiers(o.modifiers)}`).join(' / ')}`;
  return body.modifiers?.length ? describeModifiers(body.modifiers) : '—';
}

const words = (xs: string[]) => xs.map(humanize).join(', ');

/** Quand et comment se joue un Stratagem, en une ligne. */
export function describeTiming(s: Stratagem): string {
  return [
    words(s.phases),
    humanize(s.playerTurn),
    humanize(s.timing),
    s.trigger ? STRATAGEM_TRIGGERS[s.trigger]?.label ?? humanize(s.trigger) : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * Une Wargear Option comme les apps la montrent : sa phrase, ses alternatives
 * quand elle en offre plusieurs, et ce que coûte chacune — par figurine.
 */
export function describeWargearOption(unit: Unit, o: WargearOption): string {
  const sentence = wargearSentence(unit, o);
  const cost = (a: WargearOption['alternatives'][number]) => {
    const line = a.wargearCost && unit.wargear?.find((w) => w.item === a.wargearCost!.item);
    return line ? ` (+${line.points * (a.wargearCost!.quantity ?? 1)} pts)` : '';
  };
  return sentence.items ? [sentence.text, ...sentence.items.map((item, i) => `- ${item}${cost(o.alternatives[i])}`)].join('\n') : `${sentence.text}${cost(o.alternatives[0])}`;
}
