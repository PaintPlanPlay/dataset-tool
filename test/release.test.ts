/**
 * Point de test « construction d'une Dataset Release » : Releases taguées,
 * Dataslates, gel, manifeste et retour en arrière.
 *
 *   npx tsx test/release.test.ts
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Manifest, SourceRef } from '@paintplanplay/dataset-schema';
import { build } from '../src/build.ts';
import { writeDataset } from '../src/dataset.ts';
import { planRelease, proposeDataslate, publishRelease, repoint, repointManifest, type ReleaseInput } from '../src/release.ts';
import { openSnapshot } from '../src/snapshot.ts';
import { check, fixture, section } from './check.ts';

const GS = 'wh40k-11e';
const URL_TEMPLATE = 'https://cdn.example/dataset@{tag}/';
const sources = (mfm: string): SourceRef[] => [{ id: 'mfm', repository: 'BSData/wh40k-11e-mfm', commit: 'x', version: mfm }];
const input = (mfm: string, at = '2026-09-01T00:00:00Z'): ReleaseInput => {
  const p = proposeDataslate(sources(mfm));
  return { gameSystem: GS, dataslate: { id: p.id, name: p.name, mfmVersion: mfm }, publishedAt: at, releaseUrl: URL_TEMPLATE };
};
const throws = (fn: () => unknown) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

section('Dataslates et manifeste');
const first = planRelease(undefined, input('1.4'));
check(
  'première Release : Dataslate proposée d\'après le MFM, tag numéroté, courante',
  first.release.tag === 'wh40k-11e-mfm-1-4-r1' && first.manifest.current === 'mfm-1-4' && first.manifest.offered.join() === 'mfm-1-4',
  JSON.stringify(first.manifest),
);
const second = planRelease(first.manifest, input('1.4'));
check('Release suivante dans la même Dataslate : r2, lue par défaut', second.release.tag === 'wh40k-11e-mfm-1-4-r2' && second.manifest.dataslates[0].latest === second.release.tag);
check('la proposition reconnaît une Dataslate existante', !proposeDataslate(sources('1.4'), second.manifest).isNew && proposeDataslate(sources('1.5'), second.manifest).isNew);

const next = planRelease(second.manifest, input('1.5'));
check(
  'nouvelle Dataslate : la précédente est gelée, ses Releases restent',
  next.frozen === 'mfm-1-4' && next.manifest.dataslates[1].frozen && next.manifest.dataslates[1].releases.length === 2 && next.manifest.current === 'mfm-1-5',
);
check('une Dataslate gelée ne reçoit plus de Release', throws(() => planRelease(next.manifest, input('1.4'))));
const four = planRelease(planRelease(next.manifest, input('1.6')).manifest, input('1.7')).manifest;
check('le manifeste propose la courante et les deux précédentes', four.offered.join() === 'mfm-1-7,mfm-1-6,mfm-1-5' && four.dataslates.length === 4);

const back = repoint(next.manifest, { release: 'wh40k-11e-mfm-1-5-r1' });
const rolled = repoint(four, { current: 'mfm-1-5' });
check('retour en arrière : repointer la Release lue, ou la Dataslate courante', back.dataslates[0].latest === 'wh40k-11e-mfm-1-5-r1' && rolled.offered.join() === 'mfm-1-5,mfm-1-4');
check('repointer vers une Release inconnue est refusé', throws(() => repoint(next.manifest, { release: 'wh40k-11e-mfm-1-5-r9' })));

section('Publication dans un dépôt git');
const dir = mkdtempSync(join(tmpdir(), 'dataset-release-'));
const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
try {
  git('init', '--quiet');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  const out = await build({ snapshot: openSnapshot(fixture('snapshot')) });
  writeDataset(dir, GS, out.files, out.ids);

  const proposal = publishRelease({ dir, gameSystem: GS });
  check('sans confirmation : la Dataslate est proposée, rien n\'est publié', proposal.status === 'proposal' && proposal.proposal.id === 'mfm-1-4' && git('tag', '-l') === '');

  const published = publishRelease({ dir, gameSystem: GS, dataslate: 'mfm-1-4', releaseUrl: URL_TEMPLATE, now: () => '2026-09-15T00:00:00Z' });
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest;
  check(
    'publier : manifeste écrit et commité, tag immuable créé',
    published.status === 'published' && git('tag', '-l').trim() === 'wh40k-11e-mfm-1-4-r1' && manifest.current === 'mfm-1-4' && git('status', '--porcelain') === '',
  );

  git('tag', 'wh40k-11e-mfm-1-4-r2');
  check('un tag déjà pris est refusé : une Release ne se réécrit pas', throws(() => publishRelease({ dir, gameSystem: GS, dataslate: 'mfm-1-4' })));
  git('tag', '-d', 'wh40k-11e-mfm-1-4-r2');
  publishRelease({ dir, gameSystem: GS, dataslate: 'mfm-1-4' });
  const repointed = repointManifest(dir, { release: 'wh40k-11e-mfm-1-4-r1' });
  check(
    'repointer : le manifeste revient sur la Release précédente, sans nouveau tag',
    repointed.dataslates[0].latest === 'wh40k-11e-mfm-1-4-r1' && git('tag', '-l').trim().split('\n').length === 2 && git('status', '--porcelain') === '',
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
