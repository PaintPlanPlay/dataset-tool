/**
 * Lire le schéma du Dataset pour savoir comment afficher une valeur : résoudre
 * ses références (y compris vers les schémas d'Effect vendus de 40kdc-data), et
 * reconnaître quelle branche d'un `oneOf` une valeur emprunte.
 */
export interface JsonSchema {
  $id?: string;
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  title?: string;
  description?: string;
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  enum?: unknown[];
  const?: unknown;
  required?: string[];
  minimum?: number;
  maxLength?: number;
}

/** Un schéma, et l'adresse contre laquelle résoudre ses références relatives. */
export interface Located {
  schema: JsonSchema;
  base: string;
}

/**
 * Ce que la fiche ne montre jamais : les identifiants, la mécanique interne de
 * BattleScribe (`tree`, `parent`, `slot`) et la provenance d'un Effect.
 */
export const HIDDEN = new Set(['id', 'detachmentId', 'tree', 'parent', 'slot', 'effectSource']);

export class SchemaSet {
  private readonly docs = new Map<string, JsonSchema>();
  readonly root: Located;

  constructor(dataset: JsonSchema, vendor: JsonSchema[]) {
    for (const doc of [dataset, ...vendor]) if (doc.$id) this.docs.set(doc.$id, doc);
    this.root = { schema: dataset, base: dataset.$id ?? '' };
  }

  /** Une définition du schéma du Dataset : `def('unit')`. */
  def(name: string): Located {
    return this.resolve({ schema: { $ref: `#/$defs/${name}` }, base: this.root.base });
  }

  /** Suit les `$ref` jusqu'à un schéma qui dit quelque chose. */
  resolve(at: Located): Located {
    let { schema, base } = at;
    for (let hops = 0; schema.$ref && hops < 20; hops++) {
      const url = new URL(schema.$ref, base);
      const docUrl = url.href.split('#')[0];
      const doc = this.docs.get(docUrl);
      if (!doc) return { schema: {}, base };
      let target: unknown = doc;
      for (const part of url.hash.replace(/^#\/?/, '').split('/').filter(Boolean))
        target = (target as Record<string, unknown> | undefined)?.[decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~')];
      schema = (target as JsonSchema | undefined) ?? {};
      base = doc.$id ?? docUrl;
    }
    return { schema, base };
  }

  /** Les branches d'un `oneOf`/`anyOf`, résolues. */
  branches(at: Located): Located[] {
    const list = at.schema.oneOf ?? at.schema.anyOf ?? [];
    return list.map((b) => this.resolve({ schema: b, base: at.base }));
  }

  /**
   * La branche qu'une valeur emprunte. Pour un objet, c'est son discriminant
   * `type` qui tranche (un Effect « choice » ou « re-roll ») ; sinon son genre.
   */
  branchOf(at: Located, value: unknown): number {
    const branches = this.branches(at);
    const i = branches.findIndex((b) => this.matches(b, value));
    return i < 0 ? 0 : i;
  }

  private matches(at: Located, value: unknown): boolean {
    const { schema } = at;
    if ('const' in schema) return JSON.stringify(schema.const) === JSON.stringify(value);
    if (schema.enum) return schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(value));
    if (schema.oneOf || schema.anyOf) return this.branches(at).some((b) => this.matches(b, value));
    const kind = kindOf(value);
    if (schema.type && ![schema.type].flat().some((t) => t === kind || (t === 'integer' && kind === 'number'))) return false;
    if (kind === 'object' && schema.properties) {
      const tag = schema.properties.type;
      const v = (value as Record<string, unknown>).type;
      if (tag && v !== undefined) return this.matches(this.resolve({ schema: tag, base: at.base }), v);
    }
    return true;
  }
}

export function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Le nom lisible d'une branche : son titre, son discriminant, ou sa définition. */
export function branchLabel(at: Located, raw: JsonSchema): string {
  const tag = at.schema.properties?.type;
  if (at.schema.title) return at.schema.title;
  if (tag && 'const' in tag) return String(tag.const);
  if (raw.$ref) return raw.$ref.split('/').pop() ?? raw.$ref;
  return [at.schema.type ?? 'value'].flat().join(' | ');
}

/** « leaderTargets » → « Leader targets » ; les caractéristiques courtes (M, OC) restent telles quelles. */
export function humanize(key: string): string {
  if (/^[A-Z]{1,3}$/.test(key)) return key;
  const spaced = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
