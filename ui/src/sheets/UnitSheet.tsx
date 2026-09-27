/**
 * La fiche d'Unit : le moteur de rendu, avec une mise en page dédiée — les
 * figurines et leur effectif, la grille de prix, les étiquettes, les Abilities
 * et ce qu'elles font. Ce qui se déduit au build (coût de base, paliers,
 * effectifs) s'affiche sans se saisir.
 */
import type { ReactNode } from 'react';
import type { Unit } from '@paintplanplay/dataset-schema';
import { Badges, Field, useEditor, type FieldProps } from '../editor/Editor.tsx';
import { defaultOf, type Path } from '../editor/values.ts';
import { humanize, type Located } from '../schema.ts';

/** L'ordre de la fiche, celui de la maquette : qui la compose, ce qu'elle coûte, ce qu'elle est, ce qu'elle fait, ce qu'elle porte. */
const SECTIONS = [
  'pricing', 'wargear', 'keywords', 'factionKeywords', 'armyRules', 'leaderTargets', 'supportTargets',
  'abilities', 'weapons', 'optionGroups', 'defaultLoadout',
] as const;

const SOURCE_LABEL: Record<string, string> = { bsdata: 'BSData', mfm: 'MFM', '40kdc': '40kdc-data', project: 'project' };

interface Props {
  sources: Record<string, string>;
}

/** Le `widget` de l'éditeur pour une fiche d'Unit : la racine seule, le reste reste générique. */
export function unitWidget({ sources }: Props) {
  return (props: FieldProps): ReactNode | undefined => {
    if (props.path.length !== 0) return undefined;
    return <UnitLayout at={props.at} unit={props.value as Unit} sources={sources} />;
  };
}

function UnitLayout({ at, unit, sources }: { at: Located; unit: Unit; sources: Record<string, string> }) {
  const ctx = useEditor();
  const child = (k: string): Located => ({ schema: at.schema.properties?.[k] ?? {}, base: at.base });
  const section = (k: string) => SOURCE_LABEL[sources[k]] ?? sources[k];
  const brackets = unit.costBrackets.map((b) => `${b.points} pts over ${b.overModels}`).join(', ');
  return (
    <div className="unit-sheet">
      <section className="card">
        <div className="card-fields">
          <Field at={child('name')} value={unit.name} path={['name']} label="Name" />
          <Field at={child('isLegends')} value={unit.isLegends} path={['isLegends']} label="Legends" />
          <Field at={child('ally')} value={unit.ally} path={['ally']} label="Ally" />
        </div>
        <p className="derived-line" title="Derived at build time from the price grid and the composition">
          {unit.points} pts{brackets && ` · ${brackets}`} · {unit.minModels}–{unit.maxModels} models
          {unit.defaultModels !== undefined && ` · loadout for ${unit.defaultModels}`}
        </p>
      </section>

      <ModelsSection unit={unit} at={at} section={section('models')} />

      {SECTIONS.map((k) => {
        if (k === 'pricing') return <PriceGrid key={k} unit={unit} section={section('pricing')} />;
        if (k === 'abilities') return <AbilitiesSection key={k} unit={unit} at={child('abilities')} section={section('abilities')} />;
        const value = (unit as unknown as Record<string, unknown>)[k];
        return <Field key={k} at={child(k)} value={value ?? (k === 'wargear' || k === 'optionGroups' || k === 'defaultLoadout' ? [] : value)} path={[k]} label={humanize(k)} section={section(k)} />;
      })}
      {ctx.errors.get('') && <p className="note error">{ctx.errors.get('')!.join(' · ')}</p>}
    </div>
  );
}

/**
 * Les figurines, chacune avec son effectif (« 4 – 9 ») : le profil vit dans
 * `models`, l'effectif dans `composition`. Les deux se tiennent par le nom, et
 * c'est ici qu'on les garde d'accord — renommer, ajouter, retirer.
 */
function ModelsSection({ unit, at, section }: { unit: Unit; at: Located; section: string }) {
  const ctx = useEditor();
  const modelAt: Located = { schema: at.schema.properties?.models?.items ?? {}, base: at.base };
  const composition = unit.composition ?? [];
  const slotOf = (name: string) => composition.findIndex((c) => c.name === name);
  const apply = (models: Unit['models'], comp: NonNullable<Unit['composition']>) => {
    ctx.onChange(['models'], models);
    ctx.onChange(['composition'], comp);
  };
  const rename = (i: number, name: string) => {
    const was = unit.models[i].name;
    apply(
      unit.models.map((m, j) => (j === i ? { ...m, name } : m)),
      composition.map((c) => (c.name === was ? { ...c, name } : c)),
    );
  };
  const add = () => {
    const fresh = { ...(defaultOf(ctx.schemas, modelAt) as Unit['models'][number]), name: `Model ${unit.models.length + 1}`, Sv: 7, Inv: 7 };
    apply([...unit.models, fresh], [...composition, { name: fresh.name, min: 0, max: 1 }]);
  };
  const remove = (i: number) => {
    const name = unit.models[i].name;
    apply(
      unit.models.filter((_m, j) => j !== i),
      composition.filter((c) => c.name !== name),
    );
  };
  const STATS = ['M', 'T', 'Sv', 'Inv', 'W', 'LD', 'OC'] as const;
  return (
    <section className="list">
      <h3 className="list-title">
        Models <span className="count">{unit.models.length}</span>
        <span className="section-source"> · {section}</span>
        <button type="button" className="add" title="Add a model" onClick={add}>
          +
        </button>
      </h3>
      {unit.models.map((m, i) => {
        const slot = slotOf(m.name);
        return (
          <div key={i} className="item">
            <section className="card model-card">
              <div className="card-fields">
                <label className="field">
                  <span className="field-label">
                    Name
                    <Badges path={['models', i, 'name']} value={m.name} />
                  </span>
                  <input value={m.name} onChange={(e) => rename(i, e.target.value)} />
                </label>
                {STATS.map((s) => (
                  <Field key={s} at={{ schema: modelAt.schema.properties?.[s] ?? {}, base: at.base }} value={m[s]} path={['models', i, s]} label={s} />
                ))}
                {slot >= 0 ? (
                  <span className="field model-count">
                    <span className="field-label">Count</span>
                    <span>
                      <CountInput path={['composition', slot, 'min']} value={composition[slot].min} />
                      {' – '}
                      <CountInput path={['composition', slot, 'max']} value={composition[slot].max} />
                    </span>
                  </span>
                ) : (
                  <button type="button" onClick={() => ctx.onChange(['composition'], [...composition, { name: m.name, min: 0, max: 1 }])}>
                    + count
                  </button>
                )}
              </div>
            </section>
            <button type="button" className="remove" title="Remove this model" onClick={() => remove(i)}>
              −
            </button>
          </div>
        );
      })}
    </section>
  );
}

function CountInput({ path, value }: { path: Path; value: number }) {
  const ctx = useEditor();
  return (
    <>
      <input type="number" min={0} step={1} style={{ width: '6ch' }} value={value} onChange={(e) => ctx.onChange(path, Number(e.target.value) || 0)} />
      <Badges path={path} value={value} />
    </>
  );
}

/**
 * La grille du MFM : une ligne par tranche d'exemplaires (« du 1er au 3e »,
 * « à partir du 4e »), et dans chacune le coût par nombre de figurines.
 */
function PriceGrid({ unit, section }: { unit: Unit; section: string }) {
  const ctx = useEditor();
  const bands = unit.pricing ?? [];
  const set = (next: NonNullable<Unit['pricing']>) => ctx.onChange(['pricing'], next);
  const band = (i: number, patch: Partial<NonNullable<Unit['pricing']>[number]>) => set(bands.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
  return (
    <section className="list">
      <h3 className="list-title">
        Prices <span className="section-source"> · {section}</span>
        <Badges path={['pricing']} value={unit.pricing} />
        <button
          type="button"
          className="add"
          title="Add a band of copies"
          onClick={() => set([...bands, { from: (bands[bands.length - 1]?.to ?? bands.length) + 1, to: null, costs: [{ models: unit.minModels, points: 0 }] }])}
        >
          +
        </button>
      </h3>
      {bands.length === 0 && <p className="empty">Not in the Munitorum Field Manual: the cost comes from BSData.</p>}
      <table className="price-grid">
        <tbody>
          {bands.map((b, i) => (
            <tr key={i}>
              <th>
                <span className="band">
                  copies{' '}
                  <input type="number" min={1} style={{ width: '5ch' }} value={b.from} onChange={(e) => band(i, { from: Number(e.target.value) || 1 })} /> to{' '}
                  <input
                    type="number"
                    min={1}
                    style={{ width: '5ch' }}
                    placeholder="∞"
                    value={b.to ?? ''}
                    onChange={(e) => band(i, { to: e.target.value === '' ? null : Number(e.target.value) })}
                  />
                </span>
                <small>{b.to === null ? `from the ${ordinal(b.from)}` : `${ordinal(b.from)} to ${ordinal(b.to)}`}</small>
              </th>
              {b.costs.map((c, j) => (
                <td key={j} className="item">
                  <span className="cost">
                    <input type="number" min={1} style={{ width: '5ch' }} value={c.models} onChange={(e) => band(i, { costs: b.costs.map((x, k) => (k === j ? { ...x, models: Number(e.target.value) || 1 } : x)) })} />
                    {' models: '}
                    <input type="number" min={0} style={{ width: '6ch' }} value={c.points} onChange={(e) => band(i, { costs: b.costs.map((x, k) => (k === j ? { ...x, points: Number(e.target.value) || 0 } : x)) })} />
                    {' pts'}
                    <Badges path={['pricing', i, 'costs', j, 'points']} value={c.points} />
                  </span>
                  <button type="button" className="remove" title="Remove this cost" onClick={() => band(i, { costs: b.costs.filter((_x, k) => k !== j) })}>
                    −
                  </button>
                </td>
              ))}
              <td>
                <button type="button" className="add" title="Add a cost" onClick={() => band(i, { costs: [...b.costs, { models: (b.costs[b.costs.length - 1]?.models ?? 0) + 1, points: 0 }] })}>
                  +
                </button>
                <button type="button" className="remove-band" title="Remove this band" onClick={() => set(bands.filter((_x, k) => k !== i))}>
                  − band
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Les Abilities : un nom, une Description d'une ligne écrite par nous, des Modifiers. */
function AbilitiesSection({ unit, at, section }: { unit: Unit; at: Located; section: string }) {
  const ctx = useEditor();
  const itemAt: Located = { schema: at.schema.items ?? {}, base: at.base };
  return (
    <section className="list">
      <h3 className="list-title">
        Abilities <span className="count">{unit.abilities.length}</span>
        <span className="section-source"> · {section}</span>
        <button type="button" className="add" title="Add an ability" onClick={() => ctx.onChange(['abilities'], [...unit.abilities, { name: `New ability ${unit.abilities.length + 1}`, summary: '' }])}>
          +
        </button>
      </h3>
      {unit.abilities.map((a, i) => (
        <div key={i} className="item">
          <div className="ability">
            <Field at={itemAt} value={a} path={['abilities', i]} />
          </div>
          <button type="button" className="remove" title="Remove this ability" onClick={() => ctx.onChange(['abilities'], unit.abilities.filter((_x, j) => j !== i))}>
            −
          </button>
        </div>
      ))}
    </section>
  );
}
