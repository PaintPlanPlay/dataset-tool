/**
 * Quelle fiche affiche un élément : une Correction ou une Contribution vise un
 * élément (une Weapon, une Enhancement), la fiche est l'entité qui le porte
 * (l'Unit, le Detachment).
 */
import { parseTarget } from '../corrections/apply.ts';

const UNIT_ENTITIES = new Set(['unit', 'model', 'weapon', 'ability', 'attachment']);

export function sheetOfTarget(target: string): string {
  const { root, entity, name } = parseTarget(target);
  if (UNIT_ENTITIES.has(entity)) return root;
  if (entity === 'detachment' || entity === 'enhancement' || entity === 'rule') return `${root}::detachment:${name.split('|')[0]}`;
  return target;
}
