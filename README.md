# Dataset Tool

The program that builds the [Paint Plan Play Dataset](https://github.com/PaintPlanPlay/dataset):
open data about Warhammer 40,000 units, detachments, enhancements and
stratagems — **with no rules text in it**.

It also gives you a small web interface, on your own machine, to look at where
every value comes from and to fix the ones that are wrong. **You never have to
read or write code to fix a number.**

## Who this is for

| You are… | Start here |
|---|---|
| a player who spotted a wrong number (points, a weapon profile, a keyword) | [Getting started](docs/getting-started.md), then [Recipes](docs/recipes.md) |
| someone who wants to describe what a rule does, so the apps can simulate it | [Rules and Modifiers](docs/rules-and-modifiers.md) |
| curious about how the whole thing works | [How it works](docs/how-it-works.md) |
| a maintainer of the dataset | [Maintaining the dataset](docs/maintaining.md) |
| a developer reading the data in an app, or working on this tool | [Schema reference](docs/schema.md), then *For developers* below |

## The idea in one minute

Nobody types the dataset by hand. Three community projects already publish most
of it, and the tool **builds** the dataset from them:

```
BSData ─────────┐
MFM (via BSData)├──▶  Dataset Tool  ──▶  a pull request  ──▶  a release
40kdc-data ─────┘      (builds it)       (reviewed by a human)  (apps read it)
        ▲
        └── plus what this project writes itself: corrections and contributions
```

When a source is wrong or late — a new Munitorum Field Manual, a codex BSData
has not caught up with — you do not edit the dataset files. You record a small
**correction** ("this cost is 85, not 90, because…"), and every future build
applies it again, until the source fixes itself. What no source publishes at
all — what a rule *does*, battle sizes, ally rules — is a **contribution**,
owned by this project.

You do all of that by filling in a form. The tool decides which file to write.

## Quick start

You need [Node.js](https://nodejs.org) 24 or newer, [git](https://git-scm.com),
and — to send your changes — a GitHub account and the
[GitHub CLI](https://cli.github.com) (`gh auth login`, once).

```bash
git clone https://github.com/PaintPlanPlay/dataset-tool.git
cd dataset-tool
npm ci
npm run dev -- --allow-push
```

Open `http://127.0.0.1:4173` in your browser (a desktop screen, at least 1200
pixels wide). The interface starts **empty**: click **Update data** and it
fetches everything it needs.

Never used a terminal? [Getting started](docs/getting-started.md) goes through
every step, from installing Node.js to your first pull request.

## Fixing a value, in five steps

1. Click **Update data**.
2. Search for the unit, detachment, stratagem or *Core*, and open it.
3. Change what is wrong, as many fields as you like.
4. Click **Save** and say why, in one sentence of your own.
5. Click **Save & Build**, then **Propose my change**.

A maintainer reviews the pull request and merges it; the fix reaches the apps
with the next release.

## Documentation

| Guide | What it covers |
|---|---|
| [Getting started](docs/getting-started.md) | installing, first launch, your first fix from start to finish |
| [How it works](docs/how-it-works.md) | the sources, who is trusted for what, what a build does, releases |
| [The interface](docs/interface.md) | every panel, button, dot and counter on the screen |
| [Recipes](docs/recipes.md) | "I want to…" — change points, fix a weapon, add an enhancement, write an ally rule… with the file each one produces |
| [Rules and Modifiers](docs/rules-and-modifiers.md) | describing what a rule does without copying it: keys, values, targets, conditions |
| [Corrections and contributions](docs/corrections-and-contributions.md) | the files the tool writes for you, and how to write them by hand |
| [Schema reference](docs/schema.md) | every file and every field of the dataset, with examples |
| [Maintaining the dataset](docs/maintaining.md) | reviewing, the daily update, the drift report, publishing a release, rolling back |
| [Troubleshooting](docs/troubleshooting.md) | greyed-out buttons, refused saves, push errors |
| [Glossary](docs/glossary.md) | the project's vocabulary |

## Where the numbers come from

| Source | Trusted for |
|---|---|
| [Munitorum Field Manual, via BSData](https://github.com/BSData/wh40k-11e-mfm) | points, requisition brackets, paid wargear, leader/support attachments, detachment points, force dispositions, enhancements |
| [40kdc-data](https://github.com/wn-mitch/40kdc-data) | which detachment rules and stratagems exist, their CP, timing and targets, enhancement restrictions |
| [BSData](https://github.com/BSData/wh40k-11e) | unit profiles, weapons, wargear options, keywords, the weapon an enhancement brings |
| this project | what a rule does (Modifiers and one-line descriptions), battle sizes, ally rules |

When sources disagree, the one trusted for that field wins and the disagreement
is reported. [How it works](docs/how-it-works.md) has the field-by-field table.

## The one rule: no rules text

A rule is carried by its Modifiers, by a one-line description written by this
project, or by its name alone — never by copied or reworded rules text. The
`check` command refuses any build or pull request that would introduce prose.
This is the legal footing of the project, not a style preference. Keep your
codex at hand: the dataset is numbers and references, not a rulebook.

## For developers

```bash
npm run tool -- fetch --out .workspace/.snapshot
npm run tool -- build --snapshot .workspace/.snapshot --dataset .workspace/dataset --report report.md
npm run tool -- check --dataset .workspace/dataset
npm run tool -- release --dataset .workspace/dataset [--dataslate <id>]
npm run tool -- repoint --dataset .workspace/dataset [--current <dataslate>]
npm run tool -- gui [--dataset <dir>] [--snapshot <dir>] [--port 4173]
npm test          # the build test point, on a frozen snapshot
npm run typecheck
```

Every command and option is described in
[Maintaining the dataset](docs/maintaining.md#command-line-reference).

The package is self-contained: it shares nothing with the apps except the
dataset schema, published from `schema/` (TypeScript types in
`schema/src/index.ts`, JSON Schema in `schema/dataset.schema.json`).

| Folder | What lives there |
|---|---|
| `schema/` | the contract between this tool and the apps: types, JSON Schema, validation |
| `src/bsdata/`, `src/upstream/` | reading the three sources |
| `src/build.ts` | the build: sources, then corrections, then contributions |
| `src/corrections/` | applying corrections, and telling whether each is still needed |
| `src/authored.ts`, `src/rules.ts` | what the project writes itself |
| `src/notext.ts`, `src/check.ts` | the no-rules-text guard and the `check` command |
| `src/release.ts` | releases, dataslates and the manifest |
| `src/gui/`, `ui/` | the local interface: its server and its React page |
| `test/` | tests, on a small frozen snapshot of the sources |

### Running the interface for another machine

The interface has **no authentication** — network access is what protects it. By
default it listens on this machine only. `--host <address>`, or `--host tailscale`
which reads your tailnet address, opens it to a private network when the dataset
lives on a remote box. Public addresses are refused, and any request whose host
or origin is not the listening address gets a 403.

`--allow-push` lets the interface push and open pull requests on your behalf;
without it, **Propose my change** and **Publish Release** stay greyed out.

## Licence

Code under [MIT](LICENSE). The [dataset](https://github.com/PaintPlanPlay/dataset)
it produces is published separately under CC BY 4.0.

**Warhammer 40,000** and the names related to it are trademarks of **Games
Workshop Limited**. This project is neither affiliated with nor endorsed by Games
Workshop, and the game content is not licensed by us.
