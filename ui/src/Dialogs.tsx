/**
 * Les pop-ups de la nouvelle interface : la raison d'un Save, le garde-fou à
 * la sortie d'une fiche modifiée, la liste des Corrections (d'une fiche ou de
 * tout le Dataset), et les désaccords entre sources.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Modifier } from '@paintplanplay/dataset-schema';
import { api, type CorrectionItem, type SourceConflict } from './api.ts';
import { toast } from './Toast.tsx';

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="backdrop" onClick={onClose}>
      <div className={`dialog${wide ? ' wide' : ''}`} role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Save ne demande que la raison : l'outil fait le reste. */
export function SaveDialog({ busy, findings, onSave, onClose }: { busy: boolean; findings: string[]; onSave: (reason: string) => void; onClose: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title="Save" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (reason.trim()) onSave(reason.trim());
        }}
      >
        <label className="field field-block">
          <span className="field-label">Why? One sentence, in your own words — shared by every change on this sheet.</span>
          <input autoFocus value={reason} maxLength={240} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The September dataslate raised this unit to 300 points." />
        </label>
        {findings.length > 0 && (
          <ul className="findings">
            {findings.map((f, i) => (
              <li key={i} className="error">
                {f}
              </li>
            ))}
          </ul>
        )}
        <div className="dialog-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || !reason.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Quitter une fiche modifiée : enregistrer, abandonner ou rester. */
export function LeaveDialog({ onSave, onDiscard, onCancel }: { onSave: () => void; onDiscard: () => void; onCancel: () => void }) {
  return (
    <Modal title="Unsaved edits" onClose={onCancel}>
      <p>This sheet has edits that are not saved yet.</p>
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" onClick={onDiscard}>
          Discard
        </button>
        <button type="button" className="primary" onClick={onSave}>
          Save…
        </button>
      </div>
    </Modal>
  );
}

const STATE_LABEL: Record<string, string> = { active: 'active', stale: 'stale', conflict: 'in conflict', flagged: 'upstream changed', rejected: 'rejected', unresolved: 'target missing' };

/**
 * Les Corrections et Contributions d'une fiche, ou de tout le Dataset. En
 * retirer une (après confirmation) en fait une Pending Change de suppression.
 */
export function CorrectionsDialog({ sheet, onOpen, onChanged, onClose }: { sheet: string; onOpen?: (sheet: string) => void; onChanged: () => void; onClose: () => void }) {
  const [items, setItems] = useState<CorrectionItem[] | null>(null);
  const [q, setQ] = useState('');
  const [confirm, setConfirm] = useState<CorrectionItem | null>(null);
  const load = useCallback(() => api.corrections(sheet, q).then(setItems, (e: Error) => toast.error('Corrections could not be listed', e.message)), [sheet, q]);
  useEffect(() => void load(), [load]);

  const remove = async (item: CorrectionItem) => {
    setConfirm(null);
    try {
      await api.deleteCorrection(item.kind === 'correction' ? { path: item.path } : { target: item.target });
      await load();
      onChanged();
    } catch (e) {
      toast.error(`${item.target}: not removed`, (e as Error).message);
    }
  };

  const propose = async (item: CorrectionItem) => {
    const draft = await api.upstreamDraft(item.path);
    window.open(draft.url, '_blank', 'noopener');
  };

  return (
    <Modal title={sheet ? `Corrections (${items?.length ?? '…'})` : 'All Corrections and Contributions'} onClose={onClose} wide>
      {!sheet && <input type="search" placeholder="Filter by target, file or reason…" value={q} onChange={(e) => setQ(e.target.value)} />}
      {items?.length === 0 && <p className="empty">Nothing here: every value comes from the Upstream Sources as they are.</p>}
      <ul className="corrections">
        {items?.map((c) => (
          <li key={`${c.path}|${c.target}`} className={`correction ${c.state}`}>
            <div className="correction-head">
              <span className={`state ${c.state}`}>{STATE_LABEL[c.state] ?? c.state}</span>
              <span className="kind">{c.kind === 'correction' ? `Correction · ${c.source}` : 'Contribution · project'}</span>
              {onOpen && !sheet ? (
                <button type="button" className="link" onClick={() => onOpen(c.sheet)}>
                  {c.target}
                </button>
              ) : (
                <code>{c.target}</code>
              )}
            </div>
            <p className="reason">{c.reason}</p>
            {c.note && <p className="note-line">{c.note}</p>}
            {c.patch && <code className="patch">{JSON.stringify(c.patch)}</code>}
            <div className="correction-actions">
              <small>{c.path}</small>
              {c.upstreamPr ? (
                <a href={c.upstreamPr} target="_blank" rel="noreferrer">
                  upstream PR
                </a>
              ) : (
                c.kind === 'correction' && (
                  <>
                    <button type="button" className="link" onClick={() => void propose(c)} title="Open a prefilled issue with the Upstream Source, so it fixes itself">
                      tell {c.source}
                    </button>
                    <input
                      className="pr-input"
                      placeholder="paste its issue or PR link"
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter') return;
                        const url = e.currentTarget.value.trim();
                        void api.recordPr(c.path, url).then(
                          () => {
                            toast.ok('Upstream link recorded');
                            void load();
                            onChanged();
                          },
                          (err: Error) => toast.error('Upstream link not recorded', err.message),
                        );
                      }}
                    />
                  </>
                )
              )}
              <button type="button" onClick={() => setConfirm(c)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      {confirm && (
        <Modal title="Delete?" onClose={() => setConfirm(null)}>
          <p>
            Delete this {confirm.kind} on <code>{confirm.target}</code>? It becomes a Pending Change: nothing leaves your machine until you propose it, and you can undo it
            until then.
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button type="button" className="danger" onClick={() => void remove(confirm)}>
              Delete
            </button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}

/** Les désaccords entre sources : la source qui fait autorité l'a emporté, à vous de juger s'il faut corriger. */
export function DisagreementsDialog({ onOpen, onClose }: { onOpen: (sheet: string) => void; onClose: () => void }) {
  const [items, setItems] = useState<SourceConflict[] | null>(null);
  useEffect(() => void api.disagreements().then(setItems), []);
  return (
    <Modal title={`Disagreements between sources (${items?.length ?? '…'})`} onClose={onClose} wide>
      <ul className="corrections">
        {items?.map((c, i) => (
          <li key={i} className="correction">
            <div className="correction-head">
              <span className="kind">{c.entity}</span>
              {/* Une Enhancement se corrige sur la fiche de son Detachment, que le désaccord ne nomme pas. */}
              {c.entity === 'enhancement' ? (
                <strong>{c.name}</strong>
              ) : (
                <button type="button" className="link" onClick={() => onOpen(c.entity === 'unit' ? c.id : `${c.army}::${c.entity}:${c.id}`)}>
                  {c.name}
                </button>
              )}
              <span className="muted"> · {c.army}</span>
            </div>
            <p>
              {c.field}: {c.authority} <code>{c.kept}</code> kept, {c.other.source} <code>{c.other.value}</code> set aside
            </p>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** Les clés de Modifier que la Simulation ne sait pas jouer : une saisie à reprendre, ou un oubli du simulateur. */
export function UnsimulatedDialog({ onOpen, onClose }: { onOpen: (sheet: string) => void; onClose: () => void }) {
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.unsimulated>> | null>(null);
  useEffect(() => void api.unsimulated().then(setItems), []);
  return (
    <Modal title={`Modifier keys the simulation does not play (${items?.length ?? '…'})`} onClose={onClose} wide>
      <p className="hint">Either the key is misspelt — fix it on its Rule — or the simulator has yet to learn it.</p>
      <ul className="corrections">
        {items?.map((u, i) => (
          <li key={i} className="correction">
            <div className="correction-head">
              <code>{u.key}</code>{' '}
              <button type="button" className="link" onClick={() => onOpen(u.sheet)}>
                {u.rule}
              </button>
              <span className="muted"> · {u.target}</span>
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

/** Un Modifier en une ligne, tel qu'on le saisit : « hit 1 · self · if melee ». */
const modifierLine = (m: Modifier) =>
  [`${m.key}${m.value !== undefined ? ` ${m.value}` : ''}`, m.target, ...(m.conditions?.length ? [`if ${m.conditions.map((c) => `${c.key}${c.value !== undefined ? ` ${c.value}` : ''}`).join(', ')}`] : [])].join(' · ');

const RULE_TYPES = ['', 'ability', 'armyrule', 'rule', 'enhancement', 'stratagem'];

/**
 * Les Rules extraites qui attendent un humain : celles dont la lecture diffère
 * de 40kdc-data, côte à côte, et celles qui n'ont que la nôtre. Valider les
 * passe en « revu » ; les retoucher se fait sur leur fiche. Un lot extrait
 * s'importe ici, en JSON.
 */
export function ReviewDialog({ armies, onOpen, onChanged, onClose }: { armies: { id: string; name: string }[]; onOpen: (sheet: string) => void; onChanged: () => void; onClose: () => void }) {
  const [army, setArmy] = useState('');
  const [type, setType] = useState('');
  const [items, setItems] = useState<Awaited<ReturnType<typeof api.review>> | null>(null);
  const reload = useCallback(() => void api.review(army, type).then(setItems), [army, type]);
  useEffect(reload, [reload]);
  const importFile = async (file: File) => {
    const t = toast.busy(`Importing ${file.name}…`);
    try {
      const rules = JSON.parse(await file.text()) as unknown[];
      const r = await api.importReview(rules);
      const refused = r.rejected.map((x) => `${x.target} (${x.reason})`).join('; ');
      if (r.rejected.length) toast.error(`${r.written} Rule(s) imported, ${r.rejected.length} refused`, refused, t);
      else toast.ok(`${r.written} Rule(s) imported`, undefined, t);
      onChanged();
      reload();
    } catch (e) {
      toast.error(`${file.name} not imported`, (e as Error).message, t);
    }
  };
  return (
    <Modal title={`Rules to review (${items?.length ?? '…'})`} onClose={onClose} wide>
      <div className="review-bar">
        <select value={army} onChange={(e) => setArmy(e.target.value)}>
          <option value="">All armies</option>
          {armies.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select value={type} onChange={(e) => setType(e.target.value)}>
          {RULE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t || 'All Rules'}
            </option>
          ))}
        </select>
        <label className="link">
          Import extracted Rules…
          <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
        </label>
      </div>
      <ul className="corrections">
        {items?.map((i) => (
          <li key={i.target} className="correction">
            <div className="correction-head">
              <span className="kind">{i.status === 'divergent' ? 'differs' : 'one reading'}</span>
              <button type="button" className="link" onClick={() => onOpen(i.sheet)}>
                {i.rule}
              </button>
              <span className="muted">
                {' '}
                · {i.type} · {i.army}
              </span>
              <button
                type="button"
                className="link"
                style={{ marginLeft: 'auto' }}
                onClick={() =>
                  void api.validateReview(i.target).then(
                    () => {
                      toast.ok(`${i.rule} validated`);
                      onChanged();
                      reload();
                    },
                    (e: Error) => toast.error(`${i.rule} not validated`, e.message),
                  )
                }
              >
                Validate
              </button>
            </div>
            <div className="review-readings">
              <div>
                <strong>Ours</strong>
                <ul>{i.ours.map((m, k) => <li key={k}>{modifierLine(m)}</li>)}</ul>
              </div>
              {i.status === 'divergent' && (
                <div>
                  <strong>40kdc-data</strong>
                  {i.kdc ? <ul>{i.kdc.map((m, k) => <li key={k}>{modifierLine(m)}</li>)}</ul> : <pre>{JSON.stringify(i.kdcEffect, null, 1)}</pre>}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
