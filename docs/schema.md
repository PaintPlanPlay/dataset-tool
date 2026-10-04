# Schema reference

Every file of the dataset and every field in it. The schema is the contract
between this tool, which produces the dataset, and the apps that read it.

It exists in two forms in this repository, which say the same thing:

- `schema/src/index.ts` — TypeScript types, with a comment on every field;
- `schema/dataset.schema.json` — a JSON Schema, which is what the checks run.

The current version is **2.5.0**; every published file carries the version it
conforms to in `schemaVersion`.

If you only use the interface, you can skip the file layout and go straight to
the entity you are editing: [Unit](#unit), [Detachment](#detachment),
[Enhancement](#enhancement), [Stratagem](#stratagem), [Rule](#rule),
[Battle size](#battle-size), [Ally rule](#ally-rule).

## Files

```
manifest.json                       which release the apps should read
wh40k-11e/
├── index.json                      the list of armies, and the versions of the sources
├── core.json                       what holds for every army
└── armies/
    ├── orks.json                   one file per army
    └── …
registry/wh40k-11e.json             the permanent identifiers
```

`wh40k-11e` is the **game system**: Warhammer 40,000, 11th edition. Everything
is filed under it.

Names used throughout:

| Name | Form | Example |
|---|---|---|
| an identifier (`id`) | letters, digits, `.` `_` `:` `~` `-`; 120 characters at most | `orks`, `blitz-brigade`, `e3b1-1240-2476-cd86` |
| a name | 1 to 120 characters | `Blitz Brigade` |
| a keyword | 1 to 80 characters | `Infantry` |
| a roll to reach | a whole number from 2 to 7; **7 means "none"** | `4` for 4+ |
| dice | text | `3`, `D6`, `D6+1` |

---

## `index.json`

What a build contains.

```json
{
  "schemaVersion": "2.5.0",
  "gameSystem": { "id": "wh40k-11e", "name": "Warhammer 40,000", "edition": "11th" },
  "sources": [
    { "id": "bsdata", "repository": "BSData/wh40k-11e", "commit": "cc1830f…" },
    { "id": "mfm", "repository": "BSData/wh40k-11e-mfm", "commit": "8e0e635…", "version": "1.5" }
  ],
  "armies": [
    {
      "id": "adepta-sororitas", "name": "Adepta Sororitas", "faction": "Imperium", "units": 138,
      "refs": { "bsdata": "Imperium - Adepta Sororitas", "mfm": "adepta-sororitas" }
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `sources` | each source at the exact commit the dataset was built from. `version` is the MFM's own version number |
| `armies[].id` | the army's identifier, and the name of its file |
| `armies[].faction` | the grand faction (`Imperium`, `Chaos`…), empty when the army declares none |
| `armies[].units` | how many units the army can field, allied units included |
| `armies[].refs` | the name by which each source knows the army |

---

## `armies/<army>.json`

```json
{
  "schemaVersion": "2.5.0",
  "gameSystem": "wh40k-11e",
  "id": "orks",
  "name": "Orks",
  "faction": "",
  "units": [ … ],
  "armyRules": [ { "id": "waaagh", "name": "Waaagh!" } ],
  "detachments": [ … ],
  "stratagems": [ … ]
}
```

| Field | Meaning |
|---|---|
| `faction` | the grand faction, empty when the army declares none |
| `units` | every [unit](#unit) the army can field |
| `armyRules` | the army's rules, stored once as [rules](#rule); units point to them by identifier |
| `detachments` | its [detachments](#detachment) |
| `stratagems` | the [stratagems](#stratagem) of its detachments. Core stratagems are in `core.json` |

### Unit

A datasheet.

```json
{
  "id": "e3b1-1240-2476-cd86",
  "name": "Boyz",
  "source": "Xenos - Orks",
  "isLegends": false,
  "keywords": ["Infantry", "Battleline", "Mob", "Boyz"],
  "factionKeywords": ["Orks"],
  "armyRules": ["Waaagh!"],
  "armyRuleIds": ["waaagh"],
  "models": [ … ],
  "weapons": [ … ],
  "abilities": [{ "name": "Tide of Muscle" }],
  "points": 85,
  "costBrackets": [{ "overModels": 10, "points": 170 }],
  "pricing": [ … ],
  "leaderTargets": [],
  "supportTargets": [],
  "minModels": 10,
  "maxModels": 20,
  "defaultModels": 20,
  "composition": [{ "name": "Nob", "min": 1, "max": 2 }],
  "defaultLoadout": [{ "weapon": "Choppa", "kind": "melee", "count": 18 }],
  "optionGroups": [ … ]
}
```

| Field | Type | Meaning | Comes from |
|---|---|---|---|
| `id` | identifier | the BSData identifier of the datasheet, kept as it is | BSData |
| `name` | name | | BSData |
| `source` | text | the BSData catalogue that defines the datasheet | BSData |
| `ally` | `true`, or absent | the unit is fielded by this army without coming from its own codex | BSData |
| `isLegends` | true / false | Legends or Crucible: not for tournament play | BSData |
| `supremeCommander` | `true`, or absent | in a list, this unit is necessarily the warlord. Read from its ability named "Supreme Commander" | derived |
| `keywords` | list of keywords | without the faction keywords | BSData |
| `factionKeywords` | list of keywords | without BSData's `Faction:` prefix | BSData |
| `armyRules` | list of names | the army rules the unit benefits from. Belonging to an army does not grant them: each unit lists its own | BSData |
| `armyRuleIds` | list of identifiers | the same rules, by identifier in the army file's `armyRules` | derived |
| `statuses` | list of [Modifiers](#modifier) | core abilities carried as statuses: `feel-no-pain: 5+`, `deep-strike`. Present only when the build recognises some on the datasheet | derived |
| `models` | list of [profiles](#profile) | one per kind of model | BSData |
| `weapons` | list of [weapons](#weapon) | every weapon the unit can carry | BSData |
| `abilities` | list of [abilities](#unit-ability) | by name, with what they do | BSData for the names, this project for the rest |
| `points` | whole number | the cost at the minimum size | derived from `pricing` |
| `costBrackets` | list | the cost at larger sizes: "over `overModels` models, `points` points" | derived from `pricing` |
| `pricing` | list of [price bands](#price-band) | the MFM price grid. Absent when the unit is not in the MFM | MFM |
| `assignedPricing` | list of price bands | the price the MFM lists for the unit when an ally rule admits it into another army's list | MFM |
| `wargear` | list of `{ item, points }` | paid wargear, on top of the unit's cost, as the MFM names it | MFM |
| `leaderTargets` | list of unit names | the units this character can lead | MFM |
| `supportTargets` | list of unit names | the units it can join as Support | MFM |
| `minModels`, `maxModels` | whole numbers | the unit's size | derived from `composition` |
| `defaultModels` | whole number | the size the counts of `defaultLoadout` refer to | BSData |
| `composition` | list of `{ name, min, max }` | how many of each model | BSData |
| `defaultLoadout` | list of `{ weapon, kind, count }` | the weapons carried when nothing is chosen | BSData |
| `optionGroups` | list of [option groups](#option-group) | the wargear choices | BSData |

Required: `id`, `name`, `source`, `isLegends`, `keywords`, `factionKeywords`,
`armyRules`, `models`, `weapons`, `abilities`, `points`, `costBrackets`,
`leaderTargets`, `supportTargets`, `minModels`, `maxModels`.

#### Profile

The characteristics of one kind of model.

```json
{ "name": "Nob", "M": "6\"", "T": 5, "Sv": 5, "Inv": 7, "W": 3, "LD": "7+", "OC": 2 }
```

| Field | Type | Meaning |
|---|---|---|
| `name` | name | the model |
| `M` | text | movement, as written: `6"` |
| `T` | whole number | toughness |
| `Sv` | 2 to 7 | armour save; 7 = none |
| `Inv` | 2 to 7 | invulnerable save; 7 = none |
| `W` | whole number | wounds |
| `LD` | text | leadership: `7+` |
| `OC` | whole number | objective control |

#### Weapon

What a model carries, with all its profiles. Taking a weapon brings all of
them; which one to use is decided at the table, never in the list.

```json
{
  "name": "Rokkit Launcha",
  "kind": "ranged",
  "maxCarriers": 2,
  "profiles": [
    { "name": "Busta", "range": "24\"", "rangeInches": 24, "A": "2", "skill": 5, "S": 10, "AP": -2, "D": "3", "keywords": [] },
    { "name": "Blasta", "range": "24\"", "rangeInches": 24, "A": "2", "skill": 5, "S": 4, "AP": 0, "D": "1", "keywords": ["BLAST 2"] }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `name` | name | |
| `kind` | `ranged` or `melee` | |
| `profiles` | list, at least one | the ways of using it. A simple weapon has one, named like the weapon |
| `maxCarriers` | whole number | how many models of the unit can carry it at most, when the datasheet says so |

Each **weapon profile**:

| Field | Type | Meaning |
|---|---|---|
| `name` | name | |
| `range` | text | `24"`, or `Melee` |
| `rangeInches` | number | the range in inches, 0 in melee. Derived from `range` |
| `A` | dice | attacks: `3`, `D6+1` |
| `skill` | 2 to 7 | the roll to hit. 7 when the weapon has no hit roll |
| `S` | whole number | strength |
| `AP` | whole number, zero or negative | armour penetration |
| `D` | dice | damage |
| `keywords` | list | weapon abilities: `Rapid Fire 1`, `Anti-Infantry 4+` |

Weapon keywords come from BSData as BSData writes them (`RAPID FIRE 1`,
`LETHAL HITS: non-MONSTER/VEHICLE`) and are kept as they are. Keywords added
through the interface come from a closed list, in a canonical form:

> Anti-*Keyword* *N*+ · Assault · Blast · Cleave *N* · Close-quarters ·
> Conversion · Devastating Wounds · Extra Attacks · Hazardous · Heavy ·
> Ignores Cover · Indirect Fire · Lance · Lethal Hits · Melta *N* · One Shot ·
> Pistol · Precision · Psychic · Rapid Fire *N or dice* · Sustained Hits *N or
> dice* · Torrent · Twin-linked

In other places a weapon is referred to by a **weapon key**: its kind, a bar,
its name — `ranged|Shoota`, `melee|Power Klaw`.

#### Price band

The MFM prices a unit by how many copies of it the list already holds, and by
unit size.

```json
[
  { "from": 1, "to": 3,    "costs": [{ "models": 10, "points": 85 }, { "models": 20, "points": 170 }] },
  { "from": 4, "to": null, "costs": [{ "models": 10, "points": 95 }, { "models": 20, "points": 180 }] }
]
```

Read: the 1st to 3rd unit of Boyz cost 85 points for 10 models and 170 for 20;
from the 4th, 95 and 180.

| Field | Type | Meaning |
|---|---|---|
| `from` | whole number, 1 or more | rank of the first copy concerned |
| `to` | whole number, or `null` | rank of the last; `null` for an open band ("4th and following") |
| `costs[].models` | whole number | a unit size |
| `costs[].points` | whole number | its cost |
| `costs[].desc` | text | a label the MFM gives that line |
| `costs[].addon` | true / false | the line is a supplement ("+ 1 Invader ATV") rather than a unit size |

`points` and `costBrackets` are computed from the **first** band: its first
cost is the base cost, the following ones are the brackets.

#### Unit ability

```json
{ "name": "Krumpin’ Time", "modifiers": [ … ], "summary": "+1 to hit in melee while riled up" }
```

A `name`, plus the [body of a rule](#rule): `modifiers`, `options`, `summary`.
Its text is never published.

#### Option group

One wargear choice of the datasheet, with the budget that governs it.

```json
{
  "id": "707d-2097-deaa-2601",
  "name": "Kannon",
  "tree": "cc1b-a7f1-7f13-4a8c",
  "parent": "",
  "slot": "Gunwagon",
  "pool": false,
  "minPicks": 1,
  "maxPicks": 1,
  "pickBrackets": [],
  "options": [
    { "id": "b5e9-fc1b-0635-d1b0", "name": "Kannon", "weapons": ["ranged|Kannon"], "maxCarriers": 0, "isDefault": true },
    { "id": "bca6-bb6a-ff2d-67ab", "name": "Killkannon", "weapons": ["ranged|Killkannon"], "maxCarriers": 0, "isDefault": false }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | identifier | |
| `name` | name | |
| `tree` | identifier | the top-level choice this one belongs to — itself when it is at the top. Two groups of the same tree describe the same model from two angles; two trees are two slots that add up |
| `parent` | identifier, or empty | the choice that contains this one; empty at the top |
| `slot` | text, or empty | the model that carries the choice (`Boss Nob`); empty when it holds for the whole unit |
| `pool` | true / false | whether the budget counts **models** (true: the options compete for the same models) or **choices** (false: "one option at a time") |
| `minPicks` | whole number | options that must be taken |
| `maxPicks` | whole number | options that can be taken, at the base size |
| `pickBrackets` | list of `{ atModels, maxPicks }` | "from `atModels` models, the budget becomes `maxPicks`" |
| `options` | list of wargear options | |

Each **wargear option**:

| Field | Type | Meaning |
|---|---|---|
| `id` | identifier | |
| `name` | name | as on the datasheet |
| `weapons` | list of weapon keys | what a model that takes it carries. May be empty (a banner, a shield) |
| `maxCarriers` | whole number | how many models can take it at most; 0 when the source sets no limit |
| `perModels` | whole number | "one model for every N": the limit then follows the unit's size, and prevails over `maxCarriers` |
| `isDefault` | true / false | the option held when nothing is chosen |
| `wargearCost` | `{ item, quantity }` | the line of the unit's `wargear` list that bills this option, by its name as the MFM writes it, and how many times per model (`quantity`, 1 when absent). The amount is never copied here: the `wargear` list is the only source of points. A default option can be paid too |
| `abilities` | list of names | abilities of the unit that the option brings. An ability brought by at least one option is active only for the models that take one |

### Detachment

```json
{
  "id": "blitz-brigade",
  "name": "Blitz Brigade",
  "dp": 1,
  "forceDispositions": ["take-and-hold"],
  "rules": [{ "id": "eager-for-the-fight", "name": "Eager for the Fight" }],
  "enhancements": [ … ]
}
```

| Field | Type | Meaning | Comes from |
|---|---|---|---|
| `id` | identifier | | registry |
| `name` | name | | MFM |
| `dp` | whole number, or `null` | cost in detachment points; `null` when the MFM does not give it | MFM |
| `forceDispositions` | list of text | the force dispositions it grants: `take-and-hold`, `disruption`… | MFM |
| `uniqueTag` | text | two detachments carrying the same tag cannot be taken together | MFM |
| `rules` | list of [rules](#rule) | its detachment rules | this project |
| `enhancements` | list of [enhancements](#enhancement) | | see below |

### Enhancement

```json
{
  "id": "cybork-boosta",
  "name": "Cybork Boosta",
  "points": 10,
  "appliesTo": "character",
  "aura": false,
  "maxTargets": 1,
  "requires": [["Big Mek"], ["Mek"]],
  "excludes": []
}
```

| Field | Type | Meaning | Comes from |
|---|---|---|---|
| `id` | identifier | | registry |
| `name` | name | | MFM |
| `points` | whole number | | MFM |
| `appliesTo` | `character` or `unit` | an enhancement goes on a character, an upgrade on a unit | MFM (marked `(Upgrade)` in the name) |
| `aura` | true / false | | MFM (marked `(Aura)`) |
| `maxTargets` | whole number | how many units an upgrade can equip in one list | this project |
| `requires` | list of groups of keywords | the bearer must have **every** keyword of **one** group. `[["Big Mek"], ["Mek"]]`: a Big Mek, or a Mek. Empty: no restriction | this project |
| `excludes` | list of keywords | keywords that forbid the bearer | this project |
| `leaderTo`, `supportTo` | lists of unit names | units for which the enhancement opens Leader or Support | MFM |
| `weapon` | a [weapon](#weapon) | the weapon it brings to its bearer while taken. Its cost stays the enhancement's | this project |
| `modifiers`, `options`, `summary` | | the [body of a rule](#rule) | this project |

### Stratagem

```json
{
  "id": "where-dya-fink-youre-going",
  "name": "WHERE D’YA FINK YOU’RE GOING?",
  "detachmentId": "da-big-hunt",
  "cp": 1,
  "phases": ["movement"],
  "playerTurn": "opponent-turn",
  "timing": "once-per-phase",
  "category": "strategic-ploy",
  "target": { "allOf": ["BEAST SNAGGA"], "anyOf": [], "noneOf": [] }
}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | identifier | |
| `name` | name | |
| `detachmentId` | identifier, or `null` | the detachment that grants it; `null` for a core stratagem |
| `cp` | 0 to 4 | its cost in command points |
| `phases` | list, at least one | `command`, `movement`, `shooting`, `charge`, `fight` |
| `playerTurn` | | `your-turn`, `opponent-turn` or `either` |
| `timing` | | `once-per-phase`, `once-per-turn`, `once-per-battle` or `unlimited` |
| `category` | optional | `battle-tactic`, `strategic-ploy`, `epic-deed` or `wargear` |
| `target` | [keyword filter](#keyword-filter), optional | the units it can be used on. Absent: the dataset does not know how to restrict it |
| `modifiers`, `options`, `summary` | | the [body of a rule](#rule) |

All of it is written by this project, as a contribution.

### Rule

A named rule: a detachment rule, an army rule. Abilities, enhancements and
stratagems share its **body**.

```json
{
  "id": "sneaky-little-gitz",
  "name": "Sneaky Little Gitz",
  "eligibility": { "allOf": ["Gretchin"], "anyOf": [], "noneOf": [] },
  "modifiers": [{ "key": "gain-keyword", "value": "Battleline", "target": "self" }]
}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | identifier | |
| `name` | name | |
| `eligibility` | [keyword filter](#keyword-filter) | the units that benefit; absent, every unit of the list |
| `modifiers` | list of [Modifiers](#modifier) | what the rule does |
| `options` | list of `{ name, modifiers }`, at least two | the exclusive choices of a rule that offers one |
| `summary` | text, 160 characters at most | a one-line description written by this project, never copied |

With neither Modifiers nor summary, the rule is shown by its name and the
player refers to their codex.

#### Modifier

One change a rule makes. [Rules and Modifiers](rules-and-modifiers.md) is the
guide; this is the format.

```json
{
  "key": "hit", "value": 1, "target": "aura", "range": 6,
  "keywords": { "allOf": ["Orks"], "anyOf": [], "noneOf": [] },
  "conditions": [{ "key": "melee" }]
}
```

| Field | Type | Meaning |
|---|---|---|
| `key` | letters, digits and hyphens, 40 characters at most | what changes. An open vocabulary |
| `value` | optional | a number (`1`, `-1`); dice (`D3`, `D6+1`); a threshold (`5+`); `all`; a keyword for `gain-keyword`, where it is required |
| `target` | required | `self`, `attached`, `aura` or `enemy` |
| `range` | number, up to 48 | the range of an aura, in inches |
| `keywords` | [keyword filter](#keyword-filter) | which units among the target |
| `conditions` | list of `{ key, value }` | all must hold. `value` is optional: a number or a keyword |

#### Keyword filter

Used for a stratagem's target, a rule's eligibility and a Modifier's keywords.

```json
{ "allOf": ["Infantry"], "anyOf": ["Boyz", "Nobz"], "noneOf": ["Gretchin"] }
```

A unit passes when it has **every** keyword of `allOf`, **at least one** of
`anyOf` when that list is not empty, and **none** of `noneOf`. The three lists
are always present, possibly empty.

---

## `core.json`

What holds for every army of the game system.

```json
{
  "schemaVersion": "2.5.0",
  "gameSystem": "wh40k-11e",
  "stratagems": [ … ],
  "battleSizes": [ … ],
  "allyRules": [ … ],
  "referenceTargets": [ … ],
  "sampleList": { … }
}
```

| Field | Meaning |
|---|---|
| `stratagems` | the core [stratagems](#stratagem), with `detachmentId: null` |
| `battleSizes` | the [battle sizes](#battle-size) |
| `allyRules` | the [ally rules](#ally-rule), all armies together |
| `referenceTargets` | the default targets of the simulation |
| `sampleList` | the sample list |

### Battle size

Written by this project: no source publishes the detachment point budget or
the limits.

```json
{ "points": 2000, "name": "Strike Force", "detachmentPoints": 3, "enhancementLimit": 4, "unitLimit": 3 }
```

| Field | Type | Meaning |
|---|---|---|
| `points` | whole number | the size of the game |
| `name` | name | |
| `detachmentPoints` | whole number | the budget of detachment points |
| `enhancementLimit` | whole number | enhancements a list of this size may hold |
| `unitLimit` | whole number | copies of one unit at most — doubled for Battleline and Dedicated Transports |

### Ally rule

What lets a list include units from outside its army. Written by this project,
and without text: only what can be verified.

```json
{
  "id": "freeblades",
  "name": "Freeblades",
  "exceptArmies": ["imperial-knights"],
  "requires": ["Imperium"],
  "admits": { "factionKeywords": ["Imperial Knights"] },
  "modelsOneOf": [{ "keyword": "Titanic", "max": 1 }, { "keyword": "Armiger", "max": 3 }],
  "noWarlord": true,
  "noEnhancements": true
}
```

| Field | Type | Meaning |
|---|---|---|
| `id` | identifier | |
| `name` | name | also the badge shown on admitted units |
| `armies` | list of army identifiers | the only armies whose lists may use it; absent, all of them except `exceptArmies` |
| `exceptArmies` | list of army identifiers | |
| `requires` | list of keywords | every model of the list, allied units aside, has at least one of these keywords or faction keywords |
| `admits` | `{ factionKeywords, keywords, units }` | the units let in: one match is enough. `units` names them |
| `limits` | list of `{ battleSize, units, points }` | per battle size: `units` is a list of `{ keyword, max }` — units admitted at most, by type keyword; `points` is the combined cost at most |
| `modelsOneOf` | list of `{ keyword, max }` | one of these families of models only, within its limit, at any battle size |
| `battlelineRatio` | list of keywords | for each, admitted non-Battleline units may not outnumber the Battleline ones |
| `noWarlord` | `true`, or absent | an admitted unit is never the warlord |
| `noEnhancements` | `true`, or absent | an admitted unit takes no enhancement |
| `assignedCost` | `true`, or absent | an admitted unit pays its `assignedPricing` |
| `armyRulesInactive` | `true`, or absent | the army rules of an admitted unit do not apply |
| `transportReminder` | `true`, or absent | a reminder: an admitted Dedicated Transport must start the battle with a unit embarked |

### Reference target and sample list

```json
{ "armyId": "astra-militarum", "unitId": "a2aa-7688-dcb1-4132", "name": "Cadian Shock Troops", "models": 10 }
```

A **reference target** is a unit of the dataset and a model count.

The **sample list** has an `armyId`, a `name`, a `detachment`, a `battleSize`,
its total `points`, and its `units` — each with a `unitId`, a `name`, a
`section`, its `points` taken from the dataset at build time, `warlord` when it
is, and its models and wargear. Both are built from the hand-written files of
`authored/`, described in
[Corrections and contributions](corrections-and-contributions.md#reference-targetsjson).

---

## `manifest.json`

The first thing an app reads; at the root of the dataset repository.

```json
{
  "schemaVersion": "2.5.0",
  "gameSystem": "wh40k-11e",
  "releaseUrl": "https://cdn.jsdelivr.net/gh/PaintPlanPlay/dataset@{tag}/",
  "current": "mfm-1-5",
  "offered": ["mfm-1-5", "mfm-1-4-r2", "mfm-1-4"],
  "dataslates": [
    {
      "id": "mfm-1-5",
      "name": "MFM 1.5",
      "mfmVersion": "1.5",
      "frozen": false,
      "latest": "wh40k-11e-mfm-1-5-r3",
      "releases": [
        { "tag": "wh40k-11e-mfm-1-5-r3", "number": 3, "publishedAt": "2026-10-02T11:53:12.082Z", "schemaVersion": "2.5.0" }
      ]
    }
  ]
}
```

| Field | Meaning |
|---|---|
| `releaseUrl` | where the files of a release are served, with `{tag}` replaced by the release's tag |
| `current` | the identifier of the current dataslate |
| `offered` | the dataslates offered to the player: the current one and the two before it |
| `dataslates` | all of them, most recent first |
| `dataslates[].mfmVersion` | the Munitorum Field Manual version that bounds this rules period |
| `dataslates[].frozen` | true once a newer dataslate exists: no more releases, the existing ones stay readable |
| `dataslates[].latest` | the tag of the release the apps read for this dataslate — the most recent, unless rolled back |
| `dataslates[].releases` | every release, most recent first: `tag`, `number` (rank in its dataslate, from 1), `publishedAt`, `schemaVersion` |

A release tag reads `<game system>-<dataslate>-r<number>`.

To read the dataset, an app fetches the manifest, takes the `latest` tag of the
dataslate it wants, replaces `{tag}` in `releaseUrl`, and reads
`wh40k-11e/index.json` and the army files from there.

---

## `registry/wh40k-11e.json`

The permanent identifiers, by kind of entity (`armies`, `detachments`,
`enhancements`, `rules`, `stratagems`) and then by scope (`*`, or an army).

```json
{
  "detachments": {
    "orks": [
      { "id": "blitz-brigade", "keys": ["mfm:blitzbrigade"], "name": "Blitz Brigade" }
    ]
  }
}
```

| Field | Meaning |
|---|---|
| `id` | the identifier given once, and kept for ever |
| `keys` | the keys by which the sources know the entity |
| `name` | its name when the identifier was given, for a human reading the registry |

Written by the build; never by hand.

---

## Correction files and `authored/`

Their formats are described in
[Corrections and contributions](corrections-and-contributions.md).

## Changing the schema

The schema is versioned (`SCHEMA_VERSION` in `schema/src/index.ts`, and the
`version` of `schema/package.json`). A change to it concerns three places —
this tool, the apps that read the dataset, and the dataset itself, which must
be rebuilt and released. The build report does not compare two datasets whose
schemas differ by a major version.
