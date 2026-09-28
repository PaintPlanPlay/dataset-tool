/**
 * Les fiches de la nouvelle interface : lire une entité avec la provenance de
 * ses valeurs, valider un brouillon, et l'enregistrer.
 *
 * Enregistrer, c'est comparer le brouillon à l'état construit et découper
 * l'écart : une Correction par élément visé et par Upstream Source qui fait
 * autorité sur le champ (ADR 0007), une Contribution pour ce que fait une règle
 * (ADR 0010). Le mainteneur ne choisit jamais : c'est le domaine du champ qui
 * décide. Les fichiers sont nommés ici, contrôlés (schéma, aucun texte de
 * règles), puis écrits tout ou rien.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { canonicalWeaponKeyword, SIMULATED_CONDITIONS, SIMULATED_MODIFIERS, type ArmyFile, type BattleSize, type CoreFile, type Detachment, type Enhancement, type OptionGroup, type Stratagem, type Unit, type Weapon, type WeaponOption } from '@paintplanplay/dataset-schema';
import { validateDef, validateFile, type FieldError } from '@paintplanplay/dataset-schema/validate';
import { authoredDir, authoredEffectProblems, EFFECTS_FILE, fingerprint, type AuthoredEffect } from '../authored.ts';
import { parseRangeInches } from '../bsdata/flatten.ts';
import { weaponRef } from '../bsdata/types.ts';
import { ADD, CORE_ROOT, DELETE, parseTarget } from '../corrections/apply.ts';
import { correctionsDir, readCorrections, type Correction, type CorrectionFile } from '../corrections/files.ts';
import { sameValue } from '../corrections/lifecycle.ts';
import { normalizeModel, normalizeProfile } from '../corrections/normalize.ts';
import { toJson } from '../dataset.ts';
import { findRulesText, inspectString } from '../notext.ts';
import { modifiersIn } from '../rules.ts';
import { ApiError, datasetOf, refreshing } from './api.ts';
import { inspect, type DatasetView, type Inspection, type Origin } from './provenance.ts';
import { sheetOfTarget } from './targets.ts';
import type { Workspace } from './workspace.ts';
import { optionTarget, type WargearFinding } from '../wargear.ts';

type Source = Correction['source'];
type Value = Record<string, unknown>;

// ------------------------------------------------------------------ autorité

/** La source qui fait autorité sur chaque section d'une fiche : ce que dit l'en-tête (« Prices · MFM »). */
const SECTION_SOURCES: Record<Inspection['kind'], Record<string, Origin>> = {
  unit: {
    name: 'bsdata', isLegends: 'bsdata', ally: 'bsdata', keywords: 'bsdata', factionKeywords: 'bsdata', armyRules: 'bsdata',
    models: 'bsdata', composition: 'bsdata', minModels: 'bsdata', maxModels: 'bsdata', defaultModels: 'bsdata',
    weapons: 'bsdata', optionGroups: 'bsdata', defaultLoadout: 'bsdata', abilities: 'project',
    points: 'mfm', costBrackets: 'mfm', pricing: 'mfm', wargear: 'mfm', leaderTargets: 'mfm', supportTargets: 'mfm',
  },
  detachment: { name: 'mfm', dp: 'mfm', forceDispositions: 'mfm', uniqueTag: 'mfm', rules: 'project', enhancements: '40kdc' },
  stratagem: {
    name: '40kdc', cp: '40kdc', phases: '40kdc', playerTurn: '40kdc', timing: '40kdc', category: '40kdc', target: '40kdc',
    modifiers: 'project', options: 'project', summary: 'project',
  },
  armyRule: { name: 'bsdata', modifiers: 'project', options: 'project', summary: 'project' },
  core: { battleSizes: 'project', stratagems: '40kdc' },
};

/** Champs d'Unit corrigés à même l'Unit, par source. Les autres ont leur propre adresse ou sont dérivés. */
const UNIT_FIELDS: Record<string, Source> = {
  name: 'bsdata', isLegends: 'bsdata', ally: 'bsdata', keywords: 'bsdata', factionKeywords: 'bsdata', armyRules: 'bsdata',
  composition: 'bsdata', optionGroups: 'bsdata', defaultLoadout: 'bsdata', pricing: 'mfm', wargear: 'mfm',
};
const DETACHMENT_FIELDS: Record<string, Source> = { name: 'mfm', dp: 'mfm', forceDispositions: 'mfm', uniqueTag: 'mfm' };
const ENHANCEMENT_FIELDS: Record<string, Source> = {
  points: 'mfm', leaderTo: 'mfm', supportTo: 'mfm',
  name: '40kdc', appliesTo: '40kdc', aura: '40kdc', maxTargets: '40kdc', requires: '40kdc', excludes: '40kdc',
};
const STRATAGEM_FIELDS: Record<string, Source> = {
  name: '40kdc', cp: '40kdc', phases: '40kdc', playerTurn: '40kdc', timing: '40kdc', category: '40kdc', target: '40kdc',
};
/** Ce qu'une Contribution porte : ce qu'une règle fait, jamais ses chiffres. */
const RULE_BODY = ['modifiers', 'options', 'eligibility', 'summary'] as const;
/** Ce qu'une Contribution porte pour une Wargear Option : sa ligne du MFM, ce qu'elle apporte, et l'option elle-même quand on l'a créée. */
const OPTION_BODY = ['wargearCost', 'abilities', 'option'] as const;
/** Ce qu'une Contribution porte pour une Enhancement, en plus de ce que fait sa règle : sa Weapon. */
const ENHANCEMENT_BODY = ['weapon'] as const;

// -------------------------------------------------------------------- lire

/** Une marque sur une valeur que le Dataset ne tient pas tel quel de l'amont. */
export interface Mark {
  /** Pointeur JSON dans la valeur de la fiche. */
  path: string;
  kind: 'correction' | 'contribution';
  /** Le fichier qui la porte. */
  file: string;
  reason: string;
  /** Active, périmée, en conflit ; signalée pour une Contribution dont l'amont a bougé. */
  state: string;
  upstream?: unknown;
  value?: unknown;
}

export interface Sheet extends Inspection {
  /** La source d'autorité de chaque section. */
  sources: Record<string, Origin>;
  marks: Mark[];
  /** Pour une Unit : ses lignes `wargear` du MFM qu'aucune Wargear Option ne facture, et ses liens manuels qui ne visent plus rien. */
  wargear: WargearFinding[];
}

/** Une liste vide vaut une liste absente : l'interface montre `[]` là où le Dataset ne dit rien. */
const same = sameValue;

const indexBy = <T>(list: T[] | undefined, key: (t: T) => string, wanted: string) => (list ?? []).findIndex((t) => key(t) === wanted);

/** Où, dans la valeur d'une fiche, vit l'élément qu'une adresse vise. */
function pathOf(kind: Inspection['kind'], value: Value, target: string): string | null {
  const { entity, name } = parseTarget(target);
  const at = (field: string, i: number) => (i < 0 ? null : `/${field}/${i}`);
  if (kind === 'unit') {
    const u = value as unknown as Unit;
    if (entity === 'unit') return '';
    if (entity === 'model') return at('models', indexBy(u.models, (m) => m.name, name));
    if (entity === 'weapon') return at('weapons', indexBy(u.weapons, weaponRef, name));
    if (entity === 'ability') return at('abilities', indexBy(u.abilities, (a) => a.name, name));
    if (entity === 'attachment') return `/${name.startsWith('support|') ? 'supportTargets' : 'leaderTargets'}`;
    if (entity === 'option') {
      const [groupId, optionId] = name.split('|');
      const gi = indexBy(u.optionGroups, (g) => g.id, groupId);
      const oi = gi < 0 ? -1 : indexBy(u.optionGroups![gi].options, (o) => o.id, optionId);
      return oi < 0 ? null : `/optionGroups/${gi}/options/${oi}`;
    }
  }
  if (kind === 'detachment') {
    const d = value as unknown as Detachment;
    const [, elementId] = name.split('|');
    if (entity === 'detachment') return '';
    if (entity === 'enhancement') return at('enhancements', indexBy(d.enhancements, (e) => e.id, elementId));
    if (entity === 'rule') return at('rules', indexBy(d.rules, (r) => r.id, elementId));
  }
  if (kind === 'stratagem' || kind === 'armyRule') return '';
  if (kind === 'core' && entity === 'stratagem') return at('stratagems', indexBy((value as unknown as CoreFile).stratagems, (s) => s.id, name));
  return null;
}

export function sheetOf(ws: Workspace, target: string): Sheet {
  const view = datasetOf(ws);
  const found = inspect(view, ws.bare, target);
  if (!found) throw new ApiError(404, `not found: ${target}`);
  const value = found.value as Value;
  const marks: Mark[] = [];
  const verdicts = new Map(view.corrections.map((v) => [v.path, v]));

  for (const c of existsSync(ws.datasetDir) ? readCorrections(ws.datasetDir, ws.gameSystem) : []) {
    if (sheetOfTarget(c.target) !== found.target) continue;
    const base = pathOf(found.kind, value, c.target);
    if (base === null || c.patch[DELETE] === true) continue;
    const state = verdicts.get(c.path)?.state ?? 'active';
    const keys = Object.keys(c.patch).filter((k) => k !== ADD);
    const mark = { kind: 'correction' as const, file: c.path, reason: c.reason, state };
    if (c.patch[ADD] === true || parseTarget(c.target).entity === 'attachment') marks.push({ ...mark, path: base });
    else for (const k of keys) marks.push({ ...mark, path: `${base}/${k}`, upstream: c.upstream?.[k], value: c.patch[k] });
  }

  const contributions = new Map((view.contributions ?? []).map((v) => [v.target, v]));
  for (const e of readEffects(ws)) {
    if (sheetOfTarget(e.target) !== found.target) continue;
    const base = pathOf(found.kind, value, e.target);
    if (base === null) continue;
    const state = contributions.get(e.target)?.state ?? 'active';
    for (const k of [...RULE_BODY, ...ENHANCEMENT_BODY, ...OPTION_BODY.filter((f) => f !== 'option')] as const)
      if (e[k] !== undefined) marks.push({ path: `${base}/${k}`, kind: 'contribution', file: effectsPath(ws), reason: e.reason, state, value: e[k] });
    // Une Wargear Option créée est tout entière une Contribution.
    if (e.option !== undefined) marks.push({ path: base, kind: 'contribution', file: effectsPath(ws), reason: e.reason, state, value: e.option });
  }

  const wargear = found.kind === 'unit' ? (view.wargear ?? []).filter((f) => f.unitId === found.target) : [];
  return { ...found, sources: SECTION_SOURCES[found.kind], marks, wargear };
}

// ------------------------------------------------------------------ valider

export interface DraftCheck {
  /** Ce que le schéma refuse : l'enregistrement le refusera aussi. */
  errors: FieldError[];
  /** Ce qui ressemble à du texte de règles : une alerte en direct, un refus à l'enregistrement. */
  warnings: FieldError[];
}

export function checkDraft(kind: Inspection['kind'], draft: unknown): DraftCheck {
  let errors: FieldError[];
  if (kind === 'core') {
    const core = (draft ?? {}) as Partial<CoreFile>;
    errors = [
      ...(Array.isArray(core.battleSizes) ? core.battleSizes.flatMap((b, i) => validateDef('battleSize', b).map((e) => ({ ...e, path: `/battleSizes/${i}${e.path}` }))) : [{ path: '/battleSizes', message: 'must be array' }]),
      ...(Array.isArray(core.stratagems) ? core.stratagems.flatMap((s, i) => validateDef('stratagem', s).map((e) => ({ ...e, path: `/stratagems/${i}${e.path}` }))) : [{ path: '/stratagems', message: 'must be array' }]),
    ];
  } else errors = validateDef(kind === 'armyRule' ? 'rule' : kind, draft);
  const warnings = findRulesText(draft).map((f) => ({ path: f.where === '/' ? '' : f.where, message: f.reason }));
  return { errors, warnings };
}

// -------------------------------------------------------------- découper

/** Une Correction à écrire : l'écart sur un élément, pour une source. */
interface CorrectionChange {
  target: string;
  source: Source;
  patch: Value;
  /** Ce que disait l'amont sur les champs forcés. */
  upstream: Value;
  /** Pour nommer le fichier. */
  label: string;
}

interface ContributionChange {
  target: string;
  body: Value;
  /** L'élément tel qu'il est construit : ce que l'empreinte de l'amont décrit, faute de mieux. */
  current: Value | undefined;
  /** La Contribution disparaît : une Wargear Option créée qu'on retire. */
  remove?: boolean;
}

interface Plan {
  corrections: CorrectionChange[];
  contributions: ContributionChange[];
  battleSizes?: BattleSize[];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'x';

/** Regroupe les champs changés d'un élément par source d'autorité. */
function fieldChanges(target: string, label: string, fields: Record<string, Source>, current: Value, upstream: Value | undefined, draft: Value): CorrectionChange[] {
  const bySource = new Map<Source, CorrectionChange>();
  for (const [field, source] of Object.entries(fields)) {
    if (same(draft[field], current[field])) continue;
    const change = bySource.get(source) ?? bySource.set(source, { target, source, patch: {}, upstream: {}, label }).get(source)!;
    change.patch[field] = draft[field];
    change.upstream[field] = (upstream ?? current)[field];
  }
  return [...bySource.values()];
}

/** Ce qu'une règle fait a changé : une Contribution, avec seulement ce qui a bougé. */
function bodyChange(target: string, current: Value | undefined, draft: Value, fields: readonly string[] = RULE_BODY): ContributionChange | null {
  const body: ContributionChange['body'] = {};
  for (const k of fields) if (!same(draft[k], current?.[k]) && draft[k] !== undefined) body[k] = draft[k];
  if (!Object.keys(body).length) return null;
  return { target, body, current };
}

/**
 * Les éléments d'une liste, appariés par clé : ajoutés, retirés, présents des
 * deux côtés.
 */
function pair<T>(current: T[] = [], draft: T[] = [], key: (t: T) => string) {
  const before = new Map(current.map((t) => [key(t), t]));
  const after = new Map(draft.map((t) => [key(t), t]));
  return {
    added: [...after].filter(([k]) => !before.has(k)).map(([, t]) => t),
    removed: [...before].filter(([k]) => !after.has(k)).map(([, t]) => t),
    kept: [...after].filter(([k]) => before.has(k)).map(([k, t]) => [before.get(k)!, t] as const),
  };
}

const without = (v: Value, ...keys: string[]) => Object.fromEntries(Object.entries(v).filter(([k]) => !keys.includes(k)));

/** La portée en pouces ne se saisit pas : elle suit la portée, elle-même en pouces sans qu'on les tape. */
const normalizeWeapon = (w: Weapon): Weapon => ({
  ...w,
  profiles: w.profiles.map((p) => {
    const q = normalizeProfile(p);
    return { ...q, rangeInches: parseRangeInches(q.range) };
  }),
});

/**
 * Le brouillon tel qu'on l'enregistre : unités des caractéristiques posées, et
 * forme juste pour les seuls mots-clés d'arme qu'on vient d'ajouter — ceux que
 * la Weapon portait déjà restent écrits comme BSData les écrit.
 */
function normalizeDraft(kind: Inspection['kind'], current: Value, draft: Value): Value {
  // La Weapon qu'une Enhancement apporte se range comme toute Weapon : portée en pouces suivant la portée.
  if (kind === 'detachment') {
    const d = draft as unknown as Detachment;
    return { ...draft, enhancements: (d.enhancements ?? []).map((e) => (e.weapon ? { ...e, weapon: normalizeWeapon(e.weapon) } : e)) };
  }
  if (kind !== 'unit') return draft;
  const u = draft as unknown as Unit;
  const was = new Map(((current as unknown as Unit).weapons ?? []).map((w) => [weaponRef(w), w]));
  const weapons = (u.weapons ?? []).map((w) => {
    const before = was.get(weaponRef(w));
    return normalizeWeapon({
      ...w,
      profiles: w.profiles.map((p, i) => {
        const known = new Set((before?.profiles.find((x) => x.name === p.name) ?? before?.profiles[i])?.keywords ?? []);
        return { ...p, keywords: p.keywords.map((k) => (known.has(k) ? k : (canonicalWeaponKeyword(k) ?? k))) };
      }),
    });
  });
  return { ...draft, models: (u.models ?? []).map(normalizeModel), weapons };
}

/** Les Wargear Options d'une Unit, par adresse. */
const optionsByTarget = (u: Unit | undefined) =>
  new Map((u?.optionGroups ?? []).flatMap((g) => g.options.map((o) => [optionTarget(u!.id, g.id, o.id), o] as const)));

/** Ce qu'une option porte en propre : la forme que BSData et ses Corrections décrivent, sans ce qui est à nous. */
const ownOption = (o: WeaponOption) => without(o as unknown as Value, 'id', 'wargearCost', 'abilities');

/**
 * Les groupes d'options tels qu'une Correction les voit : sans les liens au MFM
 * ni les aptitudes apportées, et sans les options qui sont à nous — celles
 * qu'une Contribution a créées, ou qu'on crée.
 */
function correctedGroups(u: Unit | undefined, ours: Set<string>): Value | undefined {
  if (!u) return undefined;
  const optionGroups: OptionGroup[] | undefined = u.optionGroups?.map((g) => ({
    ...g,
    options: g.options
      .filter((o) => !ours.has(optionTarget(u.id, g.id, o.id)))
      .map((o) => without(o as unknown as Value, 'wargearCost', 'abilities') as unknown as WeaponOption),
  }));
  return { ...(u as unknown as Value), optionGroups };
}

/**
 * Ce qu'on règle sur une Wargear Option et qui est à nous (ADR 0010) : sa ligne
 * du MFM, les aptitudes qu'elle apporte, et l'option entière quand BSData ne
 * l'a pas. Une option créée qu'on retire emporte sa Contribution.
 */
function optionContributions(current: Unit, draft: Unit, created: Set<string>): ContributionChange[] {
  const before = optionsByTarget(current);
  const after = optionsByTarget(draft);
  const out: ContributionChange[] = [];
  for (const [target, now] of after) {
    const was = before.get(target);
    const body: Value = {};
    if (!was || (created.has(target) && !same(ownOption(now), ownOption(was)))) body.option = ownOption(now);
    if (!same(now.wargearCost, was?.wargearCost)) body.wargearCost = now.wargearCost ?? null;
    if (!same(now.abilities, was?.abilities)) body.abilities = now.abilities ?? [];
    if (Object.keys(body).length) out.push({ target, body, current: was as unknown as Value | undefined });
  }
  for (const target of before.keys()) if (!after.has(target) && created.has(target)) out.push({ target, body: {}, current: undefined, remove: true });
  return out;
}

function unitPlan(current: Unit, upstream: Unit | undefined, draft: Unit, created: Set<string> = new Set()): Plan {
  const id = current.id;
  const plan: Plan = { corrections: [], contributions: [] };
  const ours = new Set([...created, ...[...optionsByTarget(draft).keys()].filter((t) => !optionsByTarget(current).has(t))]);
  plan.corrections.push(
    ...fieldChanges(id, 'unit', UNIT_FIELDS, correctedGroups(current, ours)!, correctedGroups(upstream, ours), correctedGroups(draft, ours)!),
  );
  plan.contributions.push(...optionContributions(current, draft, created));

  for (const [field, kind] of [['leaderTargets', 'leader'], ['supportTargets', 'support']] as const) {
    const { added, removed } = pair(current[field], draft[field], (n) => n);
    for (const name of added) plan.corrections.push({ target: `${id}::attachment:${kind}|${name}`, source: 'mfm', patch: { [ADD]: true }, upstream: {}, label: `${kind}-${name}` });
    for (const name of removed) plan.corrections.push({ target: `${id}::attachment:${kind}|${name}`, source: 'mfm', patch: { [DELETE]: true }, upstream: {}, label: `${kind}-${name}` });
  }

  const models = pair(current.models, draft.models, (m) => m.name);
  for (const m of models.added) plan.corrections.push({ target: `${id}::model:${m.name}`, source: 'bsdata', patch: { [ADD]: true, ...without(m as unknown as Value, 'name') }, upstream: {}, label: `model-${m.name}` });
  for (const m of models.removed) plan.corrections.push({ target: `${id}::model:${m.name}`, source: 'bsdata', patch: { [DELETE]: true }, upstream: m as unknown as Value, label: `model-${m.name}` });
  for (const [was, now] of models.kept) {
    const fields = Object.fromEntries(Object.keys({ ...was, ...now }).filter((k) => k !== 'name').map((k) => [k, 'bsdata' as Source]));
    const up = upstream?.models.find((m) => m.name === was.name) as unknown as Value | undefined;
    plan.corrections.push(...fieldChanges(`${id}::model:${was.name}`, `model-${was.name}`, fields, was as unknown as Value, up, now as unknown as Value));
  }

  const weapons = pair(current.weapons, draft.weapons.map(normalizeWeapon), weaponRef);
  const weaponFields: Record<string, Source> = { profiles: 'bsdata', maxCarriers: 'bsdata' };
  for (const w of weapons.added)
    plan.corrections.push({ target: `${id}::weapon:${weaponRef(w)}`, source: 'bsdata', patch: { [ADD]: true, ...without(w as unknown as Value, 'name', 'kind') }, upstream: {}, label: `weapon-${w.name}` });
  for (const w of weapons.removed) plan.corrections.push({ target: `${id}::weapon:${weaponRef(w)}`, source: 'bsdata', patch: { [DELETE]: true }, upstream: w as unknown as Value, label: `weapon-${w.name}` });
  for (const [was, now] of weapons.kept) {
    const up = upstream?.weapons.find((w) => weaponRef(w) === weaponRef(was)) as unknown as Value | undefined;
    plan.corrections.push(...fieldChanges(`${id}::weapon:${weaponRef(was)}`, `weapon-${was.name}`, weaponFields, was as unknown as Value, up, now as unknown as Value));
  }

  const abilities = pair(current.abilities, draft.abilities, (a) => a.name);
  for (const a of abilities.added) {
    const target = `${id}::ability:${a.name}`;
    plan.corrections.push({ target, source: 'bsdata', patch: { [ADD]: true }, upstream: {}, label: `ability-${a.name}` });
    const body = bodyChange(target, undefined, a as unknown as Value);
    if (body) plan.contributions.push(body);
  }
  for (const a of abilities.removed) plan.corrections.push({ target: `${id}::ability:${a.name}`, source: 'bsdata', patch: { [DELETE]: true }, upstream: { name: a.name }, label: `ability-${a.name}` });
  for (const [was, now] of abilities.kept) {
    const body = bodyChange(`${id}::ability:${was.name}`, was as unknown as Value, now as unknown as Value);
    if (body) plan.contributions.push(body);
  }
  return plan;
}

function detachmentPlan(army: string, current: Detachment, upstream: Detachment | undefined, draft: Detachment): Plan {
  const plan: Plan = { corrections: [], contributions: [] };
  const target = `${army}::detachment:${current.id}`;
  plan.corrections.push(...fieldChanges(target, 'detachment', DETACHMENT_FIELDS, current as unknown as Value, upstream as unknown as Value, draft as unknown as Value));

  for (const [was, now] of pair(current.rules, draft.rules, (r) => r.id).kept) {
    const body = bodyChange(`${army}::rule:${current.id}|${was.id}`, was as unknown as Value, now as unknown as Value);
    if (body) plan.contributions.push(body);
  }

  const enhancements = pair(current.enhancements, draft.enhancements, (e) => e.id);
  const enhTarget = (e: Enhancement) => `${army}::enhancement:${current.id}|${e.id}`;
  for (const e of enhancements.added) {
    plan.corrections.push({ target: enhTarget(e), source: 'mfm', patch: { [ADD]: true, ...without(e as unknown as Value, 'id', ...RULE_BODY, ...ENHANCEMENT_BODY) }, upstream: {}, label: `enhancement-${e.name}` });
    const body = bodyChange(enhTarget(e), undefined, e as unknown as Value, [...RULE_BODY, ...ENHANCEMENT_BODY]);
    if (body) plan.contributions.push(body);
  }
  for (const e of enhancements.removed) plan.corrections.push({ target: enhTarget(e), source: 'mfm', patch: { [DELETE]: true }, upstream: {}, label: `enhancement-${e.name}` });
  for (const [was, now] of enhancements.kept) {
    const up = upstream?.enhancements.find((e) => e.id === was.id) as unknown as Value | undefined;
    plan.corrections.push(...fieldChanges(enhTarget(was), `enhancement-${was.name}`, ENHANCEMENT_FIELDS, was as unknown as Value, up, now as unknown as Value));
    const body = bodyChange(enhTarget(was), was as unknown as Value, now as unknown as Value, [...RULE_BODY, ...ENHANCEMENT_BODY]);
    // Retirer la Weapon d'une Enhancement : la Contribution la perd.
    if (was.weapon && !now.weapon) plan.contributions.push({ target: enhTarget(was), body: { ...(body?.body ?? {}), weapon: null }, current: was as unknown as Value });
    else if (body) plan.contributions.push(body);
  }
  return plan;
}

function stratagemPlan(root: string, current: Stratagem, upstream: Stratagem | undefined, draft: Stratagem): Plan {
  const target = `${root}::stratagem:${current.id}`;
  const body = bodyChange(target, current as unknown as Value, draft as unknown as Value);
  return {
    corrections: fieldChanges(target, `stratagem-${current.name}`, STRATAGEM_FIELDS, current as unknown as Value, upstream as unknown as Value, draft as unknown as Value),
    contributions: body ? [body] : [],
  };
}

/** Une Army Rule : son nom vient de BSData ; ce qu'elle fait est une Contribution. */
function armyRulePlan(target: string, current: Value, draft: Value): Plan {
  if (!same(draft.name, current.name)) throw new ApiError(400, 'the name of an Army Rule comes from BSData: correct it on its Units');
  const body = bodyChange(target, current, draft);
  return { corrections: [], contributions: body ? [body] : [] };
}

function corePlan(current: CoreFile, upstream: CoreFile | undefined, draft: CoreFile): Plan {
  const plan: Plan = { corrections: [], contributions: [] };
  if (!same(current.battleSizes, draft.battleSizes)) plan.battleSizes = draft.battleSizes;
  for (const [was, now] of pair(current.stratagems, draft.stratagems, (s) => s.id).kept) {
    const sub = stratagemPlan(CORE_ROOT, was, upstream?.stratagems.find((s) => s.id === was.id), now);
    plan.corrections.push(...sub.corrections);
    plan.contributions.push(...sub.contributions);
  }
  return plan;
}

// --------------------------------------------------------------- vérifier

/** Les Units d'une Army, par nom : les seules qu'un rattachement puisse viser. */
function armyUnits(view: DatasetView, army: string): Unit[] {
  return (view.files.get(`${view.gameSystem}/armies/${army}.json`) as ArmyFile | undefined)?.units ?? [];
}

/** Ce que le brouillon désigne et qui n'existe pas : un rattachement, une Weapon d'option. */
function danglingReferences(kind: Inspection['kind'], view: DatasetView, army: string, current: Value, draft: Value): string[] {
  const names = new Set(armyUnits(view, army).map((u) => u.name));
  const out: string[] = [];
  const addedNames = (field: string, was: unknown, now: unknown, where: string) => {
    const before = new Set((was as string[] | undefined) ?? []);
    for (const n of (now as string[] | undefined) ?? []) if (!before.has(n) && !names.has(n)) out.push(`${where}/${field}: "${n}" is not a Unit of this Army`);
  };
  if (kind === 'unit') {
    const d = draft as unknown as Unit;
    const c = current as unknown as Unit;
    // Un mot-clé d'arme ajouté vient de la liste des règles ; ceux que BSData écrit déjà restent.
    (d.weapons ?? []).forEach((w, wi) => {
      const was = (c.weapons ?? []).find((x) => weaponRef(x) === weaponRef(w));
      w.profiles.forEach((p, pi) => {
        const before = new Set((was?.profiles.find((x) => x.name === p.name) ?? was?.profiles[pi])?.keywords ?? []);
        for (const k of p.keywords)
          if (!before.has(k) && !canonicalWeaponKeyword(k)) out.push(`/weapons/${wi}/profiles/${pi}/keywords: "${k}" is not a weapon keyword of the rules`);
      });
    });
    addedNames('leaderTargets', c.leaderTargets, d.leaderTargets, '');
    addedNames('supportTargets', c.supportTargets, d.supportTargets, '');
    const weapons = new Set((d.weapons ?? []).map(weaponRef));
    // Ce que l'amont laissait déjà pendre (une Weapon écartée à l'aplatissement) ne se reproche pas au mainteneur.
    const owned = new Set((c.weapons ?? []).map(weaponRef));
    const known = new Set((c.optionGroups ?? []).flatMap((g) => g.options.flatMap((o) => o.weapons)).filter((r) => !owned.has(r)));
    // Un lien au MFM désigne une ligne `wargear` de l'Unit, une aptitude apportée une aptitude de l'Unit.
    const lines = new Set((d.wargear ?? []).map((w) => w.item));
    const abilities = new Set((d.abilities ?? []).map((a) => a.name));
    const before = optionsByTarget(c);
    (d.optionGroups ?? []).forEach((g, gi) =>
      g.options.forEach((o, oi) => {
        for (const r of o.weapons) if (!weapons.has(r) && !known.has(r)) out.push(`/optionGroups/${gi}/options/${oi}/weapons: "${r}" is not a Weapon of this Unit`);
        const was = before.get(optionTarget(d.id, g.id, o.id));
        if (o.wargearCost && !same(o.wargearCost, was?.wargearCost) && !lines.has(o.wargearCost.item))
          out.push(`/optionGroups/${gi}/options/${oi}/wargearCost: "${o.wargearCost.item}" is not an MFM wargear line of this Unit`);
        for (const a of o.abilities ?? []) if (!abilities.has(a)) out.push(`/optionGroups/${gi}/options/${oi}/abilities: "${a}" is not an ability of this Unit`);
      }),
    );
  }
  // Créer ou retirer une règle entière n'est pas une Correction : c'est une entité à nous, qui n'a pas encore sa place.
  const sameIds = (was: { id: string }[] | undefined, now: { id: string }[] | undefined) =>
    same((was ?? []).map((x) => x.id).sort(), (now ?? []).map((x) => x.id).sort());
  if (kind === 'detachment' && !sameIds((current as unknown as Detachment).rules, (draft as unknown as Detachment).rules))
    out.push('/rules: adding or removing a Detachment Rule is not supported yet');
  if (kind === 'core' && !sameIds((current as unknown as CoreFile).stratagems, (draft as unknown as CoreFile).stratagems))
    out.push('/stratagems: adding or removing a Core Stratagem is not supported yet');
  if (kind === 'detachment') {
    const before = new Map(((current as unknown as Detachment).enhancements ?? []).map((e) => [e.id, e]));
    ((draft as unknown as Detachment).enhancements ?? []).forEach((e, i) => {
      addedNames('leaderTo', before.get(e.id)?.leaderTo, e.leaderTo, `/enhancements/${i}`);
      addedNames('supportTo', before.get(e.id)?.supportTo, e.supportTo, `/enhancements/${i}`);
    });
  }
  return out;
}

// ----------------------------------------------------------------- écrire

export const effectsPath = (ws: Workspace) => `${authoredDir(ws.gameSystem)}/${EFFECTS_FILE}`;

export function readEffects(ws: Workspace): AuthoredEffect[] {
  const abs = join(ws.datasetDir, effectsPath(ws));
  return existsSync(abs) ? (JSON.parse(readFileSync(abs, 'utf8')) as AuthoredEffect[]) : [];
}

export interface SavedFile {
  path: string;
  kind: 'correction' | 'contribution';
  /** `deleted` : la valeur est revenue à celle de l'amont, la Correction n'a plus lieu d'être. */
  action: 'written' | 'deleted';
}

export interface SaveInput {
  target: string;
  draft: unknown;
  reason: string;
}

export async function saveSheet(ws: Workspace, input: SaveInput): Promise<{ files: SavedFile[] }> {
  const view = datasetOf(ws);
  const found = inspect(view, ws.bare, input.target);
  if (!found) throw new ApiError(404, `not found: ${input.target}`);
  const reason = String(input.reason ?? '').trim();
  if (!reason) throw new ApiError(400, 'a reason is needed');
  const reasonText = inspectString(reason);
  if (reasonText.length) throw new ApiError(400, 'the reason reads like rules text', reasonText);

  const draft = normalizeDraft(found.kind, found.value as Value, input.draft as Value);
  const check = checkDraft(found.kind, draft);
  if (check.errors.length) throw new ApiError(400, 'the sheet does not match the schema', check.errors.map((e) => `${e.path || '/'} ${e.message}`));
  if (check.warnings.length) throw new ApiError(400, 'rules text refused', check.warnings.map((w) => `${w.path || '/'} ${w.message}`));
  const current = found.value as Value;
  const dangling = danglingReferences(found.kind, view, found.army, current, draft);
  if (dangling.length) throw new ApiError(400, 'the sheet names something that does not exist', dangling);

  const upstream = (ws.bare ? inspect(ws.bare, null, input.target)?.value : undefined) as Value | undefined;
  const created = new Set(readEffects(ws).filter((e) => e.option !== undefined).map((e) => e.target));
  const plan =
    found.kind === 'unit'
      ? unitPlan(current as unknown as Unit, upstream as unknown as Unit, draft as unknown as Unit, created)
      : found.kind === 'detachment'
        ? detachmentPlan(found.army, current as unknown as Detachment, upstream as unknown as Detachment, draft as unknown as Detachment)
        : found.kind === 'stratagem'
          ? stratagemPlan(found.army, current as unknown as Stratagem, upstream as unknown as Stratagem, draft as unknown as Stratagem)
          : found.kind === 'armyRule'
            ? armyRulePlan(found.target, current, draft)
            : corePlan(current as unknown as CoreFile, upstream as unknown as CoreFile, draft as unknown as CoreFile);

  // Tout se prépare et se contrôle avant la première écriture : tout ou rien.
  const writes: { path: string; content: string | null; kind: SavedFile['kind'] }[] = [];
  const existing = existsSync(ws.datasetDir) ? readCorrections(ws.datasetDir, ws.gameSystem) : [];
  const taken = new Set(existing.map((c) => c.path));
  const armyDir = found.kind === 'core' ? CORE_ROOT : found.army;

  for (const change of plan.corrections) {
    const write = correctionWrite(ws, change, existing, reason, `${slug(found.name)}-${slug(change.label)}-${change.source}`, armyDir, taken);
    if (write) writes.push({ ...write, kind: 'correction' });
  }

  if (plan.contributions.length) {
    const byTarget = new Map(readEffects(ws).map((e) => [e.target, e]));
    const verdicts = new Map((view.contributions ?? []).map((v) => [v.target, v]));
    for (const c of plan.contributions) {
      const was = byTarget.get(c.target);
      if (c.remove) {
        byTarget.delete(c.target);
        continue;
      }
      // Une Wargear Option n'a pas d'amont dans 40kdc-data : rien à surveiller.
      const forRule = parseTarget(c.target).entity !== 'option';
      const upstreamNow = verdicts.get(c.target)?.upstreamNow ?? fingerprint({ effect: view.kdcEffects?.[c.target], summary: undefined });
      // Retoucher une Rule extraite, c'est l'avoir revue.
      const entry: AuthoredEffect = {
        ...(was ? without(was as unknown as Value, 'reason', 'upstream') : {}),
        ...c.body,
        target: c.target,
        reason,
        ...(forRule ? { upstream: upstreamNow } : {}),
        ...(was?.review ? { review: 'revu' } : {}),
      } as AuthoredEffect;
      // Une Weapon retirée sort de la Contribution ; une Contribution qui ne porte plus rien disparaît.
      if (entry.weapon === null) delete entry.weapon;
      const CARRIED = [...RULE_BODY, ...ENHANCEMENT_BODY, ...OPTION_BODY] as const;
      if (!CARRIED.some((k) => entry[k] !== undefined)) {
        byTarget.delete(c.target);
        continue;
      }
      const problems = authoredEffectProblems(entry);
      if (problems.length) throw new ApiError(400, `${c.target}: refused`, problems);
      byTarget.set(c.target, entry);
    }
    const next = [...byTarget.values()].sort((a, b) => a.target.localeCompare(b.target));
    // Plus aucune Contribution : le fichier disparaît, plutôt que de rester vide.
    writes.push({ path: effectsPath(ws), content: next.length ? toJson(next) : null, kind: 'contribution' });
  }

  if (plan.battleSizes) {
    const text = findRulesText(plan.battleSizes);
    if (text.length) throw new ApiError(400, 'rules text refused', text.map((t) => `${t.where} ${t.reason}`));
    // Les Battle Sizes sont à nous : une Contribution, comme un Effect.
    writes.push({ path: `${authoredDir(ws.gameSystem)}/battle-sizes.json`, content: toJson([...plan.battleSizes].sort((a, b) => a.points - b.points)), kind: 'contribution' });
  }

  for (const w of writes) {
    const abs = join(ws.datasetDir, w.path);
    if (w.content === null) rmSync(abs, { force: true });
    else {
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, w.content);
    }
  }
  void refreshing(ws);
  return { files: writes.map((w) => ({ path: w.path, kind: w.kind, action: w.content === null ? 'deleted' : 'written' })) };
}

/**
 * Le fichier d'une Correction. Une Correction existe déjà pour cet élément et
 * cette source, et force l'un des champs modifiés (ou ajoute, ou retire
 * l'élément) : elle absorbe l'écart, en gardant ce que l'amont disait quand on
 * l'a écrite. Un champ revenu à la valeur de l'amont en sort ; une Correction
 * qui ne force plus rien disparaît. Sinon, une nouvelle Correction : celle
 * d'à côté garde sa raison.
 */
function correctionWrite(
  ws: Workspace,
  change: CorrectionChange,
  existing: CorrectionFile[],
  reason: string,
  stem: string,
  armyDir: string,
  taken: Set<string>,
): { path: string; content: string | null } | null {
  const touches = (c: CorrectionFile) =>
    c.patch[ADD] === true || c.patch[DELETE] === true || change.patch[ADD] === true || change.patch[DELETE] === true || Object.keys(change.patch).some((k) => k in c.patch);
  const held = existing.find((c) => c.target === change.target && c.source === change.source && touches(c));
  let patch: Value = change.patch;
  let upstream: Value = change.upstream;
  if (held) {
    const heldAdds = held.patch[ADD] === true;
    const heldDeletes = held.patch[DELETE] === true;
    // Ajouter puis retirer, ou l'inverse : l'élément revient à ce que dit l'amont.
    if ((heldAdds && change.patch[DELETE] === true) || (heldDeletes && change.patch[ADD] === true)) return { path: held.path, content: null };
    patch = { ...held.patch, ...change.patch };
    upstream = { ...change.upstream, ...(held.upstream ?? {}) };
    if (!heldAdds)
      for (const k of Object.keys(patch)) if (k !== ADD && k !== DELETE && k in upstream && same(patch[k], upstream[k])) delete patch[k];
    if (Object.keys(patch).length === 0) return { path: held.path, content: null };
  }
  const kept = Object.fromEntries(Object.entries(upstream).filter(([k]) => k in patch));
  const correction: Correction = {
    target: change.target,
    source: change.source,
    patch,
    ...(Object.keys(kept).length && patch[ADD] !== true && patch[DELETE] !== true ? { upstream: kept } : {}),
    reason,
    ...(held?.upstreamPr ? { upstreamPr: held.upstreamPr } : {}),
  };
  const path = held?.path ?? freshPath(ws, armyDir, stem, taken);
  const schema = validateFile('correction', correction);
  if (schema.length) throw new ApiError(400, `${change.target}: the Correction does not match the schema`, schema);
  const text = findRulesText(correction, path);
  if (text.length) throw new ApiError(400, 'rules text refused', text.map((t) => `${t.where} ${t.reason}`));
  return { path, content: toJson(correction) };
}

function freshPath(ws: Workspace, armyDir: string, stem: string, taken: Set<string>): string {
  const base = `${correctionsDir(ws.gameSystem)}/${armyDir}/${stem}`;
  let path = `${base}.json`;
  for (let n = 2; taken.has(path) || existsSync(join(ws.datasetDir, path)); n++) path = `${base}-${n}.json`;
  taken.add(path);
  return path;
}

// -------------------------------------------------- Corrections (n)

export interface CorrectionItem {
  kind: 'correction' | 'contribution';
  /** Fichier du dépôt du Dataset. */
  path: string;
  target: string;
  sheet: string;
  source: Source | 'project';
  reason: string;
  state: string;
  note: string;
  patch?: Value;
  upstream?: Value;
  upstreamPr?: string;
}

/** Les Corrections et Contributions d'une fiche, ou de tout le Dataset ; `q` filtre sur l'adresse, le fichier et la raison. */
export function listCorrections(ws: Workspace, sheet = '', q = ''): CorrectionItem[] {
  const view = datasetOf(ws);
  const verdicts = new Map(view.corrections.map((v) => [v.path, v]));
  const contributions = new Map((view.contributions ?? []).map((v) => [v.target, v]));
  const items: CorrectionItem[] = [
    ...readCorrections(ws.datasetDir, ws.gameSystem).map((c): CorrectionItem => ({
      kind: 'correction',
      path: c.path,
      target: c.target,
      sheet: sheetOfTarget(c.target),
      source: c.source,
      reason: c.reason,
      state: verdicts.get(c.path)?.state ?? 'active',
      note: verdicts.get(c.path)?.note ?? '',
      patch: c.patch,
      ...(c.upstream ? { upstream: c.upstream } : {}),
      ...(c.upstreamPr ? { upstreamPr: c.upstreamPr } : {}),
    })),
    ...readEffects(ws).map((e): CorrectionItem => ({
      kind: 'contribution',
      path: effectsPath(ws),
      target: e.target,
      sheet: sheetOfTarget(e.target),
      source: 'project',
      reason: e.reason,
      state: contributions.get(e.target)?.state ?? 'active',
      note: contributions.get(e.target)?.note ?? '',
    })),
  ];
  const needle = q.trim().toLowerCase();
  return items.filter(
    (i) => (!sheet || i.sheet === sheet) && (!needle || [i.target, i.path, i.reason].some((s) => s.toLowerCase().includes(needle))),
  );
}

/**
 * Retirer une Correction ou une Contribution : le fichier (ou l'entrée) disparaît
 * du dossier, ce qui en fait une Pending Change de suppression — relue et
 * proposée comme les autres, annulable jusque-là.
 */
export function deleteCorrection(ws: Workspace, input: { path?: string; target?: string }): void {
  if (input.path && input.path.startsWith(`${correctionsDir(ws.gameSystem)}/`) && !input.path.includes('..')) {
    const abs = join(ws.datasetDir, input.path);
    if (!existsSync(abs)) throw new ApiError(404, `${input.path} not found`);
    rmSync(abs);
  } else if (input.target) {
    const effects = readEffects(ws);
    const next = effects.filter((e) => e.target !== input.target);
    if (next.length === effects.length) throw new ApiError(404, `no Contribution for ${input.target}`);
    writeFileSync(join(ws.datasetDir, effectsPath(ws)), toJson(next));
  } else throw new ApiError(400, 'a Correction path or a Contribution target is expected');
  void refreshing(ws);
}

// ------------------------------------------------------------ autocomplétion

export interface Suggestions {
  keywords: string[];
  factionKeywords: string[];
  armyRules: string[];
  /** Les Units de l'Army : les seules cibles d'un rattachement. */
  units: { id: string; name: string }[];
  /** Les Weapons de l'Unit, en clés « kind|name » : les seules qu'une option puisse équiper. */
  weapons: string[];
  /**
   * Les Weapons des Units de l'Army telles que l'amont les décrit, Corrections
   * non appliquées : de quoi reprendre la Weapon qu'une Enhancement apporte,
   * même quand une Correction l'a retirée d'une fiche.
   */
  upstreamWeapons: { unit: string; weapon: Weapon }[];
  /**
   * Les clés de Modifier : celles que la Simulation sait jouer d'abord, puis
   * celles déjà utilisées dans le Dataset. Une clé neuve reste permise.
   */
  modifierKeys: { key: string; simulated: boolean }[];
  /** Les clés de Condition : celles que la Simulation évalue, puis les Situations déjà utilisées. */
  conditionKeys: { key: string; simulated: boolean }[];
}

export function suggestions(ws: Workspace, army: string, unitId = ''): Suggestions {
  const units = armyUnits(datasetOf(ws), army);
  const all = (pick: (u: Unit) => string[]) => [...new Set(units.flatMap(pick))].sort((a, b) => a.localeCompare(b));
  return {
    keywords: all((u) => u.keywords),
    factionKeywords: all((u) => u.factionKeywords),
    armyRules: all((u) => u.armyRules),
    units: units.map((u) => ({ id: u.id, name: u.name })).sort((a, b) => a.name.localeCompare(b.name)),
    weapons: (units.find((u) => u.id === unitId)?.weapons ?? []).map(weaponRef),
    upstreamWeapons: armyUnits(ws.bare ?? datasetOf(ws), army)
      .flatMap((u) => u.weapons.map((weapon) => ({ unit: u.name, weapon })))
      .sort((a, b) => a.unit.localeCompare(b.unit) || a.weapon.name.localeCompare(b.weapon.name)),
    modifierKeys: modifierKeys(datasetOf(ws).files),
    conditionKeys: conditionKeys(datasetOf(ws).files),
  };
}

function modifierKeys(files: Map<string, unknown>): Suggestions['modifierKeys'] {
  const simulated = Object.keys(SIMULATED_MODIFIERS);
  const used = [...new Set(modifiersIn(files).map((m) => m.modifier.key))].filter((k) => !(k in SIMULATED_MODIFIERS)).sort((a, b) => a.localeCompare(b));
  return [...simulated.map((key) => ({ key, simulated: true })), ...used.map((key) => ({ key, simulated: false }))];
}

function conditionKeys(files: Map<string, unknown>): Suggestions['conditionKeys'] {
  const evaluated = Object.keys(SIMULATED_CONDITIONS);
  const used = [...new Set(modifiersIn(files).flatMap((m) => (m.modifier.conditions ?? []).map((c) => c.key)))]
    .filter((k) => !(k in SIMULATED_CONDITIONS))
    .sort((a, b) => a.localeCompare(b));
  return [...evaluated.map((key) => ({ key, simulated: true })), ...used.map((key) => ({ key, simulated: false }))];
}
