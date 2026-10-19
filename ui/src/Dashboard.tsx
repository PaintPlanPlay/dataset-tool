/**
 * Le tableau de bord, page d'accueil de l'interface : les Unreleased Changes,
 * tout ce qui sépare la Dataset Release que lisent les apps de ce que l'outil
 * construit maintenant. Lu comme un diff git : rouge ce qui part, vert ce qui
 * arrive, Army par Army.
 */
import { useEffect, useState } from 'react';
import { api, type EntityChange, type FieldChange, type Overview, type SourceShift, type Unreleased } from './api.ts';

const SOURCE: Record<string, string> = { bsdata: 'BSData', mfm: 'MFM' };
const KIND: Record<EntityChange['kind'], string> = { unit: 'Unit', detachment: 'Detachment', stratagem: 'Stratagem', armyRule: 'Army Rule', core: 'Core' };
const STATUS: Record<EntityChange['status'], string> = { added: 'new', removed: 'removed', changed: '' };

const short = (commit: string | null) => (commit ? commit.slice(0, 7) : '—');
const version = (commit: string | null, v?: string) => `${v ? `${v} · ` : ''}${short(commit)}`;

function Sources({ sources }: { sources: SourceShift[] }) {
  return (
    <table className="shifts">
      <tbody>
        {sources.map((s) => {
          const moved = s.before !== s.after;
          return (
            <tr key={s.id} className={moved ? 'moved' : undefined}>
              <th>{SOURCE[s.id] ?? s.id}</th>
              <td title={s.before ?? undefined}>{version(s.before, s.beforeVersion)}</td>
              <td>{moved ? '→' : '='}</td>
              <td title={s.after ?? undefined}>{version(s.after, s.afterVersion)}</td>
            </tr>
          );
        })}
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
            <span className="field">{c.field}</span>
            <span className="lines">
              <Lines change={c} />
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

export function Dashboard({ overview, onOpen }: { overview: Overview | null; onOpen: (target: string) => void }) {
  const [data, setData] = useState<Unreleased | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [all, setAll] = useState(false);

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
  const total = data.armies.reduce((n, a) => n + a.entities.reduce((m, e) => m + e.changes.length, 0), 0);

  return (
    <div className="dashboard">
      <header>
        <h2>Unreleased Changes</h2>
        <p className="hint">
          {data.release ? (
            <>
              Compared with <b>{data.release}</b>, the Release the apps read. {total} change(s) in {data.armies.length} Army(ies).
            </>
          ) : (
            data.note
          )}
        </p>
        {data.release && data.note && <p className="hint">{data.note}</p>}
        {data.sources.length > 0 && <Sources sources={data.sources} />}
        <label className="toggle">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show everything, reordered lists included
        </label>
      </header>
      {data.release && !data.note && total === 0 && <p className="empty">Nothing differs from the Release in production.</p>}
      {data.armies.map((a) => (
        <details className="army" key={a.id} open={data.armies.length === 1}>
          <summary>
            <b>{a.name}</b> <span className="count">{a.entities.reduce((n, e) => n + e.changes.length, 0)} change(s)</span>
          </summary>
          {a.entities.map((e) => (
            <Entity key={`${e.kind}|${e.id}`} entity={e} onOpen={onOpen} />
          ))}
        </details>
      ))}
    </div>
  );
}
