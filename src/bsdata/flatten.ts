/**
 * Aplatissement d'un catalogue BattleScribe (BSData/wh40k-11e) en datasheets exploitables.
 *
 * Le format source est un arbre de `selectionEntry` reliés par des `entryLink`
 * (référence par `targetId` vers les `shared*` du catalogue). On ne rejoue pas la
 * sémantique complète de BattleScribe : on collecte tous les profils atteignables
 * depuis une entrée racine de type unit/model, ce qui suffit pour lister les
 * caractéristiques et l'arsenal possible d'une datasheet.
 */
import { parseAbilities } from './abilities.ts';
import { weaponRef, type Ability, type CatalogueUnit, type OptionGroup, type Statline, type Weapon, type WeaponOption } from './types.ts';

interface BsNode {
  id?: string;
  /** Option retenue par défaut dans un groupe de choix. */
  defaultSelectionEntryId?: string;
  name?: string;
  type?: string;
  hidden?: boolean;
  typeName?: string;
  targetId?: string;
  characteristics?: { name: string; $text?: string }[];
  profiles?: BsNode[];
  infoLinks?: BsNode[];
  infoGroups?: BsNode[];
  entryLinks?: BsNode[];
  selectionEntries?: BsNode[];
  selectionEntryGroups?: BsNode[];
  categoryLinks?: { name?: string; targetId?: string; primary?: boolean }[];
  costs?: { name: string; value: number; typeId?: string }[];
  // `id` est ce que visent les modificateurs qui font bouger une borne.
  constraints?: { id?: string; type?: string; field?: string; scope?: string; value: number }[];
  modifiers?: {
    type?: string;
    field?: string;
    value?: unknown;
    conditions?: { type?: string; field?: string; value: number }[];
  }[];
}

export interface BsCatalogue extends BsNode {
  library?: boolean;
  sharedSelectionEntries?: BsNode[];
  sharedSelectionEntryGroups?: BsNode[];
  sharedProfiles?: BsNode[];
  sharedRules?: BsNode[];
  sharedInfoGroups?: BsNode[];
  catalogueLinks?: { name: string; targetId: string; importRootEntries?: boolean }[];
}

export interface BsFile {
  catalogue?: BsCatalogue;
  gameSystem?: BsCatalogue;
}

const chars = (n: BsNode): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const c of n.characteristics ?? []) out[c.name] = (c.$text ?? '').trim();
  return out;
};

/** "2+" -> 2 ; "-", "", "N/A" -> 7 (impossible). */
export function parseTarget(v: string | undefined): number {
  const m = /(\d)\s*\+/.exec(v ?? '');
  if (!m) return 7;
  return Number(m[1]);
}

/** "-2" -> -2 ; "0", "-" -> 0. */
function parseAp(v: string | undefined): number {
  const m = /-?\d+/.exec(v ?? '');
  if (!m) return 0;
  return -Math.abs(Number(m[0]));
}

function parseNum(v: string | undefined, fallback = 0): number {
  const m = /-?\d+/.exec(v ?? '');
  return m ? Number(m[0]) : fallback;
}

function parseRangeInches(v: string | undefined): number {
  if (!v || /melee/i.test(v)) return 0;
  return parseNum(v, 0);
}

function splitKeywords(v: string | undefined): string[] {
  if (!v || v === '-') return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Porteurs d'une arme dans le pack : un emplacement de figurine ne compte qu'une fois. */
const carriers = (perSlot: Map<string, number>) => [...perSlot.values()].reduce((n, v) => n + v, 0);

const weaponKey = (w: Weapon) => `${w.kind}|${w.name}|${w.A}|${w.S}|${w.AP}|${w.D}|${w.skill}|${w.range}`;

function toWeapon(p: BsNode): Weapon | null {
  const c = chars(p);
  const melee = /melee/i.test(p.typeName ?? '');
  const skillRaw = melee ? c.WS : c.BS;
  return {
    name: (p.name ?? '').trim(),
    kind: melee ? 'melee' : 'ranged',
    range: c.Range || (melee ? 'Melee' : ''),
    rangeInches: parseRangeInches(c.Range),
    A: (c.A || '1').trim(),
    skill: parseTarget(skillRaw),
    S: parseNum(c.S, 1),
    AP: parseAp(c.AP),
    D: (c.D || '1').trim(),
    keywords: splitKeywords(c.Keywords),
  };
}

function toStatline(p: BsNode): Statline {
  const c = chars(p);
  return {
    name: (p.name ?? '').trim(),
    M: c.M || '',
    T: parseNum(c.T, 4),
    Sv: parseTarget(c.Sv),
    Inv: parseTarget(c.InSv),
    W: parseNum(c.W, 1),
    LD: c.LD || '',
    OC: parseNum(c.OC, 0),
  };
}

/** Index id -> nœud, pour résoudre les entryLink/infoLink d'un ou plusieurs catalogues. */
export function buildIdIndex(catalogues: BsCatalogue[]): Map<string, BsNode> {
  const byId = new Map<string, BsNode>();
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const n = node as BsNode & Record<string, unknown>;
    // Les liens portent aussi un `id` propre : on n'indexe que les vraies définitions.
    if (n.id && !n.targetId && !byId.has(n.id)) byId.set(n.id, n);
    for (const k of Object.keys(n)) visit(n[k]);
  };
  catalogues.forEach(visit);
  return byId;
}

interface Collected {
  models: Statline[];
  weapons: Weapon[];
  abilities: Ability[];
  keywords: Set<string>;
  /**
   * Armes de la dotation par défaut : pour chaque arme, combien de figurines la
   * portent **dans chaque emplacement du pack**. Un pack de Boyz sort ainsi
   * 19 Choppa et 1 Big choppa pour le Boss Nob, au lieu de 20 Power Klaw — le
   * Power Klaw est une alternative, pas un défaut, et il n'appartient qu'au Nob.
   *
   * Le détail par emplacement compte : un Bolt Rifle porté par le sergent *et*
   * par les neuf autres fait dix porteurs, pas neuf. Additionner à l'aveugle les
   * visites, en revanche, compterait deux fois la même figurine dès que deux
   * chemins mènent à la même arme.
   */
  defaults: Map<string, Map<string, number>>;
  /**
   * Composition du pack : « 19 Boyz et 1 Boss Nob ». Les bornes viennent des
   * contraintes portées par chaque entrée de figurine ; sans elles, l'unité n'est
   * qu'un nombre et on ne sait pas qui porte quoi.
   */
  composition: Map<string, { min: number; max: number }>;
  /**
   * Combien de figurines chaque entrée de figurine apporte à la composition par
   * défaut, par identifiant d'entrée. La somme donne l'effectif auquel les
   * compteurs de `defaults` se rapportent : 9 troupiers + 1 sergent = 10 pour
   * les Cadian Shock Troops, alors que le pack se joue aussi à 20.
   */
  slots: Map<string, number>;
}

const MAX_DEPTH = 10;

/**
 * Ce qu'on considère comme « déjà visité ».
 *
 * L'emplacement de figurine et le statut « retenu par défaut » en font partie,
 * et pas seulement la cible du lien. Sans eux, le premier chemin venu fermait
 * la porte : le Bolt Rifle des Intercessors était atteint d'abord sous une
 * option écartée du sergent, donc jamais compté comme dotation, et le lien du
 * troupier qui la portait vraiment se voyait refuser l'entrée.
 */
const visitKey = (kind: 'e' | 'i', targetId: string | undefined, slotId: string, preferred: boolean) =>
  `${kind}:${targetId}|${slotId}|${preferred ? 1 : 0}`;

/** Ce qu'un nœud, un lien ou un groupe dit de son propre effectif. */
interface Bounds {
  min: number;
  max: number | null;
}

/**
 * Bornes déclarées ici même, ou `null` si ce nœud n'en déclare aucune.
 *
 * La distinction compte : un emplacement qui annonce un plafond sans plancher
 * est une **variante facultative** — « jusqu'à deux Intercessors au lance-
 * grenades » — et n'appartient pas à la dotation de base. Le confondre avec un
 * emplacement muet reviendrait à équiper d'office toutes les options du pack.
 */
function boundsOf(node: BsNode): Bounds | null {
  const of = (type: string) =>
    (node.constraints ?? []).find(
      (x) => x.type === type && (x.field === 'selections' || x.field === undefined) && x.scope === 'parent',
    )?.value;
  const max = of('max');
  const min = of('min');
  if (typeof max !== 'number' && typeof min !== 'number') return null;
  return { min: typeof min === 'number' ? min : 0, max: typeof max === 'number' && max > 0 ? max : null };
}

/**
 * @param own true tant qu'on est dans la datasheet elle-même. Les liens vers les
 * groupes partagés (Enhancements, Croisade, reliques de détachement) apportent
 * des options de wargear qu'il faut suivre pour les armes, mais leurs aptitudes
 * n'appartiennent pas à l'unité : un Warboss en remontait une quarantaine.
 */
function collect(
  node: BsNode,
  byId: Map<string, BsNode>,
  acc: Collected,
  seen: Set<string>,
  depth: number,
  own = true,
  /** false dès qu'on s'écarte du choix marqué par défaut dans un groupe. */
  preferred = true,
  /** Plafond de porteurs hérité de l'entrée de figurine la plus proche. */
  cap = Infinity,
  /**
   * Plafond annoncé par le lien ou le groupe qui nous a menés ici, en attente
   * d'une entrée de figurine à qui l'appliquer.
   */
  pending: Bounds | null = null,
  /** Emplacement de figurine courant : le sergent, la troupe, le porteur d'arme spéciale. */
  slotId = '',
  /**
   * true quand le groupe qui nous contient a désigné son option par défaut :
   * le tri est alors déjà fait, et un plancher à zéro ne veut plus dire
   * « facultatif ».
   */
  namedDefault = false,
) {
  if (depth > MAX_DEPTH) return;

  /*
   * Le plafond vient des entrées de figurine — « Boy » max 19, « Boss Nob »
   * max 1 — et jamais du lien vers l'arme, dont le « max 1 » veut dire « une par
   * figurine » et non « une par unité ».
   *
   * Mais BSData ne porte presque jamais ce nombre sur l'entrée de figurine
   * elle-même : il est sur le **lien** qui la désigne, ou sur le groupe qui la
   * contient — « 9 Shock Troopers », `max selections = 9`. Le lire seulement sur
   * l'entrée laissait le plafond à l'infini, donc à 1 après repli, donc aucune
   * dotation exploitable : l'application retombait sur « une arme par phase,
   * portée par tout le pack », et simulait dix lasguns *et* dix chainswords.
   */
  let slot: { name: string; min: number; max: number } | null = null;
  if (node.type === 'model') {
    // L'entrée a le dernier mot sur ses bornes ; à défaut, celles du lien ou du groupe.
    const bounds = boundsOf(node) ?? pending;
    const here = bounds?.max ?? Infinity;
    if (here !== Infinity) cap = Math.min(cap, here);
    if (node.name) slot = { name: node.name, min: bounds?.min ?? 0, max: here === Infinity ? 0 : here };
    /*
     * Un emplacement facultatif ne fait pas partie de la dotation : plafond
     * annoncé, plancher à zéro. Sans cette distinction, un pack d'Intercessors
     * sortait avec deux lance-grenades d'office, alors que c'est une option
     * qu'on prend ou non.
     *
     * La règle ne vaut que là où BSData ne s'est pas prononcé. Les Boyz et les
     * Meganobz écrivent leur variante de base sans plancher, mais le groupe la
     * désigne comme défaut : c'est ce marqueur qui tranche, pas les bornes.
     */
    if (!namedDefault && bounds && bounds.min === 0 && bounds.max !== null) preferred = false;
    if (node.id) {
      slotId = node.id;
      if (preferred) acc.slots.set(node.id, here === Infinity ? 1 : here);
    }
  }

  for (const p of node.profiles ?? []) {
    const t = p.typeName ?? '';
    if (t === 'Unit') {
      acc.models.push(toStatline(p));
      // Le profil est celui de l'entrée qui le porte : c'est là que sont ses bornes.
      const name = p.name ?? slot?.name;
      if (slot && name && !acc.composition.has(name)) acc.composition.set(name, { min: slot.min, max: slot.max });
    }
    else if (/Weapons/i.test(t)) {
      const w = toWeapon(p);
      if (w && w.name) {
        acc.weapons.push(w);
        if (preferred) {
          const k = weaponKey(w);
          const perSlot = acc.defaults.get(k) ?? acc.defaults.set(k, new Map()).get(k)!;
          const count = cap === Infinity ? 1 : cap;
          perSlot.set(slotId, Math.max(perSlot.get(slotId) ?? 0, count));
        }
      }
    } else if (t === 'Abilities' && own) {
      const c = chars(p);
      if (p.name) acc.abilities.push({ name: p.name, text: c.Description ?? '' });
    }
  }

  for (const cl of node.categoryLinks ?? []) if (cl.name) acc.keywords.add(cl.name);

  for (const link of node.infoLinks ?? []) {
    const target = link.targetId ? byId.get(link.targetId) : undefined;
    if (!target) continue;
    const key = visitKey('i', link.targetId, slotId, preferred);
    if (seen.has(key)) continue;
    seen.add(key);
    // La cible est soit un profil isolé, soit un groupe (infoGroup) qui en contient.
    if (target.typeName && target.characteristics)
      collect({ profiles: [target] }, byId, acc, seen, depth + 1, own, preferred, cap, pending, slotId, namedDefault);
    else collect(target, byId, acc, seen, depth + 1, own, preferred, cap, pending, slotId, namedDefault);
  }

  /*
   * Un groupe qui désigne un défaut ne laisse ce statut qu'à l'option désignée :
   * ses sœurs sont des alternatives. Sans défaut désigné, on suit tout — c'est le
   * cas des dotations obligatoires, où le groupe n'est qu'un rangement.
   */
  const keeps = (child: BsNode, group: BsNode) =>
    preferred && (!group.defaultSelectionEntryId || group.defaultSelectionEntryId === child.id);

  for (const child of node.selectionEntries ?? [])
    collect(child, byId, acc, seen, depth + 1, own, keeps(child, node), cap, pending, slotId, Boolean(node.defaultSelectionEntryId));
  for (const grp of node.selectionEntryGroups ?? [])
    // Un groupe qui dit combien il tient annonce le plafond de ses figurines.
    collect(grp, byId, acc, seen, depth + 1, own, keeps(grp, node), cap, boundsOf(grp) ?? pending, slotId, Boolean(node.defaultSelectionEntryId));
  for (const g of node.infoGroups ?? []) collect(g, byId, acc, seen, depth + 1, own, preferred, cap, pending, slotId, namedDefault);

  for (const link of node.entryLinks ?? []) {
    if (!link.targetId) continue;
    const key = visitKey('e', link.targetId, slotId, preferred);
    if (seen.has(key)) continue;
    seen.add(key);
    const target = byId.get(link.targetId);
    // Un lien vers un groupe partagé sort de la datasheet : on garde les armes, pas les aptitudes.
    if (target)
      collect(
        target,
        byId,
        acc,
        seen,
        depth + 1,
        own && link.type !== 'selectionEntryGroup',
        // Un lien nommé par le défaut du groupe parent reste dans la dotation.
        preferred && (!node.defaultSelectionEntryId || node.defaultSelectionEntryId === link.id),
        cap,
        // Le lien porte le nombre d'exemplaires : « max 1 » pour le sergent.
        boundsOf(link) ?? pending,
        slotId,
        Boolean(node.defaultSelectionEntryId),
      );
  }
}

function pointsOf(node: BsNode): number {
  const c = (node.costs ?? []).find((x) => x.name === 'pts');
  return c?.value ?? 0;
}

/** Somme des nombres écrits dans un libellé : « 1 Sergeant and 9 Troopers » -> 10. */
const sizeFromLabel = (s: string) => [...s.matchAll(/\b(\d+)\s+[a-z]/gi)].reduce((t, m) => t + Number(m[1]), 0);

/**
 * Effectifs mini et maxi de l'unité. Deux conventions coexistent dans BSData :
 * soit des contraintes min/max sur le groupe de troupe plus un groupe de
 * champion sans contrainte (« Boss Nob », « Kaptin »), soit un groupe « Unit
 * Composition » dont les options portent l'effectif dans leur nom.
 */
function unitSizes(node: BsNode): { min: number; max: number } {
  const groups = node.selectionEntryGroups ?? [];

  const composition = groups.find((g) => /unit composition/i.test(g.name ?? ''));
  const options = composition?.selectionEntries ?? [];
  if (options.length) {
    const sizes = options.map((o) => sizeFromLabel(o.name ?? '')).filter((n) => n > 0);
    if (sizes.length) return { min: Math.min(...sizes), max: Math.max(...sizes) };
  }

  let min = 0;
  let max = 0;
  for (const grp of groups) {
    const cons = grp.constraints ?? [];
    const gMin = cons.find((c) => c.type === 'min' && c.field === 'selections')?.value ?? 0;
    const gMax = cons.find((c) => c.type === 'max' && c.field === 'selections')?.value ?? 0;
    const modelEntries = (grp.selectionEntries ?? []).filter((s) => s.type === 'model');
    if (gMin > 0 || gMax > 0) {
      min += gMin;
      max += gMax || gMin;
    } else if (modelEntries.length === 1 && boundsOf(modelEntries[0])) {
      /*
       * Un groupe sans borne propre dont l'unique figurine porte les siennes :
       * les Boyz de la 11e écrivent « 1-2 Nobz » ainsi, et compter une seule
       * figurine faisait plafonner le pack à 19 quand le MFM le tarife à 20.
       */
      const b = boundsOf(modelEntries[0])!;
      min += Math.max(1, b.min);
      max += b.max ?? Math.max(1, b.min);
    } else if (modelEntries.length) {
      // Champion obligatoire : une figurine de plus, quelle que soit la taille.
      min += 1;
      max += 1;
    }
  }
  return { min: min || 1, max: Math.max(max, min) || 1 };
}

/**
 * Paliers de coût selon l'effectif. BSData les encode en modificateurs
 * « set pts = N si selections > M » sur l'entrée de l'unité.
 */
function costBracketsOf(node: BsNode, ptsTypeId: string | undefined): { overModels: number; points: number }[] {
  if (!ptsTypeId) return [];
  const out: { overModels: number; points: number }[] = [];
  for (const mod of node.modifiers ?? []) {
    if (mod.type !== 'set' || mod.field !== ptsTypeId || typeof mod.value !== 'number') continue;
    // Deux écritures du seuil selon la datasheet : « > N » chez les Boyz,
    // « >= N » chez les Meganobz. N'en lire qu'une laissait des unités à leur
    // coût de base quelle que soit leur taille.
    const cond = (mod.conditions ?? []).find(
      (c) => (c.type === 'greaterThan' || c.type === 'atLeast') && c.field === 'selections',
    );
    if (!cond) continue;
    out.push({ overModels: cond.type === 'atLeast' ? cond.value - 1 : cond.value, points: mod.value });
  }
  return out.sort((a, b) => a.overModels - b.overModels);
}

// ------------------------------------------------------- Choix d'équipement

/**
 * Le budget d'un groupe d'options : combien de ses enfants peuvent être retenus.
 *
 * C'est la seule chose que BSData écrive vraiment. L'exclusivité n'est pas
 * déclarée — elle se déduit d'un budget de 1. On garde l'identifiant de la
 * contrainte de plafond, parce que ce sont les modificateurs qui la visent quand
 * le budget dépend de l'effectif.
 */
function budgetOf(grp: BsNode): { min: number; max: number; maxId?: string } | null {
  const of = (type: string) =>
    (grp.constraints ?? []).find(
      (x) => x.type === type && (x.field === 'selections' || x.field === undefined) && x.scope === 'parent',
    );
  const max = of('max');
  if (!max || max.value <= 0) return null;
  return { min: of('min')?.value ?? 0, max: max.value, maxId: max.id };
}

/**
 * Paliers de budget : « une arme spéciale, deux à partir de vingt figurines ».
 *
 * Même encodage que les paliers de coût — un modificateur conditionné à
 * l'effectif — mais visant la contrainte plutôt que le prix, et le plus souvent
 * en `increment` là où le coût se pose en `set`.
 */
function pickBracketsOf(grp: BsNode, base: number, maxId: string | undefined) {
  if (!maxId) return [];
  const out: { atModels: number; maxPicks: number }[] = [];
  for (const mod of grp.modifiers ?? []) {
    if (mod.field !== maxId || typeof mod.value !== 'number') continue;
    if (mod.type !== 'increment' && mod.type !== 'set') continue;
    const cond = (mod.conditions ?? []).find(
      (c) => (c.type === 'atLeast' || c.type === 'greaterThan') && c.field === 'selections',
    );
    if (!cond) continue;
    out.push({
      atModels: cond.type === 'greaterThan' ? cond.value + 1 : cond.value,
      maxPicks: mod.type === 'set' ? mod.value : base + mod.value,
    });
  }
  return out.sort((a, b) => a.atModels - b.atModels);
}

/** Toutes les armes d'une branche, et le plafond de porteurs qu'elle annonce. */
function branchOf(
  node: BsNode,
  byId: Map<string, BsNode>,
  seen: Set<string>,
  depth: number,
  pending: Bounds | null,
  cap: number,
  into: Set<string>,
): number {
  if (depth > MAX_DEPTH) return cap;

  if (node.type === 'model') {
    const bounds = boundsOf(node) ?? pending;
    const here = bounds?.max ?? Infinity;
    if (here !== Infinity) cap = Math.min(cap, here);
  }

  for (const p of node.profiles ?? []) {
    if (!/Weapons/i.test(p.typeName ?? '')) continue;
    const w = toWeapon(p);
    if (w?.name) into.add(weaponRef(w));
  }

  for (const child of node.selectionEntries ?? []) cap = branchOf(child, byId, seen, depth + 1, pending, cap, into);
  for (const grp of node.selectionEntryGroups ?? [])
    cap = branchOf(grp, byId, seen, depth + 1, boundsOf(grp) ?? pending, cap, into);
  for (const link of node.entryLinks ?? []) {
    if (!link.targetId) continue;
    const k = `${link.id}|${link.targetId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const target = byId.get(link.targetId);
    if (target) cap = branchOf(target, byId, seen, depth + 1, boundsOf(link) ?? pending, cap, into);
  }
  return cap;
}

/**
 * Les choix d'équipement de la datasheet, tels que BSData les structure.
 *
 * Chaque `selectionEntryGroup` qui déclare un plafond de sélections est un choix :
 * ses enfants — entrées ou liens — en sont les options. Le Boss Nob d'un pack de
 * Boyz porte ainsi le groupe « Big Choppa » (budget 1), qui propose le big choppa
 * par défaut, la power klaw et deux combinaisons ; et c'est le Nob seul qui les
 * porte, pas les vingt figurines du pack.
 *
 * Ce parcours double celui de `collect()` au lieu de s'y greffer. `collect()`
 * déduplique par cible visitée, ce qui convient à la dotation par défaut mais
 * ferait perdre à une option l'arme qu'elle partage avec sa voisine — les quatre
 * options du groupe « Big Choppa » désignent trois fois le même big choppa.
 */
function optionGroupsOf(root: BsNode, byId: Map<string, BsNode>): OptionGroup[] {
  const out: OptionGroup[] = [];

  /** Rend l'identifiant du groupe émis, pour que ses descendants sachent d'où ils viennent. */
  const build = (grp: BsNode, slot: string, cap: number, pending: Bounds | null, tree: string, parent: string) => {
    const budget = budgetOf(grp);
    if (!budget || !grp.id) return undefined;

    const options: WeaponOption[] = [];
    /*
     * Un emplacement se reconnaît à ses options : des figurines qu'on ajoute au
     * pack, et non des façons d'équiper une figurine déjà comptée. C'est la seule
     * marque que BSData en donne, et elle décide si le budget du groupe est un
     * nombre de porteurs ou un simple « une option à la fois ».
     */
    let models = 0;
    let total = 0;
    const add = (id: string | undefined, name: string, node: BsNode, bounds: Bounds | null) => {
      if (!id) return;
      const weapons = new Set<string>();
      const own = branchOf(node, byId, new Set(), 0, bounds ?? pending, cap, weapons);
      if (weapons.size === 0) return;
      total += 1;
      if (node.type === 'model') models += 1;
      options.push({
        id,
        name: name.trim(),
        weapons: [...weapons],
        maxCarriers: own === Infinity ? 0 : own,
        isDefault: grp.defaultSelectionEntryId === id,
      });
    };

    for (const e of grp.selectionEntries ?? []) add(e.id, e.name ?? '', e, boundsOf(e));
    for (const l of grp.entryLinks ?? []) {
      const target = l.targetId ? byId.get(l.targetId) : undefined;
      if (target) add(l.id, l.name ?? target.name ?? '', target, boundsOf(l));
    }

    /*
     * Un choix à une seule branche n'en est pas un ; un groupe sans arme non plus.
     * Sauf l'emplacement qui héberge des choix imbriqués : les « 9-18 Boyz » de la
     * 11e n'ont qu'une configuration, mais leurs armes spéciales puisent dans
     * leurs figurines, et sans ce parent le pack de vingt en alignait vingt-deux.
     */
    const hostsNested = models > 0 && models === total && (grp.selectionEntryGroups ?? []).length > 0;
    if (options.length < (hostsNested ? 1 : 2)) return undefined;
    out.push({
      id: grp.id,
      name: (grp.name ?? '').trim(),
      tree: tree || grp.id,
      parent,
      slot,
      pool: models > 0 && models === total,
      minPicks: budget.min,
      maxPicks: budget.max,
      pickBrackets: pickBracketsOf(grp, budget.max, budget.maxId),
      options,
    });
    return grp.id;
  };

  const walk = (
    node: BsNode,
    seen: Set<string>,
    depth: number,
    pending: Bounds | null,
    slot: string,
    cap: number,
    tree: string,
    parent: string,
  ) => {
    if (depth > MAX_DEPTH) return;

    if (node.type === 'model') {
      const bounds = boundsOf(node) ?? pending;
      const here = bounds?.max ?? Infinity;
      if (here !== Infinity) cap = Math.min(cap, here);
      if (node.name) slot = node.name;
    }

    for (const child of node.selectionEntries ?? []) walk(child, seen, depth + 1, pending, slot, cap, tree, parent);
    for (const grp of node.selectionEntryGroups ?? []) {
      const bounds = boundsOf(grp) ?? pending;
      const made = build(grp, slot, cap, bounds, tree, parent);
      walk(grp, seen, depth + 1, bounds, slot, cap, tree || (grp.id ?? ''), made ?? parent);
    }
    for (const link of node.entryLinks ?? []) {
      if (!link.targetId) continue;
      /*
       * Les groupes partagés liés depuis la racine — Croisade, Enhancements,
       * reliques de détachement — ne sont pas l'équipement de la datasheet. Les
       * suivre ferait du choix d'une amélioration un choix d'arme.
       */
      if (link.type === 'selectionEntryGroup' && depth === 0) continue;
      const k = `${link.targetId}|${slot}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const target = byId.get(link.targetId);
      if (target) walk(target, seen, depth + 1, boundsOf(link) ?? pending, slot, cap, tree, parent);
    }
  };

  walk(root, new Set(), 0, null, '', Infinity, '', '');
  return out;
}

/**
 * Plafond de porteurs par arme, tiré des choix d'équipement.
 *
 * Deux règles, parce que BSData décrit deux situations différentes avec la même
 * structure. **Dans un arbre de choix**, les options sont des façons d'équiper la
 * même figurine : on prend la plus large, les quatre options du groupe « Big
 * Choppa » ne font pas quatre porteurs. **Entre arbres**, ce sont des
 * emplacements distincts et ils s'additionnent : la slugga d'un pack de Boyz est
 * portée par les dix-neuf Boyz *et* par le Boss Nob, soit vingt.
 *
 * Le plancher de la dotation par défaut ferme les cas que ce raisonnement rate.
 * Les Gretchin décrivent leur composition en deux options qui bornent les seuls
 * Runtherds ; leur grot blasta y hériterait d'un plafond de 2 alors que le pack
 * en sort dix. Un plafond ne doit jamais contredire ce que la datasheet équipe
 * elle-même.
 */
function carrierLimits(groups: OptionGroup[], defaults: Map<string, number>): Map<string, number> {
  /** Par arme, le plus grand plafond rencontré dans chaque arbre. */
  const perTree = new Map<string, Map<string, number>>();
  for (const g of groups)
    for (const o of g.options) {
      if (o.maxCarriers <= 0) continue;
      for (const ref of o.weapons) {
        const byTree = perTree.get(ref) ?? perTree.set(ref, new Map()).get(ref)!;
        byTree.set(g.tree, Math.max(byTree.get(g.tree) ?? 0, o.maxCarriers));
      }
    }

  const limits = new Map<string, number>();
  for (const [ref, byTree] of perTree) {
    const total = [...byTree.values()].reduce((n, v) => n + v, 0);
    limits.set(ref, Math.max(total, defaults.get(ref) ?? 0));
  }
  return limits;
}

/** Extrait les datasheets d'un ensemble de catalogues déjà chargés. */
/**
 * @param catalogues tous les fichiers nécessaires à la résolution des liens.
 * @param datasheetIds identifiants des entrées à retenir comme datasheets. Sans
 *   lui, toute entrée de type unité devient une datasheet — ce qui fait dire à un
 *   joueur Drukhari qu'il peut aligner des Wraithlords, puisque les deux factions
 *   partagent la bibliothèque Aeldari. Les vraies datasheets d'un catalogue sont
 *   celles que ses `entryLinks` racine désignent ; le reste n'est que définition.
 */
export function flattenCatalogues(catalogues: BsCatalogue[], datasheetIds?: Set<string>): CatalogueUnit[] {
  const byId = buildIdIndex(catalogues);
  const out: CatalogueUnit[] = [];
  const seenNames = new Set<string>();

  for (const cat of catalogues) {
    const roots = [...(cat.sharedSelectionEntries ?? []), ...(cat.selectionEntries ?? [])];
    for (const root of roots) {
      if (root.type !== 'unit' && root.type !== 'model') continue;
      if (root.hidden) continue;
      if (datasheetIds && !(root.id && datasheetIds.has(root.id))) continue;
      const name = (root.name ?? '').trim();
      if (!name) continue;

      const acc: Collected = {
        models: [], weapons: [], abilities: [], keywords: new Set(),
        defaults: new Map(), composition: new Map(), slots: new Map(),
      };
      collect(root, byId, acc, new Set([visitKey('e', root.id, '', true)]), 0);
      if (acc.models.length === 0) continue;

      const dedupKey = `${name}|${cat.name}`;
      if (seenNames.has(dedupKey)) continue;
      seenNames.add(dedupKey);

      /*
       * L'effectif auquel la dotation se rapporte. La somme des emplacements
       * retenus déborde parfois du pack — les Intercessors décrivent un sergent,
       * neuf troupiers et jusqu'à deux porteurs de lance-grenades, soit douze
       * pour un pack de dix — parce que certains emplacements sont des variantes
       * et non des ajouts. On plafonne donc au pack.
       */
      const sizes = unitSizes(root);
      const defaultModels = Math.min(sizes.max, [...acc.slots.values()].reduce((n, v) => n + v, 0) || sizes.max);

      const optionGroups = optionGroupsOf(root, byId);
      const wSeen = new Set<string>();
      const kept = acc.weapons.filter((w) => {
        const k = weaponKey(w);
        if (wSeen.has(k)) return false;
        wSeen.add(k);
        return true;
      });
      /*
       * Ce que la datasheet équipe d'elle-même, ramené au pack plein : le
       * plancher de tout plafond. Les plafonds sont absolus, la dotation ne l'est
       * pas — elle décrit la composition de référence, cinq figurines chez les
       * Lootas quand le pack s'en joue dix. Comparer les deux sans remettre la
       * seconde à l'échelle bloquait un pack de dix Lootas à quatre deffguns.
       */
      const defaultCounts = new Map<string, number>();
      for (const w of kept) {
        const perSlot = acc.defaults.get(weaponKey(w));
        if (!perSlot) continue;
        const ref = weaponRef(w);
        const here = Math.min(defaultModels, carriers(perSlot));
        const full =
          defaultModels > 0 && defaultModels < sizes.max
            ? Math.min(sizes.max, Math.round((here * sizes.max) / defaultModels))
            : here;
        defaultCounts.set(ref, Math.max(defaultCounts.get(ref) ?? 0, full));
      }
      const limits = carrierLimits(optionGroups, defaultCounts);
      const weapons = kept.map((w) => {
        const cap = limits.get(weaponRef(w));
        return cap ? { ...w, maxCarriers: cap } : w;
      });
      const keptRefs = new Set(weapons.map(weaponRef));
      const mSeen = new Set<string>();
      const models = acc.models.filter((m) => {
        const k = `${m.name}|${m.T}|${m.Sv}|${m.W}|${m.Inv}`;
        if (mSeen.has(k)) return false;
        mSeen.add(k);
        return true;
      });
      const aSeen = new Set<string>();
      const abilities = acc.abilities.filter((a) => {
        if (aSeen.has(a.name)) return false;
        aSeen.add(a.name);
        return true;
      });

      const ptsTypeId = (root.costs ?? []).find((c) => c.name === 'pts')?.typeId;
      const costBrackets = costBracketsOf(root, ptsTypeId);
      const parsedAbilities = parseAbilities(abilities);
      const targetsOf = (kind: 'leader' | 'support') =>
        parsedAbilities.filter((a) => a.attachKind === kind).flatMap((a) => a.attachTargets);

      /**
       * Deux écritures coexistent pour la même notion. Les Space Marines donnent
       * au personnage une aptitude « Support » portant sa propre liste de
       * cibles. Les Orks lui donnent le mot-clé de catégorie « Support » et
       * laissent la liste dans son aptitude « Leader » : c'est alors un soutien
       * qui rejoint ces unités-là, pas un chef.
       */
      const supportKeyword = acc.keywords.has('Support');
      const fromLeader = targetsOf('leader');
      const leaderTargets = supportKeyword ? [] : fromLeader;
      const supportTargets = [...targetsOf('support'), ...(supportKeyword ? fromLeader : [])];

      out.push({
        id: root.id ?? `${cat.name}:${name}`,
        name,
        source: cat.name ?? '?',
        points: pointsOf(root),
        models,
        weapons,
        keywords: [...acc.keywords],
        abilities,
        parsedAbilities,
        leaderTargets,
        supportTargets,
        isAttachable: leaderTargets.length + supportTargets.length > 0,
        isLegends: /\[(legends|crucible)\]/i.test(name),
        minModels: sizes.min,
        maxModels: sizes.max,
        costBrackets,
        // La dotation ne retient que les armes réellement conservées après
        // déduplication : un défaut pointant vers une variante écartée n'aurait
        // rien à équiper.
        composition: models
          .filter((m) => acc.composition.has(m.name))
          .map((m) => ({ name: m.name, ...acc.composition.get(m.name)! })),
        // On ne garde que les choix dont les armes ont survécu à la déduplication —
        // et l'emplacement à une configuration dont d'autres choix puisent les figurines.
        optionGroups: optionGroups
          .map((g) => ({ ...g, options: g.options.filter((o) => o.weapons.some((r) => keptRefs.has(r))) }))
          .filter((g, _i, all) => g.options.length >= 2 || (g.pool && g.options.length === 1 && all.some((c) => c.parent === g.id))),
        defaultLoadout: weapons
          .filter((w) => acc.defaults.has(weaponKey(w)))
          .map((w) => ({
            weapon: w.name,
            kind: w.kind,
            count: Math.min(defaultModels, carriers(acc.defaults.get(weaponKey(w))!)),
          })),
        /*
         * Effectif auquel les compteurs ci-dessus se rapportent. Il n'est pas
         * toujours `maxModels` : BSData décrit la dotation de la composition
         * marquée par défaut — 1 sergent et 9 troupiers — même quand le pack se
         * joue aussi à 20. Sans ce repère, on ne saurait pas si « 9 lasguns »
         * veut dire « neuf sur dix » ou « neuf sur vingt ».
         */
        defaultModels,
      });
    }
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}
