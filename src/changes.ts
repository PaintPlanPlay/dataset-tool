/**
 * Ce qui change d'un Dataset à l'autre, tel qu'un joueur le verrait.
 *
 * Un Dataset se met à plat en faits : un champ d'une entité (Unit, Detachment,
 * Stratagem, Army Rule, Core) sous son Army, rendu en texte lisible. Deux
 * Datasets se comparent fait à fait ; les changements se regroupent par Army
 * puis par entité. Le tableau de bord et le drift report lisent la même chose.
 */
import type { ArmyFile, Unit } from '@paintplanplay/dataset-schema';

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
  value: string;
}

export interface FieldChange {
  field: string;
  /** `null` : le champ n'existait pas. */
  before: string | null;
  after: string | null;
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

const list = (xs: string[]) => xs.join(', ') || '—';

/** Une Weapon en une ligne : chacun de ses profils, nommé quand elle en a plusieurs. */
export const weaponSignature = (w: Unit['weapons'][number]) =>
  w.profiles
    .map(
      (p) =>
        `${w.profiles.length > 1 ? `${p.name}: ` : ''}${p.range} A${p.A} ${w.kind === 'melee' ? 'WS' : 'BS'}${p.skill}+ S${p.S} AP${p.AP} D${p.D}${p.keywords.length ? ` [${p.keywords.join(', ')}]` : ''}`,
    )
    .join(' | ');

/** Les champs d'une Unit, chacun en texte. */
function unitFields(u: Unit): [string, string][] {
  const fields: [string, string][] = [
    ['points', String(u.points)],
    ['MFM pricing', JSON.stringify(u.pricing ?? [])],
    ['paid wargear', (u.wargear ?? []).map((w) => `${w.item} ${w.points}`).join(', ') || '—'],
    ['model count', `${u.minModels}-${u.maxModels}`],
    ...u.models.map((m): [string, string] => [`profile "${m.name}"`, `M${m.M} T${m.T} Sv${m.Sv}+ Inv${m.Inv < 7 ? `${m.Inv}+` : '—'} W${m.W} LD${m.LD} OC${m.OC}`]),
    ['keywords', list(u.keywords)],
    ['faction keywords', list(u.factionKeywords)],
    ['army rules', list(u.armyRules)],
    ['units led', list(u.leaderTargets)],
    ['units supported', list(u.supportTargets)],
    ['abilities', list(u.abilities.map((a) => a.name))],
    ...u.weapons.map((w): [string, string] => [`weapon "${w.name}"`, weaponSignature(w)]),
  ];
  return fields;
}

const armiesIn = (files: Map<string, unknown>, gameSystem: string) =>
  [...files].filter(([p]) => p.startsWith(`${gameSystem}/armies/`)).map(([, f]) => f as ArmyFile);

/** Un Dataset à plat : un fait par champ, sous une clé stable. */
export function factsOf(files: Map<string, unknown>, gameSystem: string): Map<string, Fact> {
  const facts = new Map<string, Fact>();
  const add = (base: Omit<Fact, 'field' | 'value'>, fields: [string, string][]) => {
    for (const [field, value] of fields) facts.set(`${base.army}|${base.kind}|${base.id}|${field}`, { ...base, field, value });
  };
  for (const army of armiesIn(files, gameSystem)) {
    const of = { army: army.id, armyName: army.name };
    // Une Unit alliée figure dans plusieurs Armies : elle ne se lit que dans la sienne.
    for (const u of army.units) if (!u.ally) add({ ...of, kind: 'unit', id: u.id, name: u.name, target: u.id }, unitFields(u));
  }
  return facts;
}

/** Ce qui sépare deux Datasets mis à plat, par Army puis par entité. */
export function compareFacts(before: Map<string, Fact>, after: Map<string, Fact>): ArmyChanges[] {
  const armies = new Map<string, ArmyChanges>();
  const entities = new Map<string, EntityChange>();
  const entityKeys = (facts: Map<string, Fact>) => new Set([...facts.values()].map((f) => `${f.army}|${f.kind}|${f.id}`));
  const had = entityKeys(before);
  const has = entityKeys(after);

  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(key);
    const a = after.get(key);
    if (b?.value === a?.value) continue;
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
    entity.changes.push({ field: f.field, before: b?.value ?? null, after: a?.value ?? null });
  }
  return [...armies.values()].sort((x, y) => x.name.localeCompare(y.name));
}
