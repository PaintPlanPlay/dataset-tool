/**
 * Point de test « construction d'une Dataset Release » : les aptitudes d'Unit
 * ne sont publiées que par leur nom, jamais leur texte ; ce qu'elles font vient
 * des Contributions (ADR 0011).
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

section('Aptitudes d\'Unit : leur nom seul');
const warboss = unit('orks', 'Warboss');
check('une aptitude publiée n\'a que son nom', JSON.stringify(warboss.abilities) === '[{"name":"Leader"},{"name":"Da Boss Fixture"}]', JSON.stringify(warboss.abilities));
check('une aptitude sans Contribution n\'a que son nom, quelle que soit l\'Army', JSON.stringify(unit('adeptus-custodes', 'Custodian Guard').abilities.find((a) => a.name === 'Stand Vigil Fixture')) === '{"name":"Stand Vigil Fixture"}');

const everyAbility = [...out.files.values()].flatMap((f) => ((f as ArmyFile).units ?? []).flatMap((u) => u.abilities));
check('aucune aptitude publiée ne porte de texte', everyAbility.every((a) => Object.keys(a).every((k) => k === 'name')) && out.textCheck.length === 0);
