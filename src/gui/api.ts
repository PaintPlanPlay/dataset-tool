/**
 * Ce que l'interface locale écrit dans le dépôt du Dataset : des Corrections, des
 * Effects et des résumés écrits par le projet. Rien ne s'écrit sans passer le
 * schéma et le contrôle « aucun texte de règles ». La PR, elle, part du dépôt
 * du mainteneur : l'interface donne les commandes, et ne les lance que sur
 * demande.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Correction } from '@paintplanplay/dataset-schema';
import { validateFile } from '@paintplanplay/dataset-schema/validate';
import { authoredDir, authoredEffectProblems, EFFECTS_FILE, type AuthoredEffect } from '../authored.ts';
import { correctionsDir } from '../corrections/files.ts';
import { toJson } from '../dataset.ts';
import { findRulesText } from '../notext.ts';
import { fileURLToPath } from 'node:url';
import { inspect, type DatasetView } from './provenance.ts';
import type { JobRunner } from './jobs.ts';
import type { Workspace } from './workspace.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly findings: string[];
  constructor(status: number, message: string, findings: string[] = []) {
    super(message);
    this.status = status;
    this.findings = findings;
  }
}

/** Le Dataset chargé, ou l'erreur qui dit par quel bouton commencer. */
export function datasetOf(ws: Workspace): DatasetView {
  if (!ws.current) throw new ApiError(409, 'no Dataset loaded: fetch the Dataset, or build one from a snapshot');
  return ws.current;
}

export interface WriteResult {
  /** Fichier écrit, relatif au dépôt du Dataset. */
  path: string;
  /** Les commandes qui en font une PR, depuis le dépôt du Dataset. */
  prCommands: string[];
  /** Adresse de la PR, quand l'interface l'a ouverte. */
  pullRequest?: string;
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'dataset';
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** Un argument ne se protège que s'il en a besoin : les commandes restent lisibles. */
const arg = (s: string) => (/^[A-Za-z0-9_@:,./=+-]+$/.test(s) ? s : quote(s));

const PR_BODY = 'Proposed from the Dataset Tool local interface.';

/**
 * Les commandes qui font une PR d'un fichier écrit ici : une seule liste, qu'on
 * affiche ou qu'on exécute, pour que les deux ne divergent jamais.
 */
function prSteps(files: string[], title: string, branch: string): { cmd: string; args: string[] }[] {
  return [
    { cmd: 'git', args: ['checkout', '-b', branch] },
    { cmd: 'git', args: ['add', ...files] },
    { cmd: 'git', args: ['commit', '-m', title] },
    { cmd: 'git', args: ['push', '-u', 'origin', branch] },
    { cmd: 'gh', args: ['pr', 'create', '--title', title, '--body', PR_BODY] },
  ];
}

export function prCommands(files: string[], title: string, branch = `dataset/${slug(title)}`): string[] {
  return prSteps(files, title, branch).map(({ cmd, args }) => [cmd, ...args.map(arg)].join(' '));
}

function openPullRequest(dir: string, files: string[], title: string): string {
  const steps = prSteps(files, title, `dataset/${slug(title)}-${Date.now().toString(36)}`);
  let out = '';
  for (const { cmd, args } of steps) out = execFileSync(cmd, args, { cwd: dir, encoding: 'utf8' }).trim();
  // La dernière commande est `gh pr create` : elle rend l'adresse de la PR.
  return out;
}

/**
 * Relire le Dataset après une écriture demande deux reconstructions — une
 * vingtaine de secondes sur le vrai Dataset. On ne fait pas attendre l'appelant
 * pour ça : il reçoit son résultat tout de suite, la relecture se fait derrière,
 * et `/api/refresh` attend celle qui est déjà en cours plutôt que d'en lancer
 * une seconde.
 */
let enCours: Promise<void> | null = null;

export function refreshing(ws: Workspace): Promise<void> {
  enCours ??= ws
    .refresh()
    .catch(() => undefined)
    .finally(() => {
      enCours = null;
    });
  return enCours;
}

async function finish(ws: Workspace, path: string, title: string, openPr: boolean | undefined): Promise<WriteResult> {
  const result: WriteResult = { path, prCommands: prCommands([path], title) };
  if (openPr) result.pullRequest = openPullRequest(ws.datasetDir, [path], title);
  void refreshing(ws);
  return result;
}

export interface CorrectionInput {
  army: string;
  /** Nom du fichier, sans extension. */
  name: string;
  correction: Correction;
  overwrite?: boolean;
  openPr?: boolean;
}

export async function createCorrection(ws: Workspace, input: CorrectionInput): Promise<WriteResult> {
  if (!SLUG.test(input.army) || !SLUG.test(input.name)) throw new ApiError(400, 'Army and file name: lower-case letters, digits and hyphens');
  const schema = validateFile('correction', input.correction);
  if (schema.length) throw new ApiError(400, 'Correction does not match the schema', schema);
  const path = `${correctionsDir(ws.gameSystem)}/${input.army}/${input.name}.json`;
  const text = findRulesText(input.correction, path);
  if (text.length) throw new ApiError(400, 'Rules text refused', text.map((f) => `${f.where} : ${f.reason}`));
  const abs = join(ws.datasetDir, path);
  if (existsSync(abs) && !input.overwrite) throw new ApiError(409, `${path} already exists`);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, toJson(input.correction));
  return finish(ws, path, `Correction ${input.correction.target}`, input.openPr);
}

export async function writeAuthoredEffect(ws: Workspace, input: AuthoredEffect & { openPr?: boolean }): Promise<WriteResult> {
  const { openPr, ...entry } = input;
  const problems = [...authoredEffectProblems(entry), ...findRulesText(entry).map((f) => `${f.where} : ${f.reason}`)];
  if (problems.length) throw new ApiError(400, 'Effect or summary refused', problems);
  if (!inspect(datasetOf(ws), ws.bare, entry.target)) throw new ApiError(404, `target not found: ${entry.target}`);
  const path = `${authoredDir(ws.gameSystem)}/${EFFECTS_FILE}`;
  const abs = join(ws.datasetDir, path);
  const existing = existsSync(abs) ? (JSON.parse(readFileSync(abs, 'utf8')) as AuthoredEffect[]) : [];
  const next = [...existing.filter((e) => e.target !== entry.target), entry].sort((a, b) => a.target.localeCompare(b.target));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, toJson(next));
  return finish(ws, path, `Effect ${entry.target}`, openPr);
}

/** Accepter une proposition de l'analyse d'aptitudes : elle devient un Effect écrit par le projet. */
export async function acceptProposal(ws: Workspace, target: string, openPr?: boolean): Promise<WriteResult> {
  const unitId = target.split('::')[0];
  const proposal = inspect(datasetOf(ws), ws.bare, unitId)?.proposals.find((p) => p.target === target);
  if (!proposal) throw new ApiError(404, `no suggestion for ${target}`);
  return writeAuthoredEffect(ws, { target, effect: proposal.effect, reason: 'Suggestion from the ability analysis, reviewed and accepted.', openPr });
}

const readCorrection = (ws: Workspace, path: string) => {
  if (!path.startsWith(`${correctionsDir(ws.gameSystem)}/`) || path.includes('..')) throw new ApiError(400, 'invalid Correction path');
  const abs = join(ws.datasetDir, path);
  if (!existsSync(abs)) throw new ApiError(404, `${path} not found`);
  return { abs, correction: JSON.parse(readFileSync(abs, 'utf8')) as Correction };
};

/** Enregistrer la PR proposée en retour à l'Upstream Source. */
export async function recordUpstreamPr(ws: Workspace, path: string, url: string): Promise<WriteResult> {
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/(pull|issues)\/\d+$/.test(url)) throw new ApiError(400, 'a GitHub pull request or issue URL is expected');
  const { abs, correction } = readCorrection(ws, path);
  writeFileSync(abs, toJson({ ...correction, upstreamPr: url }));
  return finish(ws, path, `Correction ${correction.target}: upstream feedback`, false);
}

const UPSTREAM_REPOSITORY: Record<Correction['source'], string> = {
  bsdata: 'BSData/wh40k-11e',
  mfm: 'BSData/wh40k-11e-mfm',
  '40kdc': 'wn-mitch/40kdc-data',
};

/** Une issue préremplie chez l'Upstream Source, pour qu'elle se corrige à son tour. */
export function upstreamDraft(ws: Workspace, path: string): { repository: string; url: string } {
  const { correction } = readCorrection(ws, path);
  const repository = UPSTREAM_REPOSITORY[correction.source];
  const body = [
    `Element: \`${correction.target}\``,
    '',
    `Current value: \`${JSON.stringify(correction.upstream ?? {})}\``,
    `Proposed value: \`${JSON.stringify(correction.patch)}\``,
    '',
    `Why: ${correction.reason}`,
  ].join('\n');
  const title = `Data correction: ${correction.target}`;
  return { repository, url: `https://github.com/${repository}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}` };
}

// ------------------------------------------------------------------- tâches

/** Le CLI de l'outil, tel qu'on le relancerait à la main. */
const CLI = fileURLToPath(new URL('../cli.ts', import.meta.url));
const TOOL_DIR = fileURLToPath(new URL('../..', import.meta.url));

/**
 * Où l'application ira chercher les fichiers d'une Release : le CDN qui sert le
 * dépôt du Dataset. Déduit de son remote, pour que le mainteneur n'ait pas à
 * connaître cette adresse.
 */
export function defaultReleaseUrl(datasetDir: string): string | null {
  try {
    const remote = execFileSync('git', ['-C', datasetDir, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
    const repo = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(remote);
    return repo ? `https://cdn.jsdelivr.net/gh/${repo[1]}/${repo[2]}@{tag}/` : null;
  } catch {
    return null;
  }
}

export interface JobSpec {
  name: string;
  label: string;
  /** Pourquoi on la lance, en une ligne, pour la page. */
  hint: string;
  cmd: string;
  args: string[];
  cwd: string;
  /** Ce qui doit être là avant de la lancer. */
  needs?: (ws: Workspace) => string | null;
}

const tool = (...args: string[]) => ({ cmd: 'npx', args: ['tsx', CLI, ...args], cwd: TOOL_DIR });

const needsDataset = (ws: Workspace) => (ws.state.dataset ? null : 'fetch the Dataset first');
const needsSnapshot = (ws: Workspace) => (ws.state.snapshot ? null : 'take a snapshot of the sources first');

/**
 * Les tâches offertes par l'interface. `release` et `propose` touchent au dépôt :
 * elles ne sont proposées que si l'interface a le droit d'écrire au loin.
 */
export function jobSpecs(ws: Workspace, body: Record<string, unknown> = {}): JobSpec[] {
  const dataslate = typeof body.dataslate === 'string' ? body.dataslate : '';
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Dataset changes';
  const branch = `dataset/${slug(title)}`;
  const releaseUrl = typeof body.releaseUrl === 'string' ? body.releaseUrl : '';

  return [
    {
      name: 'dataset',
      label: 'Fetch the Dataset',
      hint: 'clones the Dataset repository, or updates it if it is already there',
      cwd: TOOL_DIR,
      cmd: 'sh',
      args: [
        '-c',
        // Un clone la première fois, une mise à jour ensuite : le même bouton dans les deux cas.
        `if [ -d ${quote(join(ws.datasetDir, '.git'))} ]; then git -C ${quote(ws.datasetDir)} pull --ff-only; else git clone ${quote(ws.repository)} ${quote(ws.datasetDir)}; fi`,
      ],
    },
    {
      name: 'snapshot',
      label: 'Snapshot the sources',
      hint: 'downloads BSData, the MFM and 40kdc-data at one fixed commit (slow)',
      ...tool('fetch', '--out', ws.snapshotDir),
    },
    {
      name: 'build',
      label: 'Build the Dataset',
      hint: 'rebuilds from the snapshot, Corrections included',
      needs: (w) => needsDataset(w) ?? needsSnapshot(w),
      ...tool('build', '--snapshot', ws.snapshotDir, '--dataset', ws.datasetDir, '--game-system', ws.gameSystem),
    },
    {
      name: 'check',
      label: 'Check',
      hint: 'schema, and the no-rules-text rule',
      needs: needsDataset,
      ...tool('check', '--dataset', ws.datasetDir, '--game-system', ws.gameSystem),
    },
    {
      name: 'release',
      label: 'Publish a Release',
      hint: 'freezes the Dataset under an immutable tag and updates the manifest; without a confirmed Dataslate, the command only proposes one',
      needs: needsDataset,
      ...tool(
        'release',
        '--dataset',
        ws.datasetDir,
        '--game-system',
        ws.gameSystem,
        ...(dataslate ? ['--dataslate', dataslate] : []),
        ...(releaseUrl || defaultReleaseUrl(ws.datasetDir) ? ['--release-url', releaseUrl || defaultReleaseUrl(ws.datasetDir)!] : []),
      ),
    },
    {
      name: 'propose',
      label: 'Propose my changes',
      hint: ws.allowPush ? 'opens a pull request on the Dataset repository with what you wrote' : 'refused: the interface was started without --allow-push',
      needs: (w) => (w.allowPush ? needsDataset(w) : 'the interface was started without --allow-push'),
      cwd: ws.datasetDir,
      cmd: 'sh',
      args: [
        '-c',
        [
          `git checkout -b ${arg(branch)} 2>/dev/null || git checkout ${arg(branch)}`,
          'git add -A',
          // Rien de neuf à committer n'est pas une erreur : le commit précédent
          // existe peut-être déjà, et c'est le push qui avait échoué.
          `git diff --cached --quiet || git commit -m ${quote(title)}`,
          `git push -u origin ${arg(branch)}`,
          `gh pr create --title ${quote(title)} --body ${quote(PR_BODY)} || true`,
        ].join(' && '),
      ],
    },
  ];
}

/** Lance une tâche par son nom, après avoir vérifié ce qu'elle exige. */
export function startJob(ws: Workspace, runner: JobRunner, name: string, body: Record<string, unknown> = {}) {
  const spec = jobSpecs(ws, body).find((j) => j.name === name);
  if (!spec) throw new ApiError(404, `unknown task: ${name}`);
  const missing = spec.needs?.(ws);
  if (missing) throw new ApiError(409, missing);
  if (runner.busy) throw new ApiError(409, `a task is already running: ${runner.current?.name}`);
  return runner.start(spec.name, spec.cmd, spec.args, spec.cwd);
}
