/**
 * Schéma du Dataset Paint Plan Play.
 *
 * C'est le contrat entre le Dataset Tool, qui produit le Dataset, et les
 * applications qui le lisent : ces types disent exactement ce qu'un fichier du
 * Dataset contient, et `dataset.schema.json` en est la version exécutable.
 *
 * Aucun texte de règles n'y a sa place : une règle n'est portée que par son
 * nom, ses champs structurés et, quand il existe, son Effect.
 */

/** Version du schéma à laquelle un fichier se conforme. */
export const SCHEMA_VERSION = '0.7.0';

/** Un wargame à une édition donnée. Le Dataset est rangé par Game System. */
export interface GameSystem {
  /** Identifiant stable, nom de dossier du Game System : « wh40k-11e ». */
  id: string;
  name: string;
  edition: string;
}

export const GAME_SYSTEMS: Record<string, GameSystem> = {
  'wh40k-11e': { id: 'wh40k-11e', name: 'Warhammer 40,000', edition: '11th' },
};

/** Une Upstream Source, à la version exacte d'où le Dataset a été construit. */
export interface SourceRef {
  id: 'bsdata' | 'mfm' | '40kdc';
  /** « owner/repo » sur GitHub. */
  repository: string;
  commit: string;
  /** Version publiée par la source, quand elle en déclare une (le MFM : « 1.4 »). */
  version?: string;
}

/**
 * Le format des Effects : le DSL d'aptitudes de 40kdc-data (CC0), adopté tel
 * quel à cette version. Ses schémas sont vendus dans `vendor/40kdc`.
 */
export interface EffectFormat {
  repository: string;
  commit: string;
}

export const EFFECT_FORMAT: EffectFormat = {
  repository: 'wn-mitch/40kdc-data',
  commit: '6a2aa2d284cd677bb963a9e3d228d9964212991e',
};

// ------------------------------------------------------------------ Fichiers

/** `<gameSystem>/index.json` : ce que contient une construction du Dataset. */
export interface DatasetIndex {
  schemaVersion: string;
  gameSystem: GameSystem;
  sources: SourceRef[];
  effectFormat: EffectFormat;
  armies: ArmySummary[];
}

export interface ArmySummary {
  id: string;
  name: string;
  /** Grande faction (« Imperium », « Chaos »…), vide quand l'Army n'en déclare pas. */
  faction: string;
  /** Nombre d'Units jouables par cette Army, alliées comprises. */
  units: number;
  refs: ArmyRefs;
}

/** Ce qu'une Army garde de ses Upstream Sources, pour les retrouver. */
export interface ArmyRefs {
  /** Nom du catalogue BSData. */
  bsdata: string;
  /** Slug de la faction du Munitorum Field Manual. */
  mfm?: string;
  /** Identifiant de faction 40kdc-data. */
  kdc?: string;
}

/** `<gameSystem>/armies/<armyId>.json`. */
export interface ArmyFile {
  schemaVersion: string;
  gameSystem: string;
  id: string;
  name: string;
  faction: string;
  units: Unit[];
  detachments: Detachment[];
  /** Les Stratagems des Detachments de l'Army. Les Stratagems Core vivent dans `core.json`. */
  stratagems: Stratagem[];
}

/** `<gameSystem>/core.json` : ce qui vaut pour toutes les Armies du Game System. */
export interface CoreFile {
  schemaVersion: string;
  gameSystem: string;
  stratagems: Stratagem[];
  battleSizes: BattleSize[];
  referenceTargets: ReferenceTarget[];
  sampleList?: SampleList;
}

/**
 * Un format de partie : ses points et ce qu'il permet. Écrit par le projet —
 * aucune source amont ne publie le budget de DP ni les plafonds.
 */
export interface BattleSize {
  points: number;
  name: string;
  detachmentPoints: number;
  /** Enhancements au plus dans une List de ce format. */
  enhancementLimit: number;
  /** Exemplaires d'une même Unit au plus (doublé pour les Battleline et Dedicated Transport). */
  unitLimit: number;
}

/** Une cible par défaut de la Simulation : une Unit du Dataset et son effectif. */
export interface ReferenceTarget {
  armyId: string;
  unitId: string;
  name: string;
  models: number;
}

export interface WargearCount {
  name: string;
  count: number;
}

export type SampleSection = 'CHARACTERS' | 'BATTLELINE' | 'DEDICATED TRANSPORTS' | 'OTHER DATASHEETS';

/** Une Unit de la List d'exemple, avec son coût tiré du Dataset à la construction. */
export interface SampleUnit {
  unitId: string;
  name: string;
  section: SampleSection;
  points: number;
  warlord?: boolean;
  /** Figurines et leur équipement, pour une Unit à plusieurs figurines. */
  models?: { name: string; count: number; wargear: WargearCount[] }[];
  /** Équipement d'une Unit à figurine unique. */
  wargear?: WargearCount[];
}

/**
 * La List d'exemple, pour essayer l'application sans rien coller. Structurée,
 * jamais un export recopié : l'application la met en forme, et ses coûts
 * suivent le Dataset.
 */
export interface SampleList {
  armyId: string;
  name: string;
  detachment: string;
  battleSize: number;
  points: number;
  units: SampleUnit[];
}

// ------------------------------------------------------------------ Effects

/** Un Effect : un nœud du DSL d'aptitudes de 40kdc-data, repris tel quel. */
export type Effect = { type?: string } & Record<string, unknown>;

/** Portée d'un Effect, au même format. */
export type EffectScope = Record<string, unknown>;

/**
 * Ce qui dit ce que fait une règle, sans texte : son Effect quand il existe,
 * et à défaut un résumé court écrit par nous. Sans l'un ni l'autre, la règle
 * s'affiche par son nom et renvoie au codex du joueur.
 */
export interface RuleBody {
  effect?: Effect;
  scope?: EffectScope;
  /** Résumé en une ligne, écrit par le projet, jamais recopié. */
  summary?: string;
}

/** Une règle nommée : Detachment Rule, aptitude, Stratagem. */
export interface Rule extends RuleBody {
  id: string;
  name: string;
}

// --------------------------------------------------------------- Detachments

export interface Enhancement extends RuleBody {
  id: string;
  name: string;
  points: number;
  /** Une upgrade se pose sur une unité, une optimisation sur un personnage. */
  appliesTo: 'character' | 'unit';
  aura: boolean;
  /** Unités qu'une upgrade peut équiper à la fois. */
  maxTargets: number;
  /**
   * Mots-clés exigés du porteur : tous ceux d'un groupe (ET), l'un des groupes
   * suffit (OU). Vide : aucune restriction.
   */
  requires: string[][];
  /** Mots-clés qui interdisent le porteur. */
  excludes: string[];
  /** Units dont l'Enhancement ouvre l'aptitude Leader, par nom. */
  leaderTo?: string[];
  supportTo?: string[];
}

export interface Detachment {
  id: string;
  name: string;
  /** Coût en points de détachement, null quand le MFM ne le donne pas. */
  dp: number | null;
  /** Force Dispositions accordées : « take-and-hold », « disruption »… */
  forceDispositions: string[];
  /** Deux détachements portant le même tag sont exclusifs. */
  uniqueTag?: string;
  rules: Rule[];
  enhancements: Enhancement[];
}

// ---------------------------------------------------------------- Stratagems

export type Phase = 'command' | 'movement' | 'shooting' | 'charge' | 'fight';
export type PlayerTurn = 'your-turn' | 'opponent-turn' | 'either';
export type StratagemTiming = 'once-per-phase' | 'once-per-turn' | 'once-per-battle' | 'unlimited';
export type StratagemCategory = 'battle-tactic' | 'strategic-ploy' | 'epic-deed' | 'wargear';

/**
 * Les Units qu'un Stratagem peut cibler, par mots-clés : toutes celles de
 * `allOf`, au moins une de `anyOf` quand il n'est pas vide, aucune de `noneOf`.
 * Absente : le Dataset ne sait pas restreindre sa cible.
 */
export interface StratagemTarget {
  allOf: string[];
  anyOf: string[];
  noneOf: string[];
}

export interface Stratagem extends RuleBody {
  id: string;
  name: string;
  /** Le Detachment qui l'accorde, `null` pour un Stratagem Core. */
  detachmentId: string | null;
  cp: number;
  phases: Phase[];
  playerTurn: PlayerTurn;
  timing: StratagemTiming;
  category?: StratagemCategory;
  target?: StratagemTarget;
}

// -------------------------------------------------------------------- Units

export type WeaponKind = 'ranged' | 'melee';

export interface Weapon {
  name: string;
  kind: WeaponKind;
  /** « 24" », « Melee ». */
  range: string;
  /** Portée en pouces, 0 au corps à corps. */
  rangeInches: number;
  /** Attaques, en expression de dés : « 3 », « D6+1 ». */
  A: string;
  /** Jet à atteindre (2..6), 7 quand l'arme ne touche jamais. */
  skill: number;
  S: number;
  /** Pénétration d'armure, négative ou nulle. */
  AP: number;
  /** Dégâts, en expression de dés. */
  D: string;
  /** Mots-clés d'arme : « Rapid Fire 1 », « Anti-Infantry 4+ ». */
  keywords: string[];
  /** Figurines de l'Unit qui peuvent la porter au plus, quand la datasheet le dit. */
  maxCarriers?: number;
}

export interface Profile {
  name: string;
  /** Mouvement tel qu'écrit : « 6" ». */
  M: string;
  T: number;
  /** Sauvegarde d'armure (2..7, 7 = aucune). */
  Sv: number;
  /** Sauvegarde invulnérable (2..7, 7 = aucune). */
  Inv: number;
  W: number;
  LD: string;
  OC: number;
}

export interface WeaponOption {
  id: string;
  name: string;
  /** Armes équipées, en clés « kind|name ». */
  weapons: string[];
  maxCarriers: number;
  /** « Une figurine par tranche de N ». */
  perModels?: number;
  isDefault: boolean;
}

export interface OptionGroup {
  id: string;
  name: string;
  tree: string;
  parent: string;
  slot: string;
  pool: boolean;
  minPicks: number;
  maxPicks: number;
  pickBrackets: { atModels: number; maxPicks: number }[];
  options: WeaponOption[];
}

/** Une tranche du MFM : le prix des exemplaires `from`..`to` d'une même Unit. */
export interface PriceBand {
  from: number;
  /** null : tranche ouverte (« 4e et suivantes »). */
  to: number | null;
  /** `addon` : un supplément (« + 1 Invader ATV ») plutôt qu'une taille d'Unit. */
  costs: { models: number; points: number; desc?: string; addon?: boolean }[];
}

/** D'où vient l'Effect d'une aptitude d'Unit. */
export type EffectSource = '40kdc' | 'analysis' | 'project';

/**
 * Une aptitude d'Unit. Son texte n'est jamais publié : ce qu'elle fait se dit
 * par son Effect, repris de 40kdc-data quand l'Unit y est rattachée par sa
 * référence BSData (`effectSource: '40kdc'`), sinon proposé par l'analyse
 * d'aptitudes du Dataset Tool (`effectSource: 'analysis'`), ou écrit par le projet
 * (`effectSource: 'project'`, `authored/<gameSystem>/effects.json`). Sans Effect,
 * l'aptitude n'a que son nom.
 */
export interface UnitAbility extends RuleBody {
  name: string;
  effectSource?: EffectSource;
  /**
   * L'analyse a reconnu le bonus mais lu une condition qu'elle ne sait pas
   * exprimer (Waaagh!, objectif tenu…) : au joueur de la poser.
   */
  conditional?: boolean;
}

export interface Unit {
  /** Identifiant BSData de la datasheet, gardé tel quel. */
  id: string;
  name: string;
  /** Catalogue BSData qui définit la datasheet. */
  source: string;
  /** Présente dans cette Army sans venir de son propre codex. */
  ally?: boolean;
  /** Legends ou Crucible : hors tournoi. */
  isLegends: boolean;
  keywords: string[];
  models: Profile[];
  weapons: Weapon[];
  abilities: UnitAbility[];
  /** Coût de l'effectif minimal. */
  points: number;
  /** Paliers de coût selon l'effectif : « au-delà de N figurines, P points ». */
  costBrackets: { overModels: number; points: number }[];
  /** Tarif du MFM, par tranche d'exemplaires. Absent si l'Unit n'y figure pas. */
  pricing?: PriceBand[];
  /** Équipement payant, en supplément du coût de l'Unit. */
  wargear?: { item: string; points: number }[];
  /** Units que ce personnage peut mener (Leader), par nom. */
  leaderTargets: string[];
  /** Units qu'il peut rejoindre en soutien (Support), par nom. */
  supportTargets: string[];
  minModels: number;
  maxModels: number;
  /** Effectif auquel se rapportent les compteurs de `defaultLoadout`. */
  defaultModels?: number;
  composition?: { name: string; min: number; max: number }[];
  defaultLoadout?: { weapon: string; kind: WeaponKind; count: number }[];
  optionGroups?: OptionGroup[];
}

// -------------------------------------------------------------- Corrections

/**
 * Une Correction : un fichier public du dépôt du Dataset,
 * `corrections/<gameSystem>/<armyId>/<nom>.json`.
 *
 * Elle ne porte jamais de texte de règles, ni en nouvelle valeur ni en valeur
 * amont.
 */
export interface Correction {
  /**
   * Adresse de l'élément corrigé : « <unitId> », « <unitId>::weapon:melee|Power klaw »,
   * « <armyId>::detachment:<detachmentId> », « <armyId>::enhancement:<detachmentId>|<enhancementId> »…
   */
  target: string;
  /** L'Upstream Source que la Correction redresse. */
  source: 'bsdata' | 'mfm' | '40kdc';
  /**
   * Champs forcés. `__delete: true` retire l'élément visé, `__add: true` le
   * crée.
   */
  patch: Record<string, unknown>;
  /** Ce que disait l'amont au moment de la Correction, sur les champs corrigés. */
  upstream?: Record<string, unknown>;
  /** Pourquoi, en une phrase à nous. */
  reason: string;
  /** La PR proposée à l'Upstream Source pour qu'elle se corrige. */
  upstreamPr?: string;
}

// ------------------------------------------------------------------ Chemins

// ---------------------------------------------------------------- Releases

/** Une Dataset Release : un tag immuable du dépôt du Dataset. */
export interface ReleaseRef {
  tag: string;
  /** Rang dans sa Dataslate, à partir de 1. */
  number: number;
  publishedAt: string;
  schemaVersion: string;
}

/**
 * Une Dataslate : une période de règles, bornée par une version du Munitorum
 * Field Manual. Gelée à la sortie de la suivante — plus aucune Release —, ses
 * Releases restent lisibles.
 */
export interface Dataslate {
  id: string;
  name: string;
  mfmVersion: string;
  frozen: boolean;
  /** Toutes ses Releases, la plus récente d'abord. */
  releases: ReleaseRef[];
  /** Tag de la Release que l'application lit : la plus récente, sauf retour en arrière. */
  latest: string;
}

/**
 * Le manifeste, à la racine du dépôt du Dataset : ce que l'application lit en
 * premier. Seul fichier qui change sans nouvelle Release — revenir en arrière,
 * c'est le repointer.
 */
export interface Manifest {
  schemaVersion: string;
  gameSystem: string;
  /** Adresse d'une Release, `{tag}` remplacé par son tag. */
  releaseUrl: string;
  /** Id de la Dataslate courante. */
  current: string;
  /** Dataslates proposées au joueur : la courante et les deux précédentes. */
  offered: string[];
  /** Toutes les Dataslates, la plus récente d'abord. */
  dataslates: Dataslate[];
}

export const manifestPath = 'manifest.json';

export const indexPath = (gameSystem: string) => `${gameSystem}/index.json`;
export const armyPath = (gameSystem: string, armyId: string) => `${gameSystem}/armies/${armyId}.json`;
export const corePath = (gameSystem: string) => `${gameSystem}/core.json`;

/** Genre de fichier d'après son chemin dans le Dataset, `null` pour un fichier inconnu. */
export type FileKind = 'index' | 'core' | 'army' | 'correction' | 'manifest';

export function kindOfPath(path: string): FileKind | null {
  if (path === manifestPath) return 'manifest';
  const parts = path.split('/');
  if (parts[0] === 'corrections' && parts.length >= 3 && path.endsWith('.json')) return 'correction';
  if (parts.length === 2 && parts[1] === 'index.json') return 'index';
  if (parts.length === 2 && parts[1] === 'core.json') return 'core';
  if (parts.length === 3 && parts[1] === 'armies' && parts[2].endsWith('.json')) return 'army';
  return null;
}
