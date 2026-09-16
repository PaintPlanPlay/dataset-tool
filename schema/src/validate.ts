/**
 * Validation d'un fichier du Dataset contre `dataset.schema.json`.
 *
 * Le même validateur sert au Dataset Tool, qui refuse de publier une sortie
 * hors schéma, et aux applications, qui valident leurs Datasets de test contre
 * le même contrat.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { kindOfPath, type FileKind } from './index.ts';

const root = new URL('..', import.meta.url);
const readJson = (url: URL) => JSON.parse(readFileSync(url, 'utf8')) as Record<string, unknown>;

const DEFS: Record<FileKind, string> = {
  index: 'indexFile',
  core: 'coreFile',
  army: 'armyFile',
  correction: 'correctionFile',
  manifest: 'manifest',
};

let compiled: Map<FileKind, ValidateFunction> | null = null;
let effectValidators: { effect: ValidateFunction; scope: ValidateFunction } | null = null;

function vendoredSchemas(): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (dir: URL) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), dir);
      if (entry.isDirectory()) walk(url);
      else if (entry.name.endsWith('.schema.json')) out.push(readJson(url));
    }
  };
  walk(new URL('vendor/', root));
  return out;
}

function validators(): Map<FileKind, ValidateFunction> {
  if (compiled) return compiled;
  // `strict: false` : les schémas vendus de 40kdc-data portent des mots-clés
  // d'annotation (`$comment` imbriqués, `x-*`) qu'Ajv refuserait en mode strict.
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  for (const s of vendoredSchemas()) ajv.addSchema(s);
  const schema = readJson(new URL('dataset.schema.json', root));
  ajv.addSchema(schema);
  const id = schema.$id as string;
  compiled = new Map(
    (Object.keys(DEFS) as FileKind[]).map((kind) => [kind, ajv.getSchema(`${id}#/$defs/${DEFS[kind]}`)!]),
  );
  effectValidators = {
    effect: ajv.getSchema(`${id}#/$defs/effect`)!,
    scope: ajv.getSchema(`${id}#/$defs/effectScope`)!,
  };
  return compiled;
}

const errorsOf = (validate: ValidateFunction, data: unknown) =>
  validate(data) ? [] : (validate.errors ?? []).slice(0, 20).map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalide'}`);

/** Erreurs de validation d'un fichier, lisibles ; vide s'il est conforme. */
export function validateFile(kind: FileKind, data: unknown): string[] {
  return errorsOf(validators().get(kind)!, data);
}

/**
 * Un Effect seul, contre le format figé de 40kdc-data : le Dataset Tool écarte
 * un Effect amont qui ne s'y conforme pas plutôt que de refuser la construction.
 */
export function validateEffect(effect: unknown, scope?: unknown): string[] {
  validators();
  return [...errorsOf(effectValidators!.effect, effect), ...(scope === undefined ? [] : errorsOf(effectValidators!.scope, scope))];
}

/**
 * Valide tous les fichiers d'un Dataset sur le disque. Un fichier au chemin
 * inconnu est une erreur : rien ne doit se glisser dans le Dataset sans que le
 * schéma dise ce qu'il est.
 */
export function validateDatasetDir(dir: string, gameSystem: string): { file: string; errors: string[] }[] {
  const out: { file: string; errors: string[] }[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      const kind = kindOfPath(path);
      if (!kind) {
        out.push({ file: path, errors: ['fichier inconnu du schéma'] });
        continue;
      }
      let data: unknown;
      try {
        data = JSON.parse(readFileSync(join(dir, path), 'utf8'));
      } catch (err) {
        out.push({ file: path, errors: [`JSON illisible : ${(err as Error).message}`] });
        continue;
      }
      const errors = validateFile(kind, data);
      if (errors.length) out.push({ file: path, errors });
    }
  };
  walk(gameSystem);
  return out;
}
