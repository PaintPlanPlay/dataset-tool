/**
 * Point de test « tableau de bord » : les Unreleased Changes, telles que
 * l'interface locale les sert. Un dépôt du Dataset de test, une Release taguée
 * que le manifeste désigne, et ce que l'interface construit en mémoire.
 *
 *   npx tsx test/unreleased.test.ts
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArmyFile, DatasetIndex, Manifest } from '@paintplanplay/dataset-schema';
import { readAuthored } from '../src/authored.ts';
import { build } from '../src/build.ts';
import { readCorrections } from '../src/corrections/files.ts';
import { readRegistry, toJson, writeDataset } from '../src/dataset.ts';
import type { Unreleased } from '../src/gui/unreleased.ts';
import { startGui } from '../src/gui/server.ts';
import { openWorkspace } from '../src/gui/workspace.ts';
import { openSnapshot } from '../src/snapshot.ts';
import { check, fixture, section } from './check.ts';

const GS = 'wh40k-11e';
const ORKS = `${GS}/armies/orks.json`;

/** Un dépôt du Dataset de test, construit depuis l'instantané de test et commité. */
async function datasetRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'dataset-unreleased-'));
  cpSync(fixture('dataset'), dir, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '--quiet', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  const out = await build({
    snapshot: openSnapshot(fixture('snapshot')),
    gameSystem: GS,
    ids: readRegistry(dir, GS),
    authored: readAuthored(dir, GS),
    corrections: readCorrections(dir, GS),
  });
  writeDataset(dir, GS, out.files, out.ids);
  const read = <T>(path: string) => JSON.parse(readFileSync(join(dir, path), 'utf8')) as T;
  const write = (path: string, data: unknown) => writeFileSync(join(dir, path), toJson(data));
  const edit = <T>(path: string, change: (data: T) => void) => {
    const data = read<T>(path);
    change(data);
    write(path, data);
  };
  const commit = (message: string) => {
    git('add', '-A');
    git('commit', '--quiet', '--allow-empty', '-m', message);
  };
  const manifest = (latest: string, tags: string[]): Manifest => ({
    schemaVersion: '1.0.0',
    gameSystem: GS,
    releaseUrl: 'https://cdn.example/{tag}/',
    current: 'mfm-1-4',
    offered: ['mfm-1-4'],
    dataslates: [
      {
        id: 'mfm-1-4',
        name: 'MFM 1.4',
        mfmVersion: '1.4',
        frozen: false,
        releases: tags.map((tag, i) => ({ tag, number: tags.length - i, publishedAt: '2026-09-01T00:00:00.000Z', schemaVersion: '1.0.0' })),
        latest,
      },
    ],
  });
  return { dir, git, built: out.files, read, write, edit, commit, manifest };
}

const unitOf = (army: ArmyFile, id: string) => army.units.find((u) => u.id === id)!;

async function serve(dir: string) {
  const ws = await openWorkspace({ datasetDir: dir, snapshotDir: fixture('snapshot') });
  const gui = await startGui(ws, {
    port: 0,
    probe: { upstreamHeads: async () => ({}), publishRight: () => null, pullRequest: () => null, remoteRefs: async () => null },
  });
  const at = async <T>(path: string) => (await fetch(new URL(path, gui.url))).json() as Promise<T>;
  return { ws, gui, at };
}

section('Tableau de bord : la Release en production comme référence');
{
  const repo = await datasetRepo();
  const realBoyz = unitOf(repo.built.get(ORKS) as ArmyFile, 'u-boyz').points;
  // r1 : la Release que lisent les apps, avec des Boyz à 1 point et un BSData plus ancien.
  repo.edit<ArmyFile>(ORKS, (a) => (unitOf(a, 'u-boyz').points = 1));
  repo.edit<DatasetIndex>(`${GS}/index.json`, (i) => (i.sources.find((s) => s.id === 'bsdata')!.commit = 'a'.repeat(40)));
  repo.write('manifest.json', repo.manifest('wh40k-11e-mfm-1-4-r1', ['wh40k-11e-mfm-1-4-r1']));
  repo.commit('Release r1');
  repo.git('tag', 'wh40k-11e-mfm-1-4-r1');
  // r2, taguée mais retirée : le manifeste est revenu à r1.
  repo.edit<ArmyFile>(ORKS, (a) => (unitOf(a, 'u-boyz').points = 2));
  repo.commit('Release r2');
  repo.git('tag', 'wh40k-11e-mfm-1-4-r2');
  repo.write('manifest.json', repo.manifest('wh40k-11e-mfm-1-4-r1', ['wh40k-11e-mfm-1-4-r2', 'wh40k-11e-mfm-1-4-r1']));
  repo.commit('Rollback to r1');

  const { gui, at } = await serve(repo.dir);
  try {
    const u = await at<Unreleased>('/api/unreleased');
    check('la référence est la Release que désigne le manifeste, pas le dernier tag', u.release === 'wh40k-11e-mfm-1-4-r1', String(u.release));
    const orks = u.armies.find((a) => a.id === 'orks');
    const boyz = orks?.entities.find((e) => e.id === 'u-boyz');
    const points = boyz?.changes.find((c) => c.field === 'points');
    check(
      'un changement de valeur d\'Unit, groupé sous son Army puis son Unit, avant/après',
      orks?.name === 'Orks' && boyz?.name === 'Boyz' && boyz.kind === 'unit' && points?.before === '1' && points.after === String(realBoyz),
      JSON.stringify(boyz),
    );
    check('l\'Unit ouvre sa fiche', boyz?.target === 'u-boyz');
    check('une Unit inchangée n\'apparaît pas', !orks?.entities.some((e) => e.id === 'u-warboss'), orks?.entities.map((e) => e.id).join());
    const bsdata = u.sources.find((s) => s.id === 'bsdata');
    const snapshotCommit = (JSON.parse(readFileSync(fixture('snapshot', 'sources.json'), 'utf8')) as { id: string; commit: string }[]).find((s) => s.id === 'bsdata')!.commit;
    check('les versions des sources avant et après', bsdata?.before === 'a'.repeat(40) && bsdata.after === snapshotCommit, JSON.stringify(u.sources));
  } finally {
    await gui.close();
    rmSync(repo.dir, { recursive: true, force: true });
  }
}

section('Tableau de bord : sans Release');
{
  const repo = await datasetRepo();
  repo.commit('Premier build');
  const { gui, at } = await serve(repo.dir);
  try {
    const u = await at<Unreleased>('/api/unreleased');
    check('sans manifeste, pas de référence : le tableau de bord le dit', u.release === null && u.armies.length === 0 && Boolean(u.note), JSON.stringify(u));
  } finally {
    await gui.close();
    rmSync(repo.dir, { recursive: true, force: true });
  }
}
