/**
 * La revue des Effects extraits, côté interface locale : importer un lot,
 * lister ce qui attend un humain, valider (ADR 0011).
 *
 * Un lot importé devient des Contributions portant leur statut de revue ; rien
 * n'en est écrit si l'une d'elles recopie du texte de règles ou vise une Rule
 * absente — elle est refusée, les autres passent.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { authoredEffectProblems, type AuthoredEffect } from '../authored.ts';
import { toJson } from '../dataset.ts';
import { compareReadings, kdcReading, type ExtractedRule, type ImportResult, type ReviewItem } from '../review.ts';
import { rulesIn } from '../rules.ts';
import { ApiError, datasetOf, refreshing } from './api.ts';
import { effectsPath, readEffects } from './sheets.ts';
import { sheetOfTarget } from './targets.ts';
import type { Workspace } from './workspace.ts';

const IMPORT_REASON = 'Read from the rules outside the repository, then compared to 40kdc-data.';
const WAITING = new Set(['divergent', 'seul']);

function writeEffects(ws: Workspace, effects: AuthoredEffect[]): void {
  const abs = join(ws.datasetDir, effectsPath(ws));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, toJson([...effects].sort((a, b) => a.target.localeCompare(b.target))));
}

export function importExtracted(ws: Workspace, rules: ExtractedRule[]): ImportResult {
  const view = datasetOf(ws);
  const known = new Set(rulesIn(view.files).map((r) => r.target));
  const kdc = view.kdcEffects ?? {};
  const byTarget = new Map(readEffects(ws).map((e) => [e.target, e]));
  const result: ImportResult = { written: 0, rejected: [], statuses: {} };

  for (const r of rules) {
    if (!known.has(r.target)) {
      result.rejected.push({ target: r.target, reason: 'no such Rule in the Dataset' });
      continue;
    }
    // Ce qu'un humain a écrit ou revu ne se remplace pas : seul un import précédent, pas encore revu, se réimporte.
    const was = byTarget.get(r.target);
    const byHand = was !== undefined && !was.review;
    if (was?.review === 'revu' || (byHand && (was.modifiers || was.options || was.effect))) {
      result.rejected.push({ target: r.target, reason: was.review === 'revu' ? 'already reviewed by hand' : 'already written by hand' });
      continue;
    }
    const review = compareReadings(r, kdc[r.target]);
    // Une Description écrite à la main reste ; les Modifiers importés s'y ajoutent.
    const summary = byHand ? (was.summary ?? r.summary) : r.summary;
    const entry: AuthoredEffect = {
      ...(byHand ? was : {}),
      target: r.target,
      ...(r.modifiers ? { modifiers: r.modifiers } : {}),
      ...(r.options ? { options: r.options } : {}),
      ...(summary ? { summary } : {}),
      reason: byHand ? was.reason : IMPORT_REASON,
      review,
    };
    const problems = authoredEffectProblems(entry);
    if (problems.length) {
      result.rejected.push({ target: r.target, reason: problems[0] });
      continue;
    }
    byTarget.set(r.target, entry);
    result.statuses[r.target] = review;
    result.written++;
  }
  if (result.written) {
    writeEffects(ws, [...byTarget.values()]);
    void refreshing(ws);
  }
  return result;
}

/** Les Rules extraites d'une Army qui attendent un humain ; `all` : aussi celles déjà validées. */
export function reviewList(ws: Workspace, army = '', type = '', all = false): ReviewItem[] {
  const view = datasetOf(ws);
  const rules = new Map(rulesIn(view.files).map((r) => [r.target, r]));
  const kdc = view.kdcEffects ?? {};
  return readEffects(ws).flatMap((e): ReviewItem[] => {
    const rule = rules.get(e.target);
    if (!e.review || !rule || (!all && !WAITING.has(e.review))) return [];
    if ((army && rule.army !== army) || (type && rule.type !== type)) return [];
    const theirs = kdc[e.target];
    return [
      {
        target: e.target,
        sheet: sheetOfTarget(e.target),
        army: rule.army,
        type: rule.type,
        rule: rule.body.name,
        status: e.review,
        ours: [...(e.modifiers ?? []), ...(e.options ?? []).flatMap((o) => o.modifiers)],
        ...(theirs !== undefined ? { kdc: kdcReading(theirs), kdcEffect: theirs } : {}),
      },
    ];
  });
}

/** Un humain a relu la Rule : elle passe en `revu`. */
export function validateReview(ws: Workspace, target: string): void {
  const effects = readEffects(ws);
  const e = effects.find((x) => x.target === target);
  if (!e?.review || !WAITING.has(e.review)) throw new ApiError(404, `nothing to review for ${target}`);
  e.review = 'revu';
  writeEffects(ws, effects);
  void refreshing(ws);
}

/** Ce qui reste à revoir. */
export const toReviewCount = (ws: Workspace) => readEffects(ws).filter((e) => e.review && WAITING.has(e.review)).length;
