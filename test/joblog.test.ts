/**
 * Le journal d'une tâche dans l'interface : la raison d'un échec ressort, les
 * lignes interminables se replient.
 *
 *   npx tsx test/joblog.test.ts
 */
import { FOLD_AT, failureReasons, foldLine } from '../ui/src/joblog.ts';
import { check } from './check.ts';

const build = [
  '39 files written to /tmp/dataset',
  `Units not found for authored/: ${'adeptus-custodes › Custodian Guard, '.repeat(200)}`,
  '✘ schema — corrections/wh40k-11e/adeptus-custodes/caladius-grav-tank-unit-mfm.json: /patch must NOT have fewer than 1 properties',
  '✘ 1 file(s) off schema, 0 text finding(s)',
  'the check refused the Dataset — read the lines above.',
  '— failed (exit code 1)',
];
const reasons = failureReasons(build);
check('un échec cite ses lignes ✘, pas la formule de fin', reasons.length === 2 && reasons[0].includes('caladius-grav-tank-unit-mfm.json'), JSON.stringify(reasons));

const crash = ['Error: ENOENT: no such file or directory, open \'x.json\'', 'the build failed — read the lines above.', '— failed (exit code 1)'];
check('sans ligne ✘, la dernière ligne qui dit quelque chose', failureReasons(crash).join() === crash[0], JSON.stringify(failureReasons(crash)));
check('un journal vide ne donne aucune raison', failureReasons([]).length === 0);

const folded = foldLine(build[1]);
check('une ligne trop longue se replie, et dit ce qu\'elle cache', folded.head.length === FOLD_AT && folded.rest === build[1].length - FOLD_AT);
check('une ligne courte reste entière', foldLine(build[0]).rest === 0 && foldLine(build[0]).head === build[0]);
