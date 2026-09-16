/**
 * Point de test « construction d'une Dataset Release » : Battle Sizes, cibles par
 * défaut et List d'exemple, écrites par le projet, passent dans core.json
 * rattachées aux Units construites.
 *
 *   npx tsx test/authored.test.ts
 */
import type { CoreFile } from '@paintplanplay/dataset-schema';
import { validateFile } from '@paintplanplay/dataset-schema/validate';
import type { AuthoredCore } from '../src/authored.ts';
import { build } from '../src/build.ts';
import { openSnapshot } from '../src/snapshot.ts';
import { check, fixture, section } from './check.ts';

const authored: AuthoredCore = {
  battleSizes: [
    { points: 2000, name: 'Strike Force', detachmentPoints: 3, enhancementLimit: 4, unitLimit: 3 },
    { points: 1000, name: 'Incursion', detachmentPoints: 2, enhancementLimit: 2, unitLimit: 2 },
  ],
  referenceTargets: [
    { army: 'orks', unit: 'Boyz', models: 99 },
    { army: 'adeptus-custodes', unit: 'Custodian Guard', models: 5 },
    { army: 'orks', unit: 'Unit That Never Was', models: 1 },
  ],
  sampleList: {
    army: 'orks',
    name: 'Fixture List',
    detachment: 'War Horde',
    battleSize: 1000,
    units: [
      { unit: 'Warboss', section: 'CHARACTERS', warlord: true, wargear: [{ name: 'Power klaw', count: 1 }] },
      { unit: 'Boyz', section: 'BATTLELINE', models: [{ name: 'Boy', count: 10, wargear: [{ name: 'Choppa', count: 10 }] }] },
    ],
  },
};

const out = await build({ snapshot: openSnapshot(fixture('snapshot')), authored });
const core = out.files.get('wh40k-11e/core.json') as CoreFile;
const orks = (out.files.get('wh40k-11e/armies/orks.json') as { units: { id: string; name: string; maxModels: number; points: number }[] }).units;
const boyz = orks.find((u) => u.name === 'Boyz')!;

section('Écrit par le projet : Battle Sizes, cibles, List d\'exemple');
check('Battle Sizes publiées, rangées par points', core.battleSizes.map((b) => b.points).join() === '1000,2000');
check(
  'cibles par défaut : rattachées par identifiant, effectif borné par la datasheet',
  core.referenceTargets.length === 2 &&
    core.referenceTargets[0].unitId === boyz.id &&
    core.referenceTargets[0].models === boyz.maxModels,
  JSON.stringify(core.referenceTargets),
);
check('une Unit introuvable est signalée, pas publiée', out.unresolvedAuthored.join() === 'orks › Unit That Never Was');
check(
  'List d\'exemple : Units rattachées, coûts tirés du Dataset, total recalculé',
  core.sampleList?.units.map((u) => u.name).join() === 'Warboss,Boyz' &&
    core.sampleList.units[1].points === boyz.points &&
    core.sampleList.points === core.sampleList.units.reduce((n, u) => n + u.points, 0),
  JSON.stringify(core.sampleList),
);
check('core.json conforme au schéma', validateFile('core', core).length === 0, JSON.stringify(validateFile('core', core)));
const bare = await build({ snapshot: openSnapshot(fixture('snapshot')) });
const bareCore = bare.files.get('wh40k-11e/core.json') as CoreFile;
check('sans fichiers écrits par le projet : listes vides, pas de List d\'exemple', bareCore.battleSizes.length === 0 && bareCore.referenceTargets.length === 0 && !bareCore.sampleList);

section('Écrit par le projet : Effects et résumés');
const withEffects = await build({
  snapshot: openSnapshot(fixture('snapshot')),
  authored: {
    battleSizes: [],
    referenceTargets: [],
    effects: [
      { target: 'u-boyz::ability:Mob Fixture', effect: { type: 'feel-no-pain', target: 'unit', modifier: { threshold: 6 } }, reason: 'Test.' },
      { target: 'u-warboss::ability:Da Boss Fixture', summary: 'Short line.', reason: 'Test.' },
      { target: 'u-warboss::ability:Leader', effect: { type: 'roll-modifier' }, reason: 'Hors format.' },
      { target: 'u-nobody::ability:Nothing', summary: 'Short.', reason: 'Test.' },
    ],
  },
});
const orksWith = withEffects.files.get('wh40k-11e/armies/orks.json') as { units: { id: string; abilities: { name: string; effectSource?: string; summary?: string; effect?: { type: string } }[] }[] };
const ab = (unit: string, name: string) => orksWith.units.find((u) => u.id === unit)!.abilities.find((a) => a.name === name)!;
check('un Effect écrit par le projet remplace celui de l\'amont', ab('u-boyz', 'Mob Fixture').effectSource === 'project' && ab('u-boyz', 'Mob Fixture').effect?.type === 'feel-no-pain');
check('un résumé seul s\'ajoute sans toucher à l\'Effect', ab('u-warboss', 'Da Boss Fixture').summary === 'Short line.' && ab('u-warboss', 'Da Boss Fixture').effectSource === '40kdc');
check('hors format : écarté et signalé ; cible inconnue : signalée', withEffects.droppedEffects.some((d) => d.army === 'authored' && d.where === 'u-warboss::ability:Leader') && withEffects.unresolvedAuthored.includes('u-nobody::ability:Nothing'));
