# Rules and Modifiers

The dataset never holds the text of a rule. It holds what the rule **does**, in
a form small enough to check and structured enough for an app to simulate.
This page explains that form.

## A rule has three ways of saying what it does

Every rule — army rule, detachment rule, stratagem, enhancement, unit ability —
has the same shape:

| Part | What it is | Required? |
|---|---|---|
| **name** | the rule's name | always |
| **summary** | one line, at most 160 characters, **written by you in your own words** | optional |
| **modifiers** | a list of structured changes the rule makes | optional |
| **options** | for a rule that offers a choice: named options, each with its own modifiers | optional |

A rule with neither summary nor modifiers is shown by its name, and the player
looks it up in their codex. That is always acceptable. **A wrong Modifier is
worse than none**: when in doubt, write a summary, or nothing.

### Writing a summary

A summary is a reminder for someone who knows the rule, not a replacement for
it.

| Good | Refused, or not acceptable |
|---|---|
| `+1 to hit in melee while riled up` | a sentence copied from the datasheet |
| `Must be the warlord` | the same sentence with words swapped — rewording is still copying |
| `Enemy attacks: AP worse by 1` | anything over 160 characters |

The automatic check refuses long prose and phrasing typical of rules ("each
time", "until the end of", "this unit can", "roll one D6"…). It cannot tell
whether a short sentence was copied: that part is on you.

## A Modifier

A Modifier is **one change** a rule makes. A rule that does two things has two
Modifiers.

| Field | Meaning | Example |
|---|---|---|
| **key** | *what* changes | `hit`, `AP`, `feel-no-pain` |
| **value** | *by how much* — optional, a status needs none | `1`, `-1`, `5+`, `all` |
| **target** | *who* is affected | `self`, `attached`, `aura`, `enemy` |
| **range** | for an aura: its range in inches | `6` |
| **keywords** | which units among the target, by keyword | all of `Orks` |
| **conditions** | *when* it applies; all must hold | `melee` |

Read one aloud: *key* `hit`, *value* `1`, *target* `self`, *condition* `melee`
— "+1 to hit, for this unit, in melee".

### Keys the simulation plays

These keys change the simulation's result. In the interface they come first in
the autocomplete.

**On the attacks of the affected unit**

| Key | Value | Meaning |
|---|---|---|
| `hit` | a number | added to the hit roll: `1`, `-1` |
| `wound` | a number | added to the wound roll |
| `A` | a number | added to Attacks |
| `S` | a number | added to Strength |
| `AP` | a number, **written as on a datasheet** | `-1` improves AP by one; `1` worsens it by one |
| `D` | a number | added to Damage |
| `reroll-hit` | `1` or `all` | re-roll hit rolls of 1, or all failed hit rolls |
| `reroll-wound` | `1` or `all` | same, for wound rolls |
| `crit-hit` | a threshold | critical hits on this roll: `5+` |
| `crit-wound` | a threshold | critical wounds on this roll: `5+` |
| `lethal-hits` | none | grants Lethal Hits |
| `sustained-hits` | a number, 1 when absent | grants Sustained Hits |
| `devastating-wounds` | none | grants Devastating Wounds |
| `twin-linked` | none | grants Twin-linked |
| `ignores-cover` | none | grants Ignores Cover |

**On what the affected unit suffers**

| Key | Value | Meaning |
|---|---|---|
| `feel-no-pain` | a threshold | `5+`. With several sources, the best one applies |
| `damage-reduction` | a number, 1 when absent | each attack's damage reduced by that much |
| `stealth` | none | Stealth |
| `cover` | none | Benefit of Cover |
| `fight-on-death` | a threshold, or none | a model destroyed before its unit fought still fights on this roll (`4+`); with no value, without a roll |
| `fight-on-death-roll` | a number | added to that roll, usually under a condition |

For `hit`, `wound`, `A`, `S`, `AP` and `D`, the simulation plays plain numbers
only. A dice value such as `D3` is accepted in the dataset, and ignored by the
simulation.

**On the unit itself**

| Key | Value | Meaning |
|---|---|---|
| `gain-keyword` | a keyword — required | the unit gains this keyword, which then counts everywhere a printed keyword counts: `Battleline` doubles its unit limit |

### Any other key

The vocabulary is **open**: you may write a key the simulation does not know —
`move`, `charge`, `reroll-charge`, `advance`… It is accepted, kept, and shown
in the rule's display. It changes nothing in the simulation, and it is listed
under **Unsimulated keys** in the left column so that someone can either fix a
typo or teach the simulator the key.

So before inventing a key:

1. check the autocomplete — the key may exist, or someone may have used one for
   the same idea already;
2. write it in lower case with hyphens: `reroll-charge`, not `Reroll Charge`.
   A key holds letters, digits and hyphens only, 40 characters at most.

### Values

| Form | Used for | Examples |
|---|---|---|
| a number | additions and subtractions | `1`, `-1`, `2` |
| a threshold | a roll to reach | `5+`, `4+` |
| dice | a random amount | `D3`, `D6+1`, `2D6` |
| `1` or `all` | re-rolls | `1` = ones only |
| a keyword | `gain-keyword` only | `Battleline` |
| nothing | a status: the key says it all | `stealth`, `lethal-hits` |

### Targets

| Target | Who is affected |
|---|---|
| `self` | the unit that carries the rule |
| `attached` | the unit it is attached to — a Leader's bodyguard, or the Leader for a bodyguard's rule |
| `aura` | friendly units within `range` inches |
| `enemy` | the opponent: the unit it attacks, or the unit attacking it |

`enemy` works in both directions, by the nature of the key:

- an **attack** key on `enemy` weakens the attacks **made against** the unit:
  `AP 1` on `enemy` — attacks against this unit have their AP worsened by one;
- a **defence** key on `enemy` applies to the unit **it attacks**.

### Keywords: narrowing the target

A keyword filter picks units among the target. It has three lists:

| List | The unit must have… |
|---|---|
| **all of** | every keyword listed |
| **any of** | at least one of those listed (ignored when empty) |
| **none of** | none of those listed |

`all of: Orks, Infantry` · `none of: Gretchin` reads "Orks Infantry that are
not Gretchin". Keywords and faction keywords both work, and capitals do not
matter.

### Conditions

A condition says when the Modifier applies. Several conditions must **all**
hold.

**Conditions the simulation works out by itself**

| Key | Value | Holds when |
|---|---|---|
| `melee` | — | the attack is a melee attack |
| `ranged` | — | the attack is a shooting attack |
| `target-keyword` | a keyword | the unit attacked has that keyword: `Vehicle` |
| `charged` | — | the unit charged this turn |
| `stationary` | — | the unit remained stationary |
| `half-range` | — | the target is within half range |

**Situations**

Any other condition is a **situation**: something the simulation cannot know,
which the player switches on once for the whole simulation. `waaagh` for "the
Waaagh! is active", `riled-up`, `below-half-strength`…

A situation is recognised by its exact spelling: `riled-up` and `Riled-up` are
two different switches for the player. Use the autocomplete, and prefer lower
case with hyphens.

A stratagem that can only be played in the Fight phase applies in melee without
a `melee` condition; one that can only be played in the Shooting phase, to
shooting.

## Options: a rule that offers a choice

When the player chooses one effect among several, the rule carries **Options**
instead of Modifiers. Each option has a name and its own Modifiers. A rule has
either none, or at least two.

In the apps, the player ticks the option chosen for the battle.

## Eligibility: which units benefit

A **detachment rule** may carry an eligibility — a keyword filter with the same
three lists. Absent, every unit of the list benefits.

Eligibility says *who the rule is for*; a Modifier's keywords say *who that one
change applies to*. Use eligibility for "this rule is for Gretchin units", and
a Modifier's keywords for "…and its aura only helps Infantry".

## Worked examples

**"+1 to hit in melee while a situation is active"**

```json
{
  "modifiers": [
    { "key": "hit", "value": 1, "target": "self",
      "conditions": [{ "key": "melee" }, { "key": "riled-up" }] }
  ],
  "summary": "+1 to hit in melee while riled up"
}
```

**"Attacks against this unit have their AP worsened by 1"**

```json
{ "modifiers": [{ "key": "AP", "value": 1, "target": "enemy" }] }
```

**"The unit this character leads re-rolls hit rolls of 1"**

```json
{ "modifiers": [{ "key": "reroll-hit", "value": 1, "target": "attached" }] }
```

**"Friendly Orks units within 6" get +1 to hit and to wound in melee"**

```json
{
  "modifiers": [
    { "key": "hit", "value": 1, "target": "aura", "range": 6,
      "keywords": { "allOf": ["Orks"], "anyOf": [], "noneOf": [] },
      "conditions": [{ "key": "melee" }] },
    { "key": "wound", "value": 1, "target": "aura", "range": 6,
      "keywords": { "allOf": ["Orks"], "anyOf": [], "noneOf": [] },
      "conditions": [{ "key": "melee" }] }
  ]
}
```

**"+1 to wound against Vehicles when shooting"**

```json
{
  "modifiers": [
    { "key": "wound", "value": 1, "target": "self",
      "conditions": [{ "key": "ranged" }, { "key": "target-keyword", "value": "Vehicle" }] }
  ]
}
```

**"Lethal Hits for this unit, and critical hits on 5+"** — two things, two
Modifiers:

```json
{
  "modifiers": [
    { "key": "lethal-hits", "target": "self" },
    { "key": "crit-hit", "value": "5+", "target": "self" }
  ]
}
```

**"A model destroyed in melee fights on a 4+, on a 3+ while a situation is
active"** — one roll, a threshold and a bonus:

```json
{
  "modifiers": [
    { "key": "fight-on-death", "value": "4+", "target": "self" },
    { "key": "fight-on-death-roll", "value": 1, "target": "self",
      "conditions": [{ "key": "riled-up" }] }
  ]
}
```

**"In this detachment, Gretchin units are Battleline"** — on a detachment rule:

```json
{
  "eligibility": { "allOf": ["Gretchin"], "anyOf": [], "noneOf": [] },
  "modifiers": [{ "key": "gain-keyword", "value": "Battleline", "target": "self" }]
}
```

**Something the simulation does not play** — say so in the summary, and use an
honest key:

```json
{
  "modifiers": [{ "key": "move", "value": 2, "target": "aura", "range": 6 }],
  "summary": "+2\" Move for friendly units within 6\""
}
```

## Core abilities are not rules here

Feel No Pain, Deep Strike, Stealth, Lone Operative, Scouts, Infiltrators,
Fights First, Deadly Demise, Firing Deck and Hover are not written as rules.
When the build recognises one on a datasheet, it puts it on the unit as a
**status** — a Modifier on `self`, such as `feel-no-pain: 5+` or `scouts: 6`.
You do not write them.

A unit has statuses only when BSData links the core ability to the datasheet in
the form the build recognises; a unit without any simply has no `statuses`
field. If a unit is missing one that matters, describe it on the ability that
grants it, like any other rule.

Weapon abilities (Lethal Hits, Rapid Fire…) stay on the weapon profiles, as
keywords.

## Where a rule's Modifiers are stored

Whatever sheet you edit them on, Modifiers, Options, eligibility and summaries
are saved as **contributions** in `authored/wh40k-11e/armies/<army>.json`, one
entry per rule, in the file of the army the rule belongs to. See
[Corrections and contributions](corrections-and-contributions.md#contributions).
