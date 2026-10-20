/**
 * Traduire les choix d'équipement de BSData en Wargear Options : des phrases,
 * telles que Games Workshop les écrit (ADR « Wargear Options en phrases »).
 *
 * BSData décrit l'équipement par des groupes de choix — un défaut et ses
 * alternatives, des pools de configurations « Nob w/ … », des plafonds qui
 * croissent avec l'effectif. Chaque motif reconnu devient une phrase : Qui (un
 * type de figurine, et combien), Quoi (les Weapons rendues, ou rien pour un
 * ajout) et ses Wargear Alternatives. Un motif que cette étape ne sait pas lire
 * n'est jamais deviné : il est rendu tel quel, et l'Unit attend qu'on écrive
 * ses options à la main.
 *
 * Une Wargear Option garde l'identifiant BSData de son groupe — de sa
 * configuration, dans un pool —, une Wargear Alternative celui de son entrée :
 * les Contributions qui les visent gardent leur adresse.
 */
import type { ModelType, WargearAlternative, WargearOption, WargearWho, WeaponCount } from '@paintplanplay/dataset-schema';
import type { OptionGroup, WeaponOption } from './types.ts';

/** Ce que la traduction n'a pas su lire, par groupe : rien n'en est publié. */
export interface Untranslated {
  group: string;
  why: string;
}

export interface Translated {
  options: WargearOption[];
  untranslated: Untranslated[];
}

/** Une entrée d'arme facultative hors de tout choix, et le type qui la porte. */
export interface Extra {
  id: string;
  name: string;
  max: number;
  weapons: string[];
  model: string;
}

/** Le type de figurine d'une entrée : « Nob w/ Kombi-rokkit and Kustom Krumpa » est un Nob. */
export const typeName = (entry: string) => entry.replace(/\s+w\/.*$/i, '').trim();

const once = (refs: string[]): WeaponCount[] => [...new Set(refs)].map((weapon) => ({ weapon, count: 1 }));

/**
 * Ce qu'une entrée apporte : ses Weapons, une fois chacune, sauf quand son nom
 * en annonce plusieurs d'une seule Weapon — « 2 Multi-meltas » en donne deux.
 */
function given(name: string, refs: string[]): WeaponCount[] {
  const weapons = once(refs);
  const n = /^\s*(\d+)\s*x?\s+\S/i.exec(name);
  return weapons.length === 1 && n && Number(n[1]) > 1 ? [{ ...weapons[0], count: Number(n[1]) }] : weapons;
}

/**
 * « k pour N figurines » : une limite qui vaut `base` à l'effectif minimal et
 * suit des paliers. On cherche N et k tels que chaque palier tombe juste ;
 * `null` quand aucun ne convient — on ne publie pas une tranche approximative.
 */
export function perModels(base: number, minModels: number, brackets: { atModels: number; max: number }[]): Extract<WargearWho, { type: 'per' }> | null {
  if (!brackets.length || base <= 0 || minModels <= 0) return null;
  const points = [{ atModels: minModels, max: base }, ...brackets];
  const candidates = [...new Set([minModels, ...brackets.map((b) => b.atModels), ...brackets.map((b) => b.atModels - minModels)])].filter((n) => n > 0).sort((a, b) => a - b);
  for (const every of candidates) {
    const slices = Math.floor(minModels / every);
    if (!slices || base % slices) continue;
    const models = base / slices;
    if (points.every((p) => Math.floor(p.atModels / every) * models === p.max)) return { type: 'per', models, every };
  }
  return null;
}

/** Qui, pour une limite absolue de porteurs : chacun quand elle couvre tout le type. */
const capped = (cap: number, typeMax: number): WargearWho => (cap > 0 && cap < typeMax ? { type: 'up-to', models: cap } : { type: 'each' });

/**
 * Ce qu'une configuration apporte, d'après son nom : « Nob w/ Kustom Krumpa
 * and Paired Krumpas », pour un Nob qui porte déjà son Kustom Krumpa, apporte
 * « Paired Krumpas » — ce qui n'est pas une Weapon se dit par là.
 */
function brought(name: string, held: string[]): string {
  const w = /\bw\/\s*(.+)$/i.exec(name);
  if (!w) return name.trim();
  const kept = new Set(held.map((r) => r.slice(r.indexOf('|') + 1).toLowerCase()));
  const parts = w[1].split(/\s*,\s*|\s+and\s+/i).filter((p) => p && !kept.has(p.trim().toLowerCase()));
  return parts.length ? parts.join(' and ') : name.trim();
}

/** Ce que la configuration de base porte d'office : ses sous-choix n'en font pas partie. */
const heldOf = (weapons: string[], defaults: Set<string>) => {
  const carried = weapons.filter((r) => defaults.has(r));
  return carried.length ? carried : weapons;
};

/** Au plus autant de Wargear Alternatives nées d'un choix dans un choix : au-delà, la phrase s'écrit à la main. */
const MAX_EXPANDED = 16;

/**
 * Une alternative qui offre encore un choix (« Legionary w/ other weapon » :
 * un Flamer, un Havoc autocannon ou un Heavy bolter) devient une Wargear
 * Alternative par possibilité. `null` quand ses sous-choix ne se lisent pas
 * ainsi, ou qu'ils en donneraient trop.
 */
function expand(o: WeaponOption, subs: OptionGroup[]): { id: string; name: string; weapons: string[] }[] | null {
  if (!subs.length) return [{ id: o.id, name: o.name, weapons: o.weapons }];
  // Un seul choix, obligatoire et simple : au-delà, les combinaisons ne disent plus la fiche.
  if (subs.length > 1 || subs.some((c) => c.pool || c.minPicks < 1 || c.maxPicks !== 1 || c.pickBrackets.length)) return null;
  const inSubs = new Set(subs.flatMap((c) => c.options.flatMap((x) => x.weapons)));
  const own = o.weapons.filter((r) => !inSubs.has(r));
  let combos: { id: string; name: string; weapons: string[] }[] = [{ id: o.id, name: o.name, weapons: own }];
  for (const c of subs) {
    const picks: (WeaponOption | null)[] = [...(c.minPicks === 0 ? [null] : []), ...c.options];
    combos = combos.flatMap((k) => picks.map((x) => (x ? { id: `${k.id}+${x.id}`, name: `${k.name} (${x.name.trim()})`, weapons: [...k.weapons, ...x.weapons] } : k)));
    if (combos.length > MAX_EXPANDED) return null;
  }
  return combos;
}

/**
 * Les Wargear Options d'une Unit, à partir de ses groupes de choix.
 *
 * @param types ses types de figurine, Default Wargear compris.
 * @param typeOf le type de figurine qui porte un groupe, d'après son emplacement.
 * @param extras ses entrées d'arme facultatives hors de tout choix.
 * @param minModels son effectif minimal, auquel se lisent les tranches.
 */
export function translateWargear(groups: OptionGroup[], types: ModelType[], typeOf: (group: OptionGroup) => string, extras: Extra[] = [], minModels = 1): Translated {
  const options: WargearOption[] = [];
  const untranslated: Untranslated[] = [];
  const typeNamed = (name: string) => types.find((t) => t.name === name);
  const defaultsOf = (type: string) => new Set(typeNamed(type)?.defaultWargear.map((w) => w.weapon) ?? []);
  const maxOf = (type: string) => typeNamed(type)?.max ?? 0;
  /** Le type d'une configuration de pool, quand le Dataset le connaît ; celui du groupe sinon. */
  const configType = (g: OptionGroup, o: WeaponOption) => (typeNamed(typeName(o.name)) ? typeName(o.name) : typeOf(g));
  const byId = new Map(groups.map((g) => [g.id, g]));

  /** Les choix qu'une alternative porte en elle, déjà lus avec elle. */
  const consumed = new Set<string>();
  /** Les choix qu'une alternative porte en elle quand elle ne se lit pas : ils ne tiennent dans aucune phrase. */
  const inside = new Set<string>();
  const within = (c: OptionGroup, o: WeaponOption) => c.options.every((x) => x.weapons.every((r) => o.weapons.includes(r)));

  /**
   * La configuration de base d'un type : celle que son pool désigne par défaut,
   * celle qui porte le nom du type, ou la moins équipée — cherchée dans le pool,
   * puis dans le pool qui le contient. Une configuration seule de son type n'est
   * la base de rien dans son propre pool : elle n'offre aucun choix.
   */
  const baseOf = (g: OptionGroup, type: string): WeaponOption | undefined => {
    for (let pool: OptionGroup | undefined = g; pool; pool = byId.get(pool.parent)) {
      if (!pool.pool) continue;
      const mine = pool.options.filter((o) => configType(pool!, o) === type);
      // Un pool qui puise dans un autre n'a pas de base à lui : elle est dans le pool parent.
      if (pool === g && (mine.length < 2 || byId.get(g.parent)?.pool)) continue;
      // Celle qui ressemble le plus au Default Wargear du type ; à égalité, celle que BSData désigne, puis celle qui porte son nom.
      const carried = defaultsOf(type);
      const fit = (o: WeaponOption) => o.weapons.filter((r) => carried.has(r)).length - o.weapons.filter((r) => !carried.has(r)).length;
      const rank = (o: WeaponOption) => fit(o) * 4 + (o.isDefault ? 2 : 0) + (o.name.trim() === type ? 1 : 0);
      const base = mine.reduce<WeaponOption | undefined>((a, b) => (!a || rank(b) > rank(a) ? b : a), undefined);
      if (base) return base;
    }
    return undefined;
  };

  /**
   * Un pool de configurations : chacune est une figurine d'un type, équipée
   * autrement que la configuration de base de ce type — ce qu'elle rend et ce
   * qu'elle reçoit font la phrase. Un pool qui puise dans un autre avec un
   * budget commun (les armes spéciales d'une escouade) fait une seule phrase,
   * « one of the following ». `null` : il ne se lit pas ainsi.
   */
  const poolOptions = (g: OptionGroup): WargearOption[] | null => {
    const shared = Boolean(byId.get(g.parent)?.pool) && !g.newOnly;
    const made: WargearOption[] = [];
    const together = new Map<string, { model: string; replaces: WeaponCount[]; alternatives: WargearAlternative[] }>();
    for (const o of g.options) {
      const type = configType(g, o);
      const base = baseOf(g, type);
      if (!base || base === o) continue;
      const held = heldOf(base.weapons, defaultsOf(type));
      // Les choix que porte la configuration elle-même : une alternative par possibilité.
      const subs = groups.filter((c) => c.parent === g.id && c.slot === o.name && !c.pool);
      const expanded = expand(o, subs);
      if (!expanded) return null;
      for (const c of subs) consumed.add(c.id);
      if (expanded.length > 1) {
        const carried = new Set(held);
        const alts = expanded.map((x) => ({ id: x.id, name: x.name, weapons: given(x.name, x.weapons.filter((r) => !carried.has(r))) }));
        const replaced = once(held.filter((r) => !expanded.every((x) => x.weapons.includes(r))));
        const limits = [o.maxCarriers, o.unitCap ?? 0].filter((n) => n > 0);
        const whoX = o.capBrackets?.length && o.unitCap !== undefined ? perModels(o.unitCap, minModels, o.capBrackets) : capped(limits.length ? Math.min(...limits) : 0, maxOf(type));
        if (!whoX || shared) return null;
        made.push({ id: o.id, model: type, who: whoX, replaces: replaced, alternatives: alts });
        continue;
      }
      const replaces = once(held.filter((r) => !o.weapons.includes(r)));
      const alternative: WargearAlternative = { id: o.id, name: brought(o.name, held), weapons: given(o.name, o.weapons.filter((r) => !held.includes(r))) };
      if (shared) {
        const key = `${type}|${replaces.map((w) => w.weapon).join('+')}`;
        const entry = together.get(key) ?? together.set(key, { model: type, replaces, alternatives: [] }).get(key)!;
        entry.alternatives.push(alternative);
        continue;
      }
      const limits = [o.maxCarriers, o.unitCap ?? 0].filter((n) => n > 0);
      const who = o.capBrackets?.length && o.unitCap !== undefined ? perModels(o.unitCap, minModels, o.capBrackets) : capped(limits.length ? Math.min(...limits) : 0, maxOf(type));
      if (!who) return null;
      made.push({ id: o.id, model: type, who, replaces, alternatives: [alternative] });
    }
    if (shared && together.size) {
      // Un budget commun ne se partage qu'entre des alternatives qui rendent les mêmes Weapons.
      if (together.size > 1) return null;
      const who = g.pickBrackets.length ? perModels(g.maxPicks, minModels, g.pickBrackets.map((b) => ({ atModels: b.atModels, max: b.maxPicks }))) : capped(g.maxPicks, Infinity);
      if (!who) return null;
      for (const e of together.values()) made.push({ id: g.id, ...e, who });
    }
    return made;
  };

  for (const g of groups) {
    const fallback = { group: g.name, why: '' };
    if (consumed.has(g.id)) continue;
    if (inside.has(g.id)) {
      untranslated.push({ ...fallback, why: 'a choice inside a Wargear Alternative' });
      continue;
    }

    if (g.pool) {
      const made = poolOptions(g);
      if (made === null) untranslated.push({ ...fallback, why: 'a pool whose configurations do not read as replacements' });
      else options.push(...made);
      continue;
    }

    const choices = g.options.filter((o) => !o.isDefault);
    if (!choices.length) continue;
    const model = typeOf(g);
    const deflt = g.options.find((o) => o.isDefault);
    // « … replaced with 1 Plasma pistol and one of the following » : une alternative qui offre encore un choix.
    const nested = groups.filter((c) => c.parent === g.id && choices.some((o) => within(c, o)));
    const expanded = choices.map((o) => expand(o, nested.filter((c) => within(c, o))));
    if (nested.length && expanded.some((x) => x === null)) {
      for (const c of nested) inside.add(c.id);
      untranslated.push({ ...fallback, why: 'a Wargear Alternative with choices of its own' });
      continue;
    }
    if (deflt && g.maxPicks === 1 && !g.pickBrackets.length) {
      for (const c of nested) consumed.add(c.id);
      const flat = expanded.flatMap((x) => x!).map((x) => ({ id: x.id, name: x.name, weapons: x.weapons, maxCarriers: 0, isDefault: false }));
      options.push(...replacements(g.id, deflt.weapons, flat, model, defaultsOf(model)));
      continue;
    }
    // Un choix sans défaut qu'on peut laisser vide : un ajout, « can be equipped with one of the following ».
    if (!deflt && g.minPicks === 0 && !g.pickBrackets.length) {
      options.push({
        id: g.id,
        model,
        who: { type: 'each' },
        replaces: [],
        ...(g.maxPicks > 1 ? { upTo: g.maxPicks } : {}),
        alternatives: g.options.map((o) => ({ id: o.id, name: o.name, weapons: given(o.name, o.weapons) })),
      });
      continue;
    }
    untranslated.push({ ...fallback, why: !deflt ? 'a choice without a default that must be made' : 'a choice of several, or whose budget grows with the unit' });
  }

  // Une arme qu'on prend en plus, hors de tout choix : « can be equipped with up to 4 Big Shootas ».
  for (const e of extras)
    options.push({
      id: e.id,
      model: e.model,
      who: { type: 'each' },
      replaces: [],
      ...(e.max > 1 ? { upTo: e.max } : {}),
      alternatives: [{ id: e.id, name: e.name, weapons: once(e.weapons) }],
    });
  return { options, untranslated };
}

/**
 * Un groupe avec un défaut, un seul choix : chaque alternative remplace ce que
 * le défaut porte d'office par ce qu'elle apporte. Des alternatives qui ne
 * rendent pas les mêmes Weapons ne font pas la même phrase.
 */
function replacements(id: string, base: string[], choices: WeaponOption[], model: string, defaults: Set<string>): WargearOption[] {
  const held = heldOf(base, defaults);
  const byReplaced = new Map<string, { replaces: WeaponCount[]; alternatives: WargearAlternative[] }>();
  for (const o of choices) {
    const replaces = once(held.filter((r) => !o.weapons.includes(r)));
    const weapons = given(o.name, o.weapons.filter((r) => !held.includes(r)));
    const key = replaces.map((w) => w.weapon).join('+');
    const entry = byReplaced.get(key) ?? byReplaced.set(key, { replaces, alternatives: [] }).get(key)!;
    entry.alternatives.push({ id: o.id, name: o.name, weapons });
  }
  return [...byReplaced.values()].map((e, i) => ({ id: i === 0 ? id : `${id}~${i + 1}`, model, who: { type: 'each' as const }, replaces: e.replaces, alternatives: e.alternatives }));
}
