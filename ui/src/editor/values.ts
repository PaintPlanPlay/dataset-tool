/**
 * Manipuler un brouillon par chemin (pointeur JSON), et fabriquer la valeur
 * de départ qu'un schéma attend : ce qu'on pose quand on ajoute un élément à
 * une liste, ou qu'on choisit un autre type de nœud d'Effect.
 */
import type { Located, SchemaSet } from '../schema.ts';

export type Path = (string | number)[];

export const pointer = (path: Path) => path.map((p) => `/${String(p).replace(/~/g, '~0').replace(/\//g, '~1')}`).join('');

export function getAt(value: unknown, path: Path): unknown {
  let v = value;
  for (const p of path) v = (v as Record<string | number, unknown> | undefined)?.[p];
  return v;
}

/** Une copie de `value` où `path` vaut `next` ; `undefined` retire la clé d'un objet. */
export function setAt(value: unknown, path: Path, next: unknown): unknown {
  if (path.length === 0) return next;
  const [head, ...rest] = path;
  if (Array.isArray(value)) {
    const copy = [...value];
    copy[head as number] = setAt(copy[head as number], rest, next);
    return copy;
  }
  const copy = { ...((value as Record<string, unknown>) ?? {}) };
  const child = setAt(copy[head as string], rest, next);
  if (child === undefined) delete copy[head as string];
  else copy[head as string] = child;
  return copy;
}

/** Une liste vide vaut une liste absente : la fiche montre `[]` là où le Dataset ne dit rien. */
const canonical = (v: unknown) => JSON.stringify(v ?? null, (_k, x: unknown) => (Array.isArray(x) && x.length === 0 ? null : x));
export const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/**
 * La valeur la plus simple qu'un schéma accepte : les champs requis d'un objet,
 * la première branche d'un choix, le premier élément d'un enum. Assez pour que
 * le formulaire montre les bons champs, que l'utilisateur remplit ensuite.
 */
export function defaultOf(schemas: SchemaSet, at: Located, depth = 0): unknown {
  const { schema, base } = schemas.resolve(at);
  if (depth > 8) return undefined;
  if ('const' in schema) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.oneOf || schema.anyOf) {
    const [first] = schemas.branches({ schema, base });
    return first ? defaultOf(schemas, first, depth + 1) : undefined;
  }
  const type = [schema.type ?? (schema.properties ? 'object' : 'string')].flat()[0];
  if (type === 'object') {
    const required = schema.required ?? [];
    return Object.fromEntries(
      required.map((k) => [k, defaultOf(schemas, { schema: schema.properties?.[k] ?? {}, base }, depth + 1)]).filter(([, v]) => v !== undefined),
    );
  }
  if (type === 'array') return [];
  if (type === 'integer' || type === 'number') return schema.minimum ?? 0;
  if (type === 'boolean') return false;
  if (type === 'null') return null;
  return '';
}
