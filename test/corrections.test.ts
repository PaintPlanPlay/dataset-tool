/**
 * Les Corrections en fichiers, leur cycle de vie et le rapport de dérive, sur
 * le point de test de construction (issue #58).
 *
 *   npx tsx test/corrections.test.ts
 */
import type { ArmyFile, Unit } from '@paintplanplay/dataset-schema';
import { build, type BuildOutput } from '../src/build.ts';
import { readCorrections, type CorrectionFile } from '../src/corrections/files.ts';
import { diffDatasets, makeReport, renderReport } from '../src/report.ts';
import { openSnapshot } from '../src/snapshot.ts';
import { check, fixture, section } from './check.ts';

const GS = 'wh40k-11e';
const snapshot = openSnapshot(fixture('snapshot'));
const fromFiles = readCorrections(fixture('dataset'), GS);

const unitOf = (out: BuildOutput, army: string, name: string) =>
  (out.files.get(`${GS}/armies/${army}.json`) as ArmyFile).units.find((u) => u.name === name) as Unit;
const verdict = (out: BuildOutput, path: string) => out.corrections.find((c) => c.path.endsWith(path));
const inMemory = (name: string, c: Omit<CorrectionFile, 'path' | 'source' | 'reason'> & Partial<CorrectionFile>): CorrectionFile => ({
  source: 'bsdata',
  reason: 'test',
  path: `corrections/${GS}/orks/${name}.json`,
  ...c,
});

const plain = await build({ snapshot });
const corrected = await build({ snapshot, corrections: fromFiles });

section('Corrections : lecture et application');
check('les Corrections se lisent depuis le dépôt du Dataset', fromFiles.length === 4, fromFiles.map((c) => c.path).join(', '));
check('une Correction en fichier modifie la sortie pour l\'élément visé', unitOf(plain, 'orks', 'Warboss').points === 70 && unitOf(corrected, 'orks', 'Warboss').points === 80);
check('une Correction s\'applique aussi aux Armies qui alignent l\'Unit en alliée', unitOf(corrected, 'orks-freebooterz', 'Warboss').points === 80);
check('un ajout de rattachement se pose par-dessus le MFM', unitOf(corrected, 'orks', 'Warboss').leaderTargets.join(',') === 'Boyz,Nobz');
check('le reste de l\'Unit n\'est pas touché', JSON.stringify(unitOf(corrected, 'orks', 'Warboss').weapons) === JSON.stringify(unitOf(plain, 'orks', 'Warboss').weapons));

section('Corrections : cycle de vie actif / périmé / conflit');
check('active : l\'amont a toujours la valeur corrigée', verdict(corrected, 'warboss-points.json')?.state === 'active');
check('périmée : l\'amont a rejoint la Correction', verdict(corrected, 'boyz-choppa-strength.json')?.state === 'stale');
check(
  'en conflit : l\'amont dit une troisième valeur',
  verdict(corrected, 'mek-gunz-attacks.json')?.state === 'conflict' && verdict(corrected, 'mek-gunz-attacks.json')!.note.includes('troisième valeur'),
);
check('une Correction en conflit reste appliquée en attendant qu\'un humain tranche', unitOf(corrected, 'orks', 'Mek Gunz').weapons[0].A === 'D6+1');
check('un ajout que l\'amont ne porte pas est actif', verdict(corrected, 'warboss-leads-nobz.json')?.state === 'active');
check('une Correction porte le lien de la PR proposée en amont', verdict(corrected, 'warboss-leads-nobz.json')?.upstreamPr === 'https://github.com/BSData/wh40k-11e-mfm/pull/1');

const variants = await build({
  snapshot,
  corrections: [
    inMemory('already-leads', { target: 'u-warboss::attachment:leader|Boyz', patch: { __add: true } }),
    inMemory('weapon-gone', { target: 'u-boyz::weapon:ranged|Shoota', patch: { __delete: true } }),
    inMemory('nob-removed', { target: 'u-boyz::model:Boss Nob', patch: { __delete: true } }),
    inMemory('boss-ability', { target: 'u-warboss::ability:Da Boss Fixture', patch: { __delete: true } }),
    inMemory('ghost-unit', { target: 'u-nothing', patch: { points: 1 } }),
    inMemory('renamed-weapon', { target: 'u-boyz::weapon:melee|Rusty choppa', patch: { S: 5 }, upstream: { S: 4 } }),
  ],
});
check('périmée : un ajout que l\'amont porte désormais', verdict(variants, 'already-leads.json')?.state === 'stale');
check('périmée : un retrait d\'un élément que l\'amont a retiré', verdict(variants, 'weapon-gone.json')?.state === 'stale');
check('active : un retrait de figurine, appliqué', verdict(variants, 'nob-removed.json')?.state === 'active' && unitOf(variants, 'orks', 'Boyz').models.length === 1);
check('une aptitude se retire par son nom', !unitOf(variants, 'orks', 'Warboss').abilities.some((a) => a.name === 'Da Boss Fixture'));
check(
  'une cible disparue est en conflit et signalée orpheline, jamais appliquée en silence',
  verdict(variants, 'ghost-unit.json')?.state === 'conflict' && variants.orphans.some((o) => o.target === 'u-nothing'),
);
check('une arme renommée en amont laisse sa Correction orpheline', variants.orphans.some((o) => o.target === 'u-boyz::weapon:melee|Rusty choppa') && verdict(variants, 'renamed-weapon.json')?.state === 'conflict');
check('une orpheline n\'est signalée qu\'une fois, quelles que soient les Armies', variants.orphans.filter((o) => o.target === 'u-nothing').length === 1);

const surgical = await build({
  snapshot,
  corrections: [
    inMemory('add-nobz', { target: 'u-warboss::attachment:leader|Nobz', patch: { __add: true } }),
    inMemory('drop-boyz', { target: 'u-warboss::attachment:leader|Boyz', patch: { __delete: true } }),
  ],
});
check('retirer une seule cible de meneur garde les autres', unitOf(surgical, 'orks', 'Warboss').leaderTargets.join(',') === 'Nobz');

const withText = await build({
  snapshot,
  corrections: [inMemory('prose', { target: 'u-boyz::ability:Mob Fixture', patch: { text: 'Each time this unit fights, add 1 to the Hit roll.' } })],
});
check('une Correction qui porte du texte de règles fait échouer le contrôle de la construction', withText.textCheck.some((f) => f.where.includes('prose.json')));

section('Rapport de dérive');
const next = new Map(corrected.files);
const orks = structuredClone(next.get(`${GS}/armies/orks.json`)) as ArmyFile;
orks.units = orks.units.filter((u) => u.name !== 'Mek Gunz');
orks.units.push({ ...orks.units[0], id: 'u-new', name: 'Stormboyz' });
next.set(`${GS}/armies/orks.json`, orks);
next.delete(`${GS}/armies/adeptus-custodes.json`);
const diff = diffDatasets(plain.files, next);
check('Units ajoutées et retirées', diff.unitsAdded.some((u) => u.name === 'Stormboyz') && diff.unitsRemoved.some((u) => u.name === 'Mek Gunz'));
check('points changés', diff.changes.some((c) => c.name === 'Warboss' && c.field === 'points' && c.before === '70' && c.after === '80'));
check('Armies disparues', diff.armiesRemoved.join() === 'adeptus-custodes');
check('une Unit alliée ne fait pas doublon dans le rapport', diff.changes.filter((c) => c.name === 'Warboss' && c.field === 'points').length === 1);
check('première construction : rien à comparer', diffDatasets(undefined, plain.files).initial);

const markdown = renderReport(makeReport(corrected, plain.files));
check('le rapport liste les chiffres modifiés', /## Chiffres modifiés/.test(markdown) && /Warboss/.test(markdown));
check('le rapport liste les désaccords entre sources', /## Désaccords entre sources/.test(markdown) && /mfm `75` retenu, bsdata `90` écarté/.test(markdown));
check('le rapport donne l\'état de chaque Correction', /\*\*périmée\*\*/.test(markdown) && /\*\*en conflit\*\*/.test(markdown) && /\*\*active\*\*/.test(markdown));
check('le rapport rappelle la PR amont d\'une Correction', markdown.includes('PR amont : https://github.com/BSData/wh40k-11e-mfm/pull/1'));
check('le rapport ne recopie aucun texte amont', !/FIXTURE-RULES-TEXT/.test(markdown));
