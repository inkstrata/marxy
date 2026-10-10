# 07 — Index and palette

ADR-0012 decided what is indexed and what is searched. This document fixes the data structures,
the TypeScript walker, the ranking formula, persistence, and the palette's states and keys.

## Root (D-A16)

`root = shell.repositoryRoot(path) ?? dirname(path)`. The app keeps `recentRoots: string[]`
(most recent first, max 12) in `history.json` (§11). Queries search the current root first;
when it returns fewer than `limit` hits, the other recent roots are queried in order and their
hits appended, each tagged with its root so the palette can show a dim root name. The reader may
also declare folders (§Collections below, ADR-0053); they sit between the current root and the
recent roots.

## Collections (ADR-0053)

A **collection** is a list of folders the reader declares in `collection.toml`, beside
`config.toml` (§11). It widens what the palette searches and never adds a surface: there is no
tree, sidebar, library window or persistent search bar. A list of folders, searched; never browsed.

- **Scope.** The current repository root first, then the declared folders in file order, then the
  twelve recent roots. One entry per path; the earliest root in scope wins, so a folder nested in a
  repository is not listed twice. The `collection_loaded` mark records the folder count and the
  duration of loading the file.
- **Caps.** 50,000 entries per root (`INDEX_LIMITS.entriesPerRoot`) and 100,000 across the scope.
  The total is a placeholder held in app code, not in the contract. Beyond a cap the newest files
  win and the notice line says so.
- **Declared versus observed.** The file is the reader's; Marxy appends to it only on the explicit
  command "Add this folder" and preserves every other byte. The snapshots, `history.json` and
  `positions.json` are Marxy's and disposable. A snapshot may carry `baselineMs`, when Marxy first
  indexed that root (§11).
- **Watched folders.** A root with `watch = true` (the default) is watched recursively; a change
  patches one entry, never the whole index. The repository of the open file counts as watched. A
  root whose watch fails degrades to rescanning when the palette is summoned, with the notice
  "watch unavailable for `<root>`; rescan on open".
- **Worktrees.** Roots that share a git common directory are one group; the current root's copy of
  a file wins and the others fold under it ("+3 worktrees") unless their size or mtime differs.
- **Failure.** A malformed `collection.toml` falls back to no extra roots and says so once.

### Empty query

Three short sections, each hidden when empty, twelve rows in all, each path once:

1. **Pinned.** As before.
2. **Changed since you read.** At most five files in watched roots whose `mtimeMs` is newer than the
   entry's `lastReadMs`; never read, newer than the root's `baselineMs`. Newest first. A pinned file
   stays in Pinned and carries the mark.
3. **Recent.** The MRU, minus the two above.

Every row shows a dim relative age (`now`, `4m`, `3h`, `2d`, `5w`, `1y`); a changed row carries one
small mark with the accessible name "Changed since you read". Typed rows from watched roots show
the age and the mark too. Typed ranking is unchanged apart from `mtimeMs` as a tie-break before the
path. No count, badge or preview appears anywhere (ADR-0050).

### Content search (`/` prefix)

`/` followed by text searches file contents. It is a scan run on demand, never an index: nothing is
written to disk. Under two characters the notice reads "Type to search file contents"; otherwise,
after a 120 ms pause, "Searching…", then "N matches in M files", "No matches" or "Showing the first
200 matches". Rows show the document title, the line number and a dim preview with the match marked;
at most 50 rows are painted, files are the scope's, current root first, at most 20,000 of them. Enter
opens the file in Rendered mode at the match with the block holding it selected. Typing in this mode
never runs the fuzzy matcher. The `content_search` mark records the milliseconds and the hit count.

## Walking (`apps/desktop/src/index/walk.ts`)

The walk is TypeScript, run in the webview over `shell.readDir` (one level at a time) and
`shell.readFile`; there is no Rust walker (B-05.1). `walkRoot` lists directories with the shell,
`collectFiles` in `packages/core/src/index-model/` applies the ignore rules (`.gitignore` and
`.ignore`, nested files scoped to their directory) and the deny list in `index-model/deny.ts`.
`shell.readDir` (the Rust `read_dir` command) omits every symlink, so the walk never leaves the
root. Hidden entries are not skipped; only the deny list and the extension allow-list narrow the
walk. The service (`apps/desktop/src/index/service.ts`)
schedules it on the idle queue so it never precedes first paint.

`DENY_DIRECTORY_NAMES` (`index-model/deny.ts`) is the deny list; a gitignore `!` cannot undo it.
Extension allow-list, by kind: `markdown: md, markdown, mdx, txt`; `source: ts, tsx, js, mjs, cjs,
rs, py, go, java, kt, swift, c, h, cpp, hpp, cs, rb, php, sh, bash, zsh, css, scss, html, json,
jsonc, toml, yaml, yml, xml, sql, dockerfile, makefile, ini, cfg`; `theme: css` under a
directory containing `theme.toml`. Anything else is skipped. Headings are read from the first 256 KB of a
file (`HEADING_SCAN_BYTES`).

Ceiling `INDEX_LIMITS.entriesPerRoot = 50 000`: the walk always completes (it is cheap; only
paths and stats are collected), the entries are sorted by `mtimeMs` descending, the first 50 000
are kept and get their headings scanned, `truncated = true`, and the palette shows "index
limited to the 50,000 most recently changed files". Nothing is chosen by directory order.

## Headings scanner (`index-model/entry.ts`, not the markdown parser)

For markdown kinds only, first 256 KB of the file:

- Track fence state: a line matching `^\s{0,3}(`{3,}|~{3,})` toggles it (same fence char and
  length ≥ opener closes).
- Outside fences: ATX `^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$` → level, text; setext: a line of
  `^\s{0,3}=+\s*$` or `^\s{0,3}-+\s*$` directly after a non-blank, non-list line → level 1 / 2
  with the previous line's text.
- Text is stripped of inline markdown markers (`*`, `_`, `` ` ``, `[]()` → link text).
- `title` = first level-1 heading's text; else frontmatter `title:` (YAML, first 20 lines);
  else the file stem.
- `byteOffset` = the byte offset of the heading line's start.

This intentionally accepts small mismatches with the real parser (a `#` inside an HTML block);
the palette only needs to be *useful*, and the scanner runs at 50k files in under two seconds.

## Entry and persistence

`IndexEntry` as in the contract, plus a per-root envelope:

```json
{ "version": 1, "root": "/abs/root", "builtAt": 1789712345678, "truncated": false, "entries": [ … ] }
```

at `<data>/index/<sha1(root)>.json` (§11). On open: the persisted snapshot (`index-model/persist.ts`) serves queries at once;
the service then re-walks in the background on the idle queue, diffs by `(path, mtimeMs, size)`,
re-scans headings only for changed files, then writes the snapshot atomically. Entries for files that vanished are
dropped. The service notifies its subscribers, and the palette re-runs the current query if it is open.

## Query and ranking

Querying is TypeScript too (`apps/desktop/src/palette/search.ts`) over the service's in-memory
entries; no IPC is involved. Each entry is scored against three haystacks — the path
relative to the root, the title, and each heading text (headings score as `entry` hits with a
`heading` index). Score of an entry = max over its haystacks, with `path` hits ×1.0, `title`
×1.2, `heading` ×0.9.

Frecency, computed in the app from `history.json` opens: `f = Σ 0.5^(ageDays / 7)` over the
last 20 opens of that path (half-life one week). Final rank: `score × (1 + 0.25 × min(f, 4))`.
Ties by mtime descending. The palette shows 12.

Budget: keystroke → results painted < 16 ms. Scoring runs in the webview with no IPC;
rendering 12 rows ~1 ms. The palette debounces nothing; every keystroke queries. Results are keyed by path so re-rendering reuses rows.

## Palette (`apps/desktop/src/palette/`)

One `<dialog id="marxy-palette">` (native dialog for focus trapping and `Esc`), positioned at
top-centre, width `min(640px, 90vw)`, containing an input and a list. Chrome at rest: it does
not exist until summoned.

| State | Shown | Keys |
| --- | --- | --- |
| **empty query** | Pinned, Changed since you read, Recent (see Collections), 12 rows at most, each with title, dim relative path, dim age, and a `⌘1..9` hint on the first nine; the section labels are not selectable | `↑/↓` move (skipping labels), `Enter` open, `⌘Enter` open in Source, `⌘P` again cycles to the *operations* section when a selection exists, `Esc` close |
| **typing** | hits: documents (title, path) and headings (`Title › Heading`); a hit from a recent root shows the root name dimmed | same; `Tab` toggles between *documents* and *headings* sections |
| **content** (`/` prefix) | matches from file contents (see Collections) | same; `Tab` does nothing; `⌘.` pins the row's file |
| **operations** (`>` prefix or `⌘P` with a selection) | operations applicable to the current selection (§03), with the selection described ("h2 The index") | `Enter` runs |
| **notice** | one line under the list when the index is truncated or still building | — |

Opening a heading hit navigates to the document and scrolls the heading to the reading line
(§09). Opening any document pushes to history.

## History, MRU, pins (`history.json`, §11)

```json
{ "version": 1, "opens": [ { "path": "...", "at": 1789712345678 } ], "pins": ["..."], "recentRoots": ["..."] }
```

`opens` capped at 500 (oldest dropped); MRU = distinct paths from `opens` newest first.
Back/forward is an in-memory stack of `{ path, position }` for the session; `⌘[` / `⌘]`.
Pin/unpin is a palette operation on a document hit (`⌘.`).

## Query syntax

The library's query field is parsed by `parseQuery` in `packages/core/src/index-model/query.ts` (Q-02); the
token table is in `docs/plan/direction-2026-10/mock-v2/05-collections.md`, section "Query syntax". In short:
plain words and `"phrases"` search text, tokens combine with AND, `OR` (upper case) separates groups, a
leading `-` excludes, commas inside a value mean any of. `a b OR c` is `(a AND b) OR c`: `OR` has the lowest
precedence and there is no grouping. Keys are `kind`, `is`, `has`, `modified`, `words`, `tasks`, `size`,
`path` and `in`; `model:`, `session:`, `tag:`, `is:ai` and `is:live` are not keys (ADR-0062) and parse as
text. An unknown key, or an unknown value of a known key (`is:foo`), is an `unknown` term kept as text; a
missing or malformed value (`words:>`) is an `incomplete` term that filters nothing. Every term carries its
`[start, end)` range in UTF-16 code units of the input so the field can draw chips. Counts (`words:`,
`tasks:`) are decimal (`2k` = 2,000); sizes are binary (`1kb` = 1,024, `1mb` = 1,048,576). `completeQuery`
suggests keys and values at a caret. Evaluating a query against the index is Q-03.

## Tests

- Core and app: the walker respects a temp repo's `.gitignore` and the deny list; headings scanner over the
  corpus matches the parser's heading list for `01`, `03`, `09`, `14` (level and text; offsets
  within the line); truncation at a small limit.
- App: ranking is deterministic for a fixture index (snapshot of the top 12 for six queries);
  frecency raises a recently opened path above an equal-score one; the empty-query view lists
  pins before MRU.
- Playwright: keystroke → rows painted under 16 ms at 20k entries (envelope tier in CI).
