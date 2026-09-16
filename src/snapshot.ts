/**
 * Un instantané des Upstream Sources : l'entrée d'une construction.
 *
 * Toujours lu sur le disque, jamais sur le réseau — une construction est ainsi
 * rejouable à l'identique, et les tests en versionnent de petits. `fetch.ts`
 * se charge de le remplir depuis GitHub.
 *
 *   sources.json          commits et versions de chaque source
 *   bsdata/<catalogue>.json
 *   mfm/<faction>.yaml, mfm/meta.yaml
 *   40kdc/core/…, 40kdc/enrichment/…   voir `upstream/kdc.ts`
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { SourceRef } from '@paintplanplay/dataset-schema';
import type { BsCatalogue, BsFile } from './bsdata/flatten.ts';
import { readKdc, type KdcData } from './upstream/kdc.ts';
import { readFaction, type MfmFaction, type MfmMeta, type RawFaction } from './upstream/mfm.ts';

export interface Snapshot {
  dir: string;
  sources: SourceRef[];
  /** Noms des catalogues BSData, sans l'extension. */
  bsdataFiles(): string[];
  readBsdata(file: string): BsCatalogue;
  mfmFactions(): MfmFaction[];
  mfmMeta(): MfmMeta | null;
  /** 40kdc-data, `null` quand l'instantané n'en porte pas. */
  kdc(): KdcData | null;
}

export function openSnapshot(dir: string): Snapshot {
  const sourcesFile = join(dir, 'sources.json');
  if (!existsSync(sourcesFile)) throw new Error(`instantané invalide : ${sourcesFile} absent`);
  const sources = JSON.parse(readFileSync(sourcesFile, 'utf8')) as SourceRef[];

  const bsDir = join(dir, 'bsdata');
  const mfmDir = join(dir, 'mfm');
  const cache = new Map<string, BsCatalogue>();
  let factions: MfmFaction[] | null = null;
  let kdc: KdcData | null | undefined;

  return {
    dir,
    sources,
    bsdataFiles: () =>
      existsSync(bsDir)
        ? readdirSync(bsDir)
            .filter((f) => f.endsWith('.json'))
            .map((f) => f.replace(/\.json$/, ''))
            .sort()
        : [],
    readBsdata(file) {
      const hit = cache.get(file);
      if (hit) return hit;
      const parsed = JSON.parse(readFileSync(join(bsDir, `${file}.json`), 'utf8')) as BsFile;
      const cat = (parsed.catalogue ?? parsed.gameSystem)!;
      cache.set(file, cat);
      return cat;
    },
    mfmFactions() {
      factions ??= existsSync(mfmDir)
        ? readdirSync(mfmDir)
            .filter((f) => f.endsWith('.yaml') && f !== 'meta.yaml')
            .sort()
            .map((f) => readFaction(parseYaml(readFileSync(join(mfmDir, f), 'utf8')) as RawFaction))
        : [];
      return factions;
    },
    mfmMeta() {
      const file = join(mfmDir, 'meta.yaml');
      if (!existsSync(file)) return null;
      const raw = parseYaml(readFileSync(file, 'utf8')) as { version?: unknown; lastUpdated?: unknown };
      return { version: String(raw.version ?? ''), lastUpdated: String(raw.lastUpdated ?? '') };
    },
    kdc() {
      if (kdc === undefined) kdc = readKdc(join(dir, '40kdc'));
      return kdc;
    },
  };
}
