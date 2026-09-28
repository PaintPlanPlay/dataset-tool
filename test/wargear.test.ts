/**
 * Le Wargear Cost porté par la Wargear Option (#121), sur le point de test de
 * construction : un instantané figé et des Corrections entrent, un Dataset et
 * ses findings sortent.
 *
 *   npx tsx test/wargear.test.ts
 */
import type { ArmyFile, Unit, WeaponOption } from '@paintplanplay/dataset-schema';
import { validateFile } from '@paintplanplay/dataset-schema/validate';
import { build, type BuildOutput } from '../src/build.ts';
import { makeReport, renderReport } from '../src/report.ts';
import type { CorrectionFile } from '../src/corrections/files.ts';
import type { AuthoredCore, AuthoredEffect } from '../src/authored.ts';
import { openSnapshot } from '../src/snapshot.ts';
import { check, fixture, section } from './check.ts';

const GS = 'wh40k-11e';
const snapshot = openSnapshot(fixture('snapshot'));

const unitOf = (out: BuildOutput, army: string, name: string) =>
  (out.files.get(`${GS}/armies/${army}.json`) as ArmyFile).units.find((u) => u.name === name) as Unit;
const optionOf = (u: Unit, name: string) => u.optionGroups!.flatMap((g) => g.options).find((o) => o.name === name) as WeaponOption;
const cost = (o: WeaponOption | undefined) => (o?.wargearCost ? `${o.wargearCost.item}×${o.wargearCost.quantity ?? 1}` : 'none');
const finding = (out: BuildOutput, unit: string, item: string) => out.wargear.find((f) => f.unit === unit && f.item === item);

const plain = await build({ snapshot });

section('Wargear Cost : liaison automatique');
{
  const meganobz = unitOf(plain, 'orks', 'Meganobz');
  check('« Twin Killsaws » (MFM) se lie à l\'option « Meganob w/ Twin Killsaw »', cost(optionOf(meganobz, 'Meganob w/ Twin Killsaw')) === 'Twin Killsaws×1', cost(optionOf(meganobz, 'Meganob w/ Twin Killsaw')));
  const exterminator = unitOf(plain, 'astra-militarum', 'Leman Russ Exterminator');
  check('« 2 Multi-meltas » se lie à « Multi-melta » avec une quantité de 2', cost(optionOf(exterminator, '2 Multi-meltas')) === 'Multi-melta×2', cost(optionOf(exterminator, '2 Multi-meltas')));
  check('« 2 Plasma Cannons » se lie à « Plasma cannon », casse ignorée', cost(optionOf(exterminator, '2 Plasma Cannons')) === 'Plasma cannon×2');
  const victrix = unitOf(plain, 'space-marines', 'Victrix Honour Guard');
  check('une ligne se lie par le nom d\'une Weapon de l\'option : « Blades of honour » au Chapter Champion', cost(optionOf(victrix, 'Chapter Champion')) === 'Blades of honour×1');
  const wolves = unitOf(plain, 'space-marines', 'Wolf Guard Terminators');
  check('la forme « … w/ X » : « Storm Shield » à « Wolf Guard Terminator w/ storm shield »', cost(optionOf(wolves, 'Wolf Guard Terminator w/ storm shield')) === 'Storm Shield×1');
  check('le montant n\'est jamais recopié dans l\'option', !JSON.stringify(optionOf(meganobz, 'Meganob w/ Twin Killsaw')).includes('"points"'));
}

section('Wargear Cost : ce qui ne se lie pas est signalé');
{
  const exterminator = unitOf(plain, 'astra-militarum', 'Leman Russ Exterminator');
  check('une ligne qui ne vise qu\'une option par défaut n\'est pas liée', cost(optionOf(exterminator, 'Lascannon')) === 'none');
  check('… et elle est signalée', finding(plain, 'Leman Russ Exterminator', 'Lascannon')?.kind === 'default-only', JSON.stringify(finding(plain, 'Leman Russ Exterminator', 'Lascannon')));
  const ambiguous = finding(plain, 'Leman Russ Exterminator', 'Heavy bolter');
  check(
    'une ligne qui vise plusieurs options est ambiguë, et ne lie aucune',
    ambiguous?.kind === 'ambiguous' && ambiguous.options.join() === 'Heavy bolter,2 Heavy Bolters' &&
      cost(optionOf(exterminator, 'Heavy bolter')) === 'none' && cost(optionOf(exterminator, '2 Heavy Bolters')) === 'none',
    JSON.stringify(ambiguous),
  );
  check('une ligne liée à aucune option est orpheline', finding(plain, 'Leman Russ Exterminator', 'Hunter-killer missile')?.kind === 'orphan');
  check('le Killsaw simple, porté par deux options, est ambigu', finding(plain, 'Meganobz', 'Killsaw')?.kind === 'ambiguous');
  check('la Banner of Macragge, qu\'aucune option BSData ne porte, est orpheline', finding(plain, 'Victrix Honour Guard', 'Banner of Macragge')?.kind === 'orphan');
  check('une ligne liée ne donne aucun finding', !finding(plain, 'Meganobz', 'Twin Killsaws') && !finding(plain, 'Leman Russ Exterminator', 'Multi-melta'));
  check('un finding porte son Army et son Unit', finding(plain, 'Meganobz', 'Killsaw')?.army === 'orks' && finding(plain, 'Meganobz', 'Killsaw')?.unitId === 'u-meganobz');
}

section('Wargear Cost : une Correction de la ligne du MFM');
{
  const meganobz = unitOf(plain, 'orks', 'Meganobz');
  const killsawFree: CorrectionFile = {
    path: `corrections/${GS}/orks/meganobz-killsaw-free.json`,
    target: 'u-meganobz',
    source: 'mfm',
    patch: { wargear: meganobz.wargear!.map((w) => (w.item === 'Killsaw' ? { ...w, points: 0 } : w)) },
    upstream: { wargear: meganobz.wargear },
    reason: 'L\'app officielle laisse le Killsaw simple gratuit',
  };
  const corrected = await build({ snapshot, corrections: [killsawFree] });
  const after = unitOf(corrected, 'orks', 'Meganobz');
  check(
    'le Killsaw simple passe à 0, le Twin Killsaw reste à +5 et reste lié',
    after.wargear!.find((w) => w.item === 'Killsaw')?.points === 0 && after.wargear!.find((w) => w.item === 'Twin Killsaws')?.points === 5 &&
      cost(optionOf(after, 'Meganob w/ Twin Killsaw')) === 'Twin Killsaws×1',
  );
}

section('Wargear Cost : schéma');
{
  const problems = [...plain.files].filter(([p]) => p.includes('/armies/')).flatMap(([p, f]) => validateFile('army', f).map((e) => `${p} ${e}`));
  check('le Dataset construit est valide pour le nouveau schéma', problems.length === 0, problems.slice(0, 3).join(' | '));
}

section('Wargear Cost : le rapport');
{
  const text = renderReport(makeReport(plain, undefined));
  check('le rapport liste les lignes non liées', /## Wargear costs not linked \(\d+\)/.test(text) && text.includes('`Lascannon`: only a default option matches'));
}

section('Wargear Cost : un lien posé à la main (Contribution)');
{
  const authored = (effects: AuthoredEffect[]): AuthoredCore => ({ battleSizes: [], referenceTargets: [], effects });
  const manual = await build({
    snapshot,
    authored: authored([
      // Le Lascannon de coque est payant : lié à la main, sur l'option par défaut.
      { target: 'u-exterminator::option:g-ext-hull|e-ext-lascannon', wargearCost: { item: 'Lascannon' }, reason: 'Le Lascannon de coque est facturé dans l\'app officielle' },
      // Un lien automatique erroné se délie.
      { target: 'u-meganobz::option:g-meganobz|m-mnz-twin', wargearCost: null, reason: 'Test : délier' },
      // Un lien manuel prime sur la proposition : « Heavy bolter » facture la coque.
      { target: 'u-exterminator::option:g-ext-hull|e-ext-hb', wargearCost: { item: 'Heavy bolter' }, reason: 'Test : lever l\'ambiguïté' },
      // Une ligne qui n'existe pas.
      { target: 'u-exterminator::option:g-ext-sponsons|e-ext-2hf', wargearCost: { item: 'Heavy flamer', quantity: 2 }, reason: 'Test : ligne absente' },
    ]),
  });
  const exterminator = unitOf(manual, 'astra-militarum', 'Leman Russ Exterminator');
  check('un lien manuel lie le Lascannon de coque, option par défaut', cost(optionOf(exterminator, 'Lascannon')) === 'Lascannon×1');
  check('… et la ligne n\'est plus signalée', !finding(manual, 'Leman Russ Exterminator', 'Lascannon'));
  check('un lien manuel prime sur la proposition automatique', cost(optionOf(exterminator, 'Heavy bolter')) === 'Heavy bolter×1' && !finding(manual, 'Leman Russ Exterminator', 'Heavy bolter'));
  check('délier à la main supprime un lien automatique', cost(optionOf(unitOf(manual, 'orks', 'Meganobz'), 'Meganob w/ Twin Killsaw')) === 'none');
  const gone = finding(manual, 'Leman Russ Exterminator', 'Heavy flamer');
  check(
    'un lien manuel dont la ligne a disparu est signalé, et ne facture rien',
    gone?.kind === 'missing-line' && gone.target === 'u-exterminator::option:g-ext-sponsons|e-ext-2hf' && cost(optionOf(exterminator, '2 Heavy Flamers')) === 'none',
    JSON.stringify(gone),
  );
  check('les liens manuels sont des Contributions actives', manual.contributions.filter((c) => c.target.includes('::option:') && c.state === 'active').length === 4);
  const ghost = await build({ snapshot, authored: authored([{ target: 'u-exterminator::option:g-gone|e-gone', wargearCost: { item: 'Lascannon' }, reason: 'Test' }]) });
  check('un lien vers une option introuvable est signalé', ghost.contributions.some((c) => c.target === 'u-exterminator::option:g-gone|e-gone' && c.state === 'unresolved'));
}

section('Aptitudes apportées par une Wargear Option');
{
  const authored = (effects: AuthoredEffect[]): AuthoredCore => ({ battleSizes: [], referenceTargets: [], effects });
  const withShield = await build({
    snapshot,
    authored: authored([
      { target: 'u-wolfguard-terminators::option:g-wgt|m-wgt-shield', abilities: ['Storm Shield'], reason: 'Le bouclier apporte l\'aptitude Storm Shield' },
      { target: 'u-meganobz::option:g-meganobz|m-mnz-twin', abilities: ['No Such Ability'], reason: 'Test : aptitude absente' },
    ]),
  });
  const wolves = unitOf(withShield, 'space-marines', 'Wolf Guard Terminators');
  const shield = optionOf(wolves, 'Wolf Guard Terminator w/ storm shield');
  check('l\'aptitude apportée figure sur l\'option', shield.abilities?.join() === 'Storm Shield', JSON.stringify(shield));
  check('une option qui n\'apporte aucune Weapon distincte reste liée à sa ligne et facturée', cost(shield) === 'Storm Shield×1');
  check('l\'aptitude reste une aptitude de l\'Unit', wolves.abilities.some((a) => a.name === 'Storm Shield'));
  const ghost = withShield.contributions.find((c) => c.target === 'u-meganobz::option:g-meganobz|m-mnz-twin');
  check(
    'une aptitude que l\'Unit n\'a pas est signalée, et n\'est pas posée',
    ghost?.state === 'flagged' && ghost.note.includes('No Such Ability') && !optionOf(unitOf(withShield, 'orks', 'Meganobz'), 'Meganob w/ Twin Killsaw').abilities,
    JSON.stringify(ghost),
  );
  const problems = [...withShield.files].filter(([p]) => p.includes('/armies/')).flatMap(([, f]) => validateFile('army', f));
  check('le Dataset reste valide', problems.length === 0, problems.join(' | '));
}

section('Créer une Wargear Option par Contribution');
{
  const authored = (effects: AuthoredEffect[]): AuthoredCore => ({ battleSizes: [], referenceTargets: [], effects });
  const banner: AuthoredEffect = {
    target: 'u-victrix::option:g-victrix|contrib-banner',
    option: {
      name: 'Banner of Macragge',
      weapons: ['ranged|Master-crafted bolt carbine', 'melee|Master-crafted power weapon'],
      maxCarriers: 1,
      isDefault: false,
    },
    wargearCost: { item: 'Banner of Macragge' },
    abilities: ['Banner of Macragge'],
    reason: 'La bannière existe dans l\'app officielle, pas dans BSData',
  };
  const created = await build({ snapshot, authored: authored([banner]) });
  const victrix = unitOf(created, 'space-marines', 'Victrix Honour Guard');
  const option = optionOf(victrix, 'Banner of Macragge');
  check(
    'l\'option créée figure dans le Dataset, dans son groupe, avec ses porteurs, ses Weapons et son aptitude',
    option?.id === 'contrib-banner' && option.maxCarriers === 1 && option.weapons.length === 2 && option.abilities?.join() === 'Banner of Macragge',
    JSON.stringify(option),
  );
  check('la ligne « Banner of Macragge » n\'est plus orpheline une fois liée à l\'option créée', cost(option) === 'Banner of Macragge×1' && !finding(created, 'Victrix Honour Guard', 'Banner of Macragge'));
  check('une option créée est une Contribution active', created.contributions.some((c) => c.target === banner.target && c.state === 'active'));
  const lost = await build({ snapshot, authored: authored([{ ...banner, target: 'u-victrix::option:g-gone|contrib-banner' }]) });
  check(
    'si son groupe disparaît de BSData, un finding le signale',
    lost.contributions.some((c) => c.target === 'u-victrix::option:g-gone|contrib-banner' && c.state === 'unresolved') &&
      !optionOf(unitOf(lost, 'space-marines', 'Victrix Honour Guard'), 'Banner of Macragge') &&
      /## Contributions whose target is gone \(1\)[\s\S]*u-victrix::option:g-gone\|contrib-banner/.test(renderReport(makeReport(lost, undefined))),
  );
  const noWeapon = await build({ snapshot, authored: authored([{ ...banner, option: { ...banner.option!, weapons: [] } }]) });
  check('une Wargear Option peut n\'apporter aucune Weapon', optionOf(unitOf(noWeapon, 'space-marines', 'Victrix Honour Guard'), 'Banner of Macragge')?.weapons.length === 0);
}

section('Une Enhancement qui apporte une Weapon');
{
  const authored = (effects: AuthoredEffect[]): AuthoredCore => ({ battleSizes: [], referenceTargets: [], effects });
  const thunderbuss = {
    name: 'Da Gobshot Thunderbuss',
    kind: 'ranged' as const,
    profiles: [{ name: 'Da Gobshot Thunderbuss', range: '24"', rangeInches: 24, A: '6', skill: 4, S: 7, AP: -2, D: '2', keywords: ['Rapid Fire 6'] }],
  };
  const withWeapon = await build({
    snapshot,
    authored: authored([{ target: 'orks::enhancement:boss-brutes|da-gobshot-thunderbuss', weapon: thunderbuss, reason: 'L\'Enhancement apporte son arme au porteur' }]),
  });
  const enhancement = (withWeapon.files.get(`${GS}/armies/orks.json`) as ArmyFile).detachments
    .find((d) => d.id === 'boss-brutes')!
    .enhancements.find((e) => e.id === 'da-gobshot-thunderbuss');
  check('Da Gobshot Thunderbuss porte sa Weapon, profils compris', enhancement?.weapon?.profiles[0].A === '6' && enhancement.points === 20, JSON.stringify(enhancement));
  check('une Weapon d\'Enhancement est une Contribution active', withWeapon.contributions.some((c) => c.target === 'orks::enhancement:boss-brutes|da-gobshot-thunderbuss' && c.state === 'active'));
  const problems = [...withWeapon.files].filter(([p]) => p.includes('/armies/')).flatMap(([, f]) => validateFile('army', f));
  check('le Dataset reste valide', problems.length === 0, problems.join(' | '));
  const onUnit = await build({ snapshot, authored: authored([{ target: 'u-warboss::ability:Da Boss Fixture', weapon: thunderbuss, reason: 'Test' }]) });
  check('seule une Enhancement apporte une Weapon', onUnit.contributions.some((c) => c.target === 'u-warboss::ability:Da Boss Fixture' && c.state === 'rejected'));
}
