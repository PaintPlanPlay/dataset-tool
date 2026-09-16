/**
 * Les Corrections, fichiers publics versionnés avec le Dataset.
 *
 *   corrections/<gameSystem>/<armyId>/<nom>.json
 *
 * Un fichier par Correction : une PR qui en ajoute une ne touche qu'un fichier,
 * et sa relecture tient sur un écran.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Correction } from '@paintplanplay/dataset-schema';

export type { Correction } from '@paintplanplay/dataset-schema';

export interface CorrectionFile extends Correction {
  /** Chemin relatif à la racine du dépôt du Dataset. */
  path: string;
}

export const correctionsDir = (gameSystem: string) => `corrections/${gameSystem}`;

export function readCorrections(datasetDir: string, gameSystem: string): CorrectionFile[] {
  const root = join(datasetDir, correctionsDir(gameSystem));
  if (!existsSync(root)) return [];
  const out: CorrectionFile[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(root, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.json'))
        out.push({ ...(JSON.parse(readFileSync(join(root, path), 'utf8')) as Correction), path: `${correctionsDir(gameSystem)}/${path}` });
    }
  };
  walk('');
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
