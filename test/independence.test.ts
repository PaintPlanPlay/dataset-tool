/**
 * Le Dataset Tool ne partage aucun code avec l'application : aucune source ne
 * doit importer quoi que ce soit hors de ce paquet (issue #56, ADR 0005).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, section } from './check.ts';

const root = fileURLToPath(new URL('..', import.meta.url));

const sources: string[] = [];
const walk = (dir: string) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'fixtures' || entry.name.startsWith('.')) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walk(abs);
    else if (/\.(ts|mts|js|mjs)$/.test(entry.name)) sources.push(abs);
  }
};
walk(root);

const escapes: string[] = [];
for (const file of sources) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    if (!spec.startsWith('.')) continue;
    const target = resolve(dirname(file), spec);
    if (relative(root, target).startsWith('..')) escapes.push(`${relative(root, file)} → ${spec}`);
  }
}

section('Paquet autonome');
check(`aucun import hors du paquet (${sources.length} fichiers lus)`, escapes.length === 0, escapes.join(' ; '));
