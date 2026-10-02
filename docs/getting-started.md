# Getting started

This page takes you from nothing to your first proposed fix. It assumes you
play Warhammer 40,000 and have never opened a terminal. If you already know
git and Node.js, the [Quick start](../README.md#quick-start) is enough.

Budget about twenty minutes the first time, most of it waiting for downloads.

## What you are about to do

1. Install three free programs.
2. Download the Dataset Tool and start it.
3. Let it fetch the data.
4. Fix one value in a form.
5. Send the fix for review.

Nothing you do can break the published dataset: your changes stay on your
machine until you propose them, and a maintainer reads every proposal before it
is merged.

## 1. Install the three programs

| Program | What it is for | Where to get it |
|---|---|---|
| **Node.js** 24 or newer | runs the tool | <https://nodejs.org> — take the LTS installer |
| **git** | downloads the tool and the dataset, and keeps track of your changes | <https://git-scm.com> |
| **GitHub CLI** (`gh`) | sends your changes to GitHub without asking for a password | <https://cli.github.com> |

You also need a free [GitHub account](https://github.com/signup): that is where
the dataset lives and where your proposal is reviewed.

**Windows.** The buttons of the interface run their tasks through a Unix shell
(`sh`), which the plain Command Prompt and PowerShell do not provide. Use
[WSL](https://learn.microsoft.com/windows/wsl/install) and install the three
programs inside it, or run every command below from **Git Bash**, which the git
installer adds to the Start menu.

**macOS.** With [Homebrew](https://brew.sh): `brew install node git gh`.

**Linux.** Use your package manager, and check that Node.js is recent enough
(next step); distribution packages are often older than 24.

## 2. Open a terminal and check

A terminal is a window where you type a command and press Enter.

- Windows: **Git Bash**, or your WSL distribution (for example *Ubuntu*)
- macOS: **Terminal** (in Applications → Utilities)
- Linux: **Terminal**

Type these three commands, one at a time:

```bash
node --version
git --version
gh --version
```

Each prints a version number. `node` must say `v24` or more. If a command
answers "not found", that program is not installed — or the terminal was open
before you installed it: close it and open a new one.

## 3. Sign in to GitHub, once

```bash
gh auth login
```

Answer **GitHub.com**, **HTTPS**, **Yes** to authenticating git, and **Login
with a web browser**. It shows a short code, opens your browser, and you paste
the code there. You never have to do this again on this machine.

GitHub stopped accepting passwords for git in 2021; the tool borrows this login
instead of asking you for one.

## 4. Download the tool and start it

```bash
git clone https://github.com/PaintPlanPlay/dataset-tool.git
cd dataset-tool
npm ci
npm run dev -- --allow-push
```

Line by line:

- `git clone …` downloads the tool into a new folder named `dataset-tool`;
- `cd dataset-tool` moves into that folder;
- `npm ci` installs what the tool needs (a minute or two, only the first time);
- `npm run dev -- --allow-push` starts the interface. `--allow-push` lets it
  send your proposal to GitHub when you click the button; without it you can
  still look and edit, but **Propose my change** stays greyed out.

The terminal prints `Local interface: http://127.0.0.1:4173/`. Leave that
window open — closing it stops the tool — and open that address in your
browser, on a desktop screen at least 1200 pixels wide.

The address starts with `127.0.0.1`: that is your own machine. Nobody else can
reach the page.

## 5. Fetch the data

The page starts empty. In the left column, click **Update data**.

It downloads the dataset as published, and a fresh copy of the three sources
(BSData, the Munitorum Field Manual, 40kdc-data). A log scrolls under the
buttons; it takes a few minutes. When it ends, the left column shows the
versions you are working from and a green line: *Up to date with the Upstream
Sources and the Dataset*.

Everything it downloaded lives in a `.workspace` folder inside `dataset-tool`.
Deleting that folder resets you to a clean slate.

## 6. Your first fix

Say the Munitorum Field Manual lowered a unit by five points and the dataset
has not followed yet.

1. In the search box at the top, type the unit's name and pick it. Use the army
   filter next to the box if the same name exists in several armies.
2. The unit's **sheet** opens: a form with one section per kind of data. Each
   section says where its values come from — *Prices · MFM*, *Weapons · BSData*.
3. In **Prices**, change the points. An **orange dot** appears next to the
   value: changed, not saved yet.
4. Click **Save** (top right). A box asks *Why?* — answer in one sentence of
   your own, for example `MFM 1.5 lowers this unit to 85 points`. This sentence
   is published with your fix; never paste rules text into it.
5. The change now appears under **Pending changes** in the left column. It
   exists on your machine only. The **−** next to it undoes it.
6. Click **Save & Build**. The tool rebuilds the dataset with your change and
   checks it. Wait for the log to end with `✔ schema valid, no rules text`.
7. Click **Propose my change**, give your proposal a short name — what a
   maintainer will read in the list, such as `Boyz down to 85 points` — and
   confirm.

The left column now shows *Pull request #… in review*, with a link. A
maintainer reads it, may ask a question there, and merges it. Your fix reaches
the apps with the next release.

What you just did, in the project's words: you wrote a **correction**. The tool
created one small file saying *for this unit, the Munitorum Field Manual says
90, it should be 85, and here is why*. [Recipes](recipes.md) shows that file,
and many other fixes.

### If you are not a member of the project

**Propose my change** pushes a branch to the dataset repository, which only
members can do. If the push is refused, you have two ways in:

- **Without installing anything more:** create the correction file straight on
  the GitHub website, as described in
  [Corrections and contributions](corrections-and-contributions.md#writing-a-correction-by-hand).
  GitHub makes a copy of the repository for you and walks you through the pull
  request.
- **With the tool:** fork <https://github.com/PaintPlanPlay/dataset> on GitHub
  (the **Fork** button), then start the tool on your fork — in an empty
  workspace, so delete `.workspace` first if you already clicked Update data:

  ```bash
  npm run dev -- --allow-push --repo https://github.com/<your-name>/dataset.git
  ```

  The push then goes to your fork. If the pull request is not opened for you,
  open it from your fork's page on GitHub: it offers a **Compare & pull
  request** button. Before each session, press **Sync fork** on that page:
  **Update data** reads the dataset from your fork, which does not follow the
  project on its own.

## Next time

```bash
cd dataset-tool
npm run dev -- --allow-push
```

Then **Update data** before you change anything, so you never fix something
that is already fixed. Your pending changes survive an update, and are
re-checked against the fresh sources.

To stop the tool, go back to the terminal and press `Ctrl+C`.

## Keeping the tool itself up to date

The tool changes too. From the `dataset-tool` folder, with the tool stopped:

```bash
git pull
npm ci
```

If the left column then says *The Dataset files come from an earlier version of
this tool*, click **Save & Build**, then **Propose my change**: the files the
newer tool builds need to be published as well.

## Where to go next

- [The interface](interface.md) — what every part of the screen means.
- [Recipes](recipes.md) — step-by-step fixes for the usual cases.
- [Rules and Modifiers](rules-and-modifiers.md) — describing what a rule does.
- [Troubleshooting](troubleshooting.md) — when a button stays grey or a save is refused.
