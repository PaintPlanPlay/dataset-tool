/**
 * La fiche d'Unit : le moteur de rendu, avec une mise en page dédiée — les
 * figurines et leur effectif, la grille de prix, les étiquettes, les Abilities
 * et ce qu'elles font. Ce qui se déduit au build (coût de base, paliers,
 * effectifs) s'affiche sans se saisir.
 */
import type { ReactNode } from 'react';
import type { Unit, WeaponOption } from '@paintplanplay/dataset-schema';
import type { WargearFinding } from '../../../src/wargear.ts';
import { Badges, Field, PointsInput, useEditor, type FieldProps } from '../editor/Editor.tsx';
import { defaultOf, pointer, type Path } from '../editor/values.ts';
import { humanize, type Located } from '../schema.ts';

/** L'ordre de la fiche, celui de la maquette : qui la compose, ce qu'elle coûte, ce qu'elle est, ce qu'elle fait, ce qu'elle porte. */
const SECTIONS = [
  'pricing', 'wargear', 'keywords', 'factionKeywords', 'armyRules', 'leaderTargets', 'supportTargets',
  'abilities', 'weapons', 'optionGroups', 'defaultLoadout',
] as const;

const SOURCE_LABEL: Record<string, string> = { bsdata: 'BSData', mfm: 'MFM', '40kdc': '40kdc-data', project: 'project' };

interface Props {
  sources: Record<string, string>;
  /** Les lignes du MFM qu'aucune Wargear Option ne facture, et les liens manuels qui ne visent plus rien. */
  wargear: WargearFinding[];
}

/**
 * Le `widget` de l'éditeur pour une fiche d'Unit : la racine, les lignes
 * `wargear` du MFM, et chaque Wargear Option ; le reste reste générique.
 */
export function unitWidget({ sources, wargear }: Props) {
  return (props: FieldProps): ReactNode | undefined => {
    const [head, gi, sub, oi] = props.path;
    if (props.path.length === 0) return <UnitLayout at={props.at} unit={props.value as Unit} sources={sources} />;
    if (props.path.length === 1 && head === 'wargear') return <WargearLines findings={wargear} section={props.section ?? ''} />;
    if (head === 'optionGroups' && typeof gi === 'number' && sub === 'options' && props.path.length === 3)
      return <OptionsList at={props.at} path={props.path} value={(props.value as WeaponOption[] | undefined) ?? []} />;
    if (head === 'optionGroups' && typeof gi === 'number' && sub === 'options' && typeof oi === 'number' && props.path.length === 4)
      return <OptionCard at={props.at} path={props.path} option={props.value as WeaponOption} findings={wargear} />;
    return undefined;
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
        if (k === 'pricing')
          return [
            <PriceGrid key={k} unit={unit} field="pricing" section={section('pricing')} />,
            unit.assignedPricing && <PriceGrid key="assignedPricing" unit={unit} field="assignedPricing" section={section('assignedPricing')} />,
          ];
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
 * « à partir du 4e »), et dans chacune le coût par nombre de figurines. La
 * même grille sert au coût d'Assigned Agent, que la List choisit quand une
 * Ally Rule admet l'Unit (ADR 0013).
 */
function PriceGrid({ unit, field, section }: { unit: Unit; field: 'pricing' | 'assignedPricing'; section: string }) {
  const ctx = useEditor();
  const bands = unit[field] ?? [];
  const set = (next: NonNullable<Unit['pricing']>) => ctx.onChange([field], next);
  const band = (i: number, patch: Partial<NonNullable<Unit['pricing']>[number]>) => set(bands.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const ordinal = (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
  return (
    <section className="list">
      <h3 className="list-title">
        {field === 'pricing' ? 'Prices' : 'Assigned Agent prices'} <span className="section-source"> · {section}</span>
        <Badges path={[field]} value={unit[field]} />
        <button
          type="button"
          className="add"
          title="Add a band of copies"
          onClick={() => set([...bands, { from: (bands[bands.length - 1]?.to ?? bands.length) + 1, to: null, costs: [{ models: unit.minModels, points: 0 }] }])}
        >
          +
        </button>
      </h3>
      {bands.length === 0 && field === 'pricing' && <p className="empty">Not in the Munitorum Field Manual: the cost comes from BSData.</p>}
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
                    <PointsInput value={c.points} onChange={(points) => band(i, { costs: b.costs.map((x, k) => (k === j ? { ...x, points } : x)) })} />
                    {' pts'}
                    <Badges path={[field, i, 'costs', j, 'points']} value={c.points} />
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

/** Les Wargear Options d'une Unit, avec le groupe qui porte chacune. */
const optionsOf = (unit: Unit) => (unit.optionGroups ?? []).flatMap((g) => g.options.map((o) => ({ group: g, option: o })));

const FINDING_LABEL: Record<WargearFinding['kind'], string> = {
  orphan: 'not linked — no Wargear Option matches',
  ambiguous: 'not linked — several Wargear Options match',
  'default-only': 'not linked — only a default option matches: link it by hand if it is paid',
  'missing-line': 'linked by hand, but the line is gone',
};

/**
 * La liste `wargear` du MFM : chaque ligne se corrige comme tout champ du MFM
 * (une Correction), et dit l'option qui la facture — ou qu'aucune ne la
 * facture, et pourquoi.
 */
function WargearLines({ findings, section }: { findings: WargearFinding[]; section: string }) {
  const ctx = useEditor();
  const unit = ctx.draft as Unit;
  const lines = unit.wargear ?? [];
  const set = (next: NonNullable<Unit['wargear']>) => ctx.onChange(['wargear'], next.length ? next : undefined);
  return (
    <section className="list">
      <h3 className="list-title">
        Wargear costs <span className="count">{lines.length}</span>
        <span className="section-source"> · {section}</span>
        <Badges path={['wargear']} value={unit.wargear} />
        <button type="button" className="add" title="Add an MFM line" onClick={() => set([...lines, { item: '', points: 0 }])}>
          +
        </button>
      </h3>
      {lines.length === 0 && <p className="empty">The MFM bills no wargear for this Unit.</p>}
      {lines.map((l, i) => {
        const linked = optionsOf(unit).filter(({ option }) => option.wargearCost?.item === l.item);
        const finding = findings.find((f) => f.item === l.item && f.kind !== 'missing-line');
        return (
          <div key={i} className="item wargear-line">
            <span className="cost">
              <input value={l.item} size={Math.max(8, l.item.length + 2)} onChange={(e) => set(lines.map((x, j) => (j === i ? { ...x, item: e.target.value } : x)))} />
              {': '}
              <PointsInput value={l.points} onChange={(points) => set(lines.map((x, j) => (j === i ? { ...x, points } : x)))} />
              {' pts'}
              <Badges path={['wargear', i, 'points']} value={l.points} />
            </span>
            {linked.length ? (
              <span className="linked">→ {linked.map(({ option }) => `${option.name}${(option.wargearCost?.quantity ?? 1) > 1 ? ` ×${option.wargearCost!.quantity}` : ''}`).join(', ')}</span>
            ) : (
              <span className="note warning">
                {finding ? FINDING_LABEL[finding.kind] : 'not linked'}
                {finding?.options.length ? ` (${finding.options.join(', ')})` : ''}
              </span>
            )}
            <button type="button" className="remove" title="Remove this line" onClick={() => set(lines.filter((_x, j) => j !== i))}>
              −
            </button>
          </div>
        );
      })}
    </section>
  );
}

/**
 * Les options d'un groupe. En ajouter une crée une Wargear Option que BSData
 * n'a pas : une Contribution (ADR 0010), qui se règle ensuite comme les autres.
 */
function OptionsList({ at, path, value }: { at: FieldProps['at']; path: Path; value: WeaponOption[] }) {
  const ctx = useEditor();
  const itemAt = { schema: ctx.schemas.resolve(at).schema.items ?? {}, base: at.base };
  const add = () => {
    const taken = new Set(value.map((o) => o.id));
    let n = value.length + 1;
    while (taken.has(`contrib-${n}`)) n++;
    ctx.onChange(path, [...value, { id: `contrib-${n}`, name: `New option ${n}`, weapons: [], maxCarriers: 1, isDefault: false }]);
  };
  return (
    <section className="list">
      <h3 className="list-title">
        Wargear Options <span className="count">{value.length}</span>
        <Badges path={path} value={value} />
        <button type="button" className="add" title="Add a Wargear Option that BSData does not have — a Contribution" onClick={add}>
          + Wargear Option · Contribution
        </button>
      </h3>
      {value.map((o, i) => (
        <div key={o.id} className="item">
          <Field at={itemAt} value={o} path={[...path, i]} />
          <button type="button" className="remove" title="Remove this option" onClick={() => ctx.onChange(path, value.filter((_x, j) => j !== i))}>
            −
          </button>
        </div>
      ))}
    </section>
  );
}

/**
 * Une Wargear Option : ce que BSData en dit (nom, Weapons, porteurs, défaut),
 * puis ce qui est à nous — la ligne du MFM qui la facture, sa quantité, le
 * montant qui en résulte (lu dans la ligne, jamais saisi), les aptitudes
 * qu'elle apporte.
 */
function OptionCard({ at, path, option, findings }: { at: FieldProps['at']; path: Path; option: WeaponOption; findings: WargearFinding[] }) {
  const ctx = useEditor();
  const unit = ctx.draft as Unit;
  const schema = ctx.schemas.resolve(at);
  const child = (k: string) => ({ schema: schema.schema.properties?.[k] ?? {}, base: schema.base });
  const lines = unit.wargear ?? [];
  const cost = option.wargearCost;
  const line = cost ? lines.find((l) => l.item === cost.item) : undefined;
  const quantity = cost?.quantity ?? 1;
  const setCost = (next: WeaponOption['wargearCost']) => ctx.onChange([...path, 'wargearCost'], next);
  // Une option qu'on vient d'ajouter, ou qu'une Contribution publiée a créée.
  const loaded = (ctx.original as Unit).optionGroups?.[path[1] as number]?.options.some((o) => o.id === option.id);
  const created = !loaded || (ctx.marks.get(pointer(path)) ?? []).some((m) => m.kind === 'contribution');
  const gone = findings.filter((f) => f.kind === 'missing-line' && f.options.includes(option.name));
  const hinted = findings.filter((f) => f.kind !== 'missing-line' && f.options.includes(option.name));
  return (
    <section className="card option-card">
      <h3 className="card-title">
        {option.name || 'Wargear Option'}
        {created && <span className="section-source"> · created · Contribution</span>}
        <Badges path={path} value={option} />
      </h3>
      <div className="card-fields">
        <Field at={child('name')} value={option.name} path={[...path, 'name']} label="Name" />
        <Field at={child('maxCarriers')} value={option.maxCarriers} path={[...path, 'maxCarriers']} label="Max carriers" />
        <Field at={child('perModels')} value={option.perModels} path={[...path, 'perModels']} label="One per N models" />
        <Field at={child('isDefault')} value={option.isDefault} path={[...path, 'isDefault']} label="Default" />
      </div>
      <Field at={child('weapons')} value={option.weapons} path={[...path, 'weapons']} label="Weapons" />
      <div className="field field-wide option-cost">
        <span className="field-label">
          Wargear cost <span className="section-source">· Contribution</span>
          <Badges path={[...path, 'wargearCost']} value={cost} />
        </span>
        <span className="cost">
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
              <input
                type="number"
                min={1}
                style={{ width: '5ch' }}
                title="How many times the line is paid per model: 2 for « 2 Multi-meltas »"
                value={quantity}
                onChange={(e) => {
                  const q = Math.max(1, Number(e.target.value) || 1);
                  setCost({ item: cost.item, ...(q > 1 ? { quantity: q } : {}) });
                }}
              />
              {' = '}
              <b title="Read from the MFM line: correct the line, not the option">{line ? `${line.points * quantity} pts per model` : 'nothing billed'}</b>{' '}
              <button type="button" onClick={() => setCost(undefined)}>
                unlink
              </button>
            </>
          )}
        </span>
        {gone.map((f) => (
          <span key={f.item} className="note error">
            « {f.item} » is no longer an MFM line of this Unit: this option bills nothing.
          </span>
        ))}
        {!cost &&
          hinted.map((f) => (
            <span key={f.item} className="note warning">
              MFM line « {f.item} »: {FINDING_LABEL[f.kind]}
            </span>
          ))}
      </div>
      <Field at={child('abilities')} value={option.abilities ?? []} path={[...path, 'abilities']} label="Abilities it brings" section="Contribution" />
    </section>
  );
}

