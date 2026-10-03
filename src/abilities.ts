/**
 * Les aptitudes d'une Unit telles que le Dataset les publie : leur nom seul.
 * Ce qu'elles font vient des Contributions, en Modifiers (ADR 0011).
 */
import type { UnitAbility } from '@paintplanplay/dataset-schema';
import type { CatalogueUnit } from './bsdata/types.ts';

export const unitAbilities = (u: CatalogueUnit): UnitAbility[] => u.abilities.map((a) => ({ name: a.name }));
