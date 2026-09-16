/**
 * Les Detachments et Enhancements d'une Army, tirés de deux sources qui font
 * chacune autorité sur leur part.
 *
 * Le MFM décide de ce qui existe et de ses chiffres : Detachments, coût en DP,
 * Force Dispositions, tag Unique, Enhancements et leurs points. 40kdc-data
 * apporte les Detachment Rules, les restrictions d'Enhancement et les Effects.
 * On joint sur le nom normalisé ; une sous-faction sans données propres dans
 * 40kdc-data (un Chapitre) prend celles de sa faction parente.
 */
import { validateEffect } from '@paintplanplay/dataset-schema/validate';
import type { Detachment, Enhancement, Phase, PlayerTurn, Rule, RuleBody, Stratagem, StratagemTarget, StratagemTiming } from '@paintplanplay/dataset-schema';
import type { DroppedEffect, MissingEntity, SourceConflict } from './findings.ts';
import { assignIds, slugify, type IdRegistry } from './ids.ts';
import { findRulesText } from './notext.ts';
import { kdcKey, type KdcAbility, type KdcData, type KdcDetachment, type KdcEnhancement, type KdcFaction, type KdcStratagem } from './upstream/kdc.ts';
import type { MfmDetachment, MfmEnhancement, MfmFaction } from './upstream/mfm.ts';

export interface DetachmentsInput {
  armyId: string;
  mfm?: MfmFaction;
  kdc: KdcData | null;
  kdcFaction?: KdcFaction;
  ids: IdRegistry;
}

export interface DetachmentsOutput {
  detachments: Detachment[];
  /** Les Stratagems des Detachments publiés. */
  stratagems: Stratagem[];
  conflicts: SourceConflict[];
  missing: MissingEntity[];
  droppedEffects: DroppedEffect[];
}

/** Force Disposition du MFM (« TAKE AND HOLD ») en identifiant 40kdc-data (« take-and-hold »). */
export const dispositionId = (objective: string) => slugify(objective);

const sameSet = (a: string[], b: string[]) => [...a].sort().join('|') === [...b].sort().join('|');

export function buildDetachments(input: DetachmentsInput): DetachmentsOutput {
  const { armyId, mfm, kdc, kdcFaction, ids } = input;
  const out: DetachmentsOutput = { detachments: [], stratagems: [], conflicts: [], missing: [], droppedEffects: [] };
  if (!mfm) return out;

  const parent = kdcFaction?.parent_faction_id ? kdc?.factions.find((f) => f.id === kdcFaction.parent_faction_id) : undefined;
  const scopes = [kdcFaction, parent].filter((f): f is KdcFaction => Boolean(f));
  const factionIds = scopes.map((f) => f.id);

  /** Le Detachment 40kdc-data d'un nom, dans la faction puis dans sa parente. */
  const kdcDetachmentOf = (name: string): { det: KdcDetachment; faction: KdcFaction } | undefined => {
    for (const faction of scopes) {
      const det = kdc!.detachments(faction.id).find((d) => kdcKey(d.name) === kdcKey(name));
      if (det) return { det, faction };
    }
    return undefined;
  };

  const bodyOf = (ability: KdcAbility | undefined, where: string) => effectBody(ability, (reason) => out.droppedEffects.push({ army: armyId, where, reason }));

  const detIds = assignIds(ids, 'detachments', armyId, mfm.detachments, (d) => {
    const hit = kdc && kdcDetachmentOf(d.name);
    return { keys: [`mfm:${kdcKey(d.name)}`, ...(hit ? [`40kdc:${hit.faction.id}/${hit.det.id}`] : [])], name: d.name };
  });

  for (const d of mfm.detachments) {
    const id = detIds.get(d)!;
    const hit = kdc ? kdcDetachmentOf(d.name) : undefined;
    if (!hit) out.missing.push({ army: armyId, entity: 'detachment', name: d.name, missingIn: '40kdc', published: true });

    const forceDispositions = d.objectives.map(dispositionId);
    if (hit) conflictsOfDetachment(out, armyId, id, d, hit.det, forceDispositions);

    if (hit) out.stratagems.push(...stratagemsOf(hit, id, d.name));
    out.detachments.push({
      id,
      name: d.name,
      dp: d.dp,
      forceDispositions,
      ...(d.unique ? { uniqueTag: d.unique } : {}),
      rules: hit ? rulesOf(hit, d.name) : [],
      enhancements: enhancementsOf(d, id, hit),
    });
  }

  // Ce que 40kdc-data publie et que le MFM ignore n'entre pas dans le Dataset.
  if (kdc && kdcFaction) {
    const known = new Set(mfm.detachments.map((d) => kdcKey(d.name)));
    for (const det of kdc.detachments(kdcFaction.id))
      if (!known.has(kdcKey(det.name))) out.missing.push({ army: armyId, entity: 'detachment', name: det.name, missingIn: 'mfm', published: false });
  }

  out.detachments.sort((a, b) => a.name.localeCompare(b.name));
  out.stratagems.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return out;

  function stratagemsOf(hit: { det: KdcDetachment; faction: KdcFaction }, detId: string, detName: string): Stratagem[] {
    const own = kdc!.stratagems(hit.faction.id).filter((s) => s.detachment_id === hit.det.id);
    const list = own.length || !parent ? own : kdc!.stratagems(parent.id).filter((s) => s.detachment_id === hit.det.id);
    const stratIds = assignIds(ids, 'stratagems', armyId, list, (s) => ({ keys: [`40kdc:${hit.det.id}/${s.id}`], name: s.name }));
    return list.map((s) => toStratagem(s, stratIds.get(s)!, detId, kdc!.ability(s.ability_id ?? '', factionIds), `${detName} › ${s.name}`, bodyOf));
  }

  function rulesOf(hit: { det: KdcDetachment; faction: KdcFaction }, detName: string): Rule[] {
    let ruleIds = hit.det.detachment_rule_ids?.length ? hit.det.detachment_rule_ids : hit.det.detachment_rule_id ? [hit.det.detachment_rule_id] : [];
    // Un Chapitre reprend souvent le Detachment de sa faction parente sans en recopier la règle.
    if (!ruleIds.length && parent && hit.faction !== parent) {
      const fromParent = kdc!.detachments(parent.id).find((x) => kdcKey(x.name) === kdcKey(detName));
      ruleIds = fromParent?.detachment_rule_ids ?? (fromParent?.detachment_rule_id ? [fromParent.detachment_rule_id] : []);
    }
    const abilities = ruleIds.map((rid) => kdc!.ability(rid, factionIds)).filter((a): a is KdcAbility => Boolean(a));
    const scope = `${armyId}/${detIds.get(mfm!.detachments.find((x) => x.name === detName)!)}`;
    const ruleIdsAssigned = assignIds(ids, 'rules', scope, abilities, (a) => ({ keys: [`40kdc:${a.ability_id}`], name: a.name }));
    return abilities.map((a) => ({ id: ruleIdsAssigned.get(a)!, name: a.name, ...bodyOf(a, `${detName} › ${a.name}`) }));
  }

  function enhancementsOf(d: MfmDetachment, detId: string, hit: { det: KdcDetachment; faction: KdcFaction } | undefined): Enhancement[] {
    const kdcEnhancements = hit ? kdc!.enhancements(hit.faction.id).filter((e) => e.detachment_id === hit.det.id) : [];
    const matchOf = (e: MfmEnhancement) => kdcEnhancements.find((k) => kdcKey(k.name) === kdcKey(e.name));
    const enhIds = assignIds(ids, 'enhancements', `${armyId}/${detId}`, d.enhancements, (e) => {
      const k = matchOf(e);
      return { keys: [`mfm:${kdcKey(e.name)}`, ...(k ? [`40kdc:${k.id}`] : [])], name: e.name };
    });

    const list = d.enhancements.map((e): Enhancement => {
      const id = enhIds.get(e)!;
      const k = matchOf(e);
      if (hit && !k) out.missing.push({ army: armyId, entity: 'enhancement', name: `${d.name} › ${e.name}`, missingIn: '40kdc', published: true });
      if (k) conflictsOfEnhancement(out, armyId, id, d.name, e, k);
      const groups = k?.keyword_restriction_groups ?? (k?.keyword_restrictions?.length ? [k.keyword_restrictions] : []);
      return {
        id,
        name: e.name,
        points: e.points,
        appliesTo: e.appliesTo,
        aura: e.aura,
        maxTargets: k?.max_targets ?? 1,
        requires: groups,
        excludes: k?.exclusion_keywords ?? [],
        ...(e.leaderTo ? { leaderTo: e.leaderTo } : {}),
        ...(e.supportTo ? { supportTo: e.supportTo } : {}),
        ...(k?.ability_id ? bodyOf(kdc!.ability(k.ability_id, factionIds), `${d.name} › ${e.name}`) : {}),
      };
    });

    if (hit) {
      const known = new Set(d.enhancements.map((e) => kdcKey(e.name)));
      for (const k of kdcEnhancements)
        if (!known.has(kdcKey(k.name)))
          out.missing.push({ army: armyId, entity: 'enhancement', name: `${d.name} › ${k.name}`, missingIn: 'mfm', published: false });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }
}

function conflictsOfDetachment(
  out: DetachmentsOutput,
  army: string,
  id: string,
  d: MfmDetachment,
  k: KdcDetachment,
  forceDispositions: string[],
): void {
  const push = (field: string, kept: string, other: string) =>
    out.conflicts.push({ army, entity: 'detachment', id, name: d.name, field, authority: 'mfm', kept, other: { source: '40kdc', value: other } });
  if (typeof k.detachment_points === 'number' && d.dp !== null && k.detachment_points !== d.dp) push('dp', String(d.dp), String(k.detachment_points));
  if (k.force_dispositions?.length && !sameSet(forceDispositions, k.force_dispositions))
    push('forceDispositions', forceDispositions.join(', ') || '—', k.force_dispositions.join(', '));
}

function conflictsOfEnhancement(out: DetachmentsOutput, army: string, id: string, detName: string, e: MfmEnhancement, k: KdcEnhancement): void {
  const push = (field: string, kept: string, other: string) =>
    out.conflicts.push({ army, entity: 'enhancement', id, name: `${detName} › ${e.name}`, field, authority: 'mfm', kept, other: { source: '40kdc', value: other } });
  if (k.cost !== e.points) push('points', String(e.points), String(k.cost));
  if (typeof k.upgrade_tag === 'boolean' && k.upgrade_tag !== (e.appliesTo === 'unit')) push('appliesTo', e.appliesTo, k.upgrade_tag ? 'unit' : 'character');
}

/** Un Effect amont, s'il est conforme au format figé et exempt de texte ; `drop` dit pourquoi sinon. */
export function effectBody(ability: KdcAbility | undefined, drop: (reason: string) => void): RuleBody {
  if (!ability?.effect) return {};
  const errors = validateEffect(ability.effect, ability.scope);
  if (errors.length) {
    drop(`hors du format figé : ${errors[0]}`);
    return {};
  }
  const text = findRulesText({ effect: ability.effect, scope: ability.scope });
  if (text.length) {
    drop(`porte du texte : ${text[0].reason}`);
    return {};
  }
  return { effect: ability.effect as RuleBody['effect'], ...(ability.scope ? { scope: ability.scope as RuleBody['scope'] } : {}) };
}

const PHASES = new Set<Phase>(['command', 'movement', 'shooting', 'charge', 'fight']);
const PHASE_ORDER: Phase[] = ['command', 'movement', 'shooting', 'charge', 'fight'];

/**
 * La cible d'un Stratagem : ses restrictions quand 40kdc-data les écrit sur le
 * Stratagem, sinon le filtre de mots-clés de son aptitude. Leur note en prose
 * n'est jamais reprise.
 */
export function targetOf(s: KdcStratagem, ability: KdcAbility | undefined): StratagemTarget | undefined {
  const r = s.target_restrictions;
  if (r && (r.required_keywords?.length || r.required_keywords_any?.length || r.excluded_keywords?.length))
    return { allOf: r.required_keywords ?? [], anyOf: r.required_keywords_any ?? [], noneOf: r.excluded_keywords ?? [] };
  const a = ability?.applies_to;
  if (a && (a.required_keywords?.length || a.excluded_keywords?.length)) return { allOf: a.required_keywords ?? [], anyOf: [], noneOf: a.excluded_keywords ?? [] };
  return undefined;
}

export function toStratagem(
  s: KdcStratagem,
  id: string,
  detachmentId: string | null,
  ability: KdcAbility | undefined,
  where: string,
  bodyOf: (ability: KdcAbility | undefined, where: string) => RuleBody,
): Stratagem {
  const phases = PHASE_ORDER.filter((p) => s.phases.includes(p) && PHASES.has(p));
  const target = targetOf(s, ability);
  return {
    id,
    name: s.name,
    detachmentId,
    cp: s.cp_cost,
    phases: phases.length ? phases : [...PHASE_ORDER],
    playerTurn: (['your-turn', 'opponent-turn', 'either'].includes(s.player_turn) ? s.player_turn : 'either') as PlayerTurn,
    timing: (['once-per-phase', 'once-per-turn', 'once-per-battle', 'unlimited'].includes(s.timing) ? s.timing : 'once-per-phase') as StratagemTiming,
    ...(s.type ? { category: s.type } : {}),
    ...(target ? { target } : {}),
    ...bodyOf(ability, where),
  };
}
