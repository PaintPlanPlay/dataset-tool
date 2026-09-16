/**
 * Les identifiants du Dataset, stables pour toujours.
 *
 * Une Unit garde son identifiant BSData tel quel. Tout le reste reçoit un
 * identifiant à nous, attribué une fois puis retenu dans un registre versionné
 * avec le Dataset : la construction suivante le relit et rend le même
 * identifiant à la même entité, même si l'amont renomme la sienne. C'est ce
 * qui garantit qu'une List ne casse jamais à cause d'une mise à jour.
 */

export interface RegistryEntry {
  id: string;
  /** Clés amont par lesquelles on reconnaît l'entité (« bsdata:Orks », « 40kdc:dread-mob »). */
  keys: string[];
  /** Nom au moment de l'attribution, pour un humain qui relit le registre. */
  name: string;
}

export interface IdRegistry {
  /** Registre par genre d'entité (« armies »), puis par portée (« * », ou l'Army). */
  [kind: string]: Record<string, RegistryEntry[]>;
}

export const emptyRegistry = (): IdRegistry => ({});

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'x';

/**
 * Attribue les identifiants d'une portée, en réutilisant le registre.
 *
 * Une entité est reconnue par l'une de ses clés amont ; à défaut, elle reçoit
 * un identifiant neuf tiré de son nom, suffixé s'il est déjà pris. Les entrées
 * du registre qu'aucune entité ne réclame sont gardées : l'identifiant reste
 * réservé, et revient si l'entité réapparaît.
 */
export function assignIds<T>(
  registry: IdRegistry,
  kind: string,
  scope: string,
  items: T[],
  describe: (item: T) => { keys: string[]; name: string },
): Map<T, string> {
  const entries = (registry[kind] ??= {})[scope] ?? [];
  const byKey = new Map<string, RegistryEntry>();
  for (const e of entries) for (const k of e.keys) byKey.set(k, e);
  const taken = new Set(entries.map((e) => e.id));
  const claimed = new Set<RegistryEntry>();
  const out = new Map<T, string>();

  const fresh: T[] = [];
  for (const item of items) {
    const { keys } = describe(item);
    const known = keys.map((k) => byKey.get(k)).find((e) => e && !claimed.has(e));
    if (!known) {
      fresh.push(item);
      continue;
    }
    claimed.add(known);
    // Une nouvelle clé amont (l'entité apparaît chez une autre source) rejoint l'entrée.
    for (const k of keys) if (!known.keys.includes(k)) known.keys.push(k);
    out.set(item, known.id);
  }

  for (const item of fresh) {
    const { keys, name } = describe(item);
    const base = slugify(name);
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    entries.push({ id, keys: [...keys], name });
    out.set(item, id);
  }

  registry[kind][scope] = [...entries].sort((a, b) => a.id.localeCompare(b.id));
  for (const e of registry[kind][scope]) e.keys.sort();
  return out;
}
