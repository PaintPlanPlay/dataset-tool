/**
 * La partie équipement d'une fiche d'Unit décrite en phrases (ADR « Wargear
 * Options en phrases ») : le tableau des Weapons avec une colonne de Default
 * Wargear par type de figurine, puis les Wargear Options écrites comme des
 * phrases à trous. Les menus ne proposent que ce que l'Unit a déjà : ses
 * Weapons, ses types de figurine, ses lignes du MFM.
 *
 * Une cellule corrigée est une Correction ; une phrase écrite ou corrigée, une
 * Contribution — l'enregistrement en décide, pas la fiche.
 */
import { useEffect, useRef, useState } from 'react';
import { modelTypesOf, wargearSentence, weaponName, type ModelType, type Unit, type WargearAlternative, type WargearOption, type WargearWho, type WeaponCount } from '@paintplanplay/dataset-schema';
import { Badges, Field, useEditor, type FieldProps } from '../editor/Editor.tsx';
import { pointer, type Path } from '../editor/values.ts';

const weaponRef = (w: { kind: string; name: string }) => `${w.kind}|${w.name}`;

/** La section où ouvrir la prochaine fiche, posée par le tableau de bord. */
export const SCROLL_KEY = 'sheet-scroll-to';

/** Le tableau des Weapons, et ce que chaque type de figurine en porte d'office. */
export function DefaultWargearTable({ section }: { section: string }) {
  const ctx = useEditor();
  const unit = ctx.draft as Unit;
  const types = unit.modelTypes ?? [];
  const set = (ti: number, ref: string, count: number) => {
    const next = types.map((t, i): ModelType => {
      if (i !== ti) return t;
      const others = t.defaultWargear.filter((w) => w.weapon !== ref);
      return { ...t, defaultWargear: count > 0 ? [...others, { weapon: ref, count }] : others };
    });
    ctx.onChange(['modelTypes'], next);
  };
  const carried = (t: ModelType, ref: string) => t.defaultWargear.find((w) => w.weapon === ref)?.count ?? 0;
  // Une Correction porte tout le Default Wargear : chaque cellule dit si elle s'écarte de BSData, ou du chargé.
  const correction = (ctx.marks.get('/modelTypes') ?? []).find((m) => m.kind === 'correction');
  const before = (list: unknown, type: string, ref: string) =>
    ((list as ModelType[] | undefined)?.find((t) => t.name === type)?.defaultWargear.find((w) => w.weapon === ref)?.count ?? 0);
  const cellBadges = (t: ModelType, ref: string) => {
    const now = carried(t, ref);
    const corrected = correction && before(correction.upstream, t.name, ref) !== now;
    const edited = before((ctx.original as Unit).modelTypes, t.name, ref) !== now;
    return (
      <>
        {edited && <span className="badge edited" title="Edited, not saved yet" />}
        {corrected && !edited && (
          <span className={`badge published ${correction!.state}`} title={`Correction (${correction!.state}) — ${correction!.file}\nBSData: ${before(correction!.upstream, t.name, ref)}\nwhy: ${correction!.reason}`} />
        )}
      </>
    );
  };
  return (
    <section className="list">
      <h3 className="list-title">
        Default Wargear <span className="section-source">· {section}</span>
        <Badges path={['modelTypes']} value={unit.modelTypes} />
      </h3>
      <p className="hint-line">What one model of each type carries before any Wargear Option is taken — « This model is equipped with ».</p>
      <table className="default-wargear">
        <thead>
          <tr>
            <th>Weapon</th>
            <th>Profile</th>
            {types.map((t) => (
              <th key={t.name} title={`${t.min}–${t.max} models`}>
                {t.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {unit.weapons.map((w) => {
            const ref = weaponRef(w);
            const p = w.profiles[0];
            return (
              <tr key={ref}>
                <td>
                  {w.kind === 'melee' ? '⚔' : '➶'} {w.name}
                </td>
                <td className="muted">{p ? `${p.range} · A${p.A} S${p.S} AP${p.AP} D${p.D}${w.profiles.length > 1 ? ` (+${w.profiles.length - 1})` : ''}` : ''}</td>
                {types.map((t, ti) => (
                  <td key={t.name}>
                    <input
                      type="number"
                      min={0}
                      className="count-cell"
                      aria-label={`${t.name} carries ${w.name}`}
                      value={carried(t, ref) || ''}
                      placeholder="0"
                      onChange={(e) => set(ti, ref, Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                    />
                    {cellBadges(t, ref)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {ctx.errors.get('/modelTypes') && <p className="note error">{ctx.errors.get('/modelTypes')!.join(' · ')}</p>}
    </section>
  );
}

/** Les Wargear Options en phrases : une ligne par phrase, et de quoi en écrire une. */
export function WargearOptionsEditor({ section, at }: { section: string; at: FieldProps['at'] }) {
  const ctx = useEditor();
  const unit = ctx.draft as Unit;
  const options = unit.wargearOptions ?? [];
  const set = (next: WargearOption[]) => ctx.onChange(['wargearOptions'], next);
  // Ouverte depuis « options à écrire » : la fiche s'ouvre ici.
  const here = useRef<HTMLElement>(null);
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SCROLL_KEY) !== 'wargear-options') return;
      sessionStorage.removeItem(SCROLL_KEY);
    } catch {
      return;
    }
    here.current?.scrollIntoView({ block: 'start' });
  }, []);
  const add = () => {
    const taken = new Set(options.map((o) => o.id));
    let n = options.length + 1;
    while (taken.has(`contrib-${n}`)) n++;
    const model = modelTypesOf(unit)[0]?.name ?? unit.name;
    set([...options, { id: `contrib-${n}`, model, who: { type: 'each' }, replaces: [], alternatives: [{ id: `contrib-${n}-1`, weapons: [] }] }]);
  };
  return (
    <section className="list" ref={here}>
      <h3 className="list-title">
        Wargear Options <span className="count">{options.length}</span>
        <span className="section-source"> · {section}</span>
        <button type="button" className="add" title="Write a Wargear Option — a Contribution" onClick={add}>
          + Wargear Option · Contribution
        </button>
      </h3>
      {options.length === 0 && <p className="empty">No Wargear Option: this Unit only carries its Default Wargear — or its options are still to write.</p>}
      {options.map((o, i) => (
        <SentenceEditor key={o.id} option={o} index={i} at={at} onRemove={() => set(options.filter((_x, j) => j !== i))} />
      ))}
    </section>
  );
}

/** Les menus d'une Weapon de l'Unit, et ce qu'on en a choisi. */
function WeaponPicks({ value, onChange, label, counts }: { value: WeaponCount[]; onChange: (next: WeaponCount[]) => void; label: string; counts?: boolean }) {
  const ctx = useEditor();
  const unit = ctx.draft as Unit;
  const refs = unit.weapons.map(weaponRef);
  return (
    <span className="weapon-picks">
      {value.map((w, i) => (
        <span key={`${w.weapon}|${i}`} className="tag">
          {counts && (
            <input
              type="number"
              min={1}
              className="count-cell"
              aria-label={`How many ${weaponName(w.weapon)}`}
              value={w.count}
              onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, count: Math.max(1, Math.floor(Number(e.target.value) || 1)) } : x)))}
            />
          )}
          {weaponName(w.weapon)}
          <button type="button" className="tag-remove" title="Remove" onClick={() => onChange(value.filter((_x, j) => j !== i))}>
            ×
          </button>
        </span>
      ))}
      <select aria-label={label} value="" onChange={(e) => e.target.value && onChange([...value, { weapon: e.target.value, count: 1 }])}>
        <option value="">{label}</option>
        {refs
          .filter((r) => !value.some((w) => w.weapon === r))
          .map((r) => (
            <option key={r} value={r}>
              {weaponName(r)}
            </option>
          ))}
      </select>
    </span>
  );
}

/**
 * Une Wargear Option en phrase à trous : Qui (le type de figurine, et combien),
 * Quoi (les Weapons rendues, ou un ajout) et ses Wargear Alternatives. La
 * phrase de la fiche s'écrit au-dessus, à mesure. Chaque alternative a sa
 * ligne repliable : la ligne du MFM qui la facture, les aptitudes qu'elle
 * apporte.
 */
function SentenceEditor({ option, index, at, onRemove }: { option: WargearOption; index: number; at: FieldProps['at']; onRemove: () => void }) {
  const ctx = useEditor();
  const unit = ctx.draft as Unit;
  const path: Path = ['wargearOptions', index];
  const set = (next: WargearOption) => ctx.onChange(path, next);
  const types = modelTypesOf(unit);
  const type = types.find((t) => t.name === option.model) ?? types[0];
  const single = (type?.max ?? 1) <= 1;
  const marks = ctx.marks.get(pointer(path)) ?? [];
  const written = marks.find((m) => m.kind === 'contribution');
  const origin = written ? (written.state === 'flagged' ? 'Contribution · BSData changed since: review it' : 'Contribution') : (ctx.original as Unit).wargearOptions?.some((o) => o.id === option.id) ? 'translated from BSData' : 'new · Contribution';
  const sentence = (() => {
    try {
      return wargearSentence(unit, option);
    } catch {
      return { text: '…' };
    }
  })();
  const errors = [...ctx.errors].filter(([p]) => p === pointer(path) || p.startsWith(`${pointer(path)}/`)).flatMap(([, e]) => e);
  const who = option.who;
  const setWho = (next: WargearWho) => set({ ...option, who: next });
  // Remplacer ou ajouter : une phrase qui ne rend rien est un ajout, jusqu'à ce qu'on choisisse « replace ».
  const [replacing, setReplacing] = useState(option.replaces.length > 0);
  const altPath = (j: number): Path => [...path, 'alternatives', j];
  const setAlt = (j: number, next: WargearAlternative) => set({ ...option, alternatives: option.alternatives.map((a, k) => (k === j ? next : a)) });
  return (
    <div className={`item sentence${written?.state === 'flagged' ? ' attention' : ''}`}>
      <section className="card sentence-card">
        <div className="sentence-text">
          {sentence.text}
          {sentence.items && (
            <ul>
              {sentence.items.map((item, k) => (
                <li key={k}>{item}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="sentence-blanks">
          {types.length > 1 && (
            <select aria-label="Model type" value={option.model} onChange={(e) => set({ ...option, model: e.target.value })}>
              {types.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label="Who"
            value={who.type}
            onChange={(e) => setWho(e.target.value === 'each' ? { type: 'each' } : e.target.value === 'up-to' ? { type: 'up-to', models: 1 } : { type: 'per', models: 1, every: 5 })}
          >
            <option value="each">{single ? 'this model' : 'any number of models'}</option>
            <option value="up-to">up to k models</option>
            <option value="per">k model(s) for every N models</option>
          </select>
          {who.type !== 'each' && (
            <input type="number" min={1} className="count-cell" aria-label="k" value={who.models} onChange={(e) => setWho({ ...who, models: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
          )}
          {who.type === 'per' && (
            <>
              for every
              <input type="number" min={1} className="count-cell" aria-label="N" value={who.every} onChange={(e) => setWho({ ...who, every: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
            </>
          )}
          <select
            aria-label="What"
            value={replacing ? 'replace' : 'equip'}
            onChange={(e) => {
              const replace = e.target.value === 'replace';
              setReplacing(replace);
              const { upTo: _u, ...rest } = option;
              set(replace ? rest : { ...option, replaces: [] });
            }}
          >
            <option value="replace">replace</option>
            <option value="equip">be equipped with</option>
          </select>
          {replacing ? (
            <WeaponPicks value={option.replaces} onChange={(replaces) => set({ ...option, replaces })} label="+ weapon it gives up" />
          ) : (
            <>
              up to
              <input
                type="number"
                min={1}
                className="count-cell"
                aria-label="Times"
                value={option.upTo ?? 1}
                onChange={(e) => {
                  const n = Math.max(1, Math.floor(Number(e.target.value) || 1));
                  const { upTo: _u, ...rest } = option;
                  set(n > 1 ? { ...rest, upTo: n } : rest);
                }}
              />
              time(s)
            </>
          )}
          <span className="section-source">· {origin}</span>
          <Badges path={path} value={option} />
        </div>
        <div className="alternatives">
          <span className="field-label">with {option.alternatives.length > 1 ? 'one of the following' : ''}</span>
          {option.alternatives.map((a, j) => (
            <AlternativeRow key={a.id} alternative={a} path={altPath(j)} at={at} onChange={(next) => setAlt(j, next)} onRemove={() => set({ ...option, alternatives: option.alternatives.filter((_x, k) => k !== j) })} />
          ))}
          <button
            type="button"
            className="add-field"
            onClick={() => set({ ...option, alternatives: [...option.alternatives, { id: `${option.id}-${option.alternatives.length + 1}`, weapons: [] }] })}
          >
            + alternative
          </button>
        </div>
        {errors.length > 0 && <p className="note error">{errors.join(' · ')}</p>}
      </section>
      <button type="button" className="remove" title="Remove this Wargear Option" onClick={onRemove}>
        −
      </button>
    </div>
  );
}

/** Une Wargear Alternative : ce qu'elle donne, puis, repliés, ce qu'elle coûte et ce qu'elle apporte. */
function AlternativeRow({ alternative, path, at, onChange, onRemove }: { alternative: WargearAlternative; path: Path; at: FieldProps['at']; onChange: (next: WargearAlternative) => void; onRemove: () => void }) {
  const ctx = useEditor();
  const unit = ctx.draft as Unit;
  const [open, setOpen] = useState(false);
  const lines = unit.wargear ?? [];
  const cost = alternative.wargearCost;
  const line = cost ? lines.find((l) => l.item === cost.item) : undefined;
  const quantity = cost?.quantity ?? 1;
  const setCost = (next: WargearAlternative['wargearCost']) => {
    const { wargearCost: _gone, ...rest } = alternative;
    onChange(next ? { ...rest, wargearCost: next } : rest);
  };
  // Une liste de noms : les aptitudes de l'Unit, que `choices` propose.
  const abilitiesAt = { schema: { type: 'array', items: { type: 'string' } }, base: at.base } as FieldProps['at'];
  return (
    <div className="alternative">
      <span className="alternative-head">
        <WeaponPicks value={alternative.weapons} onChange={(weapons) => onChange({ ...alternative, weapons })} label="+ weapon it gives" counts />
        {alternative.weapons.length === 0 && (
          <input placeholder="what it is (a banner…)" value={alternative.name ?? ''} onChange={(e) => onChange({ ...alternative, ...(e.target.value ? { name: e.target.value } : { name: undefined }) })} />
        )}
        <button type="button" className="link" onClick={() => setOpen(!open)} aria-expanded={open}>
          {cost ? `${line ? line.points * quantity : '?'} pts` : 'not billed'}
          {alternative.abilities?.length ? ` · ${alternative.abilities.join(', ')}` : ''} {open ? '▴' : '▾'}
        </button>
        <Badges path={[...path, 'wargearCost']} value={cost} />
        <button type="button" className="tag-remove" title="Remove this alternative" onClick={onRemove}>
          ×
        </button>
      </span>
      {open && (
        <div className="alternative-more">
          <span className="cost">
            Wargear cost:{' '}
            <select value={cost?.item ?? ''} onChange={(e) => setCost(e.target.value ? { item: e.target.value, ...(quantity > 1 ? { quantity } : {}) } : undefined)}>
              <option value="">— not billed —</option>
              {cost && !line && <option value={cost.item}>{cost.item} (line gone)</option>}
              {lines.map((l) => (
                <option key={l.item} value={l.item}>
                  {l.item} ({l.points} pts)
                </option>
              ))}
            </select>
            {cost && (
              <>
                {' × '}
                <input type="number" min={1} className="count-cell" title="How many times the line is paid per model" value={quantity} onChange={(e) => setCost({ item: cost.item, ...(Math.max(1, Number(e.target.value) || 1) > 1 ? { quantity: Math.max(1, Number(e.target.value) || 1) } : {}) })} />
              </>
            )}
          </span>
          <Field at={abilitiesAt} value={alternative.abilities ?? []} path={[...path, 'abilities']} label="Abilities it brings" section="Contribution" />
        </div>
      )}
    </div>
  );
}
