# The interface

A tour of the screen. Start the tool with `npm run dev -- --allow-push` and
open `http://127.0.0.1:4173` (see [Getting started](getting-started.md)).

The screen has two columns: on the left, **the state of your copy** and the
buttons; on the right, **the sheet you are editing**.

**You never see JSON.** Every part of the dataset is drawn as a form: an object
is a card, a list has **+** and **−** buttons, and a field with a fixed set of
values is a menu.

## Left column: the state of your copy

### Versions

| Line | Meaning |
|---|---|
| **Dataset Release** | the release your copy follows, such as `wh40k-11e-mfm-1-5-r3` |
| **Dataslate** | the rules period it belongs to, such as `MFM 1.5` |
| **BSData** | the exact version (commit) of BSData in your snapshot |
| **MFM** | the Munitorum Field Manual version, and the commit of its transcription |

### Counters

Each number is a link.

| Counter | What it lists |
|---|---|
| **Corrections** | every correction and contribution of the dataset, with a filter by target, file or reason |
| **Disagreements** | where two sources disagree and the trusted one won. Nothing is broken: this is a list of places worth a look — sometimes the loser was right, and a correction is due |
| **To review** | imported readings of rules that differ from 40kdc-data's, or have no second reading. See [Maintaining the dataset](maintaining.md#reviewing-imported-rules) |
| **Unsimulated keys** | Modifier keys the simulation does not play — a typo to fix on the rule, or something the simulator has yet to learn |

### Freshness

A coloured line says whether you are working on current data:

- **green** — *Up to date with the Upstream Sources and the Dataset*;
- **red** — *Out of date*, with the reason: a source moved, the dataset has
  merged changes you do not have, or your dataset folder is still on the branch
  of an earlier proposal. **Update data** fixes all three;
- **grey** — *unknown*, usually because you are offline.

A second red line may say *The Dataset files come from an earlier version of
this tool*: rebuild and propose them (**Save & Build**, then **Propose my
change**).

### Pull request

Once you have proposed something: its number, a link, and its state — *in
review*, *merged* or *closed*.

### Buttons

A button that cannot run is greyed out, **with the reason written under it**.
Only one task runs at a time, and its log scrolls below the buttons.

| Button | What happens | Greyed out when |
|---|---|---|
| **Update data** | fetches the dataset as published and a fresh snapshot of the three sources. A few minutes. Your pending changes are kept, and re-checked against the new sources | everything is already up to date |
| **Save & Build** | rebuilds the dataset files with your pending changes, then checks them (schema, no rules text) | nothing is pending |
| **Propose my change** | asks for a name, then commits your pending changes to a branch, pushes it, and opens a pull request | nothing is pending; or the last successful build did not see exactly what is pending now — build again; or the tool was started without `--allow-push` |
| **Publish Release** | shown to maintainers only. See [Maintaining the dataset](maintaining.md#publishing-a-release) | nothing was merged since the last release |
| **Check** | runs the schema and no-rules-text checks now. They already run in every build and on every pull request | there is no dataset yet |

Why build before proposing? The build is the proof that your change produces a
valid dataset. If you edit anything after building, **Propose my change** greys
out again until you rebuild.

### Pending changes

Everything you saved and have not proposed yet. Each line shows *new*,
*changed* or *removed*, and what it applies to.

- Click a line to open its sheet.
- Click **−** to undo it: the element goes back to its published state.
- A line marked **stale** or **in conflict** needs a second look before you
  propose it: the sources moved under it. See
  [How it works](how-it-works.md#corrections-fixing-a-source).

## Right column: the sheet

### Finding a sheet

The search box looks across every army for:

- **units**,
- **detachments** — their rules and enhancements are edited on the detachment's
  sheet,
- **stratagems**,
- **army rules**,
- and **Core**: battle sizes, ally rules and the core stratagems.

Each result shows its army. The army filter next to the box is remembered by
your browser.

### The bar above the sheet

- the sheet's name, with a mark when it has **unsaved edits**;
- **Corrections (n)** — the corrections and contributions applied to this sheet;
- **Save**.

### Sections and their sources

Each section's title names the source its values come from: *Prices · MFM*,
*Weapons · BSData*, *Abilities · project*. This tells you, before you change
anything, which source you are about to override. On sheets other than a
unit's, one line under the bar lists the fields of each source.

A field is labelled with its name in the dataset, spaced out: `leaderTargets`
is shown as *Leader targets*, `dp` as *Dp*. The [Schema reference](schema.md)
says what each one means.

### Dots

| Dot | Meaning |
|---|---|
| **orange** | you changed this value and have not saved yet |
| **blue** | a published correction or contribution changed this value. Hover it for the source's value, the new value, and the reason |

### Derived values

Some values are computed by the build and shown greyed, not typed:

- a unit's **base points** and **cost brackets**, from its price grid;
- its **minimum and maximum model counts**, from its composition;
- a weapon's **range in inches**, from its range.

To change one, change what it derives from.

### Typing less

- Type `6` for a movement or a range: it becomes `6"`. Type `7` for a
  Leadership: it becomes `7+`.
- A **weapon keyword** is picked from the list of the game's weapon abilities,
  then given its value: *Rapid Fire* `2`, *Anti* `Vehicle` `4`. Keywords a
  weapon already had stay written the way BSData writes them.
- Keywords, unit names and Modifier keys autocomplete from what the army
  already has.

### Checked as you type

Every edit is checked against the schema and the no-rules-text rule. A problem
shows next to the field: an error (the save will be refused) or a warning that
the value reads like rules text (refused as well when you save).

### Saving

**Save** asks one thing: *why*, in one sentence, shared by every change on the
sheet. Then the tool:

1. compares your sheet with the built dataset;
2. splits the difference into one **correction** per element and per source,
   and **contributions** for what the project owns;
3. checks every file (schema, no rules text, and that names you typed exist —
   a unit you attach a leader to, a weapon an option equips);
4. writes them all, or none: if anything is refused, nothing is written and
   the offending field is pointed out.

File names are made up for you.

Leaving a sheet with unsaved edits asks whether to save, discard or stay.

### Corrections (n)

Lists what is applied to the open sheet. For each entry: its state, its kind
(*Correction · mfm*, *Contribution · project*), its reason, the values it
forces, and its file.

- **tell bsdata / mfm / 40kdc** opens a prefilled issue with that source, so it
  can fix itself. Paste the link of the pull request the source opens in the
  box next to it: it is recorded on the correction and shown in reports.
- **Delete** removes the correction. This is itself a pending change —
  proposed and reviewed like any other, and undoable until then.

## The unit sheet, section by section

| Section | What you edit there |
|---|---|
| header | name, **Legends**, **Ally**; base points and model counts are shown, derived |
| **Models** | one line per kind of model: M, T, Sv, Inv, W, LD, OC, and its **Count** (minimum and maximum in the unit) |
| **Prices** | the MFM price grid: one row per band of copies ("1st to 3rd", "from the 4th"), and in each row the cost per unit size |
| **Assigned Agent prices** | shown when the MFM lists a second price for the unit as an allied Agent |
| **Abilities** | each ability by name, with what it does: Modifiers, Options, a description |
| **Wargear costs** | the MFM lines that bill wargear (`Zzap Gun: 10`), and which option each one bills |
| **Weapons** | each weapon with all its profiles |
| **Wargear Options** | the wargear choices, group by group: for each option, its weapons, how many models may take it, whether it is the default, the MFM line that bills it, the abilities it brings. The **+** of a group adds an option BSData does not have — a contribution |
| **Keywords**, **Faction keywords**, **Army rules**, **Leader targets**, **Support targets** | lists, with autocomplete |

[Recipes](recipes.md) walks through each of these.

## The detachment sheet

- **Name**, **Dp** (detachment points), **Force dispositions**, **Unique tag**;
- **rules** — each with its Modifiers, Options, eligibility and description;
- **enhancements** — points, whether it goes on a character or a unit, aura,
  how many units, required and excluded keywords, the units it opens Leader or
  Support for, what it does, and the **weapon** it brings, if any (*Take it
  from* picks a weapon the army already has).

## The stratagem sheet

CP, phases, whose turn, timing, category, target keywords, and what it does.

## The Core sheet

- **battle sizes** — points, detachment points, enhancement limit, unit limit;
- **ally rules** — see [Recipes](recipes.md#write-or-change-an-ally-rule);
- **core stratagems**.
