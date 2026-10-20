/**
 * Le Wargear Cost porté par la Wargear Alternative (#121).
 *
 * Le MFM facture de l'équipement par un nom (`Twin Killsaws: 5`), BSData décrit
 * des choix (`Meganob w/ Twin Killsaw`) : rien ne les relie. Une fois le MFM
 * et les Corrections appliqués, cette étape propose, pour chaque ligne
 * `wargear` d'une Unit, ce qu'elle facture, en comparant des noms normalisés —
 * casse, accents, pluriel simple, préfixe « 2 X » qui donne une quantité de 2,
 * forme « … w/ X » — au nom des choix et de leurs Weapons.
 *
 * Elle ne lie que si **exactement un choix payable** correspond. Tout le reste
 * devient un finding : ligne orpheline, ambiguë, ou qui ne vise que ce qui est
 * porté d'office (le Lascannon de coque est payant, un autre ne l'est peut-être
 * pas : le mainteneur décide). Un lien posé à la main — une Contribution —
 * prime toujours, y compris pour délier ; s'il désigne une ligne disparue, il
 * est signalé et ne facture rien.
 *
 * Un lien posé à la main vise une Wargear Alternative par l'adresse de
 * l'option d'où elle vient (`<unitId>::option:<groupId>|<id>`).
 *
 * Le montant n'est jamais recopié : il reste dans la ligne.
 */
import { weaponName, type ArmyFile, type Unit, type WargearCost, type WargearOption } from '@paintplanplay/dataset-schema';

export interface WargearFinding {
  army: string;
  unitId: string;
  unit: string;
  /** La ligne du MFM, par son nom. */
  item: string;
  /**
   * `orphan` : aucune Wargear Alternative ne correspond ; `ambiguous` :
   * plusieurs ; `default-only` : seul le Default Wargear correspond ;
   * `missing-line` : un lien posé à la main désigne une ligne disparue.
   */
  kind: 'orphan' | 'ambiguous' | 'default-only' | 'missing-line';
  /** Les Wargear Alternatives concernées, par nom (ou les Weapons du Default Wargear). */
  options: string[];
  /** L'adresse de l'option, pour un lien posé à la main. */
  target?: string;
}

/** Adresse d'une Wargear Option : `<unitId>::option:<groupId>|<optionId>`. */
export const optionTarget = (unitId: string, groupId: string, optionId: string) => `${unitId}::option:${groupId}|${optionId}`;

/**
 * Adresse d'une Wargear Alternative : celle de son option d'origine. Une
 * Wargear Option née d'un groupe que la traduction a dû scinder (`<groupId>~2`)
 * garde l'adresse du groupe.
 */
export const alternativeTarget = (unitId: string, option: WargearOption, alternativeId: string) => optionTarget(unitId, option.id.replace(/~\d+$/, ''), alternativeId);

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

/** Les noms sous lesquels un choix peut être facturé, et la quantité que son nom annonce. */
function namesOf(name: string, weapons: string[]): { keys: Set<string>; quantity: number } {
  const { quantity, rest } = counted(name);
  const keys = new Set([wargearKey(rest)]);
  const w = /\bw\/\s*(.+)$/i.exec(name);
  if (w) keys.add(wargearKey(w[1]));
  for (const ref of weapons) keys.add(wargearKey(weaponName(ref)));
  return { keys, quantity };
}

/** Ce qu'une ligne du MFM peut facturer : un choix, avec son adresse et ce qu'il porte. */
interface Billable {
  /** L'adresse d'un lien posé à la main. */
  target: string;
  name: string;
  keys: Set<string>;
  quantity: number;
  /** Porté d'office : une ligne qui ne vise que lui se signale, sans se lier. */
  isDefault: boolean;
  cost(): WargearCost | undefined;
  bill(cost: WargearCost | undefined): void;
}

/**
 * Les Wargear Alternatives d'une Unit, et son Default Wargear : une ligne qui
 * ne vise que ce qui est porté d'office se signale sans se lier.
 */
function alternativeBillables(u: Unit): Billable[] {
  const alternatives = (u.wargearOptions ?? []).flatMap((o) =>
    o.alternatives.map((a): Billable => {
      const weapons = a.weapons.map((w) => w.weapon);
      const names = namesOf(a.name ?? weapons.map(weaponName).join(' and '), weapons);
      const lone = a.weapons.length === 1 ? a.weapons[0].count : 1;
      return {
        target: alternativeTarget(u.id, o, a.id),
        name: a.name ?? weapons.join(', '),
        keys: names.keys,
        quantity: Math.max(names.quantity, lone),
        isDefault: false,
        cost: () => a.wargearCost,
        bill: (c) => {
          if (c) a.wargearCost = c;
          else delete a.wargearCost;
        },
      };
    }),
  );
  const carried = [...new Set((u.modelTypes ?? []).flatMap((t) => t.defaultWargear.map((w) => w.weapon)))].map(
    (ref): Billable => ({ target: '', name: weaponName(ref), ...namesOf(weaponName(ref), [ref]), isDefault: true, cost: () => undefined, bill: () => undefined }),
  );
  return [...alternatives, ...carried];
}

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
    const own = linkUnit(unit, alternativeBillables(unit), withPools(unit, manual));
    if (reported.has(unit.id)) continue;
    reported.add(unit.id);
    findings.push(...own.map((f) => ({ army, unitId: unit.id, unit: unit.name, ...f })));
  }
  return findings.sort((a, b) => a.army.localeCompare(b.army) || a.unit.localeCompare(b.unit) || a.item.localeCompare(b.item));
}

/**
 * Les liens manuels qui visent une Wargear Alternative par l'adresse qu'avait
 * son entrée dans un groupe de choix : une configuration de pool garde son
 * identifiant, mais plus celui du pool qui la contenait.
 */
function withPools(unit: Unit, manual: Map<string, WargearCost | null>): Map<string, WargearCost | null> {
  const prefix = `${unit.id}::option:`;
  const byAlternative = new Map<string, WargearCost | null>();
  for (const [target, link] of manual) if (target.startsWith(prefix)) byAlternative.set(target.slice(target.indexOf('|') + 1), link);
  const out = new Map(manual);
  for (const o of unit.wargearOptions ?? [])
    for (const a of o.alternatives) {
      const target = alternativeTarget(unit.id, o, a.id);
      if (!out.has(target) && byAlternative.has(a.id)) out.set(target, byAlternative.get(a.id)!);
    }
  return out;
}

function linkUnit(unit: Unit, billables: Billable[], manual: Map<string, WargearCost | null>): Omit<WargearFinding, 'army' | 'unitId' | 'unit'>[] {
  const lines = unit.wargear ?? [];
  const out: Omit<WargearFinding, 'army' | 'unitId' | 'unit'>[] = [];
  const decided = new Set<Billable>();
  const covered = new Set<string>();

  // Les liens posés à la main d'abord : ils priment, pour lier comme pour délier.
  for (const b of billables) {
    b.bill(undefined);
    if (!b.target || !manual.has(b.target)) continue;
    decided.add(b);
    const link = manual.get(b.target);
    if (!link) continue;
    if (!lines.some((l) => l.item === link.item)) {
      out.push({ item: link.item, kind: 'missing-line', options: [b.name], target: b.target });
      continue;
    }
    b.bill({ item: link.item, ...((link.quantity ?? 1) > 1 ? { quantity: link.quantity } : {}) });
    covered.add(link.item);
  }

  for (const line of lines) {
    if (covered.has(line.item)) continue;
    const key = wargearKey(line.item);
    const matching = billables.filter((b) => !decided.has(b) && b.keys.has(key));
    const paid = matching.filter((b) => !b.isDefault);
    if (paid.length === 1 && !paid[0].cost()) {
      paid[0].bill({ item: line.item, ...(paid[0].quantity > 1 ? { quantity: paid[0].quantity } : {}) });
      continue;
    }
    const kind = paid.length > 1 || (paid.length === 1 && paid[0].cost()) ? 'ambiguous' : matching.length ? 'default-only' : 'orphan';
    out.push({ item: line.item, kind, options: (paid.length ? paid : matching).map((b) => b.name) });
  }
  return out;
}
