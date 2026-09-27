/**
 * La barre de la fiche : une recherche sur toutes les Armies — Units,
 * Detachments, Stratagems et l'entrée Core —, chaque résultat avec son Army, et
 * un filtre d'Army que le navigateur retient d'une visite à l'autre.
 */
import { useEffect, useState } from 'react';
import { api, type SearchHit } from './api.ts';

const FILTER_KEY = 'dataset-tool.army-filter';

/** Le filtre retenu ; une préférence de ce navigateur, rien de plus. */
function storedFilter(): string {
  try {
    return localStorage.getItem(FILTER_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeFilter(army: string): void {
  try {
    if (army) localStorage.setItem(FILTER_KEY, army);
    else localStorage.removeItem(FILTER_KEY);
  } catch {
    // Stockage refusé (navigation privée) : le filtre vaut pour cette visite.
  }
}

const KIND: Record<SearchHit['kind'], string> = { unit: 'Unit', detachment: 'Detachment', stratagem: 'Stratagem', armyRule: 'Army Rule', core: 'Core' };

interface Props {
  armies: { id: string; name: string }[];
  /** Le nom de la fiche ouverte. */
  open: string | null;
  onOpen: (hit: SearchHit) => void;
  /** La fiche porte des modifications non enregistrées. */
  dirty: boolean;
  /** Corrections et Contributions de la fiche ouverte ; `null` sans fiche. */
  corrections: number | null;
  onSave: () => void;
  onCorrections: () => void;
}

export function SheetBar({ armies, open, onOpen, dirty, corrections, onSave, onCorrections }: Props) {
  const [query, setQuery] = useState('');
  const [army, setArmy] = useState(storedFilter);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    let stale = false;
    const timer = setTimeout(() => {
      api
        .search(query, army)
        .then((h) => {
          if (stale) return;
          setHits(h);
          setError(null);
        })
        .catch((err: Error) => !stale && setError(err.message));
    }, 150);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query, army]);

  const pick = (hit: SearchHit) => {
    onOpen(hit);
    setQuery('');
  };

  return (
    <header className="sheet-bar">
      <div className="search">
        <input
          type="search"
          placeholder="Search a Unit, Detachment, Stratagem or Core…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && hits[0] && pick(hits[0])}
        />
        <select
          value={army}
          onChange={(e) => {
            setArmy(e.target.value);
            storeFilter(e.target.value);
          }}
          title="Army filter, remembered by this browser"
        >
          <option value="">All Armies</option>
          {armies.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        {(hits.length > 0 || error) && query.trim() && (
          <ul className="results">
            {error && <li className="error">{error}</li>}
            {hits.map((h) => (
              <li key={h.target}>
                <button onClick={() => pick(h)}>
                  <span className="hit-name">{h.name}</span>
                  <span className="hit-army"> · {h.armyName}</span>
                  <span className="hit-kind">{KIND[h.kind]}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <h2 className="sheet-name">
        {open ?? 'No sheet open'}
        {dirty && <span className="badge edited" title="Unsaved edits" />}
      </h2>
      {corrections !== null && (
        <div className="sheet-actions">
          <button type="button" onClick={onCorrections} title="The Corrections and Contributions applied to this sheet">
            Corrections ({corrections})
          </button>
          <button
            type="button"
            className="primary"
            disabled={!dirty}
            onClick={onSave}
            title="Writes this sheet's change into the Dataset repository. Save & Build, on the left, then rebuilds the Dataset files and checks them before you propose."
          >
            Save sheet
          </button>
        </div>
      )}
    </header>
  );
}
