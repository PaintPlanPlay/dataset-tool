/**
 * La nouvelle interface du Dataset Tool : une représentation graphique du
 * schéma du Dataset. À gauche l'état global et les Pending Changes, à droite
 * la fiche ouverte, éditable. Une seule fiche en cours à la fois ; la quitter
 * avec des modifications demande quoi en faire. Poste de travail uniquement.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, type DraftCheck, type Inspection, type Mark, type Overview, type PendingChange, type Sheet, type Suggestions } from './api.ts';
import { CorrectionsDialog, DisagreementsDialog, LeaveDialog, SaveDialog, UnsimulatedDialog } from './Dialogs.tsx';
import { Ctx, Field, type EditorContext } from './editor/Editor.tsx';
import { same, setAt, type Path } from './editor/values.ts';
import { SchemaSet, type Located } from './schema.ts';
import { SheetBar } from './SheetBar.tsx';
import { unitWidget } from './sheets/UnitSheet.tsx';
import { detachmentWidget } from './sheets/DetachmentSheet.tsx';
import { toast, Toasts } from './Toast.tsx';
import { StatusColumn } from './StatusColumn.tsx';
import { Dashboard } from './Dashboard.tsx';

/** Ce que vise une sortie de fiche quand on revient au tableau de bord. */
const HOME = '';

/** Le schéma d'une fiche, d'après son genre. */
function sheetSchema(schemas: SchemaSet, kind: Inspection['kind']): Located {
  if (kind === 'armyRule') return schemas.def('rule');
  if (kind !== 'core') return schemas.def(kind);
  // L'entrée Core : les Battle Sizes, les Ally Rules et les Stratagems Core de `core.json`.
  const core = schemas.def('coreFile');
  const props = core.schema.properties ?? {};
  return { schema: { type: 'object', properties: { battleSizes: props.battleSizes, allyRules: props.allyRules, stratagems: props.stratagems } }, base: core.base };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Ce que le mainteneur ne voit pas mais que le Dataset exige : l'identifiant
 * d'un groupe ou d'une option qu'il vient d'ajouter, et l'imbrication
 * BattleScribe d'un nouveau groupe (à la racine de son propre arbre).
 */
function normalize(kind: Inspection['kind'], draft: unknown): unknown {
  const fresh = (prefix: string, taken: Set<string>) => {
    let n = 1;
    while (taken.has(`${prefix}-${n}`)) n++;
    taken.add(`${prefix}-${n}`);
    return `${prefix}-${n}`;
  };
  if (kind === 'unit') {
    // Une Unit qui n'est pas alliée ne le dit pas : l'interrupteur éteint retire le champ.
    if ((draft as { ally?: boolean }).ally === false) {
      const { ally: _ally, ...rest } = draft as Record<string, unknown>;
      return normalize(kind, rest);
    }
    return draft;
  }
  if (kind === 'detachment') {
    const d = draft as { enhancements?: { id: string; name: string }[] };
    if (!d.enhancements?.some((e) => !e.id)) return draft;
    const ids = new Set(d.enhancements.map((e) => e.id).filter(Boolean));
    return { ...d, enhancements: d.enhancements.map((e) => ({ ...e, id: e.id || (slug(e.name) && !ids.has(slug(e.name)) ? slug(e.name) : fresh('enhancement', ids)) })) };
  }
  return draft;
}

/** Les étiquettes qu'une liste propose (Keywords de l'Army) ou impose (Units, Weapons de l'Unit). */
function choicesFor(kind: Inspection['kind'], draft: unknown, s: Suggestions | null) {
  const words = [...new Set([...(s?.keywords ?? []), ...(s?.factionKeywords ?? [])])];
  const units = (s?.units ?? []).map((u) => u.name);
  return (path: Path) => {
    const key = path.map((p) => (typeof p === 'number' ? '*' : p)).join('.');
    if (kind === 'unit') {
      if (key === 'keywords') return { options: s?.keywords ?? [], closed: false };
      if (key === 'factionKeywords') return { options: s?.factionKeywords ?? [], closed: false };
      if (key === 'armyRules') return { options: s?.armyRules ?? [], closed: false };
      if (key === 'leaderTargets' || key === 'supportTargets') return { options: units, closed: true };
      if (key === 'weapons.*.profiles.*.keywords') return { options: [], closed: false, picker: 'weaponKeywords' as const };
      if (key === 'wargearOptions.*.alternatives.*.abilities')
        return { options: ((draft as { abilities?: { name: string }[] }).abilities ?? []).map((a) => a.name), closed: true };
    }
    if (kind === 'detachment') {
      if (key === 'enhancements.*.leaderTo' || key === 'enhancements.*.supportTo') return { options: units, closed: true };
      if (key === 'enhancements.*.requires.*' || key === 'enhancements.*.excludes') return { options: words, closed: false };
    }
    if (/(^|\.)(target|keywords|eligibility)\.(allOf|anyOf|noneOf)$/.test(key)) return { options: words, closed: false };
    if (/(^|\.)modifiers\.\*\.key$/.test(key)) {
      const keys = s?.modifierKeys ?? [];
      return { options: keys.map((k) => k.key), closed: false, simulated: keys.filter((k) => k.simulated).map((k) => k.key) };
    }
    // Une Condition que la Simulation n'évalue pas n'est pas une erreur : c'est une Situation, posée par le joueur.
    if (/(^|\.)conditions\.\*\.key$/.test(key)) return { options: (s?.conditionKeys ?? []).map((k) => k.key), closed: false };
    return undefined;
  };
}

const byPointer = <T extends { path: string }>(list: T[], pick: (t: T) => string) => {
  const map = new Map<string, string[]>();
  for (const x of list) map.set(x.path, [...(map.get(x.path) ?? []), pick(x)]);
  return map;
};

export function App() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);
  const [schemas, setSchemas] = useState<SchemaSet | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [draft, setDraft] = useState<unknown>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [check, setCheck] = useState<DraftCheck>({ errors: [], warnings: [] });
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [pending, setPending] = useState<PendingChange[]>([]);
  const [corrections, setCorrections] = useState(0);
  const [dialog, setDialog] = useState<null | 'save' | 'corrections' | 'all' | 'disagreements' | 'unsimulated'>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [findings, setFindings] = useState<string[]>([]);

  const dirty = sheet !== null && !same(draft, sheet.value);

  const loadOverview = useCallback(() => {
    api.overview().then(
      (o) => {
        setOverview(o);
        setOverviewError(null);
      },
      (err: Error) => setOverviewError(err.message),
    );
    api.pending().then(setPending, () => undefined);
  }, []);

  const loadSheet = useCallback((t: string) => {
    api.sheet(t).then(
      (s) => {
        setSheet(s);
        setDraft(structuredClone(s.value));
        setCheck({ errors: [], warnings: [] });
        setSheetError(null);
        api.suggest(s.army, s.kind === 'unit' ? s.target : '').then(setSuggestions, () => setSuggestions(null));
        api.corrections(s.target).then((c) => setCorrections(c.length), () => setCorrections(0));
      },
      (err: Error) => setSheetError(err.message),
    );
  }, []);

  useEffect(() => {
    loadOverview();
    api.schema().then(
      (s) => setSchemas(new SchemaSet(s.dataset)),
      (err: Error) => setSheetError(err.message),
    );
  }, [loadOverview]);

  // Stable : la colonne de gauche relit son journal sans redémarrer à chaque fiche ouverte.
  const target = useRef<string | null>(null);
  const onChanged = useCallback(() => {
    loadOverview();
    if (target.current) loadSheet(target.current);
  }, [loadOverview, loadSheet]);

  /** Des modifications non enregistrées sur la fiche ouverte : une relecture qui finit ne doit pas les effacer. */
  const dirtyNow = useRef(false);
  dirtyNow.current = dirty;
  /** Les écritures dont la relecture n'est pas finie, et la notification qui le dit. */
  const rebuilds = useRef({ count: 0, toast: 0 });

  /**
   * Après une écriture : on n'attend pas la relecture du Dataset, une quinzaine
   * de secondes sur le vrai. Les Pending Changes se relisent tout de suite (git
   * suffit), la fiche écrite se rouvre en lecture seule (`rebuilding`), et l'on
   * peut passer à la suivante. Quand la relecture finit, tout se relit — sauf
   * une fiche qu'on a commencé à modifier entre-temps.
   */
  const afterWrite = useCallback(
    (done = 'Up to date', detail?: string, id?: number) => {
      api.pending().then(setPending, () => undefined);
      toast.ok(done, detail, id);
      onChanged();
      const r = rebuilds.current;
      if (r.count++ === 0) r.toast = toast.busy('Rebuilding the Dataset in the background…');
      api
        .refresh()
        .then(
          () => {
            if (--r.count === 0) toast.dismiss(r.toast);
          },
          (err: Error) => {
            if (--r.count === 0) toast.dismiss(r.toast);
            toast.error('The Dataset could not be rebuilt', err.message);
          },
        )
        .finally(() => {
          loadOverview();
          if (target.current && !dirtyNow.current) loadSheet(target.current);
        });
    },
    [onChanged, loadOverview, loadSheet],
  );

  // Chaque modification est contrôlée en direct, avec un délai : schéma et texte de règles.
  useEffect(() => {
    if (!sheet || !dirty) {
      setCheck({ errors: [], warnings: [] });
      return;
    }
    const timer = setTimeout(() => {
      api.validate(sheet.target, draft).then(setCheck, () => undefined);
    }, 400);
    return () => clearTimeout(timer);
  }, [draft, sheet, dirty]);

  /** Ouvrir une fiche, ou revenir au tableau de bord (`HOME`). */
  const go = useCallback(
    (t: string) => {
      target.current = t || null;
      if (t) return loadSheet(t);
      setSheet(null);
      setDraft(null);
      setSheetError(null);
    },
    [loadSheet],
  );

  const open = (t: string) => {
    if (dirty && t !== sheet?.target) {
      setLeaving(t);
      return;
    }
    go(t);
  };

  const save = async (reason: string) => {
    if (!sheet) return;
    setSaving(true);
    setFindings([]);
    const t = toast.busy(`Saving ${sheet.name}…`);
    try {
      const out = await api.save(sheet.target, draft, reason);
      setDialog(null);
      const files = out.files.map((f) => `${f.path}${f.action === 'deleted' ? ' (removed)' : ''}`).join(', ');
      afterWrite(`${sheet.name} saved`, `${out.files.length} file(s): ${files}`, t);
      if (leaving !== null) {
        const next = leaving;
        setLeaving(null);
        go(next);
      }
    } catch (err) {
      const found = err instanceof ApiError && err.findings.length ? err.findings : [(err as Error).message];
      setFindings(found);
      toast.error(`${sheet.name} not saved`, found[0], t);
    } finally {
      setSaving(false);
    }
  };

  const onChange = useCallback(
    (path: Path, next: unknown) => setDraft((prev: unknown) => normalize(sheet?.kind ?? 'unit', setAt(prev, path, next))),
    [sheet?.kind],
  );

  const ctx: EditorContext | null = useMemo(() => {
    if (!sheet || !schemas) return null;
    return {
      schemas,
      original: sheet.value,
      draft,
      onChange,
      errors: byPointer(check.errors, (e) => e.message),
      warnings: byPointer(check.warnings, (w) => w.message),
      marks: sheet.marks.reduce((m, x) => m.set(x.path, [...(m.get(x.path) ?? []), x]), new Map<string, Mark[]>()),
      choices: choicesFor(sheet.kind, draft, suggestions),
      ...(sheet.kind === 'unit' ? { widget: unitWidget({ sources: sheet.sources, wargear: sheet.wargear }) } : {}),
      ...(sheet.kind === 'detachment' ? { widget: detachmentWidget({ suggestions }) } : {}),
    };
  }, [sheet, schemas, draft, check, suggestions, onChange]);

  return (
    <div className="layout">
      <Toasts />
      <StatusColumn
        overview={overview}
        error={overviewError}
        pending={pending}
        onChanged={onChanged}
        onUndo={async (id) => {
          const t = toast.busy('Undoing the change…');
          try {
            await api.undo(id);
            afterWrite('Change undone', undefined, t);
          } catch (e) {
            toast.error('The change could not be undone', (e as Error).message, t);
          }
        }}
        onOpen={open}
        onCorrections={() => setDialog('all')}
        onDisagreements={() => setDialog('disagreements')}
        onUnsimulated={() => setDialog('unsimulated')}
        onHome={() => open(HOME)}
      />
      <main className="sheet">
        <SheetBar
          armies={overview?.armies ?? []}
          open={sheet ? sheet.name : null}
          onOpen={(hit) => open(hit.target)}
          dirty={dirty}
          rebuilding={sheet?.rebuilding ?? false}
          corrections={sheet ? corrections : null}
          onSave={() => {
            setFindings([]);
            setDialog('save');
          }}
          onCorrections={() => setDialog('corrections')}
        />
        {sheetError && <p className="error">{sheetError}</p>}
        {sheet && ctx ? (
          <div className="sheet-body">
            {sheet.rebuilding && (
              <p className="rebuilding" role="status">
                Rebuilding the Dataset with your change: this sheet opens again by itself once it is done. Other sheets can be edited meanwhile.
              </p>
            )}
            {sheet.kind !== 'unit' && <SectionSources sources={sheet.sources} />}
            {/* Lecture seule tant que la vue ne porte pas l'écriture : la valeur montrée est celle d'avant. */}
            <fieldset className="sheet-fields" disabled={sheet.rebuilding}>
              <Ctx.Provider value={ctx}>
                <Field at={sheetSchema(ctx.schemas, sheet.kind)} value={draft} path={[]} />
              </Ctx.Provider>
            </fieldset>
          </div>
        ) : (
          !sheetError &&
          (overview && !overview.workspace.dataset ? (
            <p className="empty hint">Nothing here yet: click Update data to fetch the Dataset and a snapshot of its sources. It takes a few minutes, once.</p>
          ) : (
            <Dashboard overview={overview} onOpen={open} onWrite={(done) => afterWrite(done)} />
          ))
        )}
      </main>

      {dialog === 'save' && <SaveDialog busy={saving} findings={findings} onSave={(r) => void save(r)} onClose={() => setDialog(null)} />}
      {dialog === 'corrections' && sheet && <CorrectionsDialog sheet={sheet.target} onChanged={() => afterWrite()} onClose={() => setDialog(null)} />}
      {dialog === 'all' && (
        <CorrectionsDialog
          sheet=""
          onOpen={(s) => {
            setDialog(null);
            open(s);
          }}
          onChanged={() => afterWrite()}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'unsimulated' && (
        <UnsimulatedDialog
          onOpen={(s) => {
            setDialog(null);
            open(s);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'disagreements' && (
        <DisagreementsDialog
          onOpen={(s) => {
            setDialog(null);
            open(s);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {leaving !== null && dialog === null && (
        <LeaveDialog
          onCancel={() => setLeaving(null)}
          onDiscard={() => {
            const next = leaving;
            setLeaving(null);
            go(next);
          }}
          onSave={() => {
            setFindings([]);
            setDialog('save');
          }}
        />
      )}
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = { bsdata: 'BSData', mfm: 'MFM', project: 'project' };

/** D'où vient chaque partie d'une fiche : là que partira une Correction, ou qu'on écrit une Contribution. */
function SectionSources({ sources }: { sources: Record<string, string> }) {
  const groups = new Map<string, string[]>();
  for (const [field, source] of Object.entries(sources)) groups.set(source, [...(groups.get(source) ?? []), field]);
  return (
    <p className="sources-line">
      {[...groups].map(([source, fields]) => (
        <span key={source}>
          <b>{SOURCE_LABEL[source] ?? source}</b>: {fields.join(', ')}
        </span>
      ))}
    </p>
  );
}
