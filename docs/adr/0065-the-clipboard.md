# ADR-0065 — The clipboard is essential: what Marxy copies, pastes and transforms through it

- **Status:** accepted (author, 2026-10-10: "clipboard-facing stuff in general" is essential; the
  studio page is not a sufficient design to implement)
- **Date:** 2026-10-10
- **Amends:** ADR-0026 (the `shell-api` surface gains clipboard read and multi-representation
  write); ADR-0054 (copy verbs gain Copy as targets).
- **Evidence:** `docs/plan/direction-2026-10/mock-v2/` pages 01, 02 and 03 (copy, Copy as, Extract,
  Transform, Export) and the "Copy formats" and "Tauri implementation notes" sections of
  `06-clipboard.md`. The studio page itself (`06-clipboard.html`) is reference, not a spec.

## Context

Much of what Marxy shows is read once and moved somewhere else. The copy pack (C-07 to C-09) and
the verb menu (ADR-0054) made one copy good. The mockup adds Copy as with a target per app, Export,
Extract, Transform from the toolbar and palette, and paste into Marxy as Markdown. The author ruled
all of this essential. The mockup's clipboard studio (history, the workbench, snippets, the ring,
the collect stack) was drawn but not designed far enough to build.

## Decision

1. **Clipboard-facing features are core.** In scope now: `⌘C` and `⇧⌘C` *Copy as* on every surface,
   with every target format in the mockup (Markdown, plain, rich, HTML source, Slack, Jira wiki, JSON
   string, quote with source); Extract; Transform on a selection, a document or the clipboard, with
   the result sheet; paste as Markdown and paste as a scratch document; Export.
2. **One copy is one pasteboard item** carrying every representation (plain, HTML, RTF where
   useful), tagged `org.nspasteboard.source`. Marxy's own temporary writes are marked
   `org.nspasteboard.TransientType`.
3. **Marxy reads the clipboard only on a reader action** (paste, *transform the clipboard*), reading
   the types first and refusing concealed items. Nothing watches the pasteboard.
4. **Transforms are pure `string → string` operations** (ADR-0004) in core, with the mockup's ids,
   tested by the fidelity property, so the palette, the toolbar and the verb menu agree.
5. **New privileged capabilities** in `shell-api`: read the clipboard (types, then text, HTML, RTF,
   URL, image) and write several representations as one item. Both are native code under
   `apps/desktop/src-tauri`; `tauri-plugin-clipboard-manager` is not enough (no type listing, no
   HTML read).
6. **The studio waits for a design.** History, pipelines saved to keys, compare, snippets, the ring
   and the collect stack are not built from the current page. A design story (J-D1) produces a
   specification first, and history then needs its own privacy decision (watching every app's
   copies), recorded as a separate ADR.

## Consequences

- Phase J builds items 1 to 5 (`docs/plan/direction-2026-10/05-plan.md`) and absorbs Phase E's
  paste stories (E-12, E-14, E-15).
- No clipboard surface appears in the folded window; Copy and Export sit in the unfolded toolbar
  (ADR-0058).
- Commitment 2 is unchanged: no part of this reads the clipboard without a reader action.

## Rejected

- **Build the studio from the mockup page.** The author ruled it insufficient as a design.
- **`tauri-plugin-clipboard-manager` alone.** It cannot list types, read HTML or tag the source.

## How we would know this was wrong

A reader reaches for history (copying in Marxy, losing it, copying again): that is the evidence the
studio design story should start from.
