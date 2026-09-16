/**
 * Stratagems de Detachment et Core dans le Dataset, sur le point de test de
 * construction (issue #63).
 *
 *   npx tsx test/stratagems.test.ts
 */
import type { ArmyFile, CoreFile, Stratagem } from '@paintplanplay/dataset-schema';
import { validateFile } from '@paintplanplay/dataset-schema/validate';
import { build, type BuildOutput } from '../src/build.ts';
import { CORE_ROOT, stratagemTarget } from '../src/corrections/apply.ts';
import type { CorrectionFile } from '../src/corrections/files.ts';
import { toJson } from '../src/dataset.ts';
import { openSnapshot } from '../src/snapshot.ts';
import { check, fixture, section } from './check.ts';

const GS = 'wh40k-11e';
const snapshot = openSnapshot(fixture('snapshot'));
const first = await build({ snapshot });
const second = await build({ snapshot, ids: first.ids });

const orks = (out: BuildOutput) => out.files.get(`${GS}/armies/orks.json`) as ArmyFile;
const core = (out: BuildOutput) => out.files.get(`${GS}/core.json`) as CoreFile;
const strat = (out: BuildOutput, name: string) => orks(out).stratagems.find((s) => s.name === name) as Stratagem;
const warHorde = orks(first).detachments.find((d) => d.name === 'War Horde')!;

section('Stratagems : Detachment et Core, depuis 40kdc-data');
check('les Stratagems des Detachments publiés sont dans l\'Army', orks(first).stratagems.map((s) => s.name).join(',') === "'ERE WE GO,UNBRIDLED CARNAGE");
check('un Stratagem rattaché à un Detachment écarté n\'est pas publié', !orks(first).stratagems.some((s) => s.name === 'FULL THROTTLE'));
check('chaque Stratagem désigne son Detachment par son identifiant', orks(first).stratagems.every((s) => s.detachmentId === warHorde.id));
const ereWeGo = strat(first, "'ERE WE GO");
check('CP, phases dans l\'ordre du tour, tour et moment', ereWeGo.cp === 1 && ereWeGo.phases.join() === 'movement,charge' && ereWeGo.playerTurn === 'your-turn' && ereWeGo.timing === 'once-per-phase');
check('la catégorie est reprise', ereWeGo.category === 'strategic-ploy');
check('l\'Effect est repris', ereWeGo.effect?.type === 'charge-roll-modifier');
check('les Stratagems Core vivent dans core.json, sans Detachment', core(first).stratagems.length === 1 && core(first).stratagems[0].detachmentId === null && core(first).stratagems[0].effect?.type === 're-roll');

section('Stratagems : restrictions de cible');
const carnage = strat(first, 'UNBRIDLED CARNAGE');
check('les restrictions écrites sur le Stratagem font sa cible', JSON.stringify(carnage.target) === JSON.stringify({ allOf: ['Orks'], anyOf: ['Infantry', 'Walker'], noneOf: [] }));
check('leur note en prose n\'est jamais reprise', !toJson(orks(first)).includes('Has not been selected'));
check('à défaut, le filtre de l\'aptitude fait la cible', JSON.stringify(ereWeGo.target) === JSON.stringify({ allOf: ['Orks'], anyOf: [], noneOf: ['Vehicle'] }));
check('un Stratagem Core sans restriction n\'a pas de cible', core(first).stratagems[0].target === undefined);

section('Stratagems : identifiants et Corrections');
check('deux constructions donnent les mêmes identifiants', toJson(orks(first).stratagems.map((s) => s.id)) === toJson(orks(second).stratagems.map((s) => s.id)) && toJson(core(first)) === toJson(core(second)));
check('l\'identifiant garde la référence 40kdc-data', first.ids.stratagems.orks.some((e) => e.id === carnage.id && e.keys.includes('40kdc:war-horde/unbridled-carnage-war-horde')));
const c = (name: string, x: Omit<CorrectionFile, 'path' | 'source' | 'reason'>): CorrectionFile => ({ source: '40kdc', reason: 'test', path: `corrections/${GS}/orks/${name}.json`, ...x });
const corrected = await build({
  snapshot,
  corrections: [
    c('carnage-target', { target: stratagemTarget('orks', carnage.id), patch: { target: { allOf: ['Orks', 'Infantry'], anyOf: [], noneOf: [] } }, upstream: { target: carnage.target } }),
    c('reroll-cp', { target: stratagemTarget(CORE_ROOT, core(first).stratagems[0].id), patch: { cp: 2 }, upstream: { cp: 1 } }),
    c('ghost', { target: stratagemTarget('orks', 'nope'), patch: { cp: 0 } }),
  ],
});
check('une Correction de cible de Stratagem en fichier est appliquée', strat(corrected, 'UNBRIDLED CARNAGE').target?.allOf.join() === 'Orks,Infantry');
check('une Correction de Stratagem Core est appliquée', core(corrected).stratagems[0].cp === 2);
check('leur cycle de vie se calcule sur l\'amont des Stratagems', corrected.corrections.filter((v) => v.state === 'active').length === 2);
check('un Stratagem introuvable laisse la Correction orpheline', corrected.orphans.some((o) => o.target === stratagemTarget('orks', 'nope')));

section('Stratagems : schéma et texte');
check('le fichier d\'Army est conforme au schéma', validateFile('army', orks(first)).length === 0, validateFile('army', orks(first)).join(' ; '));
check('core.json est conforme au schéma', validateFile('core', core(first)).length === 0, validateFile('core', core(first)).join(' ; '));
check('aucun constat de texte', first.textCheck.length === 0, first.textCheck.map((f) => f.where).join(' ; '));
