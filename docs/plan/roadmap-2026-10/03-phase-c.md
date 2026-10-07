# Phase C — Manage: collections and copy

**Date:** 2026-10-02 · **Phase:** C of `docs/research/audit-2026-10/14-roadmap-proposal.md` ·
**Ends with:** v0.3.0 · **Stories:** C-01 to C-17 · **Code read at:** `origin/main` `bc05670f`
(the audit commit). Phases A and B land before this one and move line numbers; every story names
the function as well as the line, so find it by name if the line has moved.

**Abstract.** Phase C is the first release that does something no other reader does: it watches
the folders an agent writes into and, the moment the palette opens, says what changed since you
last read it. It has two independent lanes. The **collection lane** turns a hand-edited
`collection.toml` into the palette's default scope: the folders are walked by the index service
Phase A built, kept fresh by a recursive watch that patches one entry per change, and searched
by a matcher that filters the previous result when a query grows. The empty palette becomes
Pinned, then Changed since you read, then Recent, each row with its age. A `/` prefix searches
file contents with one shell call. The **copy lane** gives every selection kind an explicit
default verb, adds the copy and extract pack (plain, rich, markdown; table as TSV, CSV, JSON; a
shell command without prompts; every code block, unchecked task and link), and makes one themed
verb menu the click surface: right-click, the context-menu key, or Enter. Nothing in the copy
lane can change a byte, and none of it changes the operation contract. Seventeen stories in four
waves; the lanes meet only at the end-of-phase screen check.

## Phase goal and screen criterion

From `14-roadmap-proposal.md`, Phase C:

> **Ends with:** v0.3.0, the first release that does something no other reader does.
>
> - `collection.toml`: declared folders, watched or not; the palette's default scope; twelve recent
>   roots kept (`06-feature-collection-and-search.md`).
> - The empty state: Pinned, then **Changed since you read** (mtime newer than last-read), then
>   Recent, each with a relative age.
> - The copy and extract pack (`08-feature-text-operations.md`): copy as plain text, as rich HTML,
>   as markdown; table as TSV, CSV, JSON; copy command from a shell fence; all code blocks; all
>   unchecked tasks; all links. An explicit default verb per selection kind replaces the
>   first-`copy-` prefix pick.
> - The verb menu as the one click surface: right-click, context-menu key, Enter on a selection;
>   drawn from the registry; at most seven rows; themed.
> - Content search on demand (`/` prefix, ripgrep-style scan over the collection).
>
> **Screen criterion:** a reader with three agent output folders in the collection opens Marxy,
> sees what changed since they last read, jumps to one, right-clicks a table and pastes it into a
> spreadsheet.

The stories that carry the screen criterion are C-03, C-10, C-11, C-12 (the collection and what
changed), C-06, C-08 and C-13 (right-click a table, paste it). Content search (C-16, C-17), the
two collection commands (C-14), worktree folding (C-15) and the rest of the pack complete the
phase but are not on the criterion's path.

## Preconditions

Must be on `main` before the stories that need them start:

| Needed | From | Needed by |
| --- | --- | --- |
| `apps/desktop/src/index/service.ts`: the index has an owner, walks once per root, persists with `core/index-model/persist.ts`, publishes by subscription; the one-shot hand-off in `apps/desktop/src/main.ts:11-14` is gone | Phase A (`12-recommendation-codebase.md` step 1) | C-10, C-11, C-12, C-14, C-15, C-17 |
| The three dead ranking fields fixed: `history.json` keeps real open times (today rewritten as `now - n`, `apps/desktop/src/palette/history.ts:111-129`), recent roots are repository roots (today `dirname`, `history.ts:160-164`), `IndexEntry.lastReadMs` is filled | Phase A (step 1) | C-12 |
| The palette lists every registry command whose `when` holds, not only `op.*` (`apps/desktop/src/palette/view.ts:91-95`) | Phase A (step 3) | C-13 (its "every row is also in the palette" check), C-14 |
| ADR-0050 ("at rest" defined) recorded as proposed; ADR-0045 (contracts change by PR) | Phase A | C-13; C-05 and C-16 |
| The pruned PR path from `04-tests-and-gates.md` §6 | Phase A | all (until it lands, stories pass today's CI) |
| One `DocumentStore` per document and one `RenderedView` per article; selection state no longer module-level in `apps/desktop/src/selection/view.ts:75-85` | Phase B (step 2) | C-06, C-13, C-17 |
| Contracts unfrozen (`test:contracts-frozen` deleted from `package.json`), `Shell` the real interface | Phase B (step 6) | **C-05 and C-16 only**: they add to `packages/shell-api/src/index.ts`. If the unfreeze has not landed, those two wait and every other story proceeds; no other story touches a contract |
| The uncompiled Rust indexer (`apps/desktop/src-tauri/src/index/mod.rs`) deleted, and `docs/design/07-index-and-palette.md` corrected to say the walker and matcher are TypeScript | Phase B (step 4) | C-01 checks it and does the doc half if Phase B did not |

### The interfaces this plan assumes from Phases A and B

The sibling plans for A and B were written in parallel with this one, so these are assumptions.
**Each story that uses one must read the real file first; if the shape differs, adapt the story
to it and say so in the pull request. Do not reshape Phase A's or B's interface to fit this plan.**

```ts
// apps/desktop/src/index/service.ts — assumed after Phase A
export interface IndexService {
  /** Hold `root`: serve its persisted snapshot at once, walk at idle, patch. Idempotent. */
  ensureRoot(root: string): Promise<void>;
  /** The roots held. */
  roots(): readonly string[];
  /** Every entry of every held root. */
  entries(): readonly IndexEntry[];
  /** Called after any root's entries change. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
  /** Repository root of a path: nearest ancestor with `.git`, else its directory (ADR-0012). */
  rootFor(path: string): Promise<string>;
}
```

C-10 adds `ensureRoot(root, opts)`, `dropRoot`, `baselineMs` and `isWatched`; C-11 adds patching
from watch events; C-15 adds a checkout side-table. From Phase B: the selection for the focused
view is reachable the way `getSelectionBufferContext()` (`selection/view.ts:197-200`) reaches it
today; `#doc` stays the first pane's id; deep imports such as
`@marxy/core/src/index-model/paths.ts` may have become package exports (`12` step 6) and
`core/index-model/paths.ts` may have moved to `core/paths.ts`; use what exists.

### Conventions for every story

- Branch `feat/c-nn-short-slug` (or `fix/`, `docs/`), squash merge, Conventional Commit subject
  carrying the story id, e.g. `feat(desktop): copy a table as TSV (C-08)`. No attribution lines.
- One changelog fragment per story, `changelog.d/C-nn.md`, one line for a reader of Marxy, unless
  Phase A changed the fragment rule (then follow it).
- New class names start `marxy-` (the registry enforces the prefix only); a new mark, event or
  `data-marxy-*` attribute goes into `scripts/registry.json` first. C-01 reserves the phase's.
- No timing assertion fails CI (ADR-0032). Where a story's acceptance is a speed, the test prints
  the number and the pull request body reports it; the machine-checkable proxy (rows touched,
  calls counted) is the assertion.
- Every `pnpm` command below is run from the repository root unless it says otherwise.

## Dependency graph and waves

| Story | Lane | Model | Size | Depends on | Wave |
| --- | --- | --- | --- | --- | --- |
| C-01 Record the decisions; reserve names; widen the desktop test glob | both | sonnet | S | — | 0 (merge first) |
| C-02 Prepare the operation catalogue for three packs; toggle-task from a list item | copy | sonnet | S | — | 0 |
| C-03 Parse `collection.toml`; append a folder byte-faithfully | collection | sonnet | S | — | 0 |
| C-04 Palette under 16 ms at 50k: incremental filter and row patches | collection | sonnet | M | — | 0 |
| C-05 Recursive watch for collection folders | collection | opus | M | Phase B unfreeze | 0 |
| C-06 Explicit default verb per selection kind; rich copy of a drag | copy | opus | M | C-01 (merge order) | 0 |
| C-07 Copy pack: plain, rich, markdown | copy | sonnet | S | C-02 | 1 |
| C-08 Copy pack: table as TSV, CSV, JSON | copy | sonnet | S | C-02 | 1 |
| C-09 Copy pack: command; extract code, tasks, links | copy | sonnet | M | C-02 | 1 |
| C-13 The verb menu | copy | opus | L | C-06 | 1 |
| C-10 Load the collection into the index | collection | opus | M | C-03, C-04 | 1 |
| C-16 Content search as one shell call | collection | opus | M | C-05 | 1 |
| C-11 Watch events patch one entry | collection | opus | M | C-05, C-10, C-04 | 2 |
| C-12 Empty state: Pinned, Changed since you read, Recent | collection | sonnet | M | C-10, C-04 | 2 |
| C-14 Edit collection, Add this folder | collection | sonnet | S | C-03, C-10 | 2 |
| C-15 Fold worktree duplicates | collection | sonnet | M | C-10, C-11 | 3 |
| C-17 `/` searches contents and lands at the match | collection | sonnet | M | C-16, C-10, C-12, C-13 | 3 |

Suggested waves (each wave's stories have disjoint paths; merge a wave before starting the next):

- **Wave 0** — C-01, C-02, C-03, C-04, C-05, C-06. Merge C-01 first: it widens the desktop test
  glob that C-06's new unit tests rely on.
- **Wave 1** — copy lane C-07, C-08, C-09, C-13; collection lane C-10, C-16. The copy lane is done
  at the end of this wave.
- **Wave 2** — C-11, C-12, C-14. The screen criterion can be checked at the end of this wave.
- **Wave 3** — C-15, C-17.

Hot files and their single writer per wave, which is why the waves are shaped this way:
`apps/desktop/src/palette/view.ts` (C-06 in 0, C-10 in 1, C-12 in 2, C-17 in 3);
`apps/desktop/src/palette/search.ts` (C-04 in 0, C-10 in 1, C-15 in 3);
`apps/desktop/src/index/service.ts` (C-10 in 1, C-11 in 2, C-15 in 3);
`packages/shell-api/src/index.ts`, `apps/desktop/src/shell/{tauri,memory}.ts` and
`apps/desktop/src-tauri/src/main.rs` (C-05 in 0, C-16 in 1);
`apps/desktop/src/selection/view.ts` (C-13 in 1, C-17 in 3);
`packages/core/src/operations/index.ts` (C-02 only; the packs write their own files).

Critical path: C-03 → C-10 → C-12 → C-17, four waves. The copy lane's longest chain is
C-06 → C-13, two waves.

## Verification at the end of the phase

Commands (from the repository root, on the merged `main`; substitute Phase A's renamed commands if
it renamed them):

```sh
pnpm install --frozen-lockfile
pnpm precheck --all
pnpm test
pnpm gate:fidelity && pnpm gate:golden && pnpm gate:no-network
pnpm check:registry && pnpm check:boundaries && pnpm gate:licences
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
MARXY_BROWSER_TESTS_REQUIRED=1 pnpm --filter @marxy/desktop test
cd apps/desktop && node --test --experimental-strip-types src/palette/search-perf.test.ts   # prints p95 at 50,000 entries
pnpm --filter @marxy/desktop bundle      # then xattr -dr com.apple.quarantine on the .app and open it
```

The author's manual check, in the built app, which is the screen criterion plus what the gates
cannot see:

1. Write `~/Library/Application Support/marxy/collection.toml` with three `[[root]]` tables for
   three folders agents write into (for example `~/.claude/plans`, one worktree's `docs/`, and a
   scratch output folder). Open one file from each, then quit.
2. Change one file in each folder from a shell with an atomic write
   (`printf '…' > f.tmp && mv f.tmp f.md`), and add one new file to one folder.
3. Launch Marxy from the Dock. Press `⌘P`. The palette shows **Pinned** (if any), **Changed since
   you read** with the three changed files and the new one, newest first, each with an age such
   as `2m`, then **Recent**. Nothing else is on screen.
4. With Marxy open, write another file into a watched folder. Press `⌘P` again: it is listed,
   without a restart.
5. Open a changed document that holds a table. Right-click a cell. The menu's first row is "Copy
   table as TSV". Choose it, paste into Numbers or a Google Sheet: one value per cell.
6. Click a code block and press Enter: the same menu, keyboard-driven, at most seven verbs.
   Escape closes it; nothing remains on screen.
7. `⌘P`, type `/` and a phrase from a file in another folder: results within a blink of
   stopping typing; Enter opens the file at the match with its block selected.
8. Read the printed palette p95 in `palette_keystroke` marks at the real collection size
   (`14-roadmap-proposal.md` "Numbers worth watching"). Then tag v0.3.0.

## Stories

### C-01 — Record the collection and verb-surface decisions, and reserve the phase's names

**Model:** sonnet · **Size:** S · **Depends on:** none · **Parallel with:** C-02, C-03, C-04, C-05, C-06 (merge this one first in wave 0)

**Outcome.** Two short proposed ADRs exist: one for collection roots (amends ADR-0012, records
`collection.toml`, the declared-versus-observed split, the palette as the only search surface,
content search as an on-demand scan with no persistent index, the per-root and total caps), and
one for the verb surface (one verb menu as the click surface, at most seven verbs per selection,
`Mod+C` always runs the selection's default *copy* verb and never a splice, the four-per-release
operation cap replaced by the per-selection limit). The design documents describe what Phase C
builds before it is built, the registry holds the phase's new marks, and the desktop unit-test
glob runs tests anywhere under `apps/desktop/src`.

**Why now.** `06-feature-collection-and-search.md` §3.2 and §6.4 story 1 and
`08-feature-text-operations.md` §8 both name decisions only an ADR can record; the brief's
"library browsing" exclusion (`docs/brief.md:72`) and ADR-0019's operation cap
(`docs/roadmap.md:15`) would otherwise contradict the phase. Writing the key and doc changes once
here keeps the implementing stories off shared docs.

**Paths.**
- `docs/adr/NNNN-collection-roots.md` (new; `NNNN` is the next free number after Phases A and B,
  check `ls docs/adr`)
- `docs/adr/NNNN+1-verb-menu-and-default-verbs.md` (new)
- `docs/adr/README.md` (two index rows)
- `docs/design/07-index-and-palette.md` (a "Collections" section; the empty state; the `/` prefix;
  if Phase B did not already, replace the Rust walker and `nucleo` description with what runs)
- `docs/design/11-config-and-storage.md` (`collection.toml` beside `config.toml`; the snapshot's
  optional `baselineMs`)
- `docs/design/09-app-shell.md` (keyboard table: `Mod+C` row reworded, new rows `Mod+Shift+C`,
  `Enter` on a selection, `ContextMenu` / `Shift+F10`)
- `docs/design/03-selection-and-operations.md` (a "Default verbs and the verb menu" section)
- `docs/operations.md` ("v1.1 candidates" replaced by the Phase C pack and the per-selection limit)
- `scripts/registry.json` (`marks`: add `collection_loaded`, `content_search`)
- `apps/desktop/package.json` (`test` script glob only)
- `changelog.d/C-01.md`

**Build order.**
1. The collection ADR, status `proposed`: content from `06` §3.1 (meanings b+c+d+a, not e), §3.3
   (same surface, no persistent bar), §3.4 (scan on demand, no `tantivy`), §4.1 (declared vs
   observed), §4.2 (file format), §4.4 (50,000 per root, 100,000 total, placeholders in app code),
   §6.3 (no contract change for the collection itself). Its "Open question" section quotes the
   brief's line and states the reading the plan assumes: "a list of folders, searched; never
   browsed" is not library browsing. The author ruled on 2026-10-02 that this reading is correct (`rulings.md`, question 2); record it as the author's, not as open. Do not edit `docs/brief.md`.
2. The verb ADR, status `proposed`: content from `08` §5 (one menu; rejected surfaces: hover glyph,
   gutter handle, selection popover), §5 "Keyboard parity" and "Required plumbing change", §1
   finding 7 (the cap), and the rule that `Mod+C` resolves through an explicit table, never a
   string prefix. It cites ADR-0050 for "at rest".
3. The design and docs edits listed in Paths, each a short section pointing to the ADR; write them
   as the specification the stories implement (C-06's tables, C-12's three sections, C-13's keys,
   C-17's prefix).
4. `scripts/registry.json`: append the two marks.
5. `apps/desktop/package.json` `test`: if the first invocation does not already match
   `src/**/*.test.ts`, replace `'src/palette/*.test.ts'` with `'src/**/*.test.ts'`; leave the
   mutation invocation (or Phase A's `test:mutations`) as it is.

**Acceptance.**
- `node scripts/check-registry.mjs` exits 0 with the two new marks present.
- `docs/adr/README.md` lists both ADRs as proposed; each links to `06` or `08` by section.
- `pnpm --filter @marxy/desktop test` still passes and runs each palette unit test file once (the
  widened glob does not double-run them; check the reported test count equals the old count).
- `docs/design/09-app-shell.md`'s keyboard table has the four rows above and no single-letter
  binding (the rule at `09-app-shell.md:68`).

**Tests.** `pnpm precheck`; `node scripts/check-registry.mjs`; `pnpm --filter @marxy/desktop test`.

**Do not.** Edit `docs/brief.md`, `docs/scope.md` or ADR-0012 / ADR-0019 in place (ADRs are
append-only; the new ones amend). Touch any code. Mark either ADR accepted.

**Risks and open questions.** None on "library browsing", which the author ruled (`rulings.md`).
If ADR numbers collide with Phase A or B, take
the next free ones and say so.

---

### C-02 — Prepare the operation catalogue for three packs, and let toggle-task apply to a list item

**Model:** sonnet · **Size:** S · **Depends on:** none · **Parallel with:** C-01, C-03, C-04, C-05, C-06

**Outcome.** Three packs of operations can land in parallel without touching the same file: the
catalogue is composed from three pack arrays that start empty. Shared helpers exist for what
every pack needs (byte and string offsets, inline plain text, HTML cleaning, a minimal-diff
assertion). The fidelity property checks every clipboard-only operation at every node of every
corpus file, not only headings and code blocks. `toggle-task` accepts a list-item selection,
rewriting only the three marker bytes, so the palette (and later the verb menu) can offer it for a
task item.

**Why now.** `08` §1 finding 2 (toggle-task is not offered for a list item: its `canApply` at
`packages/core/src/operations/toggle-task.ts:27-31` demands the range equal the marker), §7.1 (a
5-line byte/string helper serves every such operation), §7.4 items 2-3 (fidelity property over
every node; a minimal-diff property). Without the split, C-07, C-08 and C-09 all edit
`packages/core/src/operations/index.ts:8`.

**Paths.**
- `packages/core/src/operations/index.ts`
- `packages/core/src/operations/pack-copy.ts`, `pack-table.ts`, `pack-extract.ts` (new, each
  `export const …_PACK: readonly Operation[] = [];`)
- `packages/core/src/operations/offsets.ts`, `offsets.test.ts` (new)
- `packages/core/src/operations/inline-text.ts`, `inline-text.test.ts` (new)
- `packages/core/src/operations/html-clean.ts` (new; code moved from `copy-section.ts`)
- `packages/core/src/operations/copy-section.ts` (imports from `html-clean.ts`; no behaviour change)
- `packages/core/src/operations/testing.ts` (new; test helpers only)
- `packages/core/src/operations/toggle-task.ts`
- `packages/core/src/operations/operations.test.ts`
- `changelog.d/C-02.md`

**Build order.**
1. `offsets.ts`: `byteToStringOffset(text: string, byteOffset: number): number` and
   `stringToByteOffset(text: string, index: number): number`, counting UTF-8 bytes of `text`
   (surrogate pairs are 4 bytes); a byte offset inside a multi-byte sequence throws `RangeError`.
2. `inline-text.ts`: `inlinePlainText(nodes: readonly Inline[], opts?: { hardBreak?: string }): string`
   — `text` and `code` values, `link` and emphasis children flattened, `image` → `alt`,
   `softBreak` → `' '`, `hardBreak` → `opts.hardBreak ?? '\n'`, `mathInline` → value,
   `footnoteReference` → `[label]`, `html` and `taskMarker` → nothing.
3. `html-clean.ts`: move `sectionOf`, `stripRendererProvenance` and `stripProvenanceFromTag`
   verbatim from `copy-section.ts:16-107` and export them; `copy-section.ts` imports them.
4. `index.ts`: `export const CLIPBOARD_OPERATIONS = [copyCodeClean, copySection, ...COPY_PACK,
   ...TABLE_PACK, ...EXTRACT_PACK]`, `export const MUTATING_OPERATIONS = [toggleTask,
   alignTablePipes]`, `OPERATIONS = [...CLIPBOARD_OPERATIONS, ...MUTATING_OPERATIONS]`. With empty
   packs the order equals today's (`index.ts:8`).
5. `toggle-task.ts`: `canApply` also accepts `input.node.type === 'listItem'` when
   `input.range` equals `node.src` and `markerInListItem(node)` finds a marker; `run` for that case
   computes `at = byteToStringOffset(input.text, marker.src.start - input.range.start)`, checks
   `input.text.slice(at, at + 3)` is `[ ]`, `[x]` or `[X]` (else returns `{ replacement: input.text }`),
   and returns the text with those three characters replaced. The marker-range path is unchanged.
6. `testing.ts`: `assertOnlySpansChanged(before: Uint8Array, after: Uint8Array, spans: readonly Source[])`
   and `corpusDocuments()` (the loop the fidelity tests repeat today).
7. `operations.test.ts`: the copy fidelity test (`:369`) iterates every node of every corpus file
   (plus heading section ranges and the document range, as today) for every operation in
   `CLIPBOARD_OPERATIONS`; the mutation test (`:407`) uses `MUTATING_OPERATIONS` instead of
   `!op.id.startsWith('copy-')`; the source guard (`:480`) also reads `html-clean.ts`; new toggle
   cases below.

**Acceptance.**
- `OPERATIONS.map((op) => op.id)` equals `['copy-code-clean', 'copy-section', 'toggle-task',
  'align-table-pipes']` while the packs are empty (`operations.test.ts`, new test).
- `fidelity: replacement === text …` runs over every node of every corpus file and passes
  (`operations.test.ts`).
- `toggle-task` on a `listItem` input: table cases for LF, CRLF, a nested list (only the selected
  item's marker changes), non-ASCII text in the item, an item with no marker (`canApply` false)
  (`operations.test.ts`).
- Minimal-diff property: for every task `listItem` in the corpus, running `toggle-task` on the item
  changes only the bytes of its marker (`assertOnlySpansChanged`, `operations.test.ts`).
- The mutation guard at `:427` still fails when corrupted (unchanged test stays green).
- `offsets.test.ts`: round trips for ASCII, 2-, 3- and 4-byte characters and CRLF; `RangeError`
  inside a sequence. `inline-text.test.ts`: one case per inline type.
- `copy-section` output is byte-identical to before on the corpus (existing tests at `:59`, `:143`,
  `:468`, `:486`, `:557` green).

**Tests.** `pnpm --filter @marxy/core test`; `pnpm gate:fidelity`; `pnpm precheck`.

**Do not.** Edit `packages/core/src/contracts/operation.ts`. Add any operation. Change
`copy-section` or `copy-code-clean` output. Touch `apps/desktop` (a click on a task item lands on
its paragraph, not the list item; C-06 widens the selection so the palette offers the toggle).

**Risks and open questions.** In a tight list the click carrier may be the `li` or its `p`; that is
C-06's concern. If the corpus has a task item whose marker is preceded by non-ASCII bytes, the
offset helper is what makes it right; keep a test for it.

---

### C-03 — Parse `collection.toml`, and append a folder to it without touching another byte

**Model:** sonnet · **Size:** S · **Depends on:** none · **Parallel with:** C-01, C-02, C-04, C-05, C-06

**Outcome.** Core can read a reader's `collection.toml` (a list of folders, each watched or not,
plus extra deny globs) into a typed value with warnings, and can append one folder to the file's
bytes so that every byte before the append is preserved. Shell-free: the host passes bytes and the
home directory.

**Why now.** `06` §4.2 defines the file; §5.1 needs a byte-faithful "Add this folder"; §6.1 places
the parser in `packages/core/src/index-model/`. The parser is the base of the collection lane and
has no dependency.

**Paths.**
- `packages/core/src/index-model/collection.ts` (new)
- `packages/core/src/index-model/collection.test.ts` (new)
- `packages/core/src/index-model/index.ts` (exports)
- `packages/core/package.json` (add `smol-toml` at the version `packages/theme/package.json` uses;
  it is already on the allow-list, `scripts/allowlists/dependencies.json:50`)
- `pnpm-lock.yaml`
- `changelog.d/C-03.md`

**Build order.**
1. Types and parse:
   ```ts
   export interface CollectionRoot { readonly path: string; readonly name?: string; readonly watch: boolean; }
   export interface Collection { readonly roots: readonly CollectionRoot[]; readonly denyGlobs: readonly string[]; }
   export interface ParseCollectionResult {
     readonly collection: Collection; readonly warnings: readonly string[]; readonly unknownKeys: readonly string[];
   }
   export function parseCollection(bytes: Uint8Array, ctx: { readonly home: string }): ParseCollectionResult;
   ```
   Rules: `path` absolute or `~`/`~/…` (expanded with `ctx.home`, then `normalizePath` from
   `index-model/paths.ts`); a relative path or anything containing `://` is skipped with a warning
   (no network, AGENTS.md commitment 3); duplicates after normalisation are dropped with a
   warning; `watch` defaults to `true`, a non-boolean warns and defaults; `name` optional string;
   at most 32 roots (a placeholder; more warn and are dropped); `[deny] globs` is a string array.
   Unparseable TOML yields an empty collection and the one warning `collection.toml could not be
   parsed; no extra folders` (the same shape as `packages/theme/src/config.ts:57-60`).
2. `export function denyRulesFor(globs: readonly string[]): IgnoreRule[]` via
   `parseIgnore(globs.join('\n'), '')` (`index-model/ignore.ts`). The built-in deny list stays
   absolute: a `!node_modules` glob changes nothing (the walker checks `isDeniedName` first,
   `walk.ts:46`).
3. `export const COLLECTION_TEMPLATE: string` — a commented header (the comment block in `06`
   §4.2) and no roots.
4. `export function appendRoot(bytes: Uint8Array, path: string, ctx: { readonly home: string }): Uint8Array`:
   empty input → template then the table; detect the file's line ending (first `\r\n` → CRLF,
   else LF); if the file does not end in a line ending add one; append
   `[[root]]<eol>path = <toml string><eol>`, writing `~/…` when the path is under `home`; a path
   already present (after normalisation) returns the input unchanged. Use a TOML literal string
   (`'…'`) unless the path contains `'`, then a basic string with `\\` and `\"` escaped.

**Acceptance.**
- `collection.test.ts`: the `06` §4.2 example parses to two roots, watch flags and one deny glob;
  `~` expansion; relative and `https://` paths warn and are skipped; duplicate roots fold; a
  malformed file gives an empty collection and exactly one warning; unknown keys listed once.
- `appendRoot` property: for a set of fixture files (LF, CRLF, no final newline, comments,
  existing roots, empty), the output starts with the input bytes (or input plus one line ending
  when it had none) and `parseCollection(output)` lists the new root last; appending twice equals
  appending once.
- `denyRulesFor(['**/drafts/**'])` ignores `a/drafts/x.md` and not `a/draft.md`; `!node_modules`
  does not un-deny (`collection.test.ts`).
- `pnpm gate:licences` passes with the new core dependency.

**Tests.** `pnpm --filter @marxy/core test`; `pnpm gate:licences`; `node scripts/check-boundaries.mjs`
(core imports no Node built-in); `pnpm precheck`.

**Do not.** Read files or the environment (core is shell-free, ADR-0020). Put roots into
`config.toml` or touch `packages/theme/src/config.ts` (`06` §4.1 explains why a separate file).
Accept URLs. Write anything but the appended table.

**Risks and open questions.** If `check:deps` forbids a new runtime dependency in core, report it;
the fallback is to accept a parsed object (`parseCollectionValue(raw: unknown, ctx)`) in core and
parse the TOML bytes in `apps/desktop` through `@marxy/theme`, which already depends on `smol-toml`.

---

### C-04 — Keep the palette under 16 ms at 50,000 entries: filter the last result when the query grows, and patch rows instead of rebuilding

**Model:** sonnet · **Size:** M · **Depends on:** none · **Parallel with:** C-01, C-02, C-03, C-05, C-06

**Outcome.** Typing a query one letter at a time over a 50,000-entry collection rescans only the
rows the previous keystroke matched, so typed-ahead keystrokes stay well inside 16 ms. One changed
file updates one prepared row instead of rebuilding every row. When two hits tie, the newer file
wins before the path decides.

**Why now.** `05-performance-audit.md` §7.1 measured the linear scan at 12.4 ms p95 at 50,000
entries and 24.9 ms at 100,000; §11.1 rank 7 is exactly this lever ("2–5× on typed-ahead queries;
keeps 100k entries under 16 ms"). `06` §4.3 item 3 needs one row per changed file
(`prepareIndex` rebuild is 19.5–25.8 ms at 50k). `06` §3.5 item 4 asks for the mtime tie-break.

**Paths.**
- `apps/desktop/src/palette/search.ts`
- `apps/desktop/src/palette/search.test.ts`
- `apps/desktop/src/palette/search-perf.test.ts`
- `apps/desktop/src/palette/search-incremental.test.ts` (new)
- `changelog.d/C-04.md`

**Build order.**
1. Split matching from scoring. Today a row whose `fuzzyScore` is positive is a hit, but the score
   subtracts the length difference (`search.ts:237`), so a longer query can score positive on a row
   where its prefix scored zero: "score > 0" is **not** monotone in the query. Add
   `hasSubsequence(hay: string, needle: string): boolean` and define a row's *candidacy* as
   "title, path or any heading contains the needle as a subsequence". Candidacy is monotone: a row
   that is a candidate for `needle + x` is a candidate for `needle`.
2. `PreparedIndex` gains `readonly version: number` and a path → row index map; export
   `upsertRows(prepared, entries: readonly IndexEntry[]): void` and
   `removeRows(prepared, paths: readonly string[]): void` (swap-remove, version incremented on any
   change) and a `prepareStats` counter of `prepareRow` calls for tests. `prepareIndex` keeps its
   signature (`view.ts` still calls it in `setIndexEntries`, `view.ts:494-498`).
3. Cache in `searchPrepared` (`search.ts:69`): a `WeakMap<PreparedIndex, { version; needle;
   candidates: Int32Array }>`. When the cached version equals `prepared.version` and the new needle
   starts with the cached needle, iterate only `candidates`; otherwise scan every row. Record every
   candidate row index (not only the top-k) and store the new cache entry. Scoring and frecency are
   recomputed per call (they depend on the session, which can change between keystrokes).
4. `compareHits` (`search.ts:193-199`): after `lastReadMs`, compare `mtimeMs` descending, then path.
5. `search-perf.test.ts`: a `TREE` of 50,000 with the same entry shape, two probes printed:
   fresh-query p95 (today's queries) and typed-ahead p95 (sequences `d`, `de`, `det`, `deta`,
   `detai`, `detail` and four more). If Phase A has removed the timing assertion (ADR-0032), keep
   it removed; if it is still there, leave the 20,000 assertion as it is and only print at 50,000.

**Acceptance.**
- `search-incremental.test.ts`: over a seeded random index of 5,000 entries and 500 random
  typed-ahead sequences, every incremental result deep-equals a full scan with the cache cleared,
  including when `upsertRows` or `removeRows` runs between two keystrokes.
- The same file asserts the proxy: for an extending keystroke, rows scored ≤ the previous
  keystroke's candidate count.
- `upsertRows` of one entry into a 50,000-row index calls `prepareRow` exactly once
  (`prepareStats`, `search-incremental.test.ts`).
- `search.test.ts`: two hits with equal score and equal `lastReadMs`, the newer `mtimeMs` first.
- `search-perf.test.ts` prints typed-ahead p95 at 50,000; the PR body reports it under 16 ms on
  the author's machine and the fresh-query p95 no worse than `05` §7.1's 12.4 ms.
- Existing `search.test.ts`, `session.test.ts`, `palette.test.ts` pass; the `MARXY_86_MUTATION`
  run (if still present) still exits 1.

**Tests.** `pnpm --filter @marxy/desktop test`; `cd apps/desktop && node --test
--experimental-strip-types src/palette/search-perf.test.ts`; `pnpm precheck`.

**Do not.** Change `fuzzyScore`'s scores or the title/heading/path weights (`search.ts:9-11`;
ranking values are taste-adjacent, `06` §3.5). Move the matcher to Rust (`06` §4.4 option 3 is only
for after measurement). Touch `view.ts`.

**Risks and open questions.** The first keystroke is still a full scan (24.9 ms at 100,000 per
`05` §7.1). Report the number at 100,000 too; narrowing the first keystroke to the current group
(`06` §4.4 option 1) is a follow-up if C-10's real collection approaches that size.

---

### C-05 — Watch a collection folder recursively, without rescanning the tree on every event

**Model:** opus · **Size:** M · **Depends on:** Phase B's contract unfreeze (for one optional parameter on `Shell.watch`) · **Parallel with:** C-01, C-02, C-03, C-04, C-06

**Outcome.** The shell can watch a folder tree: a file an agent writes three directories down,
including by write-temp-then-rename, arrives as one event, and only the paths the OS reported are
re-examined, never the whole tree. The existing watch of the open document's folder behaves
exactly as before. A tree watch that the OS refuses fails cleanly so the app can fall back.

**Why now.** `06` §1.2: the only watcher is non-recursive
(`apps/desktop/src-tauri/src/watch/spawn_notify.rs:54`, `RecursiveMode::NonRecursive`) while the
contract promises "Recursive directory watch" (`packages/shell-api/src/index.ts:26`). `06` §4.3
item 1 reuses the ref-counted table (`apps/desktop/src-tauri/src/main.rs:249-342`). Today every
poll rescans the root (`watch/mod.rs:66-95`), which is fine for one folder and wrong for a tree.

**Paths.**
- `apps/desktop/src-tauri/src/watch/tree.rs` (new; std only, declared in `main.rs` as
  `#[path = "watch/tree.rs"] mod watch_tree;` like `watch_notify` at `main.rs:7-8`)
- `apps/desktop/src-tauri/src/watch/spawn_notify.rs` (a second spawn function)
- `apps/desktop/src-tauri/src/main.rs` (`watch_root`, `unwatch_root`, `emit_fs_watch`)
- `packages/shell-api/src/index.ts` (`watch` gains an optional third parameter)
- `apps/desktop/src/shell/tauri.ts` (`watch`, `tauri.ts:142-168`)
- `apps/desktop/src/shell/watch-filter.ts` (new, pure) and `watch-filter.test.ts` (new)
- `apps/desktop/src/shell/memory.ts` (record the option)
- `changelog.d/C-05.md`

**Build order.**
1. `tree.rs`: `TreeWatch::open(root: &Path) -> Result<TreeWatch, String>` scans the tree with
   `fs::symlink_metadata` (never following symlinks, like `index-model/walk.ts`), skipping the
   directory names in `packages/core/src/index-model/deny.ts:4-17` (a Rust `const` of the same
   twelve names), stopping with `Err("too many files")` past 200,000 files. Snapshot type as
   `watch/mod.rs:48` (`BTreeMap<PathBuf, FileId>`).
2. `TreeWatch::apply(&mut self, changed: &[PathBuf], rescan_all: bool) -> Vec<WatchEvent>`: for each
   path not under a denied directory: a file is re-stat'ed; a directory has its subtree rescanned;
   a missing path removes itself and every key under it (a `BTreeMap` range). Build the previous
   and next sub-snapshots of the affected keys only and turn them into events with the existing
   `watch::diff` (`watch/mod.rs:211`), which already reports an inode change at a path as
   `Renamed` onto it. `rescan_all` rescans the root (for an overflowed or coalesced event).
3. `spawn_notify.rs`: `spawn_tree_thread(root, emit)`: one `RecommendedWatcher` with
   `RecursiveMode::Recursive`; the callback sends the event's paths (not `()`) and a rescan flag
   when `event.need_rescan()` or the kind is `Other`; the loop gathers for 50 ms after the first
   message, then calls `apply`. A failed `watch()` returns `Err` through the startup channel exactly
   as `spawn_poll_thread` does (`spawn_notify.rs:88-93`).
4. `main.rs`: `watch_root(app, root, recursive: Option<bool>) -> Result<String, String>` returns the
   table key; a recursive watch's key is the canonical root plus a `\u{0}tree` suffix, so a tree
   watch and a folder watch of the same directory never share a thread. `unwatch_root(root,
   recursive: Option<bool>)` resolves the same key. `emit_fs_watch` adds the key to each payload:
   `{ "key": …, "events": [...] }`.
5. `packages/shell-api/src/index.ts`: `watch(root, onEvents, opts?: { readonly recursive?: boolean })`;
   the stub keeps compiling (optional parameter).
6. `watch-filter.ts`: `eventsForWatch(payload: unknown, key: string): WatchEvent[]` returns the
   events of a payload whose key matches, else `[]`. `tauri.ts` `watch` passes `recursive`, keeps
   the returned key, filters every `fs-watch` payload through `eventsForWatch` (replacing the
   path-prefix filter at `tauri.ts:154`), and unwatches with the same `recursive`.
7. `memory.ts`: record `opts` in the `watch` call log; `emit` behaviour unchanged.

**Acceptance.**
- `tree.rs` tests (`cargo test … watch_tree`): a file created two directories down → one `Created`;
  write-temp-then-rename two levels down → `Renamed` onto the path; removing a directory → one
  `Removed` per file under it, once; files under `node_modules`, `.git`, `target` never reported;
  a symlinked directory is not descended.
- "No full rescan" proxy: with a scratch tree of 10,000 files, `apply` for one changed file performs
  fewer than 10 `stat` calls (a test-only counter in `tree.rs`).
- `spawn_tree_thread` end to end: create a nested file, receive the event within 2 s, stop joins
  (same shape as `spawn_notify.rs:125`).
- Deny parity: a Rust test reads `packages/core/src/index-model/deny.ts` and asserts every quoted
  name in `DENY_DIRECTORY_NAMES` is in the Rust list.
- The existing `watch/mod.rs` tests pass unchanged, including
  `a_write_two_directories_down_is_not_watched` (`mod.rs:462`): the folder watch stays flat.
- `watch-filter.test.ts`: a payload from another key yields no events; a malformed payload yields
  none.
- `apps/desktop/test/live-reload.test.mjs` and `user-theme.test.mjs` pass.

**Tests.** `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`; `cargo clippy … -- -D
warnings`; `pnpm --filter @marxy/desktop test`; `pnpm precheck`.

**Do not.** Change `RootWatch` or the open document's watch (ADR-0018 live reload). Change
`WatchEvent`'s shape. Add a crate or a `notify` feature. Follow symlinks. Make the index walker
Rust (Phase B decided the walker).

**Risks and open questions.** Linux inotify needs a watch per directory and has a system limit; it
cannot be tested on this machine; the contract is that `watch` rejects and the app falls back
(C-11). FSEvents sometimes reports a directory instead of a file; `apply` handles directories by
subtree. A 200,000-file snapshot is tens of MB; report the RSS of a 50,000-file scratch watch.

---

### C-06 — Give every selection kind an explicit default verb, and copy a drag selection as rich text

**Model:** opus · **Size:** M · **Depends on:** C-01 (merge order only: the test glob) · **Parallel with:** C-02, C-03, C-04, C-05

**Outcome.** `Mod+C` runs the selection's default copy verb, chosen from a written table by
selection kind, never by string prefix and never a splice. A drag across bold text and a link
pastes into Docs or Mail with its formatting (sanitised HTML plus plain text in one clipboard
write). `Mod+Shift+C` copies exact markdown: the source bytes of the selected block, or of the
blocks a drag covers. A click on a table cell offers the table's verbs, and a click on a task
item's text offers "Toggle task", through one widening rule shared by the palette and the
keyboard.

**Why now.** `08` §1 findings 3 and 4: `runCopyShortcut` picks the first operation whose id starts
with `copy-` (`apps/desktop/src/selection/apply.ts:38-56`, mirrored in
`selection/bind.ts:71-83`), which becomes order-dependent the moment the pack lands; a drag copies
plain text only (`apply.ts:49-53`) though the shell already writes both flavours
(`apps/desktop/src-tauri/src/main.rs:66-79`). §1 finding 2: `align-table-pipes` needs a cell click
plus two `Alt+Shift+Up`.

**Paths.**
- `apps/desktop/src/selection/verbs.ts`, `verbs.test.ts` (new)
- `apps/desktop/src/selection/copy-html.ts` (new)
- `apps/desktop/src/selection/apply.ts`, `bind.ts`, `input.ts`
- `apps/desktop/src/commands/registry.ts`, `commands/index.ts`
- `apps/desktop/src/commands/copy-text.ts` (new)
- `apps/desktop/src/palette/view.ts` (only `paintOperationRows`' hint, `view.ts:270`, and a palette
  opener: `open(query?: string)` on the controller, registered in `mountPaletteFromHandle`)
- `apps/desktop/test/operations-copy.test.mjs`, `operations-edit.test.mjs` (new cases)
- `changelog.d/C-06.md`

**Build order.**
1. `verbs.ts`:
   ```ts
   export type VerbKind = 'text' | 'code' | 'table' | 'section' | 'document' | 'task' | 'block' | 'inline';
   export function verbKindOf(sel: Selection, doc: Document): VerbKind | null;
   /** Command ids in menu order. Ids not (yet) registered are skipped. The one place verbs are ordered. */
   export const MENU_ORDER: Readonly<Record<VerbKind, readonly string[]>>;
   /** Mod+C candidates; the first registered and applicable wins. Clipboard-only ids. */
   export const COPY_DEFAULT: Readonly<Record<VerbKind, readonly string[]>>;
   /** Mod+Shift+C candidates. */
   export const MARKDOWN_COPY: Readonly<Record<VerbKind, readonly string[]>>;
   export function firstApplicable(ids: readonly string[], ctx: AppContext): Command | null;
   ```
   Kinds: drag → `text`; `document` → `document`; `section` or a heading node → `section`;
   `codeBlock` → `code`; `table`/`tableRow`/`tableCell` → `table`; a task `listItem`, or a
   paragraph whose parent `listItem` has `task` → `task`; any other block → `block`; inline → `inline`.
   The tables, written in full now (C-07 to C-09 register the `op.*` ids later):

   | Kind | `MENU_ORDER` | `COPY_DEFAULT` | `MARKDOWN_COPY` |
   | --- | --- | --- | --- |
   | text | `selection.copy-rich`, `selection.copy-plain`, `selection.copy-markdown` | `selection.copy-rich` | `selection.copy-markdown` |
   | code | `op.copy-code-clean`, `op.copy-command`, `op.copy-source`, `op.copy-rich`, `view.jump-to-source` | `op.copy-code-clean` | `op.copy-source` |
   | table | `op.copy-table-tsv`, `op.copy-table-csv`, `op.copy-table-json`, `op.copy-source`, `op.copy-rich`, `op.align-table-pipes` | `op.copy-table-tsv`, `op.copy-source` | `op.copy-source` |
   | section | `op.copy-section`, `op.copy-rich`, `op.copy-plain`, `op.extract-tasks`, `op.extract-code-blocks`, `op.extract-links`, `view.jump-to-source` | `op.copy-section` | `op.copy-section` |
   | document | `op.copy-section`, `op.copy-plain`, `op.extract-tasks`, `op.extract-code-blocks`, `op.extract-links` | `op.copy-section` | `op.copy-section` |
   | task | `op.toggle-task`, `op.copy-rich`, `op.copy-plain`, `op.copy-source`, `view.jump-to-source` | `op.copy-rich`, `op.copy-source` | `op.copy-source` |
   | block | `op.copy-rich`, `op.copy-plain`, `op.copy-source`, `view.jump-to-source` | `op.copy-rich`, `op.copy-source` | `op.copy-source` |
   | inline | `op.copy-source`, `view.jump-to-source` | `op.copy-source` | `op.copy-source` |
2. `input.ts`: `operationInputsFor(sel, doc, buffer): readonly OperationInput[]` — the node's own
   input first (today's `operationInputFor`, `input.ts:7-40`, which stays as the first element),
   then widened inputs: a `tableCell` or `tableRow` adds its enclosing `table`; a paragraph inside a
   task `listItem`, or the item itself, adds the `listItem` (C-02 makes `toggle-task` accept it).
3. `registry.ts`: `AppContext` gains `operationInputs(): readonly OperationInput[]`; `fromOperation`
   (`registry.ts:30-46`) uses the first input the operation's `canApply` accepts, in `when` and `run`.
   `bind.ts` `buildAppContext` (`bind.ts:41-55`) supplies it.
4. `copy-html.ts`: `htmlFromDomSelection(sel: globalThis.Selection): string` — clone the range;
   remove elements with the classes `marxy-invisible-glyph`, `marxy-link-dest`,
   `marxy-link-host-label` (`selection/copy-text.ts:3`) and `marxy-lb` (typesetter break,
   `packages/typeset/src/apply.ts:11`); unwrap `marxy-hang`; drop U+00AD; remove every attribute
   except `href`, `title`, `alt`, `colspan`, `rowspan`, `start`; drop `img` `src`; serialise by
   reading a detached container's `innerHTML` (reading is not one of the routes
   `scripts/check-registry.mjs` forbids); then `sanitizeHtml(html, DEFAULT_POLICY).html` from core's
   sanitiser as the second line of defence.
5. `commands/copy-text.ts`: three commands, group `selection`, `when: ctx.selection.kind === 'text'`:
   `selection.copy-rich` "Copy" → `{ text: textFromDomSelection(sel), html }`;
   `selection.copy-plain` "Copy as plain text" → `{ text }`;
   `selection.copy-markdown` "Copy as markdown" → the bytes from the first to the last top-level
   block the DOM range touches (each end's `closest('[data-marxy-s]')`, climbed to the article's
   direct child), via `textOf(buffer, range)`. Listed in `commands/index.ts`.
6. `apply.ts`: `runCopyShortcut(ctx)` resolves `firstApplicable(COPY_DEFAULT[kind], ctx)` and runs
   it, else falls back to `document.execCommand('copy')` as today; `runMarkdownCopy(ctx)` does the
   same over `MARKDOWN_COPY`. Delete the prefix loop. `bind.ts`: replace the `copyApplies` prefix
   test with "a default verb exists", and bind `Mod+Shift+C` to `runMarkdownCopy`.
7. `view.ts`: the hint shows `⌘C` on the row whose id is the current default verb and `⇧⌘C` on the
   markdown one (instead of `cmd.id.startsWith('op.copy-')`); add `open(query?: string)` to the
   controller (summon with that query) and register it with a new `setPaletteOpener` in `bind.ts`
   so C-13's "All actions…" can open the palette in `>` mode.

**Acceptance.**
- `verbs.test.ts`: every kind has a non-empty `COPY_DEFAULT`; every `op.*` id in `COPY_DEFAULT` and
  `MARKDOWN_COPY` that is registered leaves the text unchanged when run over every applicable node
  of `fixtures/corpus/02-readme-real-world.md` and `03-ai-plan.md` (`replacement === text`), so
  `Mod+C` can never splice; `verbKindOf` for a code block, a table cell, a heading, the document, a
  task item's paragraph, a plain paragraph and a drag.
- Existing `operations-copy.test.mjs` cases (Install section `:72`, code block `:106`, `:179`)
  produce byte-identical clipboard payloads.
- New `operations-copy.test.mjs` case: drag across bold text and a link in
  `02-readme-real-world.md`, `Mod+C` → one `clipboardWrite` with `text` and `html`; the HTML
  contains `<strong>` and `<a href=`, and no `data-marxy-`, no `class=`, no `<script`, no U+00AD.
- New case: a drag inside one paragraph, `Mod+Shift+C` → the paragraph's exact source bytes
  (compared with `textOf` over its `data-marxy-s`/`-e`).
- New `operations-edit.test.mjs` case: click the text of a task item in `03-ai-plan.md`; the
  palette's `>` list offers "Toggle task"; running it changes only the marker bytes.
- A click on a table cell: the palette's `>` list offers "Align table pipes".

**Tests.** `pnpm --filter @marxy/desktop test` (with WebKit installed, or
`MARXY_BROWSER_TESTS_REQUIRED=1`); `pnpm check:registry`; `pnpm precheck`.

**Do not.** Run a splice from `Mod+C`. Change any core operation (C-02, C-07 to C-09 own them).
Build the verb menu (C-13). Add a native menu item (`docs/design/09-app-shell.md:70-85`: Edit keeps
the OS's items). Edit design docs (C-01 wrote them).

**Risks and open questions.** Phase B moves the selection runtime; follow it. WebKit's
`cloneContents` on a partly selected, typeset paragraph may leave empty inline wrappers; they are
harmless after sanitising. Report whether `⌘⇧C` reaches the webview in the built app on macOS (no
native menu item claims it today).

---

### C-07 — Copy pack: plain text, rich text and exact markdown for any block or section

**Model:** sonnet · **Size:** S · **Depends on:** C-02 · **Parallel with:** C-08, C-09, C-13, C-10, C-16

**Outcome.** Three verbs apply to any block, section or the document: "Copy as plain text" (the
words, no markup), "Copy as rich text" (sanitised HTML with plain text beside it) and "Copy as
markdown" (the exact source bytes). With C-06's table they become `Mod+C` for an ordinary block and
`Mod+Shift+C` everywhere.

**Why now.** `08` §4.1 rows 3, 4 and 5, ranked first, second and tenth of the ten to build first
(§4.5); handbook spec `docs/research/reader-artifacts/10-spec.md:98` (`copy-source`).

**Paths.**
- `packages/core/src/operations/pack-copy.ts`
- `packages/core/src/operations/copy-plain.ts`, `copy-rich.ts`, `copy-source.ts`, `plain-text.ts` (new)
- `packages/core/src/operations/pack-copy.test.ts` (new)
- `changelog.d/C-07.md`

**Build order.**
1. `plain-text.ts`: `plainTextOf(blocks: readonly Block[]): string` — paragraphs and headings by
   `inlinePlainText` (C-02), blocks separated by one blank line; list items one per line with `- `
   or `N. ` (starting from `list.start`), task items with `[ ] ` or `[x] ` after it, nested items
   indented two spaces per level; code and math blocks as their `value`; tables as tab-separated
   rows; blockquotes as their content without `> `; HTML blocks and front matter dropped; no
   trailing newline.
2. `copy-source.ts` (`id: 'copy-source'`, title "Copy as markdown", `appliesTo: ['block',
   'section', 'document']`): `canApply` when `input.node` is a block or the range is the whole
   document; clipboard text is `input.text` exactly.
3. `copy-plain.ts` (`copy-plain`, "Copy as plain text"): the range's blocks (a heading's section, a
   single block, or the document's children) through `plainTextOf`.
4. `copy-rich.ts` (`copy-rich`, "Copy as rich text"): `{ text: plainTextOf(...), html:
   stripRendererProvenance(renderDocumentSafeHtml(sectionOf(input)).html) }` using `html-clean.ts`
   (C-02) and `render/pipeline.ts`, exactly as `copy-section.ts:146` builds its HTML.
5. `pack-copy.ts`: `COPY_PACK = [copySource, copyPlain, copyRich]`.

**Acceptance.**
- `pack-copy.test.ts` table cases for each operation: LF, CRLF, no trailing newline, a BOM-prefixed
  document, CJK, a nested list, a task list, a table, a fenced block, `canApply` false for an
  inline node.
- `copy-source` returns `textOf(buffer, node.src)` byte-for-byte for every block in the corpus.
- `copy-plain` contains no markup character the AST marked as markup: for every corpus paragraph
  it equals `inlinePlainText` of the paragraph.
- `copy-rich`'s HTML contains no `data-marxy-` attribute in a tag, and its text content
  (tags stripped, entities decoded, whitespace collapsed) equals `copy-plain`'s whitespace-collapsed
  output for every top-level corpus block.
- C-02's generalised fidelity property passes with the pack registered (`operations.test.ts`).

**Tests.** `pnpm --filter @marxy/core test`; `pnpm gate:fidelity`; `pnpm precheck`.

**Do not.** Edit `index.ts`, `copy-section.ts` or another pack's file. Emit markdown from
`copy-plain`. Touch `apps/desktop`.

**Risks and open questions.** The plain-text conventions (list markers kept, `[ ]` kept) are a
reasoned default with no study behind them (`08` §4 grade [D]); say so in the PR so the author can
overrule.

---

### C-08 — Copy a table as TSV, CSV or JSON, ready for a spreadsheet

**Model:** sonnet · **Size:** S · **Depends on:** C-02 · **Parallel with:** C-07, C-09, C-13, C-10, C-16

**Outcome.** A selected table copies as TSV (with an HTML table beside it, so Numbers, Sheets and
Excel paste one value per cell), as RFC 4180 CSV, or as a JSON array of objects keyed by the header
row. This is the verb the screen criterion pastes.

**Why now.** `08` §4.1 row 8 ("AI tables go to spreadsheets"; a scratch prototype passed all 20
corpus tables with `replacement === text`, appendix); ranked third in §4.5.

**Paths.**
- `packages/core/src/operations/pack-table.ts`
- `packages/core/src/operations/table-cells.ts`, `copy-table.ts` (new)
- `packages/core/src/operations/pack-table.test.ts` (new)
- `changelog.d/C-08.md`

**Build order.**
1. `table-cells.ts`: `cellGrid(table: Table): string[][]` — header row first, each cell
   `inlinePlainText(cell.children, { hardBreak: ' ' })` (C-02), rows padded with `''` to the widest
   row; the alignment row is not a row in the AST.
2. `copy-table.ts`: three operations, `appliesTo: ['block']`, `canApply` only when
   `input.node?.type === 'table'` (C-06 widens a cell or row click to its table):
   - `copy-table-tsv` "Copy table as TSV": cells joined by `\t`, rows by `\n`; a tab or line break
     inside a cell becomes one space; clipboard `html` is `<table><thead>…</thead><tbody>…</tbody></table>`
     with every cell text escaped (`escapeText` from `sanitize/escape.ts`), nothing else.
   - `copy-table-csv` "Copy table as CSV": RFC 4180 (quote a field containing `,`, `"`, CR or LF;
     double inner quotes; rows joined by `\r\n`).
   - `copy-table-json` "Copy table as JSON": `JSON.stringify(rows, null, 2)`, each row an object
     keyed by header text; an empty header becomes `column N`, a repeated one `name (2)`; a row
     longer than the header adds `column N` keys; all values strings.
3. `pack-table.ts`: `TABLE_PACK = [copyTableTsv, copyTableCsv, copyTableJson]`.

**Acceptance.**
- `pack-table.test.ts` cases: escaped pipes (`\|` arrives as `|`), inline code containing a pipe,
  links and emphasis flattened, CJK, empty cells, ragged rows, a CRLF table, a table in a
  BOM-prefixed document, `canApply` false on a `tableCell` node.
- Round trip over every corpus table: TSV split on `\n` and `\t` equals `cellGrid`; CSV read back by
  a 20-line RFC 4180 reader in the test equals `cellGrid`; `JSON.parse` gives one object per body
  row with the header keys.
- The TSV operation's HTML has exactly `rows × columns` `<th>`/`<td>` elements and no attribute.
- C-02's fidelity property passes with the pack registered.

**Tests.** `pnpm --filter @marxy/core test`; `pnpm gate:fidelity`; `pnpm precheck`.

**Do not.** Change `align-table-pipes`. Infer numbers or types in JSON. Edit another pack's file or
`index.ts`.

**Risks and open questions.** None known; the prototype ran. If a spreadsheet prefers the HTML
flavour and mangles something (merged header cells), report the app and the payload.

---

### C-09 — Copy a shell command without its prompts; extract every code block, unchecked task and link

**Model:** sonnet · **Size:** M · **Depends on:** C-02 · **Parallel with:** C-07, C-08, C-13, C-10, C-16

**Outcome.** On a shell or console fence, "Copy command" copies only the commands, prompts removed,
continuations kept, no trailing newline, and refuses a block carrying characters that change what a
terminal runs. On a section or the whole document, three verbs gather what an agent's answer
scatters: every code block, every unchecked task, every link.

**Why now.** `08` §4.1 rows 6, 7 and 9 and §4.3 rows 29-30 (ranked fourth, fifth and seventh);
the rules for `copy-command` are already written in
`docs/research/reader-artifacts/06-readmes.md:131-136`, and the names in
`docs/research/reader-artifacts/10-spec.md:99,103`.

**Paths.**
- `packages/core/src/operations/pack-extract.ts`
- `packages/core/src/operations/copy-command.ts`, `extract.ts` (new)
- `packages/core/src/operations/pack-extract.test.ts` (new)
- `changelog.d/C-09.md`

**Build order.**
1. `copy-command.ts` (`copy-command`, "Copy command", `appliesTo: ['block']`): implement the five
   rules of `06-readmes.md:131-136` as written (console-family languages and the empty language vs
   `sh`/`bash`/`zsh`/`shell`; output lines dropped; `\` and `> ` continuations and here-document
   bodies kept; offered only when a prompt line exists; no trailing newline). For rule 5, when the
   block contains U+202A-202E, U+2066-2069, U+200B-200D, U+2060, U+FEFF after the first character, or
   U+E0000-E007F, `run` returns `{ replacement: input.text, summary: 'Not copied: the command
   contains invisible or direction-changing characters' }` and no clipboard (the app shows the
   summary, `selection/apply.ts:33-35`).
2. `extract.ts`, each `appliesTo: ['section', 'document']`, `canApply` for a heading node or the
   whole-document range and only when the range holds at least one item:
   - `extract-code-blocks` "Copy all code blocks": code block `value`s in document order joined by a
     blank line; summary `Copied N code blocks`.
   - `extract-tasks` "Copy unchecked tasks": every `listItem` with `task === 'unchecked'` in the range,
     one line each, `- [ ] ` plus `inlinePlainText` of its first paragraph, indented two spaces per
     nesting level relative to the shallowest; summary `Copied N unchecked tasks`.
   - `extract-links` "Copy all links": every `link` in document order, deduplicated by URL, one line
     each as `- [text](url)`.
3. `pack-extract.ts`: `EXTRACT_PACK = [copyCommand, extractCodeBlocks, extractTasks, extractLinks]`.

**Acceptance.**
- `pack-extract.test.ts`, `copy-command`: a `console` block with `$ `, `# ` and output lines; a `bash`
  block where `#` is a comment and stays; `\` continuation; a `> ` continuation in `console` only; a
  here-document; a `PS C:\> ` prompt; no prompt line → `canApply` false; a zero-width space →
  refusal summary and no clipboard; output never ends in a newline.
- `extract-tasks` over `fixtures/corpus/03-ai-plan.md` (document scope) returns exactly its unchecked
  items in document order (the expected lines written into the test); section scope returns only
  that section's.
- `extract-code-blocks` over `28-llm-answer.md` returns as many blocks as the AST has, in order;
  `extract-links` over `02-readme-real-world.md` has no duplicate URL.
- `canApply` for the three extract verbs on `32-long-reference.md`'s document range: the test prints
  the median time; the PR reports it under 1 ms (the palette evaluates `when` on every open).
- C-02's fidelity property passes with the pack registered.

**Tests.** `pnpm --filter @marxy/core test`; `pnpm gate:fidelity`; `pnpm precheck`.

**Do not.** Change `copy-code-clean` (its trailing-newline contradiction in `10-spec.md:59` is a
separate fix). Follow, fetch or resolve any link. Edit another pack's file or `index.ts`.

**Risks and open questions.** Joining code blocks by a blank line loses their languages; the
alternative (each as a fenced block) is a one-line change. Report which the author would expect,
and keep the plain join until told.

---

### C-10 — Load `collection.toml` into the index: declared folders join the palette's scope

**Model:** opus · **Size:** M · **Depends on:** C-03, C-04, Phase A's index service · **Parallel with:** C-07, C-08, C-09, C-13, C-16

**Outcome.** On launch, after the first text, Marxy reads `collection.toml` beside `config.toml`
and indexes each declared folder through the index service. `⌘P` then searches the current
repository first, the declared folders next in file order, then the twelve recent roots. Editing
`collection.toml` while Marxy runs adds or drops folders without a restart. A malformed file costs
one notice and nothing else. Each root remembers when Marxy first indexed it, which C-12 uses so a
newly added folder does not flood "Changed since you read".

**Why now.** `06` §4.1-4.4 and §6.1 (`loadIndex` becomes multi-root; scope is the collection plus
the current root); ADR-0012's twelve recent roots (`INDEX_LIMITS.recentRoots`,
`packages/core/src/contracts/index-entry.ts:14`) are kept. `01-codebase-audit.md` §7: the index
model is already root-parametrised; what it lacks is an owner (Phase A) and a list of roots (this).

**Paths.**
- `apps/desktop/src/collection/load.ts`, `load.test.ts` (new)
- `apps/desktop/src/collection/scope.ts`, `scope.test.ts` (new)
- `apps/desktop/src/palette/index-feed.ts` (new: the palette's entries and prepared index, moved out
  of `view.ts`)
- `apps/desktop/src/palette/view.ts` (only: read entries and the prepared index from the feed;
  pass `rootRank` to `paletteResults`)
- `apps/desktop/src/palette/search.ts` (only: a `rootRank` option replacing the recent-roots rank at
  `search.ts:94-103`)
- `apps/desktop/src/index/service.ts` (Phase A's; extended)
- `apps/desktop/src/theme/user-theme.ts` (export `inferHomeFromConfig`, `user-theme.ts:50`; no
  behaviour change)
- `packages/core/src/index-model/walk.ts` (`WalkOptions.extraRules`)
- `packages/core/src/index-model/persist.ts`, `persist.test.ts` (optional `baselineMs`)
- the composition root that Phase B left (`apps/desktop/src/app.ts` or `main.ts`): one call to start
  the collection after `first_text`
- `apps/desktop/test/collection.test.mjs` (new, palette harness)
- `changelog.d/C-10.md`

**Build order.**
1. `load.ts`: `collectionFile(shell)` = `dirname(configPaths().config) + '/collection.toml'`;
   `loadCollection(shell): Promise<{ collection: Collection; warnings: readonly string[] }>` using
   `parseCollection` (C-03) and the home from `inferHomeFromConfig`; a missing file is an empty
   collection with no notice; warnings go to one `notify({ kind: 'info', … })`.
   `watchCollection(shell, onChange)` watches the config directory (non-recursive) and calls back
   when `collection.toml` changes.
2. `walk.ts`: `collectFiles(root, reader, options)` accepts `options.extraRules?: readonly IgnoreRule[]`
   appended after the root's own ignore rules (`walk.ts:33-34`); denied names still win.
3. `persist.ts`: `IndexSnapshot.baselineMs?: number`; `parseSnapshot` accepts it; the version stays 1.
4. `service.ts`: `ensureRoot(root, opts?: { watch?: boolean; deny?: readonly IgnoreRule[] })`,
   `dropRoot(root)`, `baselineMs(root): number | undefined` (set when a root is first indexed, kept
   in its snapshot, never moved), `isWatched(root): boolean` (declared `watch`; the current
   repository root counts as watched). Do not start watches here (C-11 does).
5. `scope.ts`: `scopeRoots({ current, declared, recent }): readonly string[]` (that order,
   deduplicated); `scopedEntries(entries, scope, cap = 100_000): { entries; notice? }` keeps one entry
   per path (the earliest root in scope wins, so a folder nested in a repository is not listed
   twice) and drops from the end of the scope order past the cap, with a palette notice;
   `rootRank(scope)(root): number`.
6. `index-feed.ts`: owns `entries` and `prepared` (today `view.ts:332-333`), subscribes to the
   service, applies `scopedEntries`, rebuilds `prepared` when roots change, and exposes
   `entries()`, `prepared()`, `rootRank()`, `notice()`, `subscribe()`. `view.ts`'s
   `setIndexEntries` (`view.ts:494-498`) delegates to it or is removed if Phase A removed the
   one-shot path.
7. `search.ts`: `paletteResults(query, entries, session, { prepared, limit, rootRank })`;
   `searchPrepared` orders later hits by `rootRank` (current root still first,
   `search.ts:88-92`), defaulting to today's recent-roots order when absent.
8. Start-up: after `first_text` (never before, `index-model/schedule.ts:9`), load the collection,
   `ensureRoot` each declared root in file order, then the recent roots (snapshot first), and emit
   the `collection_loaded` mark with `roots=N entries=M ms=T`.

**Acceptance.**
- `load.test.ts` (memory shell, `apps/desktop/src/shell/memory.ts`): no file → empty, no notice;
  malformed file → one notice, and the current-root search still works; `~/x` resolves under the
  inferred home.
- `scope.test.ts`: order current → declared → recent; a declared folder inside the current repository
  yields each path once; the cap keeps the head of the scope and returns a notice.
- `collection.test.mjs` (palette harness, memory shell): declared roots `/a` and `/b`, document
  `/c/README.md` open; typing `notes` lists `/c`'s hit first, then `/a`'s and `/b`'s; a file under
  `**/drafts/**` (declared deny glob) never appears; rewriting `collection.toml` without `/b` and
  emitting the watch event drops `/b`'s hits with no restart.
- `persist.test.ts`: a snapshot with `baselineMs` round-trips; one without parses.
- A second service instance over the same data directory reports the same `baselineMs`
  (service test).
- The memory shell's marks show `collection_loaded` once, after `first_text`.

**Tests.** `pnpm --filter @marxy/desktop test`; `pnpm --filter @marxy/core test`; `pnpm check:registry`;
`pnpm precheck`.

**Do not.** Start recursive watches (C-11). Change ranking weights or the empty state (C-12). Write
`collection.toml` (C-14). Add a settings surface, a folder picker or a sidebar (`06` §3.3). Index
file contents (`IndexEntry` is "never contents", `index-entry.ts:1`).

**Risks and open questions.** Phase A's service may already persist and refresh; then this story is
smaller, so say what was already there. The in-app walk time per root is unmeasured (`06` §1.3,
`05` §7.2); record `index_loaded` per root with its milliseconds and report any root over 2 s.
Recent roots served from a snapshot can be stale until their idle walk finishes; that matches
`06` §4.3 item 4.

---

### C-11 — Keep the collection fresh: a watch event patches one entry, never the whole index

**Model:** opus · **Size:** M · **Depends on:** C-05, C-10, C-04 · **Parallel with:** C-12, C-14

**Outcome.** A file an agent writes, renames or deletes in a watched folder appears in, changes in,
or leaves the palette within the watch debounce, without a restart and without rebuilding the
index: one changed file re-reads one file head and patches one row. A folder the OS refuses to
watch says so once in the palette's notice line and is re-walked when the palette is summoned.

**Why now.** `06` §1.2 ("a file an agent writes after launch is not in the palette until the next
launch"), §4.3 items 2-5 and §6.4 story 6 (acceptance quoted below); `05` §11.1 rank 2 ("build once
per root per session … update from the watcher").

**Paths.**
- `packages/core/src/index-model/apply-events.ts`, `apply-events.test.ts` (new)
- `packages/core/src/index-model/index.ts` (export)
- `apps/desktop/src/index/service.ts`
- `apps/desktop/src/collection/watch.ts`, `watch.test.ts` (new)
- `apps/desktop/src/palette/index-feed.ts` (patch instead of rebuild)
- `apps/desktop/test/collection.test.mjs` (new cases)
- `changelog.d/C-11.md`

**Build order.**
1. `apply-events.ts` (pure): `planEvents(known: ReadonlySet<string>, events: readonly WatchEvent[],
   root: string, rules: readonly IgnoreRule[]): { reread: string[]; remove: string[]; revalidate: boolean }`
   — created or modified → `reread` if `classify` allows it and it is neither denied nor ignored;
   removed → `remove`; renamed → remove `path`, reread `to`; a change to a `.gitignore` or `.ignore`
   → `revalidate` (walk the root again at idle).
2. `service.ts`: for each root that `isWatched`, `shell.watch(root, cb, { recursive: true })` (C-05);
   on a batch, `planEvents`, then for `reread` paths `stat` and read the first 256 KB through
   `peekFile` when the shell has it (not `readFile`, which keeps a copy of the bytes for the
   stale-write guard, `apps/desktop/src/shell/tauri.ts:95`), build entries with
   `entryFromCandidate`, and publish a patch `{ root, upserted, removed }` to subscribers; persist the
   root's snapshot at most once every 2 s. A rejected watch → record the root as `rescanOnSummon`
   and publish the notice `Not watching <name>; rescanned when you open the palette`.
3. `collection/watch.ts`: the lifecycle (start on `ensureRoot` with `watch`, close on `dropRoot` and
   on quit; the open-document watch at `app.ts:892-904` is untouched).
4. `index-feed.ts`: apply a patch with `upsertRows` / `removeRows` (C-04); rebuild only when the
   root set changes; on summon, ask the service to revalidate any `rescanOnSummon` root.

**Acceptance.**
- `apply-events.test.ts`: write-temp-then-rename onto an existing path → `reread` that path; delete →
  `remove`; a path under `node_modules` or matched by `.gitignore` → nothing; a rename out of the root
  → `remove` only; a `.gitignore` change → `revalidate`.
- `collection.test.mjs` (memory shell `emit`): a file created by temp-then-rename in a watched root is
  listed after the batch; deleting it removes it; a burst of 20 events writes the snapshot once;
  one changed file triggers one `prepareRow` call (C-04's counter), not a rebuild.
- A memory shell whose `watch` rejects: the palette notice shows the line above, and summoning the
  palette triggers one revalidation walk (count `readDir` calls).
- `apps/desktop/test/live-reload.test.mjs` passes unchanged.
- Manual, recorded not gated (`06` §6.4 story 6): in the built app an agent-style atomic write in a
  watched folder is listed in `⌘P` within about 100 ms of the debounce.

**Tests.** `pnpm --filter @marxy/core test`; `pnpm --filter @marxy/desktop test`; `pnpm precheck`.

**Do not.** Change the open document's live reload (ADR-0018). Watch recent roots that are not
declared and not current. Read whole files for the index (the 256 KB head, `startup/idle-work.ts:142`).

**Risks and open questions.** Events for the open document now arrive on two watches (its folder and
the tree); C-05's key filter keeps them apart, but verify one reload per change in the built app. A
folder with very frequent writes (a log) could patch continuously; report if the debounce is not
enough.

---

### C-12 — The empty palette shows Pinned, Changed since you read, and Recent, each with its age

**Model:** sonnet · **Size:** M · **Depends on:** C-10, C-04 · **Parallel with:** C-11, C-14

**Outcome.** Summon the palette with nothing typed and it answers "what changed since I last
looked": three short sections, each hidden when empty, twelve rows in all. Pinned documents first;
then up to five files in watched folders whose modification time is newer than when you last read
them (or, never read, newer than when Marxy started watching the folder), newest first; then
recent documents. Every row shows a dim relative age (`now`, `4m`, `3h`, `2d`, `5w`, `1y`); a
changed row carries one small mark. Typed results from watched folders show the age and mark too.

**Why now.** `06` §3.5 and §5.2 ("this is the whole freshness feature … no surveyed tool answers
this question"); the roadmap's Phase C empty state. Phase A filled `lastReadMs`, so "mtime greater
than last read" needs no new field (`06` §3.5).

**Paths.**
- `apps/desktop/src/palette/empty-state.ts`, `empty-state.test.ts` (new)
- `apps/desktop/src/palette/view.ts` (empty-phase painting, section labels, row age and mark,
  arrow keys skip labels, styles in `injectPaletteStyles` at `view.ts:154-207`)
- `apps/desktop/test/palette.test.mjs` (new cases)
- `changelog.d/C-12.md`

**Build order.**
1. `empty-state.ts`:
   ```ts
   export type EmptySectionKind = 'pinned' | 'changed' | 'recent';
   export interface EmptySection { readonly kind: EmptySectionKind; readonly hits: readonly IndexHit[] }
   export function emptyStateSections(input: {
     entriesByPath: ReadonlyMap<string, IndexEntry>; session: PaletteSession; nowMs: number;
     watched: (root: string) => boolean; baselineMs: (root: string) => number | undefined;
     limit?: number; changedCap?: number;   // 12 and 5
   }): readonly EmptySection[];
   export function changedSinceRead(entry: IndexEntry, baselineMs: number | undefined): boolean;
   export function relativeAge(nowMs: number, thenMs: number): string;
   ```
   Pinned follows `emptyQueryPaths`' pinned part (`session.ts:97-103`); Changed is every entry in a
   watched root for which `changedSinceRead` holds, not pinned, newest `mtimeMs` first, capped;
   Recent is the MRU minus both; each path once; empty sections omitted; total ≤ `limit`.
   `changedSinceRead`: `lastReadMs` defined → `mtimeMs > lastReadMs`; undefined → `baselineMs`
   defined and `mtimeMs > baselineMs`. `relativeAge`: under 60 s `now`, then minutes, hours, days
   under 14, weeks under 52, years; a future time is `now`.
2. `view.ts`: in the empty phase, paint one non-selectable `li.marxy-palette-section` label
   (`role="presentation"`, text "Pinned", "Changed since you read", "Recent") before each section's
   rows; each row gets a trailing `span.marxy-palette-age` and, when changed, a
   `span.marxy-palette-changed` with `aria-label="Changed since you read"`; ArrowUp/ArrowDown and the
   selected index skip labels; `⌘.` still pins the selected row's path. Typed rows from watched roots
   get the same age and mark. Styles use existing tokens only:
   `--marxy-color-text-secondary` for labels and ages, `--marxy-color-accent` for the mark.
3. After a document opens, its entry's last-read is the open time (if Phase A only fills
   `lastReadMs` at load, update it on open where Phase A fills it), so the row moves from Changed to
   Recent on the next summon.

**Acceptance.**
- `empty-state.test.ts`: a fixture of entries, session, roots and a fixed `nowMs` gives exactly the
  expected sections and order, covering: read then modified (changed); read after modified (not);
  never read, modified after the baseline (changed); never read, before the baseline (not); an
  unwatched root (never changed); a pinned and changed file (in Pinned, marked); the cap of five;
  the total of twelve.
- `relativeAge` table at each unit boundary.
- `palette.test.mjs`: the empty palette shows the three labels in order with their rows; ArrowDown
  from the last Pinned row lands on the first Changed row; opening a changed row and summoning again
  lists it under Recent; `documentHasTabBar()` is still false (`view.ts:131-134`).
- Typed ranking is unchanged for the existing fixtures (`search.test.ts` green).
- `pnpm check:registry` passes (classes only, all `marxy-` prefixed).

**Tests.** `pnpm --filter @marxy/desktop test`; `pnpm check:registry`; `pnpm precheck`.

**Do not.** Show a count, a badge or anything outside the summoned palette (ADR-0050). Change ranking
or weights. Persist anything (C-10 owns the baseline). Add a preview pane (`06` §5.2).

**Risks and open questions.** The section names, the mark and the age format are taste; the author
judges them by opening the app. Whether a never-read file should count as changed is a reasoned
default; report it so the author can rule.

---

### C-13 — One verb menu: right-click, the context-menu key, or Enter on a selection

**Model:** opus · **Size:** L · **Depends on:** C-06 · **Parallel with:** C-07, C-08, C-09, C-10, C-16

**Outcome.** One small themed menu is the only click surface for operations. Right-click anything
in the page (or Ctrl-click on macOS), press the context-menu key or `Shift+F10`, or press Enter
with a block selected: a menu opens at the pointer or under the selection, listing at most seven
verbs for what is selected, in the order C-06's table gives, each with its chord, and an "All
actions…" row when more apply. Arrow keys, Enter and Escape drive it; a click outside or a scroll
closes it. Right-click on a table cell offers the table's verbs first; on a task item, "Toggle
task". The page never shows WebKit's own context menu, and when the menu is closed nothing of it
exists in the DOM.

**Why now.** `08` §5 (the recommendation and the rejected alternatives), §1 finding 2 (two
operations hard to reach by pointer); the roadmap's "verb menu as the one click surface … at most
seven rows; themed".

**Paths.**
- `apps/desktop/src/selection/verb-menu.ts` (new)
- `apps/desktop/src/selection/view.ts` (extract the click resolution in `onClick`,
  `view.ts:276-337`, into `selectAt(target: Element, opts: { link: 'select' | 'follow' })`, used by
  both click and right-click)
- `apps/desktop/src/selection/bind.ts` (install the openers)
- `packages/theme/src/base.css` (menu styles, including the forced-colours block)
- `apps/desktop/test/verb-menu.test.mjs` (new)
- `changelog.d/C-13.md`

**Build order.**
1. `verb-menu.ts`: `openVerbMenu(at: { x: number; y: number }, ctx: AppContext): void` and
   `closeVerbMenu(): void`. Rows: `MENU_ORDER[verbKindOf(...)]` (C-06) mapped to registered commands
   whose `when(ctx)` holds, first seven; if more apply, a last row "All actions…" that calls C-06's
   palette opener with `>`. Each row shows `cmd.title` and its chord (`⌘C` for the default verb,
   `⇧⌘C` for the markdown verb, else `cmd.key` if any) and carries `aria-keyshortcuts`.
2. DOM: a `div.marxy-verb-menu` with `role="menu"` and an `aria-label` naming the selection ("Code
   block, json", "Table", "Section: Install"); rows `div.marxy-verb-menu-item` with
   `role="menuitem"`; built on open, appended to `body`, **removed** on close (never hidden).
   Positioned in the viewport, below and right of the anchor, flipped above or left when it would
   overflow.
3. Keys while open (a capturing `keydown` that stops propagation, so the registry's
   `selection.clear` on Escape, `commands/selection-nav.ts:14-23`, does not also fire): ArrowUp and
   ArrowDown wrap, Home and End, Enter runs the focused row, Escape closes and keeps the selection,
   Tab closes. Pointer: hover focuses a row, click runs it, a click outside or a scroll closes.
   Focus returns where it was.
4. Openers in `bind.ts`: a `contextmenu` listener on the article always calls `preventDefault()`;
   if a non-collapsed DOM selection contains the point it is kept, otherwise
   `selectAt(target, { link: 'select' })` selects what a click would (a link: the link node, as
   Alt+click does, `view.ts:312-317`, never followed); then open at the pointer. On `keydown`
   outside editable fields and with no dialog open: `ContextMenu`, `Shift+F10`, or `Enter` with a
   `node`, `section`, `document` or `text` selection → open anchored to the selected element's
   rectangle (or the DOM selection's last client rect).
5. `base.css`: `.marxy-verb-menu` and its items with existing tokens only (`--marxy-color-bg`,
   `--marxy-color-text`, `--marxy-color-text-secondary` for chords, `--marxy-color-rule` for the
   border, `--marxy-color-selection` for the focused row, `--marxy-font-text`); a rule in the
   forced-colours block (`base.css:489` area) so the border and focus survive forced colours.

**Acceptance.**
- `verb-menu.test.mjs` (palette harness): at rest, after opening and closing, and after running a
  verb, `document.querySelector('.marxy-verb-menu, [role="menu"]')` is null.
- Right-click a table cell in `28-llm-answer.md`: the first row is "Copy table as TSV" (or, if C-08
  has not merged, the first applicable table verb), "Align table pipes" is present, there are at
  most seven verb rows; choosing the first row writes the TSV to the memory shell clipboard.
- Right-click a task item's text in `03-ai-plan.md`: "Toggle task" is present; choosing it changes
  only the marker bytes of that item (buffer compared through the harness).
- Keyboard: click a code block, press Enter → the menu opens with the first row focused;
  ArrowDown then Enter runs the second verb; `Shift+F10` and `ContextMenu` also open it; Escape
  closes it and the block stays selected (`.marxy-selected` still painted).
- Every command id in the menu for a selection is also in the palette's `>` list for that selection
  (set inclusion, three selections).
- The `contextmenu` event inside the article has `defaultPrevented === true`.
- `apps/desktop/test/selection.test.mjs`, `operations-copy.test.mjs`, `operations-edit.test.mjs`
  and `palette.test.mjs` pass.

**Tests.** `MARXY_BROWSER_TESTS_REQUIRED=1 pnpm --filter @marxy/desktop test`; `pnpm check:registry`;
`node scripts/check-tokens.mjs`; `pnpm gate:aesthetics` (base.css changed); `pnpm precheck`.

**Do not.** Add a hover copy glyph, a gutter handle or a selection popover (`08` §5 rejects them).
Add a native menu or submenu. Add a token. Show anything without a deliberate act. Reorder verbs here
(C-06's table is the one place; fix it there if a bug needs it). Bind a single letter
(`docs/design/09-app-shell.md:68`).

**Risks and open questions.** "At most seven rows" is read as seven verbs plus "All actions…" when
more apply; report if the author meant eight lines total. Confirm in the built app that
`preventDefault` suppresses WKWebView's menu. Placement and look are taste: the author opens the app.

---

### C-14 — Two palette commands: Edit collection, and Add this folder

**Model:** sonnet · **Size:** S · **Depends on:** C-03, C-10 · **Parallel with:** C-11, C-12

**Outcome.** From the palette, "Add this folder to the collection" appends the open document's
repository root to `collection.toml` (creating the file with its commented header if absent), and
the collection updates without a restart. "Edit collection" opens `collection.toml` in Marxy in
Source mode. No dialog, no settings pane, no folder picker.

**Why now.** `06` §5.1 ("two commands, no dialog, no settings pane"; the collection is a document
the reader can read and edit in the tool) and §6.4 story 8.

**Paths.**
- `apps/desktop/src/commands/collection.ts` (new)
- `apps/desktop/src/commands/index.ts` (list it)
- `apps/desktop/test/collection.test.mjs` (new cases; C-10 created the file)
- `changelog.d/C-14.md`

**Build order.**
1. `collection.ts`: `collectionCommands(): readonly Command[]`, group `app`, no key.
   `collection.add-folder` "Add this folder to the collection": `when` a document is open and its
   root (`service.rootFor(path)`) is not declared; `run` reads the file (empty if absent), applies
   `appendRoot` (C-03), `writeFileAtomic`, and notifies `Added <name> to the collection`; if already
   present, `Already in the collection`.
   `collection.edit` "Edit collection": if the file is absent, write `COLLECTION_TEMPLATE`; open it
   (`handle.open`), then `handle.jumpToSource(0)` (F-03 removed `openSourceAtByte`: a second way into Source lost
   the reader's edits; there is one Source entry, the app's).
2. `commands/index.ts`: add `...collectionCommands()`.

**Acceptance.**
- `collection.test.mjs`: on an empty config directory, Add creates the template plus one
  `[[root]]` and the palette searches that root afterwards; on a hand-edited fixture file (comments,
  CRLF), every prior byte is preserved and C-03's parser lists the new root last; Add twice writes
  once; Edit opens Source mode showing the file's bytes.
- Both commands appear in the palette's command list (Phase A's every-command listing).

**Tests.** `pnpm --filter @marxy/desktop test`; `pnpm precheck`.

**Do not.** Open a folder picker (`06` §5.1: the stub's `openDialog` throws). Write `config.toml`.
Add a key binding.

**Risks and open questions.** None known.

---

### C-15 — Fold duplicate copies that come from worktrees of one repository

**Model:** sonnet · **Size:** M · **Depends on:** C-10, C-11 · **Parallel with:** C-17

**Outcome.** A collection holding several checkouts of one repository (the author's
`~/Dev/marxy-wt` has a copy of every document per worktree) shows one hit for `AGENTS.md`, not
five: the copy in the current checkout wins; copies that genuinely differ still show.

**Why now.** `06` §3.3 ("one real problem to decide: duplicate worktrees … without it the
collection is noisier than the single repo it replaces"); `06` §1.3 counts 993 markdown files in
`~/Dev/marxy-wt` against 524 in the main checkout.

**Paths.**
- `packages/core/src/index-model/checkout.ts`, `checkout.test.ts` (new)
- `packages/core/src/index-model/index.ts` (export)
- `apps/desktop/src/index/service.ts` (a checkout side-table filled during the walk)
- `apps/desktop/src/palette/fold.ts`, `fold.test.ts` (new)
- `apps/desktop/src/palette/search.ts` (one call where `searchPrepared` assembles its result)
- `changelog.d/C-15.md`

**Build order.**
1. `checkout.ts`: `checkoutOf(path: string, root: string, hasDotGit: (dir: string) => boolean): string`
   — the nearest ancestor directory, within `root` (inclusive), whose listing contains `.git`, else
   `root`; `gitGroupKey(checkoutDir: string, dotGitFileText: string | undefined): string` — a `.git`
   directory gives `<checkout>/.git`; a `.git` file `gitdir: X` gives `X` with a trailing
   `/worktrees/<name>` removed.
2. `service.ts`: during the walk the listings already include `.git` entries (the walker skips them
   for descent only, `walk.ts:46`); record per entry `{ group, rel }` (rel = path relative to its
   checkout), reading each `.git` file once through `peekFile`.
3. `fold.ts`: `foldHits(hits, keyOf: (path) => { group: string; rel: string } | undefined,
   currentCheckout: string): IndexHit[]` — hits sharing `(group, rel)` keep one: the current
   checkout's, else the higher score, else the newer `mtimeMs`; hits whose `size` or `title` differ
   are not folded. (Not mtime, as `06` §3.3 suggests: every checkout has its own mtime, so mtime would
   fold nothing.)
4. `search.ts`: apply `foldHits` to the assembled list before the limit, typed queries only.

**Acceptance.**
- `checkout.test.ts`: a main checkout with a `.git` directory and two worktrees whose `.git` files
  point at `<main>/.git/worktrees/a` and `/b` share one group key; an unrelated repository does not.
- `fold.test.ts` and a `collection.test.mjs` case: roots `/r` (main), `/wt/a`, `/wt/b` each with an
  `AGENTS.md` of equal size and title; current document in `/wt/a`; typing `agents` lists one hit,
  `/wt/a/AGENTS.md`; give `/wt/b/AGENTS.md` a different size and both list; a single declared root
  containing several checkouts folds the same way.
- The empty state (C-12) is unaffected: pinned and recent paths are never folded.

**Tests.** `pnpm --filter @marxy/core test`; `pnpm --filter @marxy/desktop test`; `pnpm precheck`.

**Do not.** Change `IndexEntry` (the side-table is app state). Fold the empty state. Show a "+N
worktrees" label (no row-painting change in this story).

**Risks and open questions.** A worktree whose `.git` file is relative (`gitdir: ../.git/…`) must be
resolved against the checkout; cover it in the test.

---

### C-16 — Search the collection's file contents in one shell call

**Model:** opus · **Size:** M · **Depends on:** C-05 (same shell files, serial), Phase B's contract unfreeze · **Parallel with:** C-07, C-08, C-09, C-10, C-13

**Outcome.** The shell can search a list of files for a phrase and return the first matches, each
with its path, line, absolute byte offset and a short preview, in one call and in tens of
milliseconds for a collection the size of the author's. Nothing is indexed or written to disk.

**Why now.** `06` §3.4: content search should scan on demand, not keep an index (ripgrep scanned
10.6 MB in 1,450 files in 0.02 s warm); `12-recommendation-codebase.md` §4 order 5.

**The decision, and its trade-off.** A Rust command behind `shell-api`, not a TypeScript walk. The
TypeScript walk would read each file over IPC: one `readFile` round trip costs about 2 ms
(`05` §4.2), so the author's 1,450 files cost about 3 s serially and still hundreds of milliseconds
in parallel, against the 50 ms find-first-match budget in `AGENTS.md`; each `readFile` would also
keep the bytes for the stale-write guard (`shell/tauri.ts:95`). The Rust command is one IPC,
std-only file reads, in the range ripgrep showed. Its cost is one new `Shell` member (a contract
change, an ordinary PR after ADR-0045) and about 200 lines of Rust with no new crate. The webview
passes the paths, so what is searched is exactly what the index decided is in the collection (its
ignore files, deny list and extension allow-list); Rust walks nothing.

**Paths.**
- `apps/desktop/src-tauri/src/commands/search.rs` (new), `commands/mod.rs`
- `apps/desktop/src-tauri/src/main.rs` (register `search_content` in `generate_handler!`,
  `main.rs:815-834`)
- `packages/shell-api/src/index.ts` (`searchContent`, the stub)
- `apps/desktop/src/shell/tauri.ts`, `apps/desktop/src/shell/memory.ts`
- `fixtures/content-search/cases.json` (new; shared by the Rust and TypeScript tests)
- `apps/desktop/src/shell/memory-search.test.ts` (new)
- `changelog.d/C-16.md`

**Build order.**
1. `shell-api`:
   ```ts
   export interface ContentHit {
     readonly path: string; readonly line: number; readonly byteOffset: number;
     readonly preview: string; readonly matchStart: number; readonly matchEnd: number; // UTF-16 offsets in preview
   }
   searchContent(paths: readonly string[], query: string,
     opts?: { readonly limit?: number; readonly perFile?: number }):
     Promise<{ readonly hits: readonly ContentHit[]; readonly scannedFiles: number; readonly truncated: boolean }>;
   ```
2. `search.rs`: `search_content(paths, query, limit, per_file)` run on
   `tauri::async_runtime::spawn_blocking`; smart case (an all-lowercase query matches ASCII
   case-insensitively, any uppercase means exact bytes); skips non-absolute paths, directories,
   files over 4 MB, unreadable files, and files with a NUL in their first 8 KB; stops at `limit`
   (default 200) and `per_file` (default 5); `byte_offset` is from the start of the file, BOM
   included, which is the buffer's convention (`packages/core/src/parse/parse.ts:37-44`); `line` is
   1-based counting `\n`; the preview is the line cut to at most 160 characters around the match on
   UTF-8 boundaries, with control characters replaced by spaces. No new crate.
3. `tauri.ts` invokes it; `memory.ts` implements the same semantics in TypeScript for tests.
4. `cases.json`: a dozen cases (file contents, query, expected hits); a Rust test reads it from
   `fixtures/` and `memory-search.test.ts` runs it against the memory shell, so the two
   implementations cannot drift.

**Acceptance.**
- Rust tests: CRLF line numbering; a multi-byte character before the match gives the correct byte
  offset; smart case both ways; a BOM-prefixed file's offset counts the BOM; binary and oversized
  files skipped; `per_file` and `limit` respected with `truncated`; a missing path skipped.
- Both implementations pass `cases.json`.
- An ignored Rust bench (`cargo test search_bench -- --ignored --nocapture`) generates 1,500 files of
  10 MB in a temp directory and prints the warm search time; the PR reports it (target under 50 ms).

**Tests.** `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`; `cargo clippy … -- -D
warnings`; `pnpm --filter @marxy/desktop test`; `pnpm precheck`.

**Do not.** Build or persist an index (`06` §3.4: no `tantivy`). Walk directories in Rust. Add a crate
(add `memchr` only if the bench misses 50 ms, with `pnpm gate:licences`). Search anything not passed
in.

**Risks and open questions.** The path list for a 50,000-entry collection is a few MB of JSON per
call; C-17 caps it. Unicode case folding is out of scope (ASCII only); report if the author wants it.

---

### C-17 — `/` in the palette searches file contents and lands at the match

**Model:** sonnet · **Size:** M · **Depends on:** C-16, C-10, C-12 (`view.ts`, serial), C-13 (`selection/view.ts`, serial) · **Parallel with:** C-15

**Outcome.** Type `/` and a phrase in the palette: after a short pause, the rows are matches from
every file in the collection (current repository first), each with the document title, the line
number and a dim preview with the match marked, and a notice saying how many. Enter opens the file
in Rendered mode at the match with the block that holds it selected. Typing in this mode never
runs the fuzzy matcher, and nothing is written.

**Why now.** `06` §5.1 (`/` then text, "new, later") and §6.4 story 10 ("first match under 50 ms on
the author's three trees … no new file on disk"); the roadmap's "content search on demand".

**Paths.**
- `apps/desktop/src/palette/content.ts`, `content.test.ts` (new)
- `apps/desktop/src/palette/view.ts` (a `content` phase in `palettePhase`, `view.ts:69-75`; row
  painting; Enter and click)
- `apps/desktop/src/selection/view.ts` (export `selectBlockAtByte(byte: number): void`)
- `apps/desktop/test/palette-content.test.mjs` (new)
- `changelog.d/C-17.md`

**Build order.**
1. `content.ts`: `contentQuery(raw: string): string | null` (`/foo` → `foo`; anything not starting
   with `/` → null); `createContentSearch(shell, paths: () => readonly string[], onResult)`: under
   two characters → hint notice `Type to search file contents`; else a 120 ms debounce, a generation
   counter so a stale response is dropped, notice `Searching…`, then `N matches in M files`, `No
   matches`, or `Showing the first 200 matches`; paths are the scoped entries' paths (C-10), current
   root first, capped at 20,000 files with a notice. Emit the `content_search` mark with
   `ms=… hits=…`.
2. `view.ts`: phase `content` when the trimmed query starts with `/`; rows painted with
   `createElement` and `textContent` only (the palette is not in `innerHtmlAllowedIn`): title,
   `· line N`, a dim preview with the match wrapped in `mark.marxy-palette-match`; up to 50 rows in
   the scrolling list; Tab does nothing; `⌘.` pins the row's file.
3. Enter or click: `deps.openDocument(path, byteOffset)` (the palette's open, which lands a byte at
   the reading line, `app.ts:132-136`), then `selectBlockAtByte(byteOffset)` paints the innermost
   block whose `[data-marxy-s, data-marxy-e)` contains the byte.

**Acceptance.**
- `content.test.ts`: `/foo` is content, `/` alone gives the hint, `foo/bar` is a fuzzy query; with a
  fake shell, a slow first response arriving after a second query is dropped; the three notices.
- `palette-content.test.mjs` (memory shell with C-16's implementation, roots from C-10): typing
  `/baseline grid` lists hits from two roots, the current root's first; Enter opens the hit's file
  and the selected element's `data-marxy-s` ≤ byte offset < `data-marxy-e`; the memory shell records
  no `writeFileAtomic` call during the search.
- Typing in the content phase emits no `palette_keystroke` fuzzy scan (spy on `searchPrepared`).
- Manual, recorded not gated: on the author's collection, results appear within the debounce plus
  under 50 ms (`content_search` mark).

**Tests.** `MARXY_BROWSER_TESTS_REQUIRED=1 pnpm --filter @marxy/desktop test`; `pnpm check:registry`;
`pnpm precheck`.

**Do not.** Persist results or build an index. Search on every keystroke without the debounce. Use
`innerHTML`. Change the fuzzy or `>` phases.

**Risks and open questions.** `/` collides with typing an absolute path into the fuzzy search; paths
are shown relative so this is rare, but the author may prefer another prefix (`?`). Find (`Mod+F`)
is not built; if it lands first, hand it the query so the match itself is highlighted.

## What this phase deliberately leaves out

| Left out | Why, and where it goes |
| --- | --- |
| Paste in Rendered mode as an untitled scratch document (`08` §4.4 row 33, §7.3 story 5) | Needs a webview `paste` spike on both engines and an HTML-to-markdown converter with real chat-UI fixtures (`08` §7.2, §8); Phase E |
| Transforms in place (unwrap a `markdown` fence, promote and demote, renumber, normalise bullets, JSON pretty-print in place) | Each needs the minimal-diff property and the verb menu first; Phase E. Only `toggle-task` and `align-table-pipes` reach (C-02, C-06, C-13) |
| Edit one block in Source (ADR-0048) | Phase E; "Jump to source" is in the menu as the one-click path (`08` §6.2 option A) |
| Saved searches (`06` §3.1 meaning e) | A query store is a ledger the author asked to avoid (`06` §3.1) |
| A persistent search bar, a sidebar, a library window, a hover preview | Chrome at rest is zero; `06` §3.3 and §5.2 |
| `tantivy` or any persistent full-text index; a Rust `nucleo` matcher | Scan on demand (`06` §3.4); the TypeScript matcher stays until a real collection is measured past the budget (`06` §4.4) |
| A hover copy glyph, a gutter block handle, a selection popover | `08` §5: the only candidates that appear without a deliberate act |
| A native Edit > Copy as submenu | A test pins Edit to the OS's items and the menu chord table is hand-kept (`08` §5); a separate decision |
| `copy-with-reference` (`path:L-M`) | Needs the whole source in `OperationInput` (P04, `08` §4.1 row 15); a contract story of its own |
| `copy-json-pretty`, `copy-diff-*`, `strip-ansi`, `copy-front-matter`, copy without invisibles | Fit the contract (`10-spec.md:98-110`) but are not in the roadmap's pack; next catalogue round |
| Multi-block selection and Source-mode span operations (`08` §7.3 stories 8-9) | Phase E |
| Every unchecked task across the collection (`08` §4.3 row 32) | Cross-document; after the collection has proven itself |
| The `openHit(hit, { target: 'here' \| 'split' })` seam (`06` §5.3) | Phase D owns what `'split'` means; it adds the seam with the split |
| `⌘1..9` row hints, `⌘Enter` open in Source (`docs/design/07-index-and-palette.md:87`) | Unbuilt today; `⌘Enter` is reserved for the split in Phase D |
| Verifying the recursive watch on Linux inotify limits | No Linux desktop to test on; C-05 and C-11 degrade with a notice (ADR-0046) |
| `Mod+Alt+C` for rich copy | Rich is already the default for a drag and a block; one extra chord only if asked (`08` §5 says re-check chords) |

## The question only the author could answer (ruled yes, 2026-10-02)

**Is a searchable list of folders, never browsed, consistent with the brief's "library browsing"
exclusion (`docs/brief.md:72`)?** `06` §3.2 argues it is: there is no tree, no sidebar and no
library window, only folders named in a text file and searched through the summoned palette.
The author ruled **yes** (`rulings.md`): C-01 records that reading in a proposed ADR without editing the brief,
and C-03, C-10 to C-12, C-14, C-15 and C-17 build on it. If the answer is no, the collection lane
shrinks to the current repository plus the twelve recent roots: C-04, C-05, C-11, C-12 (watched
means the current repository) and C-16 and C-17 (over those roots) still stand, and C-03, C-10's
`collection.toml` half, C-14 and C-15 are dropped. The copy lane does not depend on the answer.

Smaller rulings the stories report rather than decide: whether a never-read file counts as changed
(C-12), whether "at most seven rows" means seven verbs plus "All actions…" (C-13), the plain-text
conventions (C-07), the join for "Copy all code blocks" (C-09), and `/` as the content prefix (C-17).

### C-03.1 — A backslash is part of a file name on macOS and Linux

**Model:** sonnet · **Size:** S · *Added 2026-10-07 by the lead, from the C-03 review.*

**Outcome.** `packages/core/src/index-model/paths.ts` turns `\` into `/` in `normalizePath` and `joinPath`, so a
folder or file named `a\b` on macOS or Linux is indexed, ranked and opened as `a/b`, a different path. Core
learns the platform's separator rule (POSIX: `/` only; Windows: both), and C-03's interim refusal of backslash
paths in `collection.toml` is lifted.

**Paths.** `packages/core/src/index-model/paths.ts` and its tests; `packages/core/src/index-model/collection.ts`
(lift the refusal); callers only if the platform must be passed in.

**Acceptance.** On POSIX, `a\b` survives normalisation and joining; on Windows, `C:\x\y` still normalises; a
round trip through the index keeps a backslash name.
