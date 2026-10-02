# Troubleshooting

First reflex: **read the line under the greyed-out button**, and **the end of
the log** under the buttons. The tool says what it is waiting for.

## Installing and starting

**`node: command not found`, `git: command not found`, `gh: command not found`**
The program is not installed, or the terminal was opened before you installed
it. Close the terminal, open a new one, try again.

**`npm ci` fails with a message about the Node version**
Run `node --version`. The tool needs version 24 or newer.

**The page does not open**
The address is `http://127.0.0.1:4173` — `http`, not `https` — and the terminal
where you ran `npm run dev` must still be open. If the terminal says the port
is already in use, another copy of the tool is running: close it, or start this
one on another port with `npm run dev -- --port 4174`.

**The page is cramped or cut off**
The interface is made for a desktop screen at least 1200 pixels wide.

**On Windows, the buttons fail immediately**
The buttons run their tasks through `sh`. Start the tool from Git Bash or from
WSL. See [Getting started](getting-started.md#1-install-the-three-programs).

## Update data

**`GitHub 403 on …` in the log**
GitHub limits anonymous requests to 60 an hour. Start the tool with your GitHub
login to raise the limit:

```bash
GITHUB_TOKEN=$(gh auth token) npm run dev -- --allow-push
```

**"the Dataset folder could not be updated — it probably holds changes that are
neither proposed nor discarded"**
Your copy of the dataset has changes that git cannot carry over the update.
Propose them, or undo them from **Pending changes**. As a last resort, stop the
tool and delete the `.workspace` folder: you lose your unproposed changes and
start clean.

**"Out of date: the Dataset folder is on the branch dataset/…"**
After a proposal, the folder stays on that proposal's branch. Click **Update
data**: it goes back to the main line and takes in what was merged.

**The freshness line says "unknown (offline?)"**
The tool could not ask GitHub for the latest versions. You can keep working;
click **Update data** once you are back online.

## Saving a sheet

A refused save writes **nothing**, and the offending field is pointed out.

**"a reason is needed"** — the *Why?* box is empty.

**"the reason reads like rules text"** — the reason goes through the same guard
as everything else. Say why in your own words: `MFM 1.5`, `FAQ of September`,
`Checked against the datasheet`.

**"rules text refused"**, with a reason such as *long prose*, *summary too
long*, or *rules phrasing "each time"* — a value, usually a description, reads
like copied rules. Shorten it and say it your own way: `+1 to hit in melee`
rather than a sentence. Phrases such as "each time", "until the end of", "this
unit can", "roll one D6", "within 6" of" are refused even in a short line.

**"the sheet does not match the schema"** — a value has the wrong shape; the
message gives the field. Common cases: a save or a skill outside 2 to 7; an AP
above 0 (AP is zero or negative: `-1`); a key with spaces (use hyphens); a
description over 160 characters.

**"…is not a Unit of this Army"** — a leader or support attachment names a unit
the army does not have. Pick the name from the autocomplete.

**"…is not a Weapon of this Unit"** — a wargear option equips a weapon the unit
does not have. Add the weapon first, in **Weapons**.

**"…is not a weapon keyword of the rules"** — an added weapon keyword must come
from the list of the game's weapon abilities. Use the **+ add…** menu.

**"…is not an MFM wargear line of this Unit"** — the option's wargear cost
names a line that is not in **Wargear costs**. Add the line first.

**"adding or removing a Detachment Rule is not supported yet"**, **"adding or
removing a Core Stratagem is not supported yet"** — which rules and core
stratagems exist comes from 40kdc-data; you can only describe the existing
ones.

**"the name of an Army Rule comes from BSData: correct it on its Units"** — an
army rule's name is the one its units list under **Army rules**.

## Build and propose

**Save & Build is greyed out: "nothing to build: no pending change"**
You have saved nothing since the last proposal. Check that you clicked **Save**
on the sheet — an orange dot means *changed, not saved*.

**Propose my change is greyed out: "click Save & Build first: the build must
pass the check"**
A proposal is only possible for exactly what the last successful build saw.
You changed something since: build again.

**Propose my change is greyed out: "restart the interface with: npm run dev --
--allow-push"**
Stop the tool (`Ctrl+C`) and start it with that command.

**"The GitHub CLI is not usable by this interface"**
Run `gh auth login` in a terminal, then restart the tool. If `gh` works in your
terminal but not here, the tool was started from a place that does not see it:
start it from that same terminal.

**"push refused"**
Either the GitHub CLI is not signed in (above), or your account cannot write to
the dataset repository. See
[If you are not a member of the project](getting-started.md#if-you-are-not-a-member-of-the-project).

**"the pull request could not be opened — the push did go through"**
Your branch is on GitHub. Open the repository's page: GitHub offers a
**Compare & pull request** button for it.

**The build fails with "rules-text finding(s): nothing is written"**
Something in `corrections/` or `authored/` reads like rules text — possibly a
file written by hand. The log names the file and the field.

## After proposing

**A check failed on my pull request**
Open the failed check's details on GitHub. Each line names a file, then either
a schema error or a rules-text finding. Fix it in the tool — open the sheet,
correct, **Save**, **Save & Build**, **Propose my change** with the same name:
the same pull request is updated.

**A pending change is marked *stale***
The source now says what your correction says: it is no longer needed. Undo it
(**−**), or delete it if it was already published.

**A pending change is marked *in conflict***
The source changed to a value that is neither the old one nor yours. Open the
sheet, compare with the official document, and either correct again or undo.

**A contribution is marked *upstream changed***
40kdc-data changed its reading of that rule after ours was written. Ours is
still applied. Compare the two — the **To review** and **Corrections** lists
show them — and correct ours if theirs is right.

**My fix was merged but the app still shows the old value**
A merge is not a release. A maintainer must click **Publish Release**; after
that, the CDN may take a few minutes, and up to 12 hours if its copy of the
manifest was not refreshed.

## Starting over

Stop the tool, delete the `.workspace` folder inside `dataset-tool`, start the
tool, click **Update data**. Everything not yet proposed is lost; everything
proposed is safe on GitHub.
