/**
 * Application d'une Correction à une datasheet.
 *
 * Une Correction répond à une erreur ou à un retard d'une Upstream Source — un
 * codex qui sort et que BSData n'a pas encore intégré, typiquement. Elle se
 * réapplique à chaque construction, de sorte qu'elle survive aux mises à jour
 * au lieu d'être écrasée par elles.
 *
 * L'adresse d'un élément, telle qu'une Correction la porte dans `target` :
 *
 *   unité        « <id de l'Unit> »
 *   figurine     « <id de l'Unit>::model:Boss Nob »
 *   arme         « <id de l'Unit>::weapon:melee|Power klaw »
 *   aptitude     « <id de l'Unit>::ability:Leader »
 *   rattachement « <id de l'Unit>::attachment:leader|Boyz »
 *
 * Elle est portée par le nom et non par l'identifiant BSData des profils : ces
 * identifiants sont régénérés à l'occasion en amont, alors qu'un nom d'arme ou
 * d'aptitude survit aux versions.
 *
 * Aucune Correction ne porte de texte : une aptitude se corrige en présence
 * (ajout, retrait, renommage), jamais en prose.
 */
import type { Detachment, Enhancement } from '@paintplanplay/dataset-schema';
import type { Ability, CatalogueUnit, Statline, Weapon } from '../bsdata/types.ts';
import { weaponRef } from '../bsdata/types.ts';

export type CorrectionEntity = 'unit' | 'model' | 'weapon' | 'ability' | 'attachment';

export const correctionTarget = (unitId: string, entity: CorrectionEntity, name?: string): string =>
  entity === 'unit' ? unitId : `${unitId}::${entity}:${name ?? ''}`;

export interface ParsedTarget {
  /** Racine de l'adresse : l'identifiant de l'Unit. */
  root: string;
  entity: string;
  name: string;
}

export function parseTarget(target: string): ParsedTarget {
  const cut = target.indexOf('::');
  if (cut < 0) return { root: target, entity: 'unit', name: '' };
  const rest = target.slice(cut + 2);
  const sep = rest.indexOf(':');
  return { root: target.slice(0, cut), entity: sep < 0 ? rest : rest.slice(0, sep), name: sep < 0 ? '' : rest.slice(sep + 1) };
}

export const DELETE = '__delete';
export const ADD = '__add';

/** Ce qu'`applyCorrections` consomme : une adresse et les champs à forcer. */
export interface CorrectionInput {
  target: string;
  patch: Record<string, unknown>;
}

export interface ApplyReport {
  applied: number;
  /** Corrections dont la cible est introuvable : à revoir, jamais à ignorer. */
  orphans: { target: string; why: string }[];
}

function fields(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) if (k !== DELETE && k !== ADD) out[k] = v;
  return out;
}

const merge = <T extends object>(target: T, patch: Record<string, unknown>): T => ({ ...target, ...fields(patch) }) as T;

const UNIT_ENTITIES = new Set(['unit', 'model', 'weapon', 'ability', 'attachment']);

/**
 * Applique les Corrections d'Unit à un jeu de datasheets et rend les Units
 * corrigées. Les entrées ne sont jamais mutées : la construction garde sous la
 * main ce que disait l'amont, dont le cycle de vie a besoin.
 *
 * Les rattachements s'appliquent en dernier : une Correction chirurgicale — une
 * cible retirée, les autres gardées — ne doit jamais dépendre de l'ordre dans
 * lequel les fichiers ont été lus.
 */
export function applyCorrections(
  units: CatalogueUnit[],
  corrections: CorrectionInput[],
): { units: CatalogueUnit[]; report: ApplyReport } {
  const report: ApplyReport = { applied: 0, orphans: [] };
  const scoped = corrections.filter((c) => UNIT_ENTITIES.has(parseTarget(c.target).entity));
  if (!scoped.length) return { units, report };

  const byUnit = new Map<string, CorrectionInput[]>();
  for (const c of scoped) {
    const { root } = parseTarget(c.target);
    (byUnit.get(root) ?? byUnit.set(root, []).get(root)!).push(c);
  }

  const index = new Set(units.map((u) => u.id));
  for (const [root, list] of byUnit)
    if (!index.has(root)) for (const c of list) report.orphans.push({ target: c.target, why: `Unit ${root} missing` });

  const out = units.map((unit) => {
    const list = byUnit.get(unit.id);
    if (!list?.length) return unit;
    const ordered = [
      ...list.filter((c) => parseTarget(c.target).entity !== 'attachment'),
      ...list.filter((c) => parseTarget(c.target).entity === 'attachment'),
    ];
    let next: CatalogueUnit = { ...unit };
    for (const c of ordered) {
      const { entity, name } = parseTarget(c.target);
      const applied = applyOne(next, entity, name, c.patch, report, c.target);
      if (applied) {
        next = applied;
        report.applied++;
      }
    }
    next.isAttachable = next.leaderTargets.length > 0 || next.supportTargets.length > 0;
    return next;
  });

  return { units: out, report };
}

function applyOne(
  unit: CatalogueUnit,
  entity: string,
  name: string,
  patch: Record<string, unknown>,
  report: ApplyReport,
  target: string,
): CatalogueUnit | null {
  const remove = patch[DELETE] === true;
  const create = patch[ADD] === true;

  if (entity === 'unit') {
    if (remove) return { ...unit, isLegends: true, points: 0 };
    return merge(unit, patch);
  }

  if (entity === 'model') {
    const i = unit.models.findIndex((m) => m.name === name);
    // Retirer ce que l'amont a déjà retiré ne vise rien : la Correction est périmée, pas orpheline.
    if (i < 0 && remove) return null;
    if (i < 0 && !create) {
      report.orphans.push({ target, why: `model "${name}" missing` });
      return null;
    }
    const models = [...unit.models];
    if (remove) models.splice(i, 1);
    else if (i < 0) models.push(merge({ name } as Statline, patch));
    else models[i] = merge(models[i], patch);
    return { ...unit, models };
  }

  if (entity === 'weapon') {
    const i = unit.weapons.findIndex((w) => weaponRef(w) === name);
    // Retirer ce que l'amont a déjà retiré ne vise rien : la Correction est périmée, pas orpheline.
    if (i < 0 && remove) return null;
    if (i < 0 && !create) {
      report.orphans.push({ target, why: `weapon "${name}" missing` });
      return null;
    }
    const weapons = [...unit.weapons];
    if (remove) {
      weapons.splice(i, 1);
      // Une arme retirée ne doit pas rester dans la dotation par défaut.
      const kept = new Set(weapons.map(weaponRef));
      return { ...unit, weapons, defaultLoadout: unit.defaultLoadout?.filter((d) => kept.has(weaponRef({ kind: d.kind, name: d.weapon }))) };
    }
    if (i < 0) {
      const [kind, wname] = name.split('|');
      weapons.push(merge({ kind, name: wname } as Weapon, patch));
    } else weapons[i] = merge(weapons[i], patch);
    return { ...unit, weapons };
  }

  if (entity === 'attachment') {
    const sep = name.indexOf('|');
    const kind = sep < 0 ? name : name.slice(0, sep);
    const who = sep < 0 ? '' : name.slice(sep + 1);
    const field = kind === 'support' ? 'supportTargets' : 'leaderTargets';
    const current = unit[field];
    const i = current.indexOf(who);
    // Retirer ce que l'amont a déjà retiré ne vise rien : la Correction est périmée, pas orpheline.
    if (i < 0 && remove) return null;
    if (i < 0 && !create) {
      report.orphans.push({ target, why: `target "${who}" missing from ${field}` });
      return null;
    }
    const targets = [...current];
    if (remove) targets.splice(i, 1);
    else if (i < 0) targets.push(who);
    return { ...unit, [field]: targets };
  }

  // entity === 'ability' : présence et nom, jamais de texte.
  const i = unit.abilities.findIndex((a) => a.name === name);
  if (i < 0 && remove) return null;
  if (i < 0 && !create) {
    report.orphans.push({ target, why: `ability "${name}" missing` });
    return null;
  }
  const abilities = [...unit.abilities];
  if (remove) abilities.splice(i, 1);
  else if (i < 0) abilities.push({ name: String(patch.name ?? name), text: '' } as Ability);
  else abilities[i] = { ...abilities[i], name: String(patch.name ?? abilities[i].name) };
  return { ...unit, abilities };
}

// ------------------------------------------------------------ Detachments

export const detachmentTarget = (armyId: string, detachmentId: string) => `${armyId}::detachment:${detachmentId}`;
export const enhancementTarget = (armyId: string, detachmentId: string, enhancementId: string) =>
  `${armyId}::enhancement:${detachmentId}|${enhancementId}`;

/** Champs qu'une Correction peut forcer sur un Detachment ou une Enhancement. */
const DETACHMENT_FIELDS = new Set(['name', 'dp', 'forceDispositions', 'uniqueTag', 'summary']);
const ENHANCEMENT_FIELDS = new Set(['name', 'points', 'appliesTo', 'aura', 'maxTargets', 'requires', 'excludes', 'leaderTo', 'supportTo', 'summary']);

const allowed = (patch: Record<string, unknown>, fields: Set<string>) =>
  Object.fromEntries(Object.entries(patch).filter(([k]) => fields.has(k)));

/**
 * Applique les Corrections de Detachment et d'Enhancement d'une Army. Même
 * contrat que pour les Units : entrées non mutées, `__delete` et `__add` au
 * même sens, une cible introuvable signalée plutôt qu'ignorée.
 *
 *   « <armyId>::detachment:<detachmentId> »
 *   « <armyId>::enhancement:<detachmentId>|<enhancementId> »
 */
export function applyDetachmentCorrections(
  armyId: string,
  detachments: Detachment[],
  corrections: CorrectionInput[],
): { detachments: Detachment[]; report: ApplyReport } {
  const report: ApplyReport = { applied: 0, orphans: [] };
  let list = detachments;
  for (const c of corrections) {
    const { root, entity, name } = parseTarget(c.target);
    if (root !== armyId || (entity !== 'detachment' && entity !== 'enhancement')) continue;
    const remove = c.patch[DELETE] === true;
    const create = c.patch[ADD] === true;

    if (entity === 'detachment') {
      const i = list.findIndex((d) => d.id === name);
      if (i < 0 && remove) continue;
      if (i < 0 && !create) {
        report.orphans.push({ target: c.target, why: `Detachment "${name}" missing` });
        continue;
      }
      if (remove) list = list.filter((_d, j) => j !== i);
      else if (i < 0) list = [...list, { id: name, name, dp: null, forceDispositions: [], rules: [], enhancements: [], ...allowed(c.patch, DETACHMENT_FIELDS) } as Detachment];
      else list = list.map((d, j) => (j === i ? ({ ...d, ...allowed(c.patch, DETACHMENT_FIELDS) } as Detachment) : d));
      report.applied++;
      continue;
    }

    const [detId, enhId] = name.split('|');
    const di = list.findIndex((d) => d.id === detId);
    if (di < 0) {
      report.orphans.push({ target: c.target, why: `Detachment "${detId}" missing` });
      continue;
    }
    const det = list[di];
    const ei = det.enhancements.findIndex((e) => e.id === enhId);
    if (ei < 0 && remove) continue;
    if (ei < 0 && !create) {
      report.orphans.push({ target: c.target, why: `Enhancement "${enhId}" missing from "${det.name}"` });
      continue;
    }
    const fresh: Enhancement = { id: enhId, name: enhId, points: 0, appliesTo: 'character', aura: false, maxTargets: 1, requires: [], excludes: [] };
    const enhancements = remove
      ? det.enhancements.filter((_e, j) => j !== ei)
      : ei < 0
        ? [...det.enhancements, { ...fresh, ...allowed(c.patch, ENHANCEMENT_FIELDS) } as Enhancement]
        : det.enhancements.map((e, j) => (j === ei ? ({ ...e, ...allowed(c.patch, ENHANCEMENT_FIELDS) } as Enhancement) : e));
    list = list.map((d, j) => (j === di ? { ...d, enhancements } : d));
    report.applied++;
  }
  return { detachments: list, report };
}

// ------------------------------------------------------------- Stratagems

/** Racine de l'adresse des Stratagems Core. */
export const CORE_ROOT = 'core';

export const stratagemTarget = (root: string, stratagemId: string) => `${root}::stratagem:${stratagemId}`;

const STRATAGEM_FIELDS = new Set(['name', 'cp', 'phases', 'playerTurn', 'timing', 'category', 'target', 'summary']);

/**
 * Applique les Corrections de Stratagem d'une Army, ou des Stratagems Core
 * (racine `core`). La cible d'un Stratagem est ce qu'on corrige le plus : 40kdc-
 * data ne la renseigne pas toujours, et c'est elle qui filtre le panneau du
 * Game Dashboard (ADR 0004, principe repris).
 */
export function applyStratagemCorrections<T extends { id: string }>(
  root: string,
  stratagems: T[],
  corrections: CorrectionInput[],
): { stratagems: T[]; report: ApplyReport } {
  const report: ApplyReport = { applied: 0, orphans: [] };
  let list = stratagems;
  for (const c of corrections) {
    const { root: r, entity, name } = parseTarget(c.target);
    if (r !== root || entity !== 'stratagem') continue;
    const i = list.findIndex((s) => s.id === name);
    if (i < 0 && c.patch[DELETE] === true) continue;
    if (i < 0) {
      report.orphans.push({ target: c.target, why: `Stratagem "${name}" missing` });
      continue;
    }
    list = c.patch[DELETE] === true ? list.filter((_s, j) => j !== i) : list.map((s, j) => (j === i ? { ...s, ...allowed(c.patch, STRATAGEM_FIELDS) } : s));
    report.applied++;
  }
  return { stratagems: list, report };
}
