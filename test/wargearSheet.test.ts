/**
 * La partie équipement de la fiche d'Unit, côté API : le Default Wargear se
 * corrige (une Correction), une Wargear Option s'écrit en phrase (une
 * Contribution), chaque écriture est une Pending Change qu'on annule, un
 * brouillon invalide est refusé, et une phrase écrite à la main est signalée
 * quand BSData change ensuite ce qu'elle remplace. Sur un dépôt de Dataset de
 * test versionné par git et l'instantané `wargear` (datasheets réelles).
 *
 *   npx tsx test/wargearSheet.test.ts
 */
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Unit, WargearOption } from '@paintplanplay/dataset-schema';
import { readContributions } from '../src/authored.ts';
import { readCorrections } from '../src/corrections/files.ts';
import type { PendingChange } from '../src/gui/pending.ts';
import type { Sheet } from '../src/gui/sheets.ts';
import type { Unreleased } from '../src/gui/unreleased.ts';
import { startGui } from '../src/gui/server.ts';
import { openWorkspace } from '../src/gui/workspace.ts';
import { check, fixture, section } from './check.ts';

const GS = 'wh40k-11e';
const WAGON = '306a-b2ac-aaf1-9a7c';
const CAPTAIN = '6c10-5b51-5bc0-8d2c';

const dir = mkdtempSync(join(tmpdir(), 'dataset-wargear-'));
const snap = mkdtempSync(join(tmpdir(), 'snapshot-wargear-'));
cpSync(fixture('wargear'), snap, { recursive: true });
writeFileSync(join(dir, 'README.md'), 'Dataset de test\n');
const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
git('init', '-q', '-b', 'main');
git('config', 'user.email', 'test@example.invalid');
git('config', 'user.name', 'Test');
git('add', '-A');
git('commit', '-q', '-m', 'Dataset vide');

const ws = await openWorkspace({ datasetDir: dir, snapshotDir: snap });
const gui = await startGui(ws, { port: 0, probe: { upstreamHeads: async () => ({}), publishRight: () => null, pullRequest: () => null, remoteRefs: async () => null } });
const call = async <T>(path: string, body?: unknown) => {
  const res = await fetch(new URL(path, gui.url), body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as T };
};
/** `force` : relire même sans écriture de l'interface, quand le test a changé le disque lui-même. */
const refresh = (force = false) => call('/api/refresh', { force });
const sheet = async (target: string) => (await call<Sheet>(`/api/sheet?target=${encodeURIComponent(target)}`)).body;
const save = (target: string, draft: unknown, reason = 'Test de la fiche d\'équipement.') =>
  call<{ files: { path: string; kind: string }[]; error?: string; findings?: string[] }>('/api/sheet/save', { target, draft, reason });
const pending = async () => (await call<PendingChange[]>('/api/pending')).body;
const undoAll = async () => {
  for (const p of await pending()) await call('/api/pending/undo', { id: p.id });
  await refresh();
};
const clean = () => git('status', '--porcelain') === '';
const optionOf = (u: Unit, id: string) => u.wargearOptions?.find((o) => o.id === id) as WargearOption;
const SHOOTAS = '5d45-ef3f-5da5-f363';
const BALL = '933c-6d35-7e81-6e6d';

try {
  await refresh();
  const wagon = (await sheet(WAGON)).value as Unit;

  section('La fiche porte la nouvelle forme, avec sa source');
  const loaded = await sheet(WAGON);
  check('Default Wargear et Wargear Options, venus de BSData', loaded.sources.modelTypes === 'bsdata' && loaded.sources.wargearOptions === 'bsdata' && Boolean(wagon.modelTypes?.length && wagon.wargearOptions?.length));

  section('#393 : corriger une cellule de Default Wargear');
  {
    const draft = structuredClone(wagon);
    draft.modelTypes![0].defaultWargear.push({ weapon: "melee|Grabbin' Klaw", count: 1 });
    const saved = await save(WAGON, draft);
    const correction = readCorrections(dir, GS).find((c) => c.target === WAGON);
    check('une Correction de l\'Unit sur son Default Wargear', saved.status === 201 && Boolean(correction && 'modelTypes' in correction.patch), JSON.stringify(saved.body));
    check('elle garde ce que BSData disait', JSON.stringify(correction?.upstream?.modelTypes).includes("Crushin' Bulk") && !JSON.stringify(correction?.upstream?.modelTypes).includes('Grabbin'));
    await refresh();
    const after = (await sheet(WAGON)).value as Unit;
    check('la construction l\'applique', after.modelTypes![0].defaultWargear.some((w) => w.weapon === "melee|Grabbin' Klaw"));
    check('elle porte son repère d\'origine', (await sheet(WAGON)).marks.some((m) => m.path === '/modelTypes' && m.kind === 'correction'));
    check('c\'est une Pending Change', (await pending()).some((p) => p.kind === 'correction' && p.target === WAGON));
    await undoAll();
    check('l\'annuler rend le dépôt à son état publié', clean());
    const broken = structuredClone(wagon);
    broken.modelTypes![0].defaultWargear[0].count = 0;
    check('une valeur hors schéma est refusée, rien n\'est écrit', (await save(WAGON, broken)).status === 400 && clean());
    const ghost = structuredClone(wagon);
    ghost.modelTypes![0].defaultWargear.push({ weapon: 'ranged|Nothing', count: 1 });
    check('une Weapon absente du tableau est refusée', (await save(WAGON, ghost)).status === 400 && clean());
  }

  section('#394 : écrire les Wargear Options en phrases');
  {
    const draft = structuredClone(wagon);
    optionOf(draft, SHOOTAS).upTo = 3;
    draft.wargearOptions = draft.wargearOptions!.filter((o) => o.id !== BALL);
    draft.wargearOptions.push({ id: 'contrib-1', model: 'Battlewagon', who: { type: 'each' }, replaces: [], alternatives: [{ id: 'contrib-1-a', weapons: [{ weapon: 'ranged|Big Shoota', count: 1 }] }] });
    const saved = await save(WAGON, draft);
    const written = readContributions(dir, GS);
    const shootas = written.find((e) => e.target === `${WAGON}::wargear:${SHOOTAS}`);
    check('corriger une phrase traduite : une Contribution à son identifiant', saved.status === 201 && shootas?.wargearOption?.upTo === 3, JSON.stringify(saved.body));
    check('… qui retient ce que la traduction donnait', shootas?.wargearUpstream?.upTo === 4);
    check('retirer une phrase traduite : une Contribution qui la retire', written.find((e) => e.target === `${WAGON}::wargear:${BALL}`)?.wargearOption === null);
    check('ajouter une phrase : une Contribution qui la crée', written.find((e) => e.target === `${WAGON}::wargear:contrib-1`)?.wargearUpstream === null);
    await refresh();
    const after = (await sheet(WAGON)).value as Unit;
    check('la construction les applique', optionOf(after, SHOOTAS)?.upTo === 3 && !optionOf(after, BALL) && Boolean(optionOf(after, 'contrib-1')), JSON.stringify(after.wargearOptions?.map((o) => o.id)));
    check('chacune porte son repère « Contribution »', (await sheet(WAGON)).marks.filter((m) => m.path.startsWith('/wargearOptions/') && m.kind === 'contribution').length >= 2);
    check('ce sont des Pending Changes qu\'on annule', (await pending()).filter((p) => p.target.includes('::wargear:')).length === 3);
    await undoAll();
    check('annulées, le dépôt revient à son état publié', clean());

    const none = structuredClone(wagon);
    optionOf(none, SHOOTAS).alternatives = [];
    check('une phrase sans Wargear Alternative est refusée, rien n\'est écrit', (await save(WAGON, none)).status === 400 && clean());
    const ghost = structuredClone(wagon);
    optionOf(ghost, SHOOTAS).alternatives[0].weapons = [{ weapon: 'ranged|Nothing', count: 1 }];
    const refused = await save(WAGON, ghost);
    check('une Weapon absente du tableau est refusée, la partie fautive désignée', refused.status === 400 && (refused.body.findings ?? []).some((f) => f.includes('/wargearOptions/') && f.includes('Nothing')) && clean(), JSON.stringify(refused.body));
    const noEvery = structuredClone(wagon) as unknown as { wargearOptions: { who: unknown }[] };
    noEvery.wargearOptions[0].who = { type: 'per', models: 1 };
    check('« for every N » sans N est refusé', (await save(WAGON, noEvery)).status === 400 && clean());

    const billed = structuredClone(wagon);
    delete optionOf(billed, BALL).alternatives[0].wargearCost;
    const unlinked = await save(WAGON, billed);
    const link = readContributions(dir, GS).find((e) => e.target.endsWith(`|${BALL}`));
    check('délier le coût d\'une alternative : une Contribution à son adresse', unlinked.status === 201 && link?.wargearCost === null, JSON.stringify(link));
    await refresh();
    check('… que la construction applique', !optionOf((await sheet(WAGON)).value as Unit, BALL).alternatives[0].wargearCost);
    await undoAll();
  }

  section('#390 : une Unit dont on écrit les options sort du compteur');
  {
    const before = (await call<Unreleased>('/api/unreleased')).body.findings.filter((f) => f.kind === 'wargearToWrite');
    check('le Captain attend qu\'on écrive ses options', before.some((f) => f.sheet === CAPTAIN), JSON.stringify(before));
    const captain = structuredClone((await sheet(CAPTAIN)).value as Unit);
    captain.wargearOptions = [{ id: 'contrib-1', model: captain.modelTypes![0].name, who: { type: 'each' }, replaces: [{ weapon: captain.modelTypes![0].defaultWargear[0].weapon, count: 1 }], alternatives: [{ id: 'contrib-1-a', weapons: [{ weapon: 'ranged|Plasma pistol', count: 1 }] }] }];
    check('écrire l\'une de ses options', (await save(CAPTAIN, captain)).status === 201);
    await refresh();
    const after = (await call<Unreleased>('/api/unreleased')).body.findings.filter((f) => f.kind === 'wargearToWrite');
    check('il sort du compteur', !after.some((f) => f.sheet === CAPTAIN));
    await undoAll();
  }

  section('#395 : BSData change ce qu\'une phrase écrite à la main remplace');
  {
    const draft = structuredClone(wagon);
    optionOf(draft, SHOOTAS).upTo = 3;
    await save(WAGON, draft);
    git('add', '-A');
    git('commit', '-q', '-m', 'Phrase écrite à la main');
    await refresh();
    const state = () => ws.current?.contributions?.find((c) => c.target === `${WAGON}::wargear:${SHOOTAS}`);
    check('sans changement de BSData, aucun signalement', state()?.state === 'active', JSON.stringify(state()));
    // BSData passe à « up to 5 ».
    const file = join(snap, 'bsdata', 'Orks.json');
    const bump = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const n = node as { id?: string; value?: number };
      if (n.id === 'c1b6-f288-3559-d495') n.value = 5;
      for (const v of Object.values(node)) bump(v);
    };
    const catalogue = JSON.parse(readFileSync(file, 'utf8'));
    bump(catalogue);
    writeFileSync(file, JSON.stringify(catalogue));
    await refresh(true);
    check('BSData a changé : la Contribution est signalée', state()?.state === 'flagged' && /BSData changed/.test(state()?.note ?? ''), JSON.stringify(state()));
    check('sa phrase porte le repère', (await sheet(WAGON)).marks.some((m) => m.path.startsWith('/wargearOptions/') && m.state === 'flagged'));
    const board = (await call<Unreleased>('/api/unreleased')).body.findings;
    check('le tableau de bord la liste avec les « Contributions to review »', board.some((f) => f.kind === 'contribution' && f.sheet === WAGON));
    const resave = structuredClone((await sheet(WAGON)).value as Unit);
    optionOf(resave, SHOOTAS).upTo = 2;
    await save(WAGON, resave);
    await refresh();
    check('réenregistrer la phrase met l\'empreinte à jour et retire le signalement', state()?.state === 'active' && readContributions(dir, GS).find((e) => e.target === `${WAGON}::wargear:${SHOOTAS}`)?.wargearUpstream?.upTo === 5, JSON.stringify(state()));
  }
} finally {
  await gui.close();
}
