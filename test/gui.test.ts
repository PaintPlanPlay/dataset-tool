/**
 * L'interface graphique locale (issue #70) : elle n'écoute que sur la machine,
 * dit d'où vient chaque valeur, et n'écrit une Correction, un Effect ou un
 * résumé qu'après le schéma et le contrôle « aucun texte de règles ».
 *
 * Elle démarre aussi les mains vides — ni Dataset ni instantané — et propose
 * alors de les récupérer : c'est le cas de la machine neuve.
 *
 *   npx tsx test/gui.test.ts
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultReleaseUrl, jobSpecs } from '../src/gui/api.ts';
import { allowedHost, allowedOrigin, privateAddress, startGui } from '../src/gui/server.ts';
import type { Overview } from '../src/gui/overview.ts';
import type { SearchHit } from '../src/gui/provenance.ts';
import type { Sheet } from '../src/gui/sheets.ts';
import { viteUi } from '../src/gui/ui.ts';
import { openWorkspace } from '../src/gui/workspace.ts';
import { check, fixture, section } from './check.ts';

const dir = mkdtempSync(join(tmpdir(), 'dataset-gui-'));
const ws = await openWorkspace({ datasetDir: dir, snapshotDir: fixture('snapshot') });
const gui = await startGui(ws, 0);
const base = new URL(gui.url);

const raw = (path: string, headers: Record<string, string>, port = base.port) =>
  new Promise<number>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
const get = async <T>(path: string) => {
  const res = await fetch(new URL(path, gui.url));
  return { status: res.status, body: (await res.json()) as T };
};
const post = async <T>(path: string, body: unknown) => {
  const res = await fetch(new URL(path, gui.url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as T };
};
const originOf = (i: Sheet, field: string) => i.origins.find((o) => o.field === field);

try {
  section('Interface locale : accès');
  check('n\'écoute que sur 127.0.0.1 par défaut', base.hostname === '127.0.0.1');
  check(
    'adresses acceptées : boucle locale, réseaux privés, plage Tailscale',
    ['127.0.0.1', 'localhost', '192.168.1.10', '10.0.0.5', '172.16.0.1', '100.101.102.103'].every(privateAddress),
  );
  check(
    'adresses refusées : publiques, toutes interfaces, hors plage',
    !['0.0.0.0', '51.77.216.110', '8.8.8.8', '172.32.0.1', '100.200.0.1', 'exemple.fr'].some(privateAddress),
  );
  let publicRefused = false;
  try {
    await startGui(ws, { port: 0, host: '51.77.216.110' });
  } catch {
    publicRefused = true;
  }
  check('écouter sur une adresse publique est refusé : l\'interface n\'a aucune authentification', publicRefused);
  check(
    'ouverte à un réseau privé : cette adresse est acceptée, une autre non',
    allowedHost('100.101.102.103:4173', 4173, '100.101.102.103') &&
      allowedOrigin('http://100.101.102.103:4173', 4173, '100.101.102.103') &&
      !allowedHost('evil.example:4173', 4173, '100.101.102.103') &&
      !allowedOrigin('https://evil.example', 4173, '100.101.102.103'),
  );
  check(
    'un autre hôte ou une autre origine est refusé',
    (await raw('/api/search?q=boyz', { Host: `evil.example:${base.port}` })) === 403 &&
      (await raw('/api/search?q=boyz', { Host: `127.0.0.1:${base.port}`, Origin: 'https://evil.example' })) === 403,
  );

  section('Interface locale : origine des valeurs');
  const hits = await get<{ kind: string; target: string; name: string }[]>('/api/search?q=war');
  const warHorde = hits.body.find((h) => h.kind === 'detachment' && h.name === 'War Horde');
  check('recherche : Units, Detachments, Stratagems', hits.body.some((h) => h.name === 'Warboss') && Boolean(warHorde), hits.body.map((h) => `${h.kind}:${h.name}`).join(', '));

  const boss = (await get<Sheet>('/api/sheet?target=u-warboss')).body;
  check(
    'Unit : chaque champ dit sa source — MFM pour le coût, BSData pour le profil, 40kdc-data pour l\'Effect',
    ['mfm', 'bsdata'].includes(originOf(boss, 'points')?.origin ?? '') && originOf(boss, 'models')?.origin === 'bsdata' && originOf(boss, 'abilities › Da Boss Fixture')?.origin === '40kdc',
    JSON.stringify(boss.origins),
  );
  const det = (await get<Sheet>(`/api/sheet?target=${encodeURIComponent(warHorde!.target)}`)).body;
  check('Detachment : DP du MFM, règles de 40kdc-data', originOf(det, 'dp')?.origin === 'mfm' && originOf(det, 'rules')?.origin === '40kdc');

  section('Interface locale : écrire');
  const boyz = (await get<Sheet>('/api/sheet?target=u-boyz')).body;
  const prose = 'Each time this unit makes an attack, add one to the hit roll and if the target is within range of an objective marker you can re-roll the wound roll as well for every model in it';
  const boyzValue = boyz.value as { pricing: { costs: { points: number }[] }[] };
  const repriced = structuredClone(boyzValue);
  repriced.pricing[0].costs[0].points = 99;
  const refused = await post<{ error: string }>('/api/sheet/save', { target: 'u-boyz', draft: repriced, reason: prose });
  check('une raison porteuse de texte de règles est refusée, rien n\'est écrit', refused.status === 400 && !existsSync(join(dir, 'corrections')));

  /*
   * Relire le Dataset après une écriture demande deux reconstructions — une
   * vingtaine de secondes sur le vrai Dataset. L'écriture ne doit pas attendre
   * ça : sinon le bouton paraît mort, et le message n'arrive jamais.
   */
  const debut = Date.now();
  const written = await post<{ files: { path: string }[] }>('/api/sheet/save', { target: 'u-boyz', draft: repriced, reason: 'Coût de test.' });
  const duree = Date.now() - debut;
  check("une écriture répond sans attendre la relecture du Dataset", duree < 3000, `${duree} ms`);
  const path = written.body.files[0]?.path ?? '';
  await post('/api/refresh', {});
  const after = (await get<Sheet>('/api/sheet?target=u-boyz')).body;
  check(
    'enregistrer une fiche : fichier écrit, valeur rattachée à la Correction',
    written.status === 201 && existsSync(join(dir, path)) && originOf(after, 'pricing')?.origin === 'correction' && originOf(after, 'pricing')?.detail === path,
    JSON.stringify(written.body),
  );

  const bossValue = boss.value as { abilities: { name: string; summary?: string }[] };
  const longDraft = structuredClone(bossValue);
  longDraft.abilities.find((a) => a.name === 'Da Boss Fixture')!.summary = 'x '.repeat(100);
  const shortDraft = structuredClone(bossValue);
  shortDraft.abilities.find((a) => a.name === 'Da Boss Fixture')!.summary = '+1 to wound in melee.';
  const longSummary = await post<{ error: string }>('/api/sheet/save', { target: 'u-warboss', draft: longDraft, reason: 'Test.' });
  const summary = await post<{ files: unknown[] }>('/api/sheet/save', { target: 'u-warboss', draft: shortDraft, reason: 'Résumé de test.' });
  await post('/api/refresh', {});
  const bossAfter = (await get<Sheet>('/api/sheet?target=u-warboss')).body;
  const bossAbility = (bossAfter.value as { abilities: { name: string; summary?: string; effectSource?: string }[] }).abilities.find((a) => a.name === 'Da Boss Fixture');
  check(
    'un résumé passe le contrôle « aucun texte » avant d\'être écrit ; il s\'ajoute sans toucher l\'Effect',
    longSummary.status === 400 && summary.status === 201 && bossAbility?.summary === '+1 to wound in melee.' && bossAbility.effectSource === '40kdc',
  );

  check('les propositions de l\'analyse sont consultables', boyz.proposals.some((p) => p.ability === 'Mob Fixture'));
  const accepted = await post<{ path: string }>('/api/proposals/accept', { target: 'u-boyz::ability:Mob Fixture' });
  await post('/api/refresh', {});
  const boyzAfter = (await get<Sheet>('/api/sheet?target=u-boyz')).body;
  check(
    'accepter une proposition : elle devient un Effect écrit par le projet',
    accepted.status === 201 && originOf(boyzAfter, 'abilities › Mob Fixture')?.origin === 'project' && boyzAfter.proposals.length === 0,
  );

  const draft = await get<{ repository: string; url: string }>(`/api/upstream-draft?path=${encodeURIComponent(path)}`);
  const pr = await post<{ path: string }>('/api/corrections/upstream-pr', { path, url: 'https://github.com/BSData/wh40k-11e-mfm/pull/12' });
  const saved = JSON.parse(readFileSync(join(dir, path), 'utf8')) as { upstreamPr?: string };
  check(
    'retour amont : issue préremplie chez la bonne source, PR enregistrée sur la Correction',
    draft.body.url.startsWith('https://github.com/BSData/wh40k-11e-mfm/issues/new?') && pr.status === 200 && saved.upstreamPr === 'https://github.com/BSData/wh40k-11e-mfm/pull/12',
  );

  section("Interface locale : démarrage les mains vides");
  const vide = mkdtempSync(join(tmpdir(), 'dataset-vide-'));
  const wsVide = await openWorkspace({ datasetDir: join(vide, 'dataset'), snapshotDir: join(vide, '.snapshot') });
  const guiVide = await startGui(wsVide, { port: 0 });
  try {
    const at = async <T>(path: string, body?: unknown) => {
      const res = await fetch(new URL(path, guiVide.url), body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      return { status: res.status, body: (await res.json().catch(() => ({}))) as T };
    };
    const state = await at<Overview>('/api/overview');
    const job = (name: keyof Overview['buttons']) => state.body.buttons[name];
    check(
      "l'état dit qu'il n'y a ni Dataset ni instantané",
      !state.body.workspace.dataset && !state.body.workspace.snapshot && !state.body.workspace.published && state.body.workspace.armies === 0,
      JSON.stringify(state.body.workspace),
    );
    check(
      'un seul bouton pour se mettre à jour ; construire et contrôler attendent leur tour',
      job('update').enabled && !job('build').enabled && !job('check').enabled,
      Object.values(state.body.buttons).map((j) => `${j.name}:${j.reason ?? 'ok'}`).join(' · '),
    );
    check("l'écriture distante est refusée sans --allow-push", !state.body.allowPush && !job('propose').enabled && !job('release').enabled);

    /*
     * Publier écrit dans le dépôt : le bouton se ferme à qui n'en a pas le droit,
     * plutôt que d'échouer au push devant quelqu'un qui n'y pouvait rien.
     */
    const specRelease = jobSpecs(wsVide).find((j) => j.name === 'release')!;
    check(
      'publier demande la période de règles et son adresse, au lieu de trois champs posés en permanence',
      (specRelease.asks ?? []).map((f) => f.name).join() === 'dataslate,releaseUrl',
      JSON.stringify((specRelease.asks ?? []).map((f) => f.label)),
    );

    /*
     * Enchaîner par `&&` puis clore par `|| { echo … }` faisait porter le dernier
     * message à tout échec antérieur : une Release arrêtée faute de période
     * confirmée annonçait un push impossible, et on cherchait un problème
     * d'authentification qui n'existait pas.
     */
    const lignes = specRelease.args[1].split('\n');
    check(
      "un échec ne porte jamais le message d'une autre commande",
      !lignes.some((l) => l.includes('release --dataset') && l.includes('could not be pushed')) && lignes.filter((l) => l.includes('echo ')).length >= 3,
      lignes.length + ' lignes',
    );

    const release = jobSpecs(wsVide).find((j) => j.name === 'release')!.args.join(' ');
    check(
      'publier fait tout : retour sur main, mise à jour, tag, puis push',
      release.includes('checkout main') && release.includes('pull --ff-only') && release.includes('release --dataset') && release.includes('push --follow-tags'),
      release.slice(0, 140),
    );
    check(
      'se mettre à jour revient sur main : on ne publie jamais depuis une branche en attente',
      jobSpecs(wsVide).find((j) => j.name === 'update')!.args.join(' ').includes('checkout main'),
    );

    /*
     * GitHub n'accepte plus de mot de passe pour git depuis 2021. L'invite que
     * git ouvre alors ne mène nulle part, et elle s'affiche dans le terminal du
     * serveur — invisible depuis la page, où le bouton paraît simplement mort.
     * Proposer doit donc couper l'invite et emprunter le porte-clés de `gh`.
     */
    const propose = jobSpecs(wsVide).find((j) => j.name === 'propose')!.args.join(' ');
    check(
      'proposer ne demande jamais rien au terminal : invite coupée, porte-clés de gh',
      propose.includes('GIT_TERMINAL_PROMPT=0') && propose.includes('gh auth git-credential'),
      propose.slice(0, 140),
    );

    /*
     * L'adresse des Releases est celle du CDN qui sert le dépôt du Dataset :
     * elle se déduit du remote, sinon publier échoue sur un message que
     * personne ne sait interpréter.
     */
    const distant = mkdtempSync(join(tmpdir(), 'dataset-remote-'));
    const git = (...a: string[]) => execFileSync('git', ['-C', distant, ...a], { encoding: 'utf8' });
    git('init', '--quiet');
    check("sans remote, aucune adresse de Releases n'est devinée", defaultReleaseUrl(distant) === null);
    git('remote', 'add', 'origin', 'git@github.com:PaintPlanPlay/dataset.git');
    check(
      "l'adresse des Releases se déduit du dépôt (SSH)",
      defaultReleaseUrl(distant) === 'https://cdn.jsdelivr.net/gh/PaintPlanPlay/dataset@{tag}/',
      String(defaultReleaseUrl(distant)),
    );
    git('remote', 'set-url', 'origin', 'https://github.com/PaintPlanPlay/dataset.git');
    check(
      "et de la même façon en HTTPS",
      defaultReleaseUrl(distant) === 'https://cdn.jsdelivr.net/gh/PaintPlanPlay/dataset@{tag}/',
      String(defaultReleaseUrl(distant)),
    );
    rmSync(distant, { recursive: true, force: true });

    const avecDepot = await at<Overview>('/api/overview');
    check(
      "l'interface préremplit l'adresse des Releases dans ce que Publish demande",
      avecDepot.body.buttons.release.asks.some((f) => f.name === 'releaseUrl'),
    );

    /*
     * Proposer et publier empruntent tous deux le GitHub CLI : pour le porte-clés
     * du push, et pour lire les droits sur le dépôt. Quand le processus ne peut
     * pas le lancer — `gh` vit souvent dans ~/.local/bin, absent du PATH d'un
     * lanceur graphique —, les deux échouent sur une erreur qui a l'air d'accuser
     * l'authentification, laquelle est pourtant bonne. L'état le dit avant le clic.
     */
    check(
      "l'état dit si le GitHub CLI est utilisable par ce processus",
      typeof avecDepot.body.gh === 'boolean',
      String(avecDepot.body.gh),
    );

    const search = await at<{ error: string }>('/api/search?q=boyz');
    check(
      "consulter sans Dataset dit par quel bouton commencer",
      search.status === 409 && search.body.error.includes('fetch the Dataset'),
      `${search.status} ${search.body.error}`,
    );
    check('une tâche inconnue est refusée', (await at('/api/jobs/effacer-tout', {})).status === 404);
    check("une tâche dont le prérequis manque est refusée", (await at<{ error: string }>('/api/jobs/build', {})).status === 409);

    const first = await at<{ job: { name: string } }>('/api/jobs/update', {});
    const second = await at<{ error: string }>('/api/jobs/update', {});
    check(
      'une seule tâche à la fois : la seconde est refusée pendant la première',
      first.status === 202 && second.status === 409 && second.body.error.includes('already running'),
      `${first.status}/${second.status}`,
    );
  } finally {
    await guiVide.close();
    rmSync(vide, { recursive: true, force: true });
  }

  section('Nouvelle interface : état global');
  /*
   * Savoir si l'instantané est à jour demande la tête de chaque Upstream Source,
   * et savoir qui peut publier demande GitHub : deux sondes que le test remplace,
   * pour ne dépendre ni du réseau ni d'un compte.
   */
  const overviewDir = mkdtempSync(join(tmpdir(), 'dataset-overview-'));
  cpSync(fixture('dataset'), overviewDir, { recursive: true });
  const release = (n: number) => ({ tag: `wh40k-11e-mfm-1-4-r${n}`, number: n, publishedAt: '2026-09-01T00:00:00.000Z', schemaVersion: '1.0.0' });
  writeFileSync(
    join(overviewDir, 'manifest.json'),
    JSON.stringify({
      schemaVersion: '1.0.0',
      gameSystem: 'wh40k-11e',
      releaseUrl: 'https://cdn.example/{tag}/',
      current: 'mfm-1-4',
      offered: ['mfm-1-4'],
      dataslates: [{ id: 'mfm-1-4', name: 'MFM 1.4', mfmVersion: '1.4', frozen: false, releases: [release(2), release(1)], latest: 'wh40k-11e-mfm-1-4-r2' }],
    }),
  );
  const snapshotHeads: Record<string, string> = Object.fromEntries(
    (JSON.parse(readFileSync(fixture('snapshot', 'sources.json'), 'utf8')) as { id: string; commit: string }[]).map((s) => [s.id, s.commit]),
  );
  let heads: Record<string, string> | Error = snapshotHeads;
  let right: string | null = 'you have READ access on PaintPlanPlay/dataset: only a maintainer can publish a Release';
  const wsOverview = await openWorkspace({ datasetDir: overviewDir, snapshotDir: fixture('snapshot') });
  const guiOverview = await startGui(wsOverview, {
    port: 0,
    probe: {
      upstreamHeads: async () => {
        if (heads instanceof Error) throw heads;
        return heads;
      },
      publishRight: () => right,
      pullRequest: () => null,
    },
  });
  try {
    const at = async <T>(path: string) => (await fetch(new URL(path, guiOverview.url))).json() as Promise<T>;
    const overview = () => at<Overview>('/api/overview');

    const fresh = await overview();
    const source = (o: Overview, id: string) => o.versions.sources.find((x) => x.id === id);
    check(
      'versions : Dataset Release, Dataslate, BSData et MFM',
      fresh.versions.release === 'wh40k-11e-mfm-1-4-r2' && fresh.versions.dataslate?.name === 'MFM 1.4' &&
        source(fresh, 'bsdata')?.commit === snapshotHeads.bsdata && source(fresh, 'mfm')?.version === '1.4',
      JSON.stringify(fresh.versions),
    );
    check('le nombre de Corrections du Dataset', fresh.corrections === 4, String(fresh.corrections));
    check('tout est à jour : Update data est grisé', fresh.upToDate === true && !fresh.buttons.update.enabled, JSON.stringify(fresh.buttons.update));
    check(
      'chaque bouton dit s\'il est actif, et pourquoi pas',
      (['update', 'build', 'propose', 'release', 'check'] as const).every((n) => typeof fresh.buttons[n].enabled === 'boolean') &&
        fresh.buttons.build.enabled && fresh.buttons.check.enabled && !fresh.buttons.propose.enabled && Boolean(fresh.buttons.propose.reason),
    );
    check('sans droit d\'écriture, Publish Release est masqué', !fresh.buttons.release.visible);
    check('les Armies, pour le filtre de la recherche', fresh.armies.some((a) => a.id === 'orks' && a.name === 'Orks'));

    heads = { ...snapshotHeads, bsdata: 'f'.repeat(40) };
    right = null;
    const moved = await overview();
    check(
      'une source a bougé : pas à jour, Update data actif, la source en cause désignée',
      moved.upToDate === false && moved.buttons.update.enabled && source(moved, 'bsdata')?.upToDate === false && source(moved, 'mfm')?.upToDate === true,
    );
    check('avec le droit d\'écrire, Publish Release apparaît', moved.buttons.release.visible);

    heads = new Error('offline');
    const offline = await overview();
    check('sans réseau : statut inconnu, Update data reste possible', offline.upToDate === null && offline.buttons.update.enabled);

    section('Nouvelle interface : recherche et fiche');
    const war = await at<SearchHit[]>('/api/search?q=war');
    check(
      'chaque résultat porte son Army',
      war.length > 0 && war.every((h) => h.armyName.length > 0) && war.find((h) => h.name === 'Warboss')?.armyName === 'Orks',
      war.map((h) => `${h.name} · ${h.armyName}`).join(', '),
    );
    const onlyCustodes = await at<SearchHit[]>('/api/search?q=a&army=adeptus-custodes');
    const everyArmy = await at<SearchHit[]>('/api/search?q=a');
    check(
      'le filtre d\'Army restreint les résultats ; Core, commun à toutes, reste trouvable',
      onlyCustodes.some((h) => h.army === 'adeptus-custodes') && onlyCustodes.every((h) => h.army === 'adeptus-custodes' || h.army === 'core') &&
        everyArmy.some((h) => h.army === 'orks'),
    );
    const kinds = new Set([...everyArmy, ...(await at<SearchHit[]>('/api/search?q=core'))].map((h) => h.kind));
    check('la recherche trouve Units, Detachments, Stratagems et Core', ['unit', 'detachment', 'stratagem', 'core'].every((k) => kinds.has(k as SearchHit['kind'])), [...kinds].join());
    const core = await at<Sheet>('/api/sheet?target=core');
    const coreValue = core.value as { battleSizes: unknown[]; stratagems: unknown[] };
    check('la fiche Core porte les Battle Sizes et les Stratagems Core', core.kind === 'core' && Array.isArray(coreValue.battleSizes) && coreValue.stratagems.length > 0);
    const schema = await at<{ dataset: { $defs: Record<string, unknown> }; vendor: { $id: string }[] }>('/api/schema');
    check(
      'le schéma du Dataset est servi au moteur de rendu, avec les schémas d\'Effect',
      ['unit', 'detachment', 'stratagem', 'coreFile'].every((d) => d in schema.dataset.$defs) && schema.vendor.some((v) => v.$id.includes('effect')),
    );
  } finally {
    await guiOverview.close();
    rmSync(overviewDir, { recursive: true, force: true });
  }

  section('Nouvelle interface : servie par la même commande');
  const guiUi = await startGui(ws, { port: 0, ui: viteUi });
  try {
    const shell = await (await fetch(guiUi.url)).text();
    check(
      'la racine sert l\'interface React',
      shell.includes('<div id="root">') && shell.includes('/@vite/client'),
      shell.slice(0, 120),
    );
    const app = await fetch(new URL('/src/main.tsx', guiUi.url));
    check('les sources de l\'interface se servent, transformées', app.ok && (await app.text()).includes('createRoot'));
    const uiPort = new URL(guiUi.url).port;
    check('la même garde d\'hôte protège l\'interface', (await raw('/', { Host: `evil.example:${uiPort}` }, uiPort)) === 403);
  } finally {
    await guiUi.close();
  }
} finally {
  await gui.close();
  rmSync(dir, { recursive: true, force: true });
}
