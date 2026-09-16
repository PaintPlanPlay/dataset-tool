/** Tous les tests du Dataset Tool, dans l'ordre. */
import { failed } from './check.ts';

await import('./independence.test.ts');
await import('./build.test.ts');
await import('./check.test.ts');
await import('./corrections.test.ts');
await import('./detachments.test.ts');
await import('./stratagems.test.ts');
await import('./abilities.test.ts');
await import('./authored.test.ts');
await import('./release.test.ts');
await import('./workflows.test.ts');
await import('./gui.test.ts');

console.log(failed() ? `\n✘ ${failed()} contrôle(s) en échec` : '\n✔ tous les contrôles passent');
