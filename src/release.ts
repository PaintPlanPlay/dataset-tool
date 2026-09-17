/**
 * Dataset Releases, Dataslates et manifeste.
 *
 * Une Release est un tag git du dépôt du Dataset : immuable, jamais réécrit.
 * Chacune appartient à une Dataslate, que l'outil propose d'après la version du
 * MFM et que le mainteneur confirme. Une Dataslate est gelée à la sortie de la
 * suivante. Le manifeste, à la racine du dépôt, désigne la Dataslate courante,
 * les deux précédentes et la Release que l'application lit pour chacune ; y
 * revenir en arrière, c'est le repointer.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexPath, manifestPath, SCHEMA_VERSION, type Dataslate, type DatasetIndex, type Manifest, type ReleaseRef, type SourceRef } from '@paintplanplay/dataset-schema';
import { checkDataset } from './check.ts';
import { toJson } from './dataset.ts';

export interface DataslateProposal {
  id: string;
  name: string;
  mfmVersion: string;
  /** false : la Dataslate existe déjà dans le manifeste. */
  isNew: boolean;
}

/** Id d'une Dataslate d'après la version du MFM : « 1.4 » → « mfm-1-4 ». */
export const dataslateIdFor = (mfmVersion: string) =>
  `mfm-${mfmVersion.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

export function proposeDataslate(sources: SourceRef[], manifest?: Manifest): DataslateProposal {
  const mfmVersion = sources.find((s) => s.id === 'mfm')?.version;
  if (!mfmVersion) throw new Error('the Dataset declares no MFM version: no Dataslate to propose');
  const known = manifest?.dataslates.find((d) => d.mfmVersion === mfmVersion);
  return known
    ? { id: known.id, name: known.name, mfmVersion, isNew: false }
    : { id: dataslateIdFor(mfmVersion), name: `MFM ${mfmVersion}`, mfmVersion, isNew: true };
}

/** La courante et les deux précédentes, dans l'ordre de publication. */
export function offeredOf(dataslates: Dataslate[], current: string): string[] {
  const i = dataslates.findIndex((d) => d.id === current);
  return i < 0 ? [] : dataslates.slice(i, i + 3).map((d) => d.id);
}

export const releaseTag = (gameSystem: string, dataslateId: string, n: number) => `${gameSystem}-${dataslateId}-r${n}`;

export interface ReleaseInput {
  gameSystem: string;
  dataslate: { id: string; name: string; mfmVersion: string };
  publishedAt: string;
  schemaVersion?: string;
  /** Obligatoire pour un premier manifeste ; ensuite, celui du manifeste. */
  releaseUrl?: string;
}

export interface ReleasePlan {
  manifest: Manifest;
  release: ReleaseRef;
  /** Dataslate gelée par cette Release, quand elle en ouvre une nouvelle. */
  frozen?: string;
}

export function planRelease(previous: Manifest | undefined, input: ReleaseInput): ReleasePlan {
  if (previous && previous.gameSystem !== input.gameSystem)
    throw new Error(`the manifest describes ${previous.gameSystem}, not ${input.gameSystem}`);
  const releaseUrl = input.releaseUrl ?? previous?.releaseUrl;
  if (!releaseUrl?.includes('{tag}')) throw new Error('release URL missing, or without "{tag}" in it (--release-url)');

  const dataslates = structuredClone(previous?.dataslates ?? []);
  let slate = dataslates.find((d) => d.id === input.dataslate.id);
  let frozen: string | undefined;
  if (slate?.frozen) throw new Error(`Dataslate ${slate.id} is frozen: a newer Dataslate has been published`);
  if (slate && slate.mfmVersion !== input.dataslate.mfmVersion)
    throw new Error(`Dataslate ${slate.id} matches MFM ${slate.mfmVersion}, not ${input.dataslate.mfmVersion}`);
  if (!slate) {
    // Une nouvelle Dataslate gèle celle qu'elle remplace.
    const replaced = dataslates.find((d) => !d.frozen);
    if (replaced) {
      replaced.frozen = true;
      frozen = replaced.id;
    }
    slate = { ...input.dataslate, frozen: false, releases: [], latest: '' };
    dataslates.unshift(slate);
  }

  const number = (slate.releases[0]?.number ?? 0) + 1;
  const release: ReleaseRef = {
    tag: releaseTag(input.gameSystem, slate.id, number),
    number,
    publishedAt: input.publishedAt,
    schemaVersion: input.schemaVersion ?? SCHEMA_VERSION,
  };
  slate.releases.unshift(release);
  slate.latest = release.tag;

  const manifest: Manifest = {
    schemaVersion: SCHEMA_VERSION,
    gameSystem: input.gameSystem,
    releaseUrl,
    current: slate.id,
    offered: offeredOf(dataslates, slate.id),
    dataslates,
  };
  return { manifest, release, ...(frozen ? { frozen } : {}) };
}

export interface RepointInput {
  /** Nouvelle Dataslate courante. */
  current?: string;
  /** Release à lire pour une Dataslate (la courante sans précision). */
  release?: string;
  dataslate?: string;
}

/** Revenir en arrière : repointer la courante, ou la Release lue pour une Dataslate. */
export function repoint(previous: Manifest, to: RepointInput): Manifest {
  const manifest = structuredClone(previous);
  if (to.current !== undefined) {
    if (!manifest.dataslates.some((d) => d.id === to.current)) throw new Error(`unknown Dataslate: ${to.current}`);
    manifest.current = to.current;
  }
  if (to.release !== undefined) {
    const id = to.dataslate ?? manifest.current;
    const slate = manifest.dataslates.find((d) => d.id === id);
    if (!slate) throw new Error(`unknown Dataslate: ${id}`);
    if (!slate.releases.some((r) => r.tag === to.release)) throw new Error(`Release ${to.release} unknown in Dataslate ${id}`);
    slate.latest = to.release;
  }
  manifest.offered = offeredOf(manifest.dataslates, manifest.current);
  return manifest;
}

// --------------------------------------------------------- dépôt du Dataset

export type Git = (args: string[]) => string;

const gitIn = (dir: string): Git => (args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

const readManifest = (dir: string): Manifest | undefined =>
  existsSync(join(dir, manifestPath)) ? (JSON.parse(readFileSync(join(dir, manifestPath), 'utf8')) as Manifest) : undefined;

const tagExists = (git: Git, tag: string) => {
  try {
    git(['rev-parse', '--quiet', '--verify', `refs/tags/${tag}`]);
    return true;
  } catch {
    return false;
  }
};

export interface PublishOptions {
  dir: string;
  gameSystem: string;
  /** Dataslate confirmée par le mainteneur ; absente, seule la proposition est rendue. */
  dataslate?: string;
  dataslateName?: string;
  releaseUrl?: string;
  now?: () => string;
}

export type PublishResult =
  | { status: 'proposal'; proposal: DataslateProposal }
  | ({ status: 'published'; proposal: DataslateProposal } & ReleasePlan);

/**
 * Publier une Release : le Dataset construit doit être conforme, la Dataslate
 * confirmée, le tag encore libre. Le manifeste est écrit, le tout commité et
 * tagué ; pousser (\`git push --follow-tags\`) reste au mainteneur ou à la CI.
 */
export function publishRelease(options: PublishOptions): PublishResult {
  const { dir, gameSystem } = options;
  const git = gitIn(dir);
  if (!existsSync(join(dir, '.git'))) throw new Error(`${dir} is not a git repository: a Release is a tag`);

  const check = checkDataset(dir, gameSystem);
  if (!check.ok) throw new Error('Dataset not compliant (schema or rules text): no Release');

  const index = JSON.parse(readFileSync(join(dir, indexPath(gameSystem)), 'utf8')) as DatasetIndex;
  const previous = readManifest(dir);
  const proposal = proposeDataslate(index.sources, previous);
  if (!options.dataslate) return { status: 'proposal', proposal };

  const existing = previous?.dataslates.find((d) => d.id === options.dataslate);
  const plan = planRelease(previous, {
    gameSystem,
    dataslate: {
      id: options.dataslate,
      name: existing?.name ?? options.dataslateName ?? proposal.name,
      mfmVersion: proposal.mfmVersion,
    },
    publishedAt: (options.now ?? (() => new Date().toISOString()))(),
    schemaVersion: index.schemaVersion,
    ...(options.releaseUrl ? { releaseUrl: options.releaseUrl } : {}),
  });
  if (tagExists(git, plan.release.tag)) throw new Error(`tag ${plan.release.tag} already exists: a published Release is never rewritten`);

  writeFileSync(join(dir, manifestPath), toJson(plan.manifest));
  git(['add', '-A']);
  git(['commit', '--quiet', '--allow-empty', '-m', `Dataset Release ${plan.release.tag}`]);
  git(['tag', '-a', plan.release.tag, '-m', `Dataset Release ${plan.release.tag} (Dataslate ${plan.manifest.current})`]);
  return { status: 'published', proposal, ...plan };
}

/** Repointer le manifeste et le commiter ; aucun tag, aucune Release touchée. */
export function repointManifest(dir: string, to: RepointInput): Manifest {
  const previous = readManifest(dir);
  if (!previous) throw new Error('no manifest to repoint');
  const manifest = repoint(previous, to);
  writeFileSync(join(dir, manifestPath), toJson(manifest));
  if (existsSync(join(dir, '.git'))) {
    const git = gitIn(dir);
    git(['add', manifestPath]);
    git(['commit', '--quiet', '-m', `Manifest repointed to ${manifest.current}`]);
  }
  return manifest;
}
