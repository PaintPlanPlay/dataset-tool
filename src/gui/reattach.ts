/**
 * Rattacher une Contribution dont la cible a changé de nom.
 *
 * Une Contribution vise son élément par son nom ou son identifiant amont :
 * quand BSData renomme une aptitude (« Guile of the Wolf (Aura) » devient
 * « Guile of the Wolf ») ou change l'identifiant d'une datasheet, elle ne
 * trouve plus sa cible et cesse d'agir. Plutôt que de la réécrire à la main,
 * on propose les éléments du même genre qui pourraient l'avoir remplacée, le
 * plus proche en tête, et on réécrit sa cible en un geste — contenu intact.
 * C'est une Pending Change comme une autre.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { alternativeText, type ArmyFile, type CoreFile, type Unit, type WargearAlternative, type WargearOption } from '@paintplanplay/dataset-schema';
import { authoredEffectProblems, sameWeapons, type AuthoredEffect } from '../authored.ts';
import { alternativeTarget } from '../wargear.ts';
import { CORE_ROOT, parseTarget } from '../corrections/apply.ts';
import { homes } from '../home.ts';
import { ApiError, datasetOf, rebuild } from './api.ts';
import { readEffects, writeContributions } from './sheets.ts';
import { sheetOfTarget } from './targets.ts';
import type { Workspace } from './workspace.ts';

/** Un élément qu'une Contribution peut viser, et comment l'appeler. */
interface Element {
  target: string;
  label: string;
  /** Pour une Wargear Alternative : elle, son option et son Unit, de quoi comparer ce qu'elle donne. */
  wargear?: { unit: Unit; option: WargearOption; alternative: WargearAlternative };
}

export interface Candidate extends Element {
  /** L'Unit ou l'Army qui porte l'élément. */
  holder: string;
  /** Plus haut, plus proche : 2 pour le même nom sans suffixe entre parenthèses. */
  score: number;
  /** La Contribution qui décrit déjà cet élément, s'il y en a une. */
  existing?: AuthoredEffect;
}

export interface Reattachable {
  contribution: AuthoredEffect;
  /** Ce que la Contribution visait, nommé quand le Dataset publié s'en souvient. */
  label: string;
  candidates: Candidate[];
}

/** Les éléments d'un genre que porte une Unit, une Army, ou le fichier Core. */
function elementsOf(files: Map<string, unknown>, gameSystem: string, root: string, entity: string): { holder: string; elements: Element[] } | null {
  if (root === CORE_ROOT) {
    const core = files.get(`${gameSystem}/core.json`) as CoreFile | undefined;
    return entity === 'stratagem' && core ? { holder: 'Core', elements: core.stratagems.map((s) => ({ target: `${CORE_ROOT}::stratagem:${s.id}`, label: s.name })) } : null;
  }
  for (const [path, file] of files) {
    if (!path.startsWith(`${gameSystem}/armies/`)) continue;
    const army = file as ArmyFile;
    if (army.id === root) {
      const at = (kind: string, id: string) => `${army.id}::${kind}:${id}`;
      const elements: Element[] =
        entity === 'rule'
          ? army.detachments.flatMap((d) => d.rules.map((r) => ({ target: at('rule', `${d.id}|${r.id}`), label: `${d.name} › ${r.name}` })))
          : entity === 'enhancement'
            ? army.detachments.flatMap((d) => d.enhancements.map((e) => ({ target: at('enhancement', `${d.id}|${e.id}`), label: `${d.name} › ${e.name}` })))
            : entity === 'stratagem'
              ? army.stratagems.map((s) => ({ target: at('stratagem', s.id), label: s.name }))
              : entity === 'armyrule'
                ? (army.armyRules ?? []).map((r) => ({ target: at('armyrule', r.id), label: r.name }))
                : [];
      return { holder: army.name, elements };
    }
    const unit = army.units.find((u) => u.id === root);
    if (unit) return { holder: unit.name, elements: unitElements(unit, entity) };
  }
  return null;
}

function unitElements(u: Unit, entity: string): Element[] {
  if (entity === 'ability') return u.abilities.map((a) => ({ target: `${u.id}::ability:${a.name}`, label: a.name }));
  // Les Wargear Alternatives, à l'adresse de leur option d'origine.
  if (entity === 'option')
    return (u.wargearOptions ?? []).flatMap((o) =>
      o.alternatives.map((a) => ({
        target: alternativeTarget(u.id, o, a.id),
        label: a.name ?? alternativeText(a),
        wargear: { unit: u, option: o, alternative: a },
      })),
    );
  if (entity === 'wargear') return (u.wargearOptions ?? []).map((o) => ({ target: `${u.id}::wargear:${o.id}`, label: o.alternatives.map((a) => a.name ?? a.id).join(' / ') }));
  return [];
}

/** Les Armies telles que le dépôt du Dataset les publie : ce dont une cible disparue se souvient. */
function publishedFiles(datasetDir: string, gameSystem: string): Map<string, unknown> {
  const files = new Map<string, unknown>();
  const dir = join(datasetDir, gameSystem, 'armies');
  if (existsSync(dir))
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) files.set(`${gameSystem}/armies/${f}`, JSON.parse(readFileSync(join(dir, f), 'utf8')));
  const core = join(datasetDir, gameSystem, 'core.json');
  if (existsSync(core)) files.set(`${gameSystem}/core.json`, JSON.parse(readFileSync(core, 'utf8')));
  return files;
}

/** Un nom sans casse ni ponctuation, et sans son suffixe entre parenthèses quand `bare`. */
const normal = (s: string, bare = false) =>
  (bare ? s.replace(/\s*\([^)]*\)\s*$/, '') : s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Ressemblance de deux noms, de 0 à 1 : la part de paires de lettres communes (Dice). */
function likeness(a: string, b: string): number {
  const pairs = (s: string) => {
    const out = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) out.set(s.slice(i, i + 2), (out.get(s.slice(i, i + 2)) ?? 0) + 1);
    return out;
  };
  const x = pairs(normal(a));
  const y = pairs(normal(b));
  let common = 0;
  for (const [k, n] of x) common += Math.min(n, y.get(k) ?? 0);
  const total = [...x.values(), ...y.values()].reduce((n, v) => n + v, 0);
  return total ? (2 * common) / total : 0;
}

/** Le nom d'un élément dans sa cible : la dernière partie de son adresse. */
const nameOf = (target: string) => parseTarget(target).name.split('|').pop() ?? '';

/**
 * Proche veut dire d'abord le même nom sans suffixe entre parenthèses, puis le
 * même identifiant, puis la ressemblance des noms.
 */
function score(was: Element, candidate: Element): number {
  if (normal(was.label, true) === normal(candidate.label, true) || normal(nameOf(was.target), true) === normal(nameOf(candidate.target), true)) return 2;
  if (nameOf(was.target) === nameOf(candidate.target)) return 1.5;
  return Math.max(likeness(was.label, candidate.label), likeness(nameOf(was.target), nameOf(candidate.target)));
}

/** Au plus autant de candidats : au-delà, le mainteneur cherche mieux sur la fiche. */
const MAX_CANDIDATES = 12;

/**
 * Les éléments qui ont pu remplacer la cible d'une Contribution, le plus proche
 * en tête. Ceux qu'une autre Contribution décrit déjà restent proposés, avec
 * elle : choisir l'un d'eux demandera laquelle garder.
 */
export function reattachCandidates(ws: Workspace, target: string): Reattachable {
  const effects = readEffects(ws);
  const contribution = effects.find((e) => e.target === target);
  if (!contribution) throw new ApiError(404, `no Contribution for ${target}`);
  const view = datasetOf(ws);
  const h = homes(view.files);
  const { root, entity } = parseTarget(target);
  const published = publishedFiles(ws.datasetDir, ws.gameSystem);
  const was: Element = {
    target,
    label: elementsOf(published, ws.gameSystem, root, entity)?.elements.find((e) => e.target === target)?.label ?? nameOf(target),
  };

  // L'Unit existe encore : ses éléments du même genre. Sinon, les Units qui portent son nom : BSData a pu changer l'identifiant.
  const here = elementsOf(view.files, ws.gameSystem, root, entity);
  const holders: { holder: string; elements: Element[] }[] = [];
  if (here) holders.push(here);
  else {
    const name = (published.size ? [...published.values()] : [])
      .flatMap((f) => (f as ArmyFile).units ?? [])
      .find((u) => u.id === root)?.name;
    const seen = new Set<string>();
    for (const [path, file] of view.files) {
      if (!path.startsWith(`${ws.gameSystem}/armies/`)) continue;
      for (const u of (file as ArmyFile).units)
        if (name && u.name === name && !seen.has(u.id)) {
          seen.add(u.id);
          holders.push({ holder: u.name, elements: unitElements(u, entity) });
        }
    }
  }

  const described = new Map(effects.map((e) => [h.canonical(e.target), e]));
  const candidates = holders
    .flatMap(({ holder, elements }) =>
      elements
        .filter((e) => e.target !== target)
        .map((e): Candidate => {
          const existing = described.get(h.canonical(e.target));
          // Une option créée à la main va d'abord à la Wargear Alternative qui donne les mêmes Weapons.
          const same = contribution.option && e.wargear && sameWeapons(contribution.option.weapons, e.wargear.alternative, e.wargear.option, e.wargear.unit);
          const { wargear: _w, ...element } = e;
          return { ...element, holder, score: same ? 3 : score(was, e), ...(existing ? { existing } : {}) };
        }),
    )
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, MAX_CANDIDATES);
  return { contribution, label: was.label, candidates };
}

export interface ReattachInput {
  from: string;
  to: string;
  /**
   * Quand l'élément choisi a déjà sa Contribution : `moved` garde celle qu'on
   * rattache, `existing` garde l'autre. Sans choix, le rattachement est refusé.
   */
  keep?: 'moved' | 'existing';
}

/**
 * Réécrit la cible d'une Contribution, avec tout son contenu. Une seule
 * Contribution par élément : si la cible en a déjà une, on garde celle qu'on
 * désigne et l'autre disparaît.
 */
export function reattachContribution(ws: Workspace, input: ReattachInput): { target: string } {
  const effects = readEffects(ws);
  const moved = effects.find((e) => e.target === input.from);
  if (!moved) throw new ApiError(404, `no Contribution for ${input.from}`);
  if (!input.to || input.to === input.from) throw new ApiError(400, 'a new target is expected');
  const from = parseTarget(input.from);
  const to = parseTarget(input.to);
  if (from.entity !== to.entity) throw new ApiError(400, `a Contribution on a ${from.entity} stays on a ${from.entity}`);
  const view = datasetOf(ws);
  if (!elementsOf(view.files, ws.gameSystem, to.root, to.entity)?.elements.some((e) => e.target === input.to))
    throw new ApiError(400, `${input.to} is not in the Dataset`);

  const h = homes(view.files);
  const existing = effects.find((e) => e !== moved && h.canonical(e.target) === h.canonical(input.to));
  if (existing && !input.keep) throw new ApiError(409, `${input.to} already has a Contribution: choose which to keep`);

  const rest = effects.filter((e) => e !== moved && e !== existing);
  // L'élément visé existe : une option que la Contribution créait n'est plus à créer, son coût et ses aptitudes restent.
  const { option: _created, ...carried } = moved;
  const kept = carried.wargearCost !== undefined || carried.abilities !== undefined || moved.option === undefined;
  const next =
    existing && input.keep === 'existing'
      ? [...rest, existing]
      : kept
        ? [...rest, { ...(moved.option ? carried : moved), target: existing?.target ?? input.to }]
        : existing
          ? [...rest, existing]
          : rest;
  const placed = next.find((e) => h.canonical(e.target) === h.canonical(input.to));
  if (!placed) {
    writeContributions(ws, next);
    void rebuild(ws, { sheets: [sheetOfTarget(input.from), sheetOfTarget(input.to)] });
    return { target: input.to };
  }
  const problems = authoredEffectProblems(placed);
  if (problems.length) throw new ApiError(400, `${input.to}: refused`, problems);
  writeContributions(ws, next);
  void rebuild(ws, { sheets: [sheetOfTarget(input.from), sheetOfTarget(input.to)] });
  return { target: placed.target };
}
