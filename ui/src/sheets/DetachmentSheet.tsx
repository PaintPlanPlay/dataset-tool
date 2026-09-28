/**
 * La fiche d'un Detachment : le rendu générique, sauf la Weapon qu'une
 * Enhancement apporte. On la reprend d'une valeur amont — une Weapon d'une
 * Unit de l'Army, même retirée de sa fiche par une Correction — ou on la
 * décrit, profils compris (ADR 0009). C'est une Contribution.
 */
import type { ReactNode } from 'react';
import type { Weapon } from '@paintplanplay/dataset-schema';
import type { Suggestions } from '../api.ts';
import { Badges, Field, useEditor, type FieldProps } from '../editor/Editor.tsx';

export function detachmentWidget({ suggestions }: { suggestions: Suggestions | null }) {
  return (props: FieldProps): ReactNode | undefined => {
    const [head, i, field] = props.path;
    if (head === 'enhancements' && typeof i === 'number' && field === 'weapon' && props.path.length === 3)
      return <EnhancementWeapon {...props} upstream={suggestions?.upstreamWeapons ?? []} />;
    return undefined;
  };
}

function EnhancementWeapon({ at, value, path, upstream }: FieldProps & { upstream: Suggestions['upstreamWeapons'] }) {
  const ctx = useEditor();
  const weapon = value as Weapon | undefined;
  const { schema, base } = ctx.schemas.resolve(at);
  const child = (k: string) => ({ schema: schema.properties?.[k] ?? {}, base });
  const key = (u: string, w: Weapon) => `${u}|${w.kind}|${w.name}`;
  return (
    <section className="card enhancement-weapon">
      <h3 className="card-title">
        Weapon it brings <span className="section-source">· Contribution</span>
        <Badges path={path} value={value} />
      </h3>
      <p className="derived-line">Carried by the bearer while the Enhancement is taken. It costs nothing on top of the Enhancement.</p>
      <label className="field field-wide">
        <span className="field-label">Take it from</span>
        <select
          value=""
          onChange={(e) => {
            const hit = upstream.find((x) => key(x.unit, x.weapon) === e.target.value);
            if (hit) ctx.onChange(path, structuredClone(hit.weapon));
          }}
        >
          <option value="">a Weapon of this Army, as upstream describes it…</option>
          {upstream.map((x) => (
            <option key={key(x.unit, x.weapon)} value={key(x.unit, x.weapon)}>
              {x.unit} › {x.weapon.name} ({x.weapon.kind})
            </option>
          ))}
        </select>
      </label>
      {weapon && (
        <>
          <div className="card-fields">
            <Field at={child('name')} value={weapon.name} path={[...path, 'name']} label="Name" />
            <Field at={child('kind')} value={weapon.kind} path={[...path, 'kind']} label="Kind" />
          </div>
          <Field at={child('profiles')} value={weapon.profiles} path={[...path, 'profiles']} label="Profiles" />
          <button type="button" onClick={() => ctx.onChange(path, undefined)}>
            remove the Weapon
          </button>
        </>
      )}
    </section>
  );
}
