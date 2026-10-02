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

## Rejected

- **Live-rendered editing (Typora style).** The cluster of risk ADR-0005 exists to avoid.
- **Quick-note append after a block.** It makes Marxy rewrite files an agent will regenerate.
- **Do nothing.** The short path matters more than the feature.

## How we would know this was wrong

1. Readers keep the island open and write paragraphs in it: Marxy has become a writing tool by the
   back door. Hold the line at one block, or accept ADR-0001 should be reversed in the open.
2. An edit changes a byte outside its range: the fidelity property failed, and the feature stops.
