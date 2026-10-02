# Maintaining the dataset

For the people who review pull requests on the
[dataset repository](https://github.com/PaintPlanPlay/dataset) and publish
releases. Everything here can be done from the interface; the command line is
described at the end.

## The life of a change

```
someone saves a fix ──▶ Save & Build ──▶ Propose my change ──▶ pull request
                                                                    │ checks run
                                                                    ▼
apps read it ◀── Publish Release ◀── merged into main ◀── a maintainer reviews
```

Nothing reaches the apps before **Publish Release**. Merging only prepares the
next release.

## What runs on its own

Two automations live in the dataset repository (`.github/workflows/`).

**The checks**, on every pull request and on `main`: the dataset must match the
schema and contain no rules text, corrections and contributions included. They
use the `main` branch of this tool.

**The daily update**, every morning and on demand (*Actions → run workflow*):
it takes a fresh snapshot of the three sources, rebuilds, checks, and — if
anything changed — opens a pull request named after the update, or updates the
one already open. Its description is the **drift report**. It only ever touches
the built files (`wh40k-11e/`, `registry/`), never corrections or
contributions. With no change upstream, the build is identical and no pull
request is opened.

Two settings of the dataset repository drive them:

| Setting | What it is |
|---|---|
| variable `DATASET_TOOL_REPOSITORY` | `owner/repo` of this tool |
| secret `DATASET_BOT_TOKEN` | a token used to open the update pull request. Without it the pull request is still opened, but GitHub does not run the checks on it |

## Reading the drift report

The report says what a build changes in the published dataset, most important
first. It is the description of the daily update's pull request, and
`build --report <file>` writes it.

| Section | What it tells you | What to do |
|---|---|---|
| the table at the top | each source, before and after: commit and MFM version | a new MFM version means a new dataslate at the next release |
| **Numbers changed** | every unit value that moved: points, price grid, paid wargear, size, characteristics, keywords, attachments, abilities, weapons; detachment points, dispositions, enhancement points | read it — this is what decides games. Anything surprising: compare with the official document |
| **Units removed / added**, **Armies gone / added** | | check a removal is real and not a rename upstream |
| **Disagreements between sources** | the trusted source's value was kept, the other is shown | when the loser is right, write a correction |
| **Corrections** | each one, *in conflict* first, then *stale*, then *active*; and the *orphaned* ones | delete the stale; decide the conflicts; fix or delete the orphans |
| **Contributions to review** | 40kdc-data changed its reading of a rule after we wrote ours | compare; ours stays applied |
| **Elements missing from a source** | a detachment or enhancement one source has and the other lacks. What only 40kdc-data has is *set aside* | usually nothing: a source is late |
| **Contributions set aside** | refused: off schema, or rules text | fix the entry |
| **Contributions whose target is gone** | the rule or option group they applied to disappeared | re-target or delete |
| **Modifier keys the simulation does not play** | | fix a typo, or leave it for the simulator to learn |
| **Wargear costs not linked** | MFM wargear lines no option bills | link by hand on the unit sheet |
| **Enhancement Weapons to check** | *orphan*: a weapon BSData gives an enhancement the Dataset does not have; *collision*: a datasheet carrying the weapon of one of its army's enhancements | an orphan waits for its detachment in the MFM; a collision usually means a new or renamed shared BSData group to leave out |
| **Authored entries not found** | a default target, the sample list or an ally rule names something gone | fix the file in `authored/` |
| **MFM duplicates dropped** | names the MFM lists twice in one faction | check the kept line is the right one |
| **Units missing from the MFM** | their cost comes from BSData | usually Legends: nothing |

## Reviewing a pull request

A contribution from a player is typically one or a few small files.

1. **The checks are green.** If not, the log names the file and the problem.
2. **Each correction is right.** Compare `patch` with the official source; read
   the `reason`.
3. **The source is the right one** (`mfm` for a cost, `bsdata` for a
   profile…). The interface chooses it; a hand-written file may not.
4. **`upstream` is recorded**, so the correction can go stale on its own later.
5. **No rules text**, in values or reasons. The automatic check catches prose
   and typical phrasing; a short copied sentence is for you to catch.
6. **Modifiers say what the rule does**, with keys the simulation plays where
   one exists. See [Rules and Modifiers](rules-and-modifiers.md).
7. **Built files.** A pull request proposed from the interface includes the
   rebuilt `wh40k-11e/` files, so the diff is large; the files to *review* are
   those in `corrections/` and `authored/`. A hand-made pull request that only
   adds a correction leaves the rebuild to the daily update.

To try a pull request locally, check its branch out in
`.workspace/dataset` and open the interface: the sheets show its corrections
applied, with their blue dots.

## Publishing a release

In the interface, **Publish Release** is shown only to accounts with write
access to the dataset repository, and opens once something was merged since the
last release. The tool must have been started with `--allow-push`.

It asks four things, and proposes an answer to each:

| Question | What it is | Usual answer |
|---|---|---|
| **Rules period to publish into** | the dataslate | the proposed one |
| **MFM version these points follow** | the Munitorum Field Manual the dataset applies | the proposed one |
| **Address the apps will read this release from** | the CDN serving the repository at the release tag | the proposed one |
| **Refresh the CDN copy of the manifest** | jsDelivr keeps the manifest up to 12 hours; purging it shows the release to the apps within minutes | ticked; untick for a minor update that can wait |

Then it does, in order:

1. switches the dataset folder to `main` and pulls what was merged;
2. checks the dataset once more — a dataset that fails is never released;
3. writes the manifest, commits, and creates the tag
   `wh40k-11e-<dataslate>-r<n>`;
4. pushes the commit and the tag;
5. asks the CDN to forget its copy of the manifest.

A published release is **never rewritten**: a mistake is fixed by a new
release, or by rolling back.

### Which dataslate?

The tool proposes one from the MFM version of the sources:

| Situation | What happens |
|---|---|
| same MFM as the current dataslate | a new release in that dataslate: `r4` after `r3` |
| a newer MFM | a **new dataslate** `mfm-<version>`; the previous one is **frozen** |
| a frozen dataslate | refused: no release can be added to it |

Two rarer cases:

- **Games Workshop published a new dataslate without a new MFM.** A second
  dataslate on the same MFM version is refused by default — it is usually a
  mistake. From the command line, confirm with `--same-mfm`.
- **You are ahead of the sources**: next section.

### When you are ahead of the sources

A new MFM is out, and you entered it by hand as corrections before its
transcription followed
([recipe](recipes.md#enter-a-new-munitorum-field-manual-before-bsdata-does)).
The sources still say the old version, so the tool proposes the old dataslate.

In the release form, set **MFM version these points follow** to the new version
(`1.5`) and name the **rules period** after it (`mfm-1-5`). The tool refuses a
version older than the one the sources already have.

While the current dataslate is ahead, the tool keeps proposing it, until the
source catches up. Then delete the corrections that have gone stale.

## Rolling back

Rolling back never deletes anything: it points the manifest at another release.
It is done from the command line, in the dataset folder's context:

```bash
# read an earlier release for the current dataslate
npm run tool -- repoint --dataset .workspace/dataset --release wh40k-11e-mfm-1-5-r2

# or for a named dataslate
npm run tool -- repoint --dataset .workspace/dataset --release wh40k-11e-mfm-1-4-r9 --dataslate mfm-1-4

# make another dataslate the current one
npm run tool -- repoint --dataset .workspace/dataset --current mfm-1-4
```

It rewrites `manifest.json` and commits it. Then push, and purge the CDN's copy
of the manifest so the apps see it without waiting:

```bash
git -C .workspace/dataset push
curl https://purge.jsdelivr.net/gh/PaintPlanPlay/dataset@main/manifest.json
```

## Reviewing imported rules

Modifiers can be produced in bulk — read once from the rules, outside the
repository — and imported: **To review → Import extracted Rules…** takes a JSON
file, a list of entries:

```json
[
  {
    "target": "orks::stratagem:ere-we-go",
    "modifiers": [{ "key": "charge", "value": 2, "target": "self" }],
    "summary": "+2 to charge"
  }
]
```

Each entry has a `target` (the address of a rule of the dataset) and what it
does — `modifiers`, `options`, `summary` — never the rule's text. Each is
compared with 40kdc-data's own reading of the same rule:

| Result | Meaning | Where it goes |
|---|---|---|
| **concordant** | both readings agree | accepted |
| **differs** (`divergent`) | they disagree, or theirs cannot be compared | **To review**, both side by side |
| **one reading** (`seul`) | 40kdc-data has none | **To review** |

In **To review**, open the rule to correct it on its sheet, or click
**Validate** to accept ours as it is. Editing an imported rule on its sheet
marks it reviewed.

An import never replaces what someone wrote or reviewed by hand, and an entry
that names a rule the dataset does not have, or that reads like rules text, is
refused on its own — the others pass.

## After updating the tool

A new version of the tool may build slightly different files: a new field, a
new link. The interface then says *The Dataset files come from an earlier
version of this tool*. Click **Save & Build**, **Propose my change**, merge,
and release, so the apps get what the tool now builds.

When a change touches the **schema**, order matters: merge the tool first — the
dataset's checks run with the tool's `main` — then the rebuilt dataset, then
release, then the apps that read the new fields.

## Telling the sources

Every active correction is a fix the source could make itself. From
**Corrections**, **tell bsdata / mfm / 40kdc** opens a prefilled issue with that
project; record the link of its pull request on the correction. A correction
with a link reads, in the drift report, `upstream PR: …` — the ones without are
your to-do list.

## Command-line reference

Every button of the interface runs one of these. From the tool's folder:

```bash
npm run tool -- <command> [options]
```

All commands accept `--game-system <id>` (default `wh40k-11e`).

### `fetch` — take a snapshot of the sources

```bash
npm run tool -- fetch --out .workspace/.snapshot
```

Downloads BSData, the MFM and 40kdc-data, each at its latest commit, into the
folder, and records those commits in `sources.json`. The only command that uses
the network. Set `GITHUB_TOKEN` to raise GitHub's limit of 60 requests an hour:

```bash
GITHUB_TOKEN=$(gh auth token) npm run tool -- fetch --out .workspace/.snapshot
```

### `build` — build the dataset

```bash
npm run tool -- build --snapshot .workspace/.snapshot --dataset .workspace/dataset [--report report.md]
```

Reads the snapshot, the corrections, the contributions and the registry of the
dataset folder, and replaces its `wh40k-11e/` and `registry/` with the result.
`--report` writes the drift report against the previous files. If the result
contains rules text, **nothing is written** and the findings are printed.

### `check` — verify a dataset

```bash
npm run tool -- check --dataset .workspace/dataset
```

Schema and no-rules-text, over every JSON file of the folder. Exit code 1 on
any finding. This is what the dataset's CI runs.

### `release` — publish a release

```bash
npm run tool -- release --dataset .workspace/dataset --dataslate mfm-1-5
```

| Option | Meaning |
|---|---|
| `--dataslate <id>` | the dataslate, confirmed. **Without it, the command only prints the one it proposes and stops** |
| `--dataslate-name <name>` | its display name, for a new dataslate (default `MFM <version>`) |
| `--mfm-version <x.y>` | the MFM this dataset applies, when it is ahead of the sources |
| `--release-url <url>` | where releases are served, with `{tag}` in it. Required for the very first release, kept afterwards |
| `--same-mfm` | open a new dataslate on an MFM version that already has one |

It checks, writes the manifest, commits and tags. It does **not** push:
`git push --follow-tags` is yours to run.

### `repoint` — roll back

```bash
npm run tool -- repoint --dataset .workspace/dataset [--current <dataslate>] [--release <tag> [--dataslate <id>]]
```

See [Rolling back](#rolling-back).

### `gui` — the interface

```bash
npm run tool -- gui [--dataset <dir>] [--snapshot <dir>] [--port 4173] [--host <address>|tailscale] [--repo <url>] [--allow-push]
```

`npm run dev` is this command.

| Option | Meaning | Default |
|---|---|---|
| `--dataset <dir>` | the dataset folder | `.workspace/dataset` |
| `--snapshot <dir>` | the snapshot folder | `.workspace/.snapshot` |
| `--port <n>` | the port to listen on | `4173` |
| `--host <address>` | a private address to listen on; `tailscale` reads your tailnet address. Public addresses are refused | this machine only |
| `--repo <url>` | the dataset repository **Update data** clones | `https://github.com/PaintPlanPlay/dataset.git` |
| `--allow-push` | let the interface push and open pull requests | off |

### Tests

```bash
npm test          # builds from a small frozen snapshot in test/fixtures
npm run typecheck
```
