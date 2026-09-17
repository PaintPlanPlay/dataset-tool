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
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { Script } from 'node:vm';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultReleaseUrl } from '../src/gui/api.ts';
import { allowedHost, allowedOrigin, privateAddress, startGui } from '../src/gui/server.ts';
import type { Inspection } from '../src/gui/provenance.ts';
import { openWorkspace } from '../src/gui/workspace.ts';
import { check, fixture, section } from './check.ts';

const dir = mkdtempSync(join(tmpdir(), 'dataset-gui-'));
const ws = await openWorkspace({ datasetDir: dir, snapshotDir: fixture('snapshot') });
const gui = await startGui(ws, 0);
const base = new URL(gui.url);

const raw = (path: string, headers: Record<string, string>) =>
  new Promise<number>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: base.port, path, headers }, (res) => {
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
const originOf = (i: Inspection, field: string) => i.origins.find((o) => o.field === field);

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
  const page = await (await fetch(gui.url)).text();
  check('la page se sert', page.length > 0);
  /*
   * La page est du JavaScript écrit dans un gabarit TypeScript : un accent
   * grave, un ${…} ou un \n mal échappé y sort tel quel et casse tout le
   * script — les boutons disparaissent sans que rien ne réponde en erreur.
   * Servir la page ne prouve donc rien ; il faut l'analyser.
   */
  const script = page.slice(page.indexOf('<script>') + 8, page.lastIndexOf('</script>'));
  let syntaxe = '';
  try {
    new Script(script);
  } catch (err) {
    syntaxe = (err as Error).message;
  }
  check("le script de la page s'analyse comme du JavaScript", syntaxe === '' && script.length > 500, syntaxe || `${script.length} caractères`);
  check(
    'un autre hôte ou une autre origine est refusé',
    (await raw('/api/search?q=boyz', { Host: `evil.example:${base.port}` })) === 403 &&
      (await raw('/api/search?q=boyz', { Host: `127.0.0.1:${base.port}`, Origin: 'https://evil.example' })) === 403,
  );

  section('Interface locale : origine des valeurs');
  const hits = await get<{ kind: string; target: string; name: string }[]>('/api/search?q=war');
  const warHorde = hits.body.find((h) => h.kind === 'detachment' && h.name === 'War Horde');
  check('recherche : Units, Detachments, Stratagems', hits.body.some((h) => h.name === 'Warboss') && Boolean(warHorde), hits.body.map((h) => `${h.kind}:${h.name}`).join(', '));

  const boss = (await get<Inspection>('/api/inspect?target=u-warboss')).body;
  check(
    'Unit : chaque champ dit sa source — MFM pour le coût, BSData pour le profil, 40kdc-data pour l\'Effect',
    ['mfm', 'bsdata'].includes(originOf(boss, 'points')?.origin ?? '') && originOf(boss, 'models')?.origin === 'bsdata' && originOf(boss, 'abilities › Da Boss Fixture')?.origin === '40kdc',
    JSON.stringify(boss.origins),
  );
  const det = (await get<Inspection>(`/api/inspect?target=${encodeURIComponent(warHorde!.target)}`)).body;
  check('Detachment : DP du MFM, règles de 40kdc-data', originOf(det, 'dp')?.origin === 'mfm' && originOf(det, 'rules')?.origin === '40kdc');

  section('Interface locale : écrire');
  const boyz = (await get<Inspection>('/api/inspect?target=u-boyz')).body;
  const prose = 'Each time this unit makes an attack, add one to the hit roll and if the target is within range of an objective marker you can re-roll the wound roll as well for every model in it';
  const refused = await post<{ error: string }>('/api/corrections', {
    army: 'orks',
    name: 'boyz-prose',
    correction: { target: 'u-boyz', source: 'bsdata', patch: { points: 1 }, reason: prose },
  });
  check('une Correction porteuse de texte de règles est refusée, rien n\'est écrit', refused.status === 400 && !existsSync(join(dir, 'corrections/wh40k-11e/orks/boyz-prose.json')));

  const written = await post<{ path: string; prCommands: string[] }>('/api/corrections', {
    army: 'orks',
    name: 'boyz-points',
    correction: { target: 'u-boyz', source: 'mfm', patch: { points: 999 }, upstream: { points: (boyz.value as { points: number }).points }, reason: 'Coût de test.' },
  });
  const after = (await get<Inspection>('/api/inspect?target=u-boyz')).body;
  check(
    'créer une Correction : fichier écrit, valeur rattachée à la Correction, commandes de PR données',
    written.status === 201 && existsSync(join(dir, written.body.path)) && originOf(after, 'points')?.origin === 'correction' &&
      originOf(after, 'points')?.detail === written.body.path && written.body.prCommands.some((c) => c.startsWith('gh pr create')),
    JSON.stringify(written.body),
  );

  /*
   * Relire le Dataset après une écriture demande deux reconstructions — une
   * vingtaine de secondes sur le vrai Dataset. L'écriture ne doit pas attendre
   * ça : sinon le bouton paraît mort, et le message n'arrive jamais.
   */
  const debut = Date.now();
  await post('/api/corrections', {
    army: 'orks',
    name: 'duree-ecriture',
    correction: { target: 'u-boyz', source: 'mfm', patch: { points: 123 }, upstream: { points: (boyz.value as { points: number }).points }, reason: "Durée d'écriture." },
  });
  const duree = Date.now() - debut;
  check("une écriture répond sans attendre la relecture du Dataset", duree < 3000, `${duree} ms`);

  const longSummary = await post<{ error: string }>('/api/effects', { target: 'u-warboss::ability:Da Boss Fixture', summary: 'x '.repeat(100), reason: 'Test.' });
  const summary = await post<{ path: string }>('/api/effects', { target: 'u-warboss::ability:Da Boss Fixture', summary: '+1 to wound in melee.', reason: 'Résumé de test.' });
  const bossAfter = (await get<Inspection>('/api/inspect?target=u-warboss')).body;
  const bossAbility = (bossAfter.value as { abilities: { name: string; summary?: string; effectSource?: string }[] }).abilities.find((a) => a.name === 'Da Boss Fixture');
  check(
    'un résumé passe le contrôle « aucun texte » avant d\'être écrit ; il s\'ajoute sans toucher l\'Effect',
    longSummary.status === 400 && summary.status === 201 && bossAbility?.summary === '+1 to wound in melee.' && bossAbility.effectSource === '40kdc',
  );

  check('les propositions de l\'analyse sont consultables', boyz.proposals.some((p) => p.ability === 'Mob Fixture'));
  const accepted = await post<{ path: string }>('/api/proposals/accept', { target: 'u-boyz::ability:Mob Fixture' });
  const boyzAfter = (await get<Inspection>('/api/inspect?target=u-boyz')).body;
  check(
    'accepter une proposition : elle devient un Effect écrit par le projet',
    accepted.status === 201 && originOf(boyzAfter, 'abilities › Mob Fixture')?.origin === 'project' && boyzAfter.proposals.length === 0,
  );

  const draft = await get<{ repository: string; url: string }>(`/api/upstream-draft?path=${encodeURIComponent(written.body.path)}`);
  const pr = await post<{ path: string }>('/api/corrections/upstream-pr', { path: written.body.path, url: 'https://github.com/BSData/wh40k-11e-mfm/pull/12' });
  const saved = JSON.parse(readFileSync(join(dir, written.body.path), 'utf8')) as { upstreamPr?: string };
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
    check("la page se sert sans rien avoir sous la main", (await fetch(guiVide.url)).status === 200);

    const state = await at<{ state: { dataset: boolean; snapshot: boolean; published: boolean; armies: number }; allowPush: boolean; jobs: { name: string; blocked: string | null }[] }>('/api/state');
    const job = (name: string) => state.body.jobs.find((j) => j.name === name);
    check(
      "l'état dit qu'il n'y a ni Dataset ni instantané",
      !state.body.state.dataset && !state.body.state.snapshot && !state.body.state.published && state.body.state.armies === 0,
      JSON.stringify(state.body.state),
    );
    check(
      'récupérer le Dataset et prendre un instantané sont proposés ; construire et contrôler attendent leur tour',
      job('dataset')?.blocked === null && job('snapshot')?.blocked === null && Boolean(job('build')?.blocked) && Boolean(job('check')?.blocked),
      state.body.jobs.map((j) => `${j.name}:${j.blocked ?? 'ok'}`).join(' · '),
    );
    check("l'écriture distante est refusée sans --allow-push", !state.body.allowPush && Boolean(job('propose')?.blocked));

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

    const avecDepot = await at<{ releaseUrl: string | null }>('/api/state');
    check("l'interface annonce cette adresse pour préremplir le champ", 'releaseUrl' in avecDepot.body, JSON.stringify(avecDepot.body.releaseUrl));

    const search = await at<{ error: string }>('/api/search?q=boyz');
    check(
      "consulter sans Dataset dit par quel bouton commencer",
      search.status === 409 && search.body.error.includes('récupérer le Dataset'),
      `${search.status} ${search.body.error}`,
    );
    check('une tâche inconnue est refusée', (await at('/api/jobs/effacer-tout', {})).status === 404);
    check("une tâche dont le prérequis manque est refusée", (await at<{ error: string }>('/api/jobs/build', {})).status === 409);

    const first = await at<{ job: { name: string } }>('/api/jobs/dataset', {});
    const second = await at<{ error: string }>('/api/jobs/dataset', {});
    check(
      'une seule tâche à la fois : la seconde est refusée pendant la première',
      first.status === 202 && second.status === 409 && second.body.error.includes('déjà en cours'),
      `${first.status}/${second.status}`,
    );
  } finally {
    await guiVide.close();
    rmSync(vide, { recursive: true, force: true });
  }
} finally {
  await gui.close();
  rmSync(dir, { recursive: true, force: true });
}
