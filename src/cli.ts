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
  if (value === undefined) throw new Error(`--${name} missing`);
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
      for (const f of out.textCheck) console.error(`✘ rules text — ${f.where}: ${f.reason} — "${f.excerpt}"`);
      throw new Error(`${out.textCheck.length} rules-text finding(s): nothing is written`);
    }
    writeDataset(datasetDir, gameSystem, out.files, out.ids);
    const report = makeReport(out, previous);
    const reportFile = optional('report');
    if (reportFile) writeFileSync(reportFile, `${renderReport(report)}\n`);
    console.log(`${out.files.size} files written to ${datasetDir}`);
    console.log(
      `${report.diff.changes.length} number(s) changed, ${out.conflicts.length} disagreement(s) between sources, ` +
        `${out.unmatched.length} Unit(s) missing from the MFM, ${out.corrections.length} Correction(s), ${out.orphans.length} orphaned`,
    );
    if (out.unresolvedAuthored.length) console.log(`Units not found for authored/: ${out.unresolvedAuthored.join(', ')}`);
    if (out.armiesWithoutMfm.length) console.log(`Armies with no MFM faction: ${out.armiesWithoutMfm.join(', ')}`);
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
    console.log(`Local interface: ${gui.url} — Ctrl+C to stop`);
    if (host) console.log(`Open at ${host}: no authentication, any machine on that network can write.`);
    else console.log('Listening on this machine only. --host <address> opens it to a private network.');
    console.log(`Dataset: ${ws.datasetDir}${ws.state.dataset ? '' : ' (missing — use the "Fetch the Dataset" button)'}`);
    console.log(`Snapshot: ${ws.snapshotDir}${ws.state.snapshot ? '' : ' (missing — optional, needed to show where values come from)'}`);
    if (!ws.allowPush) console.log('Remote writes refused: --allow-push lets the interface push and open pull requests.');
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
      console.log(`Dataslate proposed: ${p.id} ("${p.name}", MFM ${p.mfmVersion}) — ${p.isNew ? 'new' : 'existing'}`);
      console.log(`Confirm with: --dataslate ${p.id}`);
      process.exitCode = 1;
      return;
    }
    console.log(`Release ${out.release.tag} published in Dataslate ${out.manifest.current}`);
    if (out.frozen) console.log(`Dataslate frozen: ${out.frozen}`);
    console.log(`Offered: ${out.manifest.offered.join(', ')} — to push: git push --follow-tags`);
    return;
  }

  if (command === 'repoint') {
    const manifest = repointManifest(arg('dataset'), {
      ...(optional('current') ? { current: optional('current')! } : {}),
      ...(optional('release') ? { release: optional('release')! } : {}),
      ...(optional('dataslate') ? { dataslate: optional('dataslate')! } : {}),
    });
    const current = manifest.dataslates.find((d) => d.id === manifest.current)!;
    console.log(`Current: ${manifest.current} → ${current.latest} · offered: ${manifest.offered.join(', ')}`);
    return;
  }

  if (command === 'check') {
    const report = checkDataset(arg('dataset'), gameSystem);
    console.log(renderCheck(report));
    if (!report.ok) process.exitCode = 1;
    return;
  }

  console.error('usage: dataset-tool fetch --out <dir> | build --snapshot <dir> --dataset <dir> [--report <md>] | check --dataset <dir> | release --dataset <dir> [--dataslate <id>] | repoint --dataset <dir> | gui --snapshot <dir> --dataset <dir>');
  process.exitCode = 2;
}

main().catch((err) => {
  console.error(`✘ ${(err as Error).message}`);
  process.exitCode = 1;
});
