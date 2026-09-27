/**
 * La revue des Effects extraits (ADR 0011).
 *
 * Les Effects du Dataset sont établis une fois par une lecture indépendante
 * des règles, puis comparés à la lecture de 40kdc-data. Deux lectures d'accord
 * suffisent (`concordant`) ; celles qui diffèrent (`divergent`) ou n'ont que la
 * nôtre (`seul`) attendent un humain, qui les passe en `revu`.
 *
 * Comparer, c'est ramener l'Effect de 40kdc-data à nos Modifiers pour les
 * formes simples qu'il partage avec eux ; ce qui ne se traduit pas ne
 * concorde jamais, et part en revue.
 */
import type { Condition, Modifier, ModifierTarget } from '@paintplanplay/dataset-schema';

export type ReviewStatus = 'concordant' | 'divergent' | 'seul' | 'revu';

/** Une Rule telle qu'une extraction la livre : son adresse et ce qu'elle fait, jamais son texte. */
export interface ExtractedRule {
  target: string;
  modifiers?: Modifier[];
  options?: { name: string; modifiers: Modifier[] }[];
  summary?: string;
}

export interface ImportResult {
  written: number;
  rejected: { target: string; reason: string }[];
  statuses: Record<string, ReviewStatus>;
}

/** Une Rule de la page de revue : nos Modifiers et, en regard, la lecture de 40kdc-data. */
export interface ReviewItem {
  target: string;
  /** La fiche qui la porte, pour l'ouvrir. */
  sheet: string;
  army: string;
  /** « ability », « rule », « enhancement », « stratagem », « armyrule ». */
  type: string;
  rule: string;
  status: ReviewStatus;
  ours: Modifier[];
  /** La lecture de 40kdc-data en Modifiers ; `null` quand elle ne se traduit pas, absente quand il n'y en a pas. */
  kdc?: Modifier[] | null;
  /** Son Effect tel quel, pour juger ce qui ne se traduit pas. */
  kdcEffect?: unknown;
}

type Node = Record<string, unknown>;

const TARGETS: Record<string, ModifierTarget> = {
  unit: 'self',
  self: 'self',
  bearer: 'self',
  'attached-unit': 'attached',
  'friendly-within-aura': 'aura',
  'enemy-unit': 'enemy',
  'attacking-unit': 'enemy',
};

const KEYWORD_KEYS: [RegExp, (m: RegExpMatchArray) => Pick<Modifier, 'key' | 'value'>][] = [
  [/^lethal hits$/i, () => ({ key: 'lethal-hits' })],
  [/^devastating wounds$/i, () => ({ key: 'devastating-wounds' })],
  [/^twin-linked$/i, () => ({ key: 'twin-linked' })],
  [/^ignores cover$/i, () => ({ key: 'ignores-cover' })],
  [/^sustained hits (\d+)$/i, (m) => ({ key: 'sustained-hits', value: Number(m[1]) })],
];

class Untranslatable extends Error {}

/** Le type d'attaque qu'un modificateur 40kdc-data borne, en Condition. */
function attackCondition(m: Node): Condition[] {
  const t = m.weapon_type ?? m.attack_type;
  return t === 'melee' ? [{ key: 'melee' }] : t === 'ranged' ? [{ key: 'ranged' }] : [];
}

function translateCondition(c: Node | undefined): Condition[] {
  if (!c) return [];
  if (Array.isArray(c.operands)) {
    if (c.operator !== 'and') throw new Untranslatable();
    return (c.operands as Node[]).flatMap(translateCondition);
  }
  const p = (c.parameters ?? {}) as Node;
  if (c.type === 'attack-is-type' && (p.attack_type === 'melee' || p.attack_type === 'ranged')) return [{ key: p.attack_type }];
  if (c.type === 'target-has-keyword' && typeof p.keyword === 'string') return [{ key: 'target-keyword', value: p.keyword }];
  throw new Untranslatable();
}

function translate(n: Node | undefined, conditions: Condition[], out: Modifier[], depth = 0): void {
  if (!n || depth > 8) return;
  if (n.type === 'sequence') {
    for (const s of (n.steps as Node[]) ?? []) translate(s, conditions, out, depth + 1);
    return;
  }
  if (n.type === 'conditional') {
    translate(n.effect as Node, [...conditions, ...translateCondition(n.condition as Node)], out, depth + 1);
    return;
  }
  const m = (n.modifier ?? {}) as Node;
  const target = TARGETS[String(n.target ?? 'unit')];
  if (!target) throw new Untranslatable();
  const all = [...conditions, ...attackCondition(m)];
  const push = (key: string, value?: Modifier['value']): void => {
    out.push({ key, ...(value !== undefined ? { value } : {}), target, ...(all.length ? { conditions: all } : {}) });
  };
  const value = typeof m.value === 'number' ? m.value : undefined;
  switch (n.type) {
    case 'roll-modifier':
      if ((m.roll === 'hit' || m.roll === 'wound') && m.operation === 'crit-on' && value !== undefined) return push(`crit-${m.roll}`, `${value}+`);
      if ((m.roll === 'hit' || m.roll === 'wound') && value !== undefined && (m.operation === 'add' || m.operation === 'subtract'))
        return push(String(m.roll), m.operation === 'add' ? value : -value);
      throw new Untranslatable();
    case 're-roll':
      if (m.roll === 'hit' || m.roll === 'wound') return push(`reroll-${m.roll}`, m.subset === 'ones' ? '1' : 'all');
      throw new Untranslatable();
    case 'stat-modifier':
      if (m.operation === 'add' && value !== undefined && ['S', 'A', 'D', 'AP'].includes(String(m.stat))) return push(String(m.stat), value);
      throw new Untranslatable();
    case 'keyword-grant': {
      const words = Array.isArray(m.keywords) ? (m.keywords as unknown[]).map(String) : typeof m.keyword === 'string' ? [m.keyword] : [];
      if (!words.length) throw new Untranslatable();
      for (const w of words) {
        const hit = KEYWORD_KEYS.map(([re, make]) => ((x) => (x ? make(x) : null))(w.trim().match(re))).find(Boolean);
        if (!hit) throw new Untranslatable();
        push(hit.key, hit.value);
      }
      return;
    }
    case 'feel-no-pain':
      if (typeof m.threshold === 'number') return push('feel-no-pain', `${m.threshold}+`);
      throw new Untranslatable();
    case 'charge-roll-modifier':
      if (value !== undefined) return push('charge', m.operation === 'subtract' ? -value : value);
      throw new Untranslatable();
    default:
      throw new Untranslatable();
  }
}

/** La lecture de 40kdc-data en Modifiers ; `null` quand une partie ne se traduit pas. */
export function kdcReading(effect: unknown): Modifier[] | null {
  const out: Modifier[] = [];
  try {
    translate(effect as Node, [], out);
  } catch (err) {
    if (err instanceof Untranslatable) return null;
    throw err;
  }
  return out;
}

/** Un Modifier sous une forme qui se compare : valeur en texte, Conditions triées. */
const canonical = (m: Modifier) =>
  `${m.key}=${m.value ?? ''}@${m.target}[${(m.conditions ?? []).map((c) => `${c.key}:${c.value ?? ''}`.toLowerCase()).sort().join(',')}]`;

const sameReading = (a: Modifier[], b: Modifier[]) => JSON.stringify(a.map(canonical).sort()) === JSON.stringify(b.map(canonical).sort());

/** Notre lecture face à celle de 40kdc-data. */
export function compareReadings(ours: ExtractedRule, kdcEffect: unknown): Exclude<ReviewStatus, 'revu'> {
  if (kdcEffect === undefined) return 'seul';
  const theirs = kdcReading(kdcEffect);
  // Une Rule à choix ne se compare pas : 40kdc-data écrit ses choix autrement.
  if (!theirs || ours.options?.length) return 'divergent';
  return sameReading(ours.modifiers ?? [], theirs) ? 'concordant' : 'divergent';
}
