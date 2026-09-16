/**
 * Le rapport de dérive : ce qu'une construction change au Dataset publié, et
 * ce qui mérite qu'on s'y arrête avant de fusionner.
 *
 * Il se lit seul, dans la description d'une PR : les chiffres qui bougent
 * d'abord — c'est ce qui se joue en tournoi —, puis les désaccords entre
 * sources et l'état des Corrections, et le bruit en dernier.
 */
import type { ArmyFile, DatasetIndex, Unit } from '@paintplanplay/dataset-schema';
import type { BuildOutput, DroppedEffect, MissingEntity, SourceConflict } from './build.ts';
import { STATE_LABEL, type CorrectionVerdict } from './corrections/lifecycle.ts';

export interface UnitChange {
  army: string;
  id: string;
  name: string;
  field: string;
  before: string;
  after: string;
}

export interface DatasetDiff {
  /** Aucun Dataset précédent : rien à comparer. */
  initial: boolean;
  armiesAdded: string[];
  armiesRemoved: string[];
  unitsAdded: { army: string; id: string; name: string }[];
  unitsRemoved: { army: string; id: string; name: string }[];
  changes: UnitChange[];
}

export interface DriftReport {
  diff: DatasetDiff;
  conflicts: SourceConflict[];
  corrections: CorrectionVerdict[];
  orphans: { target: string; why: string }[];
  unmatched: BuildOutput['unmatched'];
  missing: MissingEntity[];
  droppedEffects: DroppedEffect[];
  sources: DatasetIndex['sources'];
  previousSources: DatasetIndex['sources'];
}

const armiesOf = (files: Map<string, unknown>) =>
  new Map([...files].filter(([p]) => p.split('/')[1] === 'armies').map(([, f]) => [(f as ArmyFile).id, f as ArmyFile]));

/** Les champs comparés, et comment les rendre lisibles. */
const FIELDS: { label: string; show: (u: Unit) => string }[] = [
  { label: 'points', show: (u) => String(u.points) },
  { label: 'tarif MFM', show: (u) => JSON.stringify(u.pricing ?? []) },
  { label: 'équipement payant', show: (u) => JSON.stringify(u.wargear ?? []) },
  { label: 'effectif', show: (u) => `${u.minModels}-${u.maxModels}` },
  { label: 'profils', show: (u) => JSON.stringify(u.models) },
  { label: 'mots-clés', show: (u) => u.keywords.join(', ') },
  { label: 'unités menées', show: (u) => u.leaderTargets.join(', ') || '—' },
  { label: 'unités soutenues', show: (u) => u.supportTargets.join(', ') || '—' },
  { label: 'aptitudes', show: (u) => u.abilities.map((a) => a.name).join(', ') },
];

const weaponSignature = (w: Unit['weapons'][number]) =>
  `${w.range} A${w.A} ${w.kind === 'melee' ? 'WS' : 'BS'}${w.skill} S${w.S} AP${w.AP} D${w.D} [${w.keywords.join('/')}]`;

/**
 * Compare deux Datasets. Une Unit alliée figure dans plusieurs Armies : seules
 * les Units propres à une Army sont comparées, pour qu'un changement ne se lise
 * qu'une fois.
 */
export function diffDatasets(previous: Map<string, unknown> | undefined, next: Map<string, unknown>): DatasetDiff {
  const d: DatasetDiff = { initial: !previous || previous.size === 0, armiesAdded: [], armiesRemoved: [], unitsAdded: [], unitsRemoved: [], changes: [] };
  if (d.initial) return d;
  const before = armiesOf(previous!);
  const after = armiesOf(next);

  for (const id of after.keys()) if (!before.has(id)) d.armiesAdded.push(id);
  for (const id of before.keys()) if (!after.has(id)) d.armiesRemoved.push(id);

  for (const [armyId, army] of after) {
    const was = before.get(armyId);
    if (!was) continue;
    const own = (a: ArmyFile) => new Map(a.units.filter((u) => !u.ally).map((u) => [u.id, u]));
    const prevUnits = own(was);
    const nextUnits = own(army);
    for (const [id, u] of nextUnits) {
      const p = prevUnits.get(id);
      if (!p) {
        d.unitsAdded.push({ army: armyId, id, name: u.name });
        continue;
      }
      for (const f of FIELDS) {
        const b = f.show(p);
        const a = f.show(u);
        if (a !== b) d.changes.push({ army: armyId, id, name: u.name, field: f.label, before: b, after: a });
      }
      const pw = new Map(p.weapons.map((w) => [`${w.kind}|${w.name}`, w]));
      const nw = new Map(u.weapons.map((w) => [`${w.kind}|${w.name}`, w]));
      for (const [k, w] of pw) {
        const now = nw.get(k);
        if (!now) d.changes.push({ army: armyId, id, name: u.name, field: `arme retirée « ${w.name} »`, before: weaponSignature(w), after: '—' });
        else if (weaponSignature(now) !== weaponSignature(w))
          d.changes.push({ army: armyId, id, name: u.name, field: `arme « ${w.name} »`, before: weaponSignature(w), after: weaponSignature(now) });
      }
      for (const [k, w] of nw)
        if (!pw.has(k)) d.changes.push({ army: armyId, id, name: u.name, field: `arme ajoutée « ${w.name} »`, before: '—', after: weaponSignature(w) });
    }
    for (const [id, u] of prevUnits) if (!nextUnits.has(id)) d.unitsRemoved.push({ army: armyId, id, name: u.name });

    // Les Detachments : leur coût, leurs dispositions, les points de leurs Enhancements.
    const prevDets = new Map((was.detachments ?? []).map((x) => [x.id, x]));
    for (const det of army.detachments ?? []) {
      const p = prevDets.get(det.id);
      const label = `Detachment « ${det.name} »`;
      if (!p) {
        d.changes.push({ army: armyId, id: det.id, name: label, field: 'ajouté', before: '—', after: `${det.dp ?? '?'} DP` });
        continue;
      }
      if (p.dp !== det.dp) d.changes.push({ army: armyId, id: det.id, name: label, field: 'DP', before: String(p.dp), after: String(det.dp) });
      if (p.forceDispositions.join() !== det.forceDispositions.join())
        d.changes.push({ army: armyId, id: det.id, name: label, field: 'Force Dispositions', before: p.forceDispositions.join(', '), after: det.forceDispositions.join(', ') });
      const prevEnh = new Map(p.enhancements.map((e) => [e.id, e]));
      for (const e of det.enhancements) {
        const pe = prevEnh.get(e.id);
        if (pe && pe.points !== e.points) d.changes.push({ army: armyId, id: e.id, name: `${label} › ${e.name}`, field: 'points', before: String(pe.points), after: String(e.points) });
      }
    }
    for (const p of was.detachments ?? [])
      if (!(army.detachments ?? []).some((x) => x.id === p.id))
        d.changes.push({ army: armyId, id: p.id, name: `Detachment « ${p.name} »`, field: 'retiré', before: `${p.dp ?? '?'} DP`, after: '—' });
  }
  return d;
}

export function makeReport(out: BuildOutput, previous: Map<string, unknown> | undefined): DriftReport {
  const index = out.files.get(`${out.gameSystem}/index.json`) as DatasetIndex;
  const previousIndex = previous?.get(`${out.gameSystem}/index.json`) as DatasetIndex | undefined;
  return {
    diff: diffDatasets(previous, out.files),
    conflicts: out.conflicts,
    corrections: out.corrections,
    orphans: out.orphans,
    unmatched: out.unmatched,
    missing: out.missing,
    droppedEffects: out.droppedEffects,
    sources: index.sources,
    previousSources: previousIndex?.sources ?? [],
  };
}

function bounded<T>(items: T[], max: number, render: (item: T) => string): string[] {
  const lines = items.slice(0, max).map(render);
  if (items.length > max) lines.push(`- …et ${items.length - max} de plus.`);
  return lines;
}

const short = (sha: string) => sha.slice(0, 7);

export function renderReport(r: DriftReport): string {
  const L: string[] = [];
  const { diff: d } = r;

  L.push('# Rapport de dérive', '');
  L.push('| Source | Avant | Après |', '|---|---|---|');
  for (const s of r.sources) {
    const was = r.previousSources.find((p) => p.id === s.id);
    const label = (x?: { commit: string; version?: string }) => (x ? `\`${short(x.commit)}\`${x.version ? ` (${x.version})` : ''}` : '—');
    L.push(`| ${s.id} | ${label(was)} | ${label(s)} |`);
  }
  L.push('');

  const stale = r.corrections.filter((c) => c.state === 'stale');
  const conflicting = r.corrections.filter((c) => c.state === 'conflict');
  L.push(
    d.initial
      ? '**Première construction** : rien à comparer.'
      : `**${d.changes.length}** chiffre(s) modifié(s) · **${d.unitsAdded.length}** Unit(s) ajoutée(s) · **${d.unitsRemoved.length}** retirée(s) · ` +
          `**${r.conflicts.length}** désaccord(s) entre sources · Corrections : ${r.corrections.length - stale.length - conflicting.length} active(s), ` +
          `${stale.length} périmée(s), ${conflicting.length} en conflit`,
    '',
  );

  if (d.changes.length) {
    L.push(`## Chiffres modifiés (${d.changes.length})`, '');
    L.push(...bounded(d.changes, 60, (c) => `- **${c.name}** · ${c.army} — ${c.field} : \`${c.before}\` → \`${c.after}\``), '');
  }
  if (d.unitsRemoved.length) L.push(`## Units retirées (${d.unitsRemoved.length})`, '', ...bounded(d.unitsRemoved, 40, (u) => `- ${u.name} · ${u.army}`), '');
  if (d.armiesRemoved.length) L.push(`## Armies disparues (${d.armiesRemoved.length})`, '', ...d.armiesRemoved.map((a) => `- ${a}`), '');
  if (d.armiesAdded.length) L.push(`## Armies ajoutées (${d.armiesAdded.length})`, '', ...d.armiesAdded.map((a) => `- ${a}`), '');
  if (d.unitsAdded.length) L.push(`## Units ajoutées (${d.unitsAdded.length})`, '', ...bounded(d.unitsAdded, 40, (u) => `- ${u.name} · ${u.army}`), '');

  if (r.conflicts.length) {
    L.push(`## Désaccords entre sources (${r.conflicts.length})`, '');
    L.push('La source qui fait autorité l\'emporte ; la valeur écartée est rappelée pour relecture.', '');
    L.push(
      ...bounded(
        r.conflicts,
        80,
        (c) => `- **${c.name}** · ${c.army} — ${c.field} : ${c.authority} \`${c.kept}\` retenu, ${c.other.source} \`${c.other.value}\` écarté`,
      ),
      '',
    );
  }

  if (r.corrections.length || r.orphans.length) {
    L.push(`## Corrections (${r.corrections.length})`, '');
    const order = { conflict: 0, stale: 1, active: 2 };
    for (const c of [...r.corrections].sort((a, b) => order[a.state] - order[b.state] || a.path.localeCompare(b.path)))
      L.push(`- **${STATE_LABEL[c.state]}** — \`${c.path}\` : ${c.note}${c.upstreamPr ? ` · PR amont : ${c.upstreamPr}` : ''}`);
    for (const o of r.orphans) L.push(`- **orpheline** — \`${o.target}\` : ${o.why}`);
    L.push('');
  }

  if (r.missing.length) {
    L.push(`## Éléments absents d'une source (${r.missing.length})`, '');
    L.push('Le MFM décide de ce qui existe ; ce que 40kdc-data seule publie n\'entre pas dans le Dataset.', '');
    L.push(...bounded(r.missing, 60, (m) => `- ${m.entity} **${m.name}** · ${m.army} — absent de ${m.missingIn}, ${m.published ? 'publié' : 'écarté'}`), '');
  }

  if (r.droppedEffects.length) {
    L.push(`## Effects écartés (${r.droppedEffects.length})`, '');
    L.push(...bounded(r.droppedEffects, 40, (e) => `- ${e.where} · ${e.army} — ${e.reason}`), '');
  }

  if (r.unmatched.length) {
    L.push(`## Units absentes du MFM (${r.unmatched.length})`, '');
    L.push('Leur coût vient de BSData. Le plus souvent des Units Legends ou Crucible.', '');
    L.push(...bounded(r.unmatched, 30, (u) => `- ${u.name} · ${u.army}`), '');
  }

  return L.join('\n');
}
