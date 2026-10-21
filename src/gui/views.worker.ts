/**
 * Les deux constructions de la vue, hors du fil du serveur.
 *
 * Une construction est synchrone de bout en bout — une quinzaine de secondes
 * sur le vrai Dataset. Faite dans le fil du serveur, elle le fige : plus rien
 * ne répond, pas même la fiche suivante qu'on voudrait ouvrir. Ici, elle tourne
 * à côté, et seul son résultat revient.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { buildViews, type ViewsRequest } from './workspace.ts';

const request = workerData as ViewsRequest;
buildViews(request).then(
  (views) => parentPort!.postMessage({ views }),
  (err: unknown) => parentPort!.postMessage({ error: err instanceof Error ? err.message : String(err) }),
);
