/**
 * Les compteurs du tableau de bord : par Army, ce qui change avant la prochaine
 * Release, ce qui attend une décision (« à traiter ») et ce qui reste à
 * compléter. Chaque chiffre renvoie à des constats, qu'on liste filtrés.
 */
import type { ArmyFile, DatasetIndex } from '@paintplanplay/dataset-schema';
import { indexPath } from '@paintplanplay/dataset-schema';
import type { BuildOutput } from '../build.ts';
import { STAGES, type ArmyChanges, type Origin, type Stage } from '../changes.ts';
import { CORE_ROOT, parseTarget } from '../corrections/apply.ts';
import { readCorrections } from '../corrections/files.ts';
import { findUnsimulated } from '../rules.ts';
import { sheetOfTarget } from './targets.ts';
import type { Workspace } from './workspace.ts';

/** Ce qui attend une décision. */
export type HandleKind = 'conflict' | 'caughtUp' | 'orphan' | 'contribution' | 'disagreement';
/** Ce qui reste à compléter. */
export type CompleteKind = 'unsimulated' | 'wargear' | 'enhancementWeapon';

export const HANDLE: HandleKind[] = ['conflict', 'caughtUp', 'orphan', 'contribution', 'disagreement'];
export const COMPLETE: CompleteKind[] = ['unsimulated', 'wargear', 'enhancementWeapon'];
const ORIGINS: Origin[] = ['bsdata', 'mfm', 'correction', 'contribution'];

export interface Finding {
  army: string;
  kind: HandleKind | CompleteKind;
  /** Ce qu'il vise, nommé. */
  label: string;
  detail: string;
  /** La fiche où le régler. */
  sheet?: string;
}

export interface Counters {
  changes: number;
  stages: Record<Stage, number>;
  origins: Record<Origin, number>;
  handle: Record<HandleKind, number>;
  complete: Record<CompleteKind, number>;
  /** Tout ce qui est à traiter. */
  todo: number;
}

export interface BoardRow extends Counters {
  id: string;
  name: string;
}

const zero = <K extends string>(keys: K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
const counters = (): Counters => ({ changes: 0, stages: zero(STAGES), origins: zero(ORIGINS), handle: zero(HANDLE), complete: zero(COMPLETE), todo: 0 });

/**
 * Nommer et ranger une adresse de Correction ou de Contribution : son Army (la
 * racine, ou l'Army qui possède l'Unit) et « Unit › élément ».
 */
export function targets(ws: Workspace) {
  const names = new Map<string, string>([[CORE_ROOT, 'Core']]);
  const owners = new Map<string, string>();
  const entities = new Map<string, string>();
  for (const [path, file] of ws.current?.files ?? []) {
    if (!path.startsWith(`${ws.gameSystem}/armies/`)) continue;
    const a = file as ArmyFile;
    names.set(a.id, a.name);
    for (const u of a.units) {
      entities.set(u.id, u.name);
      if (!u.ally || !owners.has(u.id)) owners.set(u.id, a.id);
    }
    for (const d of a.detachments) entities.set(`${a.id}::detachment:${d.id}`, d.name);
    for (const x of a.stratagems) entities.set(`${a.id}::stratagem:${x.id}`, x.name);
    for (const r of a.armyRules ?? []) entities.set(`${a.id}::armyrule:${r.id}`, r.name);
  }
  return {
    armyName: (id: string) => names.get(id) ?? id,
    armyOf(target: string): string {
      const { root } = parseTarget(target);
      return names.has(root) ? root : (owners.get(root) ?? '');
    },
    label(target: string): string {
      const sheet = sheetOfTarget(target);
      const element = sheet === target ? '' : (parseTarget(target).name.split('|').pop() ?? '');
      return [entities.get(sheet) ?? sheet, element].filter(Boolean).join(' › ');
    },
  };
}

/** Tous les constats de la construction courante, chacun sous son Army. */
export function findingsOf(ws: Workspace): Finding[] {
  const out = ws.current as (Partial<BuildOutput> & NonNullable<Workspace['current']>) | null;
  if (!out) return [];
  const t = targets(ws);
  // corrections/<gameSystem>/<army>/<fichier>.json : l'Army d'une Correction est son dossier.
  const folder = (path: string) => path.split('/')[2] ?? '';
  const files = readCorrections(ws.datasetDir, ws.gameSystem);
  const found: Finding[] = [];

  for (const v of out.corrections) {
    if (v.state === 'active') continue;
    found.push({ army: folder(v.path), kind: v.state === 'stale' ? 'caughtUp' : 'conflict', label: t.label(v.target), detail: v.note, sheet: sheetOfTarget(v.target) });
  }
  for (const o of out.orphans ?? []) {
    const file = files.find((c) => c.target === o.target);
    found.push({ army: file ? folder(file.path) : t.armyOf(o.target), kind: 'orphan', label: o.target, detail: `${o.why}${file ? ` — ${file.path}` : ''}` });
  }
  for (const c of out.contributions ?? [])
    if (c.state !== 'active') found.push({ army: t.armyOf(c.target), kind: 'contribution', label: t.label(c.target), detail: `${c.state}: ${c.note}`, sheet: sheetOfTarget(c.target) });
  for (const c of out.conflicts ?? [])
    found.push({
      army: c.army,
      kind: 'disagreement',
      label: `${c.name} · ${c.field}`,
      detail: `${c.authority} ${c.kept} kept, ${c.other.source} ${c.other.value} set aside`,
      sheet: c.entity === 'unit' ? c.id : `${c.army}::${c.entity}:${c.id}`,
    });
  for (const u of out.unsimulated ?? findUnsimulated(out.files))
    found.push({ army: t.armyOf(u.target), kind: 'unsimulated', label: `${u.rule} · ${t.label(u.target)}`, detail: u.key, sheet: sheetOfTarget(u.target) });
  for (const w of out.wargear ?? []) found.push({ army: w.army, kind: 'wargear', label: `${w.unit} › ${w.item}`, detail: w.kind, sheet: w.unitId });
  for (const e of out.enhancementWeapons ?? [])
    found.push({ army: e.armies[0] ?? '', kind: 'enhancementWeapon', label: `${e.enhancement} › ${e.weapon}`, detail: e.kind === 'collision' ? `carried by ${e.unit}` : e.kind });
  return found;
}

/** Les lignes du tableau de bord : une par Army qui change ou a quelque chose à traiter, la plus chargée en tête. */
export function boardOf(ws: Workspace, armies: ArmyChanges[], findings: Finding[]): { board: BoardRow[]; totals: Counters } {
  const t = targets(ws);
  const index = ws.current?.files.get(indexPath(ws.gameSystem)) as DatasetIndex | undefined;
  const rows = new Map<string, BoardRow>();
  const row = (id: string, name = t.armyName(id)) => rows.get(id) ?? rows.set(id, { id, name: name || 'Other', ...counters() }).get(id)!;
  for (const a of armies)
    for (const e of a.entities)
      for (const c of e.changes) {
        const r = row(a.id, a.name);
        r.changes++;
        if (c.stage) r.stages[c.stage]++;
        if (c.origin) r.origins[c.origin]++;
      }
  for (const f of findings) {
    const r = row(f.army, f.army ? (index?.armies.find((a) => a.id === f.army)?.name ?? t.armyName(f.army)) : 'Other');
    if ((HANDLE as string[]).includes(f.kind)) {
      r.handle[f.kind as HandleKind]++;
      r.todo++;
    } else r.complete[f.kind as CompleteKind]++;
  }
  const board = [...rows.values()].sort((a, b) => b.todo - a.todo || b.changes - a.changes || a.name.localeCompare(b.name));
  const totals = counters();
  for (const r of board) {
    totals.changes += r.changes;
    totals.todo += r.todo;
    for (const k of STAGES) totals.stages[k] += r.stages[k];
    for (const k of ORIGINS) totals.origins[k] += r.origins[k];
    for (const k of HANDLE) totals.handle[k] += r.handle[k];
    for (const k of COMPLETE) totals.complete[k] += r.complete[k];
  }
  return { board, totals };
}
