/**
 * Lire le journal d'une tâche : ce qui l'a fait échouer, et des lignes qu'on
 * peut parcourir.
 *
 * Un build écrit des lignes de plusieurs milliers de caractères (la liste des
 * Units introuvables, par exemple) : la raison de l'échec, une ligne `✘` à la
 * toute fin, s'y noyait, et la notification ne citait que `— failed (exit code 1)`.
 */

/** Au-delà, une ligne se replie : son début reste lisible, le reste se déplie. */
export const FOLD_AT = 240;

/** Ce que le script et le lanceur ajoutent après coup : ni la cause, ni un résultat. */
const TRAILER = /^— (done|failed)\b|— read the lines above\.$/;

export const isError = (line: string) => line.startsWith('✘');

/**
 * Les raisons d'un échec : les lignes `✘`, sinon la dernière ligne qui n'est
 * pas une formule de fin — un plantage sans `✘` dit quand même quelque chose.
 */
export function failureReasons(lines: string[]): string[] {
  const errors = lines.filter(isError);
  if (errors.length) return errors;
  const last = lines.filter((l) => l.trim() && !TRAILER.test(l)).at(-1);
  return last ? [last] : [];
}

/** Une ligne du journal à afficher : repliée si elle est trop longue. */
export function foldLine(line: string): { head: string; rest: number } {
  return line.length <= FOLD_AT ? { head: line, rest: 0 } : { head: line.slice(0, FOLD_AT), rest: line.length - FOLD_AT };
}
