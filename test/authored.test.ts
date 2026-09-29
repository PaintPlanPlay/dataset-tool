/**
 * Point de test « construction d'une Dataset Release » : Battle Sizes, cibles par
 * défaut et List d'exemple, écrites par le projet, passent dans core.json
 * rattachées aux Units construites.
 *
 *   npx tsx test/authored.test.ts
 */
import type { CoreFile } from '@paintplanplay/dataset-schema';
import { validateFile } from '@paintplanplay/dataset-schema/validate';
import { fingerprint, type AuthoredCore } from '../src/authored.ts';
import { build } from '../src/build.ts';
import { makeReport, renderReport } from '../src/report.ts';
import { openSnapshot } from '../src/snapshot.ts';
import { check, fixture, section } from './check.ts';

const authored: AuthoredCore = {
  battleSizes: [
    { points: 2000, name: 'Strike Force', detachmentPoints: 3, enhancementLimit: 4, unitLimit: 3 },
    { points: 1000, name: 'Incursion', detachmentPoints: 2, enhancementLimit: 2, unitLimit: 2 },
  ],
  referenceTargets: [
    { army: 'orks', unit: 'Boyz', models: 99 },
    { army: 'adeptus-custodes', unit: 'Custodian Guard', models: 5 },
    { army: 'orks', unit: 'Unit That Never Was', models: 1 },
  ],
  sampleList: {
    army: 'orks',
    name: 'Fixture List',
    detachment: 'War Horde',
    battleSize: 1000,
    units: [
      { unit: 'Warboss', section: 'CHARACTERS', warlord: true, wargear: [{ name: 'Power klaw', count: 1 }] },
      { unit: 'Boyz', section: 'BATTLELINE', models: [{ name: 'Boy', count: 10, wargear: [{ name: 'Choppa', count: 10 }] }] },
    ],
  },
};

const out = await build({ snapshot: openSnapshot(fixture('snapshot')), authored });
const core = out.files.get('wh40k-11e/core.json') as CoreFile;
const orks = (out.files.get('wh40k-11e/armies/orks.json') as { units: { id: string; name: string; maxModels: number; points: number }[] }).units;
const boyz = orks.find((u) => u.name === 'Boyz')!;

section('Écrit par le projet : Battle Sizes, cibles, List d\'exemple');
check('Battle Sizes publiées, rangées par points', core.battleSizes.map((b) => b.points).join() === '1000,2000');
check(
  'cibles par défaut : rattachées par identifiant, effectif borné par la datasheet',
  core.referenceTargets.length === 2 &&
    core.referenceTargets[0].unitId === boyz.id &&
    core.referenceTargets[0].models === boyz.maxModels,
  JSON.stringify(core.referenceTargets),
);
check('une Unit introuvable est signalée, pas publiée', out.unresolvedAuthored.join() === 'orks › Unit That Never Was');
check(
  'List d\'exemple : Units rattachées, coûts tirés du Dataset, total recalculé',
  core.sampleList?.units.map((u) => u.name).join() === 'Warboss,Boyz' &&
    core.sampleList.units[1].points === boyz.points &&
    core.sampleList.points === core.sampleList.units.reduce((n, u) => n + u.points, 0),
  JSON.stringify(core.sampleList),
);
check('core.json conforme au schéma', validateFile('core', core).length === 0, JSON.stringify(validateFile('core', core)));
const bare = await build({ snapshot: openSnapshot(fixture('snapshot')) });
const bareCore = bare.files.get('wh40k-11e/core.json') as CoreFile;
check('sans fichiers écrits par le projet : listes vides, pas de List d\'exemple', bareCore.battleSizes.length === 0 && bareCore.referenceTargets.length === 0 && !bareCore.sampleList);

section('Écrit par le projet : Ally Rules (#143, ADR 0013)');
const assignedAgents = {
  id: 'assigned-agents',
  name: 'Assigned Agents',
  exceptArmies: ['agents-of-the-imperium'],
  requires: ['Imperium'],
  admits: { factionKeywords: ['Agents of the Imperium'] },
  assignedCost: true as const,
  reason: 'Règle d\'armée des Agents of the Imperium.',
};
const withRules = await build({
  snapshot: openSnapshot(fixture('snapshot')),
  authored: {
    battleSizes: [],
    referenceTargets: [],
    allyRules: [
      assignedAgents,
      { id: 'lost', name: 'Lost Rule', armies: ['no-such-army'], admits: { keywords: ['No Such Keyword'], units: ['Unit That Never Was'] }, reason: 'Test.' },
    ],
  },
});
const rulesCore = withRules.files.get('wh40k-11e/core.json') as CoreFile;
const published = rulesCore.allyRules?.find((r) => r.id === 'assigned-agents');
check(
  'une Ally Rule est publiée dans core.json, sans sa raison',
  published?.name === 'Assigned Agents' && published.assignedCost === true && published.admits.factionKeywords?.join() === 'Agents of the Imperium' && !('reason' in published),
  JSON.stringify(published),
);
check('core.json avec Ally Rules conforme au schéma', validateFile('core', rulesCore).length === 0, JSON.stringify(validateFile('core', rulesCore)));
check(
  'une Ally Rule qui désigne une Army, un Keyword ou une Unit disparus est signalée',
  ['Lost Rule › Army no-such-army', 'Lost Rule › Keyword No Such Keyword', 'Lost Rule › Unit Unit That Never Was'].every((m) => withRules.unresolvedAuthored.includes(m)),
  withRules.unresolvedAuthored.join(' | '),
);
check('une Ally Rule dont tout existe n\'est pas signalée', !withRules.unresolvedAuthored.some((m) => m.startsWith('Assigned Agents')));
check('le rapport de build liste ce qu\'une Ally Rule vise et qui n\'existe plus',
  /## Authored entries not found \(3\)[\s\S]*Lost Rule › Army no-such-army/.test(renderReport(makeReport(withRules, undefined))));
check('sans Ally Rules, core.json n\'en porte pas', !bareCore.allyRules);

section('Écrit par le projet : Modifiers et Descriptions');
const withEffects = await build({
  snapshot: openSnapshot(fixture('snapshot')),
  authored: {
    battleSizes: [],
    referenceTargets: [],
    effects: [
      { target: 'u-boyz::ability:Mob Fixture', modifiers: [{ key: 'feel-no-pain', value: '6+', target: 'self' }], reason: 'Test.' },
      { target: 'u-warboss::ability:Da Boss Fixture', summary: 'Short line.', reason: 'Test.' },
      { target: 'u-warboss::ability:Leader', effect: { type: 'roll-modifier' }, reason: 'Ancien format.' },
      { target: 'u-nobody::ability:Nothing', summary: 'Short.', reason: 'Test.' },
    ],
  },
});
const orksWith = withEffects.files.get('wh40k-11e/armies/orks.json') as { units: { id: string; abilities: { name: string; summary?: string; modifiers?: { key: string }[] }[] }[] };
const ab = (unit: string, name: string) => orksWith.units.find((u) => u.id === unit)!.abilities.find((a) => a.name === name)!;
check('les Modifiers d\'une Contribution sont publiés', ab('u-boyz', 'Mob Fixture').modifiers?.[0].key === 'feel-no-pain');
check('une Description seule s\'ajoute', ab('u-warboss', 'Da Boss Fixture').summary === 'Short line.' && !ab('u-warboss', 'Da Boss Fixture').modifiers);
const rejected = withEffects.contributions.find((c) => c.target === 'u-warboss::ability:Leader');
check(
  'un Effect à l\'ancien format est refusé, avec sa raison ; une cible inconnue est signalée',
  rejected?.state === 'rejected' && /Modifiers/.test(rejected.note) && withEffects.unresolvedAuthored.includes('u-nobody::ability:Nothing'),
  JSON.stringify(rejected),
);
check('le rapport liste les Contributions écartées', /## Contributions set aside \(1\)/.test(renderReport(makeReport(withEffects, undefined))));

section('Contributions (ADR 0010) : un changement de 40kdc-data est signalé, jamais appliqué');
const upstreamOfBoss = bare.kdcEffects['u-warboss::ability:Da Boss Fixture'];
const ours = [{ key: 'feel-no-pain', value: '5+', target: 'self' as const }];
const contribution = (upstream: string) =>
  build({
    snapshot: openSnapshot(fixture('snapshot')),
    authored: { battleSizes: [], referenceTargets: [], effects: [{ target: 'u-warboss::ability:Da Boss Fixture', modifiers: ours, reason: 'Ours.', upstream }] },
  });
const same = await contribution(fingerprint({ effect: upstreamOfBoss, summary: undefined }));
const moved = await contribution('0123456789ab');
const verdictOf = (o: typeof same) => o.contributions.find((c) => c.target === 'u-warboss::ability:Da Boss Fixture');
const bossOf = (o: typeof same) =>
  (o.files.get('wh40k-11e/armies/orks.json') as typeof orksWith).units.find((u) => u.id === 'u-warboss')!.abilities.find((a) => a.name === 'Da Boss Fixture')!;
check('40kdc-data inchangé depuis la rédaction : active', verdictOf(same)?.state === 'active', JSON.stringify(verdictOf(same)));
check(
  '40kdc-data changé depuis : signalée, jamais remplacée',
  verdictOf(moved)?.state === 'flagged' && JSON.stringify(bossOf(moved).modifiers) === JSON.stringify(ours) && verdictOf(moved)!.upstreamNow === verdictOf(same)!.upstreamNow,
);
check('le rapport liste les Contributions à relire', /## Contributions to review \(1\)/.test(renderReport(makeReport(moved, undefined))));
