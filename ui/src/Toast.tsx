/**
 * Les notifications de l'interface : un empilement fixe en bas à droite,
 * visible quel que soit le défilement. Une notification « busy » tourne tant
 * qu'on ne la met pas à jour ; « ok » et « info » s'effacent seules ; une
 * erreur reste jusqu'à ce qu'on la ferme.
 *
 * Le magasin vit hors de React : n'importe quel module annonce un état
 * (`toast.busy`, puis `toast.ok` sur le même identifiant) sans qu'on lui passe
 * de contexte.
 */
import { useSyncExternalStore } from 'react';

export type ToastKind = 'busy' | 'ok' | 'info' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  /** Le détail, sur une seconde ligne : les fichiers écrits, la raison d'un refus. */
  detail?: string;
}

const LINGER_MS = 4000;

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

const emit = () => {
  for (const l of listeners) l();
};

function put(kind: ToastKind, text: string, detail?: string, id = nextId++): number {
  clearTimeout(timers.get(id));
  timers.delete(id);
  const toast: Toast = { id, kind, text, ...(detail ? { detail } : {}) };
  toasts = toasts.some((t) => t.id === id) ? toasts.map((t) => (t.id === id ? toast : t)) : [...toasts, toast];
  if (kind === 'ok' || kind === 'info') timers.set(id, setTimeout(() => dismiss(id), LINGER_MS));
  emit();
  return id;
}

function dismiss(id: number): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Annoncer un état ; passer l'identifiant d'une notification la remplace sur place. */
export const toast = {
  busy: (text: string, id?: number) => put('busy', text, undefined, id),
  ok: (text: string, detail?: string, id?: number) => put('ok', text, detail, id),
  info: (text: string, detail?: string, id?: number) => put('info', text, detail, id),
  error: (text: string, detail?: string, id?: number) => put('error', text, detail, id),
  dismiss,
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function Toasts() {
  const list = useSyncExternalStore(subscribe, () => toasts, () => toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'busy' && <span className="spinner" aria-hidden />}
          <div className="toast-body">
            <span>{t.text}</span>
            {t.detail && <span className="toast-detail">{t.detail}</span>}
          </div>
          {t.kind !== 'busy' && (
            <button type="button" className="toast-close" title="Dismiss" onClick={() => dismiss(t.id)}>
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
