/**
 * Ce qu'on lit d'une Wargear Option sans rien stocker de plus : sa phrase,
 * telle que Games Workshop l'écrit, combien de figurines d'un type compte une
 * Unit à un effectif donné, et combien de fois l'option peut être prise.
 *
 * Partagé par le Dataset Tool, qui montre la phrase sur la fiche, et par les
 * applications, qui l'affichent et bornent les choix d'une List.
 */
import type { ModelType, Unit, WargearAlternative, WargearOption, WeaponCount } from './index.ts';

/** Le nom d'une Weapon dans sa clé « kind|name ». */
export const weaponName = (ref: string) => ref.slice(ref.indexOf('|') + 1);

/** Un pluriel d'anglais simple, comme les fiches l'écrivent : « 4 Big Shootas ». */
const plural = (name: string) => (/s$/i.test(name) ? name : `${name}s`);

const counted = (w: WeaponCount) => `${w.count} ${w.count > 1 ? plural(weaponName(w.weapon)) : weaponName(w.weapon)}`;

/** Ce qu'une Wargear Alternative donne, en clair : « 1 Big Skorcha and 1 Kustom Choppa ». */
export const alternativeText = (a: WargearAlternative) => (a.weapons.length ? a.weapons.map(counted).join(' and ') : (a.name ?? 'nothing'));

/** Les types de figurine d'une Unit ; un seul, à son nom, quand elle n'en déclare pas. */
export const modelTypesOf = (u: Pick<Unit, 'name' | 'minModels' | 'maxModels' | 'modelTypes'>): ModelType[] =>
  u.modelTypes?.length ? u.modelTypes : [{ name: u.name, min: u.minModels, max: u.maxModels, defaultWargear: [] }];

/**
 * Combien de figurines de chaque type compte l'Unit à cet effectif. Le type le
 * plus nombreux complète ; les autres prennent leur minimum, puis ce qui reste
 * dans leur maximum : à 20 figurines, des Boyz (9 à 18) et des Nobz (1 à 2)
 * font 18 Boyz et 2 Nobz.
 */
export function modelsOfTypes(u: Pick<Unit, 'name' | 'minModels' | 'maxModels' | 'modelTypes'>, size: number): Map<string, number> {
  const types = modelTypesOf(u);
  if (types.length === 1) return new Map([[types[0].name, size]]);
  const filler = types.reduce((a, b) => (b.max > a.max ? b : a));
  const others = types.filter((t) => t !== filler);
  const counts = new Map(others.map((t) => [t.name, Math.min(t.min, size)]));
  const taken = () => [...counts.values()].reduce((n, v) => n + v, 0);
  const fill = Math.max(0, Math.min(filler.max || size, size - taken()));
  let left = size - taken() - fill;
  for (const t of others) {
    const more = Math.max(0, Math.min(left, t.max - counts.get(t.name)!));
    counts.set(t.name, counts.get(t.name)! + more);
    left -= more;
  }
  counts.set(filler.name, fill + left);
  return counts;
}

/**
 * Combien de fois l'option peut être prise dans l'Unit à cet effectif, toutes
 * ses Wargear Alternatives ensemble : par figurine de son type, une tranche de
 * l'Unit, ou un nombre fixe — et autant de fois par figurine que `upTo`.
 */
export function wargearCap(u: Pick<Unit, 'name' | 'minModels' | 'maxModels' | 'modelTypes'>, option: WargearOption, size: number): number {
  const carriers = modelsOfTypes(u, size).get(option.model) ?? 0;
  const who = option.who;
  const models =
    who.type === 'each' ? carriers : who.type === 'up-to' ? Math.min(who.models, carriers) : Math.min(carriers, Math.floor(size / Math.max(1, who.every)) * who.models);
  return models * Math.max(1, option.upTo ?? 1);
}

/** Une phrase de fiche ; `items` quand elle propose « one of the following ». */
export interface WargearSentence {
  text: string;
  items?: string[];
}

/**
 * La phrase d'une Wargear Option, comme sur la fiche : « This model's Kustom
 * Choppa can be replaced with 1 Power Klaw. », « For every 5 models in this
 * unit, 1 model can have its Kustom Shoota and Kustom Krumpa replaced with
 * 1 Big Skorcha and 1 Kustom Choppa. », « This model can be equipped with up
 * to 4 Big Shootas. »
 */
export function wargearSentence(u: Pick<Unit, 'name' | 'minModels' | 'maxModels' | 'modelTypes'>, option: WargearOption): WargearSentence {
  const types = modelTypesOf(u);
  const type = types.find((t) => t.name === option.model) ?? types[0];
  const only = types.length === 1;
  const models = (n: number) => (only ? (n > 1 ? 'models' : 'model') : `${type.name} model${n > 1 ? 's' : ''}`);
  const who = option.who;
  const subject =
    who.type === 'each'
      ? type.max <= 1
        ? only
          ? 'This model'
          : `The ${type.name}`
        : `Any number of ${models(2)}`
      : who.type === 'up-to'
        ? `${who.models === 1 ? '1' : `Up to ${who.models}`} ${models(who.models)}`
        : `For every ${who.every} models in this unit, ${who.models} ${models(who.models)}`;
  // Une figurine seule « can be replaced » ; un nombre de figurines « can each have their ».
  const one = who.type === 'each' ? type.max <= 1 : who.models === 1;

  const upTo = Math.max(1, option.upTo ?? 1);
  const alts = option.alternatives;
  const single = alts.length === 1;
  const lone = single && alts[0].weapons.length === 1 && alts[0].weapons[0].count === 1;
  const what = single
    ? upTo > 1 && lone
      ? `up to ${upTo} ${plural(weaponName(alts[0].weapons[0].weapon))}`
      : `${upTo > 1 ? `up to ${upTo} × ` : ''}${alternativeText(alts[0])}`
    : upTo > 1
      ? `up to ${upTo} of the following`
      : 'one of the following';
  const replaced = option.replaces.map((w) => (w.count > 1 ? counted(w) : weaponName(w.weapon))).join(' and ');

  const head = !option.replaces.length
    ? `${subject} can ${one ? '' : 'each '}be equipped with ${what}`
    : who.type === 'each' && one
      ? `${subject}’s ${replaced} can be replaced with ${what}`
      : one
        ? `${subject} can have its ${replaced} replaced with ${what}`
        : `${subject} can each have their ${replaced} replaced with ${what}`;
  return single ? { text: `${head}.` } : { text: `${head}:`, items: alts.map(alternativeText) };
}
