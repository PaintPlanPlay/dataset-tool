/**
 * D'où vient chaque valeur d'une Unit, d'un Detachment ou d'un Stratagem : quelle
 * Upstream Source fait autorité sur le champ, ou quelle Correction l'a changé.
 */
import type { ArmyFile, CoreFile, Detachment, Stratagem, Unit } from '@paintplanplay/dataset-schema';

import { CORE_ROOT, parseTarget } from '../corrections/apply.ts';
import type { ContributionVerdict } from '../authored.ts';
import type { CorrectionVerdict } from '../corrections/lifecycle.ts';
import type { SourceConflict } from '../findings.ts';

export type Origin = 'bsdata' | 'mfm' | '40kdc' | 'analysis' | 'project' | 'correction' | 'published';

/**
 * Ce que l'interface lit : les fichiers du Dataset, et ce qu'on sait d'eux. Une
 * construction les fournit avec les Corrections et les Units absentes du MFM ;
 * un Dataset simplement cloné les fournit seuls.
 */
export interface DatasetView {
  gameSystem: string;
  files: Map<string, unknown>;
  corrections: CorrectionVerdict[];
  unmatched: { id: string }[];
  /** Désaccords entre sources, quand une construction les a relevés. */
  conflicts?: SourceConflict[];
  /** Ce que sont devenues les Contributions à la construction. */
  contributions?: ContributionVerdict[];
  /** Les Effects de 40kdc-data retirés des Armies au format de Rule : la deuxième lecture de la revue. */
  kdcEffects?: Record<string, unknown>;
}

export interface FieldOrigin {
  field: string;
  origin: Origin;
  detail?: string;
}

export interface Inspection {
  kind: 'unit' | 'detachment' | 'stratagem' | 'armyRule' | 'core';
  army: string;
  target: string;
  name: string;
  value: unknown;
  origins: FieldOrigin[];
  corrections: CorrectionVerdict[];
}

/** Champs sur lesquels le Munitorum Field Manual fait autorité. */
const MFM_UNIT_FIELDS = new Set(['points', 'costBrackets', 'pricing', 'wargear', 'leaderTargets', 'supportTargets']);
const MFM_DETACHMENT_FIELDS = new Set(['dp', 'forceDispositions', 'uniqueTag']);

const armiesOf = (out: DatasetView) =>
  [...out.files].filter(([p]) => p.startsWith(`${out.gameSystem}/armies/`)).map(([, f]) => f as ArmyFile);
const coreOf = (out: DatasetView) => out.files.get(`${out.gameSystem}/core.json`) as CoreFile | undefined;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Une Unit dans l'Army qui la possède, à défaut la première qui l'aligne. */
function findUnit(out: DatasetView, unitId: string): { army: ArmyFile; unit: Unit } | undefined {
  const hits = armiesOf(out).flatMap((army) => army.units.filter((u) => u.id === unitId).map((unit) => ({ army, unit })));
  return hits.find((h) => !h.unit.ally) ?? hits[0];
}

function correctionsFor(out: DatasetView, prefix: string): CorrectionVerdict[] {
  return out.corrections.filter((c) => c.target === prefix || c.target.startsWith(`${prefix}::`) || c.target.startsWith(`${prefix}|`));
}

const correctionOrigin = (field: string, verdicts: CorrectionVerdict[]): FieldOrigin => ({
  field,
  origin: 'correction',
  detail: verdicts.map((v) => v.path).join(', ') || 'Correction',
});

/**
 * Sans `bare` — un Dataset cloné, sans instantané —, on ne peut pas dire ce
 * qu'une Correction a changé : chaque champ est rendu « publié ».
 */
export function inspect(current: DatasetView, bare: DatasetView | null, target: string): Inspection | null {
  const { root, entity, name } = parseTarget(target);

  // L'entrée Core : ce qui vaut pour toutes les Armies, Battle Sizes et Stratagems Core.
  if (target === CORE_ROOT) {
    const core = coreOf(current);
    if (!core) return null;
    const verdicts = current.corrections.filter((c) => c.target.startsWith(`${CORE_ROOT}::`));
    const value = { battleSizes: core.battleSizes, stratagems: core.stratagems };
    const origins: FieldOrigin[] = [
      { field: 'battleSizes', origin: bare ? 'project' : 'published' },
      { field: 'stratagems', origin: bare ? '40kdc' : 'published' },
    ];
    return { kind: 'core', army: CORE_ROOT, target: CORE_ROOT, name: 'Core', value, origins, corrections: verdicts };
  }

  if (entity === 'unit' || entity === 'ability' || entity === 'weapon' || entity === 'model' || entity === 'attachment') {
    const found = findUnit(current, root);
    if (!found) return null;
    const upstream = bare ? findUnit(bare, root)?.unit : undefined;
    const verdicts = correctionsFor(current, root);
    const unmatched = current.unmatched.some((u) => u.id === root);
    const origins: FieldOrigin[] = [];
    for (const [field, value] of Object.entries(found.unit)) {
      if (field === 'abilities') continue;
      if (upstream && !same(value, (upstream as unknown as Record<string, unknown>)[field])) origins.push(correctionOrigin(field, verdicts));
      else if (!bare) origins.push({ field, origin: 'published' });
      else if (MFM_UNIT_FIELDS.has(field)) origins.push(unmatched ? { field, origin: 'bsdata', detail: 'missing from the MFM' } : { field, origin: 'mfm' });
      else origins.push({ field, origin: 'bsdata' });
    }
    for (const ability of found.unit.abilities) {
      const before = upstream?.abilities.find((a) => a.name === ability.name);
      const field = `abilities › ${ability.name}`;
      if (upstream && !same(ability, before)) origins.push(correctionOrigin(field, verdicts));
      else if (!bare) origins.push({ field, origin: 'published' });
      // Ce que fait une aptitude est à nous (ses Modifiers, sa Description) ; sans eux, BSData ne donne que son nom.
      else if (ability.modifiers || ability.options || ability.summary) origins.push({ field, origin: 'project' });
      else origins.push({ field, origin: 'bsdata', detail: 'name only' });
    }
    return { kind: 'unit', army: found.army.id, target: root, name: found.unit.name, value: found.unit, origins, corrections: verdicts };
  }

  if (entity === 'detachment' || entity === 'enhancement' || entity === 'rule') {
    const detachmentId = name.split('|')[0];
    const pick = (out: DatasetView): Detachment | undefined => armiesOf(out).find((a) => a.id === root)?.detachments.find((d) => d.id === detachmentId);
    const detachment = pick(current);
    if (!detachment) return null;
    const upstream = bare ? pick(bare) : undefined;
    const key = `${root}::detachment:${detachmentId}`;
    const verdicts = current.corrections.filter((c) => c.target === key || c.target.startsWith(`${root}::enhancement:${detachmentId}|`));
    const origins: FieldOrigin[] = [];
    for (const [field, value] of Object.entries(detachment)) {
      if (field === 'enhancements') continue;
      if (upstream && !same(value, (upstream as unknown as Record<string, unknown>)[field])) origins.push(correctionOrigin(field, verdicts));
      else if (!bare) origins.push({ field, origin: 'published' });
      else origins.push({ field, origin: MFM_DETACHMENT_FIELDS.has(field) ? 'mfm' : field === 'rules' ? '40kdc' : 'bsdata' });
    }
    for (const enh of detachment.enhancements) {
      const before = upstream?.enhancements.find((e) => e.id === enh.id);
      if (upstream && !same(enh.points, before?.points)) origins.push(correctionOrigin(`enhancements › ${enh.name} › points`, verdicts));
      else origins.push({ field: `enhancements › ${enh.name} › points`, origin: bare ? 'mfm' : 'published' });
      if (upstream && !same({ ...enh, points: 0 }, { ...before, points: 0 })) origins.push(correctionOrigin(`enhancements › ${enh.name}`, verdicts));
      else origins.push({ field: `enhancements › ${enh.name}`, origin: bare ? '40kdc' : 'published' });
    }
    return { kind: 'detachment', army: root, target: key, name: detachment.name, value: detachment, origins, corrections: verdicts };
  }

  if (entity === 'armyrule') {
    const pick = (out: DatasetView) => armiesOf(out).find((a) => a.id === root)?.armyRules?.find((r) => r.id === name);
    const rule = pick(current);
    if (!rule) return null;
    const origins = Object.keys(rule).map((field) => ({ field, origin: (bare ? (field === 'name' || field === 'id' ? 'bsdata' : 'project') : 'published') as Origin }));
    return { kind: 'armyRule', army: root, target, name: rule.name, value: rule, origins, corrections: [] };
  }

  if (entity === 'stratagem') {
    const pick = (out: DatasetView): Stratagem | undefined =>
      (root === CORE_ROOT ? coreOf(out)?.stratagems : armiesOf(out).find((a) => a.id === root)?.stratagems)?.find((s) => s.id === name);
    const stratagem = pick(current);
    if (!stratagem) return null;
    const upstream = bare ? pick(bare) : undefined;
    const verdicts = current.corrections.filter((c) => c.target === target);
    const origins = Object.entries(stratagem).map(([field, value]) =>
      upstream && !same(value, (upstream as unknown as Record<string, unknown>)[field])
        ? correctionOrigin(field, verdicts)
        : { field, origin: (bare ? '40kdc' : 'published') as Origin },
    );
    return { kind: 'stratagem', army: root, target, name: stratagem.name, value: stratagem, origins, corrections: verdicts };
  }

  return null;
}

export interface SearchHit {
  kind: Inspection['kind'];
  army: string;
  /** Le nom de l'Army, pour distinguer deux homonymes : « Frimeurs · Orks ». */
  armyName: string;
  name: string;
  target: string;
}

/**
 * Units, Detachments et Stratagems de toutes les Armies, plus l'entrée Core.
 * `army` restreint à une Army ; l'entrée Core et ses Stratagems restent
 * trouvables quel que soit le filtre, puisqu'ils valent pour toutes.
 */
export function search(current: DatasetView, query: string, limit = 60, army = ''): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const push = (h: SearchHit) => {
    if (hits.length >= limit || seen.has(h.target) || !h.name.toLowerCase().includes(q)) return;
    seen.add(h.target);
    hits.push(h);
  };
  for (const a of armiesOf(current)) {
    if (army && a.id !== army) continue;
    const of = { army: a.id, armyName: a.name };
    for (const u of a.units) if (!u.ally) push({ kind: 'unit', ...of, name: u.name, target: u.id });
    for (const d of a.detachments) push({ kind: 'detachment', ...of, name: d.name, target: `${a.id}::detachment:${d.id}` });
    for (const s of a.stratagems) push({ kind: 'stratagem', ...of, name: s.name, target: `${a.id}::stratagem:${s.id}` });
    for (const r of a.armyRules ?? []) push({ kind: 'armyRule', ...of, name: r.name, target: `${a.id}::armyrule:${r.id}` });
  }
  const core = coreOf(current);
  if (core) {
    const of = { army: CORE_ROOT, armyName: 'Core' };
    push({ kind: 'core', ...of, name: 'Core', target: CORE_ROOT });
    for (const s of core.stratagems) push({ kind: 'stratagem', ...of, name: s.name, target: `${CORE_ROOT}::stratagem:${s.id}` });
  }
  return hits;
}
