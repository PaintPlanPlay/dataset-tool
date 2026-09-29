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
- the [GitHub CLI](https://cli.github.com), if you want the interface to push
  and open the pull request for you. Run `gh auth login` once and you are set:
  GitHub has not accepted a password for git since 2021, and the interface
  borrows that login rather than asking you for one

## Quick start

```bash
git clone https://github.com/PaintPlanPlay/dataset-tool.git
cd dataset-tool && npm ci
npm run dev
```

Open `http://127.0.0.1:4173` in your browser (a desktop screen, at least 1200
pixels wide). The interface starts **empty** and offers to fetch what it needs —
you do not have to download anything by hand.

Everything it downloads lives in `.workspace/`, inside this folder. Deleting that
folder resets you to a clean slate.

## The interface

The screen has two columns. **You never see JSON**: every part of the dataset
schema is drawn as a form — an object is a card, a list has **+** and **−**
buttons, a choice between kinds of rule node is a menu that shows the right
fields once you pick one.

**On the left, the state of your copy:**

- the versions you are working from: the dataset release, the dataslate, BSData
  and the Munitorum Field Manual;
- whether your sources are **up to date** (green) or not (red) against the
  latest commit of each source;
- how many corrections the dataset carries, how many disagreements between
  sources the build noticed, and how many suggested effects wait for review —
  click the first two to see them;
- your **pending changes**: everything you saved and have not proposed yet.
  Click one to open its sheet, or **−** to undo it;
- the pull request you opened, and whether it is in review or merged;
- the buttons, each greyed out with the reason when it cannot run yet.

| Button | What happens |
|---|---|
| **Update data** | brings everything up to date: the dataset as published, and a fresh snapshot of BSData, the Munitorum Field Manual and 40kdc-data. Takes a few minutes; greyed out when you are already up to date. Your pending changes are kept, and re-checked against the new sources |
| **Save & Build** | builds the dataset files with your pending changes, then checks them. Open when something is pending, or when the dataset files come from an earlier version of the tool: after updating the tool, rebuild and propose them so the apps get what it now builds |
| **Propose my change** | opens a pull request with your pending changes. Only open after a build that passed the check, for exactly what is pending |
| **Publish Release** | shown to maintainers only, open once a merged pull request is not yet published: takes it in, freezes the dataset under a tag, and pushes it |
| **Check** | verifies the files against the schema and the no-rules-text rule. It already runs before a release and on every pull request |

Each task streams its log as it runs, and only one runs at a time.

**On the right, the sheet you are editing:** a search box across every army —
units, detachments, stratagems and the *Core* entry (battle sizes and core
stratagems), each result with its army, and an army filter your browser
remembers. Next to it, the sheet's name, **Corrections (n)** and **Save**.

On the sheet, each section says where its values come from (*Prices · MFM*,
*Weapons · BSData*, *Abilities · project*). An **orange** dot marks a value you
changed and did not save yet; a **blue** dot, a value a published correction or
contribution changed — hover it for the upstream value, the new value and the
reason. Values the build derives — a unit's base points and cost brackets from
its price grid, its model counts from its composition, a weapon's range in
inches — are shown, not typed. Every edit is checked as you type: against the
schema, and against the no-rules-text rule.

## Fixing a value, step by step

1. Click **Update data**.
2. Search for the unit, detachment, stratagem or *Core*, and open it.
3. Change what is wrong, as many fields as you like: a characteristic, a cost in
   the price grid, a keyword, a weapon profile, an option, a leader attachment.
4. Click **Save** and give one sentence saying why. The tool works out what
   changed and writes one **correction** per element and per source it belongs
   to — or a **contribution** for an effect or a summary, which we own
   outright (see below): its Modifiers, Options, eligibility or description. File names are made up for you, and nothing is written
   if anything is refused: the offending field is pointed out.
5. Click **Save & Build**, then **Propose my change** to open a pull request.

Leaving a sheet with unsaved edits asks whether to save, discard or stay.
**Corrections (n)** lists what is applied to the open sheet, with its state:
*active*, *stale* (the source now agrees, it can go), *in conflict* (the source
moved to a third value). Deleting one is itself a pending change, proposed and
reviewed like any other; you can still undo it until then. From there you can
also open a prefilled issue with the source, so it fixes itself, and paste the
link it gives you.

**Corrections and contributions.** A value that BSData or the Munitorum Field
Manual publishes — a profile, a cost, a keyword, an option — is fixed with a
correction, re-checked against that source on every update and dropped once the
source agrees. An effect or a one-line summary is a **contribution**: ours for
good. So is anything no source has yet — a wargear option BSData lacks — and
what we say about a wargear option (see below). If 40kdc-data later changes the
same rule, the change is flagged in the build report and on the sheet, never
applied over ours. You never choose between the two: the field decides.

### Wargear costs

The Munitorum Field Manual bills wargear by name (`Twin Killsaws: 5`); BSData
describes wargear options (`Meganob w/ Twin Killsaw`). A **wargear option**
carries the MFM line that bills it, and how many times per model (2 for
« 2 Multi-meltas »); the amount stays in the unit's MFM `wargear` list, the only
source of points. After the MFM and the corrections, the build links a line to
the **one non-default option** whose name matches — case, accents, plurals, a
« 2 X » prefix, the « … w/ X » form, or a weapon of the option. Anything else
is listed in the build report and on the unit sheet: a line no option matches,
one several options match, one only a default option matches (a default option
may well be paid: the Exterminator's hull lascannon is), and a hand-set link
whose line is gone.

On the unit sheet, each option card shows its MFM line, its quantity, the
resulting amount (read from the line, never typed), and the abilities of the
unit it brings — active only for the models that take it. Setting any of them
is a contribution, which wins over the automatic link, unlinking included.
**+ option · Contribution** adds an option BSData does not have (a banner). The
MFM `wargear` list at the top of the sheet says which option each line bills,
and stays a correction field: when the official app contradicts the MFM (a
free Killsaw), correct the line. On a detachment sheet, an enhancement can
bring a **weapon**, taken from a weapon of the army as upstream describes it or
described with its profiles.

A maintainer reviews the pull request and merges. Publishing what was merged is
one button, **Publish Release**.

### Rules and Modifiers

Every rule — army rule, detachment rule, stratagem, enhancement, unit or
wargear ability — has the same shape: a name, a one-line **description** in our
own words, and its **Modifiers**. A Modifier is one change the rule makes: a
`key` (`hit`, `A`, `AP`, `feel-no-pain`…), an optional `value` (`1`, `D3`, `5+`,
`all`), a `target` (`self`, `attached`, `aura` with a range, `enemy`) with an
optional keyword filter, and the `conditions` under which it applies (`melee`,
`target-keyword`, or a situation such as `waaagh`). A rule offering a choice
carries **Options**, each with its own Modifiers. The rule sheet edits them all
the same way; keys autocomplete, simulated ones first. A key the simulator does
not play is still accepted, and listed under **Unsimulated keys** until the
entry or the simulator is fixed.

One key changes the unit itself rather than an attack: `gain-keyword`, whose
value is a keyword. On a detachment rule whose eligibility picks the units
(`Gretchin`), `{ key: gain-keyword, value: Battleline, target: self }` makes
them Battleline for every list that takes the detachment — the unit limit
included. It is known, never listed as unsimulated.

No 40kdc-data Effect is published any more. Modifiers are read once from the rules outside this repository and
imported from **To review → Import extracted Rules…**: each one is compared to
40kdc-data's reading. Readings that agree are accepted; the others — they differ,
or ours is the only one — wait in **To review** for you to validate, side by
side. An import never replaces what you wrote or reviewed by hand.

Core rules (Feel No Pain 5+, Deep Strike, Lone Operative…) are not rules here:
they become status Modifiers on the unit. Army rules are stored once per army
and have their own sheet.

## Where the numbers come from

| Source | Trusted for |
|---|---|
| [Munitorum Field Manual, via BSData](https://github.com/BSData/wh40k-11e-mfm) | points, requisition brackets, paid wargear, leader/support attachments, detachment points, force dispositions, enhancements |
| [40kdc-data](https://github.com/wn-mitch/40kdc-data) | which detachment rules and stratagems exist, their CP, timing and targets, enhancement restrictions; its Effects are only a second reading, to review ours against |
| [BSData](https://github.com/BSData/wh40k-11e) | unit profiles, weapons, wargear options, keywords |

When sources disagree, the one trusted for that field wins and the disagreement
is reported. What a rule does is written in this project's own Modifiers,
never taken from a source.

A unit that must be its army's warlord (Ghazghkull Thraka, The Silent King…)
is published with `supremeCommander: true`, read from its BSData ability named
"Supreme Commander" — never from the `Warlord` keyword, which BSData also puts
on Boyz or a Rhino. A unit BSData gets wrong is fixed by correcting the ability
itself, adding or removing it.

## The one rule: no rules text

A rule is carried by its Modifiers, by a one-line description written by this
project, or by its name alone — never by copied or reworded rules text. The `check`
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
