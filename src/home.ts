/**
 * L'Army d'origine d'un élément que plusieurs Armies publient : un Detachment
 * que les Chapitres reprennent du Codex Space Marines, une Unit alliée, une
 * Army Rule commune. Ce qu'on écrit sur lui l'est une seule fois, sous cette
 * Army, et vaut partout où il apparaît.
 *
 * L'Army d'origine est celle qui le publie et possède le plus de datasheets en
 * propre : le Codex parent plutôt que ses Chapitres. Une Unit, elle, appartient
 * d'abord aux Armies où elle n'est pas alliée.
 */
import type { ArmyFile } from '@paintplanplay/dataset-schema';
import { CORE_ROOT, parseTarget } from './corrections/apply.ts';

/** Les entités d'une adresse dont la racine est une Unit. */
const UNIT_ENTITIES = new Set(['unit', 'model', 'weapon', 'ability', 'attachment', 'option']);

export interface Homes {
  /** L'Army d'origine de l'élément visé, `core` pour un Stratagem Core ; `undefined` s'il est introuvable. */
  homeOf(target: string): string | undefined;
  /** L'adresse sous l'Army d'origine ; inchangée pour une Unit, ou un élément introuvable. */
  canonical(target: string): string;
  /** Les Armies qui publient l'élément visé, l'Army d'origine en tête ; vide s'il est introuvable. */
  holders(target: string): string[];
}

export function homes(files: Map<string, unknown>): Homes {
  const armies = [...files].filter(([p]) => p.includes('/armies/')).map(([, f]) => f as ArmyFile);
  const own = new Map(armies.map((a) => [a.id, a.units.filter((u) => !u.ally).length]));
  const rank = (a: string, b: string) => own.get(b)! - own.get(a)! || a.localeCompare(b);

  const index = new Map<string, Set<string>>();
  const allied = new Map<string, Set<string>>();
  const hold = (key: string, army: string, map = index) => (map.get(key) ?? map.set(key, new Set()).get(key)!).add(army);
  const stratagemDetachment = new Map<string, string | null>();
  for (const a of armies) {
    for (const u of a.units) hold(`unit:${u.id}`, a.id, u.ally ? allied : index);
    for (const d of a.detachments) {
      hold(`detachment:${d.id}`, a.id);
      for (const r of d.rules) hold(`rule:${d.id}|${r.id}`, a.id);
      for (const e of d.enhancements) hold(`enhancement:${d.id}|${e.id}`, a.id);
    }
    for (const s of a.stratagems) {
      hold(`stratagem:${s.detachmentId}|${s.id}`, a.id);
      stratagemDetachment.set(`${a.id}|${s.id}`, s.detachmentId);
    }
    for (const r of a.armyRules ?? []) hold(`armyrule:${r.id}`, a.id);
  }

  /** La clé d'index de l'élément visé, `undefined` quand sa racine ne le publie pas. */
  const keyOf = (target: string): string | undefined => {
    const { root, entity, name } = parseTarget(target);
    if (UNIT_ENTITIES.has(entity)) return `unit:${root}`;
    if (entity === 'stratagem') {
      const det = stratagemDetachment.get(`${root}|${name}`);
      return det === undefined ? undefined : `stratagem:${det}|${name}`;
    }
    const key = `${entity}:${name}`;
    if (index.get(key)?.has(root)) return key;
    // Une Detachment Rule qu'une Contribution crée suit son Detachment.
    const detachment = `detachment:${name.split('|')[0]}`;
    return entity === 'rule' && index.get(detachment)?.has(root) ? detachment : undefined;
  };

  const holders = (target: string): string[] => {
    const { root, entity } = parseTarget(target);
    if (root === CORE_ROOT) return [CORE_ROOT];
    const key = keyOf(target);
    if (!key) return [];
    const mine = [...(index.get(key) ?? [])].sort(rank);
    // Une Unit que toutes ses Armies alignent en alliée appartient quand même à l'une d'elles.
    return UNIT_ENTITIES.has(entity) ? [...mine, ...[...(allied.get(key) ?? [])].sort(rank)] : mine;
  };

  return {
    holders,
    homeOf: (target) => holders(target)[0],
    canonical(target) {
      const { root, entity } = parseTarget(target);
      if (root === CORE_ROOT || UNIT_ENTITIES.has(entity)) return target;
      const home = holders(target)[0];
      return home ? `${home}${target.slice(root.length)}` : target;
    },
  };
}
