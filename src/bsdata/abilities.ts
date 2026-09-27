/**
 * Lecture des aptitudes de datasheet : seulement ce qui dit qui une Unit peut
 * rejoindre (« Leader », « Support »). Ce que font les aptitudes ne se lit
 * jamais dans leur texte : c'est le rôle des Modifiers (ADR 0011).
 */
import type { Ability } from './types.ts';

/**
 * Une unité peut recevoir un chef et un soutien : ce sont deux aptitudes
 * distinctes dans les datasheets, de forme identique.
 */
export type AttachKind = 'leader' | 'support';

export interface ParsedAbility {
  name: string;
  text: string;
  /** Renseigné pour les aptitudes « Leader » et « Support ». */
  attachKind: AttachKind | null;
  /** Unités rejoignables, telles qu'écrites dans le texte. */
  attachTargets: string[];
}

/**
 * Retire le balisage de BSData : gras markdown et marqueurs ^^…^^.
 *
 * Normalise aussi les espaces insécables, semés un peu partout dans le texte
 * source : « add 4 to the Attacks[U+00A0]characteristic » ne se reconnaissait
 * pas. Les retours à la ligne sont préservés, la liste des cibles de « Leader »
 * s'appuie dessus.
 */
export function cleanText(s: string): string {
  return s
    .replace(/\*\*/g, '')
    .replace(/\^\^/g, '')
    .replace(/<\/?ins>/g, '')
    .replace(/[‐-―−]/g, '-')
    .replace(/[^\S\r\n]+/g, ' ')
    .trim();
}

const BULLET_LINE = /^[-•▪■►*]\s*/;

/**
 * Unités citées par une aptitude « Leader » ou « Support ».
 *
 * Deux écritures coexistent dans BSData et il faut les deux : une liste à puces
 * (Orks, Black Templars) et une énumération en ligne après les deux-points
 * (Custodes, Astra Militarum). Ne gérer que les puces laissait des armées
 * entières sans aucun chef détecté.
 */
export function parseAttachTargets(raw: string): string[] {
  const text = cleanText(raw);
  const colon = text.search(/units?\s*:/i);
  if (colon < 0) return [];
  const after = text.slice(text.indexOf(':', colon) + 1);
  const lines = after
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const bulleted = lines.filter((l) => BULLET_LINE.test(l)).map((l) => l.replace(BULLET_LINE, '').trim());
  if (bulleted.length) return bulleted;

  // En ligne : on s'arrête à la fin de la phrase, le texte reprend souvent après
  // (« You can attach this model even if one CHARACTER is already leading it »).
  const inline = (lines[0] ?? '').split(/\.(?:\s|$)/)[0];
  return inline
    .split(/\s*,\s*|\s+and\s+/i)
    .map((s) => s.replace(/[.;]+$/, '').trim())
    .filter((s) => s.length > 1);
}

export function parseAbility(a: Ability): ParsedAbility {
  const name = a.name.trim();
  const attachKind: AttachKind | null = /^leader$/i.test(name)
    ? 'leader'
    : /^support$/i.test(name)
      ? 'support'
      : null;
  return {
    name: a.name,
    text: cleanText(a.text),
    attachKind,
    attachTargets: attachKind ? parseAttachTargets(a.text) : [],
  };
}

export const parseAbilities = (list: Ability[]): ParsedAbility[] => list.map(parseAbility);
