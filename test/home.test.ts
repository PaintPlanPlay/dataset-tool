/**
 * Point de test « construction d'une Dataset Release » : une Contribution sur
 * un élément que plusieurs Armies publient s'écrit une fois, sous son Army
 * d'origine, et vaut partout ; les Contributions se rangent par Army.
 *
 * La fixture : les Freebooterz reprennent le Detachment War Horde, ses
 * Stratagems, l'Army Rule Waaagh! et les datasheets des Orks.
 *
 *   npx tsx test/home.test.ts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArmyFile } from '@paintplanplay/dataset-schema';
import { layoutContributions, readAuthored, readContributions, type AuthoredCore, type AuthoredEffect } from '../src/authored.ts';
import { build } from '../src/build.ts';
import { toJson } from '../src/dataset.ts';
import { homes } from '../src/home.ts';
import { rulesIn } from '../src/rules.ts';
import { openSnapshot } from '../src/snapshot.ts';
import { check, fixture, section } from './check.ts';

const snapshot = openSnapshot(fixture('snapshot'));
const authored = (effects: AuthoredEffect[]): AuthoredCore => ({ battleSizes: [], referenceTargets: [], effects });
const army = (files: Map<string, unknown>, id: string) => files.get(`wh40k-11e/armies/${id}.json`) as ArmyFile;
const ruleIn = (a: ArmyFile) => a.detachments.find((d) => d.id === 'war-horde')!.rules.find((r) => r.id === 'get-stuck-in')!;

const bare = await build({ snapshot });

section('Army d\'origine : le Codex qui possède le plus de datasheets');
{
  const h = homes(bare.files);
  check('un Detachment repris par les Freebooterz appartient aux Orks', h.homeOf('orks-freebooterz::rule:war-horde|get-stuck-in') === 'orks');
  check('son adresse se réécrit sous les Orks', h.canonical('orks-freebooterz::rule:war-horde|get-stuck-in') === 'orks::rule:war-horde|get-stuck-in');
  check('un Stratagem aussi', h.canonical('orks-freebooterz::stratagem:ere-we-go') === 'orks::stratagem:ere-we-go');
  check('une Army Rule aussi', h.canonical('orks-freebooterz::armyrule:waaagh') === 'orks::armyrule:waaagh');
  check('une Unit appartient à l\'Army où elle n\'est pas alliée', h.homeOf('u-navigator::ability:Navigator') === 'agents-of-the-imperium');
  check('une adresse d\'Unit ne se réécrit pas', h.canonical('u-boyz::ability:Mob Fixture') === 'u-boyz::ability:Mob Fixture');
  check('un élément introuvable n\'a pas d\'Army d\'origine', h.homeOf('orks::rule:war-horde|nothing') === undefined && h.holders('orks::rule:war-horde|nothing').length === 0);
  check('un Stratagem Core reste au cœur', h.homeOf('core::stratagem:command-re-roll') === 'core');
  const shared = rulesIn(bare.files).filter((r) => r.body.name === ruleIn(army(bare.files, 'orks')).name);
  check('la Rule partagée n\'est listée qu\'une fois, sous les Orks', shared.length === 1 && shared[0].target === 'orks::rule:war-horde|get-stuck-in' && shared[0].army === 'orks', JSON.stringify(shared.map((r) => r.target)));
}

section('Écrite une fois sous l\'Army d\'origine, une Contribution vaut partout');
{
  const out = await build({
    snapshot,
    authored: authored([
      { target: 'orks::rule:war-horde|get-stuck-in', summary: 'Sustained Hits 1 in melee', reason: 'Describe the War Horde rule.' },
      { target: 'orks::stratagem:ere-we-go', summary: 'Advance and charge', reason: 'Describe the stratagem.' },
      { target: 'orks::armyrule:waaagh', summary: 'Once per battle: charge after advancing', reason: 'Describe the army rule.' },
      { target: 'u-boyz::ability:Mob Fixture', summary: 'Bigger mob, better hits', reason: 'Describe the Boyz.' },
    ]),
  });
  const orks = army(out.files, 'orks');
  const free = army(out.files, 'orks-freebooterz');
  check('la Detachment Rule chez les Orks', ruleIn(orks).summary === 'Sustained Hits 1 in melee');
  check('… et chez les Freebooterz qui reprennent le Detachment', ruleIn(free).summary === 'Sustained Hits 1 in melee');
  check('le Stratagem dans les deux Armies', [orks, free].every((a) => a.stratagems.find((s) => s.id === 'ere-we-go')?.summary === 'Advance and charge'));
  check('l\'Army Rule dans les deux Armies', [orks, free].every((a) => a.armyRules?.find((r) => r.id === 'waaagh')?.summary === 'Once per battle: charge after advancing'));
  check('l\'aptitude d\'une Unit, alliée comprise', [orks, free].every((a) => a.units.find((u) => u.id === 'u-boyz')?.abilities.find((x) => x.name === 'Mob Fixture')?.summary === 'Bigger mob, better hits'));
  check('toutes actives', out.contributions.every((c) => c.state === 'active'), JSON.stringify(out.contributions));
}

section('Un même élément ne se décrit qu\'une fois');
{
  const out = await build({
    snapshot,
    authored: authored([
      { target: 'orks::rule:war-horde|get-stuck-in', summary: 'Sustained Hits 1 in melee', reason: 'Describe the War Horde rule.' },
      { target: 'orks-freebooterz::rule:war-horde|get-stuck-in', summary: 'Lethal Hits in melee', reason: 'A second reading.' },
    ]),
  });
  const second = out.contributions.find((c) => c.target.startsWith('orks-freebooterz'));
  check('la seconde, sous une autre Army, est refusée', second?.state === 'rejected' && second.note.includes('orks::rule:war-horde|get-stuck-in'), JSON.stringify(second));
  check('la première vaut partout', ruleIn(army(out.files, 'orks-freebooterz')).summary === 'Sustained Hits 1 in melee');
}

section('Les Contributions se rangent dans le fichier de leur Army d\'origine');
{
  const effects: AuthoredEffect[] = [
    { target: 'orks-freebooterz::rule:war-horde|get-stuck-in', summary: 'Sustained Hits 1 in melee', reason: 'Describe the War Horde rule.' },
    { target: 'u-navigator::ability:Navigator', summary: 'Moves units around', reason: 'Describe the Navigator.' },
    { target: 'core::stratagem:command-re-roll', summary: 'Re-roll one roll', reason: 'Describe a Core Stratagem.' },
    { target: 'orks::rule:war-horde|gone', summary: 'Lost', reason: 'Its rule is gone.' },
  ];
  const previous = new Map([
    ['authored/wh40k-11e/effects.json', effects],
    ['authored/wh40k-11e/armies/astra-militarum.json', [] as AuthoredEffect[]],
  ]);
  const layout = layoutContributions('wh40k-11e', effects, bare.files, previous);
  const at = (army: string) => layout.get(`authored/wh40k-11e/armies/${army}.json`)?.map((e) => e.target) ?? [];
  check('la Rule partagée chez les Orks, sous leur adresse', at('orks').includes('orks::rule:war-horde|get-stuck-in'), JSON.stringify([...layout.keys()]));
  check('l\'aptitude chez l\'Army qui possède l\'Unit', at('agents-of-the-imperium').join() === 'u-navigator::ability:Navigator');
  check('le Stratagem Core dans son propre fichier', at('core').join() === 'core::stratagem:command-re-roll');
  check('une cible introuvable reste où elle était', layout.get('authored/wh40k-11e/effects.json')?.map((e) => e.target).join() === 'orks::rule:war-horde|gone');
  check('un fichier qui n\'a plus rien à porter disparaît', layout.get('authored/wh40k-11e/armies/astra-militarum.json') === null);
}

section('Le dépôt se lit tous fichiers confondus, l\'ancien effects.json compris');
{
  const dir = mkdtempSync(join(tmpdir(), 'dataset-home-'));
  try {
    const write = (path: string, data: unknown) => {
      mkdirSync(join(dir, path, '..'), { recursive: true });
      writeFileSync(join(dir, path), toJson(data));
    };
    write('authored/wh40k-11e/effects.json', [{ target: 'u-boyz::ability:Mob Fixture', summary: 'Bigger mob', reason: 'Old file.' }]);
    write('authored/wh40k-11e/armies/orks.json', [{ target: 'orks::armyrule:waaagh', summary: 'Charge after advancing', reason: 'New file.' }]);
    write('authored/wh40k-11e/battle-sizes.json', []);
    const targets = readContributions(dir, 'wh40k-11e').map((e) => e.target).sort();
    check('les deux fichiers sont lus', targets.join() === 'orks::armyrule:waaagh,u-boyz::ability:Mob Fixture', targets.join());
    check('et passent à la construction', readAuthored(dir, 'wh40k-11e')?.effects?.length === 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
