# How it works

This page explains the ideas behind the tool. You do not need it to fix a
points cost — [Getting started](getting-started.md) is enough for that — but it
makes everything else in the documentation easier to follow.

## The dataset is built, not typed

The dataset describes about forty armies and thousands of units. Typing that by
hand would be slow and full of mistakes, and three community projects already
publish most of it. So the dataset is **built**: a program reads those
projects, combines them, and writes the files.

```
 upstream sources                the dataset repository                 the apps
┌──────────────────┐            ┌───────────────────────┐
│ BSData           │            │ corrections/          │  written by people,
│ MFM (via BSData) │──┐         │ authored/             │  through the tool
│ 40kdc-data       │  │         ├───────────────────────┤
└──────────────────┘  ├─build──▶│ wh40k-11e/            │  written by the build,
                      │         │ registry/             │  never by hand
   corrections/  ─────┤         ├───────────────────────┤
   authored/     ─────┘         │ manifest.json         │──release──▶ read by the apps
                                └───────────────────────┘
```

Two things follow, and they are the heart of the project:

- **You never edit the built files.** Anything written into `wh40k-11e/` by
  hand is erased by the next build.
- **What people write is kept apart**, in `corrections/` and `authored/`, and
  applied again by every build. A fix survives every update of the sources.

## The three sources, and who is trusted for what

Each source is good at something. When two of them disagree, the one trusted
for that field wins, and the disagreement is reported so a human can look at it.

| Source | What it is | Trusted for |
|---|---|---|
| [BSData](https://github.com/BSData/wh40k-11e) | the community data files behind army builders | unit profiles, weapons, wargear options, keywords, abilities (by name), unit composition, the weapon an enhancement brings |
| [Munitorum Field Manual, via BSData](https://github.com/BSData/wh40k-11e-mfm) (MFM) | the points document, transcribed | points and their bands, paid wargear, leader and support attachments, which detachments exist, their detachment points, force dispositions, which enhancements exist and their points |
| [40kdc-data](https://github.com/wn-mitch/40kdc-data) | a structured database of detachments and stratagems | which detachment rules and stratagems exist, their CP, phases, timing and targets, enhancement restrictions |
| this project | — | what a rule does (Modifiers, descriptions), battle sizes, ally rules, default targets, the sample list |

Field by field, this is what the sheet headers of the interface show:

| Sheet | Field | Source |
|---|---|---|
| Unit | name, Legends flag, keywords, faction keywords, army rules, models and their characteristics, composition, weapons, wargear options, default loadout | BSData |
| Unit | prices (`pricing`), Assigned Agent prices, paid wargear lines, units led, units supported | MFM |
| Unit | base points and cost brackets | derived from the MFM prices; BSData when the unit is not in the MFM |
| Unit | what each ability does | this project |
| Detachment | name, detachment points, force dispositions, unique tag | MFM |
| Detachment | enhancements: existence, points, units they open Leader or Support for | MFM |
| Detachment | enhancements: name, unit or character, aura, how many units, required and excluded keywords | 40kdc-data |
| Detachment | enhancements: the weapon one brings | BSData |
| Detachment | what each detachment rule and enhancement does | this project |
| Stratagem | name, CP, phases, whose turn, timing, category, target | 40kdc-data |
| Stratagem | what it does | this project |
| Army rule | name | BSData |
| Army rule | what it does | this project |
| Core | core stratagems | 40kdc-data |
| Core | battle sizes, ally rules | this project |

An enhancement's weapon belongs to the enhancement, never to the datasheets
that may take it: BSData lists it in a shared `Enhancements` group that every
character links to, and the build does not follow that group into the
datasheet. Crusade weapons, from the shared `Crusade` group, are left out
altogether: the Dataset does not cover Crusade.

Two consequences worth knowing:

- **The MFM decides what exists** among detachments and enhancements. A
  detachment only 40kdc-data knows about does not enter the dataset; it is
  listed in the build report as "set aside".
- A unit absent from the MFM — usually Legends — keeps the cost BSData gives it.

## What a build does, in order

1. **Read BSData.** Each playable army's catalogue becomes a list of units,
   including the units it may field from other catalogues.
2. **Apply the MFM** over it: prices, paid wargear, attachments. The base cost
   and the cost brackets are computed from the price grid.
3. **Build detachments and stratagems** from the MFM and 40kdc-data, matched by
   name.
4. **Apply the corrections** from `corrections/`.
5. **Add what the project writes**: battle sizes, ally rules, default targets
   and the sample list go into `core.json`; then the contributions of
   `authored/…/effects.json` put Modifiers and descriptions on the rules.
6. **Link paid wargear** to the wargear options that it bills.
7. **Check for rules text.** One finding and nothing is written.

The build never touches the network: it reads a **snapshot**, a frozen copy of
the three sources taken by **Update data** (or `fetch`). The same snapshot
always gives the same dataset.

## Corrections: fixing a source

A source can be wrong, or simply late — a new Munitorum Field Manual comes out
on a Wednesday and its transcription follows a few days later. A **correction**
is a small file that says:

- **what** it fixes (a unit, a weapon, an enhancement…),
- **which source** it overrides,
- the **new values**, and only those,
- what the source **said at the time**,
- and **why**, in one sentence.

Because a correction remembers what the source said, every build can tell
whether it is still needed:

| State | Meaning | What to do |
|---|---|---|
| **active** | the source still says what it said: the correction is still needed | nothing |
| **stale** | the source now agrees with the correction | delete the correction |
| **in conflict** | the source moved to a *third* value | a human decides: keep, change or delete |
| **orphaned** | the element it fixes no longer exists | review it — it applies to nothing |

This is why a correction is better than editing a number: the day the source
catches up, the tool tells you the correction can go.

## Contributions: what only this project writes

Some things no source publishes: what a rule *does*, in a form an app can
simulate; the battle sizes; the ally rules. These are **contributions**. They
are not fixes waiting for a source to catch up — they are ours for good.

You never choose between a correction and a contribution. You edit a field on a
sheet; the field's domain decides. Changing a cost writes a correction against
the MFM; describing what an ability does writes a contribution.

One guard remains: 40kdc-data also publishes its own reading of what rules do.
It is never published in the dataset, but when it changes after we wrote ours,
the contribution is flagged *upstream changed* so someone can compare the two.
Ours stays applied.

[Corrections and contributions](corrections-and-contributions.md) describes the
files themselves.

## Identifiers that never change

An army list saved in an app refers to units and detachments by identifier. If
an identifier changed with every update, every saved list would break.

- A **unit** keeps its BSData identifier as it is: `e3b1-1240-2476-cd86`.
- **Everything else** — armies, detachments, enhancements, rules, stratagems —
  gets a readable identifier made from its name the first time it is seen:
  `orks`, `blitz-brigade`, `targetin-gizmos`.

Those identifiers are remembered in the **registry**
(`registry/wh40k-11e.json`), next to the keys by which each source knows the
entity. The next build reads the registry and gives the same identifier to the
same entity, even if a source renamed it. An identifier nobody claims any more
stays reserved, and comes back if the entity reappears.

The registry is written by the build. Do not edit it.

## Releases and dataslates

Merging a pull request does not change what players see. The apps read
**releases**: a release is a frozen, tagged state of the dataset repository,
never rewritten once published.

Releases are grouped into **dataslates** — a rules period, named after the
Munitorum Field Manual version it follows (`MFM 1.5`, identifier `mfm-1-5`).

```
dataslate mfm-1-5   (current)   releases r1, r2, r3 ← the apps read r3
dataslate mfm-1-4   (frozen)    releases r1 … r10
```

- A fix within a rules period is a new release in the same dataslate.
- A new Munitorum Field Manual opens a new dataslate, and **freezes** the
  previous one: no more releases there, but its releases stay readable.
- An army list can follow the current dataslate, or stay pinned to an older one
  — useful for a tournament list submitted before an update. The apps offer
  the current dataslate and the two before it.

The **manifest** (`manifest.json`, at the root of the dataset repository) is
what an app reads first: the list of dataslates, their releases, and which
release to read for each. It is the only file that changes without a new
release — rolling back is pointing it at an earlier release.

[Maintaining the dataset](maintaining.md) covers publishing and rolling back.

## The no-rules-text guard

The dataset may hold numbers, names and structure. It may not hold rules text,
copied or reworded. This is checked by a program, at four moments: while you
type in the interface, when you save, at every build, and on every pull request.

It looks for three things, in every file:

- a **key that announces text**: `text`, `description`, `flavour`, `lore`…
- **long prose**: a value over 30 words or 240 characters. A one-line
  description (`summary`) is held to 160 characters;
- **phrasing typical of rules**, even in a short sentence: "each time",
  "until the end of the…", "add 1 to the…", "re-roll the…", "roll one D6",
  "this unit can…", "you can select…", "in your Shooting phase", "within 6" of",
  "Hit roll of 6"…

So a description such as `+1 to hit in melee while riled up` passes, and a
sentence lifted from a datasheet does not. The reason you give when saving goes
through the same check.

When the guard refuses something, it names the field and the reason. Rephrase
in your own short words, or leave the rule with its name only — that is always
allowed.

## Where things live on your machine

```
dataset-tool/
├── .workspace/
│   ├── dataset/          your copy of the dataset repository (a git clone)
│   │   ├── corrections/      ← the tool writes your corrections here
│   │   ├── authored/         ← and your contributions here
│   │   ├── wh40k-11e/        ← rebuilt by Save & Build
│   │   ├── registry/
│   │   └── manifest.json
│   └── .snapshot/        the frozen copy of the three sources
└── …                     the tool itself
```

Your **pending changes** are simply the files of `corrections/` and `authored/`
that differ from the last published state of that clone. Proposing commits
them to a branch and opens a pull request; undoing one restores the published
file.
