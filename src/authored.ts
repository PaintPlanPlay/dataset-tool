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
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AllyRule, ArmyFile, BattleSize, CoreFile, KeywordFilter, Modifier, ReferenceTarget, RuleOption, SampleList, SampleSection, SampleUnit, Stratagem, Unit, WargearCost, WargearCount, Weapon, WeaponOption } from '@paintplanplay/dataset-schema';
import { validateDef } from '@paintplanplay/dataset-schema/validate';
import { CORE_ROOT, parseTarget } from './corrections/apply.ts';
import { toJson } from './dataset.ts';
import { homes, type Homes } from './home.ts';
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
  /**
   * Une Detachment Rule qu'aucune source n'a : créée dans son Detachment, sous
   * l'identifiant de l'adresse, partout où le Detachment est publié.
   */
  rule?: { name: string };
  /**
   * Un Stratagem et ses champs structurés : créé sous l'identifiant de
   * l'adresse quand aucune source ne l'a, partout où son Detachment est publié ;
   * ses champs remplacent sinon ceux de la source.
   */
  stratagem?: CreatedStratagem;
  /** Pour une Enhancement : les mots-clés exigés du porteur, par groupes (ET dans un groupe, OU entre groupes). */
  requires?: string[][];
  /** Pour une Enhancement : les mots-clés qui interdisent le porteur. */
  excludes?: string[];
  /** Pour une Upgrade : les Units qu'elle peut équiper à la fois. */
  maxTargets?: number;
  /** Pourquoi, en une phrase à nous. */
  reason: string;
}

/** Ce qu'une Contribution donne d'un Stratagem : tout, sauf son identifiant et ce qu'il fait. */
export type CreatedStratagem = Pick<Stratagem, 'name' | 'detachmentId' | 'cp' | 'phases' | 'playerTurn' | 'timing'> & Partial<Pick<Stratagem, 'category' | 'target'>>;

/** Ce que devient une Contribution à la construction. */
export interface ContributionVerdict {
  target: string;
  reason: string;
  /**
   * `active` : appliquée ; `flagged` : appliquée, mais ce qu'elle nomme n'est
   * plus là ; `rejected` : hors format ; `unresolved` : cible introuvable.
   */
  state: 'active' | 'flagged' | 'rejected' | 'unresolved';
  note: string;
}

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
/** L'ancien fichier unique des Contributions : encore lu, plus jamais écrit. */
export const EFFECTS_FILE = 'effects.json';
export const ALLY_RULES_FILE = 'ally-rules.json';
/** Les Contributions sur les Rules et Wargear Options, un fichier par Army d'origine. */
export const CONTRIBUTIONS_DIR = 'armies';

/** Le fichier des Contributions d'une Army, ou des Stratagems Core (`core`). */
export const contributionsPath = (gameSystem: string, home: string) => `${authoredDir(gameSystem)}/${CONTRIBUTIONS_DIR}/${home}.json`;

/** Un fichier de Contributions, l'ancien `effects.json` compris. */
export const isContributionsPath = (gameSystem: string, path: string) =>
  path === `${authoredDir(gameSystem)}/${EFFECTS_FILE}` ||
  (path.startsWith(`${authoredDir(gameSystem)}/${CONTRIBUTIONS_DIR}/`) && path.endsWith('.json') && !path.slice(authoredDir(gameSystem).length + CONTRIBUTIONS_DIR.length + 2).includes('/'));

/** Les Contributions de chaque fichier, par chemin relatif au dépôt du Dataset. */
export function readContributionFiles(datasetDir: string, gameSystem: string): Map<string, AuthoredEffect[]> {
  const out = new Map<string, AuthoredEffect[]>();
  const legacy = `${authoredDir(gameSystem)}/${EFFECTS_FILE}`;
  if (existsSync(join(datasetDir, legacy))) out.set(legacy, JSON.parse(readFileSync(join(datasetDir, legacy), 'utf8')) as AuthoredEffect[]);
  const dir = join(datasetDir, authoredDir(gameSystem), CONTRIBUTIONS_DIR);
  if (existsSync(dir))
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort())
      out.set(`${authoredDir(gameSystem)}/${CONTRIBUTIONS_DIR}/${f}`, JSON.parse(readFileSync(join(dir, f), 'utf8')) as AuthoredEffect[]);
  return out;
}

/** Toutes les Contributions sur les Rules et Wargear Options du dépôt. */
export const readContributions = (datasetDir: string, gameSystem: string): AuthoredEffect[] => [...readContributionFiles(datasetDir, gameSystem).values()].flat();

/**
 * Range des Contributions dans les fichiers de leur Army d'origine, sous
 * l'adresse de cette Army. Rend le contenu de chaque fichier touché, `null`
 * pour un fichier qui n'a plus rien à porter. `previous` dit où était chaque
 * adresse : une Contribution dont la cible est introuvable y reste.
 */
export function layoutContributions(
  gameSystem: string,
  effects: AuthoredEffect[],
  files: Map<string, unknown>,
  previous: Map<string, AuthoredEffect[]> = new Map(),
): Map<string, AuthoredEffect[] | null> {
  const h = homes(files);
  const wasIn = new Map([...previous].flatMap(([path, list]) => list.map((e) => [e.target, path] as const)));
  const out = new Map<string, AuthoredEffect[] | null>([...previous.keys()].map((p) => [p, null]));
  for (const e of effects) {
    const { home, canonical } = placeOf(h, e);
    const path = home ? contributionsPath(gameSystem, home) : (wasIn.get(e.target) ?? contributionsPath(gameSystem, parseTarget(e.target).root));
    const entry = { ...e, target: canonical };
    out.set(path, [...(out.get(path) ?? []), entry]);
  }
  for (const list of out.values()) if (list) list.sort((a, b) => a.target.localeCompare(b.target));
  return out;
}

/**
 * Où vit ce que décrit une Contribution : les Armies qui le publient, l'Army
 * d'origine en tête, et son adresse sous cette Army. Un Stratagem qu'elle crée
 * n'existe encore nulle part : il suit son Detachment.
 */
export function placeOf(h: Homes, e: AuthoredEffect): { holders: string[]; home?: string; canonical: string } {
  const { root, entity, name } = parseTarget(e.target);
  let holders = h.holders(e.target);
  if (entity === 'stratagem' && root !== CORE_ROOT && !holders.length && e.stratagem?.detachmentId)
    holders = h.holders(`${root}::detachment:${e.stratagem.detachmentId}`);
  const home = holders[0];
  const unitRooted = !['rule', 'enhancement', 'stratagem', 'armyrule'].includes(entity) || root === CORE_ROOT;
  return { holders, ...(home ? { home } : {}), canonical: home && !unitRooted ? `${home}::${entity}:${name}` : e.target };
}

/**
 * Range les Contributions d'un dépôt de Dataset dans le fichier de leur Army
 * d'origine, d'après les fichiers qu'il publie : ce qui a migré l'ancien
 * `effects.json`, et qui remet en ordre un fichier écrit à la main. Rend les
 * fichiers écrits et supprimés.
 */
export function tidyContributions(datasetDir: string, gameSystem: string, files: Map<string, unknown>): { written: string[]; deleted: string[] } {
  const previous = readContributionFiles(datasetDir, gameSystem);
  const layout = layoutContributions(gameSystem, [...previous.values()].flat(), files, previous);
  const out = { written: [] as string[], deleted: [] as string[] };
  for (const [path, list] of layout) {
    const abs = join(datasetDir, path);
    const content = list?.length ? toJson(list) : null;
    const before = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    if (content === before) continue;
    if (content === null) {
      rmSync(abs, { force: true });
      out.deleted.push(path);
    } else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
      out.written.push(path);
    }
  }
  return out;
}

export function readAuthored(datasetDir: string, gameSystem: string): AuthoredCore | undefined {
  const dir = join(datasetDir, authoredDir(gameSystem));
  const read = <T>(file: string): T | undefined =>
    existsSync(join(dir, file)) ? (JSON.parse(readFileSync(join(dir, file), 'utf8')) as T) : undefined;
  const battleSizes = read<BattleSize[]>('battle-sizes.json');
  const referenceTargets = read<AuthoredCore['referenceTargets']>('reference-targets.json');
  const sampleList = read<NonNullable<AuthoredCore['sampleList']>>('sample-list.json');
  const contributions = readContributionFiles(datasetDir, gameSystem);
  const effects = contributions.size ? [...contributions.values()].flat() : undefined;
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

/** Les restrictions d'une Enhancement, à nous depuis le retrait de 40kdc-data. */
const ENHANCEMENT_RESTRICTIONS = ['requires', 'excludes', 'maxTargets'] as const;
const ENHANCEMENT_SAMPLE = { id: 'x', name: 'x', points: 0, appliesTo: 'character', aura: false, maxTargets: 1, requires: [], excludes: [] };

/** Ce qu'une Contribution porte pour une Wargear Option, et seulement pour elle. */
const OPTION_FIELDS = ['wargearCost', 'abilities', 'option'] as const;

/** Ce qui, d'une Contribution, crée une Detachment Rule ou un Stratagem, sans le reste ; `undefined` si elle ne crée rien. */
const creationOf = (e: AuthoredEffect): AuthoredEffect | undefined =>
  e.rule !== undefined || e.stratagem !== undefined
    ? { target: e.target, reason: e.reason, ...(e.rule !== undefined ? { rule: e.rule } : {}), ...(e.stratagem !== undefined ? { stratagem: e.stratagem } : {}) }
    : undefined;

/** Ce qui empêche de publier une Contribution ; vide si elle passe. */
export function authoredEffectProblems(e: AuthoredEffect): string[] {
  const problems: string[] = [];
  const { root, entity } = parseTarget(e.target);
  const forOption = OPTION_FIELDS.some((k) => e[k] !== undefined);
  if (e.rule !== undefined) {
    if (entity !== 'rule') problems.push('only a Detachment Rule is created by `rule`');
    if (typeof e.rule?.name !== 'string' || !e.rule.name.trim()) problems.push('rule: a name is expected');
    else problems.push(...inspectString(e.rule.name).map((r) => `rule/name: ${r}`));
  }
  if (e.stratagem !== undefined) {
    if (entity !== 'stratagem') problems.push('only a Stratagem is created by `stratagem`');
    else problems.push(...validateDef('stratagem', { id: 'x', ...e.stratagem }).map((f) => `stratagem${f.path}: ${f.message}`));
    if (entity === 'stratagem' && (root === CORE_ROOT) !== (e.stratagem?.detachmentId === null))
      problems.push(root === CORE_ROOT ? 'a Core Stratagem has no Detachment' : 'a Stratagem of an Army names its Detachment');
  }
  if (entity === 'option') {
    if (!forOption) problems.push('a Wargear Option Contribution carries a wargear cost, abilities or a created option');
    if (e.modifiers !== undefined || e.options !== undefined || e.summary !== undefined || e.eligibility !== undefined || e.weapon !== undefined)
      problems.push('a Wargear Option carries no Modifiers, summary or Weapon of its own');
  } else if (forOption) problems.push('a wargear cost, abilities or a created option belong to a Wargear Option');
  if (e.weapon !== undefined && entity !== 'enhancement') problems.push('only an Enhancement brings a Weapon');
  for (const k of ENHANCEMENT_RESTRICTIONS)
    if (e[k] !== undefined) {
      if (entity !== 'enhancement') problems.push(`only an Enhancement has \`${k}\``);
      problems.push(...validateDef('enhancement', { ...ENHANCEMENT_SAMPLE, [k]: e[k] }).filter((f) => f.path.startsWith(`/${k}`)).map((f) => `${k}${f.path.slice(k.length + 1)}: ${f.message}`));
    }
  if (e.wargearCost) problems.push(...validateDef('wargearCost', e.wargearCost).map((f) => `wargearCost${f.path}: ${f.message}`));
  if (e.abilities !== undefined)
    problems.push(...(Array.isArray(e.abilities) && e.abilities.every((a) => typeof a === 'string' && a.trim()) ? [] : ['abilities: names expected']));
  if (e.option !== undefined) problems.push(...validateDef('weaponOption', { id: 'x', ...e.option }).map((f) => `option${f.path}: ${f.message}`));
  if (e.weapon !== undefined) problems.push(...validateDef('weapon', e.weapon).map((f) => `weapon${f.path}: ${f.message}`));
  if (e.eligibility !== undefined) problems.push(...validateDef('keywordFilter', e.eligibility).map((f) => `eligibility${f.path}: ${f.message}`));
  if (e.effect !== undefined) problems.push('an Effect in the retired 40kdc-data format: write it as Modifiers (ADR 0011)');
  else if (
    !forOption && e.weapon === undefined && e.modifiers === undefined && e.options === undefined && e.summary === undefined && e.eligibility === undefined &&
    e.rule === undefined && e.stratagem === undefined && ENHANCEMENT_RESTRICTIONS.every((k) => e[k] === undefined)
  )
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
 * Pose sur les fichiers construits ce que le projet écrit : Detachment Rules
 * et Stratagems qu'il crée, restrictions d'Enhancement, Modifiers, Options,
 * Eligibility et Descriptions, Wargear Options.
 */
export function applyAuthoredEffects(
  files: Map<string, unknown>,
  gameSystem: string,
  effects: AuthoredEffect[],
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
  const h: Homes = homes(files);
  /** Ce que décrit déjà une Contribution, par adresse sous l'Army d'origine. */
  const described = new Map<string, string>();

  for (const written of effects) {
    let e = written;
    const place = placeOf(h, e);
    const canonical = place.canonical;
    const first = described.get(canonical);
    if (first !== undefined) {
      const note = `${first} already describes the same element: write it once, under its home Army`;
      rejected.push({ target: e.target, reason: note });
      contributions.push({ target: e.target, reason: e.reason, state: 'rejected', note });
      continue;
    }
    described.set(canonical, e.target);
    // Un identifiant de Stratagem est unique dans son Army : en créer un sous un identifiant pris par un autre Detachment se refuse.
    if (e.stratagem) {
      const { root, name } = parseTarget(e.target);
      const lists = root === CORE_ROOT ? [core?.stratagems ?? []] : armies.filter((a) => place.holders.includes(a.id)).map((a) => a.stratagems);
      if (lists.some((l) => l.some((x) => x.id === name && x.detachmentId !== e.stratagem!.detachmentId))) {
        const note = `the identifier ${name} is already a Stratagem of another Detachment: choose another one`;
        rejected.push({ target: e.target, reason: note });
        contributions.push({ target: e.target, reason: e.reason, state: 'rejected', note });
        continue;
      }
    }
    const problems = authoredEffectProblems(e);
    // Une Detachment Rule ou un Stratagem n'existe que par sa Contribution : un défaut ailleurs ne l'efface pas, il en écarte le reste.
    let refused: string | undefined;
    if (problems.length) {
      const creation = creationOf(e);
      rejected.push({ target: e.target, reason: problems[0] });
      if (!creation || authoredEffectProblems(creation).length) {
        contributions.push({ target: e.target, reason: e.reason, state: 'rejected', note: problems[0] });
        continue;
      }
      refused = problems[0];
      e = creation;
    }
    const body = {
      ...(e.weapon !== undefined ? { weapon: e.weapon } : {}),
      ...(e.requires !== undefined ? { requires: e.requires } : {}),
      ...(e.excludes !== undefined ? { excludes: e.excludes } : {}),
      ...(e.maxTargets !== undefined ? { maxTargets: e.maxTargets } : {}),
      ...(e.modifiers !== undefined ? { modifiers: e.modifiers } : {}),
      ...(e.options !== undefined ? { options: e.options } : {}),
      ...(e.eligibility !== undefined ? { eligibility: e.eligibility } : {}),
      ...(e.summary !== undefined ? { summary: e.summary } : {}),
    };
    const { root, entity, name } = parseTarget(e.target);
    let hits = 0;
    const missingAbilities = new Set<string>();
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
      // Écrite une fois sous l'Army d'origine, elle vaut dans chaque Army qui publie ce Detachment.
      const [detachmentId, elementId] = name.split('|');
      const holders = new Set(place.holders);
      for (const a of armies)
        if (holders.has(a.id))
          for (const d of a.detachments) {
            if (d.id !== detachmentId) continue;
            if (entity === 'rule' && e.rule) {
              const found = d.rules.find((r) => r.id === elementId);
              if (found) found.name = e.rule.name;
              else d.rules.push({ id: elementId, name: e.rule.name });
            }
            for (const el of entity === 'rule' ? d.rules : d.enhancements) if (el.id === elementId) take(el);
          }
    } else if (entity === 'armyrule') {
      const holders = new Set(place.holders);
      for (const a of armies) if (holders.has(a.id)) for (const r of a.armyRules ?? []) if (r.id === name) take(r);
    } else if (entity === 'stratagem') {
      const lists =
        root === CORE_ROOT
          ? [core?.stratagems].filter((l) => l !== undefined)
          : armies.filter((a) => place.holders.includes(a.id)).map((a) => a.stratagems);
      const detachmentId = e.stratagem
        ? e.stratagem.detachmentId
        : root === CORE_ROOT
          ? null
          : armies.find((a) => a.id === root)?.stratagems.find((s) => s.id === name)?.detachmentId;
      for (const list of lists) {
        let s = list.find((x) => x.id === name && x.detachmentId === detachmentId);
        if (e.stratagem) {
          // Ses champs structurés viennent tous de la Contribution : ceux qu'elle omet tombent.
          if (s) for (const k of ['category', 'target'] as const) delete s[k];
          else list.push((s = { id: name, ...e.stratagem }));
          Object.assign(s, e.stratagem);
          list.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
        }
        if (s) take(s);
      }
    }
    if (refused !== undefined)
      contributions.push({ target: e.target, reason: e.reason, state: 'rejected', note: `${hits ? 'created, the rest set aside' : 'the target is not in the Dataset'}: ${refused}` });
    else if (!hits) {
      unresolved.push(e.target);
      contributions.push({ target: e.target, reason: e.reason, state: 'unresolved', note: 'the target is not in the Dataset' });
    } else if (missingAbilities.size)
      contributions.push({
        target: e.target,
        reason: e.reason,
        state: 'flagged',
        note: `not an ability of the Unit any more, left out: ${[...missingAbilities].join(', ')}`,
      });
    else contributions.push({ target: e.target, reason: e.reason, state: 'active', note: 'applied' });
  }
  return { unresolved, rejected, contributions, wargearLinks };
}
