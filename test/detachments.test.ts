/**
 * Detachments et Enhancements dans le Dataset, et premiers Effects, sur le
 * point de test de construction (issue #61).
 *
 *   npx tsx test/detachments.test.ts
 */
import type { ArmyFile, DatasetIndex, Detachment } from '@paintplanplay/dataset-schema';
import { EFFECT_FORMAT } from '@paintplanplay/dataset-schema';
import { validateEffect, validateFile } from '@paintplanplay/dataset-schema/validate';
import { build, type BuildOutput } from '../src/build.ts';
import { detachmentTarget, enhancementTarget } from '../src/corrections/apply.ts';
import type { CorrectionFile } from '../src/corrections/files.ts';
import { toJson } from '../src/dataset.ts';
import { makeReport, renderReport } from '../src/report.ts';
import { openSnapshot } from '../src/snapshot.ts';
import { check, fixture, section } from './check.ts';

const GS = 'wh40k-11e';
const snapshot = openSnapshot(fixture('snapshot'));
const first = await build({ snapshot });
const second = await build({ snapshot, ids: first.ids });

const orks = (out: BuildOutput) => out.files.get(`${GS}/armies/orks.json`) as ArmyFile;
const det = (out: BuildOutput, name: string) => orks(out).detachments.find((d) => d.name === name) as Detachment;
const warHorde = det(first, 'War Horde');
const bigHunt = det(first, 'Da Big Hunt');
const enh = (name: string) => warHorde.enhancements.find((e) => e.name === name)!;

section('Detachments : ce qui existe et ses chiffres viennent du MFM');
check('les Detachments du MFM sont publiés, triés', orks(first).detachments.map((d) => d.name).join(',') === 'Da Big Hunt,War Horde');
check('un Detachment que seule 40kdc-data publie n\'entre pas dans le Dataset, et est signalé',
  !orks(first).detachments.some((d) => d.name === 'Kult of Speed') &&
  first.missing.some((m) => m.name === 'Kult of Speed' && m.missingIn === 'mfm' && !m.published));
check('le coût en DP vient du MFM', warHorde.dp === 1);
check('le désaccord de DP avec 40kdc-data est tranché pour le MFM et reporté',
  first.conflicts.some((c) => c.entity === 'detachment' && c.field === 'dp' && c.kept === '1' && c.other.source === '40kdc' && c.other.value === '2'));
check('les Force Dispositions viennent du MFM, en identifiants', warHorde.forceDispositions.join() === 'take-and-hold');
check('le désaccord de Force Disposition est reporté', first.conflicts.some((c) => c.field === 'forceDispositions' && c.other.value === 'purge-the-foe'));
check('les points d\'Enhancement viennent du MFM', enh('Follow Me Ladz').points === 25);
check('le désaccord de points d\'Enhancement est reporté', first.conflicts.some((c) => c.entity === 'enhancement' && c.field === 'points' && c.kept === '25' && c.other.value === '20'));
check('une Enhancement que seule 40kdc-data publie est écartée et signalée',
  !warHorde.enhancements.some((e) => e.name === 'Bosspole') && first.missing.some((m) => m.name === 'War Horde › Bosspole' && !m.published));

section('Detachments : règles, restrictions et Effects viennent de 40kdc-data');
check('la Detachment Rule vient de 40kdc-data', warHorde.rules.length === 1 && warHorde.rules[0].name === 'Get Stuck In');
check('la règle porte son Effect, au format figé', warHorde.rules[0].effect?.type === 'keyword-grant' && validateEffect(warHorde.rules[0].effect, warHorde.rules[0].scope).length === 0);
check('une restriction simple devient un groupe de mots-clés', JSON.stringify(enh('Follow Me Ladz').requires) === JSON.stringify([['Warboss']]));
check('des restrictions alternatives restent des groupes, avec leurs exclusions',
  JSON.stringify(enh('Kunnin’ But Brutal').requires) === JSON.stringify([['Orks', 'Infantry'], ['Orks', 'Mounted']]) && enh('Kunnin’ But Brutal').excludes.join() === 'Epic Hero');
check('l\'Effect d\'une Enhancement est repris', enh('Follow Me Ladz').effect?.type === 'roll-modifier');
check('un Effect amont porteur de texte est écarté et signalé',
  !enh('Kunnin’ But Brutal').effect && first.droppedEffects.some((e) => e.where === 'War Horde › Kunnin’ But Brutal' && e.reason.startsWith('porte du texte')));
check('un Detachment absent de 40kdc-data est publié par son nom seul, et signalé',
  bigHunt.rules.length === 0 && bigHunt.enhancements[0].requires.length === 0 && first.missing.some((m) => m.name === 'Da Big Hunt' && m.missingIn === '40kdc' && m.published));
check('la sous-faction reprend les données 40kdc-data de sa faction', det(first, 'War Horde') && (first.files.get(`${GS}/armies/orks-freebooterz.json`) as ArmyFile).detachments.find((d) => d.name === 'War Horde')?.rules.length === 1);
check('l\'Army garde sa faction 40kdc-data', (first.files.get(`${GS}/index.json`) as DatasetIndex).armies.find((a) => a.id === 'orks')?.refs.kdc === 'orks');
check('le format des Effects est déclaré', JSON.stringify((first.files.get(`${GS}/index.json`) as DatasetIndex).effectFormat) === JSON.stringify(EFFECT_FORMAT));

section('Detachments : identifiants stables');
check('deux constructions donnent les mêmes identifiants de Detachment et d\'Enhancement',
  toJson(orks(first).detachments.map((d) => [d.id, d.enhancements.map((e) => e.id), d.rules.map((r) => r.id)])) ===
    toJson(orks(second).detachments.map((d) => [d.id, d.enhancements.map((e) => e.id), d.rules.map((r) => r.id)])));
check('l\'identifiant garde la référence 40kdc-data', first.ids.detachments.orks.some((e) => e.id === warHorde.id && e.keys.includes('40kdc:orks/war-horde')));
const renamed = structuredClone(first.ids);
renamed.detachments.orks.find((e) => e.id === warHorde.id)!.id = 'horde-de-guerre';
check('un identifiant attribué survit, même si le nom amont en donnerait un autre', det(await build({ snapshot, ids: renamed }), 'War Horde').id === 'horde-de-guerre');

section('Detachments : Corrections');
const correction = (name: string, c: Omit<CorrectionFile, 'path' | 'source' | 'reason'>): CorrectionFile => ({ source: 'mfm', reason: 'test', path: `corrections/${GS}/orks/${name}.json`, ...c });
const corrected = await build({
  snapshot,
  corrections: [
    correction('war-horde-dp', { target: detachmentTarget('orks', warHorde.id), patch: { dp: 2 }, upstream: { dp: 1 } }),
    correction('ladz-points', { target: enhancementTarget('orks', warHorde.id, enh('Follow Me Ladz').id), patch: { points: 30 }, upstream: { points: 25 } }),
    correction('ghost', { target: detachmentTarget('orks', 'nope'), patch: { dp: 3 } }),
  ],
});
check('une Correction de DP s\'applique au Detachment visé, sans toucher son voisin', det(corrected, 'War Horde').dp === 2 && det(corrected, 'Da Big Hunt').dp === 1);
check('une Correction de points s\'applique à l\'Enhancement visée', det(corrected, 'War Horde').enhancements.find((e) => e.name === 'Follow Me Ladz')?.points === 30);
check('leur cycle de vie se calcule sur l\'amont des Detachments', corrected.corrections.filter((v) => v.state === 'active').length === 2);
check('un Detachment introuvable laisse la Correction orpheline', corrected.orphans.some((o) => o.target === detachmentTarget('orks', 'nope')));

section('Detachments : schéma, texte et rapport');
check('le fichier d\'Army avec ses Detachments est conforme au schéma', validateFile('army', orks(first)).length === 0, validateFile('army', orks(first)).join(' ; '));
check('la construction ne produit aucun constat de texte', first.textCheck.length === 0, first.textCheck.map((f) => f.where).join(' ; '));
const markdown = renderReport(makeReport(first, undefined));
check('le rapport liste les éléments absents d\'une source et les Effects écartés', /## Éléments absents d'une source/.test(markdown) && /## Effects écartés/.test(markdown));
check('le rapport ne recopie pas le libellé écarté', !/until the end of the phase/.test(markdown));
