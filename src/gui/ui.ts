/**
 * La nouvelle interface (React), servie par Vite dans le serveur local même :
 * `npm run dev` suffit, sur le même port, sans commande de plus à connaître
 * pour un contributeur. Le serveur garde la main sur `/api/*` et sur sa garde
 * d'hôte ; Vite sert le reste, et recharge la page quand on modifie `ui/`.
 */
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

export interface UiHandle {
  /** Sert une requête, ou appelle `next` quand elle ne la concerne pas. */
  handle(req: IncomingMessage, res: ServerResponse, next: () => void): void;
  close(): Promise<void>;
}

/** Fabrique l'interface pour un serveur HTTP donné : c'est sur lui que passe le rechargement à chaud. */
export type UiFactory = (server: Server) => Promise<UiHandle>;

export const UI_DIR = fileURLToPath(new URL('../../ui/', import.meta.url));

export const viteUi: UiFactory = async (server) => {
  const vite = await createServer({
    root: UI_DIR,
    configFile: false,
    logLevel: 'warn',
    plugins: [react()],
    appType: 'spa',
    server: { middlewareMode: true, hmr: { server } },
  });
  return {
    handle: (req, res, next) => vite.middlewares(req, res, next),
    // Vite ne rend parfois jamais la main à la fermeture (son optimiseur de
    // dépendances encore au travail) : on ne l'attend pas au-delà de deux secondes.
    close: () => Promise.race([vite.close(), new Promise<void>((resolve) => setTimeout(resolve, 2000).unref())]),
  };
};
