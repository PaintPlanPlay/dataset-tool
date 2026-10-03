/**
 * Les Detachments et Enhancements d'une Army, tels que le MFM les publie.
 *
 * Le MFM décide de ce qui existe et de ses chiffres : Detachments, coût en DP,
 * Force Dispositions, tag Unique, Enhancements et leurs points. Le reste est à
 * nous : les Detachment Rules, les Stratagems et les restrictions
 * d'Enhancement viennent des Contributions.
 */
import type { Detachment, Enhancement } from '@paintplanplay/dataset-schema';
import { assignIds, slugify, type IdRegistry } from './ids.ts';
import { mfmKey, type MfmDetachment, type MfmFaction } from './upstream/mfm.ts';

export interface DetachmentsInput {
  armyId: string;
  mfm?: MfmFaction;
  ids: IdRegistry;
}

/** Force Disposition du MFM (« TAKE AND HOLD ») en identifiant (« take-and-hold »). */
export const dispositionId = (objective: string) => slugify(objective);

/**
 * Clé de rapprochement d'un nom de Detachment ou d'Enhancement : les marques
 * « (Upgrade) » et « (Aura) » tombent. C'est aussi la clé que garde le registre.
 */
export const nameKey = (name: string) => mfmKey(name.replace(/\s*\((?:upgrade|aura)\)/gi, ''));

export function buildDetachments(input: DetachmentsInput): Detachment[] {
  const { armyId, mfm, ids } = input;
  if (!mfm) return [];
  const detIds = assignIds(ids, 'detachments', armyId, mfm.detachments, (d) => ({ keys: [`mfm:${nameKey(d.name)}`], name: d.name }));
  return mfm.detachments
    .map((d): Detachment => {
      const id = detIds.get(d)!;
      return {
        id,
        name: d.name,
        dp: d.dp,
        forceDispositions: d.objectives.map(dispositionId),
        ...(d.unique ? { uniqueTag: d.unique } : {}),
        rules: [],
        enhancements: enhancementsOf(armyId, d, id, ids),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function enhancementsOf(armyId: string, d: MfmDetachment, detId: string, ids: IdRegistry): Enhancement[] {
  const enhIds = assignIds(ids, 'enhancements', `${armyId}/${detId}`, d.enhancements, (e) => ({ keys: [`mfm:${nameKey(e.name)}`], name: e.name }));
  return d.enhancements
    .map((e): Enhancement => ({
      id: enhIds.get(e)!,
      name: e.name,
      points: e.points,
      appliesTo: e.appliesTo,
      aura: e.aura,
      maxTargets: 1,
      requires: [],
      excludes: [],
      ...(e.leaderTo ? { leaderTo: e.leaderTo } : {}),
      ...(e.supportTo ? { supportTo: e.supportTo } : {}),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
