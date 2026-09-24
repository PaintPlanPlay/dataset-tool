/**
 * La colonne de gauche : l'état global. Les versions en présence, le nombre de
 * Corrections, si l'on est à jour des Upstream Sources, et les tâches longues
 * avec leur journal en flux. Tout ce qui décide (bouton actif ou non, et
 * pourquoi) vient de l'API.
 */
import { useEffect, useRef, useState } from 'react';
import { api, type ButtonName, type ButtonState, type JobReport, type Overview, type PendingChange } from './api.ts';

const LABEL: Record<ButtonName, string> = {
  update: 'Update data',
  build: 'Save & Build',
  propose: 'Propose my change',
  release: 'Publish Release',
  check: 'Check',
};
const ORDER: ButtonName[] = ['update', 'build', 'propose', 'release', 'check'];

const short = (commit: string) => commit.slice(0, 7);

interface Props {
  overview: Overview | null;
  error: string | null;
  pending: PendingChange[];
  /** Après une tâche : relire l'état, et la fiche ouverte. */
  onChanged: () => void;
  onUndo: (id: string) => void;
  /** Ouvrir la fiche d'une Pending Change. */
  onOpen: (sheet: string) => void;
  onCorrections: () => void;
  onDisagreements: () => void;
}

const ACTION: Record<PendingChange['action'], string> = { added: 'new', modified: 'changed', deleted: 'removed' };

export function StatusColumn({ overview, error, pending, onChanged, onUndo, onOpen, onCorrections, onDisagreements }: Props) {
  const [report, setReport] = useState<JobReport | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [asking, setAsking] = useState<ButtonState | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const since = useRef(0);
  const running = report?.job?.state === 'running';

  // Le journal de la tâche en cours, relu au fil de l'eau ; à la fin, l'état se relit.
  useEffect(() => {
    let stop = false;
    let wasRunning = false;
    const tick = async () => {
      try {
        const r = await api.jobs(since.current);
        if (stop) return;
        if (r.next < since.current) setLines(r.lines);
        else if (r.lines.length) setLines((l) => [...l, ...r.lines]);
        since.current = r.next;
        setReport(r);
        const now = r.job?.state === 'running';
        if (wasRunning && !now) {
          /*
           * Seules les tâches qui changent les sources ou les Corrections du
           * dossier (Update data, Publish, qui tire `main`) demandent au serveur
           * de reconstruire le Dataset — une vingtaine de secondes où il ne
           * répond plus. Après un build ou une proposition, l'état se relit tout
           * de suite : c'est lui qui ouvre Propose my change.
           */
          if (r.job?.name === 'update' || r.job?.name === 'release') await api.refresh().catch(() => undefined);
          onChanged();
        }
        wasRunning = now;
      } catch {
        // Le serveur redémarre : on réessaie au prochain tour.
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 1000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [onChanged]);

  const start = async (button: ButtonState, body: Record<string, string> = {}) => {
    setStartError(null);
    setAsking(null);
    try {
      setLines([]);
      since.current = 0;
      await api.startJob(button.name, body);
    } catch (err) {
      setStartError((err as Error).message);
    }
  };

  const sources = overview?.versions.sources ?? [];
  const source = (id: string) => sources.find((s) => s.id === id);
  const bsdata = source('bsdata');
  const mfm = source('mfm');
  const moved = sources.filter((s) => s.upToDate === false);

  return (
    <aside className="status">
      <h1>Dataset Tool</h1>
      {error && <p className="error">{error}</p>}

      <dl className="versions">
        <dt>Dataset Release</dt>
        <dd>{overview?.versions.release ?? '—'}</dd>
        <dt>Dataslate</dt>
        <dd>{overview?.versions.dataslate?.name ?? '—'}</dd>
        <dt>BSData</dt>
        <dd title={bsdata?.commit}>{bsdata ? short(bsdata.commit) : '—'}</dd>
        <dt>MFM</dt>
        <dd title={mfm?.commit}>{mfm ? `${mfm.version ?? '?'} · ${short(mfm.commit)}` : '—'}</dd>
        <dt>Corrections</dt>
        <dd>
          <button type="button" className="link" onClick={onCorrections} title="Every Correction and Contribution of the Dataset">
            {overview?.corrections ?? '—'}
          </button>
        </dd>
        <dt>Disagreements</dt>
        <dd>
          <button type="button" className="link" onClick={onDisagreements} title="Where two Upstream Sources disagree and the authoritative one won">
            {overview?.disagreements ?? '—'}
          </button>
        </dd>
        <dt>Suggested Effects</dt>
        <dd title="Effects the ability analysis proposes, waiting for review on their Unit">{overview?.suggestions ?? '—'}</dd>
      </dl>

      {overview?.pullRequest && (
        <p className="pull-request">
          Pull request{' '}
          <a href={overview.pullRequest.url} target="_blank" rel="noreferrer">
            #{overview.pullRequest.url.split('/').pop()}
          </a>{' '}
          <span className={`pr-state ${overview.pullRequest.state.toLowerCase()}`}>{overview.pullRequest.state === 'OPEN' ? 'in review' : overview.pullRequest.state.toLowerCase()}</span>
        </p>
      )}

      {overview && (
        <p className={`freshness ${overview.upToDate === true ? 'ok' : overview.upToDate === false ? 'late' : 'unknown'}`}>
          {overview.upToDate === true
            ? 'Up to date with the Upstream Sources'
            : overview.upToDate === false
              ? moved.length
                ? `Out of date: ${moved.map((s) => s.id).join(', ')} moved`
                : 'Out of date: no data yet'
              : 'Up-to-date status unknown (offline?)'}
        </p>
      )}

      <div className="buttons">
        {overview &&
          ORDER.map((name) => overview.buttons[name])
            .filter((b) => b.visible)
            .map((b) => (
              <button
                key={b.name}
                disabled={!b.enabled || running}
                title={b.reason ?? b.hint}
                onClick={() => (b.asks.length ? setAsking(b) : void start(b))}
              >
                {LABEL[b.name]}
              </button>
            ))}
      </div>
      {startError && <p className="error">{startError}</p>}
      {overview && !overview.gh && (
        <p className="hint-line">
          The GitHub CLI is not usable by this interface: Propose and Publish need it. Run <code>gh auth login</code>, and check that <code>gh</code> is on the PATH.
        </p>
      )}

      <section className="pending">
        <h2>
          Pending changes <span className="count">{pending.length}</span>
        </h2>
        {pending.length === 0 ? (
          <p className="empty">Nothing waiting to be proposed.</p>
        ) : (
          <ul>
            {pending.map((p) => (
              <li key={p.id} className={p.state === 'stale' || p.state === 'conflict' || p.state === 'flagged' ? 'attention' : ''}>
                <button type="button" className="link pending-open" onClick={() => onOpen(p.sheet)} title={p.reason || p.path}>
                  <span className="pending-action">{ACTION[p.action]}</span> {p.target}
                  {p.state && p.state !== 'active' && <span className={`state ${p.state}`}> {p.state === 'conflict' ? 'in conflict' : p.state}</span>}
                </button>
                <button type="button" className="remove visible" title="Undo this change" onClick={() => onUndo(p.id)}>
                  −
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {asking && <AskForm button={asking} onCancel={() => setAsking(null)} onSubmit={(body) => void start(asking, body)} />}

      {report?.job && (
        <section className="job">
          <h2>
            {LABEL[report.job.name as ButtonName] ?? report.job.name} <span className={`job-state ${report.job.state}`}>{report.job.state}</span>
          </h2>
          <pre className="log">{lines.join('\n') || '…'}</pre>
        </section>
      )}
    </aside>
  );
}

/** Ce qu'une tâche demande avant de partir : un titre de PR, une Dataslate. */
function AskForm({ button, onCancel, onSubmit }: { button: ButtonState; onCancel: () => void; onSubmit: (body: Record<string, string>) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(button.asks.map((f) => [f.name, f.value ?? ''])));
  return (
    <form
      className="ask"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
      }}
    >
      {button.asks.map((f) => (
        <label key={f.name}>
          <span className="field-label">{f.label}</span>
          <input value={values[f.name] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
          <small>{f.hint}</small>
        </label>
      ))}
      <div className="ask-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="primary">
          {LABEL[button.name]}
        </button>
      </div>
    </form>
  );
}
