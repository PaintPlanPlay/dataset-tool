/**
 * L'automatisation du dépôt du Dataset (issue #69) : une construction planifiée
 * ouvre ou met à jour une PR avec le rapport de dérive, et la CI applique les
 * contrôles à toute PR. Les workflows vivent dans le dépôt du Dataset ; lus ici
 * quand il est à côté de l'outil (\`DATASET_REPO_DIR\`, par défaut \`../dataset\`).
 *
 *   npx tsx test/workflows.test.ts
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { check, section } from './check.ts';

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  with?: Record<string, string>;
  env?: Record<string, string>;
}
interface Workflow {
  on: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs: Record<string, { steps: Step[] }>;
}

const repo = resolve(process.env.DATASET_REPO_DIR ?? join(fileURLToPath(new URL('..', import.meta.url)), '..', 'dataset'));
const read = (name: string) => parse(readFileSync(join(repo, '.github', 'workflows', name), 'utf8')) as Workflow;

section('Automatisation du dépôt du Dataset');
if (!existsSync(join(repo, '.github', 'workflows'))) {
  console.log(`  (dépôt du Dataset introuvable à ${repo} : contrôles sautés)`);
} else {
  const update = read('update.yml');
  const steps = Object.values(update.jobs).flatMap((j) => j.steps);
  const runs = steps.map((s) => s.run ?? '');
  const index = (re: RegExp) => runs.findIndex((r) => re.test(r));
  const pr = steps.find((s) => s.uses?.startsWith('peter-evans/create-pull-request'));

  check('planifiée, et lançable à la main', 'schedule' in update.on && 'workflow_dispatch' in update.on);
  check(
    'récupère les Upstream Sources, construit avec le rapport, puis contrôle — dans cet ordre',
    index(/ fetch /) >= 0 && index(/ fetch /) < index(/ build .*--report /) && index(/ build /) < index(/ check /),
    runs.filter(Boolean).join(' | '),
  );
  check(
    'une seule branche : une PR ouverte est mise à jour, jamais dupliquée ; sans changement, aucune PR',
    Boolean(pr?.with?.branch) && !/\$\{\{/.test(pr!.with!.branch) && pr!.with!['add-paths']?.includes('wh40k-11e/'),
  );
  check('la PR porte le rapport de dérive (désaccords, Corrections)', pr?.with?.['body-path']?.includes('report.md') === true && runs.some((r) => r.includes('$RUNNER_TEMP/report.md')));
  check('ouverte avec un jeton qui déclenche la CI', pr?.with?.token?.includes('secrets.') === true);
  check('écrit le contenu et les PR, rien d\'autre', update.permissions?.contents === 'write' && update.permissions?.['pull-requests'] === 'write');

  const ci = read('ci.yml');
  const ciRuns = Object.values(ci.jobs).flatMap((j) => j.steps.map((s) => s.run ?? ''));
  check('la CI contrôle schéma et texte de règles sur toute PR', 'pull_request' in ci.on && ciRuns.some((r) => / check --dataset /.test(r)));
  check('modèle de PR présent', existsSync(join(repo, '.github', 'pull_request_template.md')));
}
