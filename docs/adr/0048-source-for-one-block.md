# ADR-0048 — Source may be summoned for one block

- **Status:** accepted (author, 2026-10-02)
- **Date:** 2026-10-02
- **Amends:** ADR-0005 (two view modes) by adding one bounded way into Source. ADR-0001 and ADR-0004
  are re-read, not changed. Answers the tripwire in `docs/roadmap.md` ("Authoring re-enters scope:
  ADR-0005 first").
- **Evidence:** `docs/research/audit-2026-10/10-overfit-decisions.md` §4 and
  `08-feature-text-operations.md` §6.

## Context

The spirit is now "a reader before a writer, but adept at both". ADR-0005 dissolved the largest
cluster of risk in the project by deleting live rendering: `contenteditable` under decoration, a
caret in typeset lines, IME in rendered output, round-trip normalisation. It also says that if
authoring re-enters scope, the ADR is reopened first. It is reopened. The need is small: fix one
block (a typo in a table cell, a wrong flag in a command) without leaving the page. Today that is
select, "Jump to source", edit, toggle back (`apps/desktop/src/commands/source-view.ts`), and
the reader loses the typeset context while they do it.

## Decision

1. **A selected block can open in Source in place.** In Rendered, with a block selected, a key
   (and a palette command) opens that block's byte range, from its `{start, end}` provenance
   (ADR-0003, ADR-0023), in a CodeMirror 6 editor that replaces the block's box. The editor is the
   existing Source editor (`apps/desktop/src/source/editor.ts`), mounted over a range instead of
   the whole buffer. Nothing else on the page moves, and the reading position holds (ADR-0018).
2. **Leaving splices back through the transformation path.** Pressing the edit key again (or
   Mod+Enter) closes the island, and the edited text replaces exactly that byte range, as one `apply` (ADR-0037) and one undo entry labelled
   "edit block in Source". Bytes outside the range are never read back. Line endings and a BOM are
   handled as `apps/desktop/src/source/buffer-commit.ts` handles them for whole-document Source.
3. **Cancel is free.** Escape discards the editor and the buffer is untouched.
4. **Live rendering stays out.** The typeset text never has a caret. The island is the code face,
   not typeset. There is no `contenteditable`, no WYSIWYG, no inline formatting buttons, and no
   typing new blocks into the rendered surface.
5. **It is an operation in shape.** The splice is a `string → string` replacement of one range,
   covered by the same byte-fidelity property as every other operation (`pnpm gate:fidelity`):
   after any block edit, bytes before and after the range are identical to the source.
6. **Whole-document Source (ADR-0005) is unchanged.** Markdown still opens Rendered, anything else
   opens Source, and one key still toggles.

## Consequences

- "Adept at both" gets one verb with a short path, and the rest of ADR-0005's risk cluster stays
  dissolved.
- The Source editor needs a range mode: mount, load a slice, return a slice. The line-number gutter
  and tab width settings (`apps/desktop/src/source/line-numbers.ts`, `tab-width.ts`) follow it.
- A file change on disk while a block island is open follows the external-change path in
  `docs/design/08-position-and-watching.md`: the island closes with a notice if its range moved.
- The roadmap tripwire is marked answered, with a link here.
- It depends on the document store (ADR-0037): the splice is a transition, not a write.

### What shipped (E-04, 2026-10-10)

One block, in the code face, one undo step, and no caret in typeset text. `Mod+Enter` on a selected block (a
node, or a section's heading) opens a CodeMirror editor over that block's bytes, built from the Source editor's
own extensions, where the block stood; the block's element is hidden, not removed, so the node map and the
byte lookups stay valid. Leaving (`Esc`, `Mod+Enter` again, a press elsewhere, focus moving elsewhere) folds the
text back with `foldSlice` as one `apply` labelled "edit block", and the page is set again by the one render
path with the reader on the same block. A block over 64 KB, and a document selection, refuse with a word and
open nothing. The editor counts as unsaved Source text: `Mod+E`, `Mod+S`, undo, a rename, closing and quitting
fold it first; an outside write keeps it (the edit survives, with the notice); another pane's change to the file
is kept beside it, and a change that leaves no block to fold into (it was deleted, replaced or split) adds the reader's text as
a new block where it stood, replaces nothing, and says which text it is, one undo from gone.

One reading of clause 3 changed with it. "Cancel is free: Escape discards" became "`Esc` leaves, keeping the
text", as the E-04 card has it: leaving is one gesture, `Esc` is the key a reader reaches for, and what it
keeps is one `Mod+Z` from gone. A discard is `Mod+Z` inside the editor until the text is the block again; leaving
then changes nothing and adds no history. The author may prefer the other reading; it is one key binding.

## Rejected

- **Live-rendered editing (Typora style).** The cluster of risk ADR-0005 exists to avoid.
- **Quick-note append after a block.** It makes Marxy rewrite files an agent will regenerate.
- **Do nothing.** The short path matters more than the feature.

## How we would know this was wrong

1. Readers keep the island open and write paragraphs in it: Marxy has become a writing tool by the
   back door. Hold the line at one block, or accept ADR-0001 should be reversed in the open.
2. An edit changes a byte outside its range: the fidelity property failed, and the feature stops.
