/** Modèle « à plat » des datasheets BSData, tel que le Dataset Tool le manipule avant d'en tirer le Dataset. */
import type { ParsedAbility } from './abilities.ts';

export type WeaponKind = 'ranged' | 'melee';

export interface Weapon {
  name: string;
  kind: WeaponKind;
  /** "24\"", "Melee" */
  range: string;
  /** Portée en pouces, 0 pour le corps à corps. */
  rangeInches: number;
  /** Nombre d'attaques, expression de dés : "3", "D6", "2D6+1". */
  A: string;
  /** BS ou WS, valeur du jet à atteindre (2..6). 7 = ne touche jamais / N.A. */
  skill: number;
  S: number;
  /** Négatif ou 0 (AP -2 => -2). */
  AP: number;
  /** Dégâts, expression de dés. */
  D: string;
  keywords: string[];
  /**
   * Nombre maximal de figurines du pack qui peuvent la porter, quand la
   * datasheet le dit. Il vient de l'emplacement de figurine sur lequel l'arme
   * est assise — le Boss Nob d'un pack de Boyz est seul, donc sa power klaw
   * plafonne à 1, quand bien même le pack en compte vingt.
   *
   * Absent quand aucune borne n'a été trouvée : le pack entier est alors la
   * seule limite connue.
   */
  maxCarriers?: number;
}

/** Identité d'une arme au sein d'une datasheet, pour la désigner depuis une option. */
export const weaponRef = (w: { kind: WeaponKind; name: string }) => `${w.kind}|${w.name}`;

/**
 * Une option d'un choix d'équipement : ce qu'elle équipe, et sur combien de
 * figurines.
 *
 * Une option porte parfois plusieurs armes — « Big choppa, kombi-rokkit and
 * kombi-shoota » en équipe trois d'un coup — et c'est le lot entier qui s'échange
 * contre celui d'une option voisine.
 */
export interface WeaponOption {
  /** Identifiant BSData de l'entrée ou du lien qui porte l'option. */
  id: string;
  name: string;
  /** Armes équipées, en clés `weaponRef`. */
  weapons: string[];
  /** Nombre maximal de figurines qui peuvent la prendre. */
  maxCarriers: number;
  /**
   * « Une figurine par tranche de N ». La règle la plus courante des options
   * d'équipement s'écrit ainsi — « for every 5 models in this unit, 1 model
   * can… » — et son plafond dépend donc de l'effectif : deux dans un pack de
   * dix, une seule dans un pack de cinq. `maxCarriers`, lui, est un plafond
   * absolu que BSData donne pour le pack plein, et qui ne sait pas décroître
   * quand on réduit l'unité.
   *
   * Absent la plupart du temps : BSData n'exprime pas la tranche, c'est une
   * correction manuelle qui la pose.
   */
  perModels?: number;
  /** Option retenue par défaut dans son groupe. */
  isDefault: boolean;
}

/**
 * Un choix d'équipement de la datasheet, avec le budget qui le gouverne.
 *
 * BSData n'écrit pas l'exclusivité, il écrit **combien d'options le groupe tient**
 * (`max` à portée `parent`). Un budget de 1 est un choix au sens strict — le Boss
 * Nob prend le big choppa *ou* la power klaw. Au-delà, les options coexistent :
 * le groupe « Special Weapons » des Boyz tient une arme spéciale, et deux dès que
 * le pack atteint vingt figurines.
 *
 * Confondre les deux revient soit à autoriser deux armes qui s'excluent, soit à
 * effacer une arme spéciale à chaque fois qu'on en coche une autre.
 */
export interface OptionGroup {
  id: string;
  name: string;
  /**
   * Le choix de premier niveau dont celui-ci relève, lui-même quand il est déjà
   * à la racine. Deux groupes du même arbre décrivent la même figurine sous deux
   * angles — « Big Choppa » raffine « Big Choppa and Slugga » — là où deux arbres
   * distincts sont deux emplacements qui s'additionnent.
   */
  tree: string;
  /**
   * Le choix qui contient celui-ci, vide à la racine. Là où `tree` dit
   * l'appartenance, `parent` dit le **sens** : « Special Weapons » puise dans
   * « 9-19 Boyz », et pas l'inverse.
   */
  parent: string;
  /** Figurine qui porte le choix (« Boss Nob »), vide quand il vaut pour le pack. */
  slot: string;
  /**
   * Le budget compte-t-il des **figurines** ou des **choix** ?
   *
   * BSData ne le dit pas, mais le type de ses options le trahit : des entrées
   * `model` sont des figurines qu'on ajoute au pack — « 9-19 Boyz », « une arme
   * spéciale par tranche de dix » — là où des entrées `upgrade` sont des façons
   * d'équiper une figurine déjà comptée, comme le big choppa du Boss Nob.
   *
   * La distinction commande tout : dans un emplacement, le budget plafonne le
   * nombre de porteurs et les options se disputent les mêmes figurines. Ailleurs,
   * il ne dit que « une option à la fois » — le groupe « Unit Composition » des
   * Lootas n'autorise qu'un choix, et ce choix apporte deux Spanners.
   */
  pool: boolean;
  /** Options qu'il faut retenir au minimum. */
  minPicks: number;
  /** Options qu'on peut retenir, à l'effectif de base. */
  maxPicks: number;
  /**
   * « le budget passe à P à partir de N figurines ». Même encodage que les
   * paliers de coût : un modificateur conditionné à l'effectif.
   */
  pickBrackets: { atModels: number; maxPicks: number }[];
  options: WeaponOption[];
}

/**
 * Plafond d'une option à un effectif donné.
 *
 * La tranche l'emporte sur le plafond absolu quand elle est posée : c'est elle
 * qui porte la règle, et elle seule sait décroître avec l'unité.
 */
export const optionCapAt = (o: WeaponOption, models: number): number =>
  o.perModels && o.perModels > 0 ? Math.floor(models / o.perModels) : o.maxCarriers;

/** Budget d'un groupe à un effectif donné, paliers appliqués. */
export function maxPicksAt(group: OptionGroup, models: number): number {
  let picks = group.maxPicks;
  for (const b of group.pickBrackets) if (models >= b.atModels) picks = b.maxPicks;
  return picks;
}

export interface Statline {
  name: string;
  /** Mouvement brut, "6\"". */
  M: string;
  T: number;
  /** Sauvegarde d'armure, 2..7 (7 = aucune). */
  Sv: number;
  /** Sauvegarde invulnérable, 2..7 (7 = aucune). */
  Inv: number;
  W: number;
  LD: string;
  OC: number;
}

export interface Ability {
  name: string;
  text: string;
}

/** Une entrée de datasheet telle qu'on la retrouve dans un catalogue. */
export interface CatalogueUnit {
  id: string;
  name: string;
  /** Nom du catalogue d'origine. */
  source: string;
  /** Coût de base en points (taille mini de l'unité). */
  points: number;
  /** Une ligne par variante de figurine (sergent, chef, etc.). */
  models: Statline[];
  weapons: Weapon[];
  /** Mots-clés (INFANTRY, VEHICLE, CHARACTER...). */
  keywords: string[];
  abilities: Ability[];
  /** Aptitudes analysées : effets déduits et cibles de l'aptitude « Leader ». */
  parsedAbilities: ParsedAbility[];
  /** Unités que ce personnage peut mener (aptitude « Leader »). */
  leaderTargets: string[];
  /** Unités qu'il peut rejoindre en soutien (aptitude « Support »). */
  supportTargets: string[];
  /** Rattachable d'une façon ou d'une autre. */
  isAttachable: boolean;
  /** Marquée « [Legends] » ou « [Crucible] » : hors tournoi. */
  isLegends: boolean;
  /** Taille minimale de l'unité, lue dans les contraintes du catalogue. */
  minModels: number;
  /** Taille maximale : c'est celle qu'on prend par défaut, les packs se jouent pleins. */
  maxModels: number;
  /** Paliers de coût : « au-delà de N figurines, l'unité coûte P points ». */
  costBrackets: { overModels: number; points: number }[];
  /**
   * Grille tarifaire officielle du Munitorum Field Manual, quand on a pu la
   * rapprocher : une bande par seuil de réquisition (« vos 3 premières unités »,
   * « la 4e et les suivantes »), chacune avec ses coûts par taille. Absente si
   * l'unité n'a pas été retrouvée dans le MFM.
   */
  pricing?: { from: number; to: number | null; costs: { models: number; points: number; desc?: string }[] }[];
  /** Options d'équipement payantes, en supplément du coût de l'unité. */
  wargear?: { item: string; points: number }[];
  /**
   * true si l'unité vient d'un autre catalogue que celui choisi — codex parent
   * ou allié. Sert à la séparer dans le navigateur de datasheets.
   */
  ally?: boolean;
  /**
   * Dotation par défaut de la datasheet : clé d'arme → nombre de figurines qui
   * peuvent la porter. C'est ce qu'on équipe en ajoutant l'unité, plutôt que la
   * première arme trouvée.
   */
  defaultLoadout?: { weapon: string; kind: WeaponKind; count: number }[];
  /**
   * Effectif auquel les compteurs de `defaultLoadout` se rapportent : celui de
   * la composition marquée par défaut dans la datasheet. Un pack de Cadian Shock
   * Troops décrit « 1 sergent et 9 troupiers », donc 10, alors qu'il se joue
   * aussi à 20 — sans ce repère, « 9 lasguns » ne dit pas sur combien.
   */
  defaultModels?: number;
  /**
   * Composition du pack : quelles figurines le composent, et combien de chaque.
   * « Boy » 0 à 19, « Boss Nob » 1 à 1 — c'est ce qui permet d'écrire « 19 Boyz
   * et 1 Boss Nob » plutôt qu'un simple « ×20 ».
   */
  composition?: { name: string; min: number; max: number }[];
  /**
   * Les choix d'équipement de la datasheet, avec leur budget. C'est ce qui dit
   * que prendre la power klaw du Boss Nob lui retire son big choppa, et qu'il
   * n'y en a qu'une dans le pack.
   */
  optionGroups?: OptionGroup[];
}
