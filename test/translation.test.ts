/**
 * Traduire l'équipement BSData en Wargear Options, motif par motif, sur des
 * datasheets réelles extraites de BSData (fixture `wargear`, sans texte de
 * règles) : un instantané figé entre, un Dataset et ses findings sortent.
 *
 *   npx tsx test/translation.test.ts
 */
import { wargearCap, wargearSentence, type ArmyFile, type Unit, type WargearOption } from '@paintplanplay/dataset-schema';
import { validateFile } from '@paintplanplay/dataset-schema/validate';
import { perModels } from '../src/bsdata/sentences.ts';
import { build } from '../src/build.ts';
import { makeReport, renderReport } from '../src/report.ts';
import { openSnapshot } from '../src/snapshot.ts';
import { check, fixture, section } from './check.ts';

const GS = 'wh40k-11e';
const out = await build({ snapshot: openSnapshot(fixture('wargear')) });
const unitOf = (army: string, name: string) => (out.files.get(`${GS}/armies/${army}.json`) as ArmyFile).units.find((u) => u.name === name) as Unit;
const sentences = (u: Unit) => (u.wargearOptions ?? []).map((o) => {
  const s = wargearSentence(u, o);
  return s.items ? `${s.text} ${s.items.join('; ')}` : s.text;
});
const optionOf = (u: Unit, id: string) => u.wargearOptions?.find((o) => o.id === id) as WargearOption;
const carried = (u: Unit, type: string) => u.modelTypes?.find((t) => t.name === type)?.defaultWargear.map((w) => w.weapon.slice(w.weapon.indexOf('|') + 1)).sort().join(', ');

section('Le Dataset reste conforme');
{
  const invalid = [...out.files].flatMap(([path, data]) => (path.includes('/armies/') ? validateFile('army', data).map((e) => `${path} ${e}`) : []));
  check('toutes les Armies valident contre le schéma', invalid.length === 0, invalid.slice(0, 3).join(' | '));
}

section('Un groupe avec un défaut : le Warboss');
{
  const boss = unitOf('orks', 'Warboss');
  check('« This model’s Kustom Choppa can be replaced with 1 Power Klaw. »', sentences(boss).includes('This model’s Kustom Choppa can be replaced with 1 Power Klaw.'), sentences(boss).join(' / '));
  check('« one of the following » pour le Kustom Shoota', sentences(boss).includes('This model’s Kustom Shoota can be replaced with one of the following: 1 Kombi-skorcha; 1 Kombi-rokkit'));
  check('aucune Weapon d\'Enhancement dans son Default Wargear', carried(boss, 'Warboss') === 'Kustom Choppa, Kustom Shoota', carried(boss, 'Warboss'));
}

section('Un pool de configurations : les Nobz');
{
  const nobz = unitOf('orks', 'Nobz');
  check('le type Nob et son Default Wargear', carried(nobz, 'Nob') === 'Kustom Krumpa, Kustom Shoota', carried(nobz, 'Nob'));
  check(
    '« Any number of models… Kombi-rokkit », à l\'identifiant de sa configuration',
    optionOf(nobz, 'e4b1-2a15-2843-283a')?.who.type === 'each' && sentences(nobz).includes('Any number of models can each have their Kustom Shoota replaced with 1 Kombi-rokkit.'),
    sentences(nobz).join(' / '),
  );
}

section('« k for every N » et limites posées sur les entrées : les armes spéciales des Nobz');
{
  const nobz = unitOf('orks', 'Nobz');
  const skorcha = optionOf(nobz, '41b9-8766-6685-5634');
  check('le Big Skorcha n\'est plus perdu', Boolean(skorcha), JSON.stringify(nobz.wargearOptions?.map((o) => o.id)));
  check('« 1 pour 5 figurines », lu dans « max 1 par Unit, 2 à partir de 10 »', skorcha?.who.type === 'per' && skorcha.who.models === 1 && skorcha.who.every === 5, JSON.stringify(skorcha?.who));
  check(
    'la phrase de la fiche, deux Weapons contre deux',
    sentences(nobz).includes('For every 5 models in this unit, 1 model can have its Kustom Krumpa and Kustom Shoota replaced with 1 Big Skorcha and 1 Kustom Choppa.'),
    sentences(nobz).join(' / '),
  );
  check('ses quatre armes spéciales', (nobz.wargearOptions ?? []).filter((o) => o.who.type === 'per').length === 4);
  check('une alternative sans Weapon se nomme : « Paired Krumpas »', (nobz.wargearOptions ?? []).some((o) => o.alternatives[0].weapons.length === 0 && o.alternatives[0].name === 'Paired Krumpas'));
  check('plafond : 1 à 5 figurines, 2 à 10', wargearCap(nobz, skorcha, 5) === 1 && wargearCap(nobz, skorcha, 10) === 2);
  check('rien de la lecture de BSData ne fuit dans le Dataset', !JSON.stringify(nobz).includes('unitCap') && !('optionGroups' in nobz));
}

section('Un pool qui puise dans un autre, budget commun : les Boyz');
{
  const boyz = unitOf('orks', 'Boyz');
  check('des Boyz et des Nobz', boyz.modelTypes?.map((t) => t.name).sort().join() === 'Boy,Nob', JSON.stringify(boyz.modelTypes?.map((t) => t.name)));
  check(
    '« For every 10 models… 3 Boy models… one of the following »',
    sentences(boyz).includes('For every 10 models in this unit, 3 Boy models can each have their Shoota replaced with one of the following: 1 Big Shoota (up to 2); 1 Rokkit Launcha (up to 2); 1 Burna (up to 2)'),
    sentences(boyz).join(' / '),
  );
  const special = boyz.wargearOptions?.find((o) => o.alternatives.some((a) => a.name === 'Rokkit Launcha'));
  check('une configuration plafonnée en deçà du budget commun garde son plafond', special?.alternatives.every((a) => a.max === 2) === true && wargearCap(boyz, special!, 20) === 6, JSON.stringify(special));
  check('un sous-choix du Nob est une phrase à part', sentences(boyz).includes('Any number of Nob models can each have their Kustom Choppa replaced with 1 Power Klaw.'));
}

section('Groupes imbriqués : les Intercessors');
{
  const squad = unitOf('space-marines', 'Intercessor Squad');
  check('un Sergeant et des Intercessors', squad.modelTypes?.map((t) => t.name).sort().join() === 'Intercessor,Intercessor Sergeant');
  check('« Up to 2 Intercessor models can each be equipped with 1 Grenade Launcher. »', sentences(squad).includes('Up to 2 Intercessor models can each be equipped with 1 Grenade Launcher.'), sentences(squad).join(' / '));
  check('les choix du Sergeant le visent', sentences(squad).some((s) => s.startsWith('The Intercessor Sergeant’s Bolt Rifle can be replaced with one of the following')));
}

section('Des ajouts : le Battlewagon');
{
  const wagon = unitOf('orks', 'Battlewagon');
  check('son Default Wargear : le seul Crushin\' Bulk', carried(wagon, 'Battlewagon') === "Crushin' Bulk", carried(wagon, 'Battlewagon'));
  check('« This model can be equipped with up to 4 Big Shootas. »', sentences(wagon).includes('This model can be equipped with up to 4 Big Shootas.'), sentences(wagon).join(' / '));
  check('la Grabbin\' Klaw et le Wreckin\' Ball, un chacun', sentences(wagon).includes("This model can be equipped with 1 Grabbin' Klaw.") && sentences(wagon).includes("This model can be equipped with 1 Wreckin' Ball."));
}

section('Ce que l\'import ne sait pas lire : le Captain');
{
  const captain = unitOf('space-marines', 'Captain');
  check('aucune Wargear Option publiée, plutôt qu\'une fausse', !captain.wargearOptions?.length);
  const todo = out.wargearToWrite.find((w) => w.unitId === captain.id);
  check('un constat « options à écrire », par groupe et raison', Boolean(todo?.groups.length) && todo!.army === 'space-marines', JSON.stringify(todo));
  check('les Units traduites n\'y sont pas', !out.wargearToWrite.some((w) => w.unit === 'Nobz' || w.unit === 'Warboss'));
  const report = renderReport(makeReport(out, undefined));
  check('le rapport de construction les compte', report.includes('## Wargear options to write (1)') && report.includes('**Captain**'), report.slice(report.indexOf('## Wargear options'), report.indexOf('## Wargear options') + 200));
}

section('« k pour N », lu dans des paliers');
check('1 à 5, 2 à 10 : 1 pour 5', JSON.stringify(perModels(1, 5, [{ atModels: 10, max: 2 }])) === JSON.stringify({ type: 'per', models: 1, every: 5 }));
check('3 à 10, 6 à 20 : 3 pour 10', JSON.stringify(perModels(3, 10, [{ atModels: 20, max: 6 }])) === JSON.stringify({ type: 'per', models: 3, every: 10 }));
check('1 à 5, 3 à 10 : aucune tranche ne tombe juste', perModels(1, 5, [{ atModels: 10, max: 3 }]) === null);
