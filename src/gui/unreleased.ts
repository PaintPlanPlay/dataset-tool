/**
 * Les Unreleased Changes : tout ce qui sépare la Dataset Release que lisent les
 * apps — celle que le manifeste désigne, pas le dernier tag — du Dataset que
 * l'interface construit en mémoire. C'est la page d'accueil de l'interface.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexPath, manifestPath, type DatasetIndex, type Manifest, type SourceRef } from '@paintplanplay/dataset-schema';
import { contributionsPath } from '../authored.ts';
import { diffFiles, type ArmyChanges, type FieldChange, type Stage } from '../changes.ts';
import { parseTarget } from '../corrections/apply.ts';
import type { CorrectionVerdict } from '../corrections/lifecycle.ts';
import { sheetOfTarget } from './targets.ts';
import { defaultProbe, type Probe, type PullRequest } from './overview.ts';
import { isRepository } from './pending.ts';
import type { Workspace } from './workspace.ts';

export interface SourceShift {
  id: SourceRef['id'];
  /** Commit et version dans la Release ; `null` quand elle ne nomme pas la source. */
  before: string | null;
  beforeVersion?: string;
  after: string | null;
  afterVersion?: string;
  /** Sur main, quand main diffère des deux : un instantané local plus récent que ce qui est fusionné. */
  merged?: string | null;
  mergedVersion?: string;
}

export interface Unreleased {
  /** Le tag de la Release de référence ; `null` sans Release. */
  release: string | null;
  /** Pourquoi il n'y a rien à comparer, quand c'est le cas. */
  note?: string;
  sources: SourceShift[];
  armies: ArmyChanges[];
  /** La PR ouverte depuis la branche du dossier, d'où viennent les changements « proposés ». */
  pullRequest: PullRequest | null;
}

/**
 * Les fichiers d'un Game System tels qu'un commit les porte. Une seule
 * commande git pour tous : le vrai Dataset en compte des dizaines.
 */
export function readDatasetAt(dir: string, ref: string, gameSystem: string): Map<string, unknown> {
  const git = (args: string[], input?: string) =>
    execFileSync('git', ['-C', dir, ...args], { input, maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'ignore'] });
  const paths = git(['ls-tree', '-r', '--name-only', ref, '--', `${gameSystem}/`])
    .toString('utf8')
    .split('\n')
    .filter((p) => p.endsWith('.json'));
  const out = new Map<string, unknown>();
  if (!paths.length) return out;
  const blob = git(['cat-file', '--batch'], paths.map((p) => `${ref}:${p}`).join('\n') + '\n');
  let at = 0;
  for (const path of paths) {
    const eol = blob.indexOf(0x0a, at);
    const size = Number(blob.subarray(at, eol).toString('utf8').split(' ')[2]);
    out.set(path, JSON.parse(blob.subarray(eol + 1, eol + 1 + size).toString('utf8')));
    at = eol + 1 + size + 1;
  }
  return out;
}

const readManifest = (dir: string): Manifest | null =>
  existsSync(join(dir, manifestPath)) ? (JSON.parse(readFileSync(join(dir, manifestPath), 'utf8')) as Manifest) : null;

const tagExists = (dir: string, tag: string) => {
  try {
    execFileSync('git', ['-C', dir, 'rev-parse', '--quiet', '--verify', `refs/tags/${tag}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const empty = (release: string | null, note: string): Unreleased => ({ release, note, sources: [], armies: [], pullRequest: null });

const revParse = (dir: string, ref: string): string | null => {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', '--quiet', '--verify', `${ref}^{commit}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
};

/**
 * Les états entre la Release et la copie locale : `main` tel que le dépôt
 * publié l'a (sa copie de suivi, à défaut la branche locale), puis la branche
 * du dossier quand elle porte une proposition que main n'a pas.
 */
function stagesOf(dir: string): { stages: [Stage, string][]; proposing: boolean } {
  const main = revParse(dir, 'refs/remotes/origin/main') ?? revParse(dir, 'refs/heads/main');
  const head = revParse(dir, 'HEAD');
  const stages: [Stage, string][] = main ? [['merged', main]] : [];
  let proposing = false;
  if (head && head !== main) {
    try {
      execFileSync('git', ['-C', dir, 'merge-base', '--is-ancestor', head, main ?? head], { stdio: 'ignore' });
    } catch {
      proposing = true;
      stages.push(['proposed', head]);
    }
  }
  return { stages, proposing };
}

/**
 * @param options.noise montrer aussi ce qui ne change rien pour un joueur.
 * @param options.probe d'où vient le lien de la PR ; les tests le remplacent.
 */
export function unreleased(ws: Workspace, options: { noise?: boolean; probe?: Probe } = {}): Unreleased {
  if (!ws.current) return empty(null, 'no Dataset yet: click Update data');
  const manifest = readManifest(ws.datasetDir);
  const release = manifest?.dataslates.find((d) => d.id === manifest.current)?.latest || null;
  if (!release) return empty(null, 'no Dataset Release yet: everything is unreleased');
  if (!isRepository(ws.datasetDir) || !tagExists(ws.datasetDir, release))
    return empty(release, `Release ${release} is not in the Dataset folder: click Update data`);

  const released = readDatasetAt(ws.datasetDir, release, ws.gameSystem);
  const current = ws.current.files;
  const { stages, proposing } = stagesOf(ws.datasetDir);
  const between = stages.map(([stage, ref]): [Stage, Map<string, unknown>] => [stage, readDatasetAt(ws.datasetDir, ref, ws.gameSystem)]);
  const index = (files: Map<string, unknown> | undefined) => files?.get(indexPath(ws.gameSystem)) as DatasetIndex | undefined;
  const was = index(released)?.sources ?? [];
  const now = index(current)?.sources ?? [];
  const onMain = index(between.find(([stage]) => stage === 'merged')?.[1])?.sources;
  const sources = [...new Set([...was, ...now].map((s) => s.id))].map((id): SourceShift => {
    const b = was.find((s) => s.id === id);
    const a = now.find((s) => s.id === id);
    const m = onMain?.find((s) => s.id === id);
    const apart = m && m.commit !== b?.commit && m.commit !== a?.commit;
    return {
      ...(apart ? { merged: m.commit, ...(m.version ? { mergedVersion: m.version } : {}) } : {}),
      id,
      before: b?.commit ?? null,
      after: a?.commit ?? null,
      ...(b?.version ? { beforeVersion: b.version } : {}),
      ...(a?.version ? { afterVersion: a.version } : {}),
    };
  });
  const armies = diffFiles(released, current, ws.gameSystem, { noise: options.noise, stages: between, ...(ws.bare ? { bare: ws.bare.files } : {}) });
  attribute(ws, armies);
  return { release, sources, armies, pullRequest: proposing ? (options.probe ?? defaultProbe).pullRequest(ws.datasetDir) : null };
}

/**
 * Le fichier et l'auteur de ce que le projet écrit : la Correction qui force
 * une valeur, le fichier de Contributions de l'Army. L'auteur est le dernier à
 * l'avoir commité ; « you » pour ce qui attend d'être proposé.
 */
function attribute(ws: Workspace, armies: ArmyChanges[]): void {
  const git = (...args: string[]) => execFileSync('git', ['-C', ws.datasetDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  let pending: Set<string> | null = null;
  const authors = new Map<string, string>();
  const authorOf = (path: string): string => {
    pending ??= new Set(
      git('status', '--porcelain', '--untracked-files=all', '--', 'corrections', 'authored')
        .split('\n')
        .filter(Boolean)
        .map((l) => l.slice(3)),
    );
    if (pending.has(path)) return 'you';
    if (!authors.has(path)) authors.set(path, git('log', '-1', '--format=%an', '--', path).trim() || 'you');
    return authors.get(path)!;
  };
  const verdicts = new Map<string, CorrectionVerdict[]>();
  for (const v of ws.current?.corrections ?? []) {
    const sheet = sheetOfTarget(v.target);
    verdicts.set(sheet, [...(verdicts.get(sheet) ?? []), v]);
  }
  /** La Correction d'un champ : celle qui nomme l'élément du champ, sinon celle de l'entité entière, sinon la seule. */
  const correctionOf = (target: string, c: FieldChange) => {
    const mine = verdicts.get(target) ?? [];
    const element = (v: CorrectionVerdict) => parseTarget(v.target).name.split('|').pop() ?? '';
    return mine.find((v) => element(v) && c.field.includes(`"${element(v)}"`)) ?? mine.find((v) => v.target === target) ?? (mine.length === 1 ? mine[0] : undefined);
  };
  if (!isRepository(ws.datasetDir)) return;
  for (const army of armies)
    for (const entity of army.entities)
      for (const c of entity.changes) {
        const file = c.origin === 'correction' ? correctionOf(entity.target, c)?.path : c.origin === 'contribution' ? contributionsPath(ws.gameSystem, army.id) : undefined;
        if (!file) continue;
        c.file = file;
        c.by = authorOf(file);
      }
}
