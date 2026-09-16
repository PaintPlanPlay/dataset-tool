/**
 * Convention des tests : des entrées littérales ou des fichiers de test, une
 * ligne ✔/✘ par contrôle, et un process en échec dès qu'un contrôle l'est.
 */
import { fileURLToPath } from 'node:url';

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
