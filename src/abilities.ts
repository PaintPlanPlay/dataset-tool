/**
 * Les aptitudes d'une Unit telles que le Dataset les publie : leur nom seul.
 * Ce qu'elles font vient des Contributions, en Modifiers (ADR 0011).
 *
 * 40kdc-data n'est plus qu'une deuxième lecture : quand une Unit y est
 * rattachée par sa référence BSData, l'Effect de chacune de ses aptitudes est
 * noté pour la revue des Effects extraits, jamais publié.
 */
import type { UnitAbility } from '@paintplanplay/dataset-schema';
import type { CatalogueUnit } from './bsdata/types.ts';
import { kdcKey, type KdcData } from './upstream/kdc.ts';

/** Leader et Support disent qui l'Unit peut rejoindre, pas ce qu'elle fait. */
const ATTACH = /^(leader|support)$/i;

/**
 * Les aptitudes d'une Unit. `record` reçoit, par adresse d'aptitude, l'Effect
 * que 40kdc-data lui donne.
 */
export function unitAbilities(u: CatalogueUnit, kdc: KdcData | null, record: (target: string, effect: unknown) => void): UnitAbility[] {
  const linked = kdc?.unitByBsdataId(u.id);
  const factions = linked?.faction_id ? [linked.faction_id] : [];
  const fromKdc = linked ? (linked.ability_ids ?? []).map((id) => kdc!.ability(id, factions)).filter((x) => x !== undefined) : [];
  return u.abilities.map((a) => {
    const match = ATTACH.test(a.name.trim()) ? undefined : fromKdc.find((k) => kdcKey(k.name) === kdcKey(a.name));
    if (match?.effect !== undefined) record(`${u.id}::ability:${a.name}`, match.effect);
    return { name: a.name };
  });
}
