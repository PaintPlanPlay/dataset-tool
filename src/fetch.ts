/**
 * Remplit un instantané depuis GitHub, chaque source figée à un commit.
 *
 * Seule étape du Dataset Tool qui touche au réseau : la construction, elle, ne
 * lit que l'instantané. `GITHUB_TOKEN` relève la limite de l'API (60 requêtes
 * par heure sans jeton).
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SourceRef } from '@paintplanplay/dataset-schema';
import { toJson } from './dataset.ts';

export const UPSTREAMS = {
  bsdata: 'BSData/wh40k-11e',
  mfm: 'BSData/wh40k-11e-mfm',
  kdc: 'wn-mitch/40kdc-data',
} as const;

/** Les fichiers de 40kdc-data dont la construction a besoin, par faction. */
const KDC_CORE_FILES = ['factions.json', 'detachments.json', 'enhancements.json', 'stratagems.json', 'units.json'];

/**
 * 40kdc-data est trop volumineuse pour l'API (dépôt multi-langage, arbre
 * tronqué) : on la prend par un clone git partiel, réduit à ses données, au
 * commit voulu.
 */
function fetchKdc(out: string, commit: string): void {
  const clone = join(out, '.40kdc-clone');
  const git = (...args: string[]) => execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  rmSync(clone, { recursive: true, force: true });
  git('init', '-q', clone);
  git('-C', clone, 'remote', 'add', 'origin', `https://github.com/${UPSTREAMS.kdc}.git`);
  git('-C', clone, 'sparse-checkout', 'set', '--no-cone', '/data/core/', '/data/enrichment/');
  git('-C', clone, 'fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', commit);
  git('-C', clone, 'checkout', '-q', 'FETCH_HEAD');

  const target = join(out, '40kdc');
  const core = join(clone, 'data', 'core');
  for (const entry of readdirSync(core, { withFileTypes: true })) {
    if (entry.isFile() && entry.name === 'stratagems.json') cpSync(join(core, entry.name), join(target, 'core', entry.name));
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    for (const file of KDC_CORE_FILES) {
      const from = join(core, entry.name, file);
      if (existsSync(from)) cpSync(from, join(target, 'core', entry.name, file));
    }
  }
  const enrichment = join(clone, 'data', 'enrichment');
  for (const entry of readdirSync(enrichment, { withFileTypes: true })) {
    const from = join(enrichment, entry.name, 'abilities.json');
    if (entry.isDirectory() && !entry.name.startsWith('_example') && existsSync(from)) cpSync(from, join(target, 'enrichment', entry.name, 'abilities.json'));
  }
  rmSync(clone, { recursive: true, force: true });
}

const headers = (): Record<string, string> => {
  const h: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
};

async function api<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com/repos/${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`GitHub ${res.status} sur ${path}`);
  return (await res.json()) as T;
}

async function raw(repo: string, commit: string, path: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${repo}/${commit}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`téléchargement de ${repo}/${path} : HTTP ${res.status}`);
  return res.text();
}

/** Dernier commit de la branche par défaut. */
export async function headCommit(repo: string): Promise<string> {
  return (await api<{ sha: string }[]>(`${repo}/commits?per_page=1`))[0].sha;
}

async function tree(repo: string, commit: string): Promise<string[]> {
  const t = await api<{ tree: { path: string; type: string }[]; truncated: boolean }>(`${repo}/git/trees/${commit}?recursive=1`);
  if (t.truncated) throw new Error(`arbre de ${repo} tronqué par l'API`);
  return t.tree.filter((n) => n.type === 'blob').map((n) => n.path);
}

/** Télécharge en parallèle mesurée : GitHub n'aime pas cinquante requêtes d'un coup. */
async function pool<T>(items: T[], width: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    }),
  );
}

export interface FetchOptions {
  out: string;
  /** Commits imposés par source ; à défaut, la tête de chaque dépôt. */
  commits?: Partial<Record<keyof typeof UPSTREAMS, string>>;
  log?: (message: string) => void;
}

export async function fetchSnapshot(options: FetchOptions): Promise<SourceRef[]> {
  const log = options.log ?? (() => {});
  rmSync(options.out, { recursive: true, force: true });
  const sources: SourceRef[] = [];

  // BSData : les catalogues à la racine du dépôt.
  const bsCommit = options.commits?.bsdata ?? (await headCommit(UPSTREAMS.bsdata));
  const bsFiles = (await tree(UPSTREAMS.bsdata, bsCommit)).filter((p) => p.endsWith('.json') && !p.includes('/'));
  mkdirSync(join(options.out, 'bsdata'), { recursive: true });
  await pool(bsFiles, 6, async (p) => writeFileSync(join(options.out, 'bsdata', p), await raw(UPSTREAMS.bsdata, bsCommit, p)));
  log(`BSData ${bsCommit.slice(0, 7)} : ${bsFiles.length} catalogues`);
  sources.push({ id: 'bsdata', repository: UPSTREAMS.bsdata, commit: bsCommit });

  // MFM : un YAML par faction, plus meta.yaml.
  const mfmCommit = options.commits?.mfm ?? (await headCommit(UPSTREAMS.mfm));
  const mfmFiles = (await tree(UPSTREAMS.mfm, mfmCommit)).filter((p) => p.startsWith('data/') && p.endsWith('.yaml'));
  mkdirSync(join(options.out, 'mfm'), { recursive: true });
  let version = '';
  await pool(mfmFiles, 6, async (p) => {
    const text = await raw(UPSTREAMS.mfm, mfmCommit, p);
    if (p === 'data/meta.yaml') version = /^version:\s*"?([^"\n]+)"?/m.exec(text)?.[1] ?? '';
    writeFileSync(join(options.out, 'mfm', p.slice('data/'.length)), text);
  });
  log(`MFM ${mfmCommit.slice(0, 7)} : ${mfmFiles.length} fichiers, version ${version || '?'}`);
  sources.push({ id: 'mfm', repository: UPSTREAMS.mfm, commit: mfmCommit, ...(version ? { version } : {}) });

  // 40kdc-data : Detachments, Enhancements, Stratagems, Effects.
  const kdcCommit = options.commits?.kdc ?? (await headCommit(UPSTREAMS.kdc));
  fetchKdc(options.out, kdcCommit);
  log(`40kdc-data ${kdcCommit.slice(0, 7)}`);
  sources.push({ id: '40kdc', repository: UPSTREAMS.kdc, commit: kdcCommit });

  writeFileSync(join(options.out, 'sources.json'), toJson(sources));
  return sources;
}
