/**
 * L'import des Effects extraits et la page de revue (ADR 0011), par l'API de
 * l'interface locale : chaque Rule importée est comparée à son Effect
 * 40kdc-data, et seules celles qui divergent ou n'ont qu'une lecture attendent
 * un humain.
 *
 *   npx tsx test/review.test.ts
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readContributions } from '../src/authored.ts';
import type { ImportResult, ReviewItem } from '../src/review.ts';
import { startGui } from '../src/gui/server.ts';
import { openWorkspace } from '../src/gui/workspace.ts';
import { check, fixture, section } from './check.ts';

const dir = mkdtempSync(join(tmpdir(), 'dataset-review-'));
const ws = await openWorkspace({ datasetDir: dir, snapshotDir: fixture('snapshot') });
const gui = await startGui(ws, 0);
const get = async <T>(path: string) => {
  const res = await fetch(new URL(path, gui.url));
  return { status: res.status, body: (await res.json()) as T };
};
const post = async <T>(path: string, body: unknown) => {
  const res = await fetch(new URL(path, gui.url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as T };
};
const effects = () => readContributions(dir, 'wh40k-11e');
const melee = [{ key: 'melee' }];

try {
  section('Import des Effects extraits : comparés à 40kdc-data');
  const imported = await post<ImportResult>('/api/review/import', {
    rules: [
      // 40kdc-data : Sustained Hits 1 en mêlée.
      { target: 'orks::rule:war-horde|get-stuck-in', modifiers: [{ key: 'sustained-hits', value: 1, target: 'self', conditions: melee }] },
      // 40kdc-data : +1 pour toucher.
      { target: 'orks::enhancement:war-horde|follow-me-ladz', modifiers: [{ key: 'hit', value: 1, target: 'self' }], summary: 'Leader\'s unit gets +1 to Hit.' },
      // 40kdc-data : +1 pour blesser et Lethal Hits en mêlée ; la lecture oublie Lethal Hits.
      { target: 'u-warboss::ability:Da Boss Fixture', modifiers: [{ key: 'wound', value: 1, target: 'self', conditions: melee }] },
      // Rien chez 40kdc-data.
      { target: 'orks::enhancement:da-big-hunt|glory-hog', modifiers: [{ key: 'hit', value: 1, target: 'self', conditions: melee }] },
      { target: 'orks::stratagem:unbridled-carnage', modifiers: [{ key: 'A', value: 1, target: 'self' }], summary: 'Each time a model in this unit makes an attack, add 1 to the Attacks characteristic of that weapon.' },
      { target: 'orks::stratagem:nowhere', modifiers: [{ key: 'A', value: 1, target: 'self' }] },
    ],
  });
  check('l\'import répond', imported.status === 200, JSON.stringify(imported.body));
  const status = (target: string) => effects().find((e) => e.target === target)?.review;
  check('deux lectures d\'accord : concordant', status('orks::rule:war-horde|get-stuck-in') === 'concordant' && status('orks::enhancement:war-horde|follow-me-ladz') === 'concordant');
  check('deux lectures qui diffèrent : divergent', status('u-warboss::ability:Da Boss Fixture') === 'divergent');
  check('une seule lecture : seul', status('orks::enhancement:da-big-hunt|glory-hog') === 'seul');
  check('une Description qui recopie du texte est refusée, rien n\'en est écrit', imported.body.rejected.some((r) => r.target === 'orks::stratagem:unbridled-carnage') && status('orks::stratagem:unbridled-carnage') === undefined);
  check('une Rule introuvable est refusée', imported.body.rejected.some((r) => r.target === 'orks::stratagem:nowhere'));
  check('chaque Rule importée est une Contribution, avec sa raison', effects().every((e) => e.reason.trim().length > 0) && imported.body.written === 4);

  section('Page de revue : ce qui attend un humain');
  const list = (await get<ReviewItem[]>('/api/review?army=orks')).body;
  check('seules les Rules divergent et seul y sont', list.map((i) => `${i.target}:${i.status}`).sort().join() === 'orks::enhancement:da-big-hunt|glory-hog:seul,u-warboss::ability:Da Boss Fixture:divergent', JSON.stringify(list.map((i) => i.target)));
  const boss = list.find((i) => i.status === 'divergent')!;
  check('une Rule divergente montre les deux lectures', boss.ours.length === 1 && Array.isArray(boss.kdc) && boss.kdc.some((m) => m.key === 'lethal-hits'), JSON.stringify(boss));
  check('chacune dit sa fiche, son type et son Army', boss.sheet === 'u-warboss' && boss.type === 'ability' && boss.army === 'orks');
  check('filtrable par type de Rule', (await get<ReviewItem[]>('/api/review?army=orks&type=rule')).body.length === 0 && (await get<ReviewItem[]>('/api/review?army=orks&type=ability')).body.length === 1);
  check('filtrable par Army', (await get<ReviewItem[]>('/api/review?army=adeptus-custodes')).body.length === 0);
  const everything = (await get<ReviewItem[]>('/api/review?army=orks&all=1')).body;
  check('les concordantes restent consultables, marquées comme validées automatiquement', everything.some((i) => i.status === 'concordant' && i.target === 'orks::rule:war-horde|get-stuck-in'));

  section('Page de revue : valider');
  const validated = await post('/api/review/validate', { target: boss.target });
  check('valider passe la Rule en revu', validated.status === 200 && status(boss.target) === 'revu');
  check('elle quitte la liste', !(await get<ReviewItem[]>('/api/review?army=orks')).body.some((i) => i.target === boss.target));
  check('on ne valide que ce qui attend une revue', (await post('/api/review/validate', { target: 'orks::stratagem:ere-we-go' })).status === 404);
  const overview = (await get<{ toReview: number }>('/api/overview')).body;
  check('la vue d\'ensemble compte ce qui reste à revoir', overview.toReview === 1);

  section('Import : jamais par-dessus le travail d\'un humain');
  const handSheet = (await get<{ value: { abilities: { name: string }[] } }>('/api/sheet?target=u-warboss')).body.value;
  const withSummary = { ...handSheet, abilities: handSheet.abilities.map((a) => (a.name === 'Leader' ? { ...a, summary: 'Leads Boyz.' } : a)) };
  check('une Description écrite à la main', (await post('/api/sheet/save', { target: 'u-warboss', draft: withSummary, reason: 'À la main.' })).status === 201);
  await post('/api/refresh', {});
  const again = await post<ImportResult>('/api/review/import', {
    rules: [
      { target: boss.target, modifiers: [{ key: 'wound', value: 2, target: 'self' }] },
      { target: 'u-warboss::ability:Leader', modifiers: [{ key: 'hit', value: 1, target: 'attached' }], summary: 'Imported.' },
      { target: 'orks::rule:war-horde|get-stuck-in', modifiers: [{ key: 'sustained-hits', value: 2, target: 'self', conditions: melee }] },
    ],
  });
  check('une Rule revue n\'est pas écrasée', again.body.rejected.some((r) => r.target === boss.target) && effects().find((e) => e.target === boss.target)?.review === 'revu', JSON.stringify(again.body));
  const leader = effects().find((e) => e.target === 'u-warboss::ability:Leader');
  check('la Description écrite à la main reste, les Modifiers importés s\'y ajoutent', leader?.summary === 'Leads Boyz.' && leader.modifiers?.[0].key === 'hit' && leader.review === 'seul', JSON.stringify(leader));
  check('une Rule seulement importée se réimporte', effects().find((e) => e.target === 'orks::rule:war-horde|get-stuck-in')?.modifiers?.[0].value === 2);
} finally {
  await gui.close();
  rmSync(dir, { recursive: true, force: true });
}
