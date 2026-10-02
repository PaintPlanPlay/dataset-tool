# Corrections and contributions

These are the files people write — almost always through the interface, which
names and checks them for you. This page describes them precisely, for when you
read one in a pull request, or write one by hand.

They live in the [dataset repository](https://github.com/PaintPlanPlay/dataset):

```
corrections/wh40k-11e/<army>/<name>.json     one file per correction
authored/wh40k-11e/effects.json              every contribution about a rule or a wargear option
authored/wh40k-11e/battle-sizes.json         battle sizes
authored/wh40k-11e/ally-rules.json           ally rules
authored/wh40k-11e/reference-targets.json    default targets of the simulation
authored/wh40k-11e/sample-list.json          the sample list
```

If you have never read JSON: it is text made of `"name": value` pairs between
braces `{ }`, separated by commas; lists sit between brackets `[ ]`; text values
are in double quotes. A missing comma or quote makes the file unreadable, and
the checks say so.

## Corrections

A correction overrides what one source says about one element.

```json
{
  "target": "orks::enhancement:blitz-brigade|targetin-gizmos",
  "source": "mfm",
  "patch": { "points": 25 },
  "upstream": { "points": 10 },
  "reason": "MFM 1.5 raises this enhancement to 25 points."
}
```

| Field | Required | What to put in it |
|---|---|---|
| `target` | yes | the address of what you are fixing — see below |
| `source` | yes | the source being overridden: `bsdata`, `mfm` or `40kdc` |
| `patch` | yes | the corrected values, and only those. At least one |
| `upstream` | recommended | what the source says today, for the same fields. It is what lets a later build tell whether the source has fixed itself |
| `reason` | yes | one sentence, in your own words, 240 characters at most |
| `upstreamPr` | no | the link to the pull request opened with the source: `https://github.com/<owner>/<repo>/pull/<number>` |

### Which source?

The source that is trusted for the field
([How it works](how-it-works.md#the-three-sources-and-who-is-trusted-for-what)
has the full table):

| You are fixing | `source` |
|---|---|
| a characteristic, a weapon, a keyword, an ability's presence, composition, wargear options, the weapon an enhancement brings | `bsdata` |
| a price, paid wargear, a leader or support attachment, a detachment's points or dispositions, an enhancement's points | `mfm` |
| a stratagem's CP, phases, timing or target; an enhancement's restrictions | `40kdc` |

### Targets

A target is an address: where the element is, then what it is.

| Element | Target | Example |
|---|---|---|
| a unit | `<unitId>` | `e3b1-1240-2476-cd86` |
| a model of a unit | `<unitId>::model:<name>` | `e3b1-1240-2476-cd86::model:Nob` |
| a weapon | `<unitId>::weapon:<kind>\|<name>` | `e3b1-1240-2476-cd86::weapon:melee\|Power Klaw` |
| an ability | `<unitId>::ability:<name>` | `e3b1-1240-2476-cd86::ability:Leader` |
| an attachment | `<unitId>::attachment:<leader or support>\|<unit name>` | `80c4-14b2-d02d-d289::attachment:leader\|Meganobz` |
| a detachment | `<armyId>::detachment:<detachmentId>` | `orks::detachment:blitz-brigade` |
| an enhancement | `<armyId>::enhancement:<detachmentId>\|<enhancementId>` | `orks::enhancement:blitz-brigade\|targetin-gizmos` |
| a stratagem | `<armyId>::stratagem:<stratagemId>` | `orks::stratagem:ere-we-go` |
| a core stratagem | `core::stratagem:<stratagemId>` | `core::stratagem:command-re-roll` |

Notes:

- `<kind>` is `ranged` or `melee`.
- Models, weapons and abilities are addressed **by name**, exactly as written
  in the dataset, capitals and punctuation included. Names survive the sources'
  updates; their internal identifiers do not.
- A weapon is always targeted **whole**, never one of its profiles.
- A unit that several armies can field has one identifier: its correction
  applies wherever that datasheet appears.

**Finding an identifier.** Unit identifiers are the dashed strings in
`wh40k-11e/armies/<army>.json` — search the file for the unit's name; the `id`
is just above it. Army, detachment, enhancement and stratagem identifiers are
readable (`orks`, `blitz-brigade`) and sit in the same file. The interface
fills all of them in for you.

### What a patch may hold

A patch replaces the fields it names and leaves the others alone. A field that
is a list or a grid is replaced **whole**: to change one cost of a price grid,
the patch holds the whole grid.

| Target | Fields a patch may force |
|---|---|
| unit | `name`, `isLegends`, `ally`, `keywords`, `factionKeywords`, `armyRules`, `composition`, `optionGroups`, `defaultLoadout` (source `bsdata`) · `pricing`, `assignedPricing`, `wargear` (source `mfm`) |
| model | `M`, `T`, `Sv`, `Inv`, `W`, `LD`, `OC` |
| weapon | `profiles` (all of them), `maxCarriers` |
| ability | presence only — `__add`, `__delete` — or `name` to rename it. Never text |
| attachment | presence only — `__add`, `__delete` |
| detachment | `name`, `dp`, `forceDispositions`, `uniqueTag` |
| enhancement | `name`, `points`, `appliesTo`, `aura`, `maxTargets`, `requires`, `excludes`, `leaderTo`, `supportTo`, `weapon` (whole) |
| stratagem | `name`, `cp`, `phases`, `playerTurn`, `timing`, `category`, `target` |

The meaning and format of each field is in the [Schema reference](schema.md).

**Derived values are not corrected.** A unit's `points` and `costBrackets`
follow its `pricing`; its `minModels` and `maxModels` follow its `composition`;
a weapon profile's `rangeInches` follows its `range`. Correct the price grid,
the composition or the range, and the rest follows.

What a rule *does* — Modifiers, a summary — is never in a correction: it is a
[contribution](#contributions).

### Adding and removing

Two special fields in `patch` create or remove the element itself:

| Patch | Effect |
|---|---|
| `"__add": true` | create the element the target names; the other fields of the patch are its values |
| `"__delete": true` | remove it |

```json
{
  "target": "494b-11ce-5af-5b50::weapon:ranged|Da Krunch",
  "source": "bsdata",
  "patch": { "__delete": true },
  "reason": "This datasheet does not carry that weapon."
}
```

They work for models, weapons, abilities, attachments, detachments and
enhancements. Two particular cases:

- `__delete` on a **unit** does not remove it: the unit is marked Legends with
  a cost of 0, so that saved lists that include it keep working;
- a **stratagem** can be removed, not added.

### How a build judges a correction

Each build compares three values: what the source said when the correction was
written (`upstream`), what it says today, and what the correction forces
(`patch`).

| The source today says… | State | Note in the report |
|---|---|---|
| the same as `upstream` | **active** | still needed |
| the same as `patch` | **stale** | the source caught up: delete the correction |
| something else | **in conflict** | the source moved to a third value: decide |

For `__add`, the correction is stale once the source has the element; for
`__delete`, once the source no longer has it.

A correction whose target cannot be found at all is **orphaned**. It is never
silently ignored: it is listed in the build report.

Without `upstream`, the build cannot tell a conflict from a still-needed
correction, and reports it as active for as long as the source differs. Always
record it.

### Writing a correction by hand

You can create a correction on the GitHub website, with nothing installed.

1. Go to <https://github.com/PaintPlanPlay/dataset> and browse to
   `corrections/wh40k-11e/<army>/` (for example `corrections/wh40k-11e/orks/`).
2. Click **Add file → Create new file**.
3. Name it after what it fixes, ending in `.json`:
   `boyz-unit-mfm.json`. The interface names files
   `<unit or detachment>-<element>-<source>.json`; any name works.
4. Paste a correction and adapt it. Start from the closest example in
   [Recipes](recipes.md).
5. Click **Commit changes…**, then follow GitHub through **Propose changes**
   and **Create pull request**.

Checks then run on your pull request. If one fails, open its details: it names
the file and what is wrong.

The folder a correction sits in is for tidiness — the target decides what it
applies to. Core stratagems go in `corrections/wh40k-11e/core/`.

## Contributions

Contributions are what the project writes itself. They do not override a
source, so they have no `source` and no state to watch — with one exception,
below.

### `effects.json`: rules and wargear options

One list, one entry per target, sorted by target.

```json
[
  {
    "target": "7067-34f4-5272-e05f::ability:Krumpin’ Time",
    "modifiers": [
      { "key": "hit", "value": 1, "target": "self",
        "conditions": [{ "key": "melee" }, { "key": "riled-up" }] }
    ],
    "summary": "+1 to hit in melee while riled up",
    "reason": "Describe the Meganobz abilities.",
    "upstream": "bf21a9e8fbc5"
  }
]
```

| Field | For | Meaning |
|---|---|---|
| `target` | all | the address — see below |
| `reason` | all | one sentence, in your own words. Required |
| `modifiers` | a rule | what the rule does. See [Rules and Modifiers](rules-and-modifiers.md) |
| `options` | a rule | for a rule that offers a choice: at least two options, each with a name and Modifiers |
| `summary` | a rule | one line, 160 characters at most, in your own words |
| `eligibility` | a detachment rule | the units that benefit, as a keyword filter |
| `weapon` | an enhancement | the weapon the enhancement brings to its bearer. It wins over the one BSData gives; removing it falls back to BSData's |
| `wargearCost` | a wargear option | the MFM line that bills the option: `{ "item": "Lascannon" }`, with `"quantity": 2` when it is paid twice per model. `null` removes an automatic link |
| `abilities` | a wargear option | abilities of the unit, by name, that the option brings |
| `option` | a wargear option | a whole option BSData does not have: `name`, `weapons`, `maxCarriers`, `isDefault`, optionally `perModels` |
| `review` | a rule | set by the tool for imported readings: `concordant`, `divergent`, `seul` (ours is the only reading), `revu` (reviewed by a human) |
| `upstream` | a rule | set by the tool: a fingerprint of 40kdc-data's own reading when the entry was written |

A rule entry needs at least one of `modifiers`, `options`, `summary` or
`eligibility`. A wargear option entry carries only `wargearCost`, `abilities`
or `option`.

**Targets of contributions**

| Element | Target |
|---|---|
| a unit ability | `<unitId>::ability:<name>` |
| a detachment rule | `<armyId>::rule:<detachmentId>\|<ruleId>` |
| an enhancement | `<armyId>::enhancement:<detachmentId>\|<enhancementId>` |
| a stratagem | `<armyId>::stratagem:<stratagemId>` |
| a core stratagem | `core::stratagem:<stratagemId>` |
| an army rule | `<armyId>::armyrule:<ruleId>` |
| a wargear option | `<unitId>::option:<groupId>\|<optionId>` |

**What a build does with each entry**

| State | Meaning |
|---|---|
| **active** | applied |
| **upstream changed** (flagged) | applied — but 40kdc-data changed its own reading of that rule since the entry was written, or an ability the entry names is gone. Compare the two, and correct ours on its sheet if theirs is right |
| **rejected** | not applied: off schema, rules text, or the retired 40kdc-data effect format |
| **target missing** (unresolved) | the rule, option group or unit it names is not in the dataset |

That flag is the one thing watched on a contribution. It never replaces what
we wrote: it only asks for a second look.

`effects.json` is one shared file, so two pull requests that both change it can
conflict. The interface keeps entries sorted and compares them one by one to
keep that rare; if it happens, the second pull request is redone on top of the
first.

### `battle-sizes.json`

```json
[
  { "points": 1000, "name": "Incursion", "detachmentPoints": 2, "enhancementLimit": 2, "unitLimit": 2 },
  { "points": 2000, "name": "Strike Force", "detachmentPoints": 3, "enhancementLimit": 4, "unitLimit": 3 }
]
```

Edited on the **Core** sheet. Fields: [Schema reference](schema.md#battle-size).

### `ally-rules.json`

A list of ally rules, each with a `reason` that is kept in this file and left
out of the published dataset. Edited on the **Core** sheet; fields and an
example in [Recipes](recipes.md#write-or-change-an-ally-rule) and the
[Schema reference](schema.md#ally-rule).

### `reference-targets.json`

The units the simulation offers as default targets. By army and unit **name**;
the build finds the identifier and keeps the model count within the unit's
size.

```json
[
  { "army": "astra-militarum", "unit": "Cadian Shock Troops", "models": 10 },
  { "army": "space-marines", "unit": "Intercessor Squad", "models": 5 }
]
```

Not editable in the interface: change the file by hand.

### `sample-list.json`

The list an app offers to try things without typing one. Units are named, with
their models and wargear; the build adds the identifiers and the points of the
day, so the sample never goes out of date.

```json
{
  "army": "adeptus-custodes",
  "name": "Talons of the Emperor",
  "detachment": "Shield Host",
  "battleSize": 2000,
  "units": [
    { "unit": "Blade Champion", "section": "CHARACTERS", "warlord": true,
      "wargear": [{ "name": "Vaultswords", "count": 1 }] },
    { "unit": "Custodian Guard", "section": "BATTLELINE",
      "models": [{ "name": "Custodian Guard", "count": 5,
                   "wargear": [{ "name": "Guardian Spear", "count": 5 }] }] }
  ]
}
```

`section` is one of `CHARACTERS`, `BATTLELINE`, `DEDICATED TRANSPORTS`,
`OTHER DATASHEETS`. Not editable in the interface either.

A unit named in either file that the build cannot find is listed in the build
report under *Authored entries not found*.

## The rule that applies to all of them

No file here may hold rules text — not in a value, not in a `reason`, not in an
`upstream`. The checks read every one of them. See
[How it works](how-it-works.md#the-no-rules-text-guard).
