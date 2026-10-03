/**
 * Le format de Rule à nous (ADR 0011), sur le point de test de construction :
 * les Rules sont publiées sans Effect 40kdc-data, et leurs Modifiers
 * viennent des seules Contributions.
 *
 *   npx tsx test/rules.test.ts
 */
import { SIMULATED_MODIFIERS, UNIT_MODIFIERS, type ArmyFile, type CoreFile } from '@paintplanplay/dataset-schema';
import { validateFile } from '@paintplanplay/dataset-schema/validate';
import { build } from '../src/build.ts';
import { openSnapshot } from '../src/snapshot.ts';
import { check, fixture, fixtureAuthored, section } from './check.ts';

const GS = 'wh40k-11e';
const snapshot = openSnapshot(fixture('snapshot'));
const bare = await build({ snapshot, authored: fixtureAuthored() });
const orksOf = (files: Map<string, unknown>) => files.get(`${GS}/armies/orks.json`) as ArmyFile;
const orks = orksOf(bare.files);
const warHorde = orks.detachments.find((d) => d.name === 'War Horde')!;
const ereWeGo = orks.stratagems.find((s) => s.name === "'ERE WE GO")!;
const warboss = orks.units.find((u) => u.name === 'Warboss')!;

section('Rules : plus aucun Effect 40kdc-data, dans aucune Army');
const published = [...bare.files.values()].map((f) => JSON.stringify(f));
check('aucun Effect, portée ou source d\'Effect publié, dans aucun fichier', published.every((j) => !/"(effect|scope|effectSource|conditional)":/.test(j)));
check('les champs structurés des Stratagems restent', ereWeGo.cp === 1 && ereWeGo.phases.length > 0 && ereWeGo.target !== undefined);
check('les Stratagems Core non plus', (bare.files.get(`${GS}/core.json`) as CoreFile).stratagems.every((s) => !('effect' in s)));
check('l\'Army des Orks reste conforme au schéma', validateFile('army', orks).length === 0, validateFile('army', orks).join(' | '));

section('Rules des Orks : les Modifiers viennent des Contributions');
const carnage = orks.stratagems.find((s) => s.name === 'UNBRIDLED CARNAGE')!;
const authored = fixtureAuthored([
    {
      target: `orks::stratagem:${ereWeGo.id}`,
      modifiers: [{ key: 'charge', value: 2, target: 'self' }],
      summary: 'Adds 2 to Advance and Charge rolls.',
      reason: 'Premier Effect au format à nous.',
    },
    {
      target: `${warboss.id}::ability:${warboss.abilities.find((a) => a.name !== 'Leader')!.name}`,
      modifiers: [
        { key: 'hit', value: 1, target: 'self' },
        { key: 'crit-hit', value: '5+', target: 'self' },
        { key: 'reroll-wound', value: '1', target: 'self' },
      ],
      reason: 'Valeurs de dés : nombre, seuil, relance.',
    },
    {
      target: `orks::rule:${warHorde.id}|${warHorde.rules[0].id}`,
      effect: { type: 'stat-modifier', target: 'unit', modifier: { stat: 'S', operation: 'add', value: 1 } },
      reason: 'Ancien format, sur une Rule Orks.',
    },
    {
      target: `orks::stratagem:${carnage.id}`,
      modifiers: [{ key: 'hit', value: 1, target: 'somewhere' as 'self' }],
      reason: 'Cible inconnue.',
    },
]);
const out = await build({ snapshot, authored });
const withMods = orksOf(out.files);
const strat = withMods.stratagems.find((s) => s.id === ereWeGo.id)!;
check('les Modifiers d\'une Contribution sont publiés', JSON.stringify(strat.modifiers) === JSON.stringify([{ key: 'charge', value: 2, target: 'self' }]), JSON.stringify(strat.modifiers));
check('sa Description aussi', strat.summary === 'Adds 2 to Advance and Charge rolls.');
const ability = withMods.units.find((u) => u.id === warboss.id)!.abilities.find((a) => a.modifiers)!;
check('une valeur peut être un nombre, un seuil ou une relance', ability.modifiers?.map((m) => m.value).join() === '1,5+,1');
const rule = withMods.detachments.find((d) => d.id === warHorde.id)!.rules[0];
check('un Effect à l\'ancien format n\'est jamais publié, la Rule qu\'il accompagne reste', rule?.name === 'Get Stuck In' && !('effect' in rule));
const oldFormat = out.contributions.find((c) => c.target.includes('::rule:'))!;
check('la Contribution à l\'ancien format est rejetée, avec sa raison', oldFormat.state === 'rejected' && /Modifiers/.test(oldFormat.note), oldFormat.note);
const badTarget = out.contributions.filter((c) => c.target.includes('::stratagem:') && !c.target.startsWith('core'));
check('un Modifier hors schéma rejette sa Contribution', badTarget.some((c) => c.state === 'rejected') && badTarget.some((c) => c.state === 'active'), JSON.stringify(badTarget));
check('le Stratagem qu\'elle crée reste, sans ses Modifiers', withMods.stratagems.some((s) => s.id === carnage.id && !s.modifiers));
check('l\'Army reste conforme au schéma', validateFile('army', withMods).length === 0, validateFile('army', withMods).join(' | '));

section('Rules des Orks : une Detachment Rule accorde un Keyword');
const granting = await build({
  snapshot,
  authored: fixtureAuthored([
      {
        target: `orks::rule:${warHorde.id}|${warHorde.rules[0].id}`,
        eligibility: { allOf: ['Gretchin'], anyOf: [], noneOf: [] },
        modifiers: [{ key: 'gain-keyword', value: 'Battleline', target: 'self' }],
        reason: 'Un Keyword accordé par un détachement.',
      },
  ]),
});
const grantingRule = orksOf(granting.files).detachments.find((d) => d.id === warHorde.id)!.rules[0];
check('le Modifier et l\'Eligibility sont publiés', grantingRule.modifiers?.[0].key === 'gain-keyword' && grantingRule.eligibility?.allOf.join() === 'Gretchin');
check('gain-keyword est une clé connue : pas une anomalie', !granting.unsimulated.some((f) => f.key === 'gain-keyword'), JSON.stringify(granting.unsimulated));
const displayed = await build({
  snapshot,
  authored: fixtureAuthored([{ target: `orks::stratagem:${ereWeGo.id}`, modifiers: [{ key: 'advance', value: 2, target: 'self' }, { key: 'advanse', value: 2, target: 'self' }], reason: 'A displayed key, and a typo.' }]),
});
check('une clé affichée est connue, seule la faute de frappe est relevée', displayed.unsimulated.map((u) => u.key).join() === 'advanse', JSON.stringify(displayed.unsimulated));
check('elle n\'est pas pour autant une option de combat', !('gain-keyword' in SIMULATED_MODIFIERS) && 'gain-keyword' in UNIT_MODIFIERS);
check('l\'Army reste conforme au schéma', validateFile('army', orksOf(granting.files)).length === 0);
const misgranted = await build({
  snapshot,
  authored: fixtureAuthored([
      { target: `orks::rule:${warHorde.id}|${warHorde.rules[0].id}`, modifiers: [{ key: 'gain-keyword', target: 'self' }], reason: 'Sans Keyword.' },
      { target: `orks::stratagem:${ereWeGo.id}`, modifiers: [{ key: 'hit', value: 'Battleline', target: 'self' }], reason: 'Un Keyword sur une autre clé.' },
  ]),
});
check('gain-keyword sans Keyword est rejeté', misgranted.contributions.find((c) => c.target.includes('::rule:'))?.state === 'rejected');
check('un Keyword en valeur d\'une autre clé reste rejeté', misgranted.contributions.find((c) => c.target === `orks::stratagem:${ereWeGo.id}`)?.state === 'rejected');

section('Rules des Orks : règles Core en statuts, Army Rules par identifiant');
check(
  'les règles Core de BSData deviennent des Modifiers de statut sur l\'Unit, avec leur valeur',
  JSON.stringify(warboss.statuses) === JSON.stringify([{ key: 'feel-no-pain', value: '5+', target: 'self' }, { key: 'deep-strike', target: 'self' }]),
  JSON.stringify(warboss.statuses),
);
check('une règle Core n\'est ni une Army Rule ni une aptitude', !warboss.armyRules.includes('Feel No Pain') && !warboss.abilities.some((a) => /Feel No Pain|Deep Strike/.test(a.name)));
const waaagh = orks.armyRules?.find((r) => r.name === 'Waaagh!');
check('les Army Rules sont stockées une fois dans l\'Army', orks.armyRules?.length === 1 && waaagh !== undefined, JSON.stringify(orks.armyRules));
check('chaque Unit les désigne par identifiant', warboss.armyRuleIds?.join() === waaagh?.id && orks.units.find((u) => u.name === 'Boyz' && !u.ally)?.armyRuleIds?.join() === waaagh?.id);
const withArmyRule = orksOf(
  (
    await build({
      snapshot,
      authored: fixtureAuthored([{ target: `orks::armyrule:${waaagh?.id}`, modifiers: [{ key: 'hit', value: 1, target: 'self', conditions: [{ key: 'waaagh' }] }], reason: 'Army Rule au format à nous.' }]),
    })
  ).files,
);
check('une Contribution pose les Modifiers d\'une Army Rule', withArmyRule.armyRules?.[0].modifiers?.[0].key === 'hit');
check('l\'Army et ses Army Rules restent conformes au schéma', validateFile('army', withArmyRule).length === 0, validateFile('army', withArmyRule).join(' | '));
