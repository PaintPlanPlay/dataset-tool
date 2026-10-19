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
import { findRulesText } from '../src/notext.ts';
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

section('Tableau de bord : toutes les entités');
{
  const repo = await datasetRepo();
  type Mutable = ArmyFile & { units: (ArmyFile['units'][number] & { optionGroups?: { id: string; maxPicks: number }[] })[] };
  repo.edit<Mutable>(ORKS, (a) => {
    const horde = a.detachments.find((d) => d.id === 'war-horde')!;
    horde.dp = 99;
    horde.rules.find((r) => r.id === 'get-stuck-in')!.modifiers = [{ key: 'hit', value: 1, target: 'self' }];
    horde.enhancements.find((e) => e.id === 'follow-me-ladz')!.points = 1;
    a.stratagems.find((s) => s.id === 'ere-we-go')!.cp = 3;
    a.stratagems.push({ ...a.stratagems[0], id: 'gone-strat', name: 'Gone Stratagem' });
    a.armyRules!.find((r) => r.id === 'waaagh')!.summary = 'An old summary.';
    a.units.find((u) => u.id === 'u-boyz')!.optionGroups!.find((g) => g.id === 'g-special')!.maxPicks = 1;
  });
  repo.edit<{ stratagems: { id: string; cp: number }[]; battleSizes: unknown[] }>(`${GS}/core.json`, (c) => {
    c.stratagems.find((s) => s.id === 'command-re-roll')!.cp = 9;
    c.battleSizes.push({ points: 500, name: 'Combat Patrol', detachmentPoints: 1, enhancementLimit: 1, unitLimit: 1 });
  });
  repo.write('manifest.json', repo.manifest('wh40k-11e-mfm-1-4-r1', ['wh40k-11e-mfm-1-4-r1']));
  repo.commit('Release r1');
  repo.git('tag', 'wh40k-11e-mfm-1-4-r1');

  const { gui, at } = await serve(repo.dir);
  try {
    const u = await at<Unreleased>('/api/unreleased');
    const entity = (army: string, kind: string, id: string) => u.armies.find((a) => a.id === army)?.entities.find((e) => e.kind === kind && e.id === id);
    const change = (army: string, kind: string, id: string, field: RegExp) => entity(army, kind, id)?.changes.find((c) => field.test(c.field));
    const horde = entity('orks', 'detachment', 'war-horde');
    check('Detachment : ses DP, sous son Army, ouvrant sa fiche', change('orks', 'detachment', 'war-horde', /^DP$/)?.before === '99' && horde?.target === 'orks::detachment:war-horde', JSON.stringify(horde));
    check('Detachment Rule : ce que font ses Modifiers', Boolean(change('orks', 'detachment', 'war-horde', /Get Stuck In/i)?.before?.includes('to Hit')), JSON.stringify(horde?.changes));
    check('Enhancement : ses points', change('orks', 'detachment', 'war-horde', /Follow Me Ladz/i)?.before?.includes('1 pts') === true, JSON.stringify(horde?.changes));
    check(
      'un Detachment que deux Armies publient ne se lit qu\'une fois, sous son Army d\'origine',
      !entity('orks-freebooterz', 'detachment', 'war-horde'),
      u.armies.map((a) => `${a.id}: ${a.entities.map((e) => e.id).join(',')}`).join(' / '),
    );
    const strat = entity('orks', 'stratagem', 'ere-we-go');
    check('Stratagem : son coût, ouvrant sa fiche', strat?.target === 'orks::stratagem:ere-we-go' && change('orks', 'stratagem', 'ere-we-go', /^CP$/)?.before === '3', JSON.stringify(strat));
    check('un Stratagem retiré est marqué retiré', entity('orks', 'stratagem', 'gone-strat')?.status === 'removed');
    const rule = entity('orks', 'armyRule', 'waaagh');
    check('Army Rule : sa Description', rule?.target === 'orks::armyrule:waaagh' && change('orks', 'armyRule', 'waaagh', /description/i)?.before === 'An old summary.', JSON.stringify(rule));
    check('groupe d\'options d\'équipement', Boolean(change('orks', 'unit', 'u-boyz', /Special Weapons/)), JSON.stringify(entity('orks', 'unit', 'u-boyz')));
    const core = u.armies.find((a) => a.id === 'core');
    check('Core : un groupe à part, ses Stratagems et ses Battle Sizes', core?.name === 'Core' && change('core', 'stratagem', 'command-re-roll', /^CP$/)?.before === '9' && change('core', 'core', 'core', /Combat Patrol/)?.after === null, JSON.stringify(core));
  } finally {
    await gui.close();
    rmSync(repo.dir, { recursive: true, force: true });
  }
}

section('Tableau de bord : le bruit');
{
  const repo = await datasetRepo();
  repo.edit<ArmyFile>(ORKS, (a) => {
    const boyz = unitOf(a, 'u-boyz');
    boyz.keywords = [...boyz.keywords].reverse();
    boyz.armyRules = [...boyz.armyRules, 'Old Rule'];
  });
  repo.write('manifest.json', repo.manifest('wh40k-11e-mfm-1-4-r1', ['wh40k-11e-mfm-1-4-r1']));
  repo.commit('Release r1');
  repo.git('tag', 'wh40k-11e-mfm-1-4-r1');

  const { gui, at } = await serve(repo.dir);
  try {
    const boyzOf = (u: Unreleased) => u.armies.find((a) => a.id === 'orks')?.entities.find((e) => e.id === 'u-boyz');
    const quiet = boyzOf(await at<Unreleased>('/api/unreleased'));
    check('une liste réordonnée ne change rien par défaut', !quiet?.changes.some((c) => c.field === 'keywords'), JSON.stringify(quiet?.changes));
    const rules = quiet?.changes.find((c) => c.field === 'army rules');
    check(
      'une liste qui change dit les éléments retirés et ajoutés, pas toute la liste',
      rules?.removed?.join() === 'Old Rule' && rules.added?.length === 0 && !rules.noise,
      JSON.stringify(rules),
    );
    const loud = boyzOf(await at<Unreleased>('/api/unreleased?all=1'));
    const keywords = loud?.changes.find((c) => c.field === 'keywords');
    check('« tout montrer » : la liste réordonnée apparaît, marquée comme bruit', keywords?.noise === true, JSON.stringify(keywords));
  } finally {
    await gui.close();
    rmSync(repo.dir, { recursive: true, force: true });
  }
}

section('Tableau de bord : comme Plan l\'affiche');
{
  const repo = await datasetRepo();
  type Groups = { optionGroups: { id: string; maxPicks: number; options: { maxCarriers: number }[] }[] };
  repo.edit<ArmyFile>(ORKS, (a) => {
    const groups = (unitOf(a, 'u-boyz') as unknown as Groups).optionGroups;
    groups.find((g) => g.id === 'g-special')!.maxPicks = 1;
    groups.find((g) => g.id === 'g-boyz')!.options[0].maxCarriers = 5;
    a.detachments.find((d) => d.id === 'war-horde')!.rules.find((r) => r.id === 'get-stuck-in')!.modifiers = [
      { key: 'hit', value: 1, target: 'enemy', conditions: [{ key: 'charged' }] },
    ];
  });
  repo.write('manifest.json', repo.manifest('wh40k-11e-mfm-1-4-r1', ['wh40k-11e-mfm-1-4-r1']));
  repo.commit('Release r1');
  repo.git('tag', 'wh40k-11e-mfm-1-4-r1');

  const { gui, at } = await serve(repo.dir);
  try {
    const u = await at<Unreleased>('/api/unreleased');
    const orks = u.armies.find((a) => a.id === 'orks');
    const boyz = orks?.entities.find((e) => e.id === 'u-boyz');
    const special = boyz?.changes.find((c) => c.field === 'wargear options "Special Weapons"');
    check(
      'un groupe d\'options se lit comme dans Plan : titre, contrainte, puis chaque option et ses Weapons',
      special?.before === 'Special Weapons — 1 model\nBoy w/ Big shoota — ➶ Big shoota\nBoy w/ Burna — ➶ Burna' &&
        special.after === 'Special Weapons — 2 models\nBoy w/ Big shoota — ➶ Big shoota\nBoy w/ Burna — ➶ Burna',
      JSON.stringify(special),
    );
    const root = boyz?.changes.find((c) => c.field.startsWith('wargear options') && c.field !== special?.field);
    check('le titre du groupe perd l\'effectif que BSData y met (« 9-19 Boyz » → « Boyz »)', root?.field === 'wargear options "Boyz"' && Boolean(root.before?.includes('· max 5')), JSON.stringify(root));
    const rule = orks?.entities.find((e) => e.id === 'war-horde')?.changes.find((c) => /Get Stuck In/i.test(c.field) && c.field.endsWith('effect'));
    check('une Detachment Rule dit ses Modifiers comme Plan', rule?.before === '+1 to Hit (enemy) — if after charging', JSON.stringify(rule));
    const findings = findRulesText(u.armies);
    check('rien de ce que le tableau de bord produit n\'est du texte de règles', findings.length === 0, JSON.stringify(findings.slice(0, 3)));
  } finally {
    await gui.close();
    rmSync(repo.dir, { recursive: true, force: true });
  }
}
