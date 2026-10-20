/**
 * Le tableau de bord, page d'accueil de l'interface : les Unreleased Changes,
 * tout ce qui sépare la Dataset Release que lisent les apps de ce que l'outil
 * construit maintenant. Lu comme un diff git : rouge ce qui part, vert ce qui
 * arrive, Army par Army, chaque changement à son étape.
 */
import { useEffect, useState } from 'react';
import { api, type ArmyChanges, type CaughtUp, type Counters, type FindingKind, type EntityChange, type FieldChange, type Origin, type Overview, type SourceShift, type Stage, type Unreleased } from './api.ts';
import { ReattachDialog } from './Dialogs.tsx';

const SOURCE: Record<string, string> = { bsdata: 'BSData', mfm: 'MFM' };
const KIND: Record<EntityChange['kind'], string> = { unit: 'Unit', detachment: 'Detachment', stratagem: 'Stratagem', armyRule: 'Army Rule', core: 'Core' };
const STATUS: Record<EntityChange['status'], string> = { added: 'new', removed: 'removed', changed: '' };
const STAGE: Record<Stage, { label: string; hint: string }> = {
  merged: { label: 'on main', hint: 'Merged: the next Release publishes it' },
  proposed: { label: 'proposed', hint: 'In a pull request under review' },
  local: { label: 'local', hint: 'On this machine only: nothing proposed yet' },
};

const ORIGIN: Record<Origin, { label: string; hint: string }> = {
  bsdata: { label: 'BSData', hint: 'The new value comes from BSData' },
  mfm: { label: 'MFM', hint: 'The new value comes from the Munitorum Field Manual' },
  correction: { label: 'Correction', hint: 'A Correction of the project forces the new value' },
  contribution: { label: 'Contribution', hint: 'The project writes the new value' },
};

const short = (commit: string | null | undefined) => (commit ? commit.slice(0, 7) : '—');
const version = (commit: string | null | undefined, v?: string) => `${v ? `${v} · ` : ''}${short(commit)}`;

function Sources({ sources }: { sources: SourceShift[] }) {
  const onMain = sources.some((s) => s.merged);
  return (
    <table className="shifts">
      <thead>
        <tr>
          <th />
          <th>Release</th>
          {onMain && <th>main</th>}
          <th>now</th>
        </tr>
      </thead>
      <tbody>
        {sources.map((s) => (
          <tr key={s.id} className={s.before !== s.after ? 'moved' : undefined}>
            <th>{SOURCE[s.id] ?? s.id}</th>
            <td title={s.before ?? undefined}>{version(s.before, s.beforeVersion)}</td>
            {onMain && <td title={s.merged ?? undefined}>{s.merged ? version(s.merged, s.mergedVersion) : ''}</td>}
            <td title={s.after ?? undefined}>{version(s.after, s.afterVersion)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Une liste ne montre que ce qui en sort et ce qui y entre ; le reste, en entier. */
function Lines({ change: c }: { change: FieldChange }) {
  if (c.noise) return <span className="noise" title={`${c.before} → ${c.after}`}>order only: {c.after}</span>;
  const listed = c.removed && c.added && c.before !== null && c.after !== null;
  const out = listed ? c.removed! : c.before !== null ? [c.before] : [];
  const into = listed ? c.added! : c.after !== null ? [c.after] : [];
  return (
    <>
      {out.map((x) => (
        <span className="del" key={`-${x}`} title={listed ? `was: ${c.before}` : undefined}>
          - {x}
        </span>
      ))}
      {into.map((x) => (
        <span className="add" key={`+${x}`} title={listed ? `now: ${c.after}` : undefined}>
          + {x}
        </span>
      ))}
    </>
  );
}

function StageBadge({ stage }: { stage?: Stage }) {
  return stage ? (
    <span className={`stage ${stage}`} title={STAGE[stage].hint}>
      {STAGE[stage].label}
    </span>
  ) : null;
}

function OriginBadge({ change: c }: { change: FieldChange }) {
  if (!c.origin) return null;
  const by = c.by ? ` · ${c.by === 'you' ? 'you, not proposed' : c.by}` : '';
  return (
    <span className={`origin ${c.origin}`} title={`${ORIGIN[c.origin].hint}${c.file ? ` — ${c.file}` : ''}`}>
      {ORIGIN[c.origin].label}
      {by}
    </span>
  );
}

function Entity({ entity, onOpen }: { entity: EntityChange; onOpen: (target: string) => void }) {
  return (
    <details className="entity" open={entity.status === 'changed'}>
      <summary>
        <span className="kind">{KIND[entity.kind]}</span>
        <button type="button" className="link" onClick={() => onOpen(entity.target)}>
          {entity.name}
        </button>
        {STATUS[entity.status] && <span className={`badge ${entity.status}`}>{STATUS[entity.status]}</span>}
        <span className="count">{entity.changes.length}</span>
      </summary>
      <div className="diff">
        {entity.changes.map((c) => (
          <div className="change" key={c.field}>
            <span className="change-field">
              {c.field} <StageBadge stage={c.stage} /> <OriginBadge change={c} />
            </span>
            <span className="lines">
              <Lines change={c} />
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

/** Les Corrections que BSData a rattrapées : elles ne changent plus rien, on les retire d'un geste. */
function CaughtUpList({ items, onOpen, onRemoved }: { items: CaughtUp[]; onOpen: (target: string) => void; onRemoved: (removed: string[]) => void }) {
  const [busy, setBusy] = useState(false);
  const armies = [...new Set(items.map((c) => c.armyName))];
  return (
    <details className="army caught-up">
      <summary>
        <b>Caught up by their source</b> <span className="count">{items.length} Correction(s) that change nothing any more</span>
      </summary>
      <p className="hint">
        ✓ BSData or the MFM fixed these too: the Dataset is the same without them. Removing them makes Pending Changes, proposed like any other; nothing
        changes for players.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            onRemoved((await api.removeCaughtUp()).removed);
          } finally {
            setBusy(false);
          }
        }}
      >
        Remove the {items.length} caught-up Correction(s)
      </button>
      {armies.map((name) => (
        <div className="entity" key={name}>
          <b>{name}</b>
          {items
            .filter((c) => c.armyName === name)
            .map((c) => (
              <div className="change" key={c.path}>
                <button type="button" className="link change-field" onClick={() => onOpen(c.sheet)} title={c.path}>
                  {c.label}
                </button>
                <span className="lines">
                  <span>✓ {c.fields.join(', ') || 'the element'}: the source now says the same</span>
                  <span className="hint">{c.reason}</span>
                </span>
              </div>
            ))}
        </div>
      ))}
    </details>
  );
}

const FINDING: Record<FindingKind, { label: string; hint: string; todo: boolean }> = {
  conflict: { label: 'in conflict', hint: 'Corrections whose source moved to another value: decide which is right', todo: true },
  caughtUp: { label: 'caught up', hint: 'Corrections the source has caught up with: remove them', todo: true },
  orphan: { label: 'orphaned', hint: 'Corrections whose target is gone: fix the target or delete them', todo: true },
  contribution: { label: 'Contributions to review', hint: 'Contributions set aside, or whose target is gone', todo: true },
  disagreement: { label: 'disagreements', hint: 'Where two sources disagree and the authoritative one won: sometimes the loser is right', todo: true },
  unsimulated: { label: 'unsimulated keys', hint: 'Modifier keys the simulation does not play: a typo, or a key to teach it', todo: false },
  wargear: { label: 'wargear costs not linked', hint: 'MFM wargear lines no option bills: link them on the unit sheet', todo: false },
  enhancementWeapon: { label: 'Enhancement weapons', hint: 'Weapons BSData gives an Enhancement the Dataset lacks, or a datasheet carries', todo: false },
};

/** Les chiffres « à traiter » et « à compléter » ; chacun ouvre sa liste. */
function Tallies({ counters, compact = false, onPick }: { counters: Counters; compact?: boolean; onPick: (kind: FindingKind) => void }) {
  const all = { ...counters.handle, ...counters.complete } as Record<FindingKind, number>;
  const kinds = (Object.keys(FINDING) as FindingKind[]).filter((k) => all[k] > 0);
  if (!kinds.length) return compact ? null : <p className="hint">Nothing to handle or complete.</p>;
  const group = (todo: boolean) => kinds.filter((k) => FINDING[k].todo === todo);
  const chips = (list: FindingKind[]) =>
    list.map((k) => (
      <button
        type="button"
        key={k}
        className={`tally${FINDING[k].todo ? ' todo' : ''}`}
        title={FINDING[k].hint}
        onClick={(e) => {
          // Dans un résumé d'Army, le clic ouvre la liste sans replier l'Army.
          e.preventDefault();
          onPick(k);
        }}
      >
        {all[k]} {FINDING[k].label}
      </button>
    ));
  if (compact) return <span className="tallies">{chips(kinds)}</span>;
  return (
    <div className="tallies wide">
      {group(true).length > 0 && (
        <span>
          <b>To handle</b> {chips(group(true))}
        </span>
      )}
      {group(false).length > 0 && (
        <span>
          <b>To complete</b> {chips(group(false))}
        </span>
      )}
    </div>
  );
}

/** Ne garder que les changements qu'un filtre retient, et ce qui en porte encore. */
function keep(armies: ArmyChanges[], ok: (c: FieldChange) => boolean): ArmyChanges[] {
  return armies
    .map((a) => ({ ...a, entities: a.entities.map((e) => ({ ...e, changes: e.changes.filter(ok) })).filter((e) => e.changes.length) }))
    .filter((a) => a.entities.length);
}

interface Props {
  overview: Overview | null;
  onOpen: (target: string) => void;
  /** Après une écriture : relire les Pending Changes, reconstruire. */
  onWrite: (done: string) => void;
}

export function Dashboard({ overview, onOpen, onWrite }: Props) {
  const [data, setData] = useState<Unreleased | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [stage, setStage] = useState<Stage | ''>('');
  const [origin, setOrigin] = useState<Origin | ''>('');
  const [findings, setFindings] = useState<{ kind: FindingKind; army?: string } | null>(null);
  const [reattach, setReattach] = useState<string | null>(null);

  // L'état global se relit après chaque tâche ou écriture : le tableau de bord suit.
  useEffect(() => {
    let stale = false;
    api.unreleased(all).then(
      (u) => !stale && (setData(u), setError(null)),
      (e: Error) => !stale && setError(e.message),
    );
    return () => {
      stale = true;
    };
  }, [overview, all]);

  if (error) return <p className="error dashboard">{error}</p>;
  if (!data) return <p className="empty hint dashboard">Comparing with the Release in production…</p>;

  const changes = data.armies.flatMap((a) => a.entities.flatMap((e) => e.changes));
  const byStage = (s: Stage) => changes.filter((c) => c.stage === s).length;
  const byOrigin = (o: Origin) => changes.filter((c) => c.origin === o).length;
  const armies = new Map(keep(data.armies, (c) => (!stage || c.stage === stage) && (!origin || c.origin === origin)).map((a) => [a.id, a]));
  const filtering = Boolean(stage || origin);
  // Les lignes du tableau : les Armies chargées en tête ; un filtre de changements ne garde que celles qui en ont.
  const rows = data.board.filter((r) => !filtering || armies.has(r.id));
  const shown = findings && data.findings.filter((f) => f.kind === findings.kind && (findings.army === undefined || f.army === findings.army));

  return (
    <div className="dashboard">
      <header>
        <h2>Unreleased Changes</h2>
        <p className="hint">
          {data.release ? (
            <>
              Compared with <b>{data.release}</b>, the Release the apps read. {changes.length} change(s) in {data.armies.length} group(s).
            </>
          ) : (
            data.note
          )}
        </p>
        {data.release && data.note && <p className="hint">{data.note}</p>}
        {data.pullRequest && (
          <p className="hint">
            Your proposal:{' '}
            <a href={data.pullRequest.url} target="_blank" rel="noreferrer">
              {data.pullRequest.url.replace(/^https:\/\/github\.com\//, '')}
            </a>{' '}
            ({data.pullRequest.state.toLowerCase()})
          </p>
        )}
        {data.sources.length > 0 && <Sources sources={data.sources} />}
        <Tallies counters={data.totals} onPick={(kind) => setFindings({ kind })} />
        {changes.length > 0 && (
          <div className="filters">
            <span className="segmented" role="group" aria-label="Stage">
              <button type="button" className={stage === '' ? 'on' : ''} onClick={() => setStage('')}>
                All {changes.length}
              </button>
              {(Object.keys(STAGE) as Stage[]).map((s) => (
                <button type="button" key={s} className={stage === s ? 'on' : ''} title={STAGE[s].hint} onClick={() => setStage(s)} disabled={!byStage(s)}>
                  {STAGE[s].label} {byStage(s)}
                </button>
              ))}
            </span>
            {changes.some((c) => c.origin) && (
              <span className="segmented" role="group" aria-label="Source">
                <button type="button" className={origin === '' ? 'on' : ''} onClick={() => setOrigin('')}>
                  Any source
                </button>
                {(Object.keys(ORIGIN) as Origin[]).map((o) => (
                  <button type="button" key={o} className={origin === o ? 'on' : ''} title={ORIGIN[o].hint} onClick={() => setOrigin(o)} disabled={!byOrigin(o)}>
                    {ORIGIN[o].label} {byOrigin(o)}
                  </button>
                ))}
              </span>
            )}
            <label className="toggle">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show everything, reordered lists included
            </label>
          </div>
        )}
      </header>
      {shown && findings && (
        <section className="findings">
          <header>
            <b>
              {FINDING[findings.kind].label}
              {findings.army !== undefined && ` · ${data.board.find((r) => r.id === findings.army)?.name ?? findings.army}`}
            </b>{' '}
            <span className="count">{shown.length}</span>
            <button type="button" className="link" onClick={() => setFindings(null)}>
              close
            </button>
          </header>
          <p className="hint">{FINDING[findings.kind].hint}</p>
          {shown.map((f, i) => (
            <div className="change" key={i}>
              {f.sheet ? (
                <button type="button" className="link change-field" onClick={() => onOpen(f.sheet!)}>
                  {f.label}
                </button>
              ) : (
                <span className="change-field">{f.label}</span>
              )}
              <span className="lines">{f.detail}</span>
              {f.reattach && (
                <button type="button" onClick={() => setReattach(f.reattach!)} title="Move it to the element that replaced its target">
                  Reattach…
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      {reattach && (
        <ReattachDialog
          target={reattach}
          onClose={() => setReattach(null)}
          onDone={(to) => {
            setReattach(null);
            onWrite(`Contribution reattached to ${to}`);
          }}
        />
      )}
      {data.release && !data.note && changes.length === 0 && <p className="empty">Nothing differs from the Release in production.</p>}
      {data.caughtUp.length > 0 && <CaughtUpList items={data.caughtUp} onOpen={onOpen} onRemoved={(r) => onWrite(`${r.length} caught-up Correction(s) removed`)} />}
      {rows.map((r) => {
        const a = armies.get(r.id);
        return (
          <details className="army" key={r.id} open={rows.length === 1}>
            <summary>
              <b>{r.name}</b>{' '}
              <span className="count">
                {a ? a.entities.reduce((n, e) => n + e.changes.length, 0) : 0} change(s)
                {(Object.keys(STAGE) as Stage[])
                  .filter((s) => r.stages[s])
                  .map((s) => ` · ${r.stages[s]} ${STAGE[s].label}`)
                  .join('')}
              </span>
              <Tallies counters={r} compact onPick={(kind) => setFindings({ kind, army: r.id })} />
            </summary>
            {a?.entities.map((e) => <Entity key={`${e.kind}|${e.id}`} entity={e} onOpen={onOpen} />)}
            {!a && <p className="hint">No unreleased change: only things to handle or complete.</p>}
          </details>
        );
      })}
    </div>
  );
}
