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
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  acceptProposal,
  ApiError,
  createCorrection,
  datasetOf,
  jobSpecs,
  recordUpstreamPr,
  startJob,
  upstreamDraft,
  writeAuthoredEffect,
} from './api.ts';
import { JobRunner } from './jobs.ts';
import { PAGE } from './page.ts';
import { inspect, search } from './provenance.ts';
import type { Workspace } from './workspace.ts';

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
    if (!privateAddress(out)) throw new Error(`adresse inattendue : ${out}`);
    return out;
  } catch (err) {
    throw new Error(`adresse Tailscale introuvable (${(err as Error).message}) — donner l'adresse à --host`);
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
    if (size > MAX_BODY) throw new ApiError(413, 'requête trop volumineuse');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'JSON invalide');
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
}

export async function startGui(ws: Workspace, options: GuiOptions | number = {}): Promise<GuiServer> {
  const { port = 4173, host = '127.0.0.1' } = typeof options === 'number' ? { port: options } : options;
  if (!privateAddress(host)) throw new Error(`${host} n'est pas une adresse privée : l'interface n'a aucune authentification`);
  // Une seule tâche longue à la fois, partagée par toutes les requêtes.
  const runner = new JobRunner();

  const server = createServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      if (err instanceof ApiError) send(res, err.status, { error: err.message, findings: err.findings });
      else send(res, 500, { error: (err as Error).message });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const actual = (server.address() as AddressInfo).port;
    if (!allowedHost(req.headers.host, actual, host) || !allowedOrigin(req.headers.origin, actual, host)) {
      send(res, 403, { error: 'interface locale : cette machine seulement' });
      return;
    }
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${actual}`);
    const route = `${req.method} ${url.pathname}`;
    const param = (name: string) => url.searchParams.get(name) ?? '';

    switch (route) {
      case 'GET /':
        return send(res, 200, PAGE, 'text/html; charset=utf-8');
      case 'GET /api/state':
        // Ce que la page affiche avant tout : ce qu'on a sous la main, et ce qu'on peut lancer.
        return send(res, 200, {
          state: ws.state,
          datasetDir: ws.datasetDir,
          snapshotDir: ws.snapshotDir,
          repository: ws.repository,
          allowPush: ws.allowPush,
          gameSystem: ws.gameSystem,
          jobs: jobSpecs(ws).map(({ name, label, hint, needs }) => ({ name, label, hint, blocked: needs?.(ws) ?? null })),
        });
      case 'GET /api/jobs':
        return send(res, 200, runner.report(Number(param('since')) || 0));
      case 'GET /api/search':
        return send(res, 200, search(datasetOf(ws), param('q')));
      case 'GET /api/inspect': {
        const found = inspect(datasetOf(ws), ws.bare, param('target'));
        if (!found) throw new ApiError(404, `introuvable : ${param('target')}`);
        return send(res, 200, found);
      }
      case 'GET /api/upstream-draft':
        return send(res, 200, upstreamDraft(ws, param('path')));
      case 'POST /api/refresh':
        // Après une tâche : on relit le dossier sans redémarrer l'interface.
        await ws.refresh();
        return send(res, 200, { state: ws.state });
      case 'POST /api/corrections':
        return send(res, 201, await createCorrection(ws, (await readBody(req)) as never));
      case 'POST /api/effects':
        return send(res, 201, await writeAuthoredEffect(ws, (await readBody(req)) as never));
      case 'POST /api/proposals/accept': {
        const body = await readBody(req);
        return send(res, 201, await acceptProposal(ws, String(body.target ?? ''), body.openPr === true));
      }
      case 'POST /api/corrections/upstream-pr': {
        const body = await readBody(req);
        return send(res, 200, await recordUpstreamPr(ws, String(body.path ?? ''), String(body.url ?? '')));
      }
      default: {
        // Les tâches : POST /api/jobs/<nom>.
        const job = /^POST \/api\/jobs\/([a-z-]+)$/.exec(route);
        if (job) {
          const started = startJob(ws, runner, job[1], await readBody(req));
          return send(res, 202, { job: { name: started.name, command: started.command, state: started.state } });
        }
        throw new ApiError(404, `route inconnue : ${route}`);
      }
    }
  }

  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const actual = (server.address() as AddressInfo).port;
  return {
    url: `http://${host}:${actual}/`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
