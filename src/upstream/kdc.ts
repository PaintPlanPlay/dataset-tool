/**
 * 40kdc-data, telle que l'instantané la garde.
 *
 * 40kdc-data fait autorité sur les Detachment Rules, les restrictions
 * d'Enhancement, les Stratagems et les Effects. Ses Effects sont repris tels
 * quels : leur format est adopté à une version figée (voir le paquet de
 * schéma), aucune traduction n'est maintenue.
 *
 *   40kdc/core/<faction>/{factions,detachments,enhancements,stratagems,units}.json
 *   40kdc/core/stratagems.json          Stratagems Core
 *   40kdc/enrichment/<faction>/abilities.json
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mfmKey } from './mfm.ts';

export interface KdcFaction {
  id: string;
  name: string;
  parent_faction_id?: string | null;
}

export interface KdcDetachment {
  id: string;
  name: string;
  faction_id: string;
  detachment_rule_id?: string | null;
  detachment_rule_ids?: string[];
  detachment_points?: number | null;
  force_dispositions?: string[];
  tags?: string[];
}

export interface KdcEnhancement {
  id: string;
  name: string;
  detachment_id: string;
  cost: number;
  keyword_restrictions?: string[];
  keyword_restriction_groups?: string[][];
  exclusion_keywords?: string[] | null;
  ability_id?: string | null;
  upgrade_tag?: boolean;
  max_targets?: number;
}

export interface KdcTargetRestrictions {
  required_keywords?: string[];
  required_keywords_any?: string[];
  excluded_keywords?: string[];
  /** Prose : jamais reprise. */
  notes?: string;
}

export interface KdcStratagem {
  id: string;
  name: string;
  category: 'core' | 'detachment';
  type?: 'battle-tactic' | 'strategic-ploy' | 'epic-deed' | 'wargear';
  detachment_id?: string | null;
  cp_cost: number;
  phases: string[];
  player_turn: string;
  timing: string;
  target_restrictions?: KdcTargetRestrictions | null;
  ability_id?: string | null;
}

export interface KdcAbility {
  ability_id: string;
  name: string;
  faction_id?: string | null;
  ability_type?: string;
  effect?: unknown;
  scope?: unknown;
  unit_ids?: string[];
  /** Filtre de mots-clés des Units que l'aptitude concerne, tenu à la main par 40kdc-data. */
  applies_to?: { required_keywords?: string[]; excluded_keywords?: string[] } | null;
}

/** Une datasheet de 40kdc-data : ce qui sert à la rattacher à BSData et à trouver ses aptitudes. */
export interface KdcUnit {
  id: string;
  name: string;
  faction_id?: string;
  ability_ids?: string[];
  external_refs?: { namespace: string; id: string }[];
}

export interface KdcData {
  factions: KdcFaction[];
  detachments(factionId: string): KdcDetachment[];
  enhancements(factionId: string): KdcEnhancement[];
  stratagems(factionId: string): KdcStratagem[];
  coreStratagems(): KdcStratagem[];
  /** La datasheet 40kdc-data rattachée à une Unit BSData par sa référence `bsdata`. */
  unitByBsdataId(id: string): KdcUnit | undefined;
  /** Une aptitude, cherchée dans les factions données, puis dans le pool commun, puis partout. */
  ability(id: string, factionIds: string[]): KdcAbility | undefined;
}

/** Clé de rapprochement d'un nom 40kdc-data avec le MFM : les marques « (Upgrade) » tombent. */
export const kdcKey = (name: string) => mfmKey(name.replace(/\s*\((?:upgrade|aura)\)/gi, ''));

const readJson = <T>(path: string, fallback: T): T => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback);

export function readKdc(dir: string): KdcData | null {
  const core = join(dir, 'core');
  if (!existsSync(core)) return null;
  const factionDirs = readdirSync(core, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_'))
    .map((e) => e.name)
    .sort();
  const factions = factionDirs.flatMap((d) => readJson<KdcFaction[]>(join(core, d, 'factions.json'), []));

  const cache = new Map<string, unknown[]>();
  const perFaction = <T>(factionId: string, file: string): T[] => {
    const key = `${factionId}/${file}`;
    if (!cache.has(key)) cache.set(key, readJson<unknown[]>(join(core, factionId, file), []));
    return cache.get(key) as T[];
  };

  let byBsdata: Map<string, KdcUnit> | undefined;

  const enrichment = join(dir, 'enrichment');
  const abilityDirs = existsSync(enrichment)
    ? readdirSync(enrichment, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()
    : [];
  const abilities = new Map<string, Map<string, KdcAbility>>();
  const abilitiesOf = (d: string) => {
    if (!abilities.has(d))
      abilities.set(d, new Map(readJson<KdcAbility[]>(join(enrichment, d, 'abilities.json'), []).map((a) => [a.ability_id, a])));
    return abilities.get(d)!;
  };

  return {
    factions,
    detachments: (factionId) => perFaction<KdcDetachment>(factionId, 'detachments.json'),
    enhancements: (factionId) => perFaction<KdcEnhancement>(factionId, 'enhancements.json'),
    stratagems: (factionId) => perFaction<KdcStratagem>(factionId, 'stratagems.json'),
    coreStratagems: () => readJson<KdcStratagem[]>(join(core, 'stratagems.json'), []),
    unitByBsdataId(id) {
      byBsdata ??= new Map(
        factionDirs.flatMap((d) =>
          perFaction<KdcUnit>(d, 'units.json').flatMap((u) =>
            (u.external_refs ?? []).filter((r) => r.namespace === 'bsdata').map((r) => [r.id, u] as const),
          ),
        ),
      );
      return byBsdata.get(id);
    },
    ability(id, factionIds) {
      for (const d of [...factionIds, '_core']) {
        const hit = abilityDirs.includes(d) ? abilitiesOf(d).get(id) : undefined;
        if (hit) return hit;
      }
      for (const d of abilityDirs) {
        const hit = abilitiesOf(d).get(id);
        if (hit) return hit;
      }
      return undefined;
    },
  };
}

/** Noms sous lesquels 40kdc-data désigne une Army quand ils diffèrent du libellé BSData. */
const KDC_ALIASES: Record<string, string[]> = {
  'adeptus-astartes': ['Space Marines'],
  aeldari: ['Craftworlds'],
};

/**
 * La faction 40kdc-data d'une Army, d'après ses noms connus — son libellé
 * BSData d'abord, puis le nom de sa faction MFM.
 */
export function kdcFactionFor(names: (string | undefined)[], factions: KdcFaction[]): KdcFaction | undefined {
  for (const name of names) {
    if (!name) continue;
    const key = mfmKey(name);
    const hit =
      factions.find((f) => mfmKey(f.name) === key) ??
      factions.find((f) => (KDC_ALIASES[f.id] ?? []).some((alias) => mfmKey(alias) === key));
    if (hit) return hit;
  }
  return undefined;
}
