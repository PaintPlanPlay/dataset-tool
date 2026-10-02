# Recipes

"I want to…" — and how to do it in the interface. Each recipe ends with the
file the tool writes for you, so you can recognise it in a pull request or
write it by hand.

Every recipe assumes you clicked **Update data** first, and ends the same way:
**Save** (with a one-sentence reason), **Save & Build**, **Propose my change**.

Most examples are taken from the published dataset; a few are shortened or
made up to show a shape. Identifiers such as `e3b1-1240-2476-cd86` are unit
identifiers; you never type them — the tool fills them in.

Field names appear here as the interface shows them: the name of the field in
the file, with spaces and a capital (`leaderTargets` is shown as *Leader
targets*).

**Contents**

- Points and prices: [change a unit's points](#change-a-units-points) ·
  [paid wargear](#change-the-cost-of-paid-wargear) ·
  [enhancement points](#change-an-enhancements-points) ·
  [detachment points](#change-a-detachments-points-or-force-dispositions)
- Datasheets: [a characteristic](#fix-a-models-characteristic) ·
  [add a model](#add-a-model-to-a-unit) ·
  [a weapon profile](#fix-a-weapon-profile) ·
  [add a weapon](#add-a-weapon) · [remove a weapon](#remove-a-weapon) ·
  [keywords](#add-or-remove-a-keyword) ·
  [abilities](#add-or-remove-an-ability) ·
  [leaders](#change-who-a-character-can-lead) ·
  [Legends](#mark-a-unit-as-legends)
- Wargear options: [fix an option](#fix-a-wargear-option) ·
  [link a paid line](#link-a-paid-wargear-line-to-an-option) ·
  [add an option](#add-a-wargear-option-bsdata-does-not-have)
- Rules: [describe an ability](#describe-what-an-ability-does) ·
  [a detachment rule](#describe-a-detachment-rule) ·
  [a rule with a choice](#describe-a-rule-that-offers-a-choice) ·
  [a stratagem](#fix-or-describe-a-stratagem)
- Enhancements: [add one](#add-an-enhancement) ·
  [restrictions](#change-who-can-take-an-enhancement) ·
  [the weapon it brings](#give-an-enhancement-a-weapon)
- Core: [battle sizes](#change-a-battle-size) ·
  [ally rules](#write-or-change-an-ally-rule)
- Housekeeping: [undo](#undo-a-pending-change) ·
  [delete a correction](#delete-a-correction-that-is-no-longer-needed) ·
  [tell the source](#tell-the-source-so-it-fixes-itself) ·
  [a new MFM](#enter-a-new-munitorum-field-manual-before-bsdata-does)

---

## Change a unit's points

**Where:** the unit's sheet, section **Prices · MFM**.

The Munitorum Field Manual prices a unit by **band of copies** and by **unit
size**. Boyz, for instance: the 1st to 3rd unit of Boyz in a list cost one
price, the 4th and following cost more; and each band has a price for 10 models
and for 20.

1. Open the unit.
2. In **Prices**, each row is a band (*copies 1 to 3*, *copies 4 to ∞*), and
   each cell is a size and its cost. Change the points.
3. **+** in a row adds a size; **+** in the title adds a band; **−** removes.
4. Save.

The **base points** and **cost brackets** shown at the top of the sheet follow
on their own: they are computed from the first band.

**What is written** — `corrections/wh40k-11e/orks/boyz-unit-mfm.json`:

```json
{
  "target": "e3b1-1240-2476-cd86",
  "source": "mfm",
  "patch": {
    "pricing": [
      { "from": 1, "to": 3, "costs": [{ "models": 10, "points": 85 }, { "models": 20, "points": 170 }] },
      { "from": 4, "to": null, "costs": [{ "models": 10, "points": 95 }, { "models": 20, "points": 180 }] }
    ]
  },
  "upstream": {
    "pricing": [
      { "from": 1, "to": 3, "costs": [{ "models": 10, "points": 90 }, { "models": 20, "points": 180 }] },
      { "from": 4, "to": null, "costs": [{ "models": 10, "points": 100 }, { "models": 20, "points": 190 }] }
    ]
  },
  "reason": "MFM 1.5 lowers Boyz by 5 points per 10 models."
}
```

The price grid is corrected **whole**: `patch` holds the grid as it should be,
`upstream` the grid as the source has it.

> A unit that says *Not in the Munitorum Field Manual: the cost comes from
> BSData* has no grid. Add a band with **+** to give it one.

## Change the cost of paid wargear

**Where:** the unit's sheet, section **Wargear costs · MFM**.

Each line is a name and an amount, as the MFM writes them (`Zzap Gun: 10`).
Change the amount, add a line with **+**, or remove one.

**What is written** — a correction on the unit, source `mfm`, with the whole
list:

```json
{
  "target": "<unit id>",
  "source": "mfm",
  "patch": { "wargear": [{ "item": "Zzap Gun", "points": 15 }] },
  "upstream": { "wargear": [{ "item": "Zzap Gun", "points": 10 }] },
  "reason": "…"
}
```

A line bills something only when a wargear option points to it: see
[Link a paid wargear line to an option](#link-a-paid-wargear-line-to-an-option).

## Change an enhancement's points

**Where:** the **detachment's** sheet (search for the detachment, not the
enhancement), in the enhancement's card.

**What is written** —
`corrections/wh40k-11e/orks/blitz-brigade-enhancement-targetin-gizmos-mfm.json`:

```json
{
  "target": "orks::enhancement:blitz-brigade|targetin-gizmos",
  "source": "mfm",
  "patch": { "points": 25 },
  "upstream": { "points": 10 },
  "reason": "MFM 1.5 raises this enhancement to 25 points."
}
```

The target reads: army `orks`, an enhancement, of detachment `blitz-brigade`,
named `targetin-gizmos`.

## Change a detachment's points or force dispositions

**Where:** the detachment's sheet, at the top: **Dp** (detachment points),
**Force dispositions**, **Unique tag**.

Force dispositions are written in lower case with hyphens: `take-and-hold`,
`disruption`. Two detachments carrying the same **unique tag** cannot be taken
together.

**What is written:**

```json
{
  "target": "orks::detachment:blitz-brigade",
  "source": "mfm",
  "patch": { "dp": 2 },
  "upstream": { "dp": 1 },
  "reason": "…"
}
```

---

## Fix a model's characteristic

**Where:** the unit's sheet, section **Models · BSData**.

One line per kind of model in the unit (a *Boy* and a *Nob*, for Boyz). Change
M, T, Sv, Inv, W, LD or OC.

- Saves are a number from 2 to 7: `4` for a 4+ save, **`7` for none**.
- Type `6` for the movement and `7` for the Leadership: they are stored as
  `6"` and `7+`.

**What is written** — one correction per model changed, source `bsdata`, with
only the characteristics you changed:

```json
{
  "target": "e3b1-1240-2476-cd86::model:Nob",
  "source": "bsdata",
  "patch": { "W": 2 },
  "upstream": { "W": 3 },
  "reason": "…"
}
```

## Add a model to a unit

A model BSData is missing — the leader of a squad, for instance. Two things
change: the list of models, and the unit's composition.

1. In **Models**, click **+**, name the model and fill in its characteristics.
2. Set its **Count**: the minimum and maximum number of this model in the unit.
   The unit's minimum and maximum sizes follow.
3. Save.

**What is written** — two corrections, as for the Flash Gitz' Kap'tain:

```json
{
  "target": "1de9-b138-28a1-9c4b::model:Kap'tain",
  "source": "bsdata",
  "patch": { "__add": true, "M": "6", "T": 5, "Sv": 4, "Inv": 7, "W": 3, "LD": "7+", "OC": 1 },
  "reason": "Add the Kap'tain model."
}
```

```json
{
  "target": "1de9-b138-28a1-9c4b",
  "source": "bsdata",
  "patch": {
    "composition": [
      { "name": "Flash Gitz", "min": 4, "max": 9 },
      { "name": "Kap'tain", "min": 1, "max": 1 }
    ]
  },
  "upstream": {},
  "reason": "Add the Kap'tain model."
}
```

`"__add": true` means *create this element*; see
[Corrections and contributions](corrections-and-contributions.md#adding-and-removing).

## Fix a weapon profile

**Where:** the unit's sheet, section **Weapons · BSData**.

A weapon has one or more **profiles**. A simple weapon has one, named like the
weapon. A weapon with several ways of firing has one per way — the Rokkit
Launcha has *Busta* and *Blasta*.

| Field | What to type |
|---|---|
| **Range** | `24` (stored as `24"`), or `Melee` |
| **A** | attacks, as dice: `3`, `D6`, `D6+1` |
| **Skill** | the roll to hit, 2 to 6: `3` for 3+. `7` when the weapon has no hit roll (a Torrent weapon) |
| **S** | strength |
| **AP** | zero or negative: `0`, `-1`, `-2` |
| **D** | damage, as dice: `1`, `D3`, `D6+2` |
| **Keywords** | pick from the list, then give the value: *Rapid Fire* `1`, *Anti* `Infantry` `4` |
| **Max carriers** | on the weapon: how many models of the unit can carry it at most |

The range in inches is derived from the range; you do not type it.

**What is written** — a weapon is always corrected **whole**, with all its
profiles, never one profile alone:

```json
{
  "target": "e3b1-1240-2476-cd86::weapon:ranged|Shoota",
  "source": "bsdata",
  "patch": {
    "profiles": [
      {
        "name": "Shoota", "range": "18\"", "rangeInches": 18,
        "A": "2", "skill": 5, "S": 4, "AP": 0, "D": "1",
        "keywords": ["LETHAL HITS: non-MONSTER/VEHICLE", "RAPID FIRE 1"]
      }
    ]
  },
  "upstream": { "profiles": [ "…the profiles as BSData has them…" ] },
  "reason": "…"
}
```

The target reads: this unit, a weapon, `ranged` or `melee`, then its name.

## Add a weapon

1. In **Weapons**, click **+**. Give the weapon a name and a kind (ranged or
   melee), and fill in at least one profile.
2. If a wargear option should equip it, add it to that option's weapons (see
   [Fix a wargear option](#fix-a-wargear-option)).
3. Save.

**What is written:**

```json
{
  "target": "1e27-a6de-3840-a050::weapon:ranged|Twin Icarus autocannons",
  "source": "bsdata",
  "patch": {
    "__add": true,
    "profiles": [
      {
        "name": "Icarus autocannons", "range": "48\"", "rangeInches": 48,
        "A": "3", "skill": 3, "S": 7, "AP": -1, "D": "2",
        "keywords": ["Anti-Fly 2+", "Twin-linked"]
      }
    ]
  },
  "reason": "Update the Crusader loadout."
}
```

## Remove a weapon

Click **−** on the weapon, and save. The weapon also leaves the unit's default
loadout.

**What is written:**

```json
{
  "target": "1e27-a6de-3840-a050::weapon:ranged|Icarus autocannons",
  "source": "bsdata",
  "patch": { "__delete": true },
  "reason": "Update the Crusader loadout."
}
```

## Add or remove a keyword

**Where:** the unit's sheet, **Keywords** or **Faction keywords**.

Type the keyword — existing ones autocomplete — or click **−** on one.
Faction keywords are written without BSData's `Faction:` prefix: `Orks`.

**What is written** — a correction on the unit, source `bsdata`, with the whole
list of keywords after your change, and the whole list before in `upstream`.

## Add or remove an ability

**Where:** the unit's sheet, section **Abilities · project**.

- **+** adds an ability: give it its name. You can describe what it does at the
  same time (next recipes).
- **−** removes one.

The dataset only ever holds the ability's **name**, never its text.

**What is written** — presence is a correction against BSData:

```json
{
  "target": "9030-f62d-417-fc92::ability:Infused with the Blessings of Nurgle",
  "source": "bsdata",
  "patch": { "__delete": true },
  "reason": "FAQ: Plague Marines taken into a Chaos Space Marines army do not benefit from this ability."
}
```

> A unit that must be its army's warlord is recognised by its ability named
> **Supreme Commander**. To fix a unit BSData gets wrong, add or remove that
> ability.

## Change who a character can lead

**Where:** the unit's sheet, **Leader targets** (the units it can lead) and
**Support targets** (the units it can join as Support).

Type the name of a unit of the same army; it autocompletes, and a name that is
not a unit of the army is refused.

**What is written** — one correction per unit added or removed:

```json
{
  "target": "80c4-14b2-d02d-d289::attachment:leader|Meganobz",
  "source": "mfm",
  "patch": { "__add": true },
  "reason": "The new codex lets Nazdreg lead Meganobz."
}
```

`leader|Meganobz` or `support|Meganobz`; `__add` to add, `__delete` to remove.

## Mark a unit as Legends

**Where:** the header of the unit's sheet, the **Legends** switch.

**What is written:** a correction on the unit, source `bsdata`, with
`"patch": { "isLegends": true }`.

---

## Fix a wargear option

**Where:** the unit's sheet, section **Wargear Options**.

Options come in **groups**. A group is one choice on the datasheet; each option
of the group is one way to answer it.

| Field of an option | Meaning |
|---|---|
| **Name** | as on the datasheet: `Nob w/ Big Choppa` |
| **Weapons** | the weapons a model that takes the option carries |
| **Max carriers** | how many models can take it at most |
| **One per N models** | "one model for every 5": type `5`. Its limit then follows the unit's size |
| **Default** | the option a model has when nothing is chosen |

| Field of a group | Meaning |
|---|---|
| **Min picks** / **Max picks** | how many options of the group must, and can, be taken |
| **Pick brackets** | "two instead of one from 20 models": at 20 models, 2 picks |

**What is written** — a correction on the unit, source `bsdata`, with **all**
its option groups: `patch` has them as they should be, `upstream` as BSData has
them. It is the largest correction there is; the Nobz one is a good example in
the dataset (`corrections/wh40k-11e/orks/nobz-unit-optiongroups.json`).

## Link a paid wargear line to an option

The MFM bills wargear by name (`Twin Killsaws: 5`); BSData describes options
(`Meganob w/ Twin Killsaw`). The build links a line to an option when their
names match and **exactly one non-default option** fits. When it cannot, the
line is listed on the unit sheet and in the build report, as one of:

| Finding | Meaning |
|---|---|
| no option matches | no option carries that name |
| several options match | the tool will not guess |
| only a default option matches | a default option may be paid, or not: you decide |
| linked by hand, but the line is gone | the link names a line the MFM no longer has |

To link by hand: in the option's card, under **Wargear cost**, choose the MFM
line in the menu (it starts on *— not billed —*), and set the number after
**×** — how many times the line is paid per model (`2` for an option named
"2 Multi-meltas"). The resulting amount is shown, read from the line: you never
type an amount on an option. **unlink** removes the link.

**What is written** — a **contribution**, in `authored/wh40k-11e/effects.json`:

```json
{
  "target": "d8c8-ea02-21bf-de0b::option:9fa3-afd7-4ce7-f888|7b2f-1a9b-4188-dd21",
  "wargearCost": { "item": "Lascannon" },
  "reason": "The default lascannon is a paid one."
}
```

A link set by hand always wins over the automatic one — including to
**unlink** (`"wargearCost": null`), when the automatic link is wrong.

> When the official app contradicts the MFM (a free Killsaw), do not unlink:
> correct the MFM **line** in *Wargear costs*.

## Add a wargear option BSData does not have

A banner, a shield, a choice BSData forgot.

1. In **Wargear Options**, in the right group, click **+**.
2. Name it, list its weapons (possibly none), set its limits.
3. Optionally: its MFM line, and the **abilities it brings** — abilities of the
   unit that are then active only for the models that take the option.
4. Save.

**What is written** — a contribution; the option exists only because of it:

```json
{
  "target": "1e27-a6de-3840-a050::option:group-2|contrib-1",
  "option": {
    "name": "1 ironstorm missile pod",
    "weapons": ["ranged|Ironstorm missile pod"],
    "maxCarriers": 0,
    "isDefault": false
  },
  "reason": "Update the Crusader loadout."
}
```

---

## Describe what an ability does

**Where:** the unit's sheet, section **Abilities**, in the ability's card.

You have two tools, which combine:

- a **description**: one line, at most 160 characters, **in your own words**;
- **Modifiers**: structured changes the apps can actually simulate.

Read [Rules and Modifiers](rules-and-modifiers.md) first: it explains keys,
values, targets and conditions.

Example: an aura that gives +1 to hit and +1 to wound in melee to friendly
Orks units within 6". Add two Modifiers:

| key | value | target | range | keywords (all of) | conditions |
|---|---|---|---|---|---|
| `hit` | `1` | `aura` | `6` | `Orks` | `melee` |
| `wound` | `1` | `aura` | `6` | `Orks` | `melee` |

**What is written** — a contribution:

```json
{
  "target": "4ea0-6b70-c17c-bc00::ability:Prophet of Da Great Waaagh! (Aura)",
  "modifiers": [
    {
      "key": "hit", "value": 1, "target": "aura", "range": 6,
      "keywords": { "allOf": ["Orks"], "anyOf": [], "noneOf": [] },
      "conditions": [{ "key": "melee" }]
    },
    {
      "key": "wound", "value": 1, "target": "aura", "range": 6,
      "keywords": { "allOf": ["Orks"], "anyOf": [], "noneOf": [] },
      "conditions": [{ "key": "melee" }]
    }
  ],
  "reason": "Describe Ghazghkull's aura.",
  "upstream": "bf21a9e8fbc5"
}
```

(`upstream` is a fingerprint the tool adds; ignore it.)

When a rule is too particular for Modifiers, a description alone is fine:

```json
{
  "target": "4ea0-6b70-c17c-bc00::ability:Supreme Commander",
  "summary": "Must be the warlord",
  "reason": "Describe Ghazghkull's abilities."
}
```

And when you are unsure, leave the ability with its name only.

## Describe a detachment rule

**Where:** the detachment's sheet, in the rule's card.

A detachment rule has one more field than an ability: its **eligibility** —
the units that benefit, by keyword. Leave it empty when every unit of the list
benefits.

Example: in a detachment, Gretchin units count as Battleline. The eligibility
picks the units; one Modifier grants the keyword:

```json
{
  "target": "orks::rule:runt-swarm|sneaky-little-gitz",
  "eligibility": { "allOf": ["Gretchin"], "anyOf": [], "noneOf": [] },
  "modifiers": [{ "key": "gain-keyword", "value": "Battleline", "target": "self" }],
  "reason": "Runt Swarm: Gretchin units gain Battleline."
}
```

A keyword granted this way counts everywhere a printed keyword counts — the
unit limit of a list included.

> Adding or removing a detachment rule itself is not supported yet: which
> rules exist comes from 40kdc-data.

## Describe a rule that offers a choice

Some rules let the player pick one effect among several. Give the rule
**Options** — at least two — each with a name and its own Modifiers. The rule
then has no Modifiers of its own.

```json
{
  "target": "7422-7fbf-8694-364c::ability:Voice of the Triarch",
  "options": [
    {
      "name": "Phaeron of the Stars (Aura)",
      "modifiers": [
        { "key": "reroll-hit", "value": 1, "target": "aura", "range": 6 },
        { "key": "reroll-wound", "value": 1, "target": "aura", "range": 6 }
      ]
    },
    {
      "name": "Phaeron of the Blades (Aura)",
      "modifiers": [
        { "key": "S", "value": 1, "target": "aura", "range": 6, "conditions": [{ "key": "melee" }] }
      ]
    }
  ],
  "reason": "Describe the three choices of the ability."
}
```

In the apps, the player ticks the option they chose.

## Fix or describe a stratagem

**Where:** the stratagem's sheet. Core stratagems are on the **Core** sheet.

Two kinds of fields:

- **what 40kdc-data publishes** — name, **Cp**, **Phases**, **Player turn**
  (`your-turn`, `opponent-turn`, `either`), **Timing** (`once-per-phase`,
  `once-per-turn`, `once-per-battle`, `unlimited`), **Category**
  (`battle-tactic`, `strategic-ploy`, `epic-deed`, `wargear`) and **Target**.
  Changing one writes a correction, source `40kdc`;
- **what it does** — Modifiers, Options, description. A contribution.

The **Target** says which units the stratagem can be used on, by keywords:
**all of** these, **at least one of** those, **none of** the last. The apps use
it to show a player only the stratagems that apply to the unit in front of them,
so it is the most useful field to fix.

**What is written** — for a target:

```json
{
  "target": "orks::stratagem:ere-we-go",
  "source": "40kdc",
  "patch": { "target": { "allOf": ["Infantry"], "anyOf": [], "noneOf": ["Gretchin"] } },
  "upstream": {},
  "reason": "…"
}
```

> A stratagem playable only in the Fight phase applies its Modifiers in melee
> only, and one playable only in the Shooting phase, to shooting only. You do
> not need to add a `melee` or `ranged` condition.

---

## Add an enhancement

**Where:** the detachment's sheet, **+** in the enhancements.

Fill in its name, points, whether it goes on a **character** (an enhancement
proper) or a **unit** (an upgrade), and its restrictions.

**What is written** — a correction with `__add` for its numbers, plus a
contribution if you described what it does.

## Change who can take an enhancement

**Where:** the enhancement's card on the detachment's sheet.

| Field | Meaning |
|---|---|
| **Applies to** | `character`, or `unit` for an upgrade |
| **Aura** | whether its effect is an aura |
| **Max targets** | how many units an upgrade can equip in one list |
| **Requires** | groups of keywords. The bearer needs **every** keyword of **one** group. `[["Warboss"], ["Mek", "Infantry"]]` reads: a Warboss, *or* a Mek that is also Infantry. Empty: no restriction |
| **Excludes** | keywords that forbid the bearer |
| **Leader to** / **Support to** | units for which the enhancement opens Leader or Support, by name |

**What is written** — a correction on the enhancement. Points, *leader to* and
*support to* override the MFM; the rest overrides 40kdc-data. When you change
both kinds at once, the tool writes two files, one per source.

## Give an enhancement a weapon

Some enhancements are a weapon. On the enhancement's card, **Take it from**
picks a weapon the army already has, as the source describes it; or describe it
yourself — name, kind, profiles. Its cost stays the enhancement's.

**What is written** — a contribution with a `weapon`:

```json
{
  "target": "orks::enhancement:<detachment>|<enhancement>",
  "weapon": { "name": "…", "kind": "melee", "profiles": [ "…" ] },
  "reason": "…"
}
```

---

## Change a battle size

**Where:** the **Core** sheet, **Battle sizes**.

| Field | Meaning |
|---|---|
| **Points** | the size of the game: 1000, 2000 |
| **Name** | `Incursion`, `Strike Force` |
| **Detachment points** | the budget of detachment points at this size |
| **Enhancement limit** | how many enhancements a list may hold |
| **Unit limit** | how many copies of one unit (doubled by the apps for Battleline and Dedicated Transports) |

**What is written:** the whole list, in `authored/wh40k-11e/battle-sizes.json`.

## Write or change an ally rule

An **ally rule** lets a list include units from outside its army: Agents in an
Imperium army, a Knight alongside another faction. No source publishes them.

**Where:** the **Core** sheet, **Ally rules**.

| Field | Meaning |
|---|---|
| **Name** | the rule's name, also shown as a badge on allied units |
| **Armies** | the only armies that may use it. Empty: every army… |
| **Except armies** | …except these |
| **Requires** | keywords every *other* model of the list must have at least one of (`Imperium`) |
| **Admits** | which units it lets in — by **faction keyword**, by **keyword**, or by **unit name**. One match is enough |
| **Limits** | per battle size: how many units per kind (`Retinue`, `Character`…), and/or a total of points |
| **Models one of** | one family of models only, within its limit, at any size: one `Titanic` *or* three `Armiger` |
| **Battleline ratio** | for these keywords, non-Battleline units may not outnumber Battleline ones |
| **No warlord** | an admitted unit is never the warlord |
| **No enhancements** | an admitted unit takes no enhancement |
| **Assigned cost** | an admitted unit pays its *Assigned Agent* price |
| **Army rules inactive** | the army rules of an admitted unit do not apply |
| **Transport reminder** | reminds that an admitted Dedicated Transport must start the battle with a unit embarked |

**What is written** — `authored/wh40k-11e/ally-rules.json`:

```json
{
  "id": "assigned-agents",
  "name": "Assigned Agents",
  "exceptArmies": ["agents-of-the-imperium"],
  "requires": ["Imperium"],
  "admits": { "factionKeywords": ["Agents of the Imperium"] },
  "limits": [
    { "battleSize": 1000, "units": [{ "keyword": "Retinue", "max": 1 }, { "keyword": "Character", "max": 1 }] },
    { "battleSize": 2000, "units": [{ "keyword": "Retinue", "max": 2 }, { "keyword": "Character", "max": 2 }] }
  ],
  "assignedCost": true,
  "transportReminder": true,
  "reason": "Any Imperium army may include Agents, at the Assigned Agent cost, up to a number of units set by the battle size."
}
```

A rule that names an army, a keyword or a unit the dataset does not have is
listed in the build report under *Authored entries not found*: it applies
nothing until it is fixed.

---

## Undo a pending change

In **Pending changes**, click **−** on the line. The element goes back to its
published state. This works until you propose; after that, the pull request is
where to discuss it.

## Delete a correction that is no longer needed

When a correction is **stale** — the source now says the same thing — it should
go.

1. Open the sheet, click **Corrections (n)**; or click the **Corrections**
   counter in the left column for the whole dataset.
2. Click **Delete** on the correction, and confirm.
3. It appears in **Pending changes** as *removed*. Build and propose it like any
   other change.

You can also get there by editing: put a field back to the source's value and
save — a correction that no longer forces anything is removed on its own.

## Tell the source, so it fixes itself

A correction is a patch on our side. The real fix is for the source to correct
itself — then every project using it benefits, and our correction can go.

1. In **Corrections (n)**, click **tell bsdata** (or **mfm**, **40kdc**). A
   prefilled issue opens on that project's GitHub page: the element, the
   current value, the proposed value, and your reason. Submit it.
2. When the source opens a pull request for it, paste its link in the box next
   to the button and press Enter. The link is kept on the correction
   (`upstreamPr`) and shown in reports.

## Enter a new Munitorum Field Manual before BSData does

A new MFM is out and its transcription has not followed. You can enter the
changes yourself, as corrections against the MFM:

1. **Update data.**
2. For each unit whose points change: open it, edit **Prices**, save. Same for
   enhancements on their detachment sheets. Give every save the same kind of
   reason: `MFM 1.5`.
3. **Save & Build**, then **Propose my change**.
4. Once merged, the maintainer publishes a release and gives the MFM version by
   hand: see [Maintaining the dataset](maintaining.md#when-you-are-ahead-of-the-sources).

A few days later the transcription catches up. The next **Update data** then
shows your corrections as **stale**, one by one: delete them. Any that shows
**in conflict** is a place where you and the transcription disagree — check the
official document.
