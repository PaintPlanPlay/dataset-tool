/**
 * La nouvelle interface, côté API (issue #81 et suivantes) : lire une fiche avec
 * sa provenance, valider un brouillon, l'enregistrer en Corrections et
 * Contributions, les Pending Changes, la liste des Corrections, l'autocomplétion
 * et l'état global. Sur un dépôt de Dataset de fixtures, versionné par git comme
 * le vrai : c'est git qui dit ce qui n'est pas encore proposé.
 *
 *   npx tsx test/sheets.test.ts
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AuthoredEffect } from '../src/authored.ts';
import type { Correction } from '../src/corrections/files.ts';
import type { Overview } from '../src/gui/overview.ts';
import type { PendingChange } from '../src/gui/pending.ts';
import type { CorrectionItem, DraftCheck, Sheet, Suggestions } from '../src/gui/sheets.ts';
import { startGui } from '../src/gui/server.ts';
import { openWorkspace } from '../src/gui/workspace.ts';
import { check, fixture, section } from './check.ts';

const dir = mkdtempSync(join(tmpdir(), 'dataset-sheets-'));
const snap = mkdtempSync(join(tmpdir(), 'snapshot-sheets-'));
cpSync(fixture('dataset'), dir, { recursive: true });
cpSync(fixture('snapshot'), snap, { recursive: true });
const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
git('init', '-q', '-b', 'main');
git('config', 'user.email', 'test@example.invalid');
git('config', 'user.name', 'Test');
git('add', '-A');
git('commit', '-q', '-m', 'Dataset de fixtures');

let pullRequest: { url: string; state: string } | null = null;
/** Ce que le dépôt publié du Dataset dit de ses références ; `null` : on ne le sait pas (hors ligne). */
let remote: Record<string, string> | null = null;
const snapshotHeads = Object.fromEntries((JSON.parse(readFileSync(join(snap, 'sources.json'), 'utf8')) as { id: string; commit: string }[]).map((s) => [s.id, s.commit]));
const ws = await openWorkspace({ datasetDir: dir, snapshotDir: snap, allowPush: true });
const gui = await startGui(ws, {
  port: 0,
  probe: { upstreamHeads: async () => snapshotHeads, publishRight: () => null, pullRequest: () => pullRequest, remoteRefs: async () => remote },
});

const call = async <T>(path: string, body?: unknown) => {
  const res = await fetch(new URL(path, gui.url), body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as T };
};
const refresh = () => call('/api/refresh', {});
const sheet = async (target: string) => (await call<Sheet>(`/api/sheet?target=${encodeURIComponent(target)}`)).body;
const save = (target: string, draft: unknown, reason = 'Test du parcours Save.') =>
  call<{ files: { path: string; kind: string }[]; error?: string; findings?: string[] }>('/api/sheet/save', { target, draft, reason });
const pending = async () => (await call<PendingChange[]>('/api/pending')).body;
const readJson = <T>(path: string) => JSON.parse(readFileSync(join(dir, path), 'utf8')) as T;
const clone = <T>(v: T): T => structuredClone(v);
type UnitValue = {
  name: string;
  models: { name: string; T: number; M: string }[];
  composition: { name: string; min: number; max: number }[];
  weapons: { name: string; kind: string; profiles: { name: string; S: number; range: string; rangeInches: number; keywords: string[] }[] }[];
  abilities: { name: string; summary?: string; effect?: unknown }[];
  wargear?: { item: string; points: number }[];
  pricing?: { from: number; to: number | null; costs: { models: number; points: number }[] }[];
  leaderTargets: string[];
  keywords: string[];
  optionGroups?: { id: string; tree: string; parent: string; slot: string; options: { id: string; name: string; weapons: string[]; maxCarriers: number; perModels?: number; isDefault: boolean }[] }[];
};

try {
  section('Fiche : lecture avec provenance');
  const boss = await sheet('u-warboss');
  check('une fiche porte la source de chaque section', boss.sources.weapons === 'bsdata' && boss.sources.pricing === 'mfm' && boss.sources.abilities === 'project', JSON.stringify(boss.sources));
  const pointsMark = boss.marks.find((m) => m.path === '/points');
  check(
    'une valeur changée par une Correction publiée est marquée : amont, nouvelle valeur, raison',
    pointsMark?.kind === 'correction' && pointsMark.upstream === 70 && pointsMark.value === 80 && pointsMark.reason.length > 0,
    JSON.stringify(boss.marks),
  );

  section('#87 : valider un brouillon, sans rien écrire');
  const warboss = boss.value as UnitValue;
  const broken = clone(warboss) as unknown as { models: { T: unknown }[]; abilities: { summary?: string }[] };
  broken.models[0].T = 'tough';
  broken.abilities[1].summary = 'Each time this model makes an attack, add 1 to the Hit roll.';
  const checked = (await call<DraftCheck>('/api/sheet/validate', { target: 'u-warboss', draft: broken })).body;
  check('erreur de schéma par chemin de champ', checked.errors.some((e) => e.path === '/models/0/T'), JSON.stringify(checked.errors));
  check('alerte « texte de règles » par chemin de champ', checked.warnings.some((w) => w.path === '/abilities/1/summary'), JSON.stringify(checked.warnings));
  check('valider n\'écrit rien', git('status', '--porcelain') === '');

  section('#87 : enregistrer une fiche');
  const refused = await save('u-warboss', broken);
  check('un brouillon invalide est refusé, le champ fautif désigné, rien n\'est écrit', refused.status === 400 && (refused.body.findings ?? []).some((f) => f.includes('/models/0/T')) && git('status', '--porcelain') === '');
  const prose = await save('u-warboss', warboss, 'Each time this unit fights, add 1 to the Hit roll and re-roll the wound roll.');
  check('une raison en prose de règles est refusée', prose.status === 400);

  const twoSources = clone(warboss);
  twoSources.models[0].T = 6;
  twoSources.wargear = [{ item: 'Attack squig', points: 10 }];
  const saved = await save('u-warboss', twoSources, 'Le codex relève l\'Endurance et le squig.');
  const written = saved.body.files.map((f) => readJson<Correction>(f.path));
  check(
    'deux cibles de sources différentes : deux Corrections, même raison, noms générés',
    saved.status === 201 && written.length === 2 &&
      written.some((c) => c.target === 'u-warboss::model:Warboss' && c.source === 'bsdata' && (c.patch as { T: number }).T === 6) &&
      written.some((c) => c.target === 'u-warboss' && c.source === 'mfm' && 'wargear' in c.patch) &&
      written.every((c) => c.reason === 'Le codex relève l\'Endurance et le squig.') &&
      saved.body.files.every((f) => f.path.startsWith('corrections/wh40k-11e/orks/')),
    JSON.stringify(saved.body),
  );

  for (const p of await pending()) await call('/api/pending/undo', { id: p.id });
  const tougher = clone(warboss);
  tougher.models[0].T = 7;
  const oneFile = await save('u-warboss', tougher);
  check(
    'changer une caractéristique n\'écrit qu\'elle : les mots-clés que BSData écrit à sa façon (« ONE SHOT ») restent tels quels',
    oneFile.body.files.length === 1 && oneFile.body.files[0].path.includes('model'),
    JSON.stringify(oneFile.body.files),
  );
  for (const p of await pending()) await call('/api/pending/undo', { id: p.id });
  // Les Pending Changes qui suivent partent de l'enregistrement à deux sources.
  await save('u-warboss', twoSources, 'Le codex relève l\'Endurance et le squig.');

  section('#87 : Pending Changes');
  let list = await pending();
  check('ce qui est enregistré et pas encore proposé est une Pending Change', saved.body.files.every((f) => list.some((p) => p.path === f.path && p.action === 'added' && p.sheet === 'u-warboss')), JSON.stringify(list));
  const undone = list.find((p) => p.path === saved.body.files[0].path)!;
  await call('/api/pending/undo', { id: undone.id });
  list = await pending();
  check('annuler une Pending Change la retire, et l\'autre reste', !existsSync(join(dir, undone.path)) && list.length === 1, JSON.stringify(list));
  await call('/api/pending/undo', { id: list[0].id });
  check('tout annulé : le dépôt revient à l\'état publié', git('status', '--porcelain') === '');

  section('#88 : Corrections (n)');
  const ofBoss = (await call<CorrectionItem[]>('/api/corrections?sheet=u-warboss')).body;
  const all = (await call<CorrectionItem[]>('/api/corrections')).body;
  const filtered = (await call<CorrectionItem[]>('/api/corrections?q=mek')).body;
  check('les Corrections d\'une fiche, avec leur état', ofBoss.length === 2 && ofBoss.every((c) => c.sheet === 'u-warboss') && ofBoss.some((c) => c.state === 'active'), JSON.stringify(ofBoss));
  check('celles de tout le Dataset, filtrables', all.length === 4 && filtered.length === 1 && filtered[0].path.endsWith('mek-gunz-attacks.json'));
  const points = ofBoss.find((c) => c.path.endsWith('warboss-points.json'))!;
  await call('/api/corrections/delete', { path: points.path });
  list = await pending();
  const deletion = list.find((p) => p.path === points.path);
  check('supprimer une Correction crée une Pending Change de suppression', deletion?.action === 'deleted' && !existsSync(join(dir, points.path)));
  await call('/api/pending/undo', { id: deletion!.id });
  check('l\'annuler la restaure', existsSync(join(dir, points.path)) && git('status', '--porcelain') === '');

  section('#90 : figurines et composition');
  const withModel = clone(warboss);
  withModel.models.push({ ...withModel.models[0], name: 'Grot Oiler' });
  withModel.composition = [...withModel.composition, { name: 'Grot Oiler', min: 0, max: 1 }];
  const added = await save('u-warboss', withModel);
  const addedFiles = added.body.files.map((f) => readJson<Correction>(f.path));
  check(
    'ajouter une figurine : Correction BSData __add sur la figurine, et la composition',
    addedFiles.some((c) => c.target === 'u-warboss::model:Grot Oiler' && c.patch.__add === true && c.source === 'bsdata') &&
      addedFiles.some((c) => c.target === 'u-warboss' && 'composition' in c.patch),
    JSON.stringify(addedFiles),
  );
  await refresh();
  const afterAdd = (await sheet('u-warboss')).value as UnitValue & { maxModels: number };
  const without = clone(afterAdd);
  without.models = without.models.filter((m) => m.name !== 'Warboss');
  without.composition = without.composition.filter((m) => m.name !== 'Warboss');
  const removed = await save('u-warboss', without);
  check(
    'retirer une figurine : Correction __delete',
    removed.body.files.map((f) => readJson<Correction>(f.path)).some((c) => c.target === 'u-warboss::model:Warboss' && c.patch.__delete === true),
    JSON.stringify(removed.body),
  );
  for (const p of await pending()) await call('/api/pending/undo', { id: p.id });

  section('#91 : grille de prix');
  const boyz = (await sheet('u-boyz')).value as UnitValue;
  const repriced = clone(boyz);
  repriced.pricing![0].costs[0].points = 70;
  const priced = await save('u-boyz', repriced);
  const pricing = priced.body.files.map((f) => readJson<Correction>(f.path));
  check('modifier un coût : Correction MFM sur pricing', pricing.length === 1 && pricing[0].source === 'mfm' && 'pricing' in pricing[0].patch && pricing[0].target === 'u-boyz', JSON.stringify(pricing));
  await refresh();
  const boyzAfter = (await sheet('u-boyz')).value as { points: number };
  check('les points de base suivent la grille, en lecture seule', boyzAfter.points === 70);
  for (const p of await pending()) await call('/api/pending/undo', { id: p.id });

  section('#92 : tags et rattachements');
  const suggest = (await call<Suggestions>('/api/suggest?army=orks&unit=u-warboss')).body;
  check(
    'autocomplétion : Keywords, Faction Keywords, Army Rules et Units de l\'Army',
    suggest.keywords.includes('Infantry') && suggest.factionKeywords.includes('Orks') && suggest.armyRules.includes('Waaagh!') && suggest.units.some((u) => u.name === 'Boyz') &&
      suggest.weapons.includes('ranged|Kombi-rokkit'),
    JSON.stringify(suggest),
  );
  const ghost = clone(warboss);
  ghost.leaderTargets = [...ghost.leaderTargets, 'Custodian Guard'];
  const ghostSave = await save('u-warboss', ghost);
  check('un Leader qui n\'est pas une Unit de l\'Army est refusé', ghostSave.status === 400 && git('status', '--porcelain') === '', JSON.stringify(ghostSave.body));
  const leads = clone(warboss);
  leads.leaderTargets = [...leads.leaderTargets, 'Mek Gunz'];
  leads.keywords = [...leads.keywords, 'Mob'];
  const leadSave = await save('u-warboss', leads);
  const leadFiles = leadSave.body.files.map((f) => readJson<Correction>(f.path));
  check(
    'ajouter un rattachement Leader : Correction MFM __add ; un Keyword : Correction BSData',
    leadFiles.some((c) => c.target === 'u-warboss::attachment:leader|Mek Gunz' && c.source === 'mfm' && c.patch.__add === true) &&
      leadFiles.some((c) => c.target === 'u-warboss' && c.source === 'bsdata' && (c.patch.keywords as string[]).includes('Mob')),
    JSON.stringify(leadFiles),
  );
  for (const p of await pending()) await call('/api/pending/undo', { id: p.id });

  section('#93 : Weapons et Weapon Profiles');
  const armed = clone(warboss);
  const profile = (name: string, S: number) => ({ name, range: '18"', rangeInches: 0, A: '2', skill: 5, S, AP: 0, D: '1', keywords: ['Rapid Fire 1'] });
  armed.weapons.push({ name: 'Kombi-skorcha', kind: 'ranged', profiles: [profile('Skorcha', 5), profile('Shoota', 4)] });
  armed.weapons[0].profiles[0].S = 8;
  const armedSave = await save('u-warboss', armed);
  const armedFiles = armedSave.body.files.map((f) => readJson<Correction>(f.path));
  const addWeapon = armedFiles.find((c) => c.target === 'u-warboss::weapon:ranged|Kombi-skorcha');
  check(
    'ajouter une Weapon à deux profils : une Correction BSData qui l\'ajoute entière',
    addWeapon?.patch.__add === true && (addWeapon.patch.profiles as unknown[]).length === 2 && addWeapon.source === 'bsdata',
    JSON.stringify(armedFiles),
  );
  const firstRef = `${warboss.weapons[0].kind}|${warboss.weapons[0].name}`;
  check('modifier un profil : une Correction sur cette Weapon', armedFiles.some((c) => c.target === `u-warboss::weapon:${firstRef}` && Array.isArray(c.patch.profiles)));
  for (const p of await pending()) await call('/api/pending/undo', { id: p.id });
  const keyworded = clone(warboss);
  keyworded.weapons[0].profiles[0].keywords = [...keyworded.weapons[0].profiles[0].keywords, 'rapid fire 2', 'Anti-Vehicle 4'];
  const kwSave = await save('u-warboss', keyworded);
  const kwFile = kwSave.body.files.map((f) => readJson<Correction>(f.path)).find((c) => Array.isArray(c.patch.profiles));
  const kwWritten = (kwFile?.patch.profiles as { keywords: string[] }[] | undefined)?.[0].keywords ?? [];
  check('un mot-clé d\'arme des règles s\'écrit sous sa forme juste, valeur comprise', kwWritten.includes('Rapid Fire 2') && kwWritten.includes('Anti-Vehicle 4+'), JSON.stringify(kwWritten));
  for (const p of await pending()) await call('/api/pending/undo', { id: p.id });
  const invented = clone(warboss);
  invented.weapons[0].profiles[0].keywords = [...invented.weapons[0].profiles[0].keywords, 'Shoots Real Good'];
  check('un mot-clé d\'arme hors des règles est refusé', (await save('u-warboss', invented)).status === 400 && git('status', '--porcelain') === '');
  const legs = clone(warboss);
  legs.models[0].M = '5';
  const legsSave = await save('u-warboss', legs);
  check('un Mouvement saisi sans « " » s\'écrit avec', legsSave.body.files.map((f) => readJson<Correction>(f.path)).some((c) => c.patch.M === '5"'), JSON.stringify(legsSave.body));
  for (const p of await pending()) await call('/api/pending/undo', { id: p.id });

  section('#94 : groupes d\'options');
  const opts = clone(warboss);
  const group = opts.optionGroups![0];
  group.options.push({ id: 'new-option', name: 'Nob w/ Kombi-skorcha', weapons: ['ranged|Kombi-skorcha'], maxCarriers: 1, isDefault: false });
  const missingWeapon = await save('u-warboss', opts);
  check('une option qui référence une Weapon absente de l\'Unit est refusée', missingWeapon.status === 400 && git('status', '--porcelain') === '', JSON.stringify(missingWeapon.body));
  group.options[group.options.length - 1] = { id: 'new-option', name: 'One in five', weapons: ['ranged|Slugga'], maxCarriers: 1, perModels: 5, isDefault: false };
  const optSave = await save('u-warboss', opts);
  const optFile = optSave.body.files.map((f) => readJson<Correction>(f.path)).find((c) => 'optionGroups' in c.patch);
  const savedGroup = (optFile?.patch.optionGroups as UnitValue['optionGroups'])?.[0];
  check(
    'ajouter une option « 1 pour 5 figurines » : Correction attendue sur optionGroups, tree/parent/slot gardés',
    savedGroup?.options.some((o) => o.perModels === 5) === true && savedGroup.tree === group.tree && savedGroup.parent === group.parent && savedGroup.slot === group.slot,
    JSON.stringify(optFile),
  );
  for (const p of await pending()) await call('/api/pending/undo', { id: p.id });
  const unarmed = clone(warboss);
  unarmed.weapons = unarmed.weapons.filter((w) => !(w.kind === 'ranged' && w.name === 'Slugga'));
  const unarmedSave = await save('u-warboss', unarmed);
  check('retirer une Weapon qu\'une option équipe encore est refusé', unarmedSave.status === 400 && git('status', '--porcelain') === '', JSON.stringify(unarmedSave.body) + git('status', '--porcelain'));
  for (const p of await pending()) await call('/api/pending/undo', { id: p.id });

  section('#95 : Abilities et Contributions');
  const summarised = clone(warboss);
  summarised.abilities[1].summary = '+1 to wound while leading.';
  const summarySave = await save('u-warboss', summarised);
  const effects = existsSync(join(dir, 'authored/wh40k-11e/effects.json')) ? readJson<AuthoredEffect[]>('authored/wh40k-11e/effects.json') : [];
  check(
    'un résumé modifié produit une Contribution, pas une Correction, avec l\'empreinte de l\'amont',
    summarySave.status === 201 && summarySave.body.files.every((f) => f.kind === 'contribution') &&
      effects.some((e) => e.target === 'u-warboss::ability:Da Boss Fixture' && e.summary === '+1 to wound while leading.' && typeof e.upstream === 'string'),
    JSON.stringify(summarySave.body),
  );
  list = await pending();
  check('une Contribution est aussi une Pending Change', list.some((p) => p.kind === 'contribution' && p.target === 'u-warboss::ability:Da Boss Fixture'));
  for (const p of list) await call('/api/pending/undo', { id: p.id });
  const proseSummary = clone(warboss);
  proseSummary.abilities[1].summary = 'Each time this model fights, add 1 to the Hit roll.';
  check('un résumé en prose est refusé', (await save('u-warboss', proseSummary)).status === 400);
  const newAbility = clone(warboss);
  newAbility.abilities.push({ name: 'Ere We Go Fixture', summary: 'Advance and charge.' });
  const abilitySave = await save('u-warboss', newAbility);
  check(
    'ajouter une Ability : sa présence en Correction, son résumé en Contribution',
    abilitySave.body.files.some((f) => f.kind === 'correction' && readJson<Correction>(f.path).patch.__add === true) && abilitySave.body.files.some((f) => f.kind === 'contribution'),
    JSON.stringify(abilitySave.body),
  );
  for (const p of await pending()) await call('/api/pending/undo', { id: p.id });

  section('#96 : un Effect imbriqué');
  const nested = clone(warboss);
  nested.abilities[1].effect = {
    type: 'conditional',
    condition: { type: 'phase-is', parameters: { phase: 'fight' } },
    effect: { type: 'stat-modifier', target: 'unit', modifier: { stat: 'A', operation: 'add', value: 1 } },
  };
  const nestedSave = await save('u-warboss', nested);
  const nestedEntry = readJson<AuthoredEffect[]>('authored/wh40k-11e/effects.json').find((e) => e.target === 'u-warboss::ability:Da Boss Fixture');
  check('un Effect imbriqué s\'enregistre en Contribution valide', nestedSave.status === 201 && (nestedEntry?.effect as { type: string }).type === 'conditional', JSON.stringify(nestedSave.body));
  for (const p of await pending()) await call('/api/pending/undo', { id: p.id });
  const halfBuilt = clone(warboss);
  halfBuilt.abilities[1].effect = { type: 'choice', options: [] };
  const live = (await call<DraftCheck>('/api/sheet/validate', { target: 'u-warboss', draft: halfBuilt })).body;
  check(
    'un Effect invalide est signalé sur le nœud fautif, sans les exigences des autres types de nœud',
    live.errors.some((e) => e.path === '/abilities/1/effect/options') && !live.errors.some((e) => /'(target|steps|mode)'/.test(e.message)),
    JSON.stringify(live.errors),
  );

  section('#97 : Detachment, Stratagem, Core');
  const horde = await sheet('orks::detachment:war-horde');
  const hordeDraft = clone(horde.value) as { dp: number; enhancements: { id: string; effect?: unknown; leaderTo?: string[] }[] };
  hordeDraft.dp = 2;
  hordeDraft.enhancements[0].effect = { type: 'roll-modifier', target: 'unit', modifier: { roll: 'wound', operation: 'add', value: 1 } };
  const hordeSave = await save('orks::detachment:war-horde', hordeDraft);
  check(
    'le coût en DP d\'un Detachment : Correction ; l\'Effect d\'une Enhancement : Contribution',
    hordeSave.body.files.some((f) => f.kind === 'correction' && readJson<Correction>(f.path).patch.dp === 2) &&
      hordeSave.body.files.some((f) => f.kind === 'contribution'),
    JSON.stringify(hordeSave.body),
  );
  const strangers = clone(horde.value) as { enhancements: { leaderTo?: string[] }[] };
  strangers.enhancements[0].leaderTo = ['Custodian Guard'];
  check('les restrictions Leader d\'une Enhancement n\'acceptent que des Units existantes', (await save('orks::detachment:war-horde', strangers)).status === 400);
  for (const p of await pending()) await call('/api/pending/undo', { id: p.id });
  const newRule = clone(horde.value) as { rules: { id: string; name: string }[] };
  newRule.rules.push({ id: 'new-rule', name: 'New Rule' });
  check('ajouter une Detachment Rule est refusé plutôt qu\'ignoré en silence', (await save('orks::detachment:war-horde', newRule)).status === 400 && git('status', '--porcelain') === '');
  for (const p of await pending()) await call('/api/pending/undo', { id: p.id });

  const core = await sheet('core');
  const coreDraft = clone(core.value) as { battleSizes: { points: number; name: string; detachmentPoints: number; enhancementLimit: number; unitLimit: number }[]; stratagems: { cp: number }[] };
  coreDraft.battleSizes = [{ points: 1000, name: 'Incursion', detachmentPoints: 2, enhancementLimit: 2, unitLimit: 2 }];
  coreDraft.stratagems[0].cp = 2;
  const coreSave = await save('core', coreDraft);
  check(
    'une Battle Size et un Stratagem Core s\'enregistrent',
    coreSave.status === 201 && existsSync(join(dir, 'authored/wh40k-11e/battle-sizes.json')) &&
      coreSave.body.files.some((f) => f.kind === 'correction' && readJson<Correction>(f.path).target === 'core::stratagem:command-re-roll'),
    JSON.stringify(coreSave.body),
  );
  for (const p of await pending()) await call('/api/pending/undo', { id: p.id });
  await call('/api/proposals/accept', { target: 'u-boyz::ability:Mob Fixture' });
  const accepted = readJson<AuthoredEffect[]>('authored/wh40k-11e/effects.json').find((e) => e.target === 'u-boyz::ability:Mob Fixture');
  check('une suggestion acceptée mémorise l\'empreinte de l\'amont', typeof accepted?.upstream === 'string');
  for (const p of await pending()) await call('/api/pending/undo', { id: p.id });

  section('#89 : état global vivant');
  let o = (await call<Overview>('/api/overview')).body;
  check('sans Pending Change, Save & Build est grisé', !o.buttons.build.enabled && o.pending === 0, JSON.stringify(o.buttons.build));
  check('désaccords entre sources et suggestions d\'Effect comptés', o.disagreements > 0 && o.suggestions > 0, `${o.disagreements} / ${o.suggestions}`);
  pullRequest = { url: 'https://github.com/PaintPlanPlay/dataset/pull/7', state: 'OPEN' };
  o = (await call<Overview>('/api/overview')).body;
  check('la PR ouverte, lien et état', o.pullRequest?.url.endsWith('/pull/7') === true && o.pullRequest.state === 'OPEN');

  const again = clone((await sheet('u-warboss')).value as UnitValue);
  again.models[0].T = 7;
  await save('u-warboss', again);
  o = (await call<Overview>('/api/overview')).body;
  check('une Pending Change : Save & Build actif, Propose attend un build qui passe le contrôle', o.buttons.build.enabled && !o.buttons.propose.enabled, JSON.stringify(o.buttons.propose));
  await call('/api/jobs/build', {});
  for (let i = 0; i < 120; i++) {
    const job = (await call<{ job: { state: string } | null }>('/api/jobs')).body.job;
    if (job && job.state !== 'running') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const buildJob = (await call<{ job: { state: string }; lines: string[] }>('/api/jobs')).body;
  o = (await call<Overview>('/api/overview')).body;
  check('après un build qui passe le contrôle, Propose my change est actif', buildJob.job.state === 'ok' && o.buttons.propose.enabled, `${buildJob.job.state} ${buildJob.lines.slice(-3).join(' | ')} ${JSON.stringify(o.buttons.propose)}`);
  const later = clone((await sheet('u-warboss')).value as UnitValue);
  later.models[0].T = 8;
  await save('u-warboss', later);
  o = (await call<Overview>('/api/overview')).body;
  check('une modification après le build le rend à refaire', !o.buttons.propose.enabled);

  // Publier : seulement quand une PR fusionnée n'est pas encore publiée.
  for (const p of await pending()) await call('/api/pending/undo', { id: p.id });
  git('checkout', '-q', '--', '.');
  git('clean', '-qfd', '--', 'wh40k-11e');
  writeFileSync(
    join(dir, 'manifest.json'),
    JSON.stringify({ schemaVersion: '1.0.0', gameSystem: 'wh40k-11e', releaseUrl: 'https://cdn.example/{tag}/', current: 'mfm-1-4', offered: ['mfm-1-4'], dataslates: [{ id: 'mfm-1-4', name: 'MFM 1.4', mfmVersion: '1.4', frozen: false, releases: [{ tag: 'r1', number: 1, publishedAt: '2026-09-01T00:00:00.000Z', schemaVersion: '1.0.0' }], latest: 'r1' }] }),
  );
  git('add', '-A');
  git('commit', '-q', '-m', 'Release r1');
  git('tag', 'r1');
  o = (await call<Overview>('/api/overview')).body;
  check('rien de fusionné depuis la dernière Release : Publish Release grisé', o.buttons.release.visible && !o.buttons.release.enabled, JSON.stringify(o.buttons.release));
  writeFileSync(join(dir, 'corrections/wh40k-11e/orks/merged.json'), JSON.stringify({ target: 'u-boyz', source: 'mfm', patch: { points: 1 }, reason: 'Merged.' }));
  git('add', '-A');
  git('commit', '-q', '-m', 'Merge pull request #7');
  o = (await call<Overview>('/api/overview')).body;
  check('une PR fusionnée pas encore publiée : Publish Release actif', o.buttons.release.enabled, JSON.stringify(o.buttons.release));

  section('#89 : à jour, c\'est aussi le dossier du Dataset');
  const head = git('rev-parse', 'HEAD');
  const tagged = git('rev-parse', 'r1^{commit}');
  remote = { 'refs/heads/main': head, 'refs/tags/r1^{}': tagged };
  o = (await call<Overview>('/api/overview')).body;
  check('sources et dossier au dernier commit : à jour, Update data grisé', o.upToDate === true && !o.buttons.update.enabled, JSON.stringify(o.buttons.update));
  remote = { 'refs/heads/main': 'f'.repeat(40), 'refs/tags/r1^{}': tagged };
  o = (await call<Overview>('/api/overview')).body;
  check(
    'le dépôt publié a avancé (une PR fusionnée) : pas à jour, Update data actif',
    o.upToDate === false && o.buttons.update.enabled && o.dataset.behind === true,
    JSON.stringify({ upToDate: o.upToDate, dataset: o.dataset }),
  );
  check('et Publish Release s\'ouvre, même avant d\'avoir tiré main', o.buttons.release.enabled, JSON.stringify(o.buttons.release));
  git('checkout', '-q', '-b', 'dataset/some-proposal');
  remote = { 'refs/heads/main': head, 'refs/tags/r1^{}': tagged };
  o = (await call<Overview>('/api/overview')).body;
  check('resté sur la branche d\'une proposition : pas à jour, Update data ramène sur main', o.upToDate === false && o.buttons.update.enabled && o.dataset.branch === 'dataset/some-proposal');
  git('checkout', '-q', 'main');
  remote = { 'refs/heads/main': tagged, 'refs/tags/r1^{}': tagged };
  o = (await call<Overview>('/api/overview')).body;
  check('rien de fusionné depuis la Release, d\'après le dépôt publié : Publish grisé', !o.buttons.release.enabled && /nothing merged/.test(o.buttons.release.reason ?? ''));
  remote = null;

  section('#89 : une mise à jour réévalue les Pending Changes');
  const boyzNow = clone((await sheet('u-boyz')).value as UnitValue);
  boyzNow.keywords = [...boyzNow.keywords, 'Mob'];
  await save('u-boyz', boyzNow);
  // L'amont rattrape la Correction : BSData donne désormais le Keyword « Mob » aux Boyz.
  const orksFile = join(snap, 'bsdata', 'Orks.json');
  writeFileSync(orksFile, readFileSync(orksFile, 'utf8').replace('{ "name": "Boyz" }, { "name": "Faction: Orks" }', '{ "name": "Boyz" }, { "name": "Mob" }, { "name": "Faction: Orks" }'));
  await refresh();
  const stale = (await pending()).find((p) => p.target === 'u-boyz');
  check('une Pending Change devenue périmée est signalée comme telle', stale?.state === 'stale', JSON.stringify(stale));
} finally {
  await gui.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(snap, { recursive: true, force: true });
}
