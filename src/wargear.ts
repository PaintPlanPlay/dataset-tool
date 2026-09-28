/**
 * Le Wargear Cost porté par la Wargear Option (#121).
 *
 * Le MFM facture de l'équipement par un nom (`Twin Killsaws: 5`), BSData décrit
 * des options (`Meganob w/ Twin Killsaw`) : rien ne les relie. Une fois le MFM
 * et les Corrections appliqués, cette étape propose, pour chaque ligne
 * `wargear` d'une Unit, la Wargear Option qu'elle facture, en comparant des
 * noms normalisés — casse, accents, pluriel simple, préfixe « 2 X » qui donne
 * une quantité de 2, forme « … w/ X » — au nom des options et de leurs Weapons.
 *
 * Elle ne lie que si **exactement une option non par défaut** correspond. Tout
 * le reste devient un finding : ligne orpheline, ambiguë, ou qui ne vise
 * qu'une option par défaut (le Lascannon de coque est payant, un autre ne
 * l'est peut-être pas : le mainteneur décide). Un lien posé à la main — une
 * Contribution — prime toujours, y compris pour délier ; s'il désigne une
 * ligne disparue, il est signalé et ne facture rien.
 *
 * Le montant n'est jamais recopié dans l'option : il reste dans la ligne.
 */
import type { ArmyFile, Unit, WargearCost, WeaponOption } from '@paintplanplay/dataset-schema';

export interface WargearFinding {
  army: string;
  unitId: string;
  unit: string;
  /** La ligne du MFM, par son nom. */
  item: string;
  /**
   * `orphan` : aucune option ne correspond ; `ambiguous` : plusieurs options non
   * par défaut ; `default-only` : seule une option par défaut correspond ;
   * `missing-line` : un lien posé à la main désigne une ligne disparue.
   */
  kind: 'orphan' | 'ambiguous' | 'default-only' | 'missing-line';
  /** Les options concernées, par nom. */
  options: string[];
  /** L'adresse de l'option, pour un lien posé à la main. */
  target?: string;
}

/** Adresse d'une Wargear Option : `<unitId>::option:<groupId>|<optionId>`. */
export const optionTarget = (unitId: string, groupId: string, optionId: string) => `${unitId}::option:${groupId}|${optionId}`;

/** Un nom comparable : sans casse ni accents, mots au singulier. */
export function wargearKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .join(' ');
}

/** « 2 Multi-meltas » : le nombre en tête, et ce qu'il compte. */
function counted(name: string): { quantity: number; rest: string } {
  const m = /^\s*(\d+)\s*x?\s+(.+)$/i.exec(name);
  const n = m ? Number(m[1]) : 1;
  return n >= 2 && m ? { quantity: n, rest: m[2] } : { quantity: 1, rest: name };
}

/** Les noms sous lesquels une option peut être facturée, et la quantité que son nom annonce. */
function namesOf(o: WeaponOption): { keys: Set<string>; quantity: number } {
  const { quantity, rest } = counted(o.name);
  const keys = new Set([wargearKey(rest)]);
  const w = /\bw\/\s*(.+)$/i.exec(o.name);
  if (w) keys.add(wargearKey(w[1]));
  for (const ref of o.weapons) keys.add(wargearKey(ref.slice(ref.indexOf('|') + 1)));
  return { keys, quantity };
}

interface Located {
  groupId: string;
  option: WeaponOption;
}

const optionsOf = (u: Unit): Located[] => (u.optionGroups ?? []).flatMap((g) => g.options.map((option) => ({ groupId: g.id, option })));

/**
 * Pose les Wargear Costs sur les Units des fichiers construits, et rend les
 * findings. `manual` : les liens posés à la main, par adresse d'option ; `null`
 * délie.
 */
export function linkWargear(files: Map<string, unknown>, gameSystem: string, manual: Map<string, WargearCost | null> = new Map()): WargearFinding[] {
  const findings: WargearFinding[] = [];
  // Une Unit alliée figure dans plusieurs Armies : ses findings sous la sienne d'abord.
  const armies = [...files].filter(([p]) => p.startsWith(`${gameSystem}/armies/`)).map(([, f]) => f as ArmyFile);
  const reported = new Set<string>();
  const occurrences = armies.flatMap((a) => a.units.map((u) => ({ army: a.id, unit: u }))).sort((x, y) => Number(Boolean(x.unit.ally)) - Number(Boolean(y.unit.ally)));

  for (const { army, unit } of occurrences) {
    const own = linkUnit(unit, manual);
    if (reported.has(unit.id)) continue;
    reported.add(unit.id);
    findings.push(...own.map((f) => ({ army, unitId: unit.id, unit: unit.name, ...f })));
  }
  return findings.sort((a, b) => a.army.localeCompare(b.army) || a.unit.localeCompare(b.unit) || a.item.localeCompare(b.item));
}

function linkUnit(unit: Unit, manual: Map<string, WargearCost | null>): Omit<WargearFinding, 'army' | 'unitId' | 'unit'>[] {
  const lines = unit.wargear ?? [];
  const options = optionsOf(unit);
  const out: Omit<WargearFinding, 'army' | 'unitId' | 'unit'>[] = [];
  const decided = new Set<WeaponOption>();
  const covered = new Set<string>();

  // Les liens posés à la main d'abord : ils priment, pour lier comme pour délier.
  for (const { groupId, option } of options) {
    delete option.wargearCost;
    const target = optionTarget(unit.id, groupId, option.id);
    if (!manual.has(target)) continue;
    decided.add(option);
    const link = manual.get(target);
    if (!link) continue;
    if (!lines.some((l) => l.item === link.item)) {
      out.push({ item: link.item, kind: 'missing-line', options: [option.name], target });
      continue;
    }
    option.wargearCost = { item: link.item, ...((link.quantity ?? 1) > 1 ? { quantity: link.quantity } : {}) };
    covered.add(link.item);
  }

  const names = new Map(options.map((o) => [o.option, namesOf(o.option)]));
  for (const line of lines) {
    if (covered.has(line.item)) continue;
    const key = wargearKey(line.item);
    const matching = options.filter((o) => !decided.has(o.option) && names.get(o.option)!.keys.has(key)).map((o) => o.option);
    const paid = matching.filter((o) => !o.isDefault);
    if (paid.length === 1 && !paid[0].wargearCost) {
      const quantity = names.get(paid[0])!.quantity;
      paid[0].wargearCost = { item: line.item, ...(quantity > 1 ? { quantity } : {}) };
      continue;
    }
    const kind = paid.length > 1 || (paid.length === 1 && paid[0].wargearCost) ? 'ambiguous' : matching.length ? 'default-only' : 'orphan';
    out.push({ item: line.item, kind, options: (paid.length ? paid : matching).map((o) => o.name) });
  }
  return out;
}
