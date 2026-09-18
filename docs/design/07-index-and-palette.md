# 07 — Index and palette

ADR-0012 decided what is indexed and what is searched. This document fixes the data structures,
the Rust walker, the ranking formula, persistence, and the palette's states and keys.

## Root (D-A16)

`root = shell.repositoryRoot(path) ?? dirname(path)`. The app keeps `recentRoots: string[]`
(most recent first, max 12) in `history.json` (§11). Queries search the current root first;
when it returns fewer than `limit` hits, the other recent roots are queried in order and their
hits appended, each tagged with its root so the palette can show a dim root name.

## Walking (`commands/index.rs`, `ignore` crate)

```
WalkBuilder::new(root).hidden(true).git_ignore(true).git_global(true).git_exclude(true)
  .filter_entry(|e| !DENY.contains(e.file_name()))
```

`DENY = ["node_modules", "target", ".venv", "venv", "dist", "build", "out", ".next", ".cache", "__pycache__", "coverage", ".git"]`.
Extension allow-list, by kind: `markdown: md, markdown, mdx, txt`; `source: ts, tsx, js, mjs, cjs,
rs, py, go, java, kt, swift, c, h, cpp, hpp, cs, rb, php, sh, bash, zsh, css, scss, html, json,
jsonc, toml, yaml, yml, xml, sql, dockerfile, makefile, ini, cfg`; `theme: css` under a
directory containing `theme.toml`. Anything else is skipped. Files over 4 MB are indexed by
path only (no headings).

Ceiling `INDEX_LIMITS.entriesPerRoot = 50 000`: the walk stops, `truncated = true`, and the
palette shows "index limited to the 50,000 most recently changed files" (the walk is
depth-first by directory, so truncation picks by order; a follow-up sorts by mtime).

## Headings scanner (Rust, not the markdown parser)

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

at `<data>/index/<sha1(root)>.json` (§11). On open: `indexLoad(root)` serves queries at once;
`indexBuild(root)` runs in the background (Rust thread), diffs by `(path, mtimeMs, size)`,
re-scans headings only for changed files, then `indexSave`. Entries for files that vanished are
dropped. The webview receives `marxy:index-updated { root, count }` and re-runs the current
query if the palette is open.

## Query and ranking

`indexQuery(root, query, limit)` in Rust: `nucleo-matcher` `Pattern::parse(query,
CaseMatching::Smart, Normalization::Smart)` scored against three haystacks per entry — the path
relative to the root, the title, and each heading text (headings score as `entry` hits with a
`heading` index). Score of an entry = max over its haystacks, with `path` hits ×1.0, `title`
×1.2, `heading` ×0.9.

Frecency, computed in the app from `history.json` opens: `f = Σ 0.5^(ageDays / 7)` over the
last 20 opens of that path (half-life one week). Final rank: `score × (1 + 0.25 × min(f, 4))`.
Ties by mtime descending. `limit` 50 from Rust; the palette shows 12.

Budget: keystroke → results painted < 16 ms. Rust scoring of 50k entries with nucleo is
~2–4 ms; IPC ~0.5 ms; rendering 12 rows ~1 ms. The palette debounces nothing; every keystroke
queries. Results are keyed by path so re-rendering reuses rows.

## Palette (`apps/desktop/src/palette/`)

One `<dialog id="marxy-palette">` (native dialog for focus trapping and `Esc`), positioned at
top-centre, width `min(640px, 90vw)`, containing an input and a list. Chrome at rest: it does
not exist until summoned.

| State | Shown | Keys |
| --- | --- | --- |
| **empty query** | pinned documents, then MRU (newest first), 12 max, each with title, dim relative path, and a `⌘1..9` hint on the first nine | `↑/↓` move, `Enter` open, `⌘Enter` open in Source, `⌘P` again cycles to the *operations* section when a selection exists, `Esc` close |
| **typing** | hits: documents (title, path) and headings (`Title › Heading`); a hit from a recent root shows the root name dimmed | same; `Tab` toggles between *documents* and *headings* sections |
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

## Tests

- Rust: walker respects a temp repo's `.gitignore` and the deny list; headings scanner over the
  corpus matches the parser's heading list for `01`, `03`, `09`, `14` (level and text; offsets
  within the line); truncation at a small limit.
- App: ranking is deterministic for a fixture index (snapshot of the top 12 for six queries);
  frecency raises a recently opened path above an equal-score one; the empty-query view lists
  pins before MRU.
- Playwright: keystroke → rows painted under 16 ms at 20k entries (envelope tier in CI).
