# Glossary

The project's own vocabulary. Game terms (Battleline, Leader, Feel No Pain…)
keep the meaning the game gives them.

| Term | Meaning |
|---|---|
| **Ally rule** | what lets a list include units from outside its army (Assigned Agents, Freeblades…). Written by this project |
| **Army** | a playable faction with its own file: `orks`, `space-marines`. A chapter with its own catalogue is an army |
| **Authored** | written by this project rather than taken from a source: the `authored/` folder |
| **Battle size** | a game size — its points, detachment point budget and limits |
| **BSData** | the community project publishing datasheets as data. Trusted for profiles, weapons, options and keywords |
| **Build** | producing the dataset files from a snapshot of the sources, the corrections and the contributions |
| **Check** | verifying a dataset against the schema and the no-rules-text rule |
| **Contribution** | something this project writes and owns: what a rule does, a wargear option's cost link, an ally rule, a battle size. Not waiting for any source to catch up |
| **Core** | what holds for every army: core stratagems, battle sizes, ally rules. One file, `core.json`; one sheet in the interface |
| **Correction** | a small file overriding what one source says about one element, with the reason, and what the source said at the time |
| **Dataset** | the published data: the files of `wh40k-11e/`, read by the apps |
| **Dataset repository** | where the dataset, the corrections and the contributions live: [PaintPlanPlay/dataset](https://github.com/PaintPlanPlay/dataset) |
| **Dataslate** | a rules period, bounded by a Munitorum Field Manual version. Releases are grouped by dataslate |
| **Derived** | computed by the build from another value, so not editable: base points from the price grid, range in inches from the range |
| **Disagreement** | two sources giving different values for the same field. The trusted one wins; the other is reported |
| **Drift report** | what a build changes in the published dataset, and what deserves a look before merging |
| **Eligibility** | the units a detachment rule is for, as a keyword filter |
| **Frozen** | a dataslate that receives no more releases, because a newer one exists |
| **Game system** | a wargame at a given edition: `wh40k-11e`. Everything is filed under it |
| **Keyword filter** | three lists of keywords — all of, any of, none of — that pick units |
| **Manifest** | `manifest.json`: which release the apps should read, for each dataslate |
| **MFM** | the Munitorum Field Manual, as transcribed by BSData. Trusted for points and everything it lists |
| **Modifier** | one change a rule makes: a key, a value, a target, conditions |
| **Option** (of a rule) | one exclusive choice of a rule that offers several, with its own Modifiers |
| **Orphaned** | a correction whose target no longer exists |
| **Pending change** | something saved on your machine and not proposed yet |
| **Price band** | the MFM price of a unit for a range of copies in one list: "1st to 3rd", "4th and following" |
| **Pull request** | a proposal to change the dataset repository, reviewed before it is merged |
| **Registry** | the file that remembers every identifier ever given, so identifiers never change |
| **Release** | a frozen, tagged state of the dataset repository. The apps only read releases |
| **Schema** | the exact description of what a dataset file may contain |
| **Sheet** | the form for one entity in the interface: a unit, a detachment, a stratagem, an army rule, Core |
| **Situation** | a condition the simulation cannot work out, which the player switches on: `waaagh`, `riled-up` |
| **Snapshot** | a frozen copy of the three sources, each at a known commit. A build reads only that |
| **Stale** | a correction the source has caught up with: it can be deleted |
| **Status** | a core ability carried by a unit as a Modifier on itself |
| **Summary** | a one-line description of a rule, written by this project in its own words |
| **Target** (of a correction or contribution) | the address of the element it applies to: `orks::enhancement:blitz-brigade\|targetin-gizmos` |
| **Target** (of a Modifier) | who the change applies to: `self`, `attached`, `aura`, `enemy` |
| **Target** (of a stratagem) | the units it can be used on, as a keyword filter |
| **Unsimulated key** | a Modifier key the simulation does not play |
| **Upstream source** | one of the three projects the dataset is built from: BSData, the MFM, 40kdc-data |
| **Wargear cost** | the link from a wargear option to the MFM line that bills it |
| **Wargear option** | one choice of a group of wargear options on a datasheet |
| **Weapon profile** | one way of using a weapon: its range, characteristics and keywords |
| **40kdc-data** | the community project publishing detachments, stratagems and their structure. Trusted for which rules and stratagems exist |
