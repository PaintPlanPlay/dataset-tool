/**
 * Le formulaire de Rule unique (ADR 0011), par l'API de l'interface locale :
 * saisir les Modifiers d'une Rule Orks en fait une Contribution, les clés
 * s'auto-complètent, et une clé que la Simulation ne sait pas jouer remonte
 * comme anomalie.
 *
 *   npx tsx test/ruleform.test.ts
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SIMULATED_CONDITIONS, SIMULATED_MODIFIERS, type Stratagem, type Unit } from '@paintplanplay/dataset-schema';
import { build } from '../src/build.ts';
import { readContributions } from '../src/authored.ts';
import { startGui } from '../src/gui/server.ts';
import type { Sheet, Suggestions } from '../src/gui/sheets.ts';
import { openWorkspace } from '../src/gui/workspace.ts';
import type { UnsimulatedKey } from '../src/rules.ts';
import { openSnapshot } from '../src/snapshot.ts';
import { check, fixture, section } from './check.ts';

const dir = mkdtempSync(join(tmpdir(), 'dataset-ruleform-'));
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

try {
  section('Formulaire de Rule : les Modifiers d\'une Rule Orks deviennent une Contribution');
  const orks = (ws.current!.files.get('wh40k-11e/armies/orks.json') as { stratagems: Stratagem[]; units: Unit[] });
  const strat = orks.stratagems.find((s) => s.name === "'ERE WE GO")!;
  const target = `orks::stratagem:${strat.id}`;
  const sheet = (await get<Sheet>(`/api/sheet?target=${encodeURIComponent(target)}`)).body;
  check('la fiche dit que les Modifiers sont à nous', sheet.sources.modifiers === 'project' && sheet.sources.options === 'project', JSON.stringify(sheet.sources));

  const draft = { ...(sheet.value as Stratagem), modifiers: [{ key: 'hit', value: 1, target: 'self', conditions: [{ key: 'waaagh' }] }, { key: 'charge-bonus', value: 2, target: 'self' }], summary: 'Adds 2 to Charge rolls.' };
  const saved = await post<{ files: { path: string; kind: string }[] }>('/api/sheet/save', { target, draft, reason: 'Modifiers de test.' });
  check('enregistrer crée une Contribution', saved.status === 201 && saved.body.files.some((f) => f.kind === 'contribution'), JSON.stringify(saved.body));
  const written = effects().find((e) => e.target === target);
  check('elle porte les Modifiers et la Description saisis', JSON.stringify(written?.modifiers) === JSON.stringify(draft.modifiers) && written?.summary === draft.summary);

  const prose = { ...draft, summary: 'Each time a model in this unit makes an attack, add 1 to the Hit roll and re-roll the Wound roll.' };
  const refused = await post<{ error: string }>('/api/sheet/save', { target, draft: prose, reason: 'Test.' });
  check('une Description qui recopie du texte de règles est refusée', refused.status === 400, refused.body.error);
  const badTarget = { ...draft, modifiers: [{ key: 'hit', value: 1, target: 'everyone' }] };
  check('un Modifier hors schéma est refusé', (await post('/api/sheet/save', { target, draft: badTarget, reason: 'Test.' })).status === 400);

  await post('/api/refresh', {});
  const rebuilt = (ws.current!.files.get('wh40k-11e/armies/orks.json') as { stratagems: Stratagem[] }).stratagems.find((s) => s.id === strat.id)!;
  check('après build, la Rule publiée porte ses Modifiers', rebuilt.modifiers?.length === 2 && rebuilt.summary === draft.summary);

  section('Formulaire de Rule : une Army Rule a sa fiche, comme toute Rule');
  const hits = (await get<{ kind: string; target: string; name: string }[]>('/api/search?q=waaagh&army=orks')).body;
  const armyRule = hits.find((h) => h.kind === 'armyRule');
  check('la recherche trouve l\'Army Rule', armyRule?.name === 'Waaagh!', JSON.stringify(hits));
  const ruleSheet = (await get<Sheet>(`/api/sheet?target=${encodeURIComponent(armyRule!.target)}`)).body;
  const ruleDraft = { ...(ruleSheet.value as object), modifiers: [{ key: 'A', value: 1, target: 'self', conditions: [{ key: 'waaagh' }, { key: 'melee' }] }] };
  const ruleSaved = await post<{ files: { kind: string }[] }>('/api/sheet/save', { target: armyRule!.target, draft: ruleDraft, reason: 'Waaagh! au format à nous.' });
  check('ses Modifiers s\'enregistrent en Contribution', ruleSaved.status === 201 && effects().some((e) => e.target === armyRule!.target && e.modifiers?.[0].key === 'A'), JSON.stringify(ruleSaved.body));
  const renamed = await post('/api/sheet/save', { target: armyRule!.target, draft: { ...ruleDraft, name: 'Waaagh!!' }, reason: 'Test.' });
  check('son nom, qui vient de BSData, ne se change pas ici', renamed.status === 400);

  section('Formulaire de Rule : auto-complétion des clés');
  const suggest = (await get<Suggestions>('/api/suggest?army=orks')).body;
  const simulated = Object.keys(SIMULATED_MODIFIERS);
  const keys = suggest.modifierKeys.map((k) => k.key);
  check('les clés simulées viennent en premier', simulated.every((k, i) => keys[i] === k) && suggest.modifierKeys.slice(0, simulated.length).every((k) => k.simulated));
  check('puis celles déjà utilisées dans le Dataset, marquées non simulées', keys.includes('charge-bonus') && suggest.modifierKeys.find((k) => k.key === 'charge-bonus')?.simulated === false);
  check('sans doublon', new Set(keys).size === keys.length);
  check('gain-keyword est proposée comme clé connue', suggest.modifierKeys.find((k) => k.key === 'gain-keyword')?.simulated === true);
  const conditionKeys = suggest.conditionKeys.map((k) => k.key);
  check(
    'les clés de Condition : celles que la Simulation évalue, puis les Situations déjà utilisées',
    Object.keys(SIMULATED_CONDITIONS).every((k, i) => conditionKeys[i] === k) && suggest.conditionKeys.find((k) => k.key === 'waaagh')?.simulated === false,
    JSON.stringify(suggest.conditionKeys),
  );
  check('une Situation n\'est pas une anomalie', !(await get<UnsimulatedKey[]>('/api/unsimulated')).body.some((f) => f.key === 'waaagh'));

  section('Formulaire de Rule : une clé non simulée est une anomalie');
  const findings = (await get<UnsimulatedKey[]>('/api/unsimulated')).body;
  check('elle remonte, avec la Rule qui la porte', findings.some((f) => f.key === 'charge-bonus' && f.target === target), JSON.stringify(findings));
  check('une clé simulée n\'en est pas une', !findings.some((f) => f.key === 'hit'));
  const overview = (await get<{ unsimulated: number }>('/api/overview')).body;
  check('la vue d\'ensemble les compte', overview.unsimulated === findings.length);
  const out = await build({ snapshot: openSnapshot(fixture('snapshot')), authored: { battleSizes: [], referenceTargets: [], effects: effects() } });
  check('le build les rend aussi', out.unsimulated.some((f) => f.key === 'charge-bonus'));
} finally {
  await gui.close();
  rmSync(dir, { recursive: true, force: true });
}
