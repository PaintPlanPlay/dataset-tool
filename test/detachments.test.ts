/**
 * Detachments et Enhancements dans le Dataset, et premiers Effects, sur le
 * point de test de construction (issue #61).
 *
 *   npx tsx test/detachments.test.ts
 */
import type { ArmyFile, DatasetIndex, Detachment } from '@paintplanplay/dataset-schema';
import { validateFile } from '@paintplanplay/dataset-schema/validate';
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
check('les Detachments du MFM sont publiés, triés', orks(first).detachments.map((d) => d.name).join(',') === 'Boss Brutes,Da Big Hunt,War Horde');
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

section('Detachments : règles et restrictions viennent de 40kdc-data ; leurs Effects ne sont qu\'une deuxième lecture');
check('la Detachment Rule vient de 40kdc-data', warHorde.rules.length === 1 && warHorde.rules[0].name === 'Get Stuck In');
check(
  'la règle n\'est publiée que par son nom ; l\'Effect de 40kdc-data est gardé pour la revue',
  JSON.stringify(warHorde.rules[0]) === JSON.stringify({ id: warHorde.rules[0].id, name: 'Get Stuck In' }) &&
    (first.kdcEffects[`orks::rule:${warHorde.id}|${warHorde.rules[0].id}`] as { type?: string } | undefined)?.type === 'keyword-grant',
);
check('une restriction simple devient un groupe de mots-clés', JSON.stringify(enh('Follow Me Ladz').requires) === JSON.stringify([['Warboss']]));
check('des restrictions alternatives restent des groupes, avec leurs exclusions',
  JSON.stringify(enh('Kunnin’ But Brutal').requires) === JSON.stringify([['Orks', 'Infantry'], ['Orks', 'Mounted']]) && enh('Kunnin’ But Brutal').excludes.join() === 'Epic Hero');
check('l\'Effect d\'une Enhancement est gardé pour la revue, jamais publié', (first.kdcEffects[`orks::enhancement:${warHorde.id}|${enh('Follow Me Ladz').id}`] as { type?: string } | undefined)?.type === 'roll-modifier');
check('un Effect amont porteur de texte n\'entre jamais dans le Dataset', !toJson(orks(first)).includes('FIXTURE') && first.textCheck.length === 0);
check('un Detachment absent de 40kdc-data est publié par son nom seul, et signalé',
  bigHunt.rules.length === 0 && bigHunt.enhancements[0].requires.length === 0 && first.missing.some((m) => m.name === 'Da Big Hunt' && m.missingIn === '40kdc' && m.published));
check('la sous-faction reprend les données 40kdc-data de sa faction', det(first, 'War Horde') && (first.files.get(`${GS}/armies/orks-freebooterz.json`) as ArmyFile).detachments.find((d) => d.name === 'War Horde')?.rules.length === 1);
check('l\'Army garde sa faction 40kdc-data', (first.files.get(`${GS}/index.json`) as DatasetIndex).armies.find((a) => a.id === 'orks')?.refs.kdc === 'orks');

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

section('Detachments : la Weapon qu\'une Enhancement apporte');
const bossBrutes = det(first, 'Boss Brutes');
const thunderbuss = bossBrutes.enhancements.find((e) => e.name === 'Da Gobshot Thunderbuss')!;
check(
  'l\'Enhancement porte la Weapon que BSData lui donne',
  thunderbuss.weapon?.name === 'Da Gobshot Thunderbuss' && thunderbuss.weapon.kind === 'ranged' && thunderbuss.weapon.profiles[0].A === '6',
  JSON.stringify(thunderbuss.weapon),
);
check('une Enhancement sans arme dans BSData n\'en porte pas', !enh('Follow Me Ladz').weapon);
const thunderbussTarget = enhancementTarget('orks', bossBrutes.id, thunderbuss.id);
const weaponCorrected = await build({
  snapshot,
  corrections: [correction('thunderbuss', { target: thunderbussTarget, patch: { weapon: { ...thunderbuss.weapon!, profiles: [{ ...thunderbuss.weapon!.profiles[0], A: '7' }] } }, upstream: { weapon: thunderbuss.weapon } })],
});
check(
  'une Correction s\'applique à cette Weapon, donnée amont',
  det(weaponCorrected, 'Boss Brutes').enhancements.find((e) => e.id === thunderbuss.id)?.weapon?.profiles[0].A === '7',
);
const ours = { name: 'Da Gobshot Thunderbuss', kind: 'ranged' as const, profiles: [{ ...thunderbuss.weapon!.profiles[0], D: '3' }] };
const withContribution = await build({
  snapshot,
  authored: { battleSizes: [], referenceTargets: [], effects: [{ target: thunderbussTarget, weapon: ours, reason: 'Ours.' }] },
});
check(
  'une Contribution sur cette Weapon prime sur BSData',
  det(withContribution, 'Boss Brutes').enhancements.find((e) => e.id === thunderbuss.id)?.weapon?.profiles[0].D === '3',
);
check(
  'une Weapon d\'Enhancement BSData sans Enhancement dans le Dataset est signalée',
  first.enhancementWeapons.some((f) => f.kind === 'orphan' && f.enhancement === 'Shiny Rokkit' && f.weapon === 'Shiny Rokkit' && f.armies.includes('orks')),
  JSON.stringify(first.enhancementWeapons),
);
check('une Weapon posée sur une Enhancement n\'est pas orpheline', !first.enhancementWeapons.some((f) => f.kind === 'orphan' && f.weapon === 'Da Gobshot Thunderbuss'));
check('une orpheline est rendue dans le rapport', /## Enhancement Weapons[\s\S]*Shiny Rokkit/.test(renderReport(makeReport(first, undefined))));
check(
  'une datasheet qui porte la Weapon d\'une Enhancement de son Army est signalée',
  first.enhancementWeapons.some((f) => f.kind === 'collision' && f.unit === 'Weirdboy' && f.weapon === 'Da Gobshot Thunderbuss' && f.enhancement === 'Da Gobshot Thunderbuss' && f.armies.includes('orks')),
  JSON.stringify(first.enhancementWeapons),
);
check(
  'une Weapon qui porte seulement le nom d\'une Enhancement sans Weapon ne l\'est pas',
  !first.enhancementWeapons.some((f) => f.weapon === 'Glory Hog'),
);
check('une Unit présente dans plusieurs Armies n\'est signalée qu\'une fois', first.enhancementWeapons.filter((f) => f.unit === 'Weirdboy').length === 1);
check('le Warboss, nettoyé à l\'import, n\'est pas en collision', !first.enhancementWeapons.some((f) => f.unit === 'Warboss'));
check('une collision est rendue dans le rapport', /collision: \*\*Weirdboy\*\* carries `Da Gobshot Thunderbuss`/.test(renderReport(makeReport(first, undefined))));

section('Detachments : schéma, texte et rapport');
check('le fichier d\'Army avec ses Detachments est conforme au schéma', validateFile('army', orks(first)).length === 0, validateFile('army', orks(first)).join(' ; '));
check('la construction ne produit aucun constat de texte', first.textCheck.length === 0, first.textCheck.map((f) => f.where).join(' ; '));
const markdown = renderReport(makeReport(first, undefined));
check('le rapport liste les éléments absents d\'une source', /## Elements missing from a source/.test(markdown));
check('le rapport ne recopie pas le libellé écarté', !/until the end of the phase/.test(markdown));
