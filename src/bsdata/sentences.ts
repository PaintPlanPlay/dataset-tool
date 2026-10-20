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
 * Une Wargear Option garde l'identifiant BSData de son groupe, une Wargear
 * Alternative celui de son entrée : les Contributions qui les visent gardent
 * leur adresse.
 */
import type { ModelType, WargearAlternative, WargearOption, WeaponCount } from '@paintplanplay/dataset-schema';
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

/** Le type de figurine d'une entrée : « Nob w/ Kombi-rokkit and Kustom Krumpa » est un Nob. */
export const typeName = (entry: string) => entry.replace(/\s+w\/.*$/i, '').trim();

const once = (refs: string[]): WeaponCount[] => [...new Set(refs)].map((weapon) => ({ weapon, count: 1 }));

/**
 * Les Wargear Options d'une Unit, à partir de ses groupes de choix.
 *
 * @param types ses types de figurine, Default Wargear compris.
 * @param typeOf le type de figurine qui porte un groupe, d'après son emplacement.
 */
export function translateWargear(groups: OptionGroup[], types: ModelType[], typeOf: (group: OptionGroup) => string): Translated {
  const options: WargearOption[] = [];
  const untranslated: Untranslated[] = [];
  const defaultsOf = (type: string) => new Set(types.find((t) => t.name === type)?.defaultWargear.map((w) => w.weapon) ?? []);

  /** Les choix qu'une alternative porte en elle : ils ne tiennent dans aucune phrase. */
  const inside = new Set<string>();
  const within = (c: OptionGroup, o: WeaponOption) => c.options.every((x) => x.weapons.every((r) => o.weapons.includes(r)));

  for (const g of groups) {
    const choices = g.options.filter((o) => !o.isDefault);
    // Un emplacement qui n'offre qu'une configuration n'est pas un choix : ce que ses enfants proposent se lit avec eux.
    if (!choices.length) continue;
    const fallback = { group: g.name, why: '' };
    if (inside.has(g.id)) {
      untranslated.push({ ...fallback, why: 'a choice inside a Wargear Alternative' });
      continue;
    }
    const model = typeOf(g);
    const deflt = g.options.find((o) => o.isDefault);
    // « … replaced with 1 Plasma pistol and one of the following » : une alternative qui offre encore un choix.
    const nested = groups.filter((c) => c.parent === g.id && choices.some((o) => within(c, o)));
    if (nested.length) {
      for (const c of nested) inside.add(c.id);
      untranslated.push({ ...fallback, why: 'a Wargear Alternative with choices of its own' });
      continue;
    }

    if (!g.pool && deflt && g.maxPicks === 1 && !g.pickBrackets.length) {
      options.push(...replacements(g, deflt, choices, model, defaultsOf(model)));
      continue;
    }
    untranslated.push({ ...fallback, why: g.pool ? 'a pool of model configurations' : !deflt ? 'a choice without a default' : 'a choice of several' });
  }
  return { options, untranslated };
}

/**
 * Un groupe avec un défaut, un seul choix : chaque alternative remplace ce que
 * le défaut porte d'office par ce qu'elle apporte. Le défaut se lit dans le
 * Default Wargear — ses sous-choix n'en font pas partie. Des alternatives qui ne
 * rendent pas les mêmes Weapons ne font pas la même phrase.
 */
function replacements(g: OptionGroup, deflt: WeaponOption, choices: WeaponOption[], model: string, defaults: Set<string>): WargearOption[] {
  const carried = deflt.weapons.filter((r) => defaults.has(r));
  const given = carried.length ? carried : deflt.weapons;
  const byReplaced = new Map<string, { replaces: WeaponCount[]; alternatives: WargearAlternative[] }>();
  for (const o of choices) {
    const replaces = once(given.filter((r) => !o.weapons.includes(r)));
    const weapons = once(o.weapons.filter((r) => !given.includes(r)));
    const key = replaces.map((w) => w.weapon).join('+');
    const entry = byReplaced.get(key) ?? byReplaced.set(key, { replaces, alternatives: [] }).get(key)!;
    entry.alternatives.push({ id: o.id, name: o.name, weapons });
  }
  return [...byReplaced.values()].map((e, i) => ({
    id: i === 0 ? g.id : `${g.id}~${i + 1}`,
    model,
    who: { type: 'each' as const },
    replaces: e.replaces,
    alternatives: e.alternatives,
  }));
}
