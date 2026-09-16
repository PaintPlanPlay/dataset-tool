/**
 * Le cycle de vie d'une Correction, recalculé à chaque construction.
 *
 * Une Correction n'a pas de fin naturelle : le jour où l'amont se corrige —
 * souvent parce qu'on lui a proposé la PR — elle devient un doublon de la
 * source, et il faut la retirer. Trois valeurs tranchent : ce que l'amont
 * disait quand on a corrigé (`upstream`), ce que l'amont dit aujourd'hui, et ce
 * qu'on force (`patch`).
 *
 *   amont aujourd'hui == patch      → périmée, à retirer
 *   amont aujourd'hui == upstream   → active, toujours nécessaire
 *   amont aujourd'hui == autre chose → en conflit, un humain tranche
 */
import type { Detachment } from '@paintplanplay/dataset-schema';
import type { CatalogueUnit } from '../bsdata/types.ts';
import { weaponRef } from '../bsdata/types.ts';
import { ADD, DELETE, parseTarget } from './apply.ts';
import type { CorrectionFile } from './files.ts';

export type CorrectionState = 'active' | 'stale' | 'conflict';

export const STATE_LABEL: Record<CorrectionState, string> = { active: 'active', stale: 'périmée', conflict: 'en conflit' };

export interface CorrectionVerdict {
  path: string;
  target: string;
  state: CorrectionState;
  note: string;
  reason: string;
  upstreamPr?: string;
  /** Ce que dit l'amont aujourd'hui, sur les seuls champs corrigés. */
  upstreamNow: Record<string, unknown>;
}

/** Ce que l'amont de la construction dit de l'adresse d'une Correction. */
export interface Located {
  /** L'Unit, ou l'Army, qui porte l'élément existe. */
  rootFound: boolean;
  /** L'élément lui-même, `undefined` s'il n'existe pas. */
  element?: Record<string, unknown>;
}

/**
 * L'élément qu'une Correction vise, dans une Unit telle que l'amont la donne.
 * `undefined` quand il n'existe pas. Jamais de texte : une aptitude se réduit à
 * son nom.
 */
export function upstreamElement(unit: CatalogueUnit | undefined, target: string): Record<string, unknown> | undefined {
  if (!unit) return undefined;
  const { entity, name } = parseTarget(target);
  if (entity === 'unit') return unit as unknown as Record<string, unknown>;
  if (entity === 'model') return unit.models.find((m) => m.name === name) as Record<string, unknown> | undefined;
  if (entity === 'weapon') return unit.weapons.find((w) => weaponRef(w) === name) as Record<string, unknown> | undefined;
  if (entity === 'ability') {
    const a = unit.abilities.find((x) => x.name === name);
    return a ? { name: a.name } : undefined;
  }
  if (entity === 'attachment') {
    const sep = name.indexOf('|');
    const kind = name.slice(0, sep);
    const who = name.slice(sep + 1);
    const list = kind === 'support' ? unit.supportTargets : unit.leaderTargets;
    return list.includes(who) ? { target: who } : undefined;
  }
  return undefined;
}

/** L'élément qu'une Correction vise parmi des Stratagems. */
export function stratagemElement(stratagems: { id: string }[], target: string): Record<string, unknown> | undefined {
  const { name } = parseTarget(target);
  return stratagems.find((s) => s.id === name) as unknown as Record<string, unknown> | undefined;
}

/** L'élément qu'une Correction vise parmi les Detachments d'une Army. */
export function detachmentElement(detachments: Detachment[], target: string): Record<string, unknown> | undefined {
  const { entity, name } = parseTarget(target);
  if (entity === 'detachment') return detachments.find((d) => d.id === name) as unknown as Record<string, unknown> | undefined;
  if (entity === 'enhancement') {
    const [detId, enhId] = name.split('|');
    return detachments.find((d) => d.id === detId)?.enhancements.find((e) => e.id === enhId) as unknown as Record<string, unknown> | undefined;
  }
  return undefined;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Confronte chaque Correction à l'amont de cette construction. */
export function reconcile(corrections: CorrectionFile[], locate: (target: string) => Located): CorrectionVerdict[] {
  return corrections.map((c): CorrectionVerdict => {
    const base = { path: c.path, target: c.target, reason: c.reason, ...(c.upstreamPr ? { upstreamPr: c.upstreamPr } : {}) };
    const { rootFound, element: up } = locate(c.target);

    // Retrait et ajout se jugent sur la présence de l'élément, pas sur ses champs.
    if (c.patch[DELETE] === true) {
      if (!rootFound) return { ...base, state: 'stale', note: "le porteur a disparu de l'amont : le retrait n'a plus d'objet", upstreamNow: {} };
      return up
        ? { ...base, state: 'active', note: "l'amont porte toujours l'élément retiré", upstreamNow: up }
        : { ...base, state: 'stale', note: "l'amont a retiré l'élément à son tour", upstreamNow: {} };
    }
    if (c.patch[ADD] === true) {
      if (!rootFound) return { ...base, state: 'conflict', note: "le porteur a disparu de l'amont : l'ajout ne s'applique plus à rien", upstreamNow: {} };
      return up
        ? { ...base, state: 'stale', note: "l'amont a ajouté l'élément à son tour", upstreamNow: up }
        : { ...base, state: 'active', note: "l'amont ne porte toujours pas l'élément", upstreamNow: {} };
    }

    if (!up) return { ...base, state: 'conflict', note: "la cible a disparu de l'amont : la Correction ne s'applique plus à rien", upstreamNow: {} };

    const keys = Object.keys(c.patch);
    const upstreamNow = Object.fromEntries(keys.map((k) => [k, up[k]]));
    if (keys.every((k) => same(up[k], c.patch[k]))) return { ...base, state: 'stale', note: "l'amont dit maintenant la même chose que la Correction", upstreamNow };
    if (!c.upstream) return { ...base, state: 'active', note: "valeur amont d'origine non enregistrée : l'amont diffère de la Correction", upstreamNow };
    const moved = keys.filter((k) => !same(up[k], c.upstream?.[k]) && !same(up[k], c.patch[k]));
    if (moved.length) return { ...base, state: 'conflict', note: `l'amont a changé pour une troisième valeur sur : ${moved.join(', ')}`, upstreamNow };
    return { ...base, state: 'active', note: "l'amont n'a pas bougé, la Correction reste nécessaire", upstreamNow };
  });
}
