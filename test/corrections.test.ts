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
  verdict(corrected, 'mek-gunz-attacks.json')?.state === 'conflict' && verdict(corrected, 'mek-gunz-attacks.json')!.note.includes('third value'),
);
check('une Correction en conflit reste appliquée en attendant qu\'un humain tranche', unitOf(corrected, 'orks', 'Mek Gunz').weapons[0].profiles[0].A === 'D6+1');
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

section('Corrections : Weapon entière, Faction Keywords et Army Rules');
const kombiProfiles = unitOf(plain, 'orks', 'Warboss').weapons.find((w) => w.name === 'Kombi-rokkit')!.profiles;
const reshaped = await build({
  snapshot,
  corrections: [
    inMemory('kombi-shoota', {
      target: 'u-warboss::weapon:ranged|Kombi-rokkit',
      patch: { profiles: kombiProfiles.map((p) => (p.name === 'Shoota' ? { ...p, S: 5 } : p)) },
      upstream: { profiles: kombiProfiles },
    }),
    inMemory('old-profile-address', { target: 'u-warboss::weapon:ranged|➤ Kombi-rokkit - Shoota', patch: { __delete: true } }),
    inMemory('free-faction', { target: 'u-boyz', patch: { factionKeywords: ['Orks', 'Freebooterz'] }, upstream: { factionKeywords: ['Orks'] } }),
    inMemory('no-waaagh', { target: 'u-warboss', patch: { armyRules: [] }, upstream: { armyRules: ['Waaagh!'] } }),
  ],
});
const kombiAfter = unitOf(reshaped, 'orks', 'Warboss').weapons.find((w) => w.name === 'Kombi-rokkit');
check(
  'une Correction vise la Weapon entière, profils compris',
  kombiAfter?.profiles.map((p) => `${p.name}:S${p.S}`).join(',') === 'Busta Rokkit:S9,Shoota:S5' && verdict(reshaped, 'kombi-shoota.json')?.state === 'active',
);
check('une adresse de profil ne vise plus rien', verdict(reshaped, 'old-profile-address.json')?.state === 'stale' && kombiAfter?.profiles.length === 2);
check('une Correction peut viser les Faction Keywords', unitOf(reshaped, 'orks', 'Boyz').factionKeywords.join() === 'Orks,Freebooterz' && verdict(reshaped, 'free-faction.json')?.state === 'active');
check('une Correction peut viser les Army Rules', unitOf(reshaped, 'orks', 'Warboss').armyRules.length === 0 && verdict(reshaped, 'no-waaagh.json')?.state === 'active');

section('Corrections : les champs dérivés suivent');
const boyzPlain = unitOf(plain, 'orks', 'Boyz');
const derived = await build({
  snapshot,
  corrections: [
    inMemory('boyz-pricing', {
      target: 'u-boyz',
      source: 'mfm',
      patch: { pricing: [{ from: 1, to: null, costs: [{ models: 10, points: 70 }, { models: 20, points: 140 }] }] },
      upstream: { pricing: boyzPlain.pricing },
    }),
    inMemory('boyz-composition', {
      target: 'u-boyz',
      patch: { composition: [{ name: 'Boy', min: 8, max: 18 }, { name: 'Boss Nob', min: 1, max: 1 }] },
      upstream: { composition: boyzPlain.composition },
    }),
    inMemory('choppa-range', {
      target: 'u-boyz::weapon:melee|Choppa',
      patch: { profiles: [{ ...boyzPlain.weapons.find((w) => w.name === 'Choppa')!.profiles[0], range: '6"', rangeInches: 0 }] },
    }),
  ],
});
const boyzDerived = unitOf(derived, 'orks', 'Boyz');
check(
  'points de base et paliers suivent la grille de prix corrigée',
  boyzDerived.points === 70 && JSON.stringify(boyzDerived.costBrackets) === JSON.stringify([{ overModels: 10, points: 140 }]),
  `${boyzDerived.points} ${JSON.stringify(boyzDerived.costBrackets)}`,
);
check('les effectifs suivent la composition corrigée', boyzDerived.minModels === 9 && boyzDerived.maxModels === 19, `${boyzDerived.minModels}-${boyzDerived.maxModels}`);
check('la portée en pouces suit la portée', boyzDerived.weapons.find((w) => w.name === 'Choppa')!.profiles[0].rangeInches === 6);

section('Corrections : un champ que l\'amont ne donne pas');
const absent = await build({
  snapshot,
  corrections: [
    inMemory('gunz-options', {
      target: 'u-mekgunz',
      patch: { optionGroups: [{ id: 'g', name: 'Gun', tree: 'g', parent: '', slot: '', pool: false, minPicks: 0, maxPicks: 1, pickBrackets: [], options: [] }] },
      upstream: {},
    }),
  ],
});
check('un champ absent de l\'amont n\'est pas « une troisième valeur » : la Correction reste active', verdict(absent, 'gunz-options.json')?.state === 'active', JSON.stringify(verdict(absent, 'gunz-options.json')));

section('Corrections : les unités se déduisent');
const unitless = await build({
  snapshot,
  corrections: [
    inMemory('kaptin', { target: 'u-boyz::model:Kaptin', patch: { __add: true, M: '6', T: 5, Sv: 4, Inv: 7, W: 3, LD: '7', OC: 1 } }),
    inMemory('gun-range', {
      target: 'u-mekgunz::weapon:ranged|Kustom mega-kannon',
      patch: { profiles: [{ name: 'Kustom mega-kannon', range: '30', rangeInches: 0, A: 'D6', skill: 5, S: 12, AP: -2, D: 'D6', keywords: [] }] },
    }),
  ],
});
const kaptin = unitOf(unitless, 'orks', 'Boyz').models.find((m) => m.name === 'Kaptin');
const kannon = unitOf(unitless, 'orks', 'Mek Gunz').weapons[0].profiles[0];
check('« 6 » se lit 6", « 7 » se lit 7+ : on n\'a pas à les taper', kaptin?.M === '6"' && kaptin.LD === '7+', JSON.stringify(kaptin));
check('une portée « 30 » se lit 30", 30 pouces', kannon.range === '30"' && kannon.rangeInches === 30, JSON.stringify(kannon));

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
const older = new Map(plain.files);
older.set(`${GS}/index.json`, { ...(plain.files.get(`${GS}/index.json`) as object), schemaVersion: '0.7.0' });
older.set(`${GS}/armies/orks.json`, { units: [{ id: 'u-boyz', weapons: [{ name: 'Choppa', kind: 'melee', S: 4 }] }] });
check(
  'un Dataset d\'une autre version majeure du schéma ne se compare pas',
  diffDatasets(older, plain.files).schemaChange?.from === '0.7.0' && /Schema 0\.7\.0 → /.test(renderReport(makeReport(corrected, older))),
);

const markdown = renderReport(makeReport(corrected, plain.files));
check('le rapport liste les chiffres modifiés', /## Numbers changed/.test(markdown) && /Warboss/.test(markdown));
check('le rapport liste les désaccords entre sources', /## Disagreements between sources/.test(markdown) && /mfm `75` kept, bsdata `90` set aside/.test(markdown));
check('le rapport donne l\'état de chaque Correction', /\*\*stale\*\*/.test(markdown) && /\*\*in conflict\*\*/.test(markdown) && /\*\*active\*\*/.test(markdown));
check('le rapport rappelle la PR amont d\'une Correction', markdown.includes('upstream PR: https://github.com/BSData/wh40k-11e-mfm/pull/1'));
check('le rapport ne recopie aucun texte amont', !/FIXTURE-RULES-TEXT/.test(markdown));
