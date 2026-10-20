/**
 * Les Wargear Options en phrases, sur le point de test de construction : un
 * instantané BSData figé entre, un Dataset sort, avec pour chaque Unit ses
 * types de figurine (Default Wargear compris) et ses Wargear Options. Puis la
 * phrase, régénérée de ses parties.
 *
 *   npx tsx test/sentences.test.ts
 */
import { wargearCap, wargearSentence, modelsOfTypes, type ArmyFile, type Unit, type WargearOption } from '@paintplanplay/dataset-schema';
import { validateFile } from '@paintplanplay/dataset-schema/validate';
import { build } from '../src/build.ts';
import { openSnapshot } from '../src/snapshot.ts';
import { check, fixture, section } from './check.ts';

const GS = 'wh40k-11e';
const out = await build({ snapshot: openSnapshot(fixture('snapshot')) });
const unitOf = (army: string, name: string) => (out.files.get(`${GS}/armies/${army}.json`) as ArmyFile).units.find((u) => u.name === name) as Unit;

section('La nouvelle forme, à côté de l\'ancienne');
{
  const invalid = [...out.files].flatMap(([path, data]) => (path.includes('/armies/') ? validateFile('army', data).map((e) => `${path} ${e}`) : []));
  check('le Dataset valide contre le schéma, les deux formes ensemble', invalid.length === 0, invalid.slice(0, 3).join(' | '));
  const boss = unitOf('orks', 'Warboss');
  check('l\'ancienne forme est toujours publiée', Boolean(boss.optionGroups?.length && boss.defaultLoadout?.length));
}

section('Le Warboss : un groupe avec un défaut, un seul choix');
{
  const boss = unitOf('orks', 'Warboss');
  const type = boss.modelTypes?.[0];
  check('un seul type de figurine, le Warboss, de 1 à 1', boss.modelTypes?.length === 1 && type?.name === 'Warboss' && type.min === 1 && type.max === 1, JSON.stringify(boss.modelTypes));
  const carried = type?.defaultWargear.map((w) => `${w.count} ${w.weapon}`) ?? [];
  check('son Default Wargear, par figurine', carried.includes('1 melee|Big choppa') && carried.includes('1 ranged|Kombi-rokkit') && !carried.includes('1 ranged|Slugga'), carried.join(', '));
  const option = boss.wargearOptions?.[0];
  check(
    'une Wargear Option « replace » à l\'identifiant BSData de son groupe',
    boss.wargearOptions?.length === 1 && option?.id === 'g-warboss-gun' && option.model === 'Warboss' && option.who.type === 'each' && option.replaces.map((w) => w.weapon).join() === 'ranged|Kombi-rokkit',
    JSON.stringify(boss.wargearOptions),
  );
  check('sa Wargear Alternative à l\'identifiant de son entrée', option?.alternatives.length === 1 && option.alternatives[0].id === 'e-slugga' && option.alternatives[0].weapons.map((w) => w.weapon).join() === 'ranged|Slugga');
  check('la phrase de la fiche', option ? wargearSentence(boss, option).text === 'This model’s Kombi-rokkit can be replaced with 1 Slugga.' : false, option ? wargearSentence(boss, option).text : '');
}

section('Une Unit sans composition prend ses types dans les entrées de figurine');
{
  const meganobz = unitOf('orks', 'Meganobz');
  check('« Meganob w/ … » est un Meganob', meganobz.modelTypes?.map((t) => t.name).join() === 'Meganob', JSON.stringify(meganobz.modelTypes?.map((t) => t.name)));
  check('à l\'effectif de l\'Unit', meganobz.modelTypes?.[0].min === meganobz.minModels && meganobz.modelTypes?.[0].max === meganobz.maxModels);
  const boyz = unitOf('orks', 'Boyz');
  check('les Boyz : des Boyz et un Boss Nob, chacun son Default Wargear', boyz.modelTypes?.map((t) => t.name).sort().join() === 'Boss Nob,Boy', JSON.stringify(boyz.modelTypes));
}

section('La phrase, régénérée de ses parties');
{
  const solo = { name: 'Battlewagon', minModels: 1, maxModels: 1 };
  const squad = { name: 'Nobz', minModels: 5, maxModels: 10, modelTypes: [{ name: 'Nob', min: 5, max: 10, defaultWargear: [] }] };
  const boyz = {
    name: 'Boyz',
    minModels: 10,
    maxModels: 20,
    modelTypes: [
      { name: 'Boy', min: 9, max: 18, defaultWargear: [] },
      { name: 'Boss Nob', min: 1, max: 1, defaultWargear: [] },
    ],
  };
  const w = (weapon: string, count = 1) => ({ weapon, count });
  const say = (u: Parameters<typeof wargearSentence>[0], o: WargearOption) => {
    const s = wargearSentence(u, o);
    return s.items ? `${s.text} ${s.items.join('; ')}` : s.text;
  };
  const equip: WargearOption = { id: 'a', model: 'Battlewagon', who: { type: 'each' }, replaces: [], upTo: 4, alternatives: [{ id: 'x', weapons: [w('ranged|Big Shoota')] }] };
  check('un ajout, jusqu\'à 4 fois', say(solo, equip) === 'This model can be equipped with up to 4 Big Shootas.', say(solo, equip));
  const any: WargearOption = { id: 'b', model: 'Nob', who: { type: 'each' }, replaces: [w('ranged|Kustom Shoota')], alternatives: [{ id: 'y', weapons: [w('ranged|Kombi-rokkit')] }] };
  check('« any number of models »', say(squad, any) === 'Any number of models can each have their Kustom Shoota replaced with 1 Kombi-rokkit.', say(squad, any));
  const per: WargearOption = {
    id: 'c',
    model: 'Nob',
    who: { type: 'per', models: 1, every: 5 },
    replaces: [w('ranged|Kustom Shoota'), w('melee|Kustom Krumpa')],
    alternatives: [{ id: 'z', weapons: [w('ranged|Big Skorcha'), w('melee|Kustom Choppa')] }],
  };
  check(
    '« for every 5 models », deux Weapons contre deux',
    say(squad, per) === 'For every 5 models in this unit, 1 model can have its Kustom Shoota and Kustom Krumpa replaced with 1 Big Skorcha and 1 Kustom Choppa.',
    say(squad, per),
  );
  const named: WargearOption = { id: 'd', model: 'Boss Nob', who: { type: 'each' }, replaces: [w('melee|Big Choppa')], alternatives: [{ id: 'p', weapons: [w('melee|Power Klaw')] }, { id: 'q', weapons: [w('melee|Kustom Choppa')] }] };
  check('un type nommé, « one of the following »', say(boyz, named) === 'The Boss Nob’s Big Choppa can be replaced with one of the following: 1 Power Klaw; 1 Kustom Choppa', say(boyz, named));
  const upto: WargearOption = { id: 'e', model: 'Boy', who: { type: 'up-to', models: 2 }, replaces: [w('ranged|Slugga')], alternatives: [{ id: 'r', weapons: [w('ranged|Rokkit Launcha')] }] };
  check('« up to 2 » d\'un type parmi d\'autres', say(boyz, upto) === 'Up to 2 Boy models can each have their Slugga replaced with 1 Rokkit Launcha.', say(boyz, upto));
  const banner: WargearOption = { id: 'f', model: 'Boy', who: { type: 'up-to', models: 1 }, replaces: [], alternatives: [{ id: 's', weapons: [], name: 'Waaagh! banner' }] };
  check('une alternative sans Weapon, nommée', say(boyz, banner) === '1 Boy model can be equipped with Waaagh! banner.', say(boyz, banner));

  section('Combien de figurines, combien de fois');
  check('à 20, 19 Boyz et 1 Boss Nob, borné à son maximum', modelsOfTypes(boyz, 20).get('Boy') === 19 && modelsOfTypes(boyz, 20).get('Boss Nob') === 1, JSON.stringify([...modelsOfTypes(boyz, 20)]));
  const twoNobs = { ...boyz, modelTypes: [boyz.modelTypes[0], { ...boyz.modelTypes[1], max: 2 }] };
  check('le type qui complète s\'arrête à son maximum, les autres prennent le reste', modelsOfTypes(twoNobs, 20).get('Boy') === 18 && modelsOfTypes(twoNobs, 20).get('Boss Nob') === 2);
  check('à 10, 9 Boyz et 1 Boss Nob', modelsOfTypes(twoNobs, 10).get('Boy') === 9 && modelsOfTypes(twoNobs, 10).get('Boss Nob') === 1);
  check('« for every 5 » : 1 à 5 figurines, 2 à 10', wargearCap(squad, per, 5) === 1 && wargearCap(squad, per, 10) === 2);
  check('« any number » : toutes les figurines du type', wargearCap(squad, any, 7) === 7);
  check('« up to 4 » sur une figurine seule : 4', wargearCap(solo, equip, 1) === 4);
}
