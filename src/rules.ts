/**
 * Le format de Rule à nous (ADR 0011), Army par Army.
 *
 * Une Army passée à ce format ne publie plus aucun Effect de 40kdc-data : ce
 * que font ses Rules vient des seuls Modifiers de ses Contributions. Les autres
 * gardent l'ancien chemin jusqu'à la bascule.
 */
import { SIMULATED_MODIFIERS, type ArmyFile, type CoreFile, type Modifier, type RuleBody, type UnitAbility } from '@paintplanplay/dataset-schema';
import { CORE_ROOT } from './corrections/apply.ts';

export const RULE_FORMAT_ARMIES: ReadonlySet<string> = new Set(['orks']);

/**
 * Les règles Core qu'une datasheet porte comme un statut, par leur nom BSData :
 * elles ne sont pas des Rules, mais des Modifiers posés directement sur l'Unit.
 * Les mots-clés d'arme (Lethal Hits…) restent sur les profils.
 */
const CORE_STATUSES: Record<string, string> = {
  'feel no pain': 'feel-no-pain',
  'deep strike': 'deep-strike',
  stealth: 'stealth',
  'lone operative': 'lone-operative',
  scouts: 'scouts',
  infiltrators: 'infiltrators',
  'fights first': 'fights-first',
  'deadly demise': 'deadly-demise',
  'firing deck': 'firing-deck',
  hover: 'hover',
};

const coreName = (name: string) => name.trim().toLowerCase();

export const isCoreRule = (name: string) => coreName(name) in CORE_STATUSES;

/** « Feel No Pain 5+ » → `feel-no-pain: 5+` ; « Scouts 6" » → `scouts: 6`. `undefined` hors des règles Core connues. */
export function coreStatus(raw: string): Modifier | undefined {
  const lower = coreName(raw);
  const name = Object.keys(CORE_STATUSES).find((n) => lower === n || lower.startsWith(`${n} `));
  if (!name) return undefined;
  const rest = raw.trim().slice(name.length).trim().replace(/["”]$/, '');
  const value = /^\d+$/.test(rest) ? Number(rest) : rest || undefined;
  return { key: CORE_STATUSES[name], ...(value !== undefined ? { value } : {}), target: 'self' };
}

const strip = (body: RuleBody & Partial<Pick<UnitAbility, 'effectSource' | 'conditional'>>) => {
  delete body.effect;
  delete body.scope;
  delete body.effectSource;
  delete body.conditional;
};

/**
 * Retire d'une Army au nouveau format tout ce qui vient de l'ancien : Effects
 * amont et analyse d'aptitudes. Rend les Effects de 40kdc-data retirés, par
 * adresse de Rule : ils restent la deuxième lecture de la revue.
 */
export function toRuleFormat(army: ArmyFile): Record<string, unknown> {
  const kdc: Record<string, unknown> = {};
  for (const r of rulesIn(new Map([['armies', army]]))) {
    const body = r.body as RuleBody & Partial<Pick<UnitAbility, 'effectSource'>>;
    // Une aptitude n'a de lecture 40kdc-data que si son Effect en vient, pas de l'analyse.
    if (body.effect !== undefined && (r.type !== 'ability' || body.effectSource === '40kdc')) kdc[r.target] = body.effect;
  }
  for (const s of army.stratagems) strip(s);
  for (const r of army.armyRules ?? []) strip(r);
  for (const d of army.detachments) for (const el of [...d.rules, ...d.enhancements]) strip(el);
  for (const u of army.units) for (const a of u.abilities) strip(a);
  return kdc;
}

/** Un Modifier du Dataset, avec l'adresse de la Rule qui le porte (celle d'une Contribution). */
export interface PlacedModifier {
  target: string;
  rule: string;
  modifier: Modifier;
}

/** Une Rule du Dataset, à l'adresse de ses Contributions. */
export interface PlacedRule {
  target: string;
  /** L'Army qui la porte, `core` pour un Stratagem Core. */
  army: string;
  /** « ability », « rule », « enhancement », « stratagem », « armyrule ». */
  type: string;
  body: RuleBody & { name: string };
}

/** Toutes les Rules des fichiers d'un Dataset, une fois chacune : une Unit alliée compte dans son Army. */
export function rulesIn(files: Map<string, unknown>): PlacedRule[] {
  const out: PlacedRule[] = [];
  const seen = new Set<string>();
  const take = (target: string, army: string, type: string, body: RuleBody & { name: string }) => {
    if (seen.has(target)) return;
    seen.add(target);
    out.push({ target, army, type, body });
  };
  for (const [path, file] of files) {
    if (path.endsWith('/core.json')) for (const s of (file as CoreFile).stratagems ?? []) take(`${CORE_ROOT}::stratagem:${s.id}`, CORE_ROOT, 'stratagem', s);
    if (!path.includes('armies')) continue;
    const army = file as ArmyFile;
    for (const r of army.armyRules ?? []) take(`${army.id}::armyrule:${r.id}`, army.id, 'armyrule', r);
    for (const s of army.stratagems) take(`${army.id}::stratagem:${s.id}`, army.id, 'stratagem', s);
    for (const d of army.detachments) {
      for (const r of d.rules) take(`${army.id}::rule:${d.id}|${r.id}`, army.id, 'rule', r);
      for (const e of d.enhancements) take(`${army.id}::enhancement:${d.id}|${e.id}`, army.id, 'enhancement', e);
    }
    for (const u of army.units) if (!u.ally) for (const a of u.abilities) take(`${u.id}::ability:${a.name}`, army.id, 'ability', a);
  }
  return out;
}

/** Tous les Modifiers des fichiers d'un Dataset, Options comprises. */
export function modifiersIn(files: Map<string, unknown>): PlacedModifier[] {
  return rulesIn(files).flatMap(({ target, body }) =>
    [...(body.modifiers ?? []), ...(body.options ?? []).flatMap((o) => o.modifiers)].map((modifier) => ({ target, rule: body.name, modifier })),
  );
}

/** Une clé que la Simulation ne sait pas jouer : une saisie à reprendre, ou un oubli du simulateur. */
export interface UnsimulatedKey {
  target: string;
  rule: string;
  key: string;
}

export const findUnsimulated = (files: Map<string, unknown>): UnsimulatedKey[] =>
  modifiersIn(files)
    .filter((m) => !(m.modifier.key in SIMULATED_MODIFIERS))
    .map((m) => ({ target: m.target, rule: m.rule, key: m.modifier.key }));
