/**
 * Ce que l'interface locale écrit dans le dépôt du Dataset : des Corrections, des
 * Effects et des résumés écrits par le projet. Rien ne s'écrit sans passer le
 * schéma et le contrôle « aucun texte de règles ». La PR, elle, part du dépôt
 * du mainteneur : l'interface donne les commandes, et ne les lance que sur
 * demande.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { indexPath, manifestPath, type Correction, type DatasetIndex, type Manifest } from '@paintplanplay/dataset-schema';
import { proposeDataslate, type DataslateProposal } from '../release.ts';
import { correctionsDir } from '../corrections/files.ts';
import { toJson } from '../dataset.ts';
import { fileURLToPath } from 'node:url';
import type { DatasetView } from './provenance.ts';
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

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'dataset';
const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** Un argument ne se protège que s'il en a besoin : les commandes restent lisibles. */
const arg = (s: string) => (/^[A-Za-z0-9_@:,./=+-]+$/.test(s) ? s : quote(s));

const PR_BODY = 'Proposed from the Dataset Tool local interface.';

/**
 * Pousser depuis l'interface, sans jamais rien demander au terminal.
 *
 * GitHub n'accepte plus de mot de passe pour git en HTTPS depuis août 2021 :
 * l'invite que git ouvre alors ne mène nulle part, et elle s'affiche dans le
 * terminal du serveur — invisible depuis la page, où le bouton paraît mort.
 *
 * On la coupe donc (`GIT_TERMINAL_PROMPT=0` : git échoue au lieu d'attendre), et
 * on prête à git le porte-clés de `gh`, déjà authentifié puisque c'est lui qui
 * ouvre la PR juste après. Le helper vide d'abord remet la liste à zéro : celui
 * que la machine a configuré (souvent `store`, vide ou périmé) passerait avant.
 */
const GIT_ASKS_NOTHING = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
const GH_KEYRING = ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential'];

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
  for (const { cmd, args } of steps) {
    const full = cmd === 'git' && args[0] === 'push' ? [...GH_KEYRING, ...args] : args;
    out = execFileSync(cmd, full, { cwd: dir, encoding: 'utf8', env: GIT_ASKS_NOTHING }).trim();
  }
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
/** Le dépôt du Dataset, « owner/repo », lu sur son remote. */
function repoOf(datasetDir: string): string | null {
  try {
    const remote = execFileSync('git', ['-C', datasetDir, 'remote', 'get-url', 'origin'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const repo = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(remote);
    return repo ? `${repo[1]}/${repo[2]}` : null;
  } catch {
    return null;
  }
}

export function defaultReleaseUrl(datasetDir: string): string | null {
  const repo = repoOf(datasetDir);
  return repo ? `https://cdn.jsdelivr.net/gh/${repo}@{tag}/` : null;
}

/**
 * L'adresse qui fait oublier à jsDelivr sa copie du manifeste. Les Releases,
 * servies à leur tag, sont neuves et immuables ; le manifeste, lui, est servi
 * depuis `main` et gardé jusqu'à 12 h : sans purge, les applications ne voient
 * pas la nouvelle Release avant. `null` hors jsDelivr.
 */
export function manifestPurgeUrl(releaseUrl: string): string | null {
  const m = /^https:\/\/cdn\.jsdelivr\.net\/gh\/([^@]+)@\{tag\}\/?$/.exec(releaseUrl);
  return m ? `https://purge.jsdelivr.net/gh/${m[1]}@main/${manifestPath}` : null;
}

/**
 * Publier une Release écrit dans le dépôt : le bouton ne s'ouvre qu'à qui en a
 * le droit, plutôt que d'échouer au push devant quelqu'un qui n'y pouvait rien.
 * GitHub le dit — ADMIN, MAINTAIN ou WRITE —, et `gh` le lui demande.
 *
 * La réponse est gardée une fois obtenue : c'est un appel réseau, et l'état de
 * la page le redemanderait à chaque rafraîchissement. Un échec, lui, n'est pas
 * gardé : on se sera peut-être authentifié entre-temps.
 */
/**
 * Le GitHub CLI est-il utilisable *par ce processus* ? Proposer et publier en
 * dépendent tous deux — pour le porte-clés du push comme pour lire les droits.
 *
 * La question n'est pas « est-il installé » mais « ce processus le trouve-t-il » :
 * `gh` vit souvent dans ~/.local/bin, absent du PATH d'un lanceur graphique. On
 * le dit donc dans l'état de la page, avant le clic, plutôt que de laisser
 * échouer un bouton en accusant une authentification qui, elle, est bonne.
 */
let ghVu: boolean | undefined;

export function ghReady(): boolean {
  // Un échec n'est pas gardé : on se sera peut-être connecté entre-temps.
  if (ghVu) return true;
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'ignore', env: GIT_ASKS_NOTHING });
    ghVu = true;
  } catch {
    ghVu = false;
  }
  return ghVu;
}

const WRITERS = new Set(['ADMIN', 'MAINTAIN', 'WRITE']);
let droitConnu: string | undefined;
/** Ce que `gh` a répondu quand il n'a pas répondu de droit : sans ça, on cherche à l'aveugle. */
let pourquoiPas = '';

export function publishRight(datasetDir: string): string | null {
  const repo = repoOf(datasetDir);
  if (!repo) return 'the Dataset folder has no GitHub remote — click Update data first';
  if (droitConnu === undefined) {
    try {
      const out = execFileSync('gh', ['repo', 'view', repo, '--json', 'viewerPermission'], {
        encoding: 'utf8',
        env: GIT_ASKS_NOTHING,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      droitConnu = (JSON.parse(out) as { viewerPermission?: string }).viewerPermission || undefined;
      pourquoiPas = '';
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      // Dire ce que l'outil a vu, plutôt que d'envoyer se connecter quelqu'un qui l'est déjà.
      pourquoiPas = String(e.stderr || e.message || '').trim().split('\n')[0].slice(0, 200);
    }
  }
  if (!droitConnu) return `cannot check your rights on ${repo} — the GitHub CLI answered: ${pourquoiPas || '(nothing)'}`;
  return WRITERS.has(droitConnu) ? null : `you have ${droitConnu} access on ${repo}: only a maintainer can publish a Release`;
}

/** Ce qu'une tâche demande avant de partir, posé par la page dans sa modale. */
export interface JobField {
  name: 'dataslate' | 'mfmVersion' | 'releaseUrl' | 'purgeCdn' | 'title';
  /** Une case à cocher plutôt qu'un champ : sa valeur est « true » ou « false ». */
  kind?: 'checkbox';
  label: string;
  /** Ce que c'est, pour qui ne le sait pas : la modale l'affiche sous le libellé. */
  hint: string;
  /** Proposition pré-remplie, quand l'outil sait la calculer. */
  value?: string;
}

export interface JobSpec {
  name: string;
  label: string;
  /** Pourquoi on la lance, en une ligne, pour la page. */
  hint: string;
  cmd: string;
  args: string[];
  cwd: string;
  /** Ce qu'elle demande avant de partir ; vide pour les tâches qui ne demandent rien. */
  asks?: JobField[];
  /** Ce qui doit être là avant de la lancer. */
  needs?: (ws: Workspace) => string | null;
}

/**
 * La Dataslate que l'outil publierait, telle qu'il la déduit de la version du
 * MFM. La proposer évite d'avoir à l'inventer : personne ne peut deviner
 * « mfm-1-4 » depuis une page web.
 */
export function dataslateProposal(ws: Workspace): DataslateProposal | null {
  try {
    const index = JSON.parse(readFileSync(join(ws.datasetDir, indexPath(ws.gameSystem)), 'utf8')) as DatasetIndex;
    const file = join(ws.datasetDir, manifestPath);
    const manifest = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Manifest) : undefined;
    return proposeDataslate(index.sources, manifest);
  } catch {
    return null;
  }
}

const tool = (...args: string[]) => ({ cmd: 'npx', args: ['tsx', CLI, ...args], cwd: TOOL_DIR });

/**
 * Un script shell où chaque message d'échec appartient à sa propre commande.
 *
 * Enchaîner par `&&` puis clore par `|| { echo … }` faisait porter le dernier
 * message à *tout* échec antérieur : une Release arrêtée faute de Dataslate
 * annonçait un push impossible, et on cherchait un problème d'authentification
 * qui n'existait pas. Une commande par ligne, chacune avec son propre message.
 */
function script(steps: [string, string][]): string {
  return ['set -e', 'export GIT_TERMINAL_PROMPT=0', ...steps.map(([cmd, oops]) => `{ ${cmd}; } || { echo ${quote(oops)}; exit 1; }`)].join('\n');
}

const needsDataset = (ws: Workspace) => (ws.state.dataset ? null : 'click Update data first');
const needsSnapshot = (ws: Workspace) => (ws.state.snapshot ? null : 'click Update data first, so the sources are here');
const needsPush = (ws: Workspace) => (ws.allowPush ? null : 'restart the interface with: npm run dev -- --allow-push');

/**
 * Les tâches offertes par l'interface. `release` et `propose` touchent au dépôt :
 * elles ne sont proposées que si l'interface a le droit d'écrire au loin.
 */
export function jobSpecs(
  ws: Workspace,
  body: Record<string, unknown> = {},
  /** Qui peut publier : GitHub par défaut, remplacé par les tests. */
  rights: { publishRight(datasetDir: string): string | null } = { publishRight },
): JobSpec[] {
  /** Le dossier du Dataset dans une commande shell, protégé une fois pour toutes. */
  const ds = (sub?: string) => quote(sub ? join(ws.datasetDir, sub) : ws.datasetDir);
  const dataslate = typeof body.dataslate === 'string' ? body.dataslate : '';
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Dataset changes';
  const branch = `dataset/${slug(title)}`;
  const releaseUrl = typeof body.releaseUrl === 'string' ? body.releaseUrl : '';
  const mfmVersion = typeof body.mfmVersion === 'string' ? body.mfmVersion.trim() : '';
  const purgeCdn = body.purgeCdn !== 'false' && body.purgeCdn !== false;
  const purgeUrl = manifestPurgeUrl(releaseUrl || defaultReleaseUrl(ws.datasetDir) || '');
  const proposition = dataslateProposal(ws);

  return [
    {
      name: 'update',
      label: 'Update data',
      hint: 'brings everything up to date: the Dataset as published, and a fresh snapshot of the three sources. A few minutes',
      cwd: TOOL_DIR,
      cmd: 'sh',
      args: [
        '-c',
        script([
          // Un clone la première fois. Ensuite retour sur main, parce que proposer
          // laisse le dossier sur sa branche : on ne construit pas, et surtout on
          // ne publie pas, depuis une branche qui attend sa relecture. Les Pending
          // Changes suivent (autostash) : une mise à jour ne détruit jamais le
          // travail en cours, elle le fait réévaluer contre le nouvel instantané.
          [
            `if [ -d ${ds('.git')} ]; then git -C ${ds()} checkout main && git -C ${ds()} pull --ff-only --autostash; else git clone ${quote(ws.repository)} ${ds()}; fi`,
            'the Dataset folder could not be updated — it probably holds changes that are neither proposed nor discarded.',
          ],
          [`npx tsx ${quote(CLI)} fetch --out ${quote(ws.snapshotDir)}`, 'the sources could not be downloaded — read the lines above.'],
        ]),
      ],
    },
    {
      name: 'build',
      label: 'Save and build',
      hint: 'writes your corrections into the Dataset files, from the snapshot, then checks them',
      needs: (w) => needsDataset(w) ?? needsSnapshot(w),
      cwd: TOOL_DIR,
      cmd: 'sh',
      args: [
        '-c',
        // Proposer n'ouvre qu'après un build qui passe le contrôle : les deux vont ensemble.
        script([
          [
            `npx tsx ${quote(CLI)} build --snapshot ${quote(ws.snapshotDir)} --dataset ${ds()} --game-system ${arg(ws.gameSystem)}`,
            'the build failed — read the lines above.',
          ],
          [`npx tsx ${quote(CLI)} check --dataset ${ds()} --game-system ${arg(ws.gameSystem)}`, 'the check refused the Dataset — read the lines above.'],
        ]),
      ],
    },
    {
      name: 'propose',
      label: 'Propose my changes',
      hint: 'opens a pull request on the Dataset repository with what you wrote',
      needs: (w) => needsPush(w) ?? needsDataset(w),
      cwd: ws.datasetDir,
      asks: [
        {
          name: 'title',
          label: 'Name for your pull request',
          hint: 'A maintainer sees this line in the list of open requests. Say what you changed, for example "Ghazghkull back to 300 points".',
          value: title,
        },
      ],
      cmd: 'sh',
      args: [
        '-c',
        script([
          [`git checkout -b ${arg(branch)} 2>/dev/null || git checkout ${arg(branch)}`, 'could not open a branch for your changes — read the lines above.'],
          ['git add -A', 'your changes could not be staged — read the lines above.'],
          // Rien de neuf à committer n'est pas une erreur : le commit précédent
          // existe peut-être déjà, et c'est le push qui avait échoué.
          [`git diff --cached --quiet || git commit -m ${quote(title)}`, 'your changes could not be committed — read the lines above.'],
          // Le porte-clés de `gh` plutôt qu'une invite que la page ne verrait pas.
          [
            `git ${GH_KEYRING.map(arg).join(' ')} push -u origin ${arg(branch)}`,
            'push refused — see git above. GitHub has not accepted a password since 2021: the push borrows the GitHub CLI, so it also fails when this process cannot run `gh`.',
          ],
          [`gh pr create --title ${quote(title)} --body ${quote(PR_BODY)} || true`, 'the pull request could not be opened — the push did go through, open it from GitHub.'],
        ]),
      ],
    },
    {
      name: 'release',
      label: 'Publish a Release',
      hint: 'once the pull request is merged: takes in what was merged, freezes it under an immutable tag, and pushes it. Name the Dataslate above, or click once to be told which one to confirm',
      needs: (w) => needsPush(w) ?? needsDataset(w) ?? rights.publishRight(w.datasetDir),
      cwd: TOOL_DIR,
      asks: [
        {
          name: 'dataslate',
          label: 'Rules period to publish into',
          hint: proposition
            ? `Releases are grouped by rules period, named after the Munitorum Field Manual. Yours is MFM ${proposition.mfmVersion}, ${
                proposition.isNew ? 'which opens a new period' : 'which already exists'
              } — keep the proposed name unless you know otherwise.`
            : 'Releases are grouped by rules period, named after the Munitorum Field Manual version the Dataset was built from.',
          value: proposition?.id ?? dataslate,
        },
        {
          name: 'mfmVersion',
          label: 'MFM version these points follow',
          hint: `The Munitorum Field Manual this Dataset applies${
            proposition ? ` — MFM ${proposition.mfmVersion} as far as the tool knows` : ''
          }. Entered a newer MFM by hand before BSData did? Put its version here (e.g. 1.5) and name the rules period after it (mfm-1-5).`,
          value: mfmVersion || proposition?.mfmVersion || '',
        },
        {
          name: 'releaseUrl',
          label: 'Address the apps will read this release from',
          hint: 'A CDN serving your repository at the release tag. Taken from the repository itself — leave it unless you serve the files elsewhere.',
          value: releaseUrl || defaultReleaseUrl(ws.datasetDir) || '',
        },
        ...(manifestPurgeUrl(defaultReleaseUrl(ws.datasetDir) ?? '')
          ? [
              {
                name: 'purgeCdn' as const,
                kind: 'checkbox' as const,
                label: 'Refresh the CDN copy of the manifest',
                hint: 'jsDelivr keeps the manifest up to 12 hours: purging it shows this Release to the apps within minutes. Untick for a minor update that can wait.',
                value: 'true',
              },
            ]
          : []),
      ],
      cmd: 'sh',
      args: [
        '-c',
        script([
          // Ce qui vient d'être fusionné, d'abord : une Release tague le dépôt tel
          // qu'il est ici, et taguer une branche en retard ne se rattrape pas.
          [
            `git -C ${ds()} checkout main && git -C ${ds()} pull --ff-only`,
            'the Dataset folder could not be updated — it probably holds changes that are neither proposed nor discarded.',
          ],
          [
            `npx tsx ${quote(CLI)} release --dataset ${ds()} --game-system ${arg(ws.gameSystem)}${dataslate ? ` --dataslate ${arg(dataslate)}` : ''}${mfmVersion ? ` --mfm-version ${arg(mfmVersion)}` : ''}${
              releaseUrl || defaultReleaseUrl(ws.datasetDir) ? ` --release-url ${arg(releaseUrl || defaultReleaseUrl(ws.datasetDir)!)}` : ''
            }`,
            'no Release was made — read the lines above. Without a confirmed rules period, the tool only proposes one and stops.',
          ],
          // Le tag ne vaut que poussé : sans ça la Release n'existe que sur cette machine.
          [
            `git -C ${ds()} ${GH_KEYRING.map(arg).join(' ')} push --follow-tags`,
            'the Release was made here but could not be pushed — see git above. The push borrows the GitHub CLI, so it also fails when this process cannot run `gh`.',
          ],
          // Après le push seulement : purger plus tôt referait mettre en cache l'ancien manifeste.
          // Un échec n'annule rien — la Release est publiée, le cache expirera de lui-même.
          ...(purgeCdn && purgeUrl
            ? ([[`curl -fsS -o /dev/null ${arg(purgeUrl)} && echo 'jsDelivr: manifest purged' || echo ${quote(`jsDelivr refused the purge — the Release is published; apps will see it within 12 hours, or run: curl ${purgeUrl}`)}`, 'unreachable']] as [string, string][])
            : []),
        ]),
      ],
    },
    {
      name: 'check',
      label: 'Check',
      hint: 'schema, and the no-rules-text rule. This runs on its own before a Release and on every pull request — the button is only to see it now',
      needs: needsDataset,
      ...tool('check', '--dataset', ws.datasetDir, '--game-system', ws.gameSystem),
    },
  ];
}

/** Lance une tâche par son nom, après avoir vérifié ce qu'elle exige. */
export function startJob(
  ws: Workspace,
  runner: JobRunner,
  name: string,
  body: Record<string, unknown> = {},
  rights?: { publishRight(datasetDir: string): string | null },
) {
  const spec = jobSpecs(ws, body, rights).find((j) => j.name === name);
  if (!spec) throw new ApiError(404, `unknown task: ${name}`);
  const missing = spec.needs?.(ws);
  if (missing) throw new ApiError(409, missing);
  if (runner.busy) throw new ApiError(409, `a task is already running: ${runner.current?.name}`);
  return runner.start(spec.name, spec.cmd, spec.args, spec.cwd);
}
