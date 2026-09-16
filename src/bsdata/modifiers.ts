/**
 * Les modificateurs de combat que l'analyse d'une aptitude sait reconnaître.
 *
 * C'est une forme de travail, interne à l'outil : elle ne sort jamais telle
 * quelle dans le Dataset, où une aptitude n'est portée que par des Effects au
 * format 40kdc-data (voir `analysis/effects.ts`).
 */
export interface SimModifiers {
  hitModifier: number;
  woundModifier: number;
  rerollHits: 'none' | 'ones' | 'all';
  rerollWounds: 'none' | 'ones' | 'all';
  critHit: number;
  critWound: number;
  sustainedBonus: number;
  grantLethal: boolean;
  grantDevastating: boolean;
  grantTwinLinked: boolean;
  grantIgnoresCover: boolean;
  bonusS: number;
  bonusAP: number;
  bonusD: number;
  extraAttacks: number;
}
