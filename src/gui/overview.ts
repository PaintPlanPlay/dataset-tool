/**
 * L'état global de la nouvelle interface, pour sa colonne de gauche : les
 * versions en présence, le nombre de Corrections, si l'instantané est à jour,
 * et ce que chaque bouton peut faire.
 *
 * Deux questions sortent de la machine — la tête de chaque Upstream Source, et
 * le droit de publier sur le dépôt du Dataset. Elles passent par une `Probe`,
 * que les tests remplacent pour ne dépendre ni du réseau ni d'un compte.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexPath, manifestPath, type DatasetIndex, type Manifest, type SourceRef } from '@paintplanplay/dataset-schema';
import { authoredDir, EFFECTS_FILE } from '../authored.ts';
import { readCorrections } from '../corrections/files.ts';
import { headCommit } from '../fetch.ts';
import { ghReady, jobSpecs, publishRight, type JobField } from './api.ts';
import { isRepository, pendingChanges, pendingFingerprint } from './pending.ts';
import type { Workspace, WorkspaceState } from './workspace.ts';
import { findUnsimulated } from '../rules.ts';
import { toReviewCount } from './review.ts';

export interface Probe {
  /** Le dernier commit de chaque Upstream Source, par identifiant de source. Rejette hors ligne. */
  upstreamHeads(sources: SourceRef[]): Promise<Record<string, string>>;
  /** `null` quand on peut publier une Release ; sinon pourquoi pas. */
  publishRight(datasetDir: string): string | null;
  /** La PR ouverte depuis la branche du dépôt du Dataset, s'il y en a une. */
  pullRequest(datasetDir: string): PullRequest | null;
  /**
   * Les références du dépôt publié du Dataset (`refs/heads/main`, tags de
   * Release) ; `null` hors ligne. C'est lui, pas la copie locale, qui dit si
   * une PR a été fusionnée depuis.
   */
  remoteRefs(datasetDir: string): Promise<Record<string, string> | null>;
}

export interface PullRequest {
  url: string;
  /** « OPEN », « MERGED », « CLOSED », tel que GitHub le dit. */
  state: string;
}

const PR_TTL = 60_000;
let refs: { at: number; dir: string; value: Record<string, string> | null } | null = null;
let pr: { at: number; dir: string; value: PullRequest | null } | null = null;

/** Une tête amont ne bouge pas à la minute : on ne redemande pas GitHub à chaque affichage. */
const HEADS_TTL = 10 * 60_000;
let heads: { at: number; key: string; value: Record<string, string> } | null = null;

export const defaultProbe: Probe = {
  async upstreamHeads(sources) {
    const key = sources.map((s) => s.repository).join();
    if (heads && heads.key === key && Date.now() - heads.at < HEADS_TTL) return heads.value;
    const value = Object.fromEntries(await Promise.all(sources.map(async (s) => [s.id, await headCommit(s.repository)] as const)));
    heads = { at: Date.now(), key, value };
    return value;
  },
  publishRight,
  pullRequest(datasetDir) {
    if (pr && pr.dir === datasetDir && Date.now() - pr.at < PR_TTL) return pr.value;
    let value: PullRequest | null = null;
    try {
      const out = execFileSync('gh', ['pr', 'view', '--json', 'url,state'], { cwd: datasetDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      value = JSON.parse(out) as PullRequest;
    } catch {
      // Pas de PR pour cette branche, ou pas de GitHub CLI : rien à montrer.
    }
    pr = { at: Date.now(), dir: datasetDir, value };
    return value;
  },
  async remoteRefs(datasetDir) {
    if (refs && refs.dir === datasetDir && Date.now() - refs.at < PR_TTL) return refs.value;
    let value: Record<string, string> | null = null;
    try {
      const out = execFileSync('git', ['-C', datasetDir, 'ls-remote', 'origin', 'refs/heads/main', 'refs/tags/*'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        timeout: 15_000,
      });
      value = Object.fromEntries(out.split('\n').filter(Boolean).map((l) => l.split('\t').reverse() as [string, string]));
    } catch {
      // Hors ligne, ou pas de dépôt : on ne sait pas, et on ne le prétend pas.
    }
    refs = { at: Date.now(), dir: datasetDir, value };
    return value;
  },
};

export type ButtonName = 'update' | 'build' | 'propose' | 'release' | 'check';

export interface ButtonState {
  name: ButtonName;
  /** Ce que la tâche fait, en une ligne. */
  hint: string;
  /** Ce qu'elle demande avant de partir. */
  asks: JobField[];
  /** Publish Release se cache à qui n'a pas le droit d'écrire sur le dépôt. */
  visible: boolean;
  enabled: boolean;
  /** Pourquoi le bouton est grisé ; `null` s'il est actif. */
  reason: string | null;
}

export interface SourceVersion {
  id: SourceRef['id'];
  repository: string;
  /** Commit de l'instantané. */
  commit: string;
  version?: string;
  /** Dernier commit amont ; `null` quand on n'a pas pu le demander. */
  latest: string | null;
  /** `null` : inconnu. */
  upToDate: boolean | null;
}

export interface Overview {
  /** Ce qu'on a sous la main : un Dataset, un instantané, rien du tout. */
  workspace: WorkspaceState;
  /** L'interface a-t-elle le droit de pousser et d'ouvrir des PR (`--allow-push`) ? */
  allowPush: boolean;
  /**
   * Le GitHub CLI est-il utilisable par ce processus ? Proposer et publier en
   * dépendent ; mieux vaut le dire avant le clic.
   */
  gh: boolean;
  versions: {
    /** Tag de la Dataset Release que suit le Dataset, d'après son manifeste. */
    release: string | null;
    dataslate: { id: string; name: string } | null;
    sources: SourceVersion[];
  };
  /** Corrections et Contributions du dépôt du Dataset : ce que liste la pop-up qu'il ouvre. */
  corrections: number;
  /**
   * L'instantané est-il au dernier commit de chaque Upstream Source ? `null`
   * quand on n'a pas pu le demander : Update data reste alors possible.
   */
  upToDate: boolean | null;
  buttons: Record<ButtonName, ButtonState>;
  /**
   * Le dossier du Dataset face au dépôt publié : sa branche, et s'il lui
   * manque ce qui a été fusionné depuis (`null` : on ne sait pas).
   */
  dataset: { branch: string | null; behind: boolean | null };
  /** Pending Changes : ce qui est enregistré et pas encore proposé. */
  pending: number;
  pullRequest: PullRequest | null;
  /** Désaccords entre Upstream Sources, où la source qui fait autorité l'a emporté. */
  disagreements: number;
  /** Clés de Modifier que la Simulation ne sait pas jouer. */
  unsimulated: number;
  /** Rules extraites qui attendent un humain : divergentes, ou d'une seule lecture. */
  toReview: number;
  /** Les Armies du Dataset, pour le filtre de la recherche. */
  armies: { id: string; name: string }[];
}

const contributionCount = (ws: Workspace) => readJson<unknown[]>(join(ws.datasetDir, authoredDir(ws.gameSystem), EFFECTS_FILE))?.length ?? 0;

const readJson = <T>(path: string): T | null => (existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : null);

/**
 * Publier ne sert qu'à ce qui a été fusionné depuis la dernière Release : sans
 * commit sur `main` après son tag, il n'y a rien à publier.
 */
function nothingToPublish(ws: Workspace, manifest: Manifest | null, remote: Record<string, string> | null): string | null {
  const tag = manifest?.dataslates.find((d) => d.id === manifest.current)?.latest;
  if (!tag || !isRepository(ws.datasetDir)) return null;
  // Le dépôt publié fait foi : la copie locale n'a peut-être pas encore tiré la fusion.
  const released = remote?.[`refs/tags/${tag}^{}`] ?? remote?.[`refs/tags/${tag}`];
  if (remote && released) return remote['refs/heads/main'] === released ? `nothing merged since the last Release (${tag})` : null;
  try {
    const count = execFileSync('git', ['-C', ws.datasetDir, 'rev-list', '--count', `${tag}..main`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return Number(count.trim()) > 0 ? null : `nothing merged since the last Release (${tag})`;
  } catch {
    return null;
  }
}

/**
 * @param built l'empreinte des Pending Changes qu'a vues le dernier build réussi,
 * contrôle compris ; `null` sans build réussi.
 */
export async function overview(ws: Workspace, probe: Probe = defaultProbe, built: string | null = null): Promise<Overview> {
  const manifest = readJson<Manifest>(join(ws.datasetDir, manifestPath));
  const dataslate = manifest?.dataslates.find((d) => d.id === manifest.current) ?? null;
  const index = ws.current?.files.get(indexPath(ws.gameSystem)) as DatasetIndex | undefined;

  // Les versions de l'instantané quand il est là ; à défaut, celles du Dataset publié.
  const sources = readJson<SourceRef[]>(join(ws.snapshotDir, 'sources.json')) ?? index?.sources ?? [];
  let latest: Record<string, string> | null = null;
  if (ws.state.snapshot) latest = await probe.upstreamHeads(sources).catch(() => null);

  const versions = sources.map((s): SourceVersion => {
    const head = latest?.[s.id] ?? null;
    return { ...s, latest: head, upToDate: head === null ? null : head === s.commit };
  });
  const sourcesUpToDate = !ws.state.dataset || !ws.state.snapshot ? false : latest === null ? null : versions.every((v) => v.upToDate);

  // Le dossier du Dataset aussi doit être à jour : sur `main`, au commit du dépôt publié.
  const tracked = isRepository(ws.datasetDir);
  const git = (...args: string[]) => execFileSync('git', ['-C', ws.datasetDir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const branch = tracked ? git('rev-parse', '--abbrev-ref', 'HEAD') : null;
  const remote = tracked ? await probe.remoteRefs(ws.datasetDir) : null;
  const remoteMain = remote?.['refs/heads/main'];
  const behind = !tracked ? null : branch !== 'main' ? true : remoteMain ? git('rev-parse', 'HEAD') !== remoteMain : null;
  const upToDate = behind === true ? false : sourcesUpToDate;

  const right = probe.publishRight(ws.datasetDir);
  // Sans dépôt git, on ne sait pas ce qui attend : les boutons ne suivent que leurs prérequis.
  const pending = tracked ? pendingChanges(ws).length : 0;
  const rule: Partial<Record<ButtonName, () => string | null>> = {
    update: () => (upToDate === true ? 'everything is up to date' : null),
    build: () => (tracked && pending === 0 ? 'nothing to build: no pending change' : null),
    propose: () =>
      !tracked ? null : pending === 0 ? 'no pending change to propose' : built !== pendingFingerprint(ws) ? 'click Save & Build first: the build must pass the check' : null,
    release: () => nothingToPublish(ws, manifest, remote),
  };
  const buttons = Object.fromEntries(
    jobSpecs(ws, {}, probe).map((spec) => {
      const name = spec.name as ButtonName;
      const blocked = spec.needs?.(ws) ?? rule[name]?.() ?? null;
      const state: ButtonState = { name, hint: spec.hint, asks: spec.asks ?? [], visible: name !== 'release' || right === null, enabled: blocked === null, reason: blocked };
      return [name, state];
    }),
  ) as Record<ButtonName, ButtonState>;

  return {
    workspace: ws.state,
    allowPush: ws.allowPush,
    gh: ghReady(),
    versions: { release: dataslate?.latest ?? null, dataslate: dataslate ? { id: dataslate.id, name: dataslate.name } : null, sources: versions },
    corrections: ws.state.dataset ? readCorrections(ws.datasetDir, ws.gameSystem).length + contributionCount(ws) : 0,
    upToDate,
    buttons,
    dataset: { branch, behind },
    pending,
    pullRequest: probe.pullRequest(ws.datasetDir),
    disagreements: ws.current?.conflicts?.length ?? 0,
    unsimulated: findUnsimulated(ws.current?.files ?? new Map()).length,
    toReview: existsSync(ws.datasetDir) ? toReviewCount(ws) : 0,
    armies: (index?.armies ?? []).map((a) => ({ id: a.id, name: a.name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}
