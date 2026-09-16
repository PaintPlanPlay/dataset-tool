/**
 * Point de test « construction d'une Dataset Release » : un instantané figé des
 * Upstream Sources entre, un Dataset sort. Aucun réseau.
 *
 *   npx tsx test/build.test.ts
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArmyFile, DatasetIndex, Unit } from '@paintplanplay/dataset-schema';
import { kindOfPath } from '@paintplanplay/dataset-schema';
import { validateDatasetDir, validateFile } from '@paintplanplay/dataset-schema/validate';
import { build } from '../src/build.ts';
import { readRegistry, toJson, writeDataset } from '../src/dataset.ts';
import { openSnapshot } from '../src/snapshot.ts';
import { check, fixture, section } from './check.ts';

const GS = 'wh40k-11e';
const snapshot = openSnapshot(fixture('snapshot'));

const first = await build({ snapshot });
const second = await build({ snapshot, ids: first.ids });

const army = (out: typeof first, id: string) => out.files.get(`${GS}/armies/${id}.json`) as ArmyFile | undefined;
const unit = (out: typeof first, armyId: string, name: string) => army(out, armyId)?.units.find((u) => u.name === name) as Unit;
const serialized = (out: typeof first) => [...out.files].map(([p, d]) => `${p}\n${toJson(d)}`).join('\n');

section('Construction : déterminisme et identifiants');
check('deux constructions du même instantané donnent un Dataset identique', serialized(first) === serialized(second));
check('le registre ne bouge pas à la seconde construction', toJson(first.ids) === toJson(second.ids));
const index = first.files.get(`${GS}/index.json`) as DatasetIndex;
check(
  'Armies rangées par Game System, avec un identifiant à nous',
  index.armies.map((a) => a.id).join(',') === 'adeptus-custodes,orks,orks-freebooterz',
  index.armies.map((a) => a.id).join(','),
);
check('une Unit garde son identifiant BSData', unit(first, 'orks', 'Boyz')?.id === 'u-boyz');

// Une Army déjà connue sous un autre identifiant le garde, même si son nom amont donnerait autre chose.
const legacy = structuredClone(first.ids);
legacy.armies['*'].find((e) => e.id === 'orks')!.id = 'greenskins';
const relabelled = await build({ snapshot, ids: legacy });
check(
  'un identifiant attribué survit aux constructions suivantes',
  Boolean(army(relabelled, 'greenskins')) && !army(relabelled, 'orks'),
);
check(
  'une entité nouvelle reçoit un identifiant neuf, sans reprendre un identifiant réservé',
  (await build({ snapshot, ids: { armies: { '*': [{ id: 'orks', keys: ['bsdata:Gone'], name: 'Gone' }] } } })).files.has(
    `${GS}/armies/orks-2.json`,
  ),
);

section('Construction : autorité du MFM sur BSData');
const boyz = unit(first, 'orks', 'Boyz');
check('le coût MFM remplace le coût BSData', boyz.points === 75, `${boyz.points}`);
check(
  'le désaccord de points est reporté, MFM retenu',
  first.conflicts.some((c) => c.id === 'u-boyz' && c.field === 'points' && c.kept === '75' && c.other.source === 'bsdata' && c.other.value === '90'),
);
check(
  'les seuils de réquisition du MFM sont publiés',
  JSON.stringify(boyz.pricing) ===
    JSON.stringify([
      { from: 1, to: 3, costs: [{ models: 10, points: 75 }, { models: 20, points: 160 }] },
      { from: 4, to: null, costs: [{ models: 10, points: 85 }, { models: 20, points: 170 }] },
    ]),
);
const mekGunz = unit(first, 'orks', 'Mek Gunz');
check(
  'le tarif par figurine du MFM est publié tel quel',
  mekGunz.pricing?.[0].costs.map((c) => `${c.models}:${c.points}`).join(',') === '1:45,2:90,3:135',
);
check('les paliers de taille suivent le MFM', JSON.stringify(mekGunz.costBrackets) === JSON.stringify([{ overModels: 1, points: 90 }, { overModels: 2, points: 135 }]));
const warboss = unit(first, 'orks', 'Warboss');
check('les rattachements Leader viennent du MFM', warboss.leaderTargets.join(',') === 'Boyz', warboss.leaderTargets.join(','));
check(
  'le désaccord de rattachement est reporté',
  first.conflicts.some((c) => c.id === 'u-warboss' && c.field === 'leaderTargets' && c.kept === 'Boyz' && c.other.value === 'Boyz, Nobz'),
);
check('l\'équipement payant vient du MFM', JSON.stringify(warboss.wargear) === JSON.stringify([{ item: 'Attack squig', points: 5 }]));
const guard = unit(first, 'adeptus-custodes', 'Custodian Guard');
check('une Unit absente du MFM garde son coût BSData, et est signalée', guard.points === 200 && !guard.pricing && first.unmatched.some((u) => u.id === 'u-guard'));
check('une Army sans faction MFM est signalée', first.armiesWithoutMfm.join() === 'Imperium - Adeptus Custodes');
const freeBoyz = unit(first, 'orks-freebooterz', 'Boyz');
check(
  'une sous-faction absente du MFM prend la faction du catalogue qu\'elle importe',
  freeBoyz?.points === 75 && freeBoyz.ally === true && index.armies.find((a) => a.id === 'orks-freebooterz')?.refs.mfm === 'orks',
);
check(
  'un désaccord sur une Unit alliée ne se signale qu\'une fois, sous l\'Army qui la possède',
  first.conflicts.filter((c) => c.id === 'u-boyz' && c.field === 'points').map((c) => c.army).join() === 'orks',
);

section('Construction : BSData pour le reste de l\'Unit');
check('profils et effectifs viennent de BSData', boyz.models.length === 2 && boyz.minModels === 10, `${boyz.minModels}-${boyz.maxModels}`);
check(
  'un groupe sans borne dont l\'unique figurine porte les siennes compte ces bornes (« 1-2 Nobz »)',
  boyz.maxModels === 21 && boyz.composition?.find((c) => c.name === 'Boss Nob')?.max === 2,
  `${boyz.minModels}-${boyz.maxModels}`,
);
check(
  'armes et mots-clés viennent de BSData',
  boyz.weapons.map((w) => w.name).sort().join(',') === 'Big choppa,Big shoota,Burna,Choppa,Slugga' && boyz.keywords.includes('Battleline'),
  boyz.weapons.map((w) => w.name).sort().join(','),
);
const host = boyz.optionGroups?.find((g) => g.id === 'g-boyz');
const special = boyz.optionGroups?.find((g) => g.id === 'g-special');
check(
  'un emplacement à une seule configuration est publié quand il héberge des armes spéciales',
  host?.pool === true && host.options.length === 1 && special?.pool === true && special.parent === 'g-boyz' && special.tree === host.tree,
  JSON.stringify(boyz.optionGroups?.map((g) => [g.id, g.parent, g.tree, g.options.length])),
);
check('une aptitude figure par son nom', warboss.abilities.map((a) => a.name).join(',') === 'Leader,Da Boss Fixture');

section('Construction : aucun texte amont dans la sortie');
const all = serialized(first);
check('aucun texte d\'aptitude BSData dans les fichiers', !/FIXTURE-RULES-TEXT/.test(all));
check('aucune clé de texte (text, description, ruleText)', !/"(text|description|ruleText)":/.test(all));

section('Construction : conformité au schéma');
let schemaErrors = 0;
for (const [path, data] of first.files) {
  const kind = kindOfPath(path.slice(0));
  const errors = kind ? validateFile(kind, data) : ['chemin inconnu'];
  schemaErrors += errors.length;
  if (errors.length) console.log(`    ${path} : ${errors.join(' ; ')}`);
}
check('chaque fichier produit est conforme au schéma', schemaErrors === 0);
const dir = mkdtempSync(join(tmpdir(), 'dataset-'));
try {
  writeDataset(dir, GS, first.files, first.ids);
  check('le Dataset écrit sur le disque se valide dossier par dossier', validateDatasetDir(dir, GS).length === 0);
  check('le registre se relit à l\'identique', toJson(readRegistry(dir, GS)) === toJson(first.ids));
  check('un fichier non conforme est rejeté', validateFile('army', { ...army(first, 'orks'), units: [{ name: 'x' }] }).length > 0);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
