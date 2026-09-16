/**
 * Ce que font les aptitudes d'une Unit, sans leur texte.
 *
 * 40kdc-data d'abord : une Unit qui y est rattachée par sa référence BSData
 * porte ses aptitudes avec leur Effect, repris tel quel. Sinon — Unit non
 * rattachée, aptitude absente ou Effect hors schéma — l'analyse d'aptitudes lit
 * le texte BSData et propose un Effect pour les bonus qu'elle reconnaît. Le
 * texte, lui, ne sort jamais d'ici.
 */
import type { Effect, UnitAbility } from '@paintplanplay/dataset-schema';
import { validateEffect } from '@paintplanplay/dataset-schema/validate';
import { fnpOptions, parseParts, type AbilityPart } from './bsdata/abilities.ts';
import type { Ability, CatalogueUnit } from './bsdata/types.ts';
import { effectBody } from './detachments.ts';
import { kdcKey, type KdcData } from './upstream/kdc.ts';

type Node = Record<string, unknown>;

/** Leader et Support disent qui l'Unit peut rejoindre, pas ce qu'elle fait : leurs cibles sont ailleurs. */
const ATTACH = /^(leader|support)$/i;

const node = (type: string, modifier: Node, phase: AbilityPart['phase']): Node => ({
  type,
  target: 'unit',
  modifier: { ...modifier, ...(phase === 'melee' ? { weapon_type: 'melee' } : phase === 'shooting' ? { weapon_type: 'ranged' } : {}) },
});

/**
 * Un bonus reconnu par l'analyse, dans le format d'Effect de 40kdc-data et
 * sous les mêmes formes que ses données : c'est la même lecture, côté
 * application, qui les simule.
 */
export function partEffects(p: AbilityPart): Node[] {
  const e = p.effects;
  const out: Node[] = [];
  const add = (type: string, modifier: Node) => out.push(node(type, modifier, p.phase));
  const roll = (name: string, value: number) =>
    add('roll-modifier', { roll: name, operation: value < 0 ? 'subtract' : 'add', value: Math.abs(value) });

  if (e.hitModifier) roll('hit', e.hitModifier);
  if (e.woundModifier) roll('wound', e.woundModifier);
  if (e.critHit) add('roll-modifier', { roll: 'hit', operation: 'crit-on', value: e.critHit });
  if (e.critWound) add('roll-modifier', { roll: 'wound', operation: 'crit-on', value: e.critWound });
  if (e.rerollHits && e.rerollHits !== 'none') add('re-roll', { roll: 'hit', subset: e.rerollHits === 'ones' ? 'ones' : 'all-failures' });
  if (e.rerollWounds && e.rerollWounds !== 'none') add('re-roll', { roll: 'wound', subset: e.rerollWounds === 'ones' ? 'ones' : 'all-failures' });
  if (e.bonusS) add('stat-modifier', { stat: 'S', operation: 'add', value: e.bonusS });
  // 40kdc-data écrit l'AP en négatif : l'améliorer d'un cran, c'est lui ajouter -1.
  if (e.bonusAP) add('stat-modifier', { stat: 'AP', operation: 'add', value: -e.bonusAP });
  if (e.bonusD) add('stat-modifier', { stat: 'D', operation: 'add', value: e.bonusD });
  if (e.extraAttacks) add('stat-modifier', { stat: 'A', operation: 'add', value: e.extraAttacks });
  const keywords = [
    e.grantLethal && 'Lethal Hits',
    e.grantDevastating && 'Devastating Wounds',
    e.grantTwinLinked && 'Twin-linked',
    e.grantIgnoresCover && 'Ignores Cover',
    e.sustainedBonus && `Sustained Hits ${e.sustainedBonus}`,
  ].filter((k): k is string => Boolean(k));
  if (keywords.length) add('keyword-grant', { keywords });
  return out;
}

/** La proposition de l'analyse pour une aptitude : un Effect, ou rien. */
export function analysedAbility(a: Ability, onDrop: (reason: string) => void): UnitAbility {
  const parts = parseParts(a.text, a.name.trim());
  const steps = parts.flatMap(partEffects);
  const fnp = fnpOptions([a])[0];
  if (fnp) steps.push({ type: 'feel-no-pain', target: 'unit', modifier: { threshold: fnp.value } });
  if (!steps.length) return { name: a.name };

  const effect = steps.length === 1 ? steps[0] : { type: 'sequence', steps };
  const errors = validateEffect(effect);
  if (errors.length) {
    onDrop(`analysis: ${errors[0]}`);
    return { name: a.name };
  }
  const conditional = parts.some((p) => p.conditional) || Boolean(fnp?.caveat);
  return { name: a.name, effect: effect as Effect, effectSource: 'analysis', ...(conditional ? { conditional: true } : {}) };
}

/**
 * Les aptitudes d'une Unit telles que le Dataset les publie. `onDrop` reçoit
 * l'aptitude et la raison de chaque Effect écarté (hors schéma, prose).
 */
export function unitAbilities(u: CatalogueUnit, kdc: KdcData | null, onDrop: (where: string, reason: string) => void): UnitAbility[] {
  const linked = kdc?.unitByBsdataId(u.id);
  const factions = linked?.faction_id ? [linked.faction_id] : [];
  const fromKdc = linked ? (linked.ability_ids ?? []).map((id) => kdc!.ability(id, factions)).filter((x) => x !== undefined) : [];

  return u.abilities.map((a) => {
    if (ATTACH.test(a.name.trim())) return { name: a.name };
    const drop = (reason: string) => onDrop(a.name, reason);
    const match = fromKdc.find((k) => kdcKey(k.name) === kdcKey(a.name));
    if (match) {
      const body = effectBody(match, drop);
      if (body.effect) return { name: a.name, ...body, effectSource: '40kdc' };
    }
    return analysedAbility(a, drop);
  });
}
