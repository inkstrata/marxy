# Reconciliation: mock-v2, the direction and the roadmap

**In short.** The author's rulings of 2026-10-10: build the mockup in `mock-v2/` (the iteration after
Galley, reviewed through pages 01, 02, 03, 07 and 08); the ADR changes are approved; the clipboard
is in scope and essential. Where `mock-v2/` and documents 01 to 04 disagree, **the mockup wins**,
except where it breaks a commitment in `AGENTS.md`; those exceptions are listed below. This page is
authoritative over 01 to 04 until they are rewritten to match it, and 05 is already updated.

## The rulings

| Question (README) | Ruling |
| --- | --- |
| 1. Reverse ADR-0050 and ADR-0011 | Yes: [ADR-0058](../../adr/0058-the-fold-up-workspace.md), accepted |
| 2. Lift "library browsing" | Yes: [ADR-0062](../../adr/0062-the-library.md), accepted; `docs/brief.md` updated |
| 3. Unfolded state on launch | The proposal stands: windows open folded, panels remembered (ADR-0058 item 4) |
| 4. Default dark theme | **Night** (the author, 2026-10-10), with Paper for light; Ink moves to its own theme directory |
| 5. Capture rules | Yes: [ADR-0063](../../adr/0063-capture-rules.md), accepted |
| New: the clipboard | **Clipboard-facing features are essential** (copy, Copy as targets, paste as Markdown or scratch, Transform, Extract, Export): [ADR-0065](../../adr/0065-the-clipboard.md), accepted; Phase J. **The studio page is not a sufficient design:** history, workbench, snippets, ring and stack wait for a design story (J-D1). This matches `02`'s descoping of the studio and the stack |

ADR numbers moved: 0056 is taken by the pull-request-path ADR (#450) and 0057 by the two-column
split, so the direction's records are 0058 to 0065 (table in [05](05-plan.md#decision-records)).

## Where the mockup changes the direction documents

Rows 1 to 4 came from Galley's defaults rather than a ruling; the author ruled them on 2026-10-10,
keeping what has shipped.

| # | Topic | 01 to 04 said | Now (from mock-v2) |
| --- | --- | --- | --- |
| 1 | Palette key | `⌘P` | **Ruled:** `⌘K` opens the palette and `⌘P` stays as an alias; `⇧⌘P` opens it on commands |
| 2 | `/` in the palette | Content search | **Ruled: `/` stays content search** (shipped, C-17). Transforms are under `>` with the other commands; `⌘/` opens the palette there |
| 3 | `⌘E` | Toggle Read and Source | **Ruled: `⌘E` stays the toggle** (shipped, A-13). Extract stays in the verb menu and the palette, with no key of its own. `⌘1` to `⌘3` choose Read, Split and Source |
| 4 | Toolbar | No Transform button | **Ruled: a Transform button only** (`⌘/`). No Extract button; the author counts it scope creep |
| 5 | Collect stack | Dropped | Still dropped until the studio design (J-D1); the mock's *add to stack* and Stack tab are not built |
| 6 | Inspector tabs | Outline, Metadata, Versions, Links, Look | Outline, Metadata, Versions, Links. **No Look tab:** the typography panel lives on the Content types page in settings (mock 03 and 08) |
| 7 | Kinds | Nine, with `prose` as the default | The mock's twelve at v1: **article** (the default, replacing `prose`), report, book (paged), readme, docs, code, transcript, data, notes, changelog, log, terminal. `diff` and `html` stay from 03. Verse, slides and drama are later |
| 8 | Front matter as a signal | No authorship field is a signal | A **byline** (`author` with `published` or `source`) may point to `article`, because it says what shape a text has. `model`, `session`, `generated_by` and anything naming a tool are still never signals |
| 9 | Type sizes | Code 16/26, data, log, terminal 15/24 | The mock's smaller monospace sizes (13 to 14 px), each rounded to a whole even-pixel line box (ADR-0030) and checked against `reader-typography/07-content-types.md` by the story that applies it |
| 10 | README badges | One muted line | Drawn locally as the mock shows; no remote image is fetched (ADR-0044) |
| 11 | Theme schedules | Leave | Later; `variant = "auto"` meanwhile |
| 12 | Sidebar | Four sections | Add **Library** (opens the library view) and **Smart collections** (saved queries) |
| 12a | Export | The brief excluded export | Lifted: local export (PDF, image, HTML, Word, clean Markdown) from the workspace, W-15 |
| 13 | Capture destination | Any `to` folder | Unchanged; the mock's `~/Inbox` is one declared folder the reader may choose |

## Where the commitments win over the mockup

| Mockup | Why not | Instead |
| --- | --- | --- |
| *Share usage statistics* switch (08-settings) | Commitment 2: no telemetry, in any form | Removed |
| *Check for updates automatically*, on, daily | Nothing leaves without a reader action (ADR-0044) | *Check for updates* as a command and an off-by-default setting, named on the Privacy page |
| `settings.json` and a SQLite `marxy.db` | Commitment 3: Marxy's state in plain files | `config.toml` and `collection.toml` as today |
| Optional remote link checks | ADR-0044 | Path checks on disk only |
| "A background pipeline finished" notification | Close kin of the agent toast the strip list removes | A pipeline's result is the clipboard; nothing announces it |

## The mockup's own stale lines

Round 6 of the mockup settled these; older text in the mock still says otherwise. Build from the
newer side and do not copy the stale lines into stories:

- A copy button on every block (`06-clipboard.md:3`, `01-workspace.md:88`, `README.md:62`,
  `FEATURES.md:228`): only code blocks get one; selections get Copy with a chevron.
- Minimap, gutter problem markers and the Problems, Unsaved changes, Edit history and Selection
  panels (`FEATURES.md:98-112`): gone, per `02-source.md:38`.
- A wavy underline under a missing path (`01-workspace.md:150`): never; a right-edge mark and the
  Links tab.
- Copy as in the report tool strip (`03-content-modes.md:50`): not in strips.

## How it meets the roadmap

Phase D finishes as planned: its two panes become the workspace's Split (ADR-0058 item 7). Phase E
is redistributed rather than run whole:

| Phase E | Goes to |
| --- | --- |
| E-01 to E-11 (operations, block editing) | Run as planned; their operations are the first entries in the transform library (J-03) |
| E-12, E-14, E-15 (clipboard HTML to Markdown, paste as scratch) | Phase J, after the clipboard capability (J-02) |
| E-13 (scratch document) | Runs as planned; W-14 builds New file on it |
| E-16, E-17 (line diff, what changed) | Run as planned; Phase V's Versions tab builds on them |
| E-18 (screen criterion) | Narrowed to E-01 to E-11 and E-13 |

Phase H (the look) and the ADR stories start now, beside D. The workspace (W) starts when D-14 has
closed the split.
