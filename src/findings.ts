/**
 * Ce qu'une construction signale pour relecture, sans le trancher à la place
 * du mainteneur : désaccords entre sources, éléments absents d'une source,
 * Effects amont écartés.
 */

export type Authority = 'mfm' | 'bsdata';

/** Un désaccord entre deux Upstream Sources, tranché par la règle d'autorité. */
export interface SourceConflict {
  army: string;
  entity: 'unit' | 'detachment' | 'enhancement' | 'stratagem';
  id: string;
  name: string;
  field: string;
  /** La source qui fait autorité, dont la valeur est retenue. */
  authority: Authority;
  kept: string;
  /** La source écartée et sa valeur. */
  other: { source: Authority; value: string };
}

/**
 * Ce qui cloche entre une Weapon d'Enhancement et le Dataset. `orphan` : BSData
 * donne une Weapon à une Enhancement que le Dataset n'a pas (son Detachment
 * manque au MFM), elle n'est posée nulle part. `collision` : une datasheet
 * porte la Weapon d'une Enhancement de son Army, signe qu'un groupe partagé
 * l'y a amenée à tort.
 */
export interface EnhancementWeaponFinding {
  kind: 'orphan' | 'collision';
  /** Les Armies où elle se présente. */
  armies: string[];
  /** L'Enhancement, par son nom amont. */
  enhancement: string;
  weapon: string;
  /** Pour une collision : la datasheet qui la porte. */
  unit?: string;
}
