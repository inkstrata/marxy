# ADR-0005 — Two view modes: Rendered (default) and Source

**Status:** accepted · **Source:** brainstorm D13, D15, C13

## Decision
**Rendered**: typeset, no caret, selection and operations. **Source**: the raw text in
CodeMirror 6 with caret, undo, multi-cursor; also the code viewer for files opened directly.
Markdown opens Rendered; anything else opens Source. One key toggles. Switching preserves
reading position via the source-map coordinate (ADR-0018), never scroll offset.

## Why
Dropping the Typora-style live-render mode removed `contenteditable` under decoration, IME in
rendered output, caret mapping into typeset lines, round-trip normalisation, and the need for
`text-wrap: stable` on WebKitGTK — the largest cluster of risk in the project, dissolved by
deleting scope. Source mode went from least important to load-bearing: it is both the edit
surface and the code-observation surface.

## Consequences
- Source mode is judged as a code viewer: highlighting quality, large files, sane defaults.
- If authoring ever re-enters scope this ADR must be revisited first.
