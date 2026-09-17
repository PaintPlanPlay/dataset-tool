# Dataset Tool

The program that builds the [Paint Plan Play Dataset](https://github.com/PaintPlanPlay/dataset):
open data about Warhammer 40,000 units, detachments, enhancements and
stratagems — **with no rules text in it**.

It also gives you a small web interface, on your own machine, to look at where
every value comes from and to fix the ones that are wrong.

## Who this is for

- **You want to fix a wrong number** (a points cost, a weapon profile) and you
  are not a developer → start at *Quick start*, then *Fixing a value*. You will
  not have to write code.
- **You maintain the dataset** → the same interface publishes releases.
- **You want to work on the tool itself** → see *For developers* at the end.

## Before you start

- [Node.js](https://nodejs.org) 24 or newer
- [git](https://git-scm.com)
- a GitHub account, if you want to propose your changes

## Quick start

```bash
git clone https://github.com/PaintPlanPlay/dataset-tool.git
cd dataset-tool && npm ci
npm run dev
```

Open `http://127.0.0.1:4173` in your browser. The interface starts **empty** and
offers to fetch what it needs — you do not have to download anything by hand.

Everything it downloads lives in `.workspace/`, inside this folder. Deleting that
folder resets you to a clean slate.

## What the buttons do

The interface is currently in French, so the buttons are quoted below as they
appear on screen.

| Button | What happens |
|---|---|
| **Récupérer le Dataset** | downloads the dataset repository (or updates it if it is already there) |
| **Instantané des sources** | downloads BSData, the Munitorum Field Manual and 40kdc-data at a fixed point in time. Takes a few minutes and is **optional** — see below |
| **Construire le Dataset** | rebuilds the dataset from that snapshot, applying every correction |
| **Contrôler** | verifies the files against the schema and the no-rules-text rule |
| **Publier une Release** | freezes the dataset under a tag and updates the manifest the apps read |
| **Proposer mes changements** | opens a pull request with what you wrote |

Each task streams its log as it runs, and only one runs at a time.

**The snapshot is optional.** Without it you can still read and correct the
published dataset; the *Origin* column then just says `published` instead of
naming the source a value comes from. That is the quick path when you need to
fix a number and do not want to download all of BSData.

## Fixing a value, step by step

1. Click **Récupérer le Dataset**.
2. Type a name in the search box — a unit, a detachment, a stratagem — and click
   the result.
3. The sheet lists every field with its **origin**: `bsdata`, `mfm`, `40kdc`,
   `analysis` (a suggestion computed by this tool), `project` (written by us), or
   `correction` with the file that changed it.
4. Fill in the *New correction* form. The army, the target and the current
   upstream value are filled in for you; you provide the corrected value and a
   one-sentence reason.
5. Click **Écrire la Correction**. The file is created, checked, and the sheet
   reloads so you can see your change applied.
6. Click **Proposer mes changements** to open a pull request — or copy the git
   commands it prints and run them yourself.

You can also review the suggestions this tool computes for abilities that have
no structured effect yet, and accept the ones that look right.

## Where the numbers come from

| Source | Trusted for |
|---|---|
| [Munitorum Field Manual, via BSData](https://github.com/BSData/wh40k-11e-mfm) | points, requisition brackets, paid wargear, leader/support attachments, detachment points, force dispositions, enhancements |
| [40kdc-data](https://github.com/wn-mitch/40kdc-data) | detachment rules, enhancement restrictions, stratagems and their targets, Effects |
| [BSData](https://github.com/BSData/wh40k-11e) | unit profiles, weapons, wargear options, keywords |

When sources disagree, the one trusted for that field wins and the disagreement
is reported. The Effect format is 40kdc-data's own, adopted as-is at a pinned
version (their schemas are vendored under `schema/vendor/`).

## The one rule: no rules text

A rule is carried by its Effect, by a one-line summary written by this project,
or by its name alone — never by copied or reworded rules text. The `check`
command refuses any build or pull request that would introduce prose. This is the
legal footing of the project, not a style preference.

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

The package is self-contained: it shares nothing with the apps except the
dataset schema, published from `schema/`.

### Running the interface for another machine

The interface has **no authentication** — network access is what protects it. By
default it listens on this machine only. `--host <address>`, or `--host tailscale`
which reads your tailnet address, opens it to a private network when the dataset
lives on a remote box. Public addresses are refused, and any request whose host
or origin is not the listening address gets a 403.

`--allow-push` lets the interface push and open pull requests on your behalf;
without it, it only prints the commands for you to run.

## Licence

Code under [MIT](LICENSE). The [dataset](https://github.com/PaintPlanPlay/dataset)
it produces is published separately under CC BY 4.0.

**Warhammer 40,000** and the names related to it are trademarks of **Games
Workshop Limited**. This project is neither affiliated with nor endorsed by Games
Workshop, and the game content is not licensed by us.
