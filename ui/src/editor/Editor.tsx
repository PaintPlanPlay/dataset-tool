/**
 * Le moteur de rendu piloté par le schéma, éditable : un objet devient une
 * carte, un tableau une liste avec « + » et « − », un `oneOf` un sélecteur de
 * type qui pose les champs de la branche choisie, un enum un menu, un
 * scalaire un champ, une liste de mots une liste d'étiquettes.
 *
 * Il ne décide de rien : chaque modification remonte par `onChange`, et ce qui
 * s'affiche autour d'un champ — pastille orange d'une valeur modifiée, bleue
 * d'une valeur corrigée, erreur de schéma, alerte « texte de règles » — vient
 * du contexte. Les fiches dédiées (Unit, prix, figurines) s'y greffent par
 * `widget`.
 */
import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { canonicalWeaponKeyword, WEAPON_KEYWORDS } from '@paintplanplay/dataset-schema';
import type { Mark } from '../../../src/gui/sheets.ts';
import { branchLabel, HIDDEN, humanize, kindOf, type Located, type SchemaSet } from '../schema.ts';
import { addedFieldOf, defaultOf, getAt, pointer, same, type Path } from './values.ts';

/** Champs dérivés au build : ils s'affichent, ils ne se saisissent pas. */
const DERIVED = new Set(['points', 'costBrackets', 'minModels', 'maxModels', 'defaultModels', 'rangeInches', 'source', 'conditional', 'armyRuleIds', 'statuses']);

/** Les points d'une Enhancement viennent du MFM tels quels : ils se corrigent, ils ne se dérivent pas. */
const derivedAt = (path: Path) => {
  const name = path[path.length - 1];
  if (typeof name !== 'string' || !DERIVED.has(name)) return false;
  return !(name === 'points' && path[path.length - 3] === 'enhancements');
};

/** Une valeur en points : assez large pour quatre chiffres, et ±5 d'un clic. */
export function PointsInput({ value, onChange, min = 0 }: { value: number; onChange: (next: number) => void; min?: number }) {
  return (
    <span className="points-input">
      <button type="button" title="−5 pts" onClick={() => onChange(Math.max(min, value - 5))}>
        −5
      </button>
      <input type="number" min={min} value={value} onChange={(e) => onChange(Number(e.target.value) || 0)} />
      <button type="button" title="+5 pts" onClick={() => onChange(value + 5)}>
        +5
      </button>
    </span>
  );
}

export interface EditorContext {
  schemas: SchemaSet;
  /** La valeur telle que chargée : ce qui en diffère porte la pastille orange. */
  original: unknown;
  /** Le brouillon entier, pour les sélecteurs qui dépendent d'un autre champ. */
  draft: unknown;
  onChange: (path: Path, next: unknown) => void;
  errors: Map<string, string[]>;
  warnings: Map<string, string[]>;
  marks: Map<string, Mark[]>;
  /** Mise en page dédiée pour un chemin ; `undefined` pour le rendu générique. */
  widget?: (props: FieldProps) => ReactNode | undefined;
  /** Les valeurs proposées ou imposées pour une liste d'étiquettes. */
  choices?: (path: Path) => Choices | undefined;
}

/**
 * Ce qu'une liste d'étiquettes propose. `weaponKeywords` : la liste close des
 * mots-clés d'arme des règles, chacun avec sa valeur à saisir.
 */
export interface Choices {
  options: string[];
  closed: boolean;
  picker?: 'weaponKeywords';
  /** Pour une clé de Modifier : celles que la Simulation sait jouer. Une autre est acceptée, marquée « not simulated ». */
  simulated?: string[];
}

export const Ctx = createContext<EditorContext | null>(null);
export const useEditor = () => useContext(Ctx)!;

export interface FieldProps {
  at: Located;
  value: unknown;
  path: Path;
  /** Le libellé ; absent pour un élément de liste. */
  label?: string;
  /** Rendu en tête de section, avec sa source (« Weapons · BSData »). */
  section?: string;
}

/** Les messages attachés à un chemin exact. */
function Notes({ path }: { path: Path }) {
  const ctx = useEditor();
  const p = pointer(path);
  const errors = ctx.errors.get(p) ?? [];
  const warnings = ctx.warnings.get(p) ?? [];
  if (!errors.length && !warnings.length) return null;
  return (
    <span className="notes">
      {errors.map((e, i) => (
        <span key={`e${i}`} className="note error">
          {e}
        </span>
      ))}
      {warnings.map((w, i) => (
        <span key={`w${i}`} className="note warning">
          {w}
        </span>
      ))}
    </span>
  );
}

/** Pastille orange : modifié, pas enregistré. Bleue : changé par une Correction ou une Contribution publiée. */
export function Badges({ path, value }: { path: Path; value: unknown }) {
  const ctx = useEditor();
  const edited = !same(value, getAt(ctx.original, path));
  const marks = ctx.marks.get(pointer(path)) ?? [];
  return (
    <>
      {edited && <span className="badge edited" title="Edited, not saved yet" />}
      {marks.map((m, i) => (
        <span
          key={i}
          className={`badge published ${m.state}`}
          title={[
            `${m.kind === 'correction' ? 'Correction' : 'Contribution'} (${m.state}) — ${m.file}`,
            m.upstream !== undefined ? `upstream: ${JSON.stringify(m.upstream)}` : '',
            m.value !== undefined ? `now: ${JSON.stringify(m.value)}` : '',
            `why: ${m.reason}`,
          ]
            .filter(Boolean)
            .join('\n')}
        />
      ))}
    </>
  );
}

export function Field(props: FieldProps) {
  const ctx = useEditor();
  const name = props.path[props.path.length - 1];
  if (typeof name === 'string' && HIDDEN.has(name)) return null;
  const custom = ctx.widget?.(props);
  if (custom !== undefined) return <>{custom}</>;

  const resolved = ctx.schemas.resolve(props.at);
  const { schema } = resolved;
  if (schema.oneOf || schema.anyOf) return <ChoiceField {...props} at={resolved} />;
  const kind = kindOf(props.value);
  const declared = [schema.type ?? (schema.properties ? 'object' : undefined)].flat()[0];
  if (kind === 'array' || (props.value === undefined && declared === 'array')) return <ListField {...props} at={resolved} />;
  if (kind === 'object' || (props.value === undefined && declared === 'object')) return <CardField {...props} at={resolved} />;
  return <ScalarField {...props} at={resolved} />;
}

/** Un choix entre formes : un menu de types, puis les champs du type retenu. */
function ChoiceField(props: FieldProps) {
  const ctx = useEditor();
  const raw = props.at.schema.oneOf ?? props.at.schema.anyOf ?? [];
  const branches = ctx.schemas.branches(props.at);
  const chosen = ctx.schemas.branchOf(props.at, props.value);
  const objects = branches.filter((b) => b.schema.type === 'object' || b.schema.properties).length;
  // « nombre ou rien » n'est pas un choix de forme : un champ qu'on peut vider.
  if (objects <= 1) {
    const nullable = branches.some((b) => b.schema.type === 'null');
    const main = branches.find((b) => b.schema.type !== 'null') ?? branches[chosen];
    return <Field {...props} at={nullable ? { ...main, schema: { ...main.schema, nullable: true } as typeof main.schema } : main} />;
  }
  return (
    <div className="variant">
      <label className="field">
        <span className="field-label">{props.label ? `${props.label} · type` : 'Type'}</span>
        <select value={chosen} onChange={(e) => ctx.onChange(props.path, defaultOf(ctx.schemas, branches[Number(e.target.value)]))}>
          {branches.map((b, i) => (
            <option key={i} value={i}>
              {branchLabel(b, raw[i])}
            </option>
          ))}
        </select>
      </label>
      <Field {...props} at={branches[chosen]} />
    </div>
  );
}

function CardField({ at, value, path, label, section }: FieldProps) {
  const ctx = useEditor();
  const obj = (value ?? {}) as Record<string, unknown>;
  const props = at.schema.properties ?? {};
  const keys = [...Object.keys(props), ...Object.keys(obj).filter((k) => !(k in props))].filter((k) => !HIDDEN.has(k));
  const present = keys.filter((k) => obj[k] !== undefined);
  const missing = Object.keys(props).filter((k) => obj[k] === undefined && !HIDDEN.has(k) && !DERIVED.has(k));
  const composite = (k: string) => {
    const v = obj[k];
    return v !== null && typeof v === 'object';
  };
  const child = (k: string): Located => ({ schema: props[k] ?? {}, base: at.base });
  return (
    <section className="card">
      {(label || section) && (
        <h3 className="card-title">
          {label}
          {section && <span className="section-source"> · {section}</span>}
          <Badges path={path} value={value} />
        </h3>
      )}
      <Notes path={path} />
      <div className="card-fields">
        {present
          .filter((k) => !composite(k))
          .map((k) => (
            <Field key={k} at={child(k)} value={obj[k]} path={[...path, k]} label={humanize(k)} />
          ))}
      </div>
      {present.filter(composite).map((k) => (
        <Field key={k} at={child(k)} value={obj[k]} path={[...path, k]} label={humanize(k)} />
      ))}
      {missing.length > 0 && (
        <select
          className="add-field"
          value=""
          onChange={(e) => e.target.value && ctx.onChange([...path, e.target.value], addedFieldOf(ctx.schemas, child(e.target.value)))}
        >
          <option value="">+ add a field…</option>
          {missing.map((k) => (
            <option key={k} value={k}>
              {humanize(k)}
            </option>
          ))}
        </select>
      )}
    </section>
  );
}

function ListField({ at, value, path, label, section }: FieldProps) {
  const ctx = useEditor();
  const items = (value as unknown[] | undefined) ?? [];
  const itemAt: Located = { schema: at.schema.items ?? {}, base: at.base };
  const itemKind = ctx.schemas.resolve(itemAt).schema;
  // Une liste de mots (Keywords, phases, mots-clés d'arme) s'édite en étiquettes.
  const words = itemKind.type === 'string' || items.every((i) => typeof i === 'string' && items.length > 0);
  if (words && !itemKind.properties) return <TagsField value={items} path={path} label={label} section={section} itemAt={itemAt} />;
  const derived = derivedAt(path);
  return (
    <section className="list">
      {label && (
        <h3 className="list-title">
          {label} <span className="count">{items.length}</span>
          {section && <span className="section-source"> · {section}</span>}
          <Badges path={path} value={value} />
          {!derived && (
            <button type="button" className="add" title="Add" onClick={() => ctx.onChange(path, [...items, defaultOf(ctx.schemas, itemAt)])}>
              +
            </button>
          )}
        </h3>
      )}
      <Notes path={path} />
      {items.length === 0 ? (
        derived || !label ? (
          <p className="empty">—</p>
        ) : (
          <button type="button" className="add-first" onClick={() => ctx.onChange(path, [defaultOf(ctx.schemas, itemAt)])}>
            + Add {label.toLowerCase().replace(/s$/, '')}
          </button>
        )
      ) : (
        items.map((item, i) => (
          <div key={i} className="item">
            <Field at={itemAt} value={item} path={[...path, i]} />
            {!derived && (
              <button type="button" className="remove" title="Remove" onClick={() => ctx.onChange(path, items.filter((_x, j) => j !== i))}>
                −
              </button>
            )}
          </div>
        ))
      )}
    </section>
  );
}

function TagsField({ value, path, label, section, itemAt }: Omit<FieldProps, 'at'> & { itemAt: Located }) {
  const ctx = useEditor();
  const id = useId();
  const tags = (value as string[]) ?? [];
  const choices = ctx.choices?.(path);
  const enumValues = ctx.schemas.resolve(itemAt).schema.enum?.map(String);
  const options = (choices?.options ?? enumValues ?? []).filter((o) => !tags.includes(o));
  const closed = Boolean(choices?.closed || enumValues);
  const add = (tag: string) => {
    const t = tag.trim();
    if (!t || tags.includes(t) || (closed && !(choices?.options ?? enumValues ?? []).includes(t))) return;
    ctx.onChange(path, [...tags, t]);
  };
  return (
    <div className="field field-wide">
      {label && (
        <span className="field-label">
          {label}
          {section && <span className="section-source"> · {section}</span>}
          <Badges path={path} value={value} />
        </span>
      )}
      <span className="tags">
        {tags.map((t) => (
          <span key={t} className="tag">
            {t}
            <button type="button" className="tag-remove" title="Remove" onClick={() => ctx.onChange(path, tags.filter((x) => x !== t))}>
              ×
            </button>
          </span>
        ))}
        {choices?.picker === 'weaponKeywords' ? (
          <WeaponKeywordPicker onAdd={add} />
        ) : closed ? (
          <select value="" onChange={(e) => add(e.target.value)}>
            <option value="">+ add…</option>
            {options.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input
              className="tag-input"
              list={id}
              placeholder="+ add…"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add(e.currentTarget.value);
                  e.currentTarget.value = '';
                }
              }}
              onChange={(e) => {
                // Choisir une proposition de la liste l'ajoute aussitôt.
                if (options.includes(e.target.value)) {
                  add(e.target.value);
                  e.target.value = '';
                }
              }}
            />
            <datalist id={id}>
              {options.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </>
        )}
      </span>
      <Notes path={path} />
    </div>
  );
}

/**
 * Un mot-clé d'arme se choisit dans la liste des règles, pas se tape : son nom,
 * puis sa valeur quand il en porte une (« Rapid Fire » 2, « Anti » Vehicle 4+).
 */
function WeaponKeywordPicker({ onAdd }: { onAdd: (keyword: string) => void }) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [against, setAgainst] = useState('');
  const rule = WEAPON_KEYWORDS.find((r) => r.name === name);
  const composed = !rule ? null : rule.value === 'anti' ? canonicalWeaponKeyword(`Anti-${against} ${value}`) : canonicalWeaponKeyword(rule.value ? `${rule.name} ${value}` : rule.name);
  const add = (keyword: string | null) => {
    if (!keyword) return;
    onAdd(keyword);
    setName('');
    setValue('');
    setAgainst('');
  };
  return (
    <span className="keyword-picker">
      <select
        value={name}
        onChange={(e) => {
          const next = WEAPON_KEYWORDS.find((r) => r.name === e.target.value);
          if (next && !next.value) add(next.name);
          else setName(e.target.value);
        }}
      >
        <option value="">+ add…</option>
        {WEAPON_KEYWORDS.map((r) => (
          <option key={r.name} value={r.name}>
            {r.name}
            {r.value === 'anti' ? ' (keyword, roll)' : r.value ? ' (value)' : ''}
          </option>
        ))}
      </select>
      {rule?.value === 'anti' && <input placeholder="Vehicle" size={10} value={against} onChange={(e) => setAgainst(e.target.value)} />}
      {rule?.value && (
        <input
          placeholder={rule.value === 'anti' ? '4' : rule.value === 'dice' ? '1 or D3' : '2'}
          size={5}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add(composed))}
        />
      )}
      {rule?.value && (
        <button type="button" disabled={!composed} onClick={() => add(composed)} title={composed ?? 'Fill in the value'}>
          Add
        </button>
      )}
    </span>
  );
}

function ScalarField({ at, value, path, label }: FieldProps) {
  const ctx = useEditor();
  const listId = useId();
  const { schema } = at;
  const name = path[path.length - 1];
  const derived = derivedAt(path);
  const types = [schema.type].flat().filter((t): t is string => Boolean(t));
  const nullable = (schema as { nullable?: boolean }).nullable === true || types.includes('null');
  const type = types.find((t) => t !== 'null') ?? kindOf(value);
  const set = (next: unknown) => ctx.onChange(path, next);
  let control: ReactNode;
  if (schema.enum)
    control = (
      <select value={String(value)} disabled={derived} onChange={(e) => set(schema.enum!.find((x) => String(x) === e.target.value))}>
        {schema.enum.map((e) => (
          <option key={String(e)} value={String(e)}>
            {String(e)}
          </option>
        ))}
      </select>
    );
  else if (type === 'boolean')
    control = (
      <label className="switch">
        <input type="checkbox" disabled={derived} checked={Boolean(value)} onChange={(e) => set(e.target.checked)} />
        <span />
      </label>
    );
  else if (name === 'points' && !derived && typeof value === 'number') control = <PointsInput value={value} onChange={set} />;
  else if (type === 'integer' || type === 'number')
    control = (
      <input
        type="number"
        readOnly={derived}
        value={value === null || value === undefined ? '' : String(value)}
        step={type === 'integer' ? 1 : 'any'}
        onChange={(e) => set(e.target.value === '' ? (nullable ? null : 0) : Number(e.target.value))}
        style={{ width: '7ch' }}
      />
    );
  else {
    const text = value === null || value === undefined ? '' : String(value);
    const choices = ctx.choices?.(path);
    control = (
      <>
        <input
          readOnly={derived}
          value={text}
          list={choices ? listId : undefined}
          size={Math.max(4, Math.min(48, text.length + 2))}
          onChange={(e) => set(e.target.value === '' && nullable ? null : e.target.value)}
        />
        {choices && (
          <datalist id={listId}>
            {choices.options.map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        )}
        {choices?.simulated && text && !choices.simulated.includes(text) && (
          <span className="note warning" title="The simulation does not play this key: fix the entry, or teach the simulator">
            not simulated
          </span>
        )}
      </>
    );
  }
  const limit = name === 'summary' ? 160 : undefined;
  return (
    <label className={`field${derived ? ' derived' : ''}`} title={derived ? 'Derived at build time' : schema.description}>
      {label && (
        <span className="field-label">
          {label}
          <Badges path={path} value={value} />
        </span>
      )}
      {control}
      {limit && (
        <span className={`counter${String(value ?? '').length > limit ? ' over' : ''}`}>
          {String(value ?? '').length}/{limit}
        </span>
      )}
      <Notes path={path} />
    </label>
  );
}
