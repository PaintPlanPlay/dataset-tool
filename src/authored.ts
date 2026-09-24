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
import type { ArmyFile, BattleSize, CoreFile, Effect, EffectScope, ReferenceTarget, SampleList, SampleSection, SampleUnit, Unit, WargearCount } from '@paintplanplay/dataset-schema';
import { validateEffect } from '@paintplanplay/dataset-schema/validate';
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
 * Une Contribution (ADR 0010) : un Effect ou un résumé écrit par le projet —
 * jamais un texte recopié. Elle prime définitivement sur 40kdc-data.
 * Adresses : `<unitId>::ability:<nom>`, `<armyId>::rule:<detachmentId>|<ruleId>`,
 * `<armyId>::enhancement:<detachmentId>|<enhancementId>`, `<armyId>::stratagem:<id>`,
 * `core::stratagem:<id>`.
 */
export interface AuthoredEffect {
  target: string;
  effect?: unknown;
  /** Portée de l'Effect (range, durée), au format de 40kdc-data. */
  scope?: unknown;
  summary?: string;
  /** Pourquoi, en une phrase à nous. */
  reason: string;
  /**
   * Empreinte de ce que disait l'amont (Effect et résumé) quand on l'a écrite.
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
const upstreamOf = (el: { effect?: unknown; summary?: string }) => fingerprint({ effect: el.effect, summary: el.summary });

export interface AuthoredCore {
  effects?: AuthoredEffect[];
  battleSizes: BattleSize[];
  /** Par Army et nom d'Unit. */
  referenceTargets: { army: string; unit: string; models: number }[];
  sampleList?: { army: string; name: string; detachment: string; battleSize: number; units: AuthoredSampleUnit[] };
}

export const authoredDir = (gameSystem: string) => `authored/${gameSystem}`;
export const EFFECTS_FILE = 'effects.json';

export function readAuthored(datasetDir: string, gameSystem: string): AuthoredCore | undefined {
  const dir = join(datasetDir, authoredDir(gameSystem));
  const read = <T>(file: string): T | undefined =>
    existsSync(join(dir, file)) ? (JSON.parse(readFileSync(join(dir, file), 'utf8')) as T) : undefined;
  const battleSizes = read<BattleSize[]>('battle-sizes.json');
  const referenceTargets = read<AuthoredCore['referenceTargets']>('reference-targets.json');
  const sampleList = read<NonNullable<AuthoredCore['sampleList']>>('sample-list.json');
  const effects = read<AuthoredEffect[]>(EFFECTS_FILE);
  if (!battleSizes && !referenceTargets && !sampleList && !effects) return undefined;
  return {
    battleSizes: battleSizes ?? [],
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

  return {
    battleSizes: [...(authored?.battleSizes ?? [])].sort((a, b) => a.points - b.points),
    referenceTargets,
    ...(sampleList ? { sampleList } : {}),
    unresolved,
  };
}

/** Ce qui empêche de publier un Effect ou un résumé écrit par le projet ; vide s'il passe. */
export function authoredEffectProblems(e: AuthoredEffect): string[] {
  const problems: string[] = [];
  if (e.effect === undefined && e.summary === undefined) problems.push('neither Effect nor summary');
  if (e.effect !== undefined) problems.push(...validateEffect(e.effect, e.scope).map((m) => `Effect outside the frozen format: ${m}`));
  if (e.summary !== undefined) problems.push(...inspectString(e.summary, { summary: true }));
  if (!e.reason?.trim()) problems.push('reason missing');
  else problems.push(...inspectString(e.reason));
  return problems;
}

/**
 * Pose les Effects et résumés écrits par le projet sur les fichiers construits.
 * Un Effect remplace celui de l'amont (une aptitude passe en `effectSource:
 * 'project'`) ; un résumé seul s'ajoute sans toucher à l'Effect.
 */
export function applyAuthoredEffects(
  files: Map<string, unknown>,
  gameSystem: string,
  effects: AuthoredEffect[],
): { unresolved: string[]; rejected: { target: string; reason: string }[]; contributions: ContributionVerdict[] } {
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
      ...(e.effect !== undefined ? { effect: e.effect as Effect } : {}),
      ...(e.scope !== undefined ? { scope: e.scope as EffectScope } : {}),
      ...(e.summary !== undefined ? { summary: e.summary } : {}),
    };
    const { root, entity, name } = parseTarget(e.target);
    let hits = 0;
    // L'amont se lit avant d'être recouvert : c'est lui que l'empreinte compare.
    let upstreamNow: string | undefined;
    const take = (el: { effect?: unknown; summary?: string }) => {
      upstreamNow ??= upstreamOf(el);
      Object.assign(el, body);
      hits++;
    };
    if (entity === 'ability') {
      for (const a of armies)
        for (const u of a.units)
          if (u.id === root)
            for (const ab of u.abilities)
              if (ab.name === name) {
                take(ab);
                if (e.effect !== undefined) {
                  ab.effectSource = 'project';
                  delete ab.conditional;
                }
              }
    } else if (entity === 'rule' || entity === 'enhancement') {
      const [detachmentId, elementId] = name.split('|');
      for (const a of armies)
        if (a.id === root)
          for (const d of a.detachments)
            if (d.id === detachmentId)
              for (const el of entity === 'rule' ? d.rules : d.enhancements)
                if (el.id === elementId) take(el);
    } else if (entity === 'stratagem') {
      const list = root === CORE_ROOT ? (core?.stratagems ?? []) : (armies.find((a) => a.id === root)?.stratagems ?? []);
      for (const s of list) if (s.id === name) take(s);
    }
    if (!hits) {
      unresolved.push(e.target);
      contributions.push({ target: e.target, reason: e.reason, state: 'unresolved', note: 'the target is not in the Dataset' });
    } else if (e.upstream && e.upstream !== upstreamNow)
      contributions.push({ target: e.target, reason: e.reason, state: 'flagged', note: '40kdc-data changed this rule since the Contribution was written: review it, it stays applied', upstreamNow });
    else contributions.push({ target: e.target, reason: e.reason, state: 'active', note: 'applied, over 40kdc-data', upstreamNow });
  }
  return { unresolved, rejected, contributions };
}
