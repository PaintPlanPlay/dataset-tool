/**
 * Point de test « construction d'une Dataset Release » : les aptitudes d'Unit
 * portent leur Effect — de 40kdc-data par la référence BSData, sinon proposé
 * par l'analyse —, jamais leur texte.
 *
 *   npx tsx test/abilities.test.ts
 */
import type { ArmyFile, Unit } from '@paintplanplay/dataset-schema';
import { validateEffect } from '@paintplanplay/dataset-schema/validate';
import { analysedAbility, partEffects } from '../src/abilities.ts';
import { build } from '../src/build.ts';
import { openSnapshot } from '../src/snapshot.ts';
import { check, fixture, section } from './check.ts';

const GS = 'wh40k-11e';
const out = await build({ snapshot: openSnapshot(fixture('snapshot')) });
const army = (id: string) => out.files.get(`${GS}/armies/${id}.json`) as ArmyFile;
const unit = (armyId: string, name: string) => army(armyId).units.find((u) => u.name === name) as Unit;
const ability = (u: Unit, name: string) => u.abilities.find((a) => a.name === name)!;

section('Aptitudes d\'Unit : Effects');

const boss = ability(unit('orks', 'Warboss'), 'Da Boss Fixture');
check(
  'Unit rattachée à 40kdc-data : l\'aptitude porte l\'Effect de 40kdc-data, tel quel',
  boss.effectSource === '40kdc' &&
    (boss.effect as { type: string; steps: unknown[] }).type === 'sequence' &&
    (boss.effect as { steps: unknown[] }).steps.length === 2,
  JSON.stringify(boss),
);
check('Leader : son nom seul', JSON.stringify(ability(unit('orks', 'Warboss'), 'Leader')) === '{"name":"Leader"}');

const mob = ability(unit('orks', 'Boyz'), 'Mob Fixture');
check(
  'Effect de 40kdc-data hors schéma : écarté, signalé une fois, et l\'analyse prend le relais',
  mob.effectSource === 'analysis' &&
    out.droppedEffects.filter((d) => d.where === 'Boyz › Mob Fixture').length === 1,
  `${JSON.stringify(mob)} · ${JSON.stringify(out.droppedEffects.filter((d) => d.where.startsWith('Boyz')))}`,
);
const vigil = ability(unit('adeptus-custodes', 'Custodian Guard'), 'Stand Vigil Fixture');
check(
  'Unit non rattachée : l\'analyse propose un Effect au format de 40kdc-data',
  vigil.effectSource === 'analysis' &&
    JSON.stringify(vigil.effect) === JSON.stringify({ type: 're-roll', target: 'unit', modifier: { roll: 'wound', subset: 'ones' } }),
  JSON.stringify(vigil),
);
check('rien de reconnu : l\'aptitude n\'a que son nom', unit('orks', 'Mek Gunz').abilities.every((a) => !a.effect));

const everyAbility = [...out.files.values()].flatMap((f) => ((f as ArmyFile).units ?? []).flatMap((u) => u.abilities));
check(
  'aucune aptitude publiée ne porte de texte ; chaque Effect est conforme au format',
  everyAbility.every((a) => Object.keys(a).every((k) => ['name', 'effect', 'scope', 'summary', 'effectSource', 'conditional'].includes(k))) &&
    everyAbility.every((a) => !a.effect || validateEffect(a.effect).length === 0) &&
    out.textCheck.length === 0,
);

section('Analyse d\'aptitudes : propositions');

const prophet = analysedAbility(
  {
    name: 'Prophet Fixture',
    text: 'Each time this model makes a melee attack, add 1 to the Hit roll and add 1 to the Wound roll and, if the Waaagh! is active, a Critical Hit is scored on an unmodified Hit roll of 5+.',
  },
  () => undefined,
);
const steps = (prophet.effect as { steps?: { type: string; modifier: Record<string, unknown> }[] }).steps ?? [];
check(
  'plusieurs bonus : une séquence, chacun borné à sa phase, la condition non exprimable signalée',
  steps.length === 3 &&
    steps.every((s) => s.modifier.weapon_type === 'melee') &&
    steps.some((s) => s.modifier.operation === 'crit-on' && s.modifier.value === 5) &&
    prophet.conditional === true,
  JSON.stringify(prophet),
);
const fnp = analysedAbility({ name: 'Tough Fixture', text: 'Models in this unit have the Feel No Pain 5+ ability.' }, () => undefined);
check('Feel No Pain inconditionnel', JSON.stringify(fnp.effect) === JSON.stringify({ type: 'feel-no-pain', target: 'unit', modifier: { threshold: 5 } }) && !fnp.conditional);
check(
  'l\'AP s\'écrit comme 40kdc-data : améliorer d\'un cran, c\'est ajouter -1',
  JSON.stringify(partEffects({ id: 'x', label: '+1 AP', effects: { bonusAP: 1 }, conditional: false }).map((n) => n.modifier)) ===
    JSON.stringify([{ stat: 'AP', operation: 'add', value: -1 }]),
);
check('la proposition ne contient jamais le texte lu', !JSON.stringify(prophet).includes('Each time'));
