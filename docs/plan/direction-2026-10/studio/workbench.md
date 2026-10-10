# The workbench, and saved pipelines

**Verdict:** change (mock rows 7, 8, 10, 11, 15). **Built by:** J-11 (the workbench) and J-12 (saved
pipelines) in [08-cards-studio.md](../08-cards-studio.md). **Builds on:** J-03 (the transform library),
J-04 (Copy as), J-06 (transform the clipboard), W-21 (the Transform button and its result sheet),
E-13 (scratch documents), E-16 (the line diff). **Plate:** [workbench.html](workbench.html).

**In short.** W-21's result sheet runs one transform on a selection. The workbench is that sheet with
room: one input, an ordered list of steps from the transform library, and the output as Before, After
or Diff. The result goes to the clipboard, to Copy as, back in as the next input, or into a new scratch
document. It never writes to a document on disk. A chain worth keeping is saved as a pipeline: a
`[[pipeline]]` table in the reader's `config.toml`, run later from the palette.

## Entry points

| Where | What |
| --- | --- |
| History | `⌥↵` on an item, or *Open in the workbench* in its menu |
| Result sheet (W-21) | *Open in the workbench* carries the sheet's input and its step |
| Palette | `>Open the workbench`, `>Transform the clipboard in the workbench` (reads the clipboard on that action), `>Open the selection in the workbench` |
| Key | None of its own; `⇧⌘V` opens the view, and `⌘/` stays the transforms palette (ruled) |

## Layout

The right pane of the Clipboard view, top to bottom:

1. **Input.** A source chip naming where the text came from (*From history: plan.md:42*, *The
   clipboard*, *Selection in notes.md*, *Typed*), its characters and lines, and the text in a plain
   CodeMirror buffer that is never a file. The chip's menu loads another input: *The clipboard* (a
   read, on that action), *The selection*, *This document*, *A history item…*. The input's height is
   dragged, and remembered.
2. **Steps.** "Pipeline: *name*" (or *Unsaved*), *Add step* (`⇧⌘A`), *Load* (saved pipelines), *Save
   as pipeline…*, *Clear steps*. Each step is one row: grip, number, the transform's name and group,
   the size change (`−142 chars`), a skip switch, and remove.
3. **Output.** Before, After and Diff (a segmented control; `←` `→` when it has focus), the
   characters before and after, then the text. Actions: **Copy** (`⌘↵`), the Copy chevron for **Copy
   as** (`⇧⌘C`), **As input** (the result becomes the input; the steps stay), **Open as scratch
   document** (E-13).

Folded or below 900 px the three parts stack in one column, the steps folding to a one-line summary
("3 steps · −412 chars") that opens on click.

## Steps

A step is a transform id from J-03's library (the mock's catalogue: Clean, Convert, Lines, Case,
Extract), so a saved pipeline survives a change to how a transform is written. *Add step* opens the
palette's transform list in a picker mode: the same ranking, the same preview pane showing that step
applied to the current output and the size change, `↵` adds and closes, `⌥↵` adds and stays open.

Running is synchronous and on every change, in order, each step on the last one's output, with a
1 MB input cap (larger input shows "Too large for the workbench; open it as a scratch document" and
runs nothing). A step that throws keeps its input and shows *error* with the message; a step that
empties the text or changes nothing is marked *empty* or *no change*. A skipped step passes its input
through. Selecting a step's row shows the output after that step, with a banner: "Showing step 2 of
4 · Show the final output".

## Copying the result

*Copy* writes the result through J-04, so the representations follow the format (Markdown by
default; the Copy as default setting), tagged with Marxy as the source. It is recorded in history
with `origin: "workbench"` and, when a saved pipeline produced it, the pipeline's name in place of a
source line. *Copy* never replaces a history item; every result is a new item.

## States

| State | What the reader sees |
| --- | --- |
| Empty | No input: "Choose an input: a history item, the clipboard, or the selection." with those three buttons; the steps show three quick starts (`strip-bold`, `to-slack`, `to-jira`) |
| No steps | The output is the input, After equals Before, and *Copy* still works |
| Normal | As laid out |
| Large | Input over 1 MB refused (above); a diff over 5,000 changed lines folds unchanged runs and says "Diff shortened" |
| Error | A failing step as above; a concealed clipboard on *The clipboard* is refused with the notice history uses; a pipeline with an unknown step (from a hand-edited `config.toml`) loads the known steps and lists the unknown ids |

## Saved pipelines

A pipeline is the reader's configuration, in the shape ADR-0049 gives a user-defined operation: a
table in `config.toml`, which the reader may write by hand, and which Marxy only ever appends to.

```toml
[[pipeline]]
name  = "Slack, no bold"           # required, ≤ 80 characters, unique (case-insensitive)
steps = ["strip-bold", "to-slack"] # required, 1 to 32 transform ids from the library
key   = "Ctrl+Alt+S"               # optional; works inside Marxy only
```

- **Saving.** *Save as pipeline…* asks for a name and appends one `[[pipeline]]` table, every other
  byte of `config.toml` unchanged, with the file's own line ending, as saving a query appends to
  `collection.toml` (`docs/design/11-config-and-storage.md`). Skipped steps are left out and the
  confirmation says so ("Saved *Slack, no bold* · 1 skipped step left out"). Saving over a loaded
  pipeline is not offered: renaming, editing and deleting are edits the reader makes in the file, and
  *Edit in config.toml* opens it in Source at that table.
- **Parsing** (`packages/theme/src/config.ts`, beside the other keys). A table missing `name` or
  `steps` is skipped with one warning naming it; an unknown step id skips the pipeline with a warning
  naming the id; a duplicate name drops the later one; more than 64 pipelines warn and the rest are
  dropped. A `key` must hold `Mod` or `Ctrl` with at least one other modifier, and is ignored with a
  warning if the key registry (W-19) already holds it.
- **Running.** Each pipeline is a palette command, `>Run pipeline: Slack, no bold`, and, if it has a
  `key`, that key inside Marxy. With a selection in Read or Source it opens W-21's result sheet with the
  chain, which applies as a splice through the transformation path (one undo step). With no selection
  it runs on the clipboard, as J-06 runs one transform: it reads the clipboard on that action, writes
  the result back, records it in history and shows the result sheet with *Undo*, which writes the
  previous text back.
- **Never.** A pipeline runs only from the reader's palette or key, never from a document, never at
  launch, never on a timer, and never on a copy. Global keys, the Services entry, the Shortcuts app and
  the menu bar extra are later (mock 09).

## It may never

- write a document on disk (the scratch document is E-13's untitled buffer, which writes nothing
  until Save As);
- read the clipboard except when the reader picks *The clipboard* or runs a pipeline on it;
- run anything but the library's pure transforms (ADR-0004); user commands are ADR-0049's, not this;
- write `config.toml` except to append one `[[pipeline]]` table on *Save as pipeline*.
