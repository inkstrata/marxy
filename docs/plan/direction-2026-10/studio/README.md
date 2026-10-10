# The clipboard studio, designed to build

**Date:** 2026-10-10 · **Story:** J-D1 · **Status:** design for the author's ruling; nothing is built
from it until [ADR-0066](../../../adr/0066-clipboard-history.md) is ruled · **Read with:**
[ADR-0065](../../../adr/0065-the-clipboard.md), [06-reconciliation.md](../06-reconciliation.md),
[08-cards-studio.md](../08-cards-studio.md)

**In short.** The mockup's studio ([`mock-v2/06-clipboard.html`](../mock-v2/06-clipboard.html)) is
fifteen surfaces drawn as one window. This design keeps three for v0.7.0, as one view inside the
workspace called **Clipboard**: a **history** of what Marxy copied, a **workbench** that runs a chain
of transforms on any text, and **saved pipelines** written to `config.toml`. Their rules are a
**Clipboard section in Settings** with one Privacy line. History records where Marxy writes, so
nothing watches the pasteboard (ADR-0066, option A). The ring and the collect stack are designed here,
but neither is scheduled: the ring needs Accessibility permission and other apps' copies to be worth
building, and the collect stack stays dropped until the author rules on it. Everything else waits.

## Every surface, and its verdict

Build: built for v0.7.0 as the mock draws it, give or take detail. Change: built for v0.7.0, reshaped
to fit the commitments or the rulings. Leave: not built now; *later* names where it would go.

| # | Mock surface | Verdict | Why, in a line | Page |
| --- | --- | --- | --- | --- |
| 1 | The studio window (three columns, its own toolbar and status bar, `⇧⌘V`) | **change** | A view inside the workspace (ADR-0058), like Settings and the library, not a second window; at rest it is not there | [history](history.md) |
| 2 | History column: every app's copies, polled twice a second | **change** | Marxy's own copies only, recorded where Marxy writes; ADR-0065 item 3 forbids watching (ADR-0066) | [history](history.md) |
| 3 | History: search, type chips, From filter, groups, pins | **change** | Search and pins kept; chips cut to formats Marxy wrote; From goes with watching | [history](history.md) |
| 4 | History: Select several, Merge, Compare two | **change** | Multi-select keeps *Copy joined* (which gives the stack's result with no mode) and Delete; Compare two goes to the workbench later | [history](history.md) |
| 5 | History: *Not recorded* rows | **build** | Honest: a gap is shown, with source, reason and time, never the text; in memory only | [history](history.md) |
| 6 | Preview: Show original, Restore, Strip tracking, Use the text (OCR) | **leave** | Replace-in-place and OCR need watching or images; tracking removal is a transform (row 14) | — |
| 7 | Workbench: input, pipeline of steps, output Before/After/Diff/Rendered | **change** | Built on W-21's result sheet and J-03's library; Rendered view later; never writes back to a document | [workbench](workbench.md) |
| 8 | Workbench: Send to (Inbox, Share, Write back, Save as a file) | **change** | Copy, Copy as, *As input* and *Open as scratch document* (E-13) only; the rest is Export's job or later | [workbench](workbench.md) |
| 9 | Compare mode (two texts side by side) | **leave** | The workbench's Diff covers input against output; side by side belongs with Versions (V-06) and the library's compare (Q-05) | — |
| 10 | Side panel: Copy as tab with live previews | **change** | The Copy as menu J-04 builds, reached from the workbench's Copy chevron; no panel tab | [workbench](workbench.md) |
| 11 | Side panel: Pipelines tab; global shortcuts, Services, Shortcuts app, menu bar | **change** | Saved pipelines are `[[pipeline]]` tables in `config.toml` (ADR-0049's shape), run from the palette and an optional in-app key; global and system surfaces later | [workbench](workbench.md#saved-pipelines) |
| 12 | Side panel: Stack tab and collect mode (`⌥⌘K`) | **leave, designed** | 06 row 5 keeps it dropped; designed in Marxy only, for the author to rule | [collect](collect.md) |
| 13 | Side panel: Snippets, and expansion in other apps | **leave** | A reader's tool only weakly; system-wide expansion needs Input Monitoring and Accessibility | — |
| 14 | Clipboard rules sheet (limits, ignore apps, secrets, tracking, pause) | **change** | Rows in Settings › Clipboard over `config.toml`, plus Pause in the view; tracking removal becomes the transform `strip-tracking`, run by the reader | [rules](rules.md) |
| 15 | Transform catalogue (50 transforms) | **build** | Already J-03, with the mock's ids; the studio only chains them | [workbench](workbench.md#steps) |
| 16 | The ring (`⌥⌘V`, a non-activating panel over any app), synthesized `⌘V` | **leave, designed** | Needs a resident app, a native panel and Accessibility; with option A it holds only Marxy's copies | [ring](ring.md) |
| 17 | Studio status bar (recording, counts, stack, ring) | **change** | No counts in the workspace status bar (02); the view has one foot line saying where history is kept | [history](history.md#the-foot-line) |
| 18 | Studio keyboard map (`⌘?`) | **leave** | `⌘?` is the system Help search; the view's keys are listed in the palette like every other command | — |
| 19 | Image clips and recognised text (Vision OCR) | **leave** | Images in history need their own storage and privacy design | — |

## What v0.7.0 carries

v0.7.0 is the workspace (W) and J-06 (`05-plan.md`, milestones). The studio adds six build stories to
it, J-07 to J-12, in [08-cards-studio.md](../08-cards-studio.md); if the milestone is full, J-12
(saved pipelines) is the first to move to v0.8.0. Two more cards are written and held: J-13 (collect,
only if the author lifts 06 row 5) and J-14 (watching, only if the author chooses ADR-0066's option B).

## The Clipboard view in one paragraph

`⇧⌘V`, or `>Clipboard` in the palette, or *Clipboard history…* at the foot of the Copy chevron's menu,
opens the Clipboard view in the workspace. Unfolded, it is two panes: **History** on the left (300 px)
and the **workbench** on the right. Folded, or below 900 px, it is one column at the reading measure:
the history list, with the workbench taking its place when an item is opened, and a back control.
`Esc` closes it and returns to the document, at its reading position. Nothing of it shows at rest.

## Keys, checked against the rulings

Taken and not reused: `⌘K`, `⌘P`, `⇧⌘P`, `⌘/`, `/`, `⌘E`, `⌘1` to `⌘3`, `⌘\`, `⌘F`, `⌘C`, `⇧⌘C`,
`⇧⌘E`, `⌘S`, `⇧⌘S`, `⌘Z`, `⇧⌘Z`, `⇧⌘O`, `⌘N`, `⇧⌘N`, `⌘[`, `⌘]`, `⌘=`, `⌘-`, `⌘0`, `⌥⌘I`, `⌃⌘I`,
`⌃⌘S`, `⌥⌘R`, `⌥⌘C`, `⌥⇧⌘V` (paste as plain text, mock 08). The mock's own studio keys that collide
are dropped: `⌘E` (skip a step), `⌘1` to `⌘4` (focus a column), `⌘D` and `⌘R` (a step's view, run),
`⌘?` (keyboard map).

| Key | Scope | Action | Check |
| --- | --- | --- | --- |
| `⇧⌘V` | app | Open or close the Clipboard view | Free in the app and the plan; the mock's studio key. Some apps use it for paste-as-plain; Marxy uses `⌥⇧⌘V` for that |
| `⌘F` | Clipboard view | Focus history's search | Find's own key, scoped to the surface in front, as in the library |
| `↑` `↓` `Home` `End`, `⇧↑` `⇧↓`, `⌘A` | history list | Move, extend the selection, select all | List keys |
| `↵` | history list | Copy the item back to the clipboard | — |
| `⌥↵` | history list | Open the item in the workbench | — |
| `Space`, `⌥P`, `⌫` | history list | Preview, pin or unpin, delete (with Undo) | Only while the list has focus, so `⌥P` never types `π` |
| `⇧⌘A` | workbench | Add a step | Free in the app and the plan |
| `⌥↑` `⌥↓`, `Space`, `⌫` | step list | Move a step, skip or run it, remove it | `⌥↑` `⌥↓` select blocks in Read; here the step list has focus, so they do not reach Read |
| `⌘↵` | workbench | Copy the result | Free outside Source, where the mock's task toggle sits; the workbench's input is not Source |
| `Esc` | Clipboard view | Clear the search, then close the view | — |

Every key goes through the key registry W-19 builds, scoped as above, and every action is a palette
command under `>` in the group *Clipboard*. No global key (one that works while another app is in
front) is in v0.7.0. A saved pipeline's optional key is in-app only and checked against the same
registry ([workbench](workbench.md#saved-pipelines)).

## What it reads, what it writes, what it may never do

| | |
| --- | --- |
| **Reads** | The history Marxy recorded; the clipboard once, on a reader action (*Keep the clipboard*, *Paste in*, *Run pipeline*), types first, concealed refused (J-02); the text of the open document or selection, when the reader loads it into the workbench; `config.toml` |
| **Writes** | The clipboard, on a reader action; `<data>/clipboard/` in `keep` only; one appended `[[pipeline]]` table in `config.toml` when the reader saves a pipeline, every other byte unchanged |
| **Never** | Watches the pasteboard (unless the author chooses ADR-0066's option B); writes a document; sends anything off the machine; uses SQLite; stores a model, session, tool or tag name; counts uses for anyone; records a concealed or transient item or a likely secret |

## For the author

1. **ADR-0066's choice.** Option A (Marxy's own copies, no watching; recommended) or option B (opt-in
   watching of every app, off by default). The default `session`, and `keep` as the reader's choice.
2. **The collect stack.** Keep it dropped (recommended: history's *Copy joined* gives its result with
   no mode), or lift 06 row 5 and build J-13, the in-Marxy design in [collect.md](collect.md).
3. **The ring and its Accessibility permission.** Not in v1 (recommended). If it is wanted, it needs a
   resident Marxy, a native non-activating panel, and Accessibility only for *Paste into the front
   app*; without the permission the ring copies and the reader presses `⌘V` ([ring.md](ring.md)). Its
   mock key `⌥⌘V` is Finder's *Move Item Here*, so a global default would break Finder.

## Later

The ring; synthesized `⌘V` into other apps; watching (ADR-0066 option B); global pipeline keys, the
Services entry, the Shortcuts app intent and the menu bar extra (mock 09, already later); snippets and
system-wide expansion; images and recognised text in history; side-by-side Compare; the workbench's
Rendered view; *Replace clipboard* keeping the original; per-step timing; pipelines exported as JSON.

## Pages

| Page | What it holds |
| --- | --- |
| [history.md](history.md) · [html](history.html) | The Clipboard view and its history list: entry points, states, keys, recording |
| [workbench.md](workbench.md) · [html](workbench.html) | The workbench, its steps and output, and saved pipelines in `config.toml` |
| [rules.md](rules.md) · [html](rules.html) | Settings › Clipboard, the Privacy page lines, what is never recorded, the files on disk |
| [collect.md](collect.md) · [html](collect.html) | The collect stack in Marxy only, designed for the author's ruling |
| [ring.md](ring.md) · [html](ring.html) | The ring, designed for later, with and without Accessibility permission |
| [studio.css](studio.css) | The pages' own styles, over `../mock-v2/shared/tokens.css` and `app.css` |

The HTML pages load nothing remote: system faces (`data-typeset="system"`), inline SVG icons, and the
mock's two stylesheets, which import nothing. Open them from disk. The theme button switches Night and
Paper.
