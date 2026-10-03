/**
 * Stratagems de Detachment et Core dans le Dataset, sur le point de test de
 * construction (issue #63). Aucune source n'en publie plus : ils viennent tous
 * des Contributions du Dataset de test.
 *
 *   npx tsx test/stratagems.test.ts
 */
import type { ArmyFile, CoreFile, Stratagem } from '@paintplanplay/dataset-schema';
import { validateFile } from '@paintplanplay/dataset-schema/validate';
import { build, type BuildOutput } from '../src/build.ts';
import { stratagemTarget } from '../src/corrections/apply.ts';
import type { CorrectionFile } from '../src/corrections/files.ts';
import { toJson } from '../src/dataset.ts';
import { openSnapshot } from '../src/snapshot.ts';
import { check, fixture, fixtureAuthored, section } from './check.ts';

const GS = 'wh40k-11e';
const snapshot = openSnapshot(fixture('snapshot'));
const authored = fixtureAuthored();
const first = await build({ snapshot, authored });
const second = await build({ snapshot, ids: first.ids, authored });

const orks = (out: BuildOutput) => out.files.get(`${GS}/armies/orks.json`) as ArmyFile;
const core = (out: BuildOutput) => out.files.get(`${GS}/core.json`) as CoreFile;
const strat = (out: BuildOutput, name: string) => orks(out).stratagems.find((s) => s.name === name) as Stratagem;
const warHorde = orks(first).detachments.find((d) => d.name === 'War Horde')!;

section('Stratagems : Detachment et Core, depuis les Contributions');
check('les Stratagems des Detachments publiés sont dans l\'Army', orks(first).stratagems.map((s) => s.name).join(',') === "'ERE WE GO,UNBRIDLED CARNAGE");
check('chaque Stratagem désigne son Detachment par son identifiant', orks(first).stratagems.every((s) => s.detachmentId === warHorde.id));
const ereWeGo = strat(first, "'ERE WE GO");
check('CP, phases dans l\'ordre du tour, tour et moment', ereWeGo.cp === 1 && ereWeGo.phases.join() === 'movement,charge' && ereWeGo.playerTurn === 'your-turn' && ereWeGo.timing === 'once-per-phase');
check('la catégorie est reprise', ereWeGo.category === 'strategic-ploy');
check('les Stratagems Core vivent dans core.json, sans Detachment', core(first).stratagems.length === 1 && core(first).stratagems[0].detachmentId === null);

section('Stratagems : restrictions de cible');
const carnage = strat(first, 'UNBRIDLED CARNAGE');
check('la cible est un filtre de mots-clés', JSON.stringify(carnage.target) === JSON.stringify({ allOf: ['Orks'], anyOf: ['Infantry', 'Walker'], noneOf: [] }));
check('avec ses exclusions', JSON.stringify(ereWeGo.target) === JSON.stringify({ allOf: ['Orks'], anyOf: [], noneOf: ['Vehicle'] }));
check('un Stratagem Core sans restriction n\'a pas de cible', core(first).stratagems[0].target === undefined);

section('Stratagems : identifiants et Corrections');
check('deux constructions donnent les mêmes identifiants', toJson(orks(first).stratagems.map((s) => s.id)) === toJson(orks(second).stratagems.map((s) => s.id)) && toJson(core(first)) === toJson(core(second)));
const c = (name: string, x: Omit<CorrectionFile, 'path' | 'source' | 'reason'>): CorrectionFile => ({ source: 'mfm', reason: 'test', path: `corrections/${GS}/orks/${name}.json`, ...x });
const corrected = await build({ snapshot, authored, corrections: [c('carnage-cp', { target: stratagemTarget('orks', carnage.id), patch: { cp: 2 } })] });
check('un Stratagem n\'a plus d\'amont à corriger : sa Correction reste orpheline', corrected.orphans.some((o) => o.target === stratagemTarget('orks', carnage.id)) && strat(corrected, 'UNBRIDLED CARNAGE').cp === carnage.cp);

section('Stratagems : schéma et texte');
check('le fichier d\'Army est conforme au schéma', validateFile('army', orks(first)).length === 0, validateFile('army', orks(first)).join(' ; '));
check('core.json est conforme au schéma', validateFile('core', core(first)).length === 0, validateFile('core', core(first)).join(' ; '));
check('aucun constat de texte', first.textCheck.length === 0, first.textCheck.map((f) => f.where).join(' ; '));
