/**
 * Point de test « construction d'une Dataset Release » : une Unit Supreme
 * Commander — qui, dans une List, en est forcément le Warlord — sort marquée,
 * pour que l'application n'ait jamais à lire un nom d'aptitude (#135).
 *
 *   npx tsx test/supreme.test.ts
 */
import type { ArmyFile, Unit } from '@paintplanplay/dataset-schema';
import { validateFile } from '@paintplanplay/dataset-schema/validate';
import { build, type BuildOutput } from '../src/build.ts';
import type { CorrectionFile } from '../src/corrections/files.ts';
import { openSnapshot } from '../src/snapshot.ts';
import { check, fixture, section } from './check.ts';

const GS = 'wh40k-11e';
const snapshot = openSnapshot(fixture('snapshot'));
const unitOf = (out: BuildOutput, army: string, name: string) =>
  (out.files.get(`${GS}/armies/${army}.json`) as ArmyFile).units.find((u) => u.name === name) as Unit;
const correction = (name: string, target: string, patch: Record<string, unknown>): CorrectionFile => ({
  source: 'bsdata',
  reason: 'test',
  path: `corrections/${GS}/orks/${name}.json`,
  target,
  patch,
});

section('Supreme Commander : repéré à son aptitude, jamais au keyword Warlord');
const plain = await build({ snapshot });
check('une Unit sans l\'aptitude n\'est pas Supreme Commander', unitOf(plain, 'orks', 'Warboss').supremeCommander === undefined);
const keyworded = await build({ snapshot, corrections: [correction('kw', 'u-warboss', { keywords: ['Character', 'Warlord'] })] });
check(
  'le keyword Warlord de BSData n\'en fait pas un Supreme Commander',
  unitOf(keyworded, 'orks', 'Warboss').keywords.includes('Warlord') && unitOf(keyworded, 'orks', 'Warboss').supremeCommander === undefined,
);

const withAbility = await build({
  snapshot,
  corrections: [correction('supreme', 'u-warboss::ability:Supreme Commander', { __add: true })],
});
check('une Unit portant l\'aptitude « Supreme Commander » sort marquée', unitOf(withAbility, 'orks', 'Warboss').supremeCommander === true);
check('… y compris dans une Army qui l\'aligne en alliée', unitOf(withAbility, 'orks-freebooterz', 'Warboss').supremeCommander === true);
check('le marqueur est conforme au schéma', validateFile('army', withAbility.files.get(`${GS}/armies/orks.json`)).length === 0);
check('les autres Units ne le sont pas', unitOf(withAbility, 'orks', 'Boyz').supremeCommander === undefined);

section('Supreme Commander : une Correction de l\'aptitude tranche');
const unmarked = await build({
  snapshot,
  corrections: [
    correction('supreme', 'u-warboss::ability:Supreme Commander', { __add: true }),
    correction('renamed', 'u-warboss::ability:Supreme Commander', { name: 'Da Big Boss' }),
  ],
});
check('l\'aptitude renommée par une Correction, l\'Unit n\'est plus marquée', unitOf(unmarked, 'orks', 'Warboss').supremeCommander === undefined);
check('le nom se compare sans casse', unitOf(await build({
  snapshot,
  corrections: [correction('supreme', 'u-warboss::ability:SUPREME COMMANDER', { __add: true })],
}), 'orks', 'Warboss').supremeCommander === true);
