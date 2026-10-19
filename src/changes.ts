/**
 * Ce qui change d'un Dataset à l'autre, tel qu'un joueur le verrait.
 *
 * Un Dataset se met à plat en faits : un champ d'une entité (Unit, Detachment,
 * Stratagem, Army Rule, Core) sous son Army, rendu en texte lisible. Deux
 * Datasets se comparent fait à fait ; les changements se regroupent par Army
 * puis par entité. Le tableau de bord et le drift report lisent la même chose.
 */
import type { AllyRule, ArmyFile, CoreFile, Detachment, Enhancement, OptionGroup, PriceBand, RuleBody, Stratagem, Unit, Weapon } from '@paintplanplay/dataset-schema';
import { CORE_ROOT } from './corrections/apply.ts';
import { describeEffect, describeModifiers, describeTiming, filterLabel } from './describe.ts';
import { homes, type Homes } from './home.ts';

export type EntityKind = 'unit' | 'detachment' | 'stratagem' | 'armyRule' | 'core';

/** Un champ d'une entité, rendu en texte. */
export interface Fact {
  army: string;
  armyName: string;
  kind: EntityKind;
  id: string;
  name: string;
  /** La fiche qui l'affiche. */
  target: string;
  field: string;
  /** Ce qu'on compare : une liste triée, pour qu'un ordre différent ne compte pas. */
  value: string;
  /** Ce qu'on montre, dans l'ordre du Dataset. */
  shown: string;
  /** Les éléments d'une liste. */
  items?: string[];
}

/** Un champ : du texte, ou une liste dont l'ordre n'est que du bruit. */
type Field = [string, string | string[]];

export interface FieldChange {
  field: string;
  /** `null` : le champ n'existait pas. */
  before: string | null;
  after: string | null;
  /** Pour une liste : ce qui en sort et ce qui y entre. */
  removed?: string[];
  added?: string[];
  /** Rien n'a changé pour un joueur (une liste réordonnée) : montré seulement sur demande. */
  noise?: true;
}

export interface EntityChange {
  kind: EntityKind;
  id: string;
  name: string;
  target: string;
  status: 'added' | 'removed' | 'changed';
  changes: FieldChange[];
}

export interface ArmyChanges {
  id: string;
  name: string;
  entities: EntityChange[];
}


/** Une Weapon en une ligne : chacun de ses profils, nommé quand elle en a plusieurs. */
export const weaponSignature = (w: Weapon) =>
  w.profiles
    .map(
      (p) =>
        `${w.profiles.length > 1 ? `${p.name}: ` : ''}${p.range} A${p.A} ${w.kind === 'melee' ? 'WS' : 'BS'}${p.skill}+ S${p.S} AP${p.AP} D${p.D}${p.keywords.length ? ` [${p.keywords.join(', ')}]` : ''}`,
    )
    .join(' | ');

const bands = (pricing: PriceBand[] | undefined) =>
  (pricing ?? [])
    .map((b) => `${b.from}${b.to === null ? '+' : b.to === b.from ? '' : `-${b.to}`}: ${b.costs.map((c) => `${c.addon ? '+' : ''}${c.models} models ${c.points} pts${c.desc ? ` (${c.desc})` : ''}`).join(', ')}`)
    .join(' | ') || '—';

/** Ce qu'une Rule fait et sa Description, sous un préfixe (« rule "Get Stuck In" · »). */
const ruleFields = (prefix: string, body: RuleBody): Field[] => [
  [`${prefix}effect`, describeEffect(body)],
  [`${prefix}description`, body.summary ?? '—'],
];

const groupLine = (g: OptionGroup) =>
  `${g.pool ? `${g.minPicks}-${g.maxPicks} models` : `up to ${g.maxPicks}`}: ${g.options.map((o) => `${o.name}${o.weapons.length ? ` (${o.weapons.map((w) => w.split('|')[1]).join(', ')})` : ''}`).join(' / ')}`;

/** Les champs d'une Unit, chacun en texte. */
function unitFields(u: Unit): Field[] {
  return [
    ['points', String(u.points)],
    ['MFM pricing', bands(u.pricing)],
    ['Assigned Agent pricing', bands(u.assignedPricing)],
    ['cost brackets', u.costBrackets.map((b) => `over ${b.overModels} models: ${b.points} pts`).join(', ') || '—'],
    ['paid wargear', (u.wargear ?? []).map((w) => `${w.item} ${w.points} pts`)],
    ['model count', `${u.minModels}-${u.maxModels}`],
    ['composition', (u.composition ?? []).map((c) => `${c.min}-${c.max} ${c.name}`)],
    ['Legends', u.isLegends ? 'yes' : 'no'],
    ['Supreme Commander', u.supremeCommander ? 'yes' : 'no'],
    ...u.models.map((m): Field => [`profile "${m.name}"`, `M${m.M} T${m.T} Sv${m.Sv}+ Inv${m.Inv < 7 ? `${m.Inv}+` : '—'} W${m.W} LD${m.LD} OC${m.OC}`]),
    ['keywords', u.keywords],
    ['faction keywords', u.factionKeywords],
    ['army rules', u.armyRules],
    ['statuses', u.statuses?.length ? describeModifiers(u.statuses) : '—'],
    ['units led', u.leaderTargets],
    ['units supported', u.supportTargets],
    ['abilities', u.abilities.map((a) => a.name)],
    ...u.abilities.flatMap((a) => ruleFields(`ability "${a.name}" · `, a)),
    ...u.weapons.map((w): Field => [`weapon "${w.name}"`, weaponSignature(w)]),
    ['default loadout', (u.defaultLoadout ?? []).map((l) => `${l.count}× ${l.weapon}`)],
    ...(u.optionGroups ?? []).map((g): Field => [`wargear options "${g.name}"`, groupLine(g)]),
  ];
}

function enhancementFields(e: Enhancement): Field[] {
  const who = [
    e.requires.length ? `requires ${e.requires.map((g) => g.join(' ')).join(' or ')}` : '',
    e.excludes.length ? `excludes ${e.excludes.join(', ')}` : '',
    e.leaderTo?.length ? `leads ${e.leaderTo.join(', ')}` : '',
    e.supportTo?.length ? `supports ${e.supportTo.join(', ')}` : '',
  ].filter(Boolean);
  const prefix = `enhancement "${e.name}"`;
  return [
    [prefix, [`${e.points} pts`, e.appliesTo, e.aura ? 'aura' : '', e.maxTargets > 1 ? `up to ${e.maxTargets} units` : '', ...who].filter(Boolean).join(' · ')],
    [`${prefix} · weapon`, e.weapon ? `${e.weapon.name}: ${weaponSignature(e.weapon)}` : '—'],
    ...ruleFields(`${prefix} · `, e),
  ];
}

function detachmentFields(d: Detachment): Field[] {
  return [
    ['DP', String(d.dp ?? '—')],
    ['Force Dispositions', d.forceDispositions],
    ['exclusive with', d.uniqueTag ?? '—'],
    ...d.rules.flatMap((r) => [[`rule "${r.name}" · eligible`, filterLabel(r.eligibility) || 'all units'] as Field, ...ruleFields(`rule "${r.name}" · `, r)]),
    ...d.enhancements.flatMap(enhancementFields),
  ];
}

const stratagemFields = (s: Stratagem, detachments: Map<string, string>): Field[] => [
  ['CP', String(s.cp)],
  ['when', describeTiming(s)],
  ['category', s.category ?? '—'],
  ['target', s.target ? filterLabel(s.target) || 'any unit' : '—'],
  ['detachment', s.detachmentId ? (detachments.get(s.detachmentId) ?? s.detachmentId) : '—'],
  ...ruleFields('', s),
];

const allyFields = (r: AllyRule): Field => [
  `ally rule "${r.name}"`,
  [
    r.armies ? `for ${r.armies.join(', ')}` : r.exceptArmies ? `except ${r.exceptArmies.join(', ')}` : 'for every army',
    `admits ${[...(r.admits.factionKeywords ?? []), ...(r.admits.keywords ?? []), ...(r.admits.units ?? [])].join(', ')}`,
    ...(r.limits ?? []).map((l) => `at ${l.battleSize}: ${[...(l.units ?? []).map((u) => `${u.max} ${u.keyword}`), l.points ? `${l.points} pts` : ''].filter(Boolean).join(', ')}`),
  ].join(' · '),
];

const armiesIn = (files: Map<string, unknown>, gameSystem: string) =>
  [...files].filter(([p]) => p.startsWith(`${gameSystem}/armies/`)).map(([, f]) => f as ArmyFile);

/** Un Dataset à plat : un fait par champ, sous une clé stable. */
export function factsOf(files: Map<string, unknown>, gameSystem: string, home: Homes = homes(files)): Map<string, Fact> {
  const facts = new Map<string, Fact>();
  const add = (base: Omit<Fact, 'field' | 'value' | 'shown' | 'items'>, fields: Field[]) => {
    for (const [field, v] of fields) {
      const fact: Fact = Array.isArray(v)
        ? { ...base, field, value: [...v].sort().join(', ') || '—', shown: v.join(', ') || '—', items: v }
        : { ...base, field, value: v, shown: v };
      // Un champ vide n'est pas listé : son apparition se lit comme un ajout, sa disparition comme un retrait.
      if (fact.shown !== '—') facts.set(`${base.army}|${base.kind}|${base.id}|${field}`, fact);
    }
  };
  // Un élément que plusieurs Armies publient ne se lit qu'une fois, sous son Army d'origine.
  const mine = (army: string, target: string) => (home.homeOf(target) ?? army) === army;

  for (const army of armiesIn(files, gameSystem)) {
    const of = { army: army.id, armyName: army.name };
    for (const u of army.units) if (!u.ally) add({ ...of, kind: 'unit', id: u.id, name: u.name, target: u.id }, unitFields(u));
    for (const d of army.detachments) {
      const target = `${army.id}::detachment:${d.id}`;
      if (mine(army.id, target)) add({ ...of, kind: 'detachment', id: d.id, name: d.name, target }, detachmentFields(d));
    }
    const detachments = new Map(army.detachments.map((d) => [d.id, d.name]));
    for (const s of army.stratagems) {
      const target = `${army.id}::stratagem:${s.id}`;
      if (mine(army.id, target)) add({ ...of, kind: 'stratagem', id: s.id, name: s.name, target }, stratagemFields(s, detachments));
    }
    for (const r of army.armyRules ?? []) {
      const target = `${army.id}::armyrule:${r.id}`;
      if (mine(army.id, target)) add({ ...of, kind: 'armyRule', id: r.id, name: r.name, target }, [['eligible', filterLabel(r.eligibility) || 'all units'], ...ruleFields('', r)]);
    }
  }

  const core = files.get(`${gameSystem}/core.json`) as CoreFile | undefined;
  if (core) {
    const of = { army: CORE_ROOT, armyName: 'Core' };
    for (const s of core.stratagems) add({ ...of, kind: 'stratagem', id: s.id, name: s.name, target: `${CORE_ROOT}::stratagem:${s.id}` }, stratagemFields(s, new Map()));
    add({ ...of, kind: 'core', id: CORE_ROOT, name: 'Core', target: CORE_ROOT }, [
      ...core.battleSizes.map((b): Field => [
        `battle size "${b.name}"`,
        `${b.points} pts · ${b.detachmentPoints} DP · ${b.enhancementLimit} Enhancements · ${b.unitLimit} copies of a Unit`,
      ]),
      ...(core.allyRules ?? []).map(allyFields),
      ['default targets', core.referenceTargets.map((t) => `${t.name} ×${t.models}`)],
      ['sample list', core.sampleList ? `${core.sampleList.name} · ${core.sampleList.points} pts · ${core.sampleList.units.map((x) => x.name).join(', ')}` : '—'],
    ]);
  }
  return facts;
}

/**
 * Ce qui sépare deux Datasets, par Army puis par entité. L'Army d'origine d'un
 * élément partagé se lit dans le second, pour qu'il ne change pas de place.
 */
export const diffFiles = (before: Map<string, unknown>, after: Map<string, unknown>, gameSystem: string, options: { noise?: boolean } = {}): ArmyChanges[] => {
  const home = homes(after);
  return compareFacts(factsOf(before, gameSystem, home), factsOf(after, gameSystem, home), options);
};

/** Ce qui sépare deux Datasets mis à plat, par Army puis par entité. */
export function compareFacts(before: Map<string, Fact>, after: Map<string, Fact>, options: { noise?: boolean } = {}): ArmyChanges[] {
  const armies = new Map<string, ArmyChanges>();
  const entities = new Map<string, EntityChange>();
  const entityKeys = (facts: Map<string, Fact>) => new Set([...facts.values()].map((f) => `${f.army}|${f.kind}|${f.id}`));
  const had = entityKeys(before);
  const has = entityKeys(after);

  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(key);
    const a = after.get(key);
    const same = b?.value === a?.value;
    if (same && (b?.shown === a?.shown || !options.noise)) continue;
    const f = (a ?? b)!;
    const entityKey = `${f.army}|${f.kind}|${f.id}`;
    let army = armies.get(f.army);
    if (!army) armies.set(f.army, (army = { id: f.army, name: f.armyName, entities: [] }));
    let entity = entities.get(entityKey);
    if (!entity) {
      const status = !had.has(entityKey) ? 'added' : !has.has(entityKey) ? 'removed' : 'changed';
      entities.set(entityKey, (entity = { kind: f.kind, id: f.id, name: f.name, target: f.target, status, changes: [] }));
      army.entities.push(entity);
    }
    const change: FieldChange = { field: f.field, before: b?.shown ?? null, after: a?.shown ?? null };
    if (b?.items && a?.items) {
      change.removed = b.items.filter((x) => !a.items!.includes(x));
      change.added = a.items.filter((x) => !b.items!.includes(x));
    }
    if (same) change.noise = true;
    entity.changes.push(change);
  }
  return [...armies.values()].sort((x, y) => x.name.localeCompare(y.name));
}
