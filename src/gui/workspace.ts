/**
 * Ce que l'interface a sous la main : un dossier de Dataset, et peut-être un
 * instantané des Upstream Sources.
 *
 * Les deux sont facultatifs — l'interface démarre les mains vides et propose de
 * les récupérer. Ce qu'elle sait montrer en dépend :
 *
 *   rien                   → l'écran d'accueil, avec ses boutons
 *   Dataset publié seul    → le Dataset tel qu'il est publié, sans origine des valeurs
 *   Dataset + instantané   → tout : d'où vient chaque valeur, et les Corrections
 *
 * Le second cas est celui de la correction urgente sur une machine neuve :
 * cloner le Dataset suffit, on ne télécharge pas BSData pour changer un coût.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { build } from '../build.ts';
import { readAuthored } from '../authored.ts';
import { readCorrections } from '../corrections/files.ts';
import { readDatasetFiles, readRegistry } from '../dataset.ts';
import { openSnapshot } from '../snapshot.ts';
import type { DatasetView } from './provenance.ts';

export interface WorkspaceState {
  dataset: boolean;
  snapshot: boolean;
  /** Le Dataset porte un Game System construit. */
  published: boolean;
  /** L'origine de chaque valeur est connue (il a fallu un instantané). */
  provenance: boolean;
  armies: number;
}

export interface Workspace {
  datasetDir: string;
  snapshotDir: string;
  gameSystem: string;
  /** Dépôt du Dataset, pour le bouton « récupérer ». */
  repository: string;
  /** Pousser et ouvrir des PR depuis l'interface : refusé par défaut. */
  allowPush: boolean;
  state: WorkspaceState;
  /** Le Dataset tel qu'il est lu ; `null` tant qu'il n'y en a pas. */
  current: DatasetView | null;
  /** Le même sans les Corrections, pour dire ce qu'elles changent ; `null` sans instantané. */
  bare: DatasetView | null;
  refresh(): Promise<void>;
}

export interface WorkspaceOptions {
  datasetDir: string;
  snapshotDir: string;
  gameSystem?: string;
  repository?: string;
  allowPush?: boolean;
}

export const DEFAULT_REPOSITORY = 'https://github.com/PaintPlanPlay/dataset.git';

export async function openWorkspace(options: WorkspaceOptions): Promise<Workspace> {
  const gameSystem = options.gameSystem ?? 'wh40k-11e';

  const ws: Workspace = {
    datasetDir: options.datasetDir,
    snapshotDir: options.snapshotDir,
    gameSystem,
    repository: options.repository ?? DEFAULT_REPOSITORY,
    allowPush: options.allowPush ?? false,
    state: { dataset: false, snapshot: false, published: false, provenance: false, armies: 0 },
    current: null,
    bare: null,
    async refresh() {
      const dataset = existsSync(options.datasetDir);
      const snapshot = existsSync(join(options.snapshotDir, 'sources.json'));
      const published = existsSync(join(options.datasetDir, gameSystem, 'index.json'));

      if (dataset && snapshot) {
        // Deux constructions : avec les Corrections, et sans, pour dire ce qu'elles changent.
        const common = {
          snapshot: openSnapshot(options.snapshotDir),
          gameSystem,
          ids: readRegistry(options.datasetDir, gameSystem),
          authored: readAuthored(options.datasetDir, gameSystem),
        };
        const [current, bare] = await Promise.all([
          build({ ...common, corrections: readCorrections(options.datasetDir, gameSystem) }),
          build({ ...common, corrections: [] }),
        ]);
        ws.current = current;
        ws.bare = bare;
      } else if (published) {
        // Sans instantané : on lit ce qui est publié, sans savoir d'où ça vient.
        ws.current = { gameSystem, files: readDatasetFiles(options.datasetDir, gameSystem), corrections: [], unmatched: [] };
        ws.bare = null;
      } else {
        ws.current = null;
        ws.bare = null;
      }

      const armies = [...(ws.current?.files.keys() ?? [])].filter((p) => p.startsWith(`${gameSystem}/armies/`)).length;
      ws.state = { dataset, snapshot, published: published || Boolean(ws.current), provenance: Boolean(ws.bare), armies };
    },
  };

  await ws.refresh();
  return ws;
}
