/**
 * L'opération de construction : un instantané des Upstream Sources et les
 * Corrections deviennent un Dataset conforme au schéma.
 *
 * C'est l'interface principale du Dataset Tool — l'automatisation, l'interface
 * graphique et les tests passent tous par elle. Elle ne touche ni au réseau ni
 * au disque en dehors de l'instantané qu'on lui donne, et rend tout ce qu'elle
 * produit : les fichiers du Dataset, le registre d'identifiants mis à jour, ce
 * qui mérite d'être relu (désaccords entre sources, éléments absents d'une
 * source, état des Corrections) et le verdict du contrôle « aucun texte de
 * règles ».
 */
import {
  armyPath,
  corePath,
  EFFECT_FORMAT,
  GAME_SYSTEMS,
  indexPath,
  SCHEMA_VERSION,
  type ArmyFile,
  type ArmySummary,
  type CoreFile,
  type DatasetIndex,
  type Detachment,
  type Stratagem,
  type Unit,
} from '@paintplanplay/dataset-schema';
import { armyFaction, armyLabel, composeArmy, playableArmies } from './bsdata/army.ts';
import type { CatalogueUnit } from './bsdata/types.ts';
import { applyCorrections, applyDetachmentCorrections, applyStratagemCorrections, CORE_ROOT, parseTarget, type ApplyReport } from './corrections/apply.ts';
import type { CorrectionFile } from './corrections/files.ts';
import { detachmentElement, reconcile, stratagemElement, upstreamElement, type CorrectionVerdict } from './corrections/lifecycle.ts';
import { buildDetachments, effectBody, toStratagem } from './detachments.ts';
import type { DroppedEffect, MissingEntity, SourceConflict } from './findings.ts';
import { assignIds, emptyRegistry, type IdRegistry } from './ids.ts';
import { findRulesText, type TextFinding } from './notext.ts';
import type { Snapshot } from './snapshot.ts';
import { kdcFactionFor } from './upstream/kdc.ts';
import { unitAbilities } from './abilities.ts';
import { applyAuthoredEffects, resolveAuthored, type AuthoredCore } from './authored.ts';
import { applyMfm, mfmKey, type MfmConflict, type MfmFaction } from './upstream/mfm.ts';

export type { DroppedEffect, MissingEntity, SourceConflict } from './findings.ts';

export interface BuildInput {
  snapshot: Snapshot;
  /** Registre d'identifiants de la construction précédente ; vide pour une première. */
  ids?: IdRegistry;
  /** Corrections du dépôt du Dataset, appliquées après les Upstream Sources. */
  corrections?: CorrectionFile[];
  gameSystem?: string;
  /** Battle Sizes, cibles par défaut et List d'exemple écrites par le projet. */
  authored?: AuthoredCore;
}

export interface BuildOutput {
  gameSystem: string;
  /** Fichiers du Dataset, par chemin relatif à la racine du Dataset. */
  files: Map<string, unknown>;
  ids: IdRegistry;
  conflicts: SourceConflict[];
  /** Units absentes du MFM, par Army : leur coût vient de BSData. */
  unmatched: { army: string; id: string; name: string }[];
  /** Armies BSData sans faction MFM correspondante. */
  armiesWithoutMfm: string[];
  /** Detachments et Enhancements qu'une source publie et que l'autre ignore. */
  missing: MissingEntity[];
  /** Effects amont écartés. */
  droppedEffects: DroppedEffect[];
  /** Units nommées par les fichiers écrits par le projet et introuvables. */
  unresolvedAuthored: string[];
  /** État de chaque Correction face à l'amont de cette construction. */
  corrections: CorrectionVerdict[];
  /** Corrections dont la cible est introuvable. */
  orphans: ApplyReport['orphans'];
  /** Verdict du contrôle « aucun texte de règles » sur les fichiers produits et les Corrections : vide = conforme. */
  textCheck: TextFinding[];
}

/**
 * Noms sous lesquels le MFM désigne une Army quand ils diffèrent du libellé
 * BSData. Tenu à la main : ces écarts sont rares et ne se devinent pas.
 */
const MFM_ALIASES: Record<string, string[]> = {
  'imperial-agents': ['Agents of the Imperium'],
  aeldari: ['Craftworlds'],
  'titan-legions': ['Adeptus Titanicus'],
  'chaos-titan-legions': ['Titanicus Traitoris'],
};

function directMfmFaction(armyFile: string, factions: MfmFaction[]): MfmFaction | undefined {
  const label = mfmKey(armyLabel(armyFile));
  return (
    factions.find((f) => mfmKey(f.name) === label) ??
    factions.find((f) => (MFM_ALIASES[f.slug] ?? []).some((alias) => mfmKey(alias) === label))
  );
}

/**
 * La faction MFM d'une Army. Une sous-faction que le MFM ne publie pas à part —
 * les Ultramarines sont listés sous Space Marines — prend celle du catalogue
 * dont elle importe les datasheets.
 */
export function mfmFactionOf(armyFile: string, loaded: string[], factions: MfmFaction[]): MfmFaction | undefined {
  return (
    directMfmFaction(armyFile, factions) ??
    loaded.filter((f) => f !== armyFile).map((f) => directMfmFaction(f, factions)).find(Boolean)
  );
}

/**
 * Une datasheet aplatie, réduite à ce que le Dataset publie : aucun texte. Ses
 * aptitudes arrivent déjà résolues (`unitAbilities`) ; à défaut, leur nom seul.
 */
export function toDatasetUnit(u: CatalogueUnit, abilities: Unit['abilities'] = u.abilities.map((a) => ({ name: a.name }))): Unit {
  return {
    id: u.id,
    name: u.name,
    source: u.source,
    ...(u.ally ? { ally: true } : {}),
    isLegends: u.isLegends,
    keywords: u.keywords,
    models: u.models,
    weapons: u.weapons,
    abilities,
    points: u.points,
    costBrackets: u.costBrackets,
    ...(u.pricing ? { pricing: u.pricing } : {}),
    ...(u.wargear?.length ? { wargear: u.wargear } : {}),
    leaderTargets: u.leaderTargets,
    supportTargets: u.supportTargets,
    minModels: u.minModels,
    maxModels: u.maxModels,
    ...(u.defaultModels !== undefined ? { defaultModels: u.defaultModels } : {}),
    ...(u.composition?.length ? { composition: u.composition } : {}),
    ...(u.defaultLoadout?.length ? { defaultLoadout: u.defaultLoadout } : {}),
    ...(u.optionGroups?.length ? { optionGroups: u.optionGroups } : {}),
  };
}

const conflictOf = (army: string, c: MfmConflict): SourceConflict => ({
  army,
  entity: 'unit',
  id: c.unitId,
  name: c.unit,
  field: c.field,
  authority: 'mfm',
  kept: c.mfm,
  other: { source: 'bsdata', value: c.bsdata },
});

/**
 * Une Unit alliée figure dans chaque Army qui peut l'aligner : ce qui la
 * concerne ne se signale qu'une fois, sous l'Army qui la possède quand il y en
 * a une, sinon sous la première qui l'aligne.
 */
class OncePerUnit {
  private done = new Set<string>();
  private pending = new Map<string, () => void>();

  report(key: string, own: boolean, emit: () => void): void {
    if (this.done.has(key)) return;
    if (own) {
      this.done.add(key);
      this.pending.delete(key);
      emit();
    } else if (!this.pending.has(key)) this.pending.set(key, emit);
  }

  flush(): void {
    for (const emit of this.pending.values()) emit();
    this.pending.clear();
  }
}

const DETACHMENT_ENTITIES = new Set(['detachment', 'enhancement']);

export async function build(input: BuildInput): Promise<BuildOutput> {
  const { snapshot } = input;
  const gameSystem = input.gameSystem ?? 'wh40k-11e';
  const system = GAME_SYSTEMS[gameSystem];
  if (!system) throw new Error(`unknown Game System: ${gameSystem}`);
  const corrections = input.corrections ?? [];

  const ids = structuredClone(input.ids ?? emptyRegistry());
  const files = new Map<string, unknown>();
  const conflicts: SourceConflict[] = [];
  const unmatched: BuildOutput['unmatched'] = [];
  const armiesWithoutMfm: string[] = [];
  const missing: MissingEntity[] = [];
  const droppedEffects: DroppedEffect[] = [];

  const all = snapshot.bsdataFiles();
  const mfm = snapshot.mfmFactions();
  const kdc = snapshot.kdc();

  const composed: { file: string; units: CatalogueUnit[]; mfm?: MfmFaction }[] = [];
  for (const file of playableArmies(all)) {
    const data = await composeArmy(file, all, [], async (f) => snapshot.readBsdata(f));
    // Une Army sans datasheet est un fichier de règles, pas une Army jouable.
    if (data.units.length === 0) continue;
    composed.push({ file, units: data.units, mfm: mfmFactionOf(file, data.loaded, mfm) });
  }

  const armyIds = assignIds(ids, 'armies', '*', composed, (a) => ({ keys: [`bsdata:${a.file}`], name: armyLabel(a.file) }));

  // 1. Upstream Sources : BSData, puis le MFM qui fait autorité sur ce qu'il publie, puis 40kdc-data.
  const once = new OncePerUnit();
  const merged = composed.map((army) => {
    const id = armyIds.get(army)!;
    if (!army.mfm) armiesWithoutMfm.push(army.file);
    // La faction de l'Army d'abord : une Unit partagée prend le prix de son propre codex.
    const ordered = army.mfm ? [army.mfm, ...mfm.filter((f) => f !== army.mfm)] : mfm;
    const { units, report } = applyMfm(army.units, ordered);
    const own = new Map(army.units.map((u) => [u.id, !u.ally]));
    for (const c of report.conflicts) once.report(`conflict:${c.unitId}:${c.field}`, own.get(c.unitId) ?? true, () => conflicts.push(conflictOf(id, c)));
    for (const u of report.unmatched) once.report(`unmatched:${u.id}`, own.get(u.id) ?? true, () => unmatched.push({ army: id, ...u }));

    const kdcFaction = kdc ? kdcFactionFor([armyLabel(army.file), army.mfm?.name], kdc.factions) : undefined;
    const dets = buildDetachments({ armyId: id, mfm: army.mfm, kdc, kdcFaction, ids });
    conflicts.push(...dets.conflicts);
    missing.push(...dets.missing);
    droppedEffects.push(...dets.droppedEffects);
    return { ...army, id, units, kdcFaction, detachments: dets.detachments, stratagems: dets.stratagems };
  });
  once.flush();

  // L'amont de chaque Unit, avant Corrections, pris dans l'Army qui la possède.
  const upstream = new Map<string, CatalogueUnit>();
  for (const army of merged) for (const u of army.units) if (!u.ally) upstream.set(u.id, u);
  for (const army of merged) for (const u of army.units) if (!upstream.has(u.id)) upstream.set(u.id, u);
  const upstreamDetachments = new Map<string, Detachment[]>(merged.map((a) => [a.id, a.detachments]));
  const upstreamStratagems = new Map<string, Stratagem[]>(merged.map((a) => [a.id, a.stratagems]));

  // Les Stratagems Core ne dépendent d'aucune Army.
  const coreKdc = kdc?.coreStratagems() ?? [];
  const coreIds = assignIds(ids, 'stratagems', CORE_ROOT, coreKdc, (s) => ({ keys: [`40kdc:${s.id}`], name: s.name }));
  const coreStratagems = coreKdc
    .map((s) =>
      toStratagem(s, coreIds.get(s)!, null, kdc!.ability(s.ability_id ?? '', []), `Core › ${s.name}`, (ability, where) =>
        effectBody(ability, (reason) => droppedEffects.push({ army: CORE_ROOT, where, reason })),
      ),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  upstreamStratagems.set(CORE_ROOT, coreStratagems);

  // 2. Corrections, par-dessus.
  const orphans: ApplyReport['orphans'] = [];
  const seenOrphans = new Set<string>();
  const orphan = (o: ApplyReport['orphans'][number]) => {
    if (seenOrphans.has(o.target)) return;
    seenOrphans.add(o.target);
    orphans.push(o);
  };
  for (const c of corrections) {
    const { root, entity } = parseTarget(c.target);
    if (DETACHMENT_ENTITIES.has(entity) && !upstreamDetachments.has(root)) orphan({ target: c.target, why: `Army ${root} missing` });
    if (entity === 'stratagem' && !upstreamStratagems.has(root)) orphan({ target: c.target, why: `Army ${root} missing` });
  }

  const summaries: ArmySummary[] = [];
  const unitsByArmy = new Map<string, Unit[]>();
  for (const army of merged) {
    const corrected = applyCorrections(army.units, corrections);
    for (const o of corrected.report.orphans) {
      // Une Unit absente d'une Army ne l'est pas forcément du Dataset.
      if (o.why.startsWith('Unit ') && upstream.has(o.target.split('::')[0])) continue;
      orphan(o);
    }
    const dets = applyDetachmentCorrections(army.id, army.detachments, corrections);
    dets.report.orphans.forEach(orphan);
    const strats = applyStratagemCorrections(army.id, army.stratagems, corrections);
    strats.report.orphans.forEach(orphan);

    const datasetUnits = corrected.units
      .map((u) =>
        toDatasetUnit(
          u,
          unitAbilities(u, kdc, (where, reason) =>
            // Une Unit partagée entre Armies ne se signale qu'une fois, par l'Army qui la possède.
            once.report(`effect:${u.id}:${where}`, !u.ally, () => droppedEffects.push({ army: army.id, where: `${u.name} › ${where}`, reason })),
          ),
        ),
      )
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const file: ArmyFile = {
      schemaVersion: SCHEMA_VERSION,
      gameSystem,
      id: army.id,
      name: armyLabel(army.file),
      faction: armyFaction(army.file),
      units: datasetUnits,
      detachments: dets.detachments,
      stratagems: strats.stratagems,
    };
    files.set(armyPath(gameSystem, army.id), file);
    unitsByArmy.set(army.id, datasetUnits);
    summaries.push({
      id: army.id,
      name: file.name,
      faction: file.faction,
      units: datasetUnits.length,
      refs: { bsdata: army.file, ...(army.mfm ? { mfm: army.mfm.slug } : {}), ...(army.kdcFaction ? { kdc: army.kdcFaction.id } : {}) },
    });
  }
  once.flush();

  const verdicts = reconcile(corrections, (target) => {
    const { root, entity } = parseTarget(target);
    if (entity === 'stratagem') {
      const strats = upstreamStratagems.get(root);
      return { rootFound: Boolean(strats), element: strats ? stratagemElement(strats, target) : undefined };
    }
    if (DETACHMENT_ENTITIES.has(entity)) {
      const dets = upstreamDetachments.get(root);
      return { rootFound: Boolean(dets), element: dets ? detachmentElement(dets, target) : undefined };
    }
    const unit = upstream.get(root);
    return { rootFound: Boolean(unit), element: upstreamElement(unit, target) };
  });

  const index: DatasetIndex = {
    schemaVersion: SCHEMA_VERSION,
    gameSystem: system,
    sources: snapshot.sources,
    effectFormat: EFFECT_FORMAT,
    armies: summaries.sort((a, b) => a.id.localeCompare(b.id)),
  };
  files.set(indexPath(gameSystem), index);

  const core = applyStratagemCorrections(CORE_ROOT, coreStratagems, corrections);
  core.report.orphans.forEach(orphan);
  const authored = resolveAuthored(input.authored, unitsByArmy);
  const coreFile: CoreFile = {
    schemaVersion: SCHEMA_VERSION,
    gameSystem,
    stratagems: core.stratagems,
    battleSizes: authored.battleSizes,
    referenceTargets: authored.referenceTargets,
    ...(authored.sampleList ? { sampleList: authored.sampleList } : {}),
  };
  files.set(corePath(gameSystem), coreFile);

  // Les Effects et résumés écrits par le projet, par-dessus tout le reste.
  const authoredEffects = applyAuthoredEffects(files, gameSystem, input.authored?.effects ?? []);
  authored.unresolved.push(...authoredEffects.unresolved);
  for (const r of authoredEffects.rejected) droppedEffects.push({ army: 'authored', where: r.target, reason: r.reason });

  const textCheck = [
    ...[...files].flatMap(([path, data]) => findRulesText(data, path)),
    ...corrections.flatMap(({ path, ...c }) => findRulesText(c, path)),
  ];
  return { gameSystem, files, ids, conflicts, unmatched, armiesWithoutMfm, missing, droppedEffects, unresolvedAuthored: authored.unresolved, corrections: verdicts, orphans, textCheck };
}
