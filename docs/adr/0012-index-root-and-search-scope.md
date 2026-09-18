# ADR-0012 — The indexed root is the enclosing repository; search covers titles, headings and paths

**Status:** accepted · **Source:** brainstorm Q10, Q11, A18, docs/19

## Decision
- **Root:** the nearest ancestor directory of the opened file containing `.git`; otherwise
  the file's own directory. marxy remembers the last twelve roots and the palette searches
  the current root first, then recent roots. No settings surface for roots in v1.
- **What is indexed:** files under the root that pass `.gitignore`, `.ignore` and a built-in
  deny list (`node_modules`, `target`, `.venv`, `dist`, build outputs, binaries), with an
  extension allow-list: markdown and text first, then source files by language.
- **Per entry:** path, title (first `h1` or filename), headings, mtime, size, last-read time,
  reading position. Not contents.
- **Ceiling:** 50,000 entries per root. Beyond it, index by mtime descending and show a
  one-line notice in the palette. Indexing must never block first paint.
- **Search:** fuzzy over path, title and headings, ranked by match quality then frecency.
  Full-text content search is deferred to v1.1.

## Why
Code observation being first-class points at repository-scale roots. Indexing `node_modules`
once would destroy the speed claim and be blamed on the framework. Headings in the index turn
"that document" into "that section of that document", which for long agent artifacts is the
difference between useful and not.
