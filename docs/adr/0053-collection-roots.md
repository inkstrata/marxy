# ADR-0053 — Collection roots: a reader-owned list of folders, searched from the palette and never browsed

- **Status:** proposed
- **Date:** 2026-10-07
- **Amends:** ADR-0012 (the indexed root is the enclosing repository; "no settings surface for roots
  in v1" is lifted; the enclosing repository stays the implicit root). Reads `docs/brief.md` line
  72 ("library browsing") as the author ruled; the brief is not edited.
- **Evidence:** [`docs/research/audit-2026-10/06-feature-collection-and-search.md`](../research/audit-2026-10/06-feature-collection-and-search.md)
  §3.1 to §3.4, §4.1, §4.2, §4.4, §6.3; the author's ruling of 2026-10-02
  ([`rulings.md`](../plan/roadmap-2026-10/rulings.md), question 2).

## Context

Agent tools write files the reader did not open first: a plan under `~/.claude/plans`, a report in a
worktree, a draft in `~/Downloads`. ADR-0012 can only find files near the one already open, and it
says there is no settings surface for roots. The palette already searches an index (titles, headings
and paths) and already carries recency in place of tabs (ADR-0011, ADR-0050). What is missing is a
way for the reader to say which other folders count.

## Decision

1. **The collection is a list of folders the reader declares.** Of the five meanings in `06` §3.1,
   Marxy builds (b) a set of roots the reader adds, used as (c) watched drop directories, fronted by
   (d) pins and recents, with (a) the enclosing repository as the implicit default. Meaning (e), a
   saved search, is not built: it is a ledger the author has asked to avoid.
2. **Declared versus observed** (`06` §4.1). What the reader declared lives in `collection.toml`,
   beside `config.toml`, a plain commented file the reader edits in any editor, or that Marxy appends
   a folder to on an explicit "Add this folder" command. What Marxy observed (opens, pins, positions,
   the index snapshots) stays in its own disposable files. Deleting any observed file costs only
   convenience. Format and failure handling are in `docs/design/11-config-and-storage.md`.
3. **The palette is the only search surface.** The same palette, with a wider scope: the current
   repository first, the declared folders in file order, then the twelve recent roots. There is no
   persistent search bar, no sidebar and no tree (ADR-0050 keeps them out of the page at rest). The
   empty palette is where freshness lives: Pinned, Changed since you read, Recent.
4. **Content search is an on-demand scan with no persistent index.** A `/` prefix in the palette
   scans the files of the collection when the reader asks, and nothing is written. A full-text index
   (`tantivy`) is not adopted: at the corpus sizes measured (10.6 MB of Markdown in 1,450 files,
   about 20 ms warm), an index buys only staleness (`06` §3.4). Revisit if a real collection passes a
   few hundred megabytes.
5. **Caps.** 50,000 entries per root (ADR-0012, kept) and 100,000 across the collection. The total
   is a placeholder that lives in app code, not in `INDEX_LIMITS`, so no contract changes (`06` §6.3).
   Beyond a cap the newest files win and the palette says so in its notice line.
6. **Local paths only.** A root cannot be a URL and nothing syncs. The built-in deny list cannot be
   overridden by a root; `collection.toml` can only add deny globs.
7. **No contract changes.** `IndexEntry` already carries `root`, `mtimeMs`, `lastReadMs`, `kind` and
   `headings`. The snapshot envelope gains an optional `baselineMs` (when Marxy first indexed the
   root), which keeps `version: 1`.

## The author's ruling on "library browsing"

`docs/brief.md` line 72 excludes "library browsing". The reading this ADR relies on is the author's,
ruled on 2026-10-02 (`rulings.md`, question 2): the exclusion means a managed library, a catalogue, a
tree, a shelf the reader wanders. A declared list of folders, searched from the palette and never
browsed, is consistent with it. The brief stays as written. This is a decision, not an open question.

## Consequences

- Stories C-03 to C-05, C-10 to C-12, C-14 to C-17 of the Phase C plan build on this record.
- Worktrees of one repository would return several copies of the same file; a rule folds them under
  the current root's copy (C-15). That is ranking detail, not a decision of this ADR.
- A watch that fails (a platform limit) degrades to rescanning on summon, with a one-line notice; it
  is never an error.
- ADR-0012's other decisions (what is indexed, the ceiling, fuzzy over path, title and headings)
  stand.
- Marking this ADR accepted is the author's act.
