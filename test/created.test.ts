/**
 * Point de test « construction d'une Dataset Release » : une Contribution crée
 * une Detachment Rule ou un Stratagem qu'aucune source n'a, partout où son
 * Detachment est publié, et remplace les champs d'un Stratagem existant.
 *
 *   npx tsx test/created.test.ts
 */
import type { ArmyFile, CoreFile } from '@paintplanplay/dataset-schema';
import { validateFile } from '@paintplanplay/dataset-schema/validate';
import { authoredEffectProblems, layoutContributions, type AuthoredCore, type AuthoredEffect } from '../src/authored.ts';
import { build } from '../src/build.ts';
import { openSnapshot } from '../src/snapshot.ts';
import { check, fixture, fixtureAuthored, section } from './check.ts';

const snapshot = openSnapshot(fixture('snapshot'));
const authored = (effects: AuthoredEffect[]): AuthoredCore => fixtureAuthored(effects);
const army = (files: Map<string, unknown>, id: string) => files.get(`wh40k-11e/armies/${id}.json`) as ArmyFile;
const both = ['orks', 'orks-freebooterz'];

const created: AuthoredEffect[] = [
  { target: 'orks::rule:war-horde|ladz-together', rule: { name: 'Ladz Together' }, summary: '+1 OC while near another mob', reason: 'A rule the sources do not have.' },
  {
    target: 'orks-freebooterz::stratagem:big-push',
    stratagem: { name: 'BIG PUSH', detachmentId: 'war-horde', cp: 1, phases: ['charge'], playerTurn: 'your-turn', timing: 'once-per-phase', trigger: 'charge-declared', category: 'strategic-ploy', target: { allOf: ['Orks', 'Infantry'], anyOf: [], noneOf: [] } },
    summary: '+1 to charge rolls',
    reason: 'A stratagem the sources do not have.',
  },
  {
    target: 'orks::stratagem:ere-we-go',
    stratagem: { name: '’ERE WE GO', detachmentId: 'war-horde', cp: 2, phases: ['movement'], playerTurn: 'your-turn', timing: 'once-per-phase' },
    reason: 'Its structured fields are ours.',
  },
  {
    target: 'core::stratagem:fixture-ploy',
    stratagem: { name: 'FIXTURE PLOY', detachmentId: null, cp: 1, phases: ['command'], playerTurn: 'either', timing: 'once-per-turn' },
    reason: 'A core stratagem the sources do not have.',
  },
];
const out = await build({ snapshot, authored: authored(created) });

section('Créer une Detachment Rule');
{
  const rules = both.map((a) => army(out.files, a).detachments.find((d) => d.id === 'war-horde')!.rules.find((r) => r.id === 'ladz-together'));
  check('elle est dans chaque Army qui publie le Detachment, avec sa Description', rules.every((r) => r?.name === 'Ladz Together' && r.summary === '+1 OC while near another mob'), JSON.stringify(rules));
  check('à côté de la Rule de la source', army(out.files, 'orks').detachments.find((d) => d.id === 'war-horde')!.rules.some((r) => r.id === 'get-stuck-in'));
}

section('Créer un Stratagem');
{
  const strats = both.map((a) => army(out.files, a).stratagems.find((s) => s.id === 'big-push'));
  check(
    'il est dans chaque Army qui publie le Detachment, avec tous ses champs',
    strats.every((s) => s?.name === 'BIG PUSH' && s.detachmentId === 'war-horde' && s.cp === 1 && s.phases.join() === 'charge' && s.trigger === 'charge-declared' && s.category === 'strategic-ploy' && s.target?.allOf.join() === 'Orks,Infantry' && s.summary === '+1 to charge rolls'),
    JSON.stringify(strats),
  );
  const names = army(out.files, 'orks').stratagems.map((s) => s.name);
  check('les Stratagems restent rangés par nom', names.join('|') === [...names].sort((a, b) => a.localeCompare(b)).join('|'), names.join('|'));
  const core = (out.files.get('wh40k-11e/core.json') as CoreFile).stratagems.find((s) => s.id === 'fixture-ploy');
  check('un Stratagem Core se crée au cœur, sans Detachment', core?.detachmentId === null && core.timing === 'once-per-turn');
  check('toutes les Contributions sont actives', out.contributions.every((c) => c.state === 'active'), JSON.stringify(out.contributions.filter((c) => c.state !== 'active')));
}

section('Les champs d\'un Stratagem existant viennent de la Contribution');
{
  const ere = both.map((a) => army(out.files, a).stratagems.find((s) => s.id === 'ere-we-go'));
  check('ses champs sont remplacés, partout', ere.every((s) => s?.cp === 2 && s.phases.join() === 'movement'), JSON.stringify(ere));
  check('un champ qu\'elle omet tombe', ere.every((s) => s?.category === undefined && s?.target === undefined), JSON.stringify(ere));
  check('les Armies restent conformes au schéma', both.every((a) => validateFile('army', army(out.files, a)).length === 0), JSON.stringify(validateFile('army', army(out.files, 'orks'))));
}

section('Ce qui se refuse');
{
  const base = { reason: 'A test.' };
  check('`rule` hors d\'une Detachment Rule', authoredEffectProblems({ ...base, target: 'orks::stratagem:x', rule: { name: 'X' } }).length > 0);
  check(
    'un moment hors du vocabulaire',
    authoredEffectProblems({ ...base, target: 'orks::stratagem:x', stratagem: { name: 'X', detachmentId: 'war-horde', cp: 1, phases: ['command'], playerTurn: 'either', timing: 'once-per-turn', trigger: 'whenever' as never } }).length > 0,
  );
  const badMoment = await build({
    snapshot,
    authored: authored([{ ...base, target: 'orks::stratagem:x', stratagem: { name: 'X', detachmentId: 'war-horde', cp: 1, phases: ['command'], playerTurn: 'either', timing: 'once-per-turn', trigger: 'whenever' as never } }]),
  });
  check('à la construction, un moment hors du vocabulaire ne crée rien', badMoment.contributions.find((c) => c.reason === 'A test.')?.state === 'rejected' && !(badMoment.files.get('wh40k-11e/armies/orks.json') as ArmyFile).stratagems.some((s) => s.id === 'x'));
  check('une Detachment Rule sans nom', authoredEffectProblems({ ...base, target: 'orks::rule:war-horde|x', rule: { name: ' ' } }).length > 0);
  check(
    'un Stratagem d\'Army sans Detachment',
    authoredEffectProblems({ ...base, target: 'orks::stratagem:x', stratagem: { name: 'X', detachmentId: null, cp: 1, phases: ['command'], playerTurn: 'either', timing: 'once-per-turn' } }).length > 0,
  );
  check(
    'un Stratagem hors du schéma',
    authoredEffectProblems({ ...base, target: 'orks::stratagem:x', stratagem: { name: 'X', detachmentId: 'war-horde', cp: -1, phases: ['nap'], playerTurn: 'either', timing: 'once-per-turn' } as never }).length > 0,
  );
  const ghost = await build({
    snapshot,
    authored: authored([{ ...base, target: 'orks::stratagem:x', stratagem: { name: 'X', detachmentId: 'no-such-detachment', cp: 1, phases: ['command'], playerTurn: 'either', timing: 'once-per-turn' } }]),
  });
  // Écrit sous une autre Army, le Stratagem créé dans Da Big Hunt reprend l'identifiant de celui de War Horde.
  const fixtureEffects = fixtureAuthored().effects!;
  const taken = await build({
    snapshot,
    authored: { ...fixtureAuthored(), effects: [...fixtureEffects, { ...base, target: 'orks-freebooterz::stratagem:ere-we-go', stratagem: { name: 'X', detachmentId: 'da-big-hunt', cp: 1, phases: ['command'], playerTurn: 'either', timing: 'once-per-turn' } }] },
  });
  const takenVerdict = taken.contributions.find((c) => c.reason === 'A test.');
  check('un identifiant déjà pris par le Stratagem d\'un autre Detachment', takenVerdict?.state === 'rejected', JSON.stringify(takenVerdict));
  check('un Stratagem dans un Detachment inconnu reste introuvable', ghost.contributions.find((c) => c.reason === 'A test.')?.state === 'unresolved');
}

section('Rangées sous l\'Army d\'origine du Detachment');
{
  const bare = await build({ snapshot, authored: fixtureAuthored() });
  const layout = layoutContributions('wh40k-11e', created, bare.files);
  const orks = layout.get('authored/wh40k-11e/armies/orks.json')?.map((e) => e.target) ?? [];
  check('le Stratagem créé sous les Freebooterz va chez les Orks, sous leur adresse', orks.includes('orks::stratagem:big-push'), orks.join());
  check('la Detachment Rule créée aussi', orks.includes('orks::rule:war-horde|ladz-together'));
}
