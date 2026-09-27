/**
 * Point de test « construction d'une Dataset Release » : les aptitudes d'Unit
 * ne sont publiées que par leur nom, jamais leur texte ; ce qu'elles font vient
 * des Contributions (ADR 0011). 40kdc-data n'est plus qu'une deuxième lecture,
 * gardée pour la revue.
 *
 *   npx tsx test/abilities.test.ts
 */
import type { ArmyFile, Unit } from '@paintplanplay/dataset-schema';
import { build } from '../src/build.ts';
import { openSnapshot } from '../src/snapshot.ts';
import { check, fixture, section } from './check.ts';

const GS = 'wh40k-11e';
const out = await build({ snapshot: openSnapshot(fixture('snapshot')) });
const army = (id: string) => out.files.get(`${GS}/armies/${id}.json`) as ArmyFile;
const unit = (armyId: string, name: string) => army(armyId).units.find((u) => u.name === name) as Unit;

section('Aptitudes d\'Unit : leur nom, et la lecture de 40kdc-data pour la revue');
const warboss = unit('orks', 'Warboss');
check('une aptitude publiée n\'a que son nom', JSON.stringify(warboss.abilities) === '[{"name":"Leader"},{"name":"Da Boss Fixture"}]', JSON.stringify(warboss.abilities));
check(
  'Unit rattachée à 40kdc-data : l\'Effect de son aptitude est gardé comme deuxième lecture',
  (out.kdcEffects[`${warboss.id}::ability:Da Boss Fixture`] as { type?: string } | undefined)?.type === 'sequence',
);
check('Leader ne se lit pas chez 40kdc-data', out.kdcEffects[`${warboss.id}::ability:Leader`] === undefined);
check('Unit non rattachée : aucune lecture, aucune analyse du texte', out.kdcEffects[`${unit('adeptus-custodes', 'Custodian Guard').id}::ability:Stand Vigil Fixture`] === undefined);

const everyAbility = [...out.files.values()].flatMap((f) => ((f as ArmyFile).units ?? []).flatMap((u) => u.abilities));
check('aucune aptitude publiée ne porte de texte', everyAbility.every((a) => Object.keys(a).every((k) => k === 'name')) && out.textCheck.length === 0);
