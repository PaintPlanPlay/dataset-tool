/**
 * Lecture et écriture d'un Dataset sur le disque — le dépôt du Dataset, ou un
 * dossier de travail.
 *
 *   <gameSystem>/…          les fichiers publiés, conformes au schéma
 *   registry/<gameSystem>.json   le registre d'identifiants
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { IdRegistry } from './ids.ts';

/** JSON stable : clés dans l'ordre d'écriture, deux espaces, fin de ligne. */
export const toJson = (data: unknown) => `${JSON.stringify(data, null, 2)}\n`;

const registryPath = (dir: string, gameSystem: string) => join(dir, 'registry', `${gameSystem}.json`);

export function readRegistry(dir: string, gameSystem: string): IdRegistry | undefined {
  const file = registryPath(dir, gameSystem);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as IdRegistry) : undefined;
}

/** Les fichiers publiés d'un Game System, par chemin relatif. */
export function readDatasetFiles(dir: string, gameSystem: string): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const walk = (rel: string) => {
    const abs = join(dir, rel);
    if (!existsSync(abs)) return;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const path = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.json')) out.set(path, JSON.parse(readFileSync(join(dir, path), 'utf8')));
    }
  };
  walk(gameSystem);
  return out;
}

/**
 * Remplace les fichiers publiés d'un Game System par ceux d'une construction.
 * Le dossier est vidé d'abord : une Army disparue de l'amont disparaît aussi
 * du Dataset, au lieu d'y rester périmée.
 */
export function writeDataset(dir: string, gameSystem: string, files: Map<string, unknown>, ids: IdRegistry): void {
  rmSync(join(dir, gameSystem), { recursive: true, force: true });
  for (const [path, data] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    const abs = join(dir, path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, toJson(data));
  }
  mkdirSync(dirname(registryPath(dir, gameSystem)), { recursive: true });
  writeFileSync(registryPath(dir, gameSystem), toJson(ids));
}
