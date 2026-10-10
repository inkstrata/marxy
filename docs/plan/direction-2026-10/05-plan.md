# The plan

**In short.** Seven phases build the mockup in `mock-v2/` on top of the roadmap already running:
**H** the look, **W** the fold-up workspace, **K** kinds, **J** the clipboard, **Q** the library,
**V** source extras and versions, **P** passive capture. The author approved the ADR changes and
ruled clipboard-facing features essential on 2026-10-10 ([06](06-reconciliation.md)). H, K's records, J's
pasteboard core and the small parsing stories start now, beside Phase D. W and the studio start when
D-14 has closed the split. Phase E is redistributed: its operations feed the transform library, its
paste stories move to J, and its diff feeds Versions and Compare.

Models and sizes follow `roadmap-2026-10/00-orchestration.md`: Opus for decisions, contracts, the
typesetter and the shell layout; Sonnet for well-specified work. At the pace of the last week, H, W
and K together are two to three weeks; J about two; Q and V about two more.

## Decision records

The author approved the ADR changes on 2026-10-10. Those that needed a ruling are written and
accepted; the others are written by the story named, from the approved direction.

| ADR | Decision | Amends or reverses | State |
| --- | --- | --- | --- |
| [0058](../../adr/0058-the-fold-up-workspace.md) | **The fold-up workspace.** At rest is the folded window; unfolded, persistent chrome; windows open folded; Split is one document as Read and Source | Reverses ADR-0050 item 4 and ADR-0011 inside the unfolded workspace; amends ADR-0057 item 4, design constraint 6 | accepted |
| 0059 | Token contract v2: Galley's colour and face roles, the chrome face, `data-marxy-kind` as a theme scope | Amends ADR-0008, ADR-0031 | H-01 |
| 0060 | Kinds: the twelve of mock-v2 plus `diff` and `html`, detected from bytes, path, shape and reader rules, never from a tool's authorship | Amends ADR-0005's "everything else opens Source" | K-01 |
| 0061 | Derived views: a node with provenance to a source line whose text is not a substring of the buffer (JSONL transcripts) | Amends ADR-0003 | K-02 |
| [0062](../../adr/0062-the-library.md) | **The library.** Sidebar tree, library view, query language, saved queries | Lifts the brief's "library browsing" exclusion; amends ADR-0053, ADR-0012 | accepted |
| [0063](../../adr/0063-capture-rules.md) | **Capture rules** | Reads commitment 3 | accepted |
| 0064 | File metadata capabilities in `shell-api`: read times, permissions, extended attributes and git facts; rename, the executable bit, Finder tags and quarantine removal, each a reader action with undo | ADR-0026 | W-18 |
| W-19 | Keys: `⌘K` opens the palette (`⌘P` kept as an alias), `⇧⌘P` commands, `⌘/` transforms under `>`, `⌘1` to `⌘3` modes; `/` stays content search and `⌘E` stays the toggle; every key through the registry | sonnet | S | A-13 |
| W-20 | The native menu bar, with conflict-checked shortcuts | sonnet | M | W-19 |
| W-21 | A Transform button on the toolbar (no Extract button); the transform library's result sheet (before, after, apply, chain) over E's operations | opus | M | W-05, J-03 |
| W-22 | Accessibility settings: increase contrast, reduce transparency, forced colours | sonnet | S | W-12, H-05 |
| W-23 | Focus mode, and the reading-progress line for article and book | sonnet | S | W-02, K-05 |
| [0065](../../adr/0065-the-clipboard.md) | **The clipboard is essential.** Copy as targets, multi-format writes, paste, Transform; clipboard read on reader action only; the studio waits for a design (J-D1) | ADR-0026, ADR-0054 | accepted |

## Phase H — the look

| Id | Title | Model | Size | Depends on |
| --- | --- | --- | --- | --- |
| H-01 | Write ADR-0059; reserve the token, attribute and class names in the registry | opus | S | — |
| H-02 | Port Galley's contrast audit to `scripts/gate-contrast.mjs` over every theme, variant and kind scope; wire into `pnpm check` | sonnet | M | H-01 |
| H-03 | Contract v2 tokens in `tokens.css` and the contract file; per-kind clamping in the validator; new roles in the CodeMirror theme bridge | opus | M | H-01 |
| H-04 | The default theme becomes Night (dark) and Paper (light), with Ink as its own theme directory; bundle the Classic type set with a licence audit per face; before-and-after artifact | opus | M | H-02, H-03 |
| H-05 | Ship `ink` (Ink), `warm` (Dusk, Sepia), `fjord`, `high-contrast` | sonnet | M | H-04 |
| H-06 | Measure the average character width per face and size in the app, so a type-set change keeps the character count | opus | M | H-03 |
| H-07 | The reader's `chrome_size` setting (11 to 26 px) in `config.toml`, `reader-config.ts` and `app-config.ts`; its control on W-12's page (ADR-0059 item 6) | sonnet | S | H-03 |

## Phase W — the fold-up workspace

Starts when D-14 has closed the split view (ADR-0058 is accepted).

| Id | Title | Model | Size | Depends on |
| --- | --- | --- | --- | --- |
| W-01 | The at-rest gate for two states: `checkChrome` asserts the folded window exactly as today and gains an unfolded case | opus | S | — |
| W-02 | The workspace shell: folded and unfolded states, `⌘\`, the grid of regions around the panes, the column never reflowing; the remembered arrangement | opus | L | W-01, D-14, H-03 |
| W-03 | Peeking: left, right and top edges as overlays; click or key docks | sonnet | M | W-02 |
| W-04 | Chrome styling for every workspace surface and the summoned ones (palette, verb menu, notices): the chrome face, surfaces, shadow, radii, and one spacing spec for every menu and dropdown (28 px rows, 5 × 10 px padding, 8 px icon gap, shortcuts right-aligned) | sonnet | M | H-03, W-02 |
| W-05 | The toolbar: sidebar toggle, back and forward, title and path, the + menu, Read/Split/Source, kind menu, Copy and Export, Find, inspector toggle; the customize sheet | sonnet | M | W-02 |
| W-06 | Tabs in the unfolded workspace, backed by the document store (ADR-0037) | opus | M | W-02 |
| W-07 | The sidebar I: foldable sections; Recent; Pinned and Changed since you read | sonnet | M | W-02 |
| W-08 | The sidebar II: Repositories and Folders, each drilling down to any depth in a lazy tree, with folded worktree copies, the changed mark and *New file here* | opus | M | W-07, Q-01 |
| W-09 | The inspector shell and its Links tab | sonnet | M | W-02, K-03 |
| W-10 | The inspector's Outline tab with section moves | sonnet | M | W-09, E-07 |
| W-11 | The status bar; each item opens its inspector tab | sonnet | S | W-09 |
| W-12 | Settings as a view of `config.toml`: search, changed dots, coupling rules, the Privacy page | opus | L | W-02 |
| W-13 | The palette's preview pane and `@` sections everywhere | opus | M | K-05 |
| W-14 | New file, New file here, and Fork this file (written beside the original), from the + menus, the sidebar and the palette | sonnet | M | E-13, W-05 |
| W-15 | Copying and exporting: Copy and Export side by side on each surface (export to PDF, image, HTML, Word, clean Markdown), `⌘C` and `⇧⌘C` everywhere, copy on code blocks only, Extract cut to four items, one quiet confirmation | sonnet | M | C-13 |
| W-16 | Measures: contextual per kind by default, or all, or a custom order, with per-kind overrides; the `tokenizer` setting, a local token estimate, and one formatter used by every surface that shows a size | sonnet | M | W-11, W-12 |
| W-17 | Metadata on demand: the `⌃⌘I` toggle, Read's margin preview, and the Metadata tab with front-matter editing as splices | opus | M | W-09 |
| W-18 | File metadata through the shell: created and modified times, permissions, extended attributes (Finder tags, where from, quarantine), rename and the executable bit, and git status and last commit; ADR-0064 for the new privileged capabilities | opus | M | W-17 |

## Phase K — kinds

| Id | Title | Model | Size | Depends on |
| --- | --- | --- | --- | --- |
| K-01 | Write ADR-0060 (kinds) | opus | S | — |
| K-02 | Write ADR-0061 (derived views), from research proposal P10 | opus | M | — |
| K-03 | Detect a file's kind in core, with reasons; golden tests over the corpus | sonnet | M | K-01 |
| K-04 | `[[kind]]` folder rules in `config.toml`, appended without touching another byte; *show as* per file | sonnet | M | K-01 |
| K-05 | `data-marxy-kind` on the pane root; the `article`, `readme` and `report` profiles in the default theme; artifact | opus | M | H-04, K-03 |
| K-06 | Index `.log`, `.csv`, `.tsv`, `.jsonl` and record each entry's kind | sonnet | S | K-03 |
| K-07 | The kind chip and the per-kind tool strip (unfolded), with strips configurable per kind | sonnet | M | W-05, K-03 |
| K-08 | Read a `log` | opus | M | K-05 |
| K-09 | Read a `diff` | sonnet | M | K-05 |
| K-10 | Read `data`: the depth lens and the table lens (Galley's grid, sticky typed headers, column stats) | opus | L | K-05 |
| K-11 | Read a Markdown `transcript` | sonnet | M | K-05 |
| K-12 | Read a JSONL `transcript` as a derived view | opus | L | K-02, K-11 |
| K-13 | Read `code`: the typeset listing and the symbols list | opus | M | K-05 |
| K-14 | Per-kind layouts when unfolded: the report panel, the README header, docs' "On this page", the symbols rail | opus | L | W-09, K-08 … K-13 |
| K-15 | The typography panel on the Content types settings page (mock 03 and 08), with the coupling rules and the measured colophon; no inspector tab | opus | L | W-09, H-06 |
| K-16 | The theme page: the Dark and Light lists choosing the theme in use, one detail panel with every control once, a full-size page preview with a kind switcher, the editor writing theme directories the reader owns; Compare; import | opus | L | H-05, W-02 |
| K-17 | Read `terminal` output: prompts, commands and output grouped; copy commands only, copy output only | sonnet | M | K-05 |
| K-18 | The kind icon set: one glyph per kind for 14 to 16 px, code in its language's colour | sonnet | S | K-03 |
| K-19 | Per-language colour: `data-marxy-lang`, Linguist brand colours with the lightness walked to pass per theme, theme overrides per language, the Syntax tab (defaults and per-language levels, the contrast-shaded OKLCH picker, click-a-token in the preview) | opus | M | H-02, H-03, K-16 |
| K-20 | Read `article`: the default profile, byline and dek from front matter | opus | M | K-05 |
| K-21 | Read `book`: paged, small-caps openings, scene breaks | opus | L | K-05, H-06 |
| K-22 | Read `docs`, `notes` and `changelog`: profiles and their tool strips | sonnet | M | K-05 |

## Phase Q — the library

ADR-0062 is accepted; starts after W-02.

| Id | Title | Model | Size | Depends on |
| --- | --- | --- | --- | --- |
| Q-01 | Library state in `collection.toml`: saved queries and smart collections appended byte-faithfully, parsed in core | sonnet | S | — |
| Q-02 | The query language in core: tokens, completion, unknown keys as text | sonnet | M | Q-01 |
| Q-03 | The library view: scopes, query field, result rows with *why it matched*, preview pane | opus | L | Q-02, W-02 |
| Q-04 | Add a folder with a dry run; index health | sonnet | M | Q-03 |
| Q-05 | Bulk actions: archive to `.archive/`, compare, merge into a new file; undo for each | sonnet | M | Q-03 |
| Q-06 | Broken-path checks and near-duplicate folding | opus | M | Q-03 |
| Q-07 | Saved queries and smart collections (the rule builder and built-ins) in the sidebar | sonnet | M | Q-01, Q-03, W-07 |
| Q-08 | The rest of the bulk actions: move, export, mark read, open in tabs, remove from the collection | sonnet | M | Q-05 |
| Q-09 | Per-file path base (*resolve against…*), kept in Marxy's own state | sonnet | S | Q-06 |

## Phase V — source extras and versions

| Id | Title | Model | Size | Depends on |
| --- | --- | --- | --- | --- |
| V-01 | Structural selection and line operations in Source | sonnet | M | D-11 |
| V-02 | Table tools in Source | sonnet | M | V-01 |
| V-03 | Find and replace with a diff preview | opus | M | D-13 |
| V-04 | Notes about a file (unclosed fences, skipped heading levels, missing paths) as quiet right-edge marks and inspector lists only; never decorations on the text | sonnet | M | K-03, V-05 |
| V-05 | The Source frame: the enclosure, top bar, column ruler, gutter, right-edge marks and caret bar, each showing only byte-derived facts; no formatting toolbar, structure panel or minimap | opus | M | D-11, W-04 |
| V-06 | The inspector's Versions tab: local snapshots, diff, restore to a copy | opus | M | E-17, W-09 |
| V-07 | A file changed on disk over unsaved edits: keep mine as a copy, or take theirs | sonnet | M | — |
| V-08 | Formatting commands, slash inserts and *go to next note* as palette commands and keys; show-whitespace and column-guide settings | sonnet | M | V-05 |

## Phase J — the clipboard

ADR-0065 is accepted: everything Marxy copies, pastes and transforms through the clipboard is core.
The studio page in `mock-v2/06-clipboard.html` is reference only; J-D1 designs the studio before
anything of it is built. J-01 to J-03 can start beside D.

| Id | Title | Model | Size | Depends on |
| --- | --- | --- | --- | --- |
| J-01 | The native pasteboard in Rust: read types first, then text, HTML, RTF, URL and image; write several representations as one item with `org.nspasteboard.source`; Marxy's temporary writes marked transient; concealed items refused | opus | M | — |
| J-02 | `shell-api`: clipboard read and multi-representation write, on reader action only; the memory shell and contract tests | opus | M | J-01 |
| J-03 | The transform library in core: E's operations plus the mockup's catalogue, with its ids, as pure `string → string` functions under the fidelity property | sonnet | L | E-01 |
| J-04 | Copy as with every target: Markdown, plain, rich, HTML source, Slack, Jira wiki, JSON string, quote with source; `⇧⌘C` at the pointer; the default-format setting | sonnet | M | J-02, C-07 |
| J-05 | Paste: the clipboard's HTML to Markdown, paste as Markdown in Source, paste in Rendered opening a scratch document (Phase E's E-12, E-14, E-15, moved here) | opus | M | J-02, E-13 |
| J-06 | Transform the clipboard: run any transform on the clipboard from the palette and write the result back, with the result sheet | sonnet | M | J-02, J-03, W-21 |
| J-D1 | **Design, not code:** the clipboard studio (history, workbench, compare, snippets, the ring, collect), carried from the mockup page to a buildable spec in the mock-v2 style, with history's privacy design and its ADR drafted | opus | L | — |

The studio's build stories are written from J-D1's output.

## Phase P — passive capture

| Id | Title | Model | Size | Depends on |
| --- | --- | --- | --- | --- |
| P-01 | Appended versus regenerated; tail-only parse and tail-follow | opus | M | K-08, B-24 |
| P-02 | Capture rules in `collection.toml`: parse, validate, the Privacy page line | sonnet | S | — |
| P-03 | Capture rules: byte-exact copies, extend appended, write beside a diverged copy, never delete, catch up at launch | opus | L | P-02, C-05 |

## Order

```
now, beside D ─── H-01  K-01  K-02 ── H-02  H-03  K-03  K-04  K-06  V-07  Q-01  P-02
                  J-01 ── J-02 ── J-04  J-05 (after E-13)    J-03 (after E-01)    J-D1
                                      H-04 ── H-05  H-06  K-05 ── K-08 … K-13  K-20 … K-22
after D-14 ─────── W-01  W-02 ── W-03 … W-23 ── K-07  K-14 … K-19
                   J-06 (after W-21)
                   Q-02 ── Q-03 ── Q-04 … Q-09      V-01 … V-08
after K-08, B-24 ─ P-01  P-03
```

Phase E runs as redistributed in [06](06-reconciliation.md#how-it-meets-the-roadmap). Milestones
after Phase E's v0.5.0: **v0.6.0** with H, the common kinds (K-01 to K-11, K-20) and the clipboard
(J-01 to J-05); **v0.7.0** with the workspace (W) and J-06; **v0.8.0**
with the library and versions (Q, V); **v0.9.0** with the rest of K,
and capture.

## Later, not in this direction

Model-backed summaries and questions (never built in, per the strip list); Quick Look, then Share,
Spotlight, the global palette and `marxy://` deep links; theme schedules; highlights and
annotations; read aloud; verse, slides and drama; Vim and Emacs keymaps; split by H2. Each needs its
own privacy or native-code design.
