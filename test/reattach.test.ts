/**
 * Rattacher une Contribution dont l'élément a changé de nom, côté API : les
 * candidats, le geste, la Pending Change qu'il devient, et le choix quand
 * l'élément choisi a déjà sa Contribution. Sur un dépôt de Dataset de
 * fixtures, versionné par git comme le vrai.
 *
 *   npx tsx test/reattach.test.ts
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArmyFile } from '@paintplanplay/dataset-schema';
import { contributionsPath, readAuthored, readContributions, type AuthoredEffect } from '../src/authored.ts';
import { build } from '../src/build.ts';
import { readCorrections } from '../src/corrections/files.ts';
import { readRegistry, toJson, writeDataset } from '../src/dataset.ts';
import type { PendingChange } from '../src/gui/pending.ts';
import type { Reattachable } from '../src/gui/reattach.ts';
import type { CorrectionItem } from '../src/gui/sheets.ts';
import type { Unreleased } from '../src/gui/unreleased.ts';
import { startGui } from '../src/gui/server.ts';
import { openWorkspace } from '../src/gui/workspace.ts';
import { openSnapshot } from '../src/snapshot.ts';
import { check, fixture, section } from './check.ts';

const GS = 'wh40k-11e';
const ORKS = contributionsPath(GS, 'orks');

/**
 * Le dépôt publié : construit, commité, avec trois Contributions qui ne
 * trouvent plus leur cible — une aptitude renommée (« (Aura) » en moins), une
 * aptitude renommée qu'une autre Contribution décrit déjà sous son nouveau
 * nom, et une aptitude d'une Unit dont BSData a changé l'identifiant.
 */
const dir = mkdtempSync(join(tmpdir(), 'dataset-reattach-'));
cpSync(fixture('dataset'), dir, { recursive: true });
const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
git('init', '-q', '-b', 'main');
git('config', 'user.email', 'test@example.invalid');
git('config', 'user.name', 'Test');
const built = await build({
  snapshot: openSnapshot(fixture('snapshot')),
  gameSystem: GS,
  ids: readRegistry(dir, GS),
  authored: readAuthored(dir, GS),
  corrections: readCorrections(dir, GS),
});
writeDataset(dir, GS, built.files, built.ids);
// Le Dataset publié se souvient d'une Unit dont l'identifiant a changé depuis.
const publishedOrks = join(dir, GS, 'armies', 'orks.json');
const army = JSON.parse(readFileSync(publishedOrks, 'utf8')) as ArmyFile;
army.units.push({ ...structuredClone(army.units.find((u) => u.id === 'u-warboss')!), id: 'u-warboss-old' });
writeFileSync(publishedOrks, toJson(army));

const renamed: AuthoredEffect = { target: 'u-warboss::ability:Da Boss Fixture (Aura)', summary: 'Adds 1 to the Wound roll of the unit it leads.', reason: 'Written before BSData dropped « (Aura) ».' };
const twin: AuthoredEffect = { target: 'u-warboss::ability:Leader (Old)', summary: 'Old wording of the attachment.', reason: 'Written before the rename.' };
const already: AuthoredEffect = { target: 'u-warboss::ability:Leader', summary: 'Current wording of the attachment.', reason: 'Rewritten by hand after the rename.' };
const moved: AuthoredEffect = { target: 'u-warboss-old::ability:Da Boss Fixture', summary: 'Ability of a unit whose id changed.', reason: 'Written before BSData changed the id.' };
// Une option créée à la main dans le pool des Meganobz, que l'import donne désormais ; un coût posé sur une option du Warboss.
const createdTwin: AuthoredEffect = {
  target: 'u-meganobz::option:g-meganobz|contrib-twin',
  option: { name: 'Meganob w/ Twin Killsaw', weapons: ['melee|Twin Killsaw'], maxCarriers: 6, isDefault: false },
  wargearCost: { item: 'Twin Killsaws' },
  reason: 'Written when BSData lacked the option.',
};
const squig: AuthoredEffect = { target: 'u-warboss::option:g-warboss-gun|e-slugga', wargearCost: { item: 'Attack squig' }, reason: 'Test: a cost on a Warboss option.' };
const contributions = [...(JSON.parse(readFileSync(join(dir, ORKS), 'utf8')) as AuthoredEffect[]), renamed, twin, already, moved, createdTwin, squig];
writeFileSync(join(dir, ORKS), toJson(contributions.sort((a, b) => a.target.localeCompare(b.target))));
git('add', '-A');
git('commit', '-q', '-m', 'Dataset publié');

const ws = await openWorkspace({ datasetDir: dir, snapshotDir: fixture('snapshot') });
const gui = await startGui(ws, { port: 0, probe: { upstreamHeads: async () => ({}), publishRight: () => null, pullRequest: () => null, remoteRefs: async () => null } });
const call = async <T>(path: string, body?: unknown) => {
  const res = await fetch(new URL(path, gui.url), body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as T };
};
const refresh = () => call('/api/refresh', {});
const candidates = async (target: string) => (await call<Reattachable>(`/api/contributions/reattach?target=${encodeURIComponent(target)}`)).body;
const reattach = (from: string, to: string, keep?: string) => call<{ target: string; error?: string }>('/api/contributions/reattach', { from, to, ...(keep ? { keep } : {}) });
const effect = (target: string) => readContributions(dir, GS).find((e) => e.target === target);
const verdict = () => new Map((ws.current?.contributions ?? []).map((c) => [c.target, c.state]));

try {
  section('Une Contribution dont l\'aptitude a été renommée');
  await refresh();
  check('elle est « unresolved »', verdict().get(renamed.target) === 'unresolved', String(verdict().get(renamed.target)));
  const offer = await candidates(renamed.target);
  check('le premier candidat est l\'aptitude de même nom sans suffixe', offer.candidates[0]?.target === 'u-warboss::ability:Da Boss Fixture', JSON.stringify(offer.candidates.map((c) => c.target)));
  check('les candidats sont des aptitudes de la même Unit', offer.candidates.every((c) => c.target.startsWith('u-warboss::ability:')));

  section('Le geste est disponible là où on voit le problème');
  const unreleased = (await call<Unreleased>('/api/unreleased')).body;
  check('dans « Contributions to review » du tableau de bord', unreleased.findings.some((f) => f.kind === 'contribution' && f.reattach === renamed.target), JSON.stringify(unreleased.findings.filter((f) => f.kind === 'contribution')));
  const listed = (await call<CorrectionItem[]>('/api/corrections?sheet=u-warboss')).body;
  check('dans Corrections (n) de la fiche, comme une Contribution « unresolved »', listed.some((c) => c.target === renamed.target && c.state === 'unresolved'));

  section('Rattacher réécrit la cible, sans toucher au contenu');
  const done = await reattach(renamed.target, 'u-warboss::ability:Da Boss Fixture');
  await refresh();
  const after = effect('u-warboss::ability:Da Boss Fixture');
  check('la Contribution vise le nouvel élément', done.status === 200 && Boolean(after) && !effect(renamed.target), JSON.stringify(done.body));
  check('son contenu est intact', after?.summary === renamed.summary && after?.reason === renamed.reason);
  check('elle redevient active et sort du compteur', verdict().get('u-warboss::ability:Da Boss Fixture') === 'active' && !verdict().has(renamed.target));
  const board = (await call<Unreleased>('/api/unreleased')).body;
  check('« Contributions to review » ne la compte plus', !board.findings.some((f) => f.reattach === renamed.target));

  section('Le rattachement est une Pending Change qu\'on annule');
  const pending = (await call<PendingChange[]>('/api/pending')).body;
  const move = pending.find((p) => p.action === 'moved');
  check('une seule Pending Change « moved », de l\'ancienne cible à la nouvelle', pending.length === 1 && move?.from === renamed.target && move.target === 'u-warboss::ability:Da Boss Fixture', JSON.stringify(pending));
  await call('/api/pending/undo', { id: move?.id });
  check('l\'annuler rend le dépôt à son état publié', git('status', '--porcelain') === '', git('status', '--porcelain'));

  section('L\'élément choisi a déjà sa Contribution');
  const offerTwin = await candidates(twin.target);
  const first = offerTwin.candidates[0];
  check('le candidat de même nom est proposé avec la Contribution qui le décrit', first?.target === already.target && first.existing?.summary === already.summary, JSON.stringify(first));
  const refused = await reattach(twin.target, already.target);
  check('sans choix, le rattachement est refusé et rien n\'est écrit', refused.status === 409 && git('status', '--porcelain') === '', String(refused.status));
  await reattach(twin.target, already.target, 'moved');
  check('« garder celle-ci » : une seule Contribution, celle qu\'on rattache', effect(already.target)?.summary === twin.summary && !effect(twin.target));
  await call('/api/pending/undo', { id: (await call<PendingChange[]>('/api/pending')).body.find((p) => p.action === 'moved')?.id });
  check('annulé, les deux reviennent', git('status', '--porcelain') === '');
  await reattach(twin.target, already.target, 'existing');
  check('« garder l\'autre » : celle qu\'on rattachait est supprimée', effect(already.target)?.summary === already.summary && !effect(twin.target));
  git('checkout', '-q', '--', '.');

  section('Une Contribution dont l\'Unit a changé d\'identifiant');
  const offerUnit = await candidates(moved.target);
  check('elle propose l\'Unit de même nom', offerUnit.candidates[0]?.target === 'u-warboss::ability:Da Boss Fixture', JSON.stringify(offerUnit.candidates.map((c) => c.target)));
  check('nommée d\'après le Dataset publié', offerUnit.label === 'Da Boss Fixture' && offerUnit.candidates[0]?.holder === 'Warboss');

  section('Les Contributions d\'options passent aux Wargear Alternatives');
  {
    const bill = (unitId: string, alternativeId: string) => {
      const army = ws.current?.files.get(`${GS}/armies/orks.json`) as ArmyFile;
      const a = army.units.find((u) => u.id === unitId)?.wargearOptions?.flatMap((o) => o.alternatives).find((x) => x.id === alternativeId);
      return a?.wargearCost?.item;
    };
    check('un coût posé sur une option du Warboss reste actif, sur la Wargear Alternative de même identifiant', verdict().get(squig.target) === 'active' && bill('u-warboss', 'e-slugga') === 'Attack squig', String(bill('u-warboss', 'e-slugga')));
    const flagged = ws.current?.contributions?.find((c) => c.target === createdTwin.target);
    check('une option créée que l\'import donne désormais est signalée, à rattacher', flagged?.state === 'flagged' && /reattach/.test(flagged.note), JSON.stringify(flagged));
    const board = (await call<Unreleased>('/api/unreleased')).body;
    check('le tableau de bord propose de la rattacher', board.findings.some((f) => f.reattach === createdTwin.target));
    const offer = await candidates(createdTwin.target);
    check('la Wargear Alternative qui donne les mêmes Weapons vient en premier', offer.candidates[0]?.target === 'u-meganobz::option:m-mnz-twin|m-mnz-twin', JSON.stringify(offer.candidates.slice(0, 3).map((c) => c.target)));
    const done = await reattach(createdTwin.target, offer.candidates[0].target);
    const after = effect('u-meganobz::option:m-mnz-twin|m-mnz-twin');
    check('rattachée, elle ne crée plus d\'option et garde son coût', done.status === 200 && after?.option === undefined && after?.wargearCost?.item === 'Twin Killsaws' && !effect(createdTwin.target), JSON.stringify(after));
    await refresh();
    check('elle redevient active, le coût porté par l\'alternative traduite', verdict().get('u-meganobz::option:m-mnz-twin|m-mnz-twin') === 'active' && bill('u-meganobz', 'm-mnz-twin') === 'Twin Killsaws');
    await call('/api/pending/undo', { id: (await call<PendingChange[]>('/api/pending')).body.find((p) => p.target.includes('m-mnz-twin') || p.from === createdTwin.target)?.id });
    git('checkout', '-q', '--', '.');
    await refresh();
  }

  section('Ce qui ne se rattache pas');
  check('un genre d\'élément différent est refusé', (await reattach(renamed.target, 'u-warboss')).status === 400);
  check('un élément absent du Dataset est refusé', (await reattach(renamed.target, 'u-warboss::ability:Nothing Here')).status === 400);
  check('rien n\'est écrit', git('status', '--porcelain') === '');
} finally {
  await gui.close();
}
