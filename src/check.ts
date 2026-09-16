/**
 * La commande de contrôle d'un dépôt de Dataset, celle que la CI lance sur
 * chaque PR : validation contre le schéma, et contrôle « aucun texte de
 * règles » sur tout ce que le dépôt contient — fichiers publiés, registre,
 * Corrections, Effects et résumés écrits par nous. Elle vaut pour nos propres
 * changements comme pour ceux des contributeurs.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { kindOfPath } from '@paintplanplay/dataset-schema';
import { validateDatasetDir, validateFile } from '@paintplanplay/dataset-schema/validate';
import { findRulesText, type TextFinding } from './notext.ts';

export interface CheckReport {
  schema: { file: string; errors: string[] }[];
  text: TextFinding[];
  ok: boolean;
}

const SKIPPED = new Set(['node_modules']);

/**
 * Tous les fichiers JSON d'un dépôt de Dataset, chemins relatifs.
 *
 * Les dossiers cachés sont ignorés : ils ne font pas partie du Dataset publié,
 * et l'automatisation en pose dans le dépôt le temps d'une construction —
 * l'instantané des Upstream Sources (`.snapshot`) et le Dataset Tool lui-même
 * (`.tool`), tous deux pleins de textes de règles amont qui feraient échouer le
 * contrôle sur ce que le dépôt ne publie pas.
 */
function jsonFiles(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    if (SKIPPED.has(entry.name) || entry.name.startsWith('.')) continue;
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...jsonFiles(dir, path));
    else if (entry.name.endsWith('.json')) out.push(path);
  }
  return out;
}

export function checkDataset(dir: string, gameSystem: string): CheckReport {
  const schema = existsSync(join(dir, gameSystem))
    ? validateDatasetDir(dir, gameSystem)
    : [{ file: gameSystem, errors: ['dossier du Game System absent'] }];

  const text: TextFinding[] = [];
  for (const file of jsonFiles(dir)) {
    let data: unknown;
    try {
      data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch (err) {
      schema.push({ file, errors: [`JSON illisible : ${(err as Error).message}`] });
      continue;
    }
    text.push(...findRulesText(data, file));
    // Les Corrections vivent hors du dossier du Game System, mais relèvent aussi du schéma.
    if (kindOfPath(file) === 'correction') {
      const errors = validateFile('correction', data);
      if (errors.length) schema.push({ file, errors });
    }
  }
  return { schema, text, ok: schema.length === 0 && text.length === 0 };
}

/** Le rapport, tel qu'on le lit dans un journal de CI. */
export function renderCheck(report: CheckReport): string {
  const lines: string[] = [];
  for (const f of report.schema) lines.push(`✘ schéma — ${f.file} : ${f.errors.join(' ; ')}`);
  for (const f of report.text) lines.push(`✘ texte de règles — ${f.where} : ${f.reason} — « ${f.excerpt} »`);
  lines.push(report.ok ? '✔ conforme au schéma, aucun texte de règles' : `✘ ${report.schema.length} fichier(s) hors schéma, ${report.text.length} constat(s) de texte`);
  return lines.join('\n');
}
