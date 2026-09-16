#!/usr/bin/env -S npx tsx
/**
 * Le Dataset Tool en ligne de commande.
 *
 *   dataset-tool fetch --out <dir>
 *   dataset-tool build --snapshot <dir> --dataset <dir> [--report <fichier.md>] [--game-system wh40k-11e]
 *   dataset-tool check --dataset <dir> [--game-system wh40k-11e]
 *   dataset-tool release --dataset <dir> [--dataslate <id>] [--dataslate-name <nom>] [--release-url <modèle {tag}>]
 *   dataset-tool repoint --dataset <dir> [--current <dataslate>] [--release <tag> [--dataslate <id>]]
 *   dataset-tool gui [--dataset <dir>] [--snapshot <dir>] [--port 4173]
 *                    [--host <adresse privée>|tailscale] [--repo <url>] [--allow-push]
 *
 * L'interface démarre les mains vides : sans Dataset ni instantané, elle propose
 * de les récupérer. De quoi corriger quelque chose depuis une machine neuve, en
 * ne clonant que cet outil.
 */
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { build } from './build.ts';
import { readAuthored } from './authored.ts';
import { publishRelease, repointManifest } from './release.ts';
import { startGui, tailscaleAddress } from './gui/server.ts';
import { openWorkspace } from './gui/workspace.ts';
import { checkDataset, renderCheck } from './check.ts';
import { readCorrections } from './corrections/files.ts';
import { readDatasetFiles, readRegistry, writeDataset } from './dataset.ts';
import { fetchSnapshot } from './fetch.ts';
import { makeReport, renderReport } from './report.ts';
import { openSnapshot } from './snapshot.ts';

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : fallback;
  if (value === undefined) throw new Error(`--${name} manquant`);
  return value;
}

const optional = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main(): Promise<void> {
  const command = process.argv[2];
  const gameSystem = arg('game-system', 'wh40k-11e');

  if (command === 'fetch') {
    await fetchSnapshot({ out: arg('out'), log: (m) => console.log(m) });
    return;
  }

  if (command === 'build') {
    const datasetDir = arg('dataset');
    const previous = readDatasetFiles(datasetDir, gameSystem);
    const out = await build({
      snapshot: openSnapshot(arg('snapshot')),
      ids: readRegistry(datasetDir, gameSystem),
      corrections: readCorrections(datasetDir, gameSystem),
      authored: readAuthored(datasetDir, gameSystem),
      gameSystem,
    });
    // Une construction qui ferait entrer du texte de règles n'écrit rien.
    if (out.textCheck.length) {
      for (const f of out.textCheck) console.error(`✘ texte de règles — ${f.where} : ${f.reason} — « ${f.excerpt} »`);
      throw new Error(`${out.textCheck.length} constat(s) de texte de règles : rien n'est écrit`);
    }
    writeDataset(datasetDir, gameSystem, out.files, out.ids);
    const report = makeReport(out, previous);
    const reportFile = optional('report');
    if (reportFile) writeFileSync(reportFile, `${renderReport(report)}\n`);
    console.log(`${out.files.size} fichiers écrits dans ${datasetDir}`);
    console.log(
      `${report.diff.changes.length} chiffre(s) modifié(s), ${out.conflicts.length} désaccord(s) entre sources, ` +
        `${out.unmatched.length} Unit(s) absente(s) du MFM, ${out.corrections.length} Correction(s), ${out.orphans.length} orpheline(s)`,
    );
    if (out.unresolvedAuthored.length) console.log(`Units introuvables pour authored/ : ${out.unresolvedAuthored.join(', ')}`);
    if (out.armiesWithoutMfm.length) console.log(`Armies sans faction MFM : ${out.armiesWithoutMfm.join(', ')}`);
    return;
  }

  if (command === 'gui') {
    // Un dossier de travail par défaut : l'interface se lance sans rien préparer.
    const work = join(process.cwd(), '.workspace');
    const ws = await openWorkspace({
      datasetDir: arg('dataset', join(work, 'dataset')),
      snapshotDir: arg('snapshot', join(work, '.snapshot')),
      gameSystem,
      ...(optional('repo') ? { repository: optional('repo')! } : {}),
      allowPush: process.argv.includes('--allow-push'),
    });
    const asked = optional('host');
    const host = asked === 'tailscale' ? tailscaleAddress() : asked;
    const gui = await startGui(ws, { port: Number(optional('port') ?? 4173), ...(host ? { host } : {}) });
    console.log(`Interface locale : ${gui.url} — Ctrl+C pour arrêter`);
    if (host) console.log(`Ouverte à ${host} : aucune authentification, toute machine de ce réseau peut écrire.`);
    else console.log('N\'écoute que sur cette machine. --host <adresse> pour l\'ouvrir à un réseau privé.');
    console.log(`Dataset : ${ws.datasetDir}${ws.state.dataset ? '' : ' (absent — bouton « Récupérer le Dataset »)'}`);
    console.log(`Instantané : ${ws.snapshotDir}${ws.state.snapshot ? '' : ' (absent — facultatif, pour l\'origine des valeurs)'}`);
    if (!ws.allowPush) console.log('Écriture distante refusée : --allow-push pour pousser et ouvrir des PR depuis l\'interface.');
    return;
  }

  if (command === 'release') {
    const dataslate = optional('dataslate');
    const out = publishRelease({
      dir: arg('dataset'),
      gameSystem,
      ...(dataslate ? { dataslate } : {}),
      ...(optional('dataslate-name') ? { dataslateName: optional('dataslate-name')! } : {}),
      ...(optional('release-url') ? { releaseUrl: optional('release-url')! } : {}),
    });
    if (out.status === 'proposal') {
      const p = out.proposal;
      console.log(`Dataslate proposée : ${p.id} (« ${p.name} », MFM ${p.mfmVersion}) — ${p.isNew ? 'nouvelle' : 'existante'}`);
      console.log(`Confirmer : --dataslate ${p.id}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Release ${out.release.tag} publiée dans la Dataslate ${out.manifest.current}`);
    if (out.frozen) console.log(`Dataslate gelée : ${out.frozen}`);
    console.log(`Proposées : ${out.manifest.offered.join(', ')} — à pousser : git push --follow-tags`);
    return;
  }

  if (command === 'repoint') {
    const manifest = repointManifest(arg('dataset'), {
      ...(optional('current') ? { current: optional('current')! } : {}),
      ...(optional('release') ? { release: optional('release')! } : {}),
      ...(optional('dataslate') ? { dataslate: optional('dataslate')! } : {}),
    });
    const current = manifest.dataslates.find((d) => d.id === manifest.current)!;
    console.log(`Courante : ${manifest.current} → ${current.latest} · proposées : ${manifest.offered.join(', ')}`);
    return;
  }

  if (command === 'check') {
    const report = checkDataset(arg('dataset'), gameSystem);
    console.log(renderCheck(report));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  console.error('usage : dataset-tool fetch --out <dir> | build --snapshot <dir> --dataset <dir> [--report <md>] | check --dataset <dir> | release --dataset <dir> [--dataslate <id>] | repoint --dataset <dir> | gui --snapshot <dir> --dataset <dir>');
  process.exitCode = 2;
}

main().catch((err) => {
  console.error(`✘ ${(err as Error).message}`);
  process.exitCode = 1;
});
