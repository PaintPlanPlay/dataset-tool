/**
 * Munitorum Field Manual, tel que suivi par `BSData/wh40k-11e-mfm`.
 *
 * Le MFM fait autorité sur tout ce qu'il publie : points par tranche
 * d'effectif et seuils de réquisition, équipement payant, rattachements
 * Leader/Support, coûts en DP, Force Dispositions et points d'Enhancement.
 * BSData garde les profils, armes, options et mots-clés.
 *
 * On joint sur le nom normalisé. BSData suffixe « [Legends] », le MFM le marque
 * dans un champ : les deux se rejoignent une fois le suffixe retiré.
 */
import type { CatalogueUnit } from '../bsdata/types.ts';

/** Une plage de « combien d'exemplaires de cette unité j'ai déjà ». */
export interface MfmPricing {
  /** Rang du premier exemplaire concerné, à partir de 1. */
  from: number;
  /** Dernier rang concerné, null si la plage est ouverte (« 3e et suivantes »). */
  to: number | null;
  costs: { models: number; points: number; desc?: string; addon?: boolean }[];
}

export interface MfmUnit {
  name: string;
  pricing: MfmPricing[];
  /** Units que celle-ci peut mener ; absent quand le MFM n'en liste aucune. */
  leaderTo?: string[];
  /** Units qu'elle peut rejoindre en soutien. */
  supportTo?: string[];
  wargear?: { item: string; points: number }[];
  legends?: boolean;
}

export interface MfmEnhancement {
  name: string;
  points: number;
  /** Une upgrade se pose sur une unité, une optimisation sur un personnage. */
  appliesTo: 'character' | 'unit';
  aura: boolean;
  /** Units dont cette Enhancement ouvre l'aptitude Leader. */
  leaderTo?: string[];
  supportTo?: string[];
}

export interface MfmDetachment {
  name: string;
  /** Coût en points de détachement, null quand le MFM ne le donne pas. */
  dp: number | null;
  /** Force Dispositions accordées, telles qu'écrites (« TAKE AND HOLD »). */
  objectives: string[];
  /** Deux détachements portant le même tag sont exclusifs. */
  unique?: string;
  enhancements: MfmEnhancement[];
}

export interface MfmFaction {
  name: string;
  slug: string;
  version: string;
  /** Armée parente pour une sous-faction (« Space Marines » pour les Black Templars). */
  parent?: string;
  detachments: MfmDetachment[];
  units: MfmUnit[];
}

export interface MfmMeta {
  version: string;
  lastUpdated: string;
}

type Names = string[] | undefined;

/** Forme brute d'un fichier YAML du dépôt, avant normalisation. */
export interface RawFaction {
  name: string;
  slug: string;
  version: string;
  parent?: string;
  detachments?: {
    name: string;
    dp: number | null;
    objectives?: string[];
    unique?: string;
    enhancements?: { name: string; points: number; leaderTo?: Names; supportTo?: Names }[];
  }[];
  units?: {
    name: string;
    pricing?: { range: string; label?: string; costs?: { models: number; points: number; desc?: string; addon?: boolean }[] }[];
    leaderTo?: Names;
    supportTo?: Names;
    /** Ancienne écriture (MFM < 1.4) : un seul rôle et une seule liste. */
    role?: string;
    attachTo?: Names;
    wargear?: { item: string; points: number }[];
    legends?: boolean;
  }[];
}

/** « [1,3] » → 1..3, « [4,) » → 4..∞. */
function parseRange(range: string): { from: number; to: number | null } {
  const m = /^\[(\d+),(\d*)[\])]$/.exec(range.trim());
  if (!m) return { from: 1, to: null };
  return { from: Number(m[1]), to: m[2] === '' ? null : Number(m[2]) };
}

/**
 * Le MFM marque la nature d'une optimisation dans son nom : « Dead Shiny Shootas
 * (Upgrade) », « Cruel Lashmaster (Aura) ». Les deux marques se cumulent.
 */
function readEnhancement(raw: { name: string; points: number; leaderTo?: Names; supportTo?: Names }): MfmEnhancement {
  const upgrade = /\(upgrade\)/i.test(raw.name);
  const aura = /\(aura\)/i.test(raw.name);
  return {
    name: raw.name.replace(/\s*\((?:upgrade|aura)\)/gi, '').trim(),
    points: raw.points,
    appliesTo: upgrade ? 'unit' : 'character',
    aura,
    ...(raw.leaderTo?.length ? { leaderTo: raw.leaderTo } : {}),
    ...(raw.supportTo?.length ? { supportTo: raw.supportTo } : {}),
  };
}

export function readFaction(raw: RawFaction): MfmFaction {
  return {
    name: raw.name,
    slug: raw.slug,
    version: String(raw.version),
    ...(raw.parent ? { parent: raw.parent } : {}),
    detachments: (raw.detachments ?? []).map((d) => ({
      name: d.name,
      dp: typeof d.dp === 'number' ? d.dp : null,
      objectives: d.objectives ?? [],
      ...(d.unique ? { unique: d.unique } : {}),
      enhancements: (d.enhancements ?? []).map(readEnhancement),
    })),
    units: (raw.units ?? []).map((u) => {
      // MFM 1.4 a remplacé « role + attachTo » par deux listes : un personnage peut être les deux.
      const leaderTo = u.leaderTo ?? (u.role === 'leader' ? u.attachTo : undefined);
      const supportTo = u.supportTo ?? (u.role === 'support' ? u.attachTo : undefined);
      return {
        name: u.name,
        pricing: (u.pricing ?? []).map((p) => ({ ...parseRange(p.range), costs: p.costs ?? [] })),
        ...(leaderTo?.length ? { leaderTo } : {}),
        ...(supportTo?.length ? { supportTo } : {}),
        ...(u.wargear?.length ? { wargear: u.wargear } : {}),
        ...(u.legends ? { legends: true } : {}),
      };
    }),
  };
}

/**
 * Clé de rapprochement. BSData écrit « Big Mek with Shokk Attack Gun » et
 * « … [Legends] », le MFM « Big Mek With Shokk Attack Gun » avec une apostrophe
 * typographique : on retire tout ce qui n'est pas lettre ou chiffre.
 */
export const mfmKey = (name: string) =>
  name
    .replace(/\[[^\]]*\]/g, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '');

/** Un désaccord entre le MFM et BSData, tranché en faveur du MFM. */
export interface MfmConflict {
  unitId: string;
  unit: string;
  field: 'points' | 'leaderTargets' | 'supportTargets';
  /** Valeur retenue, celle du MFM. */
  mfm: string;
  /** Valeur écartée, celle de BSData. */
  bsdata: string;
}

export interface MergeReport {
  matched: number;
  /** Units absentes du MFM : leur coût BSData est gardé, faute de mieux. */
  unmatched: { id: string; name: string }[];
  conflicts: MfmConflict[];
}

const sameNames = (a: string[], b: string[]) =>
  a.map(mfmKey).sort().join('|') === b.map(mfmKey).sort().join('|');

/**
 * Applique le MFM sur des datasheets issues de BSData.
 *
 * `factions` est lu dans l'ordre : la faction de l'Army d'abord, pour qu'une
 * Unit partagée prenne le prix de son propre codex quand deux factions la
 * listent sous le même nom.
 */
export function applyMfm(units: CatalogueUnit[], factions: MfmFaction[]): { units: CatalogueUnit[]; report: MergeReport } {
  const index = new Map<string, MfmUnit>();
  for (const f of factions) for (const u of f.units) if (!index.has(mfmKey(u.name))) index.set(mfmKey(u.name), u);

  const report: MergeReport = { matched: 0, unmatched: [], conflicts: [] };

  const out = units.map((unit) => {
    const m = index.get(mfmKey(unit.name));
    if (!m || m.pricing.length === 0) {
      report.unmatched.push({ id: unit.id, name: unit.name });
      return unit;
    }
    report.matched++;

    // La première plage est le tarif normal ; les suivantes sont les seuils.
    const base = m.pricing[0];
    const cheapest = base.costs[0];
    const next: CatalogueUnit = { ...unit, pricing: m.pricing };

    if (cheapest && cheapest.points !== unit.points) {
      report.conflicts.push({ unitId: unit.id, unit: unit.name, field: 'points', mfm: String(cheapest.points), bsdata: String(unit.points) });
      next.points = cheapest.points;
    }
    // Les paliers de taille du MFM remplacent ceux devinés dans les modificateurs.
    next.costBrackets = base.costs.slice(1).map((c, i) => ({ overModels: base.costs[i].models, points: c.points }));

    if (m.wargear?.length) next.wargear = m.wargear;

    // Le MFM liste les rattachements de chaque Unit qui en a : son silence dit « aucun ».
    const leader = m.leaderTo ?? [];
    const support = m.supportTo ?? [];
    for (const [field, mfm, bs] of [
      ['leaderTargets', leader, unit.leaderTargets],
      ['supportTargets', support, unit.supportTargets],
    ] as const) {
      if (!sameNames(mfm, bs))
        report.conflicts.push({ unitId: unit.id, unit: unit.name, field, mfm: mfm.join(', ') || '—', bsdata: bs.join(', ') || '—' });
    }
    next.leaderTargets = [...leader];
    next.supportTargets = [...support];
    next.isAttachable = leader.length + support.length > 0;

    return next;
  });

  return { units: out, report };
}
