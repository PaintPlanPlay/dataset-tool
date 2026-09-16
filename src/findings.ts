/**
 * Ce qu'une construction signale pour relecture, sans le trancher à la place
 * du mainteneur : désaccords entre sources, éléments absents d'une source,
 * Effects amont écartés.
 */

export type Authority = 'mfm' | 'bsdata' | '40kdc';

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
 * Un élément qu'une source publie et que l'autre ignore. Publié quand la
 * source manquante n'est pas celle qui en décide l'existence, écarté sinon.
 */
export interface MissingEntity {
  army: string;
  entity: 'detachment' | 'enhancement' | 'stratagem';
  name: string;
  /** La source qui ne le connaît pas. */
  missingIn: Authority;
  /** true s'il figure quand même dans le Dataset. */
  published: boolean;
}

/** Un Effect amont écarté : hors du format figé, ou porteur de texte. */
export interface DroppedEffect {
  army: string;
  /** « Detachment › Rule », « Detachment › Enhancement ». */
  where: string;
  reason: string;
}
