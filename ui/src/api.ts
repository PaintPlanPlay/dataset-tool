/**
 * L'API locale, vue du navigateur. Toute décision vit derrière elle : la page
 * affiche ce qu'elle reçoit et renvoie ce qu'on y fait.
 */
import type { ButtonName, Overview } from '../../src/gui/overview.ts';
import type { SearchHit } from '../../src/gui/provenance.ts';
import type { Job } from '../../src/gui/jobs.ts';
import type { PendingChange } from '../../src/gui/pending.ts';
import type { CorrectionItem, DraftCheck, SavedFile, Sheet, Suggestions } from '../../src/gui/sheets.ts';
import type { SourceConflict } from '../../src/findings.ts';
import type { UnsimulatedKey } from '../../src/rules.ts';
import type { ImportResult, ReviewItem } from '../../src/review.ts';
import type { JsonSchema } from './schema.ts';

export type { ButtonName, ButtonState, Overview } from '../../src/gui/overview.ts';
export type { Inspection, SearchHit } from '../../src/gui/provenance.ts';
export type { PendingChange } from '../../src/gui/pending.ts';
export type { CorrectionItem, DraftCheck, Mark, SavedFile, Sheet, Suggestions } from '../../src/gui/sheets.ts';
export type { SourceConflict } from '../../src/findings.ts';

export class ApiError extends Error {
  /** Ce que le serveur a refusé, un constat par ligne — souvent préfixé du chemin du champ fautif. */
  readonly findings: string[];
  constructor(message: string, findings: string[] = []) {
    super(findings.length ? `${message} — ${findings.join(' — ')}` : message);
    this.findings = findings;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string; findings?: string[] };
  if (!res.ok) throw new ApiError(body.error ?? `HTTP ${res.status}`, body.findings ?? []);
  return body;
}

const post = <T>(path: string, body: unknown = {}) =>
  call<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export interface JobReport {
  job: Omit<Job, 'log'> | null;
  lines: string[];
  next: number;
}

export const api = {
  overview: () => call<Overview>('/api/overview'),
  schema: () => call<{ dataset: JsonSchema }>('/api/schema'),
  search: (q: string, army: string) => call<SearchHit[]>(`/api/search?q=${encodeURIComponent(q)}&army=${encodeURIComponent(army)}`),
  startJob: (name: ButtonName, body: Record<string, string>) => post<{ job: Omit<Job, 'log'> }>(`/api/jobs/${name}`, body),
  jobs: (since: number) => call<JobReport>(`/api/jobs?since=${since}`),
  refresh: () => post('/api/refresh'),
  sheet: (target: string) => call<Sheet>(`/api/sheet?target=${encodeURIComponent(target)}`),
  validate: (target: string, draft: unknown) => post<DraftCheck>('/api/sheet/validate', { target, draft }),
  save: (target: string, draft: unknown, reason: string) => post<{ files: SavedFile[] }>('/api/sheet/save', { target, draft, reason }),
  pending: () => call<PendingChange[]>('/api/pending'),
  undo: (id: string) => post('/api/pending/undo', { id }),
  corrections: (sheet: string, q = '') => call<CorrectionItem[]>(`/api/corrections?sheet=${encodeURIComponent(sheet)}&q=${encodeURIComponent(q)}`),
  deleteCorrection: (item: { path?: string; target?: string }) => post('/api/corrections/delete', item),
  suggest: (army: string, unit: string) => call<Suggestions>(`/api/suggest?army=${encodeURIComponent(army)}&unit=${encodeURIComponent(unit)}`),
  disagreements: () => call<SourceConflict[]>('/api/disagreements'),
  unsimulated: () => call<(UnsimulatedKey & { sheet: string })[]>('/api/unsimulated'),
  review: (army: string, type: string) => call<ReviewItem[]>(`/api/review?army=${encodeURIComponent(army)}&type=${encodeURIComponent(type)}`),
  importReview: (rules: unknown[]) => post<ImportResult>('/api/review/import', { rules }),
  validateReview: (target: string) => post('/api/review/validate', { target }),
  recordPr: (path: string, url: string) => post('/api/corrections/upstream-pr', { path, url }),
  upstreamDraft: (path: string) => call<{ repository: string; url: string }>(`/api/upstream-draft?path=${encodeURIComponent(path)}`),
};
