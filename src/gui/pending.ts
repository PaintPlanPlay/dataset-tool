/**
 * Les Pending Changes : ce qu'un mainteneur a créé, modifié ou supprimé dans
 * son dépôt du Dataset et pas encore proposé — Corrections et Contributions.
 *
 * C'est git qui le sait : tout écart entre le dossier et son dernier commit est
 * en attente, et proposer le committe. Annuler une Pending Change restaure
 * l'état publié. Les Contributions vivent à plusieurs dans un fichier par
 * Army (`authored/<gameSystem>/armies/<army>.json`) : on les compare entrée
 * par entrée, tous fichiers confondus, pour qu'annuler l'une ne défasse pas
 * les autres et qu'une Contribution déplacée d'un fichier à l'autre ne compte
 * pas comme un changement.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { authoredDir, isContributionsPath, type AuthoredEffect } from '../authored.ts';
import { correctionsDir, type Correction } from '../corrections/files.ts';
import { toJson } from '../dataset.ts';
import { ApiError } from './api.ts';
import { sheetOfTarget } from './targets.ts';
import type { Workspace } from './workspace.ts';

export interface PendingChange {
  /** Ce qu'il faut renvoyer pour l'annuler. */
  id: string;
  kind: 'correction' | 'contribution';
  action: 'added' | 'modified' | 'deleted';
  /** Fichier du dépôt du Dataset. */
  path: string;
  /** L'élément visé, quand il y en a un. */
  target: string;
  /** La fiche qui l'affiche. */
  sheet: string;
  /** Sa raison, pour s'y retrouver dans la liste. */
  reason: string;
  /**
   * Réévaluée contre l'instantané courant : `stale` et `conflict` sont à
   * reprendre avant de proposer.
   */
  state?: string;
  note?: string;
}

const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** Le dossier du Dataset est-il la racine d'un dépôt git ? Un sous-dossier d'un autre dépôt ne compte pas. */
export const isRepository = (dir: string) => {
  try {
    return existsSync(dir) && realpathSync(git(dir, 'rev-parse', '--show-toplevel').trim()) === realpathSync(dir);
  } catch {
    return false;
  }
};

/** Le contenu d'un fichier au dernier commit ; `null` s'il n'y était pas. */
function atHead(dir: string, path: string): string | null {
  try {
    return git(dir, 'show', `HEAD:${path}`);
  } catch {
    return null;
  }
}

const parse = <T>(text: string | null): T | null => (text === null ? null : (JSON.parse(text) as T));

interface Status {
  path: string;
  action: PendingChange['action'];
}

/** Les fichiers de Corrections et Contributions qui s'écartent du dernier commit. */
function changedFiles(ws: Workspace): Status[] {
  const out = git(ws.datasetDir, 'status', '--porcelain=v1', '-uall', '--', correctionsDir(ws.gameSystem), authoredDir(ws.gameSystem));
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const code = line.slice(0, 2);
      const path = line.slice(3);
      const action: PendingChange['action'] = code.includes('?') || code.includes('A') ? 'added' : code.includes('D') ? 'deleted' : 'modified';
      return { path, action };
    });
}

export function pendingChanges(ws: Workspace): PendingChange[] {
  if (!isRepository(ws.datasetDir)) return [];
  const verdicts = new Map((ws.current?.corrections ?? []).map((v) => [v.path, v]));
  const contributions = new Map((ws.current?.contributions ?? []).map((v) => [v.target, v]));
  const out: PendingChange[] = [];

  const changed = changedFiles(ws);
  out.push(...contributionChanges(ws, changed.map((c) => c.path).filter((p) => isContributionsPath(ws.gameSystem, p)), contributions));
  for (const { path, action } of changed) {
    if (isContributionsPath(ws.gameSystem, path)) continue;
    if (path.startsWith(`${correctionsDir(ws.gameSystem)}/`)) {
      const text = action === 'deleted' ? atHead(ws.datasetDir, path) : readFileSync(join(ws.datasetDir, path), 'utf8');
      const c = parse<Correction>(text);
      const verdict = action === 'deleted' ? undefined : verdicts.get(path);
      out.push({
        id: `file:${path}`,
        kind: 'correction',
        action,
        path,
        target: c?.target ?? '',
        sheet: c ? sheetOfTarget(c.target) : '',
        reason: c?.reason ?? '',
        ...(verdict ? { state: verdict.state, note: verdict.note } : {}),
      });
      continue;
    }
    // Les autres Contributions tiennent chacune leur fichier : les Battle Sizes, surtout.
    out.push({ id: `file:${path}`, kind: 'contribution', action, path, target: path, sheet: 'core', reason: '' });
  }
  return out.sort((a, b) => a.sheet.localeCompare(b.sheet) || a.target.localeCompare(b.target));
}

const effectsAt = (text: string | null) => parse<AuthoredEffect[]>(text) ?? [];

/** Les Contributions de ces fichiers, par adresse, avec le fichier qui porte chacune. */
const entriesOf = (paths: string[], read: (path: string) => string | null) =>
  new Map(paths.flatMap((path) => effectsAt(read(path)).map((e) => [e.target, { e, path }] as const)));

const now = (ws: Workspace) => (path: string) => {
  const abs = join(ws.datasetDir, path);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
};

function contributionChanges(ws: Workspace, paths: string[], verdicts: Map<string, { state: string; note: string }>): PendingChange[] {
  const before = new Map([...entriesOf(paths, (p) => atHead(ws.datasetDir, p))].map(([t, x]) => [t, x.e]));
  const placed = entriesOf(paths, now(ws));
  const after = new Map([...placed].map(([t, x]) => [t, x.e]));
  const headPlaced = entriesOf(paths, (p) => atHead(ws.datasetDir, p));
  const out: PendingChange[] = [];
  for (const target of new Set([...before.keys(), ...after.keys()])) {
    const was = before.get(target);
    const now = after.get(target);
    if (JSON.stringify(was) === JSON.stringify(now)) continue;
    const verdict = now ? verdicts.get(target) : undefined;
    out.push({
      id: `contribution:${target}`,
      kind: 'contribution',
      action: !was ? 'added' : !now ? 'deleted' : 'modified',
      path: (placed.get(target) ?? headPlaced.get(target))!.path,
      target,
      sheet: sheetOfTarget(target),
      reason: (now ?? was)!.reason,
      ...(verdict ? { state: verdict.state, note: verdict.note } : {}),
    });
  }
  return out;
}

/** Annule une Pending Change : l'élément revient à son état publié. */
export function undoPending(ws: Workspace, id: string): void {
  if (!isRepository(ws.datasetDir)) throw new ApiError(409, 'the Dataset folder is not a git repository');
  const change = pendingChanges(ws).find((p) => p.id === id);
  if (!change) throw new ApiError(404, `no pending change ${id}`);
  const abs = join(ws.datasetDir, change.path);

  if (change.id.startsWith('contribution:')) {
    // L'entrée sort de tous les fichiers où elle est, puis revient, publiée, dans celui qui la portait.
    const paths = changedFiles(ws).map((c) => c.path).filter((p) => isContributionsPath(ws.gameSystem, p));
    const published = entriesOf(paths, (p) => atHead(ws.datasetDir, p)).get(change.target);
    for (const path of new Set([...paths, ...(published ? [published.path] : [])])) {
      const file = join(ws.datasetDir, path);
      const current = effectsAt(now(ws)(path)).filter((e) => e.target !== change.target);
      const next = published?.path === path ? [...current, published.e].sort((a, b) => a.target.localeCompare(b.target)) : current;
      if (next.length === 0) rmSync(file, { force: true });
      else writeFileSync(file, toJson(next));
    }
    return;
  }
  if (change.action === 'added') rmSync(abs, { force: true });
  else git(ws.datasetDir, 'checkout', 'HEAD', '--', change.path);
}

/**
 * L'empreinte de ce qui attend : un build ne vaut que pour les Pending Changes
 * qu'il a vues. En modifier une après coup demande de reconstruire.
 */
export function pendingFingerprint(ws: Workspace): string {
  if (!isRepository(ws.datasetDir)) return '';
  const hash = createHash('sha1');
  for (const { path, action } of changedFiles(ws)) {
    hash.update(`${action} ${path}\n`);
    const abs = join(ws.datasetDir, path);
    if (existsSync(abs)) hash.update(readFileSync(abs));
  }
  return hash.digest('hex');
}
