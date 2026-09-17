/**
 * Le contrôle « aucun texte de règles » et la validation contre le schéma,
 * sur des exemples littéraux (issue #59).
 *
 *   npx tsx test/check.test.ts
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ArmyFile } from '@paintplanplay/dataset-schema';
import { build } from '../src/build.ts';
import { checkDataset } from '../src/check.ts';
import { toJson, writeDataset } from '../src/dataset.ts';
import { findRulesText, inspectString } from '../src/notext.ts';
import { openSnapshot } from '../src/snapshot.ts';
import { check, fixture, section } from './check.ts';

const GS = 'wh40k-11e';

section('Contrôle : chaînes acceptées');
for (const accepted of [
  'Anti-Infantry 4+',
  'Big choppa, kombi-rokkit and kombi-shoota',
  "Keep Huntin'! (Once per battle round, per army)",
  'once-per-battle',
  '+1 to hit in melee while Waaagh! is active',
  '1 Runtherd, 20 Gretchin',
]) check(`« ${accepted} »`, inspectString(accepted).length === 0, inspectString(accepted).join(' ; '));

section('Contrôle : formulations de règles refusées');
for (const rejected of [
  'Each time a model in this unit makes a melee attack, add 1 to the Hit roll.',
  'Until the end of the phase, improve the Armour Penetration characteristic of that weapon by 1.',
  'You can re-roll the Charge roll.',
  'Select one unit from your army that is within 6" of this model.',
  'In your Shooting phase, roll one D6 for each enemy unit.',
  'While this unit is leading a unit, models in that unit have the Feel No Pain 5+ ability.',
]) check(`refusé : « ${rejected.slice(0, 50)}… »`, inspectString(rejected).length > 0);
const longProse = Array.from({ length: 40 }, (_, i) => `mot${i}`).join(' ');
check('une prose longue est refusée même sans formulation connue', inspectString(longProse).some((r) => r.startsWith('long prose')));
check('un résumé au-delà d\'une ligne est refusé', inspectString('x'.repeat(170), { summary: true }).some((r) => r.startsWith('summary too long')));
check('une clé de texte est refusée, quel que soit son contenu', findRulesText({ abilities: [{ name: 'Waaagh!', text: 'court' }] }).some((f) => f.reason.includes('text key')));

section('Contrôle : commande sur un dépôt de Dataset');
const out = await build({ snapshot: openSnapshot(fixture('snapshot')) });
check('la construction normale ne produit aucun constat', out.textCheck.length === 0, out.textCheck.map((f) => f.where).join(' ; '));

const withDataset = (mutate: (dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), 'check-'));
  try {
    writeDataset(dir, GS, out.files, out.ids);
    mutate(dir);
    return checkDataset(dir, GS);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const put = (dir: string, path: string, data: unknown) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), toJson(data));
};
const orks = () => structuredClone(out.files.get(`${GS}/armies/orks.json`)) as ArmyFile;

const normal = withDataset(() => {});
check('la commande passe sur la sortie normale de la construction', normal.ok, `${normal.schema.length} schéma, ${normal.text.length} texte`);

const copiedRule = withDataset((dir) => {
  const army = orks();
  army.units[0].name = 'Each time a model in this unit makes an attack, add 1 to the Hit roll';
  put(dir, `${GS}/armies/orks.json`, army);
});
check('la commande échoue sur un Dataset contenant une description de règle recopiée', !copiedRule.ok && copiedRule.text.length > 0);

const describedAbility = withDataset((dir) => {
  const army = orks();
  (army.units[0].abilities[0] as unknown as Record<string, string>).description = 'FIXTURE';
  put(dir, `${GS}/armies/orks.json`, army);
});
check('un champ de description ajouté échoue au schéma comme au contrôle de texte', !describedAbility.ok && describedAbility.schema.length > 0 && describedAbility.text.length > 0);

const proseCorrection = withDataset((dir) =>
  put(dir, `corrections/${GS}/orks/boyz-ability.json`, {
    target: 'u-boyz::ability:Mob Fixture',
    patch: { name: 'Mob Fixture' },
    upstream: { name: 'Each time this unit fights, you can re-roll the Hit roll.' },
    reason: 'test',
  }),
);
check('la commande échoue sur une Correction contenant de la prose de règles', !proseCorrection.ok && proseCorrection.text.some((f) => f.where.startsWith('corrections/')));

const proseSummary = withDataset((dir) =>
  put(dir, `effects/${GS}/orks/war-horde.json`, { summary: 'Each time a model in this unit makes a melee attack, add 1 to the Wound roll.' }),
);
check('la commande échoue sur un résumé contenant de la prose de règles', !proseSummary.ok && proseSummary.text.some((f) => f.where.startsWith('effects/')));

const goodSummary = withDataset((dir) => put(dir, `effects/${GS}/orks/war-horde.json`, { summary: '+1 to wound in melee on the turn this unit charged' }));
check('un résumé court écrit par nous passe', goodSummary.ok, goodSummary.text.map((f) => f.reason).join(' ; '));

const offSchema = withDataset((dir) => {
  const army = orks();
  delete (army as unknown as Record<string, unknown>).units;
  put(dir, `${GS}/armies/orks.json`, army);
});
check('la commande échoue sur une sortie non conforme au schéma', !offSchema.ok && offSchema.schema.some((f) => f.file === `${GS}/armies/orks.json`));

const stray = withDataset((dir) => put(dir, `${GS}/notes.json`, { hello: 'world' }));
check('un fichier inconnu du schéma dans le Game System est refusé', !stray.ok && stray.schema.some((f) => f.file === `${GS}/notes.json`));

/*
 * L'automatisation travaille dans le dépôt : elle y pose l'instantané des
 * Upstream Sources et une copie du Dataset Tool, tous deux pleins de textes de
 * règles amont. Ce ne sont pas des fichiers du Dataset, et le contrôle ne doit
 * pas les lire — sinon il échouerait à chaque passage de la CI.
 */
const prose = { text: 'Each time a model in this unit makes a melee attack, add 1 to the Hit roll.' };
const hidden = withDataset((dir) => {
  put(dir, '.snapshot/bsdata/Orks.json', prose);
  put(dir, '.tool/test/fixtures/snapshot/bsdata/Orks.json', prose);
  put(dir, '.github/notes.json', prose);
});
check(
  'les dossiers cachés du dépôt (instantané, outil) ne sont pas contrôlés',
  hidden.ok,
  hidden.text.map((f) => f.where).join(' ; '),
);
