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
let datasetId = '';
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
  datasetId = id;
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

/** Une erreur de validation, à son emplacement dans la valeur. */
export interface FieldError {
  /** Pointeur JSON : « /models/0/T ». Vide pour la valeur entière. */
  path: string;
  message: string;
}

/**
 * Un validateur à part pour les éditeurs : `verbose` donne, pour un `oneOf` en
 * échec, le schéma qui le porte — de quoi retrouver la branche que la valeur
 * désigne par son `type`.
 */
let editorAjv: { ajv: Ajv2020; docs: Record<string, unknown>[]; defs: Map<string, ValidateFunction> } | null = null;

function editor() {
  if (editorAjv) return editorAjv;
  const ajv = new Ajv2020({ allErrors: true, strict: false, verbose: true });
  const docs = [...vendoredSchemas(), readJson(new URL('dataset.schema.json', root))];
  for (const d of docs) ajv.addSchema(d);
  editorAjv = { ajv, docs, defs: new Map() };
  return editorAjv;
}

/** Le document vendu qui contient un sous-schéma (par identité), pour résoudre ses `$ref` relatives. */
function docOf(docs: Record<string, unknown>[], target: unknown): string | undefined {
  const contains = (node: unknown): boolean =>
    node === target || (node !== null && typeof node === 'object' && Object.values(node as Record<string, unknown>).some(contains));
  return docs.find((d) => contains(d))?.$id as string | undefined;
}

const at = (data: unknown, pointer: string) =>
  pointer
    .split('/')
    .slice(1)
    .reduce<unknown>((v, k) => (v as Record<string, unknown> | undefined)?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], data);

/**
 * Un `oneOf` en échec produit les erreurs de toutes ses branches, et l'éditeur
 * les afficherait toutes sur le nœud : un Effect « choice » se ferait réclamer
 * les champs d'un « sequence ». Quand la valeur désigne sa branche par son
 * `type`, on ne garde que les erreurs de celle-là.
 */
function refine(validate: ValidateFunction, data: unknown, prefix = '', depth = 0): FieldError[] {
  if (validate(data)) return [];
  const errors = [...(validate.errors ?? [])];
  const { ajv, docs } = editor();
  const out: FieldError[] = [];
  const handled: string[] = [];
  for (const e of errors) {
    if (e.keyword !== 'oneOf' || depth > 12) continue;
    const node = at(data, e.instancePath) as { type?: unknown } | undefined;
    const branches = e.schema as { $ref?: string }[] | undefined;
    const doc = docOf(docs, e.parentSchema);
    if (typeof node?.type !== 'string' || !Array.isArray(branches) || !doc) continue;
    const chosen = branches
      .map((b) => (b.$ref ? ajv.getSchema(new URL(b.$ref, doc).href) : undefined))
      .find((v) => {
        const tag = (v?.schema as { properties?: { type?: { const?: unknown; enum?: unknown[] } } } | undefined)?.properties?.type;
        return tag?.const === node.type || tag?.enum?.includes(node.type);
      });
    if (!chosen) continue;
    handled.push(e.instancePath);
    out.push(...refine(chosen, node, `${prefix}${e.instancePath}`, depth + 1));
  }
  const inside = (p: string) => handled.some((h) => p === h || p.startsWith(`${h}/`));
  for (const e of errors)
    if (!inside(e.instancePath) && !(e.keyword === 'oneOf' && handled.includes(e.instancePath)))
      out.push({ path: `${prefix}${e.instancePath}`, message: e.message ?? 'invalid' });
  return out;
}

/**
 * Une valeur contre une définition du schéma (« unit », « stratagem »…), erreurs
 * par champ : ce qu'un éditeur montre sur le champ fautif.
 */
export function validateDef(def: string, data: unknown): FieldError[] {
  const { ajv, defs } = editor();
  let validate = defs.get(def);
  if (!validate) {
    validators();
    validate = ajv.getSchema(`${datasetId}#/$defs/${def}`);
    if (!validate) throw new Error(`unknown schema definition: ${def}`);
    defs.set(def, validate);
  }
  const seen = new Set<string>();
  return refine(validate, data).filter((e) => {
    const key = `${e.path}|${e.message}`;
    return seen.has(key) ? false : (seen.add(key), true);
  });
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
