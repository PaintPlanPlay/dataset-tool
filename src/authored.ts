/**
 * Ce que le projet écrit lui-même dans le dépôt du Dataset, faute de source
 * amont : les Battle Sizes, les cibles par défaut de la Simulation, la List
 * d'exemple, et les Effects ou résumés qu'il écrit pour une règle. Fichiers
 * publics, `authored/<gameSystem>/*.json`.
 *
 * Les cibles et la List d'exemple nomment des Units ; la construction les
 * rattache aux Units qu'elle vient de produire — identifiant, effectif borné,
 * coût du jour — et signale celles qu'elle ne trouve plus.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AllyRule, ArmyFile, BattleSize, CoreFile, KeywordFilter, Modifier, ReferenceTarget, RuleOption, SampleList, SampleSection, SampleUnit, Unit, WargearCost, WargearCount, Weapon, WeaponOption } from '@paintplanplay/dataset-schema';
import { validateDef } from '@paintplanplay/dataset-schema/validate';
import { CORE_ROOT, parseTarget } from './corrections/apply.ts';
import { inspectString } from './notext.ts';

export interface AuthoredSampleUnit {
  unit: string;
  section: SampleSection;
  warlord?: boolean;
  models?: { name: string; count: number; wargear: WargearCount[] }[];
  wargear?: WargearCount[];
}

/**
 * Une Contribution (ADR 0010) : ce que fait une règle, en Modifiers (ADR 0011),
 * et sa Description — jamais un texte recopié ; ou ce qu'une Wargear Option
 * facture et apporte, ou la Weapon d'une Enhancement (#121).
 * Adresses : `<unitId>::ability:<nom>`, `<armyId>::rule:<detachmentId>|<ruleId>`,
 * `<armyId>::enhancement:<detachmentId>|<enhancementId>`, `<armyId>::stratagem:<id>`,
 * `<armyId>::armyrule:<id>`, `core::stratagem:<id>`,
 * `<unitId>::option:<groupId>|<optionId>`.
 */
export interface AuthoredEffect {
  target: string;
  /** L'ancien format d'Effect 40kdc-data : il n'est plus accepté, seulement signalé. */
  effect?: unknown;
  modifiers?: Modifier[];
  options?: RuleOption[];
  /** Les Units qui bénéficient d'une Detachment Rule. */
  eligibility?: KeywordFilter;
  summary?: string;
  /**
   * Pour une Wargear Option : la ligne `wargear` du MFM qui la facture, posée à
   * la main. Elle prime sur la liaison automatique ; `null` délie.
   */
  wargearCost?: WargearCost | null;
  /** Pour une Wargear Option : les aptitudes de l'Unit qu'elle apporte, par nom. */
  abilities?: string[];
  /** Une Wargear Option absente de BSData, créée dans son groupe d'options sous l'identifiant de l'adresse. */
  option?: Omit<WeaponOption, 'id' | 'wargearCost' | 'abilities'>;
  /** Pour une Enhancement : la Weapon qu'elle apporte à son porteur. */
  weapon?: Weapon;
  /** Pourquoi, en une phrase à nous. */
  reason: string;
  /**
   * Où en est sa revue, quand elle vient d'une extraction (ADR 0011) : validée
   * parce que 40kdc-data dit pareil, en attente d'un humain, ou revue.
   */
  review?: 'concordant' | 'divergent' | 'seul' | 'revu';
  /**
   * Empreinte de ce que disait 40kdc-data (Effect et résumé) quand on l'a écrite.
   * Un amont qui a bougé depuis est signalé, jamais appliqué.
   */
  upstream?: string;
}

/** Ce que devient une Contribution à la construction. */
export interface ContributionVerdict {
  target: string;
  reason: string;
  /**
   * `active` : appliquée ; `flagged` : appliquée, mais l'amont a changé depuis sa
   * rédaction ; `rejected` : hors format ; `unresolved` : cible introuvable.
   */
  state: 'active' | 'flagged' | 'rejected' | 'unresolved';
  note: string;
  /** Empreinte de ce que dit l'amont aujourd'hui, avant la Contribution. */
  upstreamNow?: string;
}

/** Empreinte courte d'une valeur JSON. */
export const fingerprint = (value: unknown) => createHash('sha1').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 12);

/** Ce qu'on retient de l'amont d'une règle : son Effect et son résumé. */
/**
 * Ce qu'on retient de l'amont d'une règle : l'Effect que 40kdc-data lui donne,
 * sous la même forme qu'avant la bascule (aucun résumé amont n'existe).
 */
const upstreamOf = (kdcEffect: unknown) => fingerprint({ effect: kdcEffect, summary: undefined });

/** Une Ally Rule telle que le projet l'écrit : la règle publiée, et pourquoi. */
export type AuthoredAllyRule = AllyRule & { reason: string };

export interface AuthoredCore {
  effects?: AuthoredEffect[];
  battleSizes: BattleSize[];
  allyRules?: AuthoredAllyRule[];
  /** Par Army et nom d'Unit. */
  referenceTargets: { army: string; unit: string; models: number }[];
  sampleList?: { army: string; name: string; detachment: string; battleSize: number; units: AuthoredSampleUnit[] };
}

export const authoredDir = (gameSystem: string) => `authored/${gameSystem}`;
export const EFFECTS_FILE = 'effects.json';
export const ALLY_RULES_FILE = 'ally-rules.json';

export function readAuthored(datasetDir: string, gameSystem: string): AuthoredCore | undefined {
  const dir = join(datasetDir, authoredDir(gameSystem));
  const read = <T>(file: string): T | undefined =>
    existsSync(join(dir, file)) ? (JSON.parse(readFileSync(join(dir, file), 'utf8')) as T) : undefined;
  const battleSizes = read<BattleSize[]>('battle-sizes.json');
  const referenceTargets = read<AuthoredCore['referenceTargets']>('reference-targets.json');
  const sampleList = read<NonNullable<AuthoredCore['sampleList']>>('sample-list.json');
  const effects = read<AuthoredEffect[]>(EFFECTS_FILE);
  const allyRules = read<AuthoredAllyRule[]>(ALLY_RULES_FILE);
  if (!battleSizes && !referenceTargets && !sampleList && !effects && !allyRules) return undefined;
  return {
    battleSizes: battleSizes ?? [],
    ...(allyRules ? { allyRules } : {}),
    referenceTargets: referenceTargets ?? [],
    ...(sampleList ? { sampleList } : {}),
    ...(effects ? { effects } : {}),
  };
}

/** Le coût d'une Unit à un effectif : son coût de base, puis le dernier palier franchi. */
export function pointsAt(u: Unit, models: number): number {
  return [...u.costBrackets].sort((a, b) => a.overModels - b.overModels).reduce((p, b) => (models > b.overModels ? b.points : p), u.points);
}

export interface ResolvedCore {
  battleSizes: BattleSize[];
  allyRules: AllyRule[];
  referenceTargets: ReferenceTarget[];
  sampleList?: SampleList;
  /** « army › Unit » introuvables dans le Dataset construit. */
  unresolved: string[];
}

export function resolveAuthored(authored: AuthoredCore | undefined, armies: Map<string, Unit[]>): ResolvedCore {
  const unresolved: string[] = [];
  const find = (army: string, name: string) => {
    const units = armies.get(army) ?? [];
    // La datasheet propre à l'Army d'abord : une alliée peut porter le même nom.
    const u = units.find((x) => x.name === name && !x.ally) ?? units.find((x) => x.name === name);
    if (!u) unresolved.push(`${army} › ${name}`);
    return u;
  };

  const referenceTargets = (authored?.referenceTargets ?? []).flatMap((t) => {
    const u = find(t.army, t.unit);
    return u ? [{ armyId: t.army, unitId: u.id, name: u.name, models: Math.max(u.minModels, Math.min(t.models, u.maxModels)) }] : [];
  });

  let sampleList: SampleList | undefined;
  const s = authored?.sampleList;
  if (s) {
    const units = s.units.flatMap((e): SampleUnit[] => {
      const u = find(s.army, e.unit);
      if (!u) return [];
      const models = e.models?.reduce((n, m) => n + m.count, 0) || u.minModels;
      return [
        {
          unitId: u.id,
          name: u.name,
          section: e.section,
          points: pointsAt(u, models),
          ...(e.warlord ? { warlord: true } : {}),
          ...(e.models ? { models: e.models } : {}),
          ...(e.wargear ? { wargear: e.wargear } : {}),
        },
      ];
    });
    sampleList = { armyId: s.army, name: s.name, detachment: s.detachment, battleSize: s.battleSize, points: units.reduce((n, u) => n + u.points, 0), units };
  }

  const allyRules = (authored?.allyRules ?? []).map(({ reason: _reason, ...rule }) => {
    unresolved.push(...allyRuleOrphans(rule, armies));
    return rule;
  });

  return {
    battleSizes: [...(authored?.battleSizes ?? [])].sort((a, b) => a.points - b.points),
    allyRules,
    referenceTargets,
    ...(sampleList ? { sampleList } : {}),
    unresolved,
  };
}

/**
 * Ce qu'une Ally Rule désigne et que le Dataset construit n'a plus : une Army,
 * un Keyword que ne porte aucune Unit, une Unit nommée. Une règle qui ne vise
 * plus rien ne fait rien, sans bruit : il faut le dire.
 */
function allyRuleOrphans(rule: AllyRule, armies: Map<string, Unit[]>): string[] {
  const all = [...armies.values()].flat();
  const keywords = new Set(all.flatMap((u) => [...u.keywords, ...u.factionKeywords]));
  const names = new Set(all.map((u) => u.name));
  const keywordsOfRule = [
    ...(rule.requires ?? []),
    ...(rule.admits.factionKeywords ?? []),
    ...(rule.admits.keywords ?? []),
    ...(rule.limits ?? []).flatMap((l) => (l.units ?? []).map((u) => u.keyword)),
    ...(rule.modelsOneOf ?? []).map((m) => m.keyword),
    ...(rule.battlelineRatio ?? []),
  ];
  return [
    ...[...(rule.armies ?? []), ...(rule.exceptArmies ?? [])].filter((a) => !armies.has(a)).map((a) => `${rule.name} › Army ${a}`),
    ...[...new Set(keywordsOfRule)].filter((k) => !keywords.has(k)).map((k) => `${rule.name} › Keyword ${k}`),
    ...(rule.admits.units ?? []).filter((n) => !names.has(n)).map((n) => `${rule.name} › Unit ${n}`),
  ];
}

/** Ce qu'une Contribution porte pour une Wargear Option, et seulement pour elle. */
const OPTION_FIELDS = ['wargearCost', 'abilities', 'option'] as const;

/** Ce qui empêche de publier une Contribution ; vide si elle passe. */
export function authoredEffectProblems(e: AuthoredEffect): string[] {
  const problems: string[] = [];
  const { entity } = parseTarget(e.target);
  const forOption = OPTION_FIELDS.some((k) => e[k] !== undefined);
  if (entity === 'option') {
    if (!forOption) problems.push('a Wargear Option Contribution carries a wargear cost, abilities or a created option');
    if (e.modifiers !== undefined || e.options !== undefined || e.summary !== undefined || e.eligibility !== undefined || e.weapon !== undefined)
      problems.push('a Wargear Option carries no Modifiers, summary or Weapon of its own');
  } else if (forOption) problems.push('a wargear cost, abilities or a created option belong to a Wargear Option');
  if (e.weapon !== undefined && entity !== 'enhancement') problems.push('only an Enhancement brings a Weapon');
  if (e.wargearCost) problems.push(...validateDef('wargearCost', e.wargearCost).map((f) => `wargearCost${f.path}: ${f.message}`));
  if (e.abilities !== undefined)
    problems.push(...(Array.isArray(e.abilities) && e.abilities.every((a) => typeof a === 'string' && a.trim()) ? [] : ['abilities: names expected']));
  if (e.option !== undefined) problems.push(...validateDef('weaponOption', { id: 'x', ...e.option }).map((f) => `option${f.path}: ${f.message}`));
  if (e.weapon !== undefined) problems.push(...validateDef('weapon', e.weapon).map((f) => `weapon${f.path}: ${f.message}`));
  if (e.eligibility !== undefined) problems.push(...validateDef('keywordFilter', e.eligibility).map((f) => `eligibility${f.path}: ${f.message}`));
  if (e.effect !== undefined) problems.push('an Effect in the retired 40kdc-data format: write it as Modifiers (ADR 0011)');
  else if (!forOption && e.weapon === undefined && e.modifiers === undefined && e.options === undefined && e.summary === undefined && e.eligibility === undefined)
    problems.push('neither Modifiers nor summary');
  if (e.modifiers !== undefined) problems.push(...validateDef('modifiers', e.modifiers).map((f) => `Modifiers${f.path}: ${f.message}`));
  if (e.options !== undefined)
    problems.push(...(e.options.length < 2 ? ['a Rule with Options has at least two'] : []), ...e.options.flatMap((o, i) => validateDef('ruleOption', o).map((f) => `Options/${i}${f.path}: ${f.message}`)));
  if (e.summary !== undefined) problems.push(...inspectString(e.summary, { summary: true }));
  if (!e.reason?.trim()) problems.push('reason missing');
  else problems.push(...inspectString(e.reason));
  return problems;
}

/**
 * Pose les Modifiers, Options, Eligibility et Descriptions écrits par le projet
 * sur les fichiers construits. `kdcEffects` donne, par adresse, la lecture de
 * 40kdc-data : c'est elle que l'empreinte d'une Contribution compare, pour
 * signaler qu'elle a bougé depuis.
 */
export function applyAuthoredEffects(
  files: Map<string, unknown>,
  gameSystem: string,
  effects: AuthoredEffect[],
  kdcEffects: Record<string, unknown> = {},
): {
  unresolved: string[];
  rejected: { target: string; reason: string }[];
  contributions: ContributionVerdict[];
  /** Les liens posés à la main entre Wargear Option et ligne du MFM, par adresse d'option ; `null` délie. */
  wargearLinks: Map<string, WargearCost | null>;
} {
  const wargearLinks = new Map<string, WargearCost | null>();
  const unresolved: string[] = [];
  const rejected: { target: string; reason: string }[] = [];
  const contributions: ContributionVerdict[] = [];
  const armies = [...files].filter(([p]) => p.startsWith(`${gameSystem}/armies/`)).map(([, f]) => f as ArmyFile);
  const core = files.get(`${gameSystem}/core.json`) as CoreFile | undefined;

  for (const e of effects) {
    const problems = authoredEffectProblems(e);
    if (problems.length) {
      rejected.push({ target: e.target, reason: problems[0] });
      contributions.push({ target: e.target, reason: e.reason, state: 'rejected', note: problems[0] });
      continue;
    }
    const body = {
      ...(e.weapon !== undefined ? { weapon: e.weapon } : {}),
      ...(e.modifiers !== undefined ? { modifiers: e.modifiers } : {}),
      ...(e.options !== undefined ? { options: e.options } : {}),
      ...(e.eligibility !== undefined ? { eligibility: e.eligibility } : {}),
      ...(e.summary !== undefined ? { summary: e.summary } : {}),
    };
    const { root, entity, name } = parseTarget(e.target);
    let hits = 0;
    const missingAbilities = new Set<string>();
    const upstreamNow = upstreamOf(kdcEffects[e.target]);
    const take = (el: object) => {
      Object.assign(el, body);
      hits++;
    };
    if (entity === 'option') {
      // Une Wargear Option : créée dans son groupe quand BSData ne l'a pas, puis ce qu'elle apporte.
      const [groupId, optionId] = name.split('|');
      for (const a of armies)
        for (const u of a.units)
          if (u.id === root)
            for (const g of u.optionGroups ?? []) {
              if (g.id !== groupId) continue;
              let o = g.options.find((x) => x.id === optionId);
              if (!o && e.option) g.options.push((o = { id: optionId, ...e.option }));
              if (!o) continue;
              if (e.option) Object.assign(o, e.option);
              if (e.abilities !== undefined) {
                // Une aptitude que l'Unit n'a plus ne se pose pas : elle se signale.
                const known = e.abilities.filter((n) => u.abilities.some((a) => a.name === n));
                for (const n of e.abilities) if (!known.includes(n)) missingAbilities.add(n);
                if (known.length) o.abilities = known;
                else delete o.abilities;
              }
              hits++;
            }
      if (hits && e.wargearCost !== undefined) wargearLinks.set(e.target, e.wargearCost);
    } else if (entity === 'ability') {
      for (const a of armies) for (const u of a.units) if (u.id === root) for (const ab of u.abilities) if (ab.name === name) take(ab);
    } else if (entity === 'rule' || entity === 'enhancement') {
      const [detachmentId, elementId] = name.split('|');
      for (const a of armies)
        if (a.id === root)
          for (const d of a.detachments)
            if (d.id === detachmentId)
              for (const el of entity === 'rule' ? d.rules : d.enhancements)
                if (el.id === elementId) take(el);
    } else if (entity === 'armyrule') {
      for (const a of armies) if (a.id === root) for (const r of a.armyRules ?? []) if (r.id === name) take(r);
    } else if (entity === 'stratagem') {
      const list = root === CORE_ROOT ? (core?.stratagems ?? []) : (armies.find((a) => a.id === root)?.stratagems ?? []);
      for (const s of list) if (s.id === name) take(s);
    }
    if (!hits) {
      unresolved.push(e.target);
      contributions.push({ target: e.target, reason: e.reason, state: 'unresolved', note: 'the target is not in the Dataset' });
    } else if (missingAbilities.size)
      contributions.push({
        target: e.target,
        reason: e.reason,
        state: 'flagged',
        note: `not an ability of the Unit any more, left out: ${[...missingAbilities].join(', ')}`,
      });
    else if (entity === 'option') contributions.push({ target: e.target, reason: e.reason, state: 'active', note: 'applied' });
    else if (e.upstream && e.upstream !== upstreamNow)
      contributions.push({ target: e.target, reason: e.reason, state: 'flagged', note: '40kdc-data changed this rule since the Contribution was written: review it, it stays applied', upstreamNow });
    else contributions.push({ target: e.target, reason: e.reason, state: 'active', note: 'applied, over 40kdc-data', upstreamNow });
  }
  return { unresolved, rejected, contributions, wargearLinks };
}
