/**
 * Composition d'une armée à partir des catalogues BattleScribe.
 *
 * Rien ici ne connaît ni le réseau ni le navigateur : la lecture d'un catalogue
 * est injectée. C'est ce qui permet au même code de tourner dans l'onglet du
 * joueur (fetch + IndexedDB) et dans l'ingestion serveur (lecture du miroir sur
 * disque) — deux implémentations divergentes finiraient par produire deux
 * armées différentes pour le même dépôt.
 */
import { flattenCatalogues, type BsCatalogue } from './flatten.ts';
import type { CatalogueUnit } from './types.ts';

/** Lit un catalogue par son nom de fichier, sans l'extension .json. */
export type CatalogueReader = (file: string) => Promise<BsCatalogue>;

export interface ArmyData {
  /** Fichier principal choisi par l'utilisateur. */
  primary: string;
  /**
   * Nom interne du catalogue principal, qui n'est pas son nom de fichier :
   * « Imperium - Space Marines » se déclare « Imperium - Adeptus Astartes -
   * Space Marines ». C'est lui que portent les datasheets, donc lui qui dit si
   * une unité vient du codex ou d'ailleurs.
   */
  primaryName: string;
  /** Fichiers effectivement chargés. */
  loaded: string[];
  /** Catalogues alliés, jouables mais pas d'office : chargés à la demande. */
  available: string[];
  units: CatalogueUnit[];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const isLibrary = (name: string) => /library/i.test(name);

/** Les liens de catalogue portent un nom de fichier, mais pas toujours exactement. */
export function resolveLink(linkName: string, files: string[]): string | undefined {
  if (files.includes(linkName)) return linkName;
  const want = norm(linkName);
  const exact = files.find((f) => norm(f) === want);
  if (exact) return exact;
  const wantWords = want.split(' ');
  let best: { file: string; score: number } | undefined;
  for (const f of files) {
    const fw = norm(f).split(' ');
    const shared = wantWords.filter((w) => fw.includes(w)).length;
    const score = (2 * shared) / (wantWords.length + fw.length);
    if (!best || score > best.score) best = { file: f, score };
  }
  return best && best.score >= 0.7 ? best.file : undefined;
}

/**
 * Armées proposables au joueur : les bibliothèques sont tirées automatiquement
 * par les catalogues qui les référencent, et le système de jeu n'est pas une armée.
 */
export const playableArmies = (files: string[]) =>
  files.filter((f) => !isLibrary(f) && f !== 'Warhammer 40,000');

const FACTION = /^(Imperium|Chaos|Aeldari|Xenos)\s*-\s*/;

/** Nom lisible d'un fichier de catalogue : « Imperium - Black Templars » → « Black Templars ». */
export const armyLabel = (file: string) => file.replace(FACTION, '');

/** Grande faction, quand le nom de fichier la porte en préfixe. */
export const armyFaction = (file: string) => file.match(FACTION)?.[1] ?? '';

/**
 * Charge une armée : le fichier principal plus ses bibliothèques, où vit
 * l'essentiel des datasheets. Un fichier de sous-faction (Ultramarines, Black
 * Templars…) ne contient que ses entrées propres : on remonte alors vers les
 * catalogues liés jusqu'à obtenir une base exploitable. Le reste (alliés
 * volumineux comme les Agents de l'Imperium) attend une demande explicite.
 */
export async function composeArmy(
  primary: string,
  files: string[],
  extra: string[],
  read: CatalogueReader,
): Promise<ArmyData> {
  const loaded = new Set<string>();
  const cats: BsCatalogue[] = [];
  let primaryName = primary;
  const datasheetIds = new Set<string>();
  /** Quel catalogue a désigné chaque datasheet par ses liens racine. */
  const rootOf = new Map<string, string>();
  const allies = new Set<string>();

  /*
   * Trois armées (Chaos Daemons, Chaos Knights, Imperial Knights) n'ont aucune
   * datasheet dans leur propre fichier : tout vit dans une bibliothèque dédiée
   * qui porte leur nom (« Imperium - Imperial Knights - Library »). `rootOf` ne
   * valait alors jamais `primary` pour elles, et `composeArmy` les rendait
   * alliées à elles-mêmes. On répare en reconnaissant la bibliothèque qui
   * *porte le nom du codex qui la charge* — pas une bibliothèque quelconque :
   * la même « Imperial Knights - Library », chargée par les Space Marines,
   * doit rester étrangère. Le nom fait la différence entre les deux.
   */
  const ownLibraryOf = (file: string): string | undefined => {
    if (!isLibrary(file)) return undefined;
    const stem = norm(file.replace(/\s*-?\s*Library$/i, ''));
    return stem === norm(primary) ? primary : undefined;
  };

  /**
   * Charge un catalogue et note ses datasheets si elles nous reviennent.
   *
   * `importRootEntries` est le mot de BSData pour « et propose aussi ses
   * unités » : Black Templars → Space Marines l'a à vrai, le joueur a bien accès
   * au codex générique ; Drukhari → bibliothèque Aeldari l'a à faux, alors que
   * Craftworlds → même bibliothèque l'a à vrai. Une bibliothèque se charge
   * toujours — sans elle rien ne se résout — mais ne donne ses unités que si on
   * l'y autorise.
   */
  const add = async (file: string, takeRoots: boolean): Promise<void> => {
    if (loaded.has(file)) return;
    let cat: BsCatalogue;
    try {
      cat = await read(file);
    } catch {
      return; // un catalogue lié manquant ne doit pas bloquer le reste
    }
    loaded.add(file);
    cats.push(cat);
    if (file === primary) primaryName = cat.name ?? primary;

    if (takeRoots) {
      const owner = ownLibraryOf(file) ?? file;
      for (const l of cat.entryLinks ?? [])
        if (l.targetId) {
          datasheetIds.add(l.targetId);
          if (!rootOf.has(l.targetId)) rootOf.set(l.targetId, owner);
        }
    }

    for (const link of cat.catalogueLinks ?? []) {
      const target = resolveLink(link.name, files);
      if (!target) continue;
      // Un allié se choisit, il ne s'invite pas : on le signale sans le charger.
      if (!link.importRootEntries && !isLibrary(target)) {
        allies.add(target);
        continue;
      }
      await add(target, Boolean(link.importRootEntries));
    }
  };

  await add(primary, true);
  for (const e of extra) await add(e, true);

  /*
   * « Allié » se lit sur qui a désigné l'unité, pas sur qui la définit : les
   * datasheets Drukhari vivent dans la bibliothèque Aeldari mais sont bien du
   * codex Drukhari, tandis qu'un Space Marine générique proposé à un joueur
   * Black Templars vient d'ailleurs.
   */
  const units = flattenCatalogues(cats, datasheetIds).map((u) =>
    rootOf.get(u.id) === primary ? u : { ...u, ally: true },
  );

  return {
    primary,
    primaryName,
    loaded: [...loaded],
    available: [...allies].filter((a) => !loaded.has(a)),
    units,
  };
}
