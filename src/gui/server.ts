/**
 * L'interface graphique locale du Dataset Tool : un serveur sans
 * authentification, qui n'écoute que sur cette machine par défaut, et refuse
 * toute requête dont l'hôte ou l'origine n'est pas celle sur laquelle il écoute
 * — une page web ailleurs ne peut pas l'atteindre en se faisant passer pour elle.
 *
 * `--host` permet de l'ouvrir à un réseau privé (un tailnet, un VPN, un réseau
 * local), pour le cas où le Dataset vit sur une machine distante. Jamais à une
 * adresse publique : sans authentification, ce serait une interface d'écriture
 * ouverte à tous.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ApiError, datasetOf, recordUpstreamPr, refreshing, startJob, upstreamDraft } from './api.ts';
import { JobRunner } from './jobs.ts';
import { defaultProbe, overview, type Probe } from './overview.ts';
import { pendingChanges, pendingFingerprint, undoPending } from './pending.ts';
import { checkDraft, deleteCorrection, listCorrections, saveSheet, sheetOf, suggestions } from './sheets.ts';
import { inspect, search } from './provenance.ts';
import type { UiFactory, UiHandle } from './ui.ts';
import type { Workspace } from './workspace.ts';
import { findUnsimulated } from '../rules.ts';
import { sheetOfTarget } from './targets.ts';

export interface GuiServer {
  url: string;
  close(): Promise<void>;
}

const LOCAL_HOSTS = ['127.0.0.1', 'localhost'];

/**
 * Une adresse d'un réseau privé : la boucle locale, les plages privées, et
 * `100.64.0.0/10` — celle que Tailscale distribue. Tout le reste est refusé :
 * une interface sans authentification n'a rien à faire sur une adresse publique.
 */
export function privateAddress(host: string): boolean {
  if (LOCAL_HOSTS.includes(host) || host === '::1') return true;
  const parts = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!parts) return false;
  const [a, b] = [Number(parts[1]), Number(parts[2])];
  return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
}

/** L'adresse Tailscale de cette machine, pour `--host tailscale`. */
export function tailscaleAddress(): string {
  try {
    const out = execFileSync('tailscale', ['ip', '-4'], { encoding: 'utf8' }).trim().split('\n')[0].trim();
    if (!privateAddress(out)) throw new Error(`unexpected address: ${out}`);
    return out;
  } catch (err) {
    throw new Error(`Tailscale address not found (${(err as Error).message}) — pass the address to --host`);
  }
}

const hostsFor = (bound: string) => [...LOCAL_HOSTS, bound];

export const allowedHost = (host: string | undefined, port: number, bound = '127.0.0.1') =>
  hostsFor(bound).some((h) => host === `${h}:${port}`);
export const allowedOrigin = (origin: string | undefined, port: number, bound = '127.0.0.1') =>
  origin === undefined || hostsFor(bound).some((h) => origin === `http://${h}:${port}`);

const MAX_BODY = 1_000_000;

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new ApiError(413, 'request too large');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'invalid JSON');
  }
}

const send = (res: ServerResponse, status: number, body: unknown, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

export interface GuiOptions {
  port?: number;
  /** Adresse d'écoute ; par défaut la boucle locale. Doit être privée. */
  host?: string;
  /** Ce qui sort de la machine : têtes amont, droit de publier. Remplacé par les tests. */
  probe?: Probe;
  /** L'interface, servie hors de `/api/`. Sans elle, le serveur n'offre que son API (les tests). */
  ui?: UiFactory;
}

/** Le schéma du Dataset : le moteur de rendu de l'interface le parcourt pour savoir quoi afficher et comment. */
function schemas(): { dataset: unknown } {
  const datasetUrl = new URL(import.meta.resolve('@paintplanplay/dataset-schema/dataset.schema.json'));
  return { dataset: JSON.parse(readFileSync(datasetUrl, 'utf8')) };
}

export async function startGui(ws: Workspace, options: GuiOptions | number = {}): Promise<GuiServer> {
  const { port = 4173, host = '127.0.0.1', probe = defaultProbe, ui: makeUi } = typeof options === 'number' ? { port: options } : options;
  if (!privateAddress(host)) throw new Error(`${host} is not a private address: the interface has no authentication`);
  // Une seule tâche longue à la fois, partagée par toutes les requêtes.
  const runner = new JobRunner();
  /** Les Pending Changes qu'a vues le dernier build lancé : Propose n'ouvre qu'après qu'il a réussi. */
  let buildSaw: string | null = null;
  const built = () => (runner.current?.name === 'build' && runner.current.state === 'ok' ? buildSaw : null);

  const server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      if (err instanceof ApiError) send(res, err.status, { error: err.message, findings: err.findings });
      else send(res, 500, { error: (err as Error).message });
    });
  });
  const ui: UiHandle | null = makeUi ? await makeUi(server) : null;

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const actual = (server.address() as AddressInfo).port;
    if (!allowedHost(req.headers.host, actual, host) || !allowedOrigin(req.headers.origin, actual, host)) {
      send(res, 403, { error: 'local interface: this machine only' });
      return;
    }
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${actual}`);
    const route = `${req.method} ${url.pathname}`;
    const param = (name: string) => url.searchParams.get(name) ?? '';

    switch (route) {
      case 'GET /favicon.ico':
        // Réclamé par tout navigateur : on répond, plutôt que de laisser une erreur en console.
        res.writeHead(204);
        return res.end();
      case 'GET /api/overview':
        return send(res, 200, await overview(ws, probe, built()));
      case 'GET /api/sheet':
        return send(res, 200, sheetOf(ws, param('target')));
      case 'POST /api/sheet/validate': {
        const body = await readBody(req);
        const found = inspect(datasetOf(ws), ws.bare, String(body.target ?? ''));
        if (!found) throw new ApiError(404, `not found: ${String(body.target ?? '')}`);
        return send(res, 200, checkDraft(found.kind, body.draft));
      }
      case 'POST /api/sheet/save': {
        const body = await readBody(req);
        return send(res, 201, await saveSheet(ws, { target: String(body.target ?? ''), draft: body.draft, reason: String(body.reason ?? '') }));
      }
      case 'GET /api/pending':
        return send(res, 200, pendingChanges(ws));
      case 'POST /api/pending/undo':
        undoPending(ws, String((await readBody(req)).id ?? ''));
        void refreshing(ws);
        return send(res, 200, { ok: true });
      case 'GET /api/corrections':
        return send(res, 200, listCorrections(ws, param('sheet'), param('q')));
      case 'POST /api/corrections/delete': {
        const body = await readBody(req);
        deleteCorrection(ws, { path: typeof body.path === 'string' ? body.path : undefined, target: typeof body.target === 'string' ? body.target : undefined });
        return send(res, 200, { ok: true });
      }
      case 'GET /api/unsimulated':
        return send(res, 200, findUnsimulated(datasetOf(ws).files).map((u) => ({ ...u, sheet: sheetOfTarget(u.target) })));
      case 'GET /api/disagreements':
        return send(res, 200, datasetOf(ws).conflicts ?? []);
      case 'GET /api/suggest':
        return send(res, 200, suggestions(ws, param('army'), param('unit')));
      case 'GET /api/schema':
        return send(res, 200, schemas());
      case 'GET /api/jobs':
        return send(res, 200, runner.report(Number(param('since')) || 0));
      case 'GET /api/search':
        return send(res, 200, search(datasetOf(ws), param('q'), 60, param('army')));
      case 'GET /api/upstream-draft':
        return send(res, 200, upstreamDraft(ws, param('path')));
      case 'POST /api/refresh':
        // Après une tâche ou une écriture : on attend la relecture en cours, ou
        // on en lance une, mais jamais deux en parallèle.
        await refreshing(ws);
        return send(res, 200, { state: ws.state });
      case 'POST /api/corrections/upstream-pr': {
        const body = await readBody(req);
        return send(res, 200, await recordUpstreamPr(ws, String(body.path ?? ''), String(body.url ?? '')));
      }
      default: {
        // Les tâches : POST /api/jobs/<nom>.
        const job = /^POST \/api\/jobs\/([a-z-]+)$/.exec(route);
        if (job) {
          const started = startJob(ws, runner, job[1], await readBody(req), probe);
          if (started.name === 'build') buildSaw = pendingFingerprint(ws);
          return send(res, 202, { job: { name: started.name, command: started.command, state: started.state } });
        }
        if (url.pathname.startsWith('/api/')) throw new ApiError(404, `unknown route: ${route}`);
        // Hors de l'API : l'interface.
        if (!ui) throw new ApiError(404, `unknown route: ${route}`);
        return ui.handle(req, res, () => send(res, 404, { error: `not found: ${url.pathname}` }));
      }
    }
  }

  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const actual = (server.address() as AddressInfo).port;
  return {
    url: `http://${host}:${actual}/`,
    close: async () => {
      runner.stop();
      await ui?.close();
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
  };
}
