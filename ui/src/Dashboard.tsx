/**
 * Le tableau de bord, page d'accueil de l'interface : les Unreleased Changes,
 * tout ce qui sépare la Dataset Release que lisent les apps de ce que l'outil
 * construit maintenant. Lu comme un diff git : rouge ce qui part, vert ce qui
 * arrive, Army par Army, chaque changement à son étape.
 */
import { useEffect, useState } from 'react';
import { api, type ArmyChanges, type EntityChange, type FieldChange, type Overview, type SourceShift, type Stage, type Unreleased } from './api.ts';

const SOURCE: Record<string, string> = { bsdata: 'BSData', mfm: 'MFM' };
const KIND: Record<EntityChange['kind'], string> = { unit: 'Unit', detachment: 'Detachment', stratagem: 'Stratagem', armyRule: 'Army Rule', core: 'Core' };
const STATUS: Record<EntityChange['status'], string> = { added: 'new', removed: 'removed', changed: '' };
const STAGE: Record<Stage, { label: string; hint: string }> = {
  merged: { label: 'on main', hint: 'Merged: the next Release publishes it' },
  proposed: { label: 'proposed', hint: 'In a pull request under review' },
  local: { label: 'local', hint: 'On this machine only: nothing proposed yet' },
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
              {c.field} <StageBadge stage={c.stage} />
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

/** Ne garder que les changements qu'un filtre retient, et ce qui en porte encore. */
function keep(armies: ArmyChanges[], ok: (c: FieldChange) => boolean): ArmyChanges[] {
  return armies
    .map((a) => ({ ...a, entities: a.entities.map((e) => ({ ...e, changes: e.changes.filter(ok) })).filter((e) => e.changes.length) }))
    .filter((a) => a.entities.length);
}

export function Dashboard({ overview, onOpen }: { overview: Overview | null; onOpen: (target: string) => void }) {
  const [data, setData] = useState<Unreleased | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [stage, setStage] = useState<Stage | ''>('');

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
  const armies = keep(data.armies, (c) => !stage || c.stage === stage);

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
            <label className="toggle">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show everything, reordered lists included
            </label>
          </div>
        )}
      </header>
      {data.release && !data.note && changes.length === 0 && <p className="empty">Nothing differs from the Release in production.</p>}
      {armies.map((a) => (
        <details className="army" key={a.id} open={armies.length === 1}>
          <summary>
            <b>{a.name}</b>{' '}
            <span className="count">
              {a.entities.reduce((n, e) => n + e.changes.length, 0)} change(s)
              {a.stages &&
                (Object.keys(STAGE) as Stage[])
                  .filter((s) => a.stages![s])
                  .map((s) => ` · ${a.stages![s]} ${STAGE[s].label}`)
                  .join('')}
            </span>
          </summary>
          {a.entities.map((e) => (
            <Entity key={`${e.kind}|${e.id}`} entity={e} onOpen={onOpen} />
          ))}
        </details>
      ))}
    </div>
  );
}
