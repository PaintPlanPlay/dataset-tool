/**
 * Ce qu'on n'a pas à taper : l'unité d'une caractéristique se déduit de la
 * caractéristique. Un Mouvement ou une portée sont en pouces (« 6 » → 6"), un
 * Leadership est un seuil (« 7 » → 7+). Ce qui ne ressemble pas à un nombre
 * nu — « 12"+D6 », « Melee », « - » — reste tel quel.
 *
 * Les mots-clés d'arme, eux, ne se touchent pas ici : BSData les écrit à sa
 * façon (« ONE SHOT »), et les récrire ferait passer chaque Weapon pour
 * corrigée. Seul celui qu'on ajoute prend sa forme juste, à l'enregistrement.
 */

const bare = (v: unknown): v is string => typeof v === 'string' && /^\s*\d+\s*$/.test(v);

export const inches = (v: string) => (bare(v) ? `${v.trim()}"` : v);
export const threshold = (v: string) => (bare(v) ? `${v.trim()}+` : v);

/** Une figurine : Mouvement en pouces, Leadership en seuil. */
export function normalizeModel<T extends { M?: unknown; LD?: unknown }>(m: T): T {
  return {
    ...m,
    ...(typeof m.M === 'string' ? { M: inches(m.M) } : {}),
    ...(typeof m.LD === 'string' ? { LD: threshold(m.LD) } : {}),
  };
}

/** Un Weapon Profile : portée en pouces. */
export function normalizeProfile<T extends { range?: unknown }>(p: T): T {
  return { ...p, ...(typeof p.range === 'string' ? { range: inches(p.range) } : {}) };
}
