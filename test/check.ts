/**
 * Convention des tests : des entrées littérales ou des fichiers de test, une
 * ligne ✔/✘ par contrôle, et un process en échec dès qu'un contrôle l'est.
 */
import { fileURLToPath } from 'node:url';
import { readAuthored, type AuthoredCore, type AuthoredEffect } from '../src/authored.ts';

let failures = 0;

export function check(label: string, ok: boolean, detail = ''): void {
  console.log(`  ${ok ? '✔' : '✘ ÉCART'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) {
    failures++;
    process.exitCode = 1;
  }
}

export const failed = () => failures;

export const section = (title: string) => console.log(`\n### ${title}`);

export const fixture = (...parts: string[]) =>
  fileURLToPath(new URL(['fixtures', ...parts].join('/'), import.meta.url));

/**
 * Ce que le Dataset de test écrit lui-même : la Detachment Rule, les
 * Stratagems et les restrictions d'Enhancement des Orks, le Stratagem Core —
 * plus aucune source ne les donne. `effects` s'y ajoute.
 */
export function fixtureAuthored(effects: AuthoredEffect[] = []): AuthoredCore {
  const base = readAuthored(fixture('dataset'), 'wh40k-11e')!;
  // Une entrée du test sur un élément que le Dataset de test décrit déjà s'y ajoute : un élément n'a qu'une Contribution.
  const merged = new Map((base.effects ?? []).map((e) => [e.target, e]));
  for (const e of effects) merged.set(e.target, { ...merged.get(e.target), ...e });
  return { ...base, effects: [...merged.values()] };
}
