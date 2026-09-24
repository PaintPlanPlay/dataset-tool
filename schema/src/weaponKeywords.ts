/**
 * Les mots-clés d'arme que les règles définissent : une liste close. Certains
 * portent une valeur (« Rapid Fire 2 », « Sustained Hits D3 »), Anti la sienne
 * et un Keyword (« Anti-Vehicle 4+ »).
 *
 * Les datasheets ont aussi des capacités d'arme propres (« Sonic Devastation »),
 * que BSData écrit et que le Dataset garde telles quelles ; mais ce qu'on ajoute
 * à la main vient de cette liste, sous sa forme juste.
 */

export type WeaponKeywordValue = 'number' | 'dice' | 'anti';

export interface WeaponKeywordRule {
  name: string;
  /** `number` : « Melta 2 » ; `dice` : un nombre ou D3/D6 (« Sustained Hits D3 ») ; `anti` : un Keyword et un seuil. */
  value?: WeaponKeywordValue;
}

export const WEAPON_KEYWORDS: WeaponKeywordRule[] = [
  { name: 'Anti', value: 'anti' },
  { name: 'Assault' },
  { name: 'Blast' },
  { name: 'Cleave', value: 'number' },
  { name: 'Close-quarters' },
  { name: 'Conversion' },
  { name: 'Devastating Wounds' },
  { name: 'Extra Attacks' },
  { name: 'Hazardous' },
  { name: 'Heavy' },
  { name: 'Ignores Cover' },
  { name: 'Indirect Fire' },
  { name: 'Lance' },
  { name: 'Lethal Hits' },
  { name: 'Melta', value: 'number' },
  { name: 'One Shot' },
  { name: 'Pistol' },
  { name: 'Precision' },
  { name: 'Psychic' },
  { name: 'Rapid Fire', value: 'dice' },
  { name: 'Sustained Hits', value: 'dice' },
  { name: 'Torrent' },
  { name: 'Twin-linked' },
];

/** Deux écritures du même nom se valent : casse, tiret ou espace. */
const key = (s: string) => s.toLowerCase().replace(/[\s-]+/g, '');

const titled = (s: string) => s.trim().replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());

/**
 * La forme juste d'un mot-clé d'arme des règles, quelle que soit la façon dont
 * on l'a tapé (« rapid fire 2 » → « Rapid Fire 2 », « anti vehicle 4 » →
 * « Anti-Vehicle 4+ ») ; `null` s'il n'en est pas un.
 */
export function canonicalWeaponKeyword(raw: string): string | null {
  const text = raw.trim();
  const anti = /^anti[\s-]+(.+?)\s+(\d)\+?$/i.exec(text);
  if (anti) return `Anti-${titled(anti[1])} ${anti[2]}+`;
  for (const rule of WEAPON_KEYWORDS) {
    if (rule.value === 'anti') continue;
    if (!rule.value) {
      if (key(text) === key(rule.name)) return rule.name;
      continue;
    }
    const m = /^(.*?)\s*(\d+|d3|d6|d3\+\d|d6\+\d)$/i.exec(text);
    if (!m || key(m[1]) !== key(rule.name)) continue;
    const value = m[2].toUpperCase();
    if (rule.value === 'number' && !/^\d+$/.test(value)) return null;
    return `${rule.name} ${value}`;
  }
  return null;
}
