# ADR-0062 — The library: the collection can be browsed, in a sidebar tree and a library view

- **Status:** accepted (author, 2026-10-10)
- **Date:** 2026-10-10
- **Amends:** ADR-0053 items 1 (meaning (e), a saved search, is now built), 3 (the palette is no
  longer the only search surface) and its ruling on "library browsing"; ADR-0012 (what the index is
  for). Lifts "library browsing" from the brief's exclusions (`docs/brief.md`).
- **Builds on:** ADR-0058 (the library lives in the unfolded workspace).
- **Evidence:** [`docs/plan/direction-2026-10/02-fold-up-workspace.md`](../plan/direction-2026-10/02-fold-up-workspace.md)
  (Sidebar, The library) and `mock-v2/05-collections.html`.

## Context

ADR-0053 made the collection a list of declared folders, searched from the palette and never
browsed, because the brief excluded "library browsing". With the fold-up workspace (ADR-0058) a
reader can ask for a tree and a library without the folded window changing. The author lifted the
exclusion on 2026-10-10.

## Decision

1. **The collection can be browsed.** The unfolded sidebar shows Recent, Pinned and Changed since
   you read, Repositories and Folders; every repository and folder drills down to any depth as a
   lazy tree that honours `.gitignore`, the deny list and worktree folding (C-15).
2. **A library view** is a full-window view inside the workspace: a scope, a query, dense result
   rows with why each matched, and a preview. Folding hides it.
3. **The query language** keeps `kind:`, `in:`, `path:`, `is:changed`, `is:pinned`, `has:tasks`,
   `modified:` and `words:`, with unknown keys treated as text. It has no `model:`, `session:`,
   `tag:`, `is:ai` or `is:live`.
4. **Saved queries** are declared state: they live in `collection.toml`, appended byte-faithfully,
   and show in the sidebar.
5. **Still no persistent full-text index.** Content search stays an on-demand scan (ADR-0053 item 4).
   ADR-0053's declared-versus-observed split, caps, local-only roots and deny list stand.
6. **Library actions write only what the reader chose,** each with undo: archive moves files to
   `.archive/` beside them, merge writes a new file, nothing is deleted.

## Consequences

- `docs/brief.md` drops "library browsing" from its exclusions; a managed catalogue that copies or
  owns the reader's files is still excluded.
- Phase Q builds the library; W-08 builds the sidebar tree.

## How we would know this was wrong

A reader's folders are the library: if the library view grows a store of its own (ratings,
collections that are not folders or queries), it has become the managed catalogue the brief still
excludes.
