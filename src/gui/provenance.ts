/**
 * D'où vient chaque valeur d'une Unit, d'un Detachment ou d'un Stratagem : quelle
 * Upstream Source fait autorité sur le champ, ou quelle Correction l'a changé.
 */
import type { ArmyFile, CoreFile, Detachment, Stratagem, Unit } from '@paintplanplay/dataset-schema';

import { CORE_ROOT, parseTarget } from '../corrections/apply.ts';
import type { CorrectionVerdict } from '../corrections/lifecycle.ts';

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
}

export interface FieldOrigin {
  field: string;
  origin: Origin;
  detail?: string;
}

export interface Proposal {
  ability: string;
  target: string;
  effect: unknown;
}

export interface Inspection {
  kind: 'unit' | 'detachment' | 'stratagem';
  army: string;
  target: string;
  name: string;
  value: unknown;
  origins: FieldOrigin[];
  corrections: CorrectionVerdict[];
  proposals: Proposal[];
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
      else if (MFM_UNIT_FIELDS.has(field)) origins.push(unmatched ? { field, origin: 'bsdata', detail: 'absente du MFM' } : { field, origin: 'mfm' });
      else origins.push({ field, origin: 'bsdata' });
    }
    for (const ability of found.unit.abilities) {
      const before = upstream?.abilities.find((a) => a.name === ability.name);
      const field = `abilities › ${ability.name}`;
      if (upstream && !same(ability, before)) origins.push(correctionOrigin(field, verdicts));
      else if (!bare && !ability.effectSource) origins.push({ field, origin: 'published' });
      else origins.push({ field, origin: ability.effectSource ?? 'bsdata', ...(ability.effectSource ? {} : { detail: 'nom seul' }) });
    }
    const proposals = found.unit.abilities
      .filter((a) => a.effectSource === 'analysis' && a.effect)
      .map((a) => ({ ability: a.name, target: `${root}::ability:${a.name}`, effect: a.effect }));
    return { kind: 'unit', army: found.army.id, target: root, name: found.unit.name, value: found.unit, origins, corrections: verdicts, proposals };
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
    return { kind: 'detachment', army: root, target: key, name: detachment.name, value: detachment, origins, corrections: verdicts, proposals: [] };
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
    return { kind: 'stratagem', army: root, target, name: stratagem.name, value: stratagem, origins, corrections: verdicts, proposals: [] };
  }

  return null;
}

export interface SearchHit {
  kind: Inspection['kind'];
  army: string;
  name: string;
  target: string;
}

export function search(current: DatasetView, query: string, limit = 60): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const push = (h: SearchHit) => {
    if (hits.length >= limit || seen.has(h.target) || !h.name.toLowerCase().includes(q)) return;
    seen.add(h.target);
    hits.push(h);
  };
  for (const army of armiesOf(current)) {
    for (const u of army.units) if (!u.ally) push({ kind: 'unit', army: army.id, name: u.name, target: u.id });
    for (const d of army.detachments) push({ kind: 'detachment', army: army.id, name: d.name, target: `${army.id}::detachment:${d.id}` });
    for (const s of army.stratagems) push({ kind: 'stratagem', army: army.id, name: s.name, target: `${army.id}::stratagem:${s.id}` });
  }
  for (const s of coreOf(current)?.stratagems ?? []) push({ kind: 'stratagem', army: CORE_ROOT, name: s.name, target: `${CORE_ROOT}::stratagem:${s.id}` });
  return hits;
}
