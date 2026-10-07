# Phase E — Adept at both: story plan

**Date:** 2026-10-02 · **Source:** `docs/research/audit-2026-10/14-roadmap-proposal.md` (Phase E),
`08-feature-text-operations.md` (catalogue, §5, §6, §7), `10-overfit-decisions.md` §4 and §5
(ADR-0048, ADR-0049), `12-recommendation-codebase.md` §4 · **Stories:** E-01 to E-18

**Abstract.** Phase E makes Marxy useful for the second half of "a reader first, but adept at
both": it lets a reader fix what they read, without turning Marxy into a writing tool. Eighteen
stories, in four waves. Wave 1 lays the shared foundations that do not depend on each other: the
transform test kit, the two reach fixes for operations that already exist, the pure core of
block editing, the scratch (untitled) document, the paste-delivery spike, the clipboard-to-markdown
converter and the line-diff function. Wave 2 builds what stands on them: edit one block in Source
in place; block-aligned multi-block selection; and the transform operations (unwrap a fenced whole
document, promote and demote headings, renumber and convert lists, sort list items, pretty-print
JSON and YAML, the plain-text copy form). Wave 3 wires paste (the clipboard opens as an untitled
scratch document) and a minimal diff of the two versions of a regenerated file. Wave 4 is the
phase-screen test and the documents. Every transform is a pure `string → string` function with
the byte-fidelity property, a new minimal-diff property, and CRLF rows in every table, because
`splice` performs no line-ending conversion (`packages/core/src/buffer/buffer.ts:47-60`).
Nothing in the phase gives the typeset surface a caret.

## Phase goal and screen criterion

From `14-roadmap-proposal.md`, Phase E:

> **Ends with:** v0.5.0, the restated spirit on screen.
> - Edit one block in Source (ADR-0048): select a block, press the edit key, CodeMirror opens on its
>   byte range in place, leaving splices it back through the transformation path.
> - Transform operations: toggle task reachable by pointer, align table, promote and demote,
>   renumber, sort, unwrap an LLM's `markdown`-fenced whole document, pretty-print JSON and YAML in
>   fences, strip markdown. Each a pure function with the fidelity property and a minimal-diff
>   property, CRLF rows in every table.
> - Paste in Rendered opens the clipboard as an untitled scratch document (HTML sanitised, then
>   converted to markdown), writing nothing until Save As.
> - Diff of two versions of a regenerated file as its own feature, not a split.
>
> **Screen criterion:** paste an assistant's answer, unwrap its fence, tick its tasks, fix one
> paragraph in place, save; the bytes outside what was touched are identical.

Two readings need stating so the stories do not drift:

- "Strip markdown" ships only as a **copy form** (plain text), never as a splice. The audit ranks the
  splice form "Do not build" (`08` §4.2 #26) because it is destructive and fails "never touch a byte
  the user did not ask to change". E-11 owns this and adds a guard test.
- "The bytes outside what was touched are identical" is the criterion's operative sentence. E-18
  turns it into one end-to-end test over an LF file and a CRLF file.

## Preconditions: what must be on `main` first

Phase E is the fourth feature phase. The stories are written against the interfaces below. If a
phase delivered something different, **each story says what to adapt**; the agent adapts and
reports the difference in its PR description rather than stopping.

| From | What the stories assume | Used by | If it differs |
| --- | --- | --- | --- |
| A | ADR-0048 (Source may be summoned for one block) and ADR-0049 (user-defined operations are configuration) exist as **proposed** ADRs in `docs/adr/`. ADR-0045 (contracts change by PR) is accepted, so `pnpm test:contracts-frozen` is gone. The palette lists every registry command whose `when` holds, not only `op.*` (today `palette/view.ts:91-95` filters `op.`). The pruned PR path: typecheck, lint, unit tests, goldens, fidelity, licences, boundaries, one-engine mechanical aesthetics, the desktop WebKit suite; one `changelog.d/<slug>.md` fragment per change. | all | If ADR-0048 is missing, E-04 writes it (one page, from `10` §4) in the same PR. If the palette still filters `op.`, E-04, E-15 and E-17 commands are invisible: raise it before building them. |
| B | **`DocumentStore` per open document** (ADR-0037 amended): `apps/desktop/src/document/store.ts` with `snapshot()` returning at least `{ path, disk, buffer, ast, nodeMap, version, dirty }`, `subscribe(cb)`, and the transitions `apply({range, replacement, label})` (today `applyDocumentMutation`, `commands/edits.ts:188`), `commitSource(text)` (today `foldSourceEditIfNeeded`, `edits.ts:155`), `reload(bytes)`, `save`, `close`, one undo history per document shared by both modes. **`RenderedView` per article** (`apps/desktop/src/view/rendered-view.ts`) owning anchor, mode and typesetter; `#doc` stays the id of the first pane. The reading anchor is *mapped* through an edit, not released (ADR-0037 clause 6). `app.ts` is a composition root. `Shell` is the real interface. | E-04, E-13, E-15, E-17, E-18 | The stories cite today's locations (`app.ts:289-322`, `commands/edits.ts`, `selection/view.ts`) because that is what exists in the worktree. If they have moved, find the successor with `grep -n` on the function name; the behaviour wanted is stated in words. |
| C | **The verb menu**: one DOM component drawn from the registry (`group === 'selection' && when(ctx)`), at most seven rows, opened by right-click, the context-menu key and Enter on a selection; an explicit `defaultVerbFor(selectionKind, nodeType)` table replacing the `copy-` prefix pick (today `selection/apply.ts:39-49`). The **copy pack** as `08` §4.1 names it: copy as plain text, markdown, rich HTML; table as TSV, CSV, JSON; copy command; all code blocks; all unchecked tasks; all links. `OperationInput` is still `{document, node?, range, text}` for these (the whole-source field P04 is not needed by Phase E). | E-02, E-06 to E-11 | If rows are ranked by metadata, every operation story sets its row's rank in its own file and puts new transforms **below** the copy verbs. If `copy-plain-text` is missing, E-11 builds it. If the verb menu is missing, operations are reached through the palette `>` list and the stories' acceptance tests use that. |
| D | The split view is optional for Phase E. If it landed, "the open document" in every story means the **focused pane's** store, and the island, the scratch document and the diff open in that pane. | E-04, E-13, E-15, E-17 | If panes exist, scratch documents and diffs open in the *other* pane when one is open (D's rule), otherwise in the focused pane. |

Facts about the code that are true today and that several stories rely on, so they are stated once
(each re-checked in the worktree on 2026-10-02):

- The operation contract is `packages/core/src/contracts/operation.ts:9-46`: `Applicability`
  `span | block | section | document`; `OperationInput = {document, node?, range, text}`;
  `OperationResult = {replacement, clipboard?, summary?}`; `canApply` receives the input **without
  `text`**, so a predicate cannot read bytes. A predicate that needs bytes returns true and `run`
  declines with `replacement === input.text` and a `summary` saying why.
- Registration is one array, `packages/core/src/operations/index.ts:8` (`OPERATIONS`). The corpus
  test `packages/core/src/operations/operations.test.ts:~407-425` already runs **every non-`copy-`
  operation at every node of every corpus file** and asserts bytes outside the range are unchanged,
  so a newly registered operation is covered by it without edits to that test.
- A heading selection resolves to the **section range** with `node = heading`
  (`apps/desktop/src/selection/input.ts:31-34`). Any other node resolves to `node.src`.
- `sectionRange`, `nodeAt` are in `packages/core/src/sourcemap/section.ts`; `lineStartAt(document,
  byte)` is in `packages/core/src/sourcemap/line-starts.ts` (registered by `parseMarkdown`; **not**
  exported from the core index today).
- The AST gives these byte facts (probed): a `listItem`'s `src` starts at its marker and the first
  child block starts after it, so the marker bytes are `[item.src.start, item.children[0].src.start)`;
  a `codeBlock` has `src` (opening fence start to closing fence end, no final newline) and
  `content` (the bytes between the fence lines, **including** the final line ending, CRLF as in the
  file); an ATX `heading.src.start` is at the first `#` (after any indent); a `taskMarker` is the
  three bytes `[ ]` or `[x]`; with a BOM, node offsets start at 3 and `lineStartAt` of a first-line
  node is 3.
- Rendered undo is `History` (`packages/core/src/buffer/history.ts`): one `Edit {range, before,
  after, label}` per splice, 100 deep. `leaveSourceMode` (`apps/desktop/src/source/buffer-commit.ts:21-31`)
  already turns a Source session into exactly one such edit, labelled `edit in Source`.
- `foldText` (`packages/core/src/buffer/buffer.ts:85-115`) is the minimal-splice fold: keep the common
  prefix and suffix, never cut a CRLF or a surrogate pair, convert inserted newlines to CRLF for a
  CRLF file. E-03 generalises it to a slice.
- The checkbox click already toggles a task by pointer (`apps/desktop/src/render/tasks.ts:29-57`,
  capture-phase). What is missing is every other route to `toggle-task`.
- The desktop browser tests boot through `apps/desktop/test/palette-boot.html` and
  `window.marxyPaletteBoot.start(files, argv, [])`, with a byte-diff helper
  (`apps/desktop/test/operations-edit.test.mjs:31-93`). Pure logic tests can live in
  `apps/desktop/test/*.test.mjs` too (they import `../../../packages/core/src/...ts` directly under
  `--experimental-strip-types`, as `operations-edit.test.mjs:12-13` does) because that glob is
  already in `apps/desktop/package.json:15`.
- `scripts/registry.json` must list a new class, data attribute, event or command id first, and
  `innerHtmlAllowedIn` (`registry.json:59-68`) must list every path that parses markup, including
  `new DOMParser()` (`scripts/check-registry.mjs:38`).

## Dependency graph and waves

Serial edges: E-01 → (E-06, E-07, E-08, E-09, E-10, E-11); E-02 → E-05; E-03 → E-04;
(E-12, E-13, E-14) → E-15; (E-13, E-16) → E-17; everything → E-18.

| Wave | Stories | Why this wave |
| --- | --- | --- |
| **1. Foundations** (no edges between them; run in parallel, at most four at a time) | E-01 kit and helpers · E-02 reach for toggle-task and align-table · E-03 block-edit core · E-12 paste spike · E-13 scratch document · E-14 clipboard payload to markdown · E-16 line diff | Each owns disjoint directories (core operations helpers; selection input; core buffer and sourcemap; a docs file; the document store; a new `paste/` directory; a new `core/diff/` directory). E-12 needs the author for a few minutes; start it first. |
| **2. Build on them** | E-04 island UI and guards (after E-03) · E-05 multi-block selection and dedupe (after E-02) · E-06 unwrap fence · E-07 promote/demote · E-08 list markers · E-09 sort items · E-10 JSON and YAML · E-11 plain-text copy and strip guard (all five after E-01) | E-06 to E-11 are core-only files and are fully parallel; each adds one import line and one array entry to `operations/index.ts`, so a rebase conflict there is textual: keep both lines. Run E-04 and E-05 beside them; they touch disjoint app files. |
| **3. Wire** | E-15 paste opens a scratch document (after E-12, E-13, E-14) · E-17 show what changed on disk (after E-13, E-16) | Both need the scratch document; they touch different directories (`paste/`, `commands/compare.ts`). |
| **4. Prove** | E-18 phase-screen test and document sync (after all) | One end-to-end test of the criterion, then ADR statuses and the docs that list operations and keys. |

Within a wave the lead decides the order; a story's **Parallel with** line lists only the
stories whose paths it does not share.

## Verification at the end of the phase

Commands (the names are from today's `package.json`; Phase A's pruned path may rename a gate, the
gate that checks the same thing is meant):

1. `pnpm typecheck` and `pnpm lint` green.
2. `pnpm --filter @marxy/core test` (all new operation tables, the minimal-diff property, the diff
   and fold tests) and `pnpm --filter @marxy/desktop test` (island, multi-block, scratch, paste,
   compare and the phase test).
3. `pnpm gate:fidelity` (the byte-fidelity gate), `pnpm gate:no-network`, `pnpm gate:golden`,
   `node scripts/check-registry.mjs`, `node scripts/check-boundaries.mjs`, `pnpm gate:licences`.
   No new dependency is added in Phase E; if one appears, the licence gate and
   `scripts/allowlists/dependencies.json` come first.
4. `pnpm precheck --all`.

The author's manual check, five minutes, in a built app (`run` skill or `pnpm --filter
@marxy/desktop tauri dev`): copy the whole text of `apps/desktop/test/fixtures/e-answer-fenced.md`
(created by E-18; it is an assistant's answer wrapped in one `markdown` fence, with a preamble, a
task list and a paragraph with a typo) and press `Mod+V` in a window showing any document.

1. The answer opens as an untitled document; the title bar says untitled and no file exists.
2. Click the fenced block, open the palette `>` or right-click, run **Unwrap markdown fence**.
3. Tick two tasks by clicking their boxes.
4. Click the paragraph with the typo, press the edit key, fix one word, press `Esc`.
5. `Mod+Shift+S`, save somewhere, then `diff` the saved file against the fixture: only the unwrapped
   fence lines, the two ticked markers and the one word differ. Repeat with a CRLF copy of the
   fixture (`unix2dos` or `sed 's/$/\r/'`): every line ending in the saved file is still CRLF.
6. Undo five times in the window; the document is the pasted text again.
7. Then, in a normal document that an agent regenerates: change it on disk, run **Show what changed
   on disk**, and read the diff.

## Stories

### E-01 — Build the transform helpers and the shared test kit

**Model:** opus · **Size:** M · **Depends on:** — · **Parallel with:** E-02, E-03, E-12, E-13, E-14, E-16

**Outcome.** A developer adding a transform writes one file of logic and one file of table rows, and
gets for free: the table run in LF and in CRLF, the "bytes outside the range are unchanged"
property, the new **minimal-diff property** ("the result differs from the input only inside the
bytes the operation means to change"), a corpus sweep, and a check that the properties can fail. The
two small helpers every operation that emits newlines or reads a fence needs exist once.

**Why now.** `08` §7.1 names the single likeliest fidelity bug in new operations (an operation emits
`\n` into a CRLF file because `splice` does no conversion) and §7.4 asks for the minimal-diff
property; today the only property is "outside the range" (`operations.test.ts:198-229, 407-425`),
which says nothing about a large range such as a section or a list.

**Paths.**
- `packages/core/src/operations/text-helpers.ts` (new)
- `packages/core/src/operations/test-kit.ts` (new; imported only by tests, not exported from `packages/core/src/index.ts`)
- `packages/core/src/operations/test-kit.test.ts` (new; the kit's own tests)
- `packages/core/src/operations/registry.test.ts` (new; registry-level checks that later stories extend)
- `packages/core/src/operations/operations.test.ts` (edit: import `assertBytesOutsideRangeUnchanged` from the kit instead of its local copy at `:198`)

**Build order.**
1. `text-helpers.ts`, pure, no DOM, no Node built-ins (core boundary):
   `eolOf(text: string): '\r\n' | '\n'` (the first line ending in `text`, else `'\n'`);
   `textIndex(text: string): { toIndex(byte: number): number; toByte(index: number): number }`
   (UTF-8 byte offset inside `text` to UTF-16 index and back, one scan, cached per call site);
   `sliceByBytes(input: {range: Source; text: string}, abs: Source): string` (the text of an
   absolute byte range that lies inside `input.range`; this is the "5-line helper" of `08` §7.1,
   used for `codeBlock.content`, which is a byte range and not a string range);
   `replaceSpans(text: string, edits: readonly {start: number; end: number; text: string}[]): string`
   (non-overlapping UTF-16 edits applied back to front).
2. `test-kit.ts`:
   - `crlf(s: string): string`, `withBom(s: string): string`.
   - `tableTest(op: Operation, rows: readonly Row[], opts?: {lfOnly?: boolean})` where `Row =
     {name; source: string; pick(doc: Document): Node; range?(doc, node): Source; expect: string;
     summary?: RegExp}` and `expect` is the **whole document after the splice**. For every row it
     registers three `node:test` cases: as written, with every `\n` replaced by `\r\n` in `source`
     and `expect`, and (unless `opts.lfOnly`) with no trailing newline when the source had one. A
     row whose operation must refuse sets `expect === source`.
   - `assertOutsideRangeUnchanged` (moved from `operations.test.ts:198`).
   - `assertMinimalDiff(before: Uint8Array, range: Source, replacement: string, targets: readonly Source[])`:
     split the input range into the segments outside `targets` (`O0 … On`) and assert the output
     decomposes as `O0 x0 O1 x1 … On` with the `xi` free. Match anchored at both ends with a
     backtracking search so a segment that also occurs inside an earlier `xi` cannot make a wrong
     decomposition pass.
   - `corpusProperties(op, {targets(doc, node, text): Source[]; accepts?(node): boolean; idempotent?:
     boolean; inverse?: Operation})`: over every `fixtures/corpus/*.md` file and every node the
     operation's `canApply` accepts, run the operation and assert outside-range unchanged, minimal
     diff against `targets`, and, when asked, `op(op(x)) == op(x)` or `inverse(op(x)) == x`.
   - `canFail(assertion: () => void)`: asserts the callback throws an `AssertionError`; the kit's own
     tests use it to show each property rejects a deliberately wrong replacement (one byte changed
     outside the targets; one `\n` where the file uses `\r\n`).
3. `test-kit.test.ts`: the kit's rows. One passing operation (a trivial in-test operation that upper-cases
   a target span) and one broken twin per property, wrapped in `canFail`.
4. `registry.test.ts`: every id in `OPERATIONS` is unique and kebab-case; every operation has a non-empty
   `appliesTo`. No list of ids is kept in the test, so parallel stories that register operations never
   touch this file.

**Acceptance.**
- `tableTest` over a sample operation runs each row three ways and fails when the replacement emits
  `\n` into the CRLF variant: `test-kit.test.ts`, case "kit rejects LF in CRLF".
- `assertMinimalDiff` accepts a change confined to the targets and rejects a one-byte change outside
  them, including a case where the outside segment also occurs inside a target: `test-kit.test.ts`.
- `corpusProperties` over a sample operation visits every corpus file (`readdirSync` as at
  `operations.test.ts:359-361`) and fails when handed an operation that rewrites a byte outside its
  targets: `test-kit.test.ts`.
- `textIndex` round-trips every byte offset of a string containing CJK, an emoji (surrogate pair) and
  a combining mark: `test-kit.test.ts`.
- The existing 43 operation tests stay green: `pnpm --filter @marxy/core test`.

**Tests.** Stay green: `operations.test.ts`, `align-table-pipes.test.ts`, `buffer.test.ts`. New:
`test-kit.test.ts` as above. Gates: `pnpm precheck`, `pnpm gate:fidelity`.

**Do not.** Do not export the kit or the helpers from `packages/core/src/index.ts` (the kit imports
`node:test`; core must run in a browser). Do not change `Operation`, `OperationInput` or any
contract. Do not add a dependency. Do not register any new operation here.

**Risks and open questions.** The decomposition search can be exponential on adversarial inputs;
bound the number of target spans per call (say 10,000) and fail loudly beyond it. Decide, and note
in the PR, whether `tableTest`'s trailing-newline variant should apply to rows whose operation reads
the last line (most do not); the default above is "yes, run it, set `lfOnly` to skip".

### E-02 — Reach `toggle-task` and `align-table-pipes` from the selections a reader makes

**Model:** sonnet · **Size:** S · **Depends on:** — · **Parallel with:** E-01, E-03, E-12, E-13, E-14, E-16

**Outcome.** Click the text of a task item and the palette `>` list (and Phase C's verb menu) offers
**Toggle task**; click a table cell and it offers **Align table pipes**. Today the first is
reachable only by clicking the checkbox (`render/tasks.ts:29-57`), the second needs a click plus two
`Alt+Shift+ArrowUp` presses (`08` §1 finding 2; probe in its appendix).

**Why now.** The screen criterion says "tick its tasks"; the checkbox click works, but a reader who
uses the keyboard or the menu cannot, and `08` §4.2 #16 and #17 call these the two most awkward of
the four shipped operations.

**Paths.**
- `apps/desktop/src/selection/input.ts` (add `operationInputsFor`)
- `apps/desktop/src/commands/registry.ts` (`fromOperation`, `AppContext`)
- `apps/desktop/src/selection/bind.ts` (`buildAppContext` supplies `operationInputs()`)
- `apps/desktop/test/operations-edit.test.mjs` (extend)
- `apps/desktop/test/reach-inputs.test.mjs` (new, pure logic, no browser)

**Build order.**
1. `selection/input.ts:7-40`: keep `operationInputFor` unchanged (so `Mod+C` and the copy defaults
   keep their meaning). Add `operationInputsFor(sel, document, buffer): OperationInput[]`: the primary
   input first, then **reach candidates**: for a `node` selection whose node is a `listItem`, or a
   `paragraph` whose parent is a `listItem`, that has a `taskMarkerFor` marker
   (`packages/core/src/operations/toggle-task.ts:15-20`), the marker's input
   (`node = marker`, `range = marker.src`); for a `tableCell` or `tableRow`, the enclosing `table`'s
   input. Find the parent with the same walk `selection.ts:44-56` (`findParent`); export it if needed.
2. `commands/registry.ts:30-46`: `AppContext.operationInputs(): OperationInput[]`; `fromOperation.when`
   is true if the operation's `canApply` holds for any candidate; `run` uses the first candidate it
   applies to. The primary input still goes first, so `copy-section` on a paragraph never "reaches"
   the document.
3. `selection/bind.ts:41-55`: provide `operationInputs()` beside `operationInput()`.
4. Tests (below).

**Acceptance.**
- With the first task item of `03-ai-plan.md` selected by clicking its text, the palette `>` list
  contains "Toggle task"; running it changes only the three marker bytes and is one undo step:
  `operations-edit.test.mjs`, new case beside the checkbox case at `:95`.
- With a table cell of `09-gfm-everything.md` selected, the palette `>` list contains "Align table
  pipes" and running it aligns the whole table: same file, new case.
- `operationInputsFor` returns exactly `[primary]` for a heading, a code block and a plain paragraph,
  and `[primary, marker]` for a task item, `[primary, table]` for a cell: `reach-inputs.test.mjs`
  (builds buffers with `createBuffer` and `parseMarkdown`, no DOM).
- `Mod+C` on a task item or a cell behaves as before (no copy operation applies to the marker or the
  table today): existing `operations-copy.test.mjs`.

**Tests.** Stay green: `operations-edit.test.mjs`, `operations-copy.test.mjs`, `selection.test.mjs`,
`palette.test.mjs`. New: `reach-inputs.test.mjs`. Gates: `pnpm precheck`.

**Do not.** Do not change `toggleTask.canApply` (it must keep demanding the marker range, `toggle-task.ts:27-31`;
the reach list supplies the marker). Do not change `operationInputFor` (Phase C's default-verb table
depends on it). Do not add click-twice escalation; the reach list makes it unnecessary.

**Risks and open questions.** If Phase C's copy pack adds a copy operation that applies to a `table`
(copy as TSV), a selected cell will now offer it through the reach candidate. That is probably what a
reader wants; if Phase C's menu already resolves a cell to its table, delete the table half of this
story and say so.

### E-03 — Build the pure core of block editing: the edit range and the slice fold

**Model:** opus · **Size:** S · **Depends on:** — · **Parallel with:** E-01, E-02, E-12, E-13, E-14, E-16

**Outcome.** Two pure functions in core that the in-place editor needs and that can be tested in
Node without a browser: which bytes "this block" means for a selected node, and how to turn the
editor's text back into the smallest splice inside that slice.

**Why now.** ADR-0048 says leaving the editor "splices it back through the same transformation
path"; `08` §6.2 option B calls the fold the piece with real fidelity risk (CRLF, BOM, surrogates).
`foldText` (`buffer.ts:85-115`) does this for the whole file only.

**Paths.**
- `packages/core/src/buffer/fold-slice.ts` (new) and `packages/core/src/buffer/fold-slice.test.ts` (new)
- `packages/core/src/buffer/index.ts` (one export line)
- `packages/core/src/sourcemap/edit-range.ts` (new) and `packages/core/src/sourcemap/edit-range.test.ts` (new)
- `packages/core/src/sourcemap/index.ts` (export `blockEditRange`, and re-export `lineStartAt`)

**Build order.**
1. `fold-slice.ts`: `foldSlice(buffer: Buffer, slice: Source, text: string): { range: Source;
   replacement: Uint8Array; text: string } | null`. `text` is the editor's document for the slice (it
   keeps the file's own separator, as `editor-cm6.ts:20-22` does with `sliceDoc`). Compute the old
   slice text with `textOf(buffer, slice)`, the UTF-16 index of `slice.start` with `byteToUtf16`,
   the common prefix and suffix exactly as `foldText` does (never cut a CRLF or a surrogate pair,
   old text's pairs included), then the absolute byte range with `buffer.offsets.at(...)`. Newlines
   in the changed middle follow, in order: the slice's own first line ending, else `buffer.eol` if it
   is `crlf`, else `\n`. Return `null` when nothing differs. `text` in the result is the decoded
   middle (what `applyDocumentMutation` takes, `commands/edits.ts:188-192`).
2. `edit-range.ts`: `blockEditRange(document: Document, node: Node): Source | null`. A block node:
   its `src`, **expanded to the start of its first line** with `lineStartAt` (so a block inside a list
   item or quote carries its container prefix and the editor shows the bytes exactly as the file has
   them); an inline node: its enclosing block; `tableCell` and `tableRow`: the enclosing `table`;
   `heading`: the heading alone (not the section); `document`: `null` (use Source mode). Fall back to
   scanning back to the previous `\n` when `lineStartAt` is `undefined`.
3. Tests.

**Acceptance.**
- A table of `(buffer, slice, editorText, expectedBytes)` rows covering insert at start, middle and
  end, delete all, replace all, a no-op (returns `null`), LF text against a CRLF slice (the result has
  no bare `\n`), mixed endings (bytes outside the changed middle keep their endings), a CJK edit, an
  edit between the halves of a surrogate pair's neighbours, and an invalid UTF-8 byte outside the
  edit (it stays): `fold-slice.test.ts`. Every row also asserts `splice(buffer, range, text)` equals
  the buffer with only the slice's changed middle different.
- A fuzz case (as `buffer.test.ts:288` does for `foldText`): random edits of random slices of
  `12-crlf-and-bom.md`; the splice never produces a bare `\n` in a CRLF file and never changes a byte
  outside `range`: `fold-slice.test.ts`.
- `blockEditRange` over every node of every corpus file returns a range whose start is a line start
  and whose bytes lie inside the document; for a paragraph in a blockquote the range includes the
  `> ` of its first line; for a heading it excludes the rest of the section: `edit-range.test.ts`.

**Tests.** Stay green: `buffer.test.ts`, `section.test.ts`. Gates: `pnpm precheck`, `pnpm gate:golden`
(no golden changes expected).

**Do not.** Do not touch `foldText` or `fromText` (Source mode depends on them byte for byte). Do not
export anything that needs a DOM. Do not decide the edit key or the UI here (E-04).

**Risks and open questions.** A block that ends in the middle of a line (rare: an HTML block closed
by a comment) will show its bytes without the tail; report any corpus node where `blockEditRange`
returns a range whose end is not at a line end.

### E-04 — Edit one block in Source, in place

**Model:** opus · **Size:** L · **Depends on:** E-03, Phase B (store), Phase A (ADR-0048) · **Parallel with:** E-05, E-06 to E-11, E-14

**Outcome.** Select a block (click it, or `Alt+Down` to it), press the edit key, and a CodeMirror
editor opens **in place of that block**, showing exactly the block's bytes in the code face. Edit,
press `Esc` (or the edit key again): the editor closes, the text is spliced back into the
document as **one undo step**, and the page is where the reader left it. Nothing is on screen at
rest; the typeset text never gets a caret.

**Why now.** `10` §4 and ADR-0048: the "adept at both" answer, an operation and not live rendering.
It needs the document store (a Source session is one history entry, ADR-0037 clause 3) and the slice
fold from E-03.

**Paths.**
- `apps/desktop/src/source/block-editor.ts` (new: the CodeMirror island)
- `apps/desktop/src/commands/block-edit.ts` (new: the commands and the target resolution)
- `apps/desktop/src/commands/index.ts` (one line registering `blockEditCommands()`)
- the module that today holds the view mode and the commit path (`apps/desktop/src/app.ts:289-322, 782-789, 908-931, 934-946, 1158-1162`, or its Phase B successors `view/rendered-view.ts` and `document/store.ts`): guards only
- `packages/theme/src/base.css` (island styles, using existing tokens only)
- `scripts/registry.json` (class `marxy-block-editor`, data attribute `data-marxy-edit`, command ids)
- `docs/adr/0048-*.md` (status to accepted, if the author accepts), `docs/design/09-app-shell.md` (keyboard map row), `changelog.d/e-04-edit-block.md`
- `apps/desktop/test/block-edit.test.mjs` (new)

**Build order.**
1. `source/block-editor.ts`: `openBlockEditor(host: HTMLElement, buffer: Buffer, range: Source): {
   view: EditorView; text(): string; destroy(): void }`. Build the state from `baseExtensions`
   (`source/editor.ts:100-158`) so the code face, markdown language, wrapping and the file's line
   separator match Source mode, with a private pair of compartments. **Do not call
   `createSourceEditor`**: it keeps one module-level editor and destroys it when the parent differs
   (`editor.ts:49-55`), which would destroy the reader's full Source editor. Doc =
   `textOf(buffer, range)`. Add a keymap: `Escape` and `Mod-Enter` call `leave()`. The existing
   `Mod-s` and `Mod-Shift-s` entries stay (they call `save()`, which folds first, step 5).
2. `commands/block-edit.ts`: `blockEditCommands(): Command[]` returning `edit.block` ("Edit block in
   place", key `Mod+Enter`, group `selection`, `when`: a `node` or `section` selection that
   `blockEditRange` accepts and the block is under 64 KB). `Enter` is **not** used: Phase C binds it
   to the verb menu. `run` captures the reading position, hides the target block's element(s)
   (`hidden`, not removed, so the node map and `data-marxy-s` lookups stay valid), inserts
   `div.marxy-block-editor[data-marxy-edit]` before the first one, opens the editor, focuses it, and
   stores `{ range, view, hidden }` in one module-level `session` (at most one). A `document`
   selection or a block over the cap shows a transient notice "Too large to edit in place; Mod+E
   opens Source".
3. `leave()`: `docText = view.state.sliceDoc(0, view.state.doc.length)` (not `doc.toString()`:
   `editor-cm6.ts:20-22`), `fold = foldSlice(buffer, range, docText)`. `null`: destroy the island,
   unhide the block, no history entry, no re-render. Otherwise `await store.apply({ range: fold.range,
   replacement: fold.text, label: 'edit block' })` (today `applyDocumentMutation`,
   `commands/edits.ts:188`), which re-renders through the one render path and restores the reading
   position (`app.ts:908-923`). Return focus to the new element for the same range, or to `#doc`.
4. Clicking outside the island calls `leave()`; the island's own clicks never reach
   `selection/view.ts` (stop propagation at the island root).
5. Guards, each one line of intent and one test: (a) `Mod+E` while a session is open calls
   `leave()` first, then toggles (the document-level handler at `app.ts:314-322` does not skip
   editable targets); (b) the fold the save path takes (`app.ts:934-946`, called by `save.ts:~79`)
   commits the session first; (c) `hasUnsavedChanges()` (`app.ts:1158-1162`) and `hasLocalEdits`
   (`app.ts:782-789`) count a session whose `foldSlice` is non-null, so an external change keeps
   the reader's edit and shows `diskChangedEditsKeptNotice`, and a session with no change is closed
   and discarded before a reload; (d) opening another document, closing the window and quitting
   commit or confirm exactly as a dirty Source session does (`close.ts`, `close-guard.test.mjs`).
6. `base.css`: `.marxy-block-editor` sits in the measure, code face, background `--marxy-color-code-bg`,
   a 2px left rule in `--marxy-color-accent` (the idiom of `.marxy-selected`). No new token. At rest the
   DOM contains no editor and no `.marxy-block-editor` element.
7. Docs: keyboard map row `Mod+Enter | edit the selected block in place | Esc leaves`; ADR-0048
   consequences paragraph (what ships: one block, code face, one undo step, no caret in typeset text).

**Acceptance.**
- Select the first paragraph of `03-ai-plan.md`, press `Mod+Enter`, type a word, press `Esc`: the
  file's bytes differ from the original **only inside that paragraph's range**
  (`byteDiffs` as at `operations-edit.test.mjs:76-93`); `marxyDocumentEdit().dirty` is true:
  `block-edit.test.mjs`.
- One `Mod+Z` in Rendered mode restores the original bytes exactly; one `Mod+Shift+Z` redoes the whole
  edit: same file.
- The same flow on `12-crlf-and-bom.md` leaves every line ending CRLF and the BOM in place, and a
  paragraph edited with `Enter` inside the island (a new line) is CRLF in the file: same file.
- The reading position survives: scroll `01-long-technical.md` to the middle, edit a block **below**
  the reading line, leave; `sourceHarness().byteOffset` is unchanged and the block that was at the
  reading line is within 1 px of where it was. Edit a block **above** the reading line; the held
  block is the same block (the anchor is mapped through the edit): same file.
- Opening and leaving without typing re-renders nothing, adds no history entry and leaves `dirty`
  false: same file.
- At rest, `document.querySelector('.marxy-block-editor')` is `null`, before the first edit and after
  the last: same file.
- `Mod+E` with an island open leaves it first: the Source editor shows the edited bytes. `Mod+S` with
  an island open saves the edited bytes. An external write while an island holds an edit keeps the
  edit and shows the notice: `block-edit.test.mjs` (use `live-reload.test.mjs`'s change simulation).
- A `document` selection and a 100 KB block refuse with the notice and open nothing: same file.
- Nothing about Source mode itself changed: `source-mode-shell.test.mjs`, `mode-switch.test.mjs`,
  `buffer-commit.test.mjs`, `jump-to-source.test.mjs`, `source-gutter.test.mjs`, `data-loss.test.mjs`,
  `explicit-save.test.mjs`, `close-guard.test.mjs` stay green.

**Tests.** As above; new `apps/desktop/test/block-edit.test.mjs`. Gates: `pnpm precheck`,
`node scripts/check-registry.mjs`, `node scripts/check-boundaries.mjs` (CM6 is imported only under
`apps/desktop/src/source/`).

**Do not.** Do not add a `contenteditable` to `#doc`. Do not edit more than one block (a `blocks`
selection from E-05 shows "Select one block"). Do not call `createSourceEditor`. Do not re-render
while the island is open. Do not add a toolbar, a button or a hover affordance; the edit key and the
palette (and Phase C's verb menu row) are the only routes. Do not bind a single letter. Do not touch
`foldText`.

**Risks and open questions.** (1) The edit key is a choice: `Mod+Enter` keeps `Enter` for Phase C's
verb menu; the author may prefer another chord. (2) Hiding the block element may disturb the grid
pass or the typesetter's measurement of following blocks while the island is open; if it does, give
the island a fixed `min-height` equal to the hidden block's height and report. (3) `Mod+Z` inside
the island is CodeMirror's own history; a reader who expects Rendered's `Mod+Z` to undo the *last
leave* has to leave first. (4) A very long block (a 5,000-line fence) is a Source-mode job; the 64 KB
cap is a guess, report the measured keystroke latency at the cap.

### E-05 — Select a run of blocks in Rendered mode; first span operation: dedupe lines

**Model:** opus · **Size:** L · **Depends on:** E-02, E-01 (for the kit) · **Parallel with:** E-04, E-06 to E-11, E-14

**Outcome.** With one block selected, `Shift+click` on a sibling block, or `Alt+Shift+Down`,
extends the selection to a contiguous run of sibling blocks, painted as one left edge. The run
resolves to **one contiguous byte range with block-aligned ends and no node**, which is exactly what
the contract's `span` applicability carries. The first operation that uses it, **Dedupe lines**,
removes repeated lines inside the run.

**Why now.** `08` §6.2 and §7.1: span operations need the Rendered equivalent of a selection that a
drag cannot give (`docs/design/03-selection-and-operations.md` "Why `text` never resolves"), with no
contract change; and the brief names dedupe lines.

**Paths.**
- `apps/desktop/src/selection/selection.ts` (the union; run helpers)
- `apps/desktop/src/selection/input.ts` (the `blocks` case; **after** E-02's edits to this file)
- `apps/desktop/src/selection/view.ts` (painting, Shift+click, re-resolve after render)
- `apps/desktop/src/commands/selection-nav.ts` (the extend command)
- `packages/core/src/operations/dedupe-lines.ts` (new), `dedupe-lines.test.ts` (new)
- `packages/core/src/operations/index.ts` (one import line, one array entry)
- `apps/desktop/test/multi-block.test.mjs` (new), `apps/desktop/test/selection-blocks.test.mjs` (new, pure)

**Build order.**
1. `selection.ts:6-11`: add `| { kind: 'blocks'; first: Block; last: Block; range: Source; els: readonly Element[] }`.
   Pure helper `extendRun(doc, sel, dir)` and `runTo(doc, anchor, target)`: the anchor and target must
   be **siblings under the same parent** (use `findParent`/`blockSiblings`, `selection.ts:44-62`);
   a target in a different parent climbs to its ancestor that is a sibling of the anchor, else the
   gesture is ignored. `range = { file, start: first.src.start, end: last.src.end }`.
2. `input.ts`: `case 'blocks'` returns `{ document, range, text: textOf(buffer, range) }` with **no
   `node`**; `operationInputsFor` returns `[that]`.
3. `view.ts`: `paintSelected` (`:60-63`) paints every element of `els`; `afterDocumentRendered`
   (`:247-274`) re-resolves a run by its two end ranges and falls back to `none`; `onClick`
   (`:276`) handles `ev.shiftKey` when a `node` or `blocks` selection exists (and prevents the native
   text selection on `mousedown` in that case, `:386`). `Alt+Shift+ArrowDown` extends by the next
   sibling (a new command in `selection-nav.ts`; `Alt+Shift+ArrowUp` stays "select parent",
   `selection-nav.ts:47`); `Alt+ArrowDown/Up` on a run collapses it to its last or first block;
   `Escape` clears.
4. `dedupe-lines.ts`: `appliesTo: ['span']`; `canApply`: `node === undefined` and every top-level
   block overlapping `range` is a `paragraph` or a `list` (never a code block, table, heading or
   HTML block: a duplicate line inside a fence or table is content). `run`: split `text` into lines
   keeping each line's own ending; keep the first occurrence of each non-blank line (compare after
   trimming trailing whitespace); a removed line takes its ending with it, and if the removed line was
   the only non-blank line of its paragraph the blank line that followed goes too. Emits no newline of
   its own, so CRLF is automatic. `summary`: "Removed N duplicate lines". `replacement === text` when
   nothing is a duplicate.
5. Tests, including the kit's `corpusProperties` with `targets` = the removed lines.

**Acceptance.**
- Click a paragraph, `Shift+click` the third paragraph after it: three elements carry
  `.marxy-selected` and `getSelectionState().selection.kind === 'blocks'`: `multi-block.test.mjs`.
- `Shift+click` on a block under a different parent (a list item inside a list) extends to the
  enclosing sibling, not across containers: `selection-blocks.test.mjs`.
- Dedupe over a run of two paragraphs and a list with three repeated lines removes exactly those
  lines, in one undo step; the bytes outside the removed lines are identical; `canApply` is false on
  a run that includes a fence: `dedupe-lines.test.ts` (kit rows, LF and CRLF, no trailing newline, a
  duplicate that is the last line, a duplicate separated by a blank line, emoji and CJK lines) and
  `multi-block.test.mjs` (palette `>` shows "Dedupe lines" for the run and not for a single block).
- Re-render after the splice resolves the run or clears it, never leaves a stale element painted:
  `multi-block.test.mjs`.
- Single-block behaviour is unchanged: `selection.test.mjs`, `operations-copy.test.mjs`,
  `operations-edit.test.mjs` stay green.

**Tests.** As above. Gates: `pnpm precheck`, `pnpm gate:fidelity`.

**Do not.** Do not make a DOM text drag resolve to bytes (`docs/design/03` explains why it cannot).
Do not add a contract field or touch `Applicability`. Do not make `Alt+Shift+ArrowUp` do anything but
select-parent. Do not let `Mod+C` on a run copy anything new (copy verbs for runs are Phase C's
decision; if Phase C's copy pack applies to `span` ranges, the run will simply offer them).

**Risks and open questions.** The extend key is a choice; `Shift+click` is the primary gesture. If
the land of this story runs past three days, land steps 1 to 3 with a stub that offers no operation,
then step 4 as its own change. Report whether dedupe is wanted at all in Rendered mode; `08` §4.2 #28 rates it low there.

### E-06 — Unwrap a `markdown`-fenced document

**Model:** sonnet · **Size:** S · **Depends on:** E-01 · **Parallel with:** E-07 to E-11, E-04, E-05

**Outcome.** Select a fenced code block whose language is `markdown` or `md` (the shape an LLM gives
when asked for a README: the whole answer wrapped in one fence) and run **Unwrap markdown fence**:
the two fence lines go, the content stays byte for byte, and the headings, lists and tables inside
become part of the document and render as such.

**Why now.** The criterion names it; `08` §4.2 #18 ranks it high value, low risk. The audit's
prototype ran in 32 lines and found that `codeBlock.value` drops the final newline, so the operation
must use `codeBlock.content`.

**Paths.**
- `packages/core/src/operations/unwrap-markdown-fence.ts` (new), `unwrap-markdown-fence.test.ts` (new)
- `packages/core/src/operations/index.ts` (one import line, one array entry)

**Build order.**
1. `unwrapMarkdownFence: Operation`, id `unwrap-markdown-fence`, title "Unwrap markdown fence",
   `appliesTo: ['block']`. `canApply`: `node.type === 'codeBlock'`, `node.lang` (case-insensitive) is
   `markdown` or `md`, the block is a top-level child of `document`, and
   `lineStartAt(document, node.src.start) === node.src.start` (a fence indented inside a container
   or by spaces is declined: its content lines carry the container prefix).
2. `run`: `content = sliceByBytes(input, node.content)` (E-01), then drop **one** final line ending if
   present (the one that belonged to the closing fence's line); `replacement` is that string, which
   keeps the file's own line endings by construction. The bytes after the block (the newline that
   ended the closing fence line) are outside the range and stay. An unclosed fence (content to end
   of file) works the same. An empty fence gives `''`. `summary`: "Unwrapped a markdown fence".
3. Tests with the kit.

**Acceptance.**
- Table rows (LF, CRLF and no-trailing-newline variants run by `tableTest`): a whole answer in a
  four-backtick fence; a fence among other blocks (preamble before, "Enjoy" after); a tilde fence; a
  fence with info `markdown title="x"`; `md` alias; an unclosed fence; an empty fence; a fence whose
  content contains its own three-backtick fence; with BOM. Expected whole-document bytes are written
  out in each row: `unwrap-markdown-fence.test.ts`.
- Corpus case: in `28-llm-answer.md` the five-backtick `markdown` fence (lines 136 to 166) holds a
  mini-document with its own `#` headings and a four-backtick fence holding a three-backtick fence.
  Unwrapping it and re-parsing yields **five more headings** than before (`# Migration ticket`, `## Summary`, `## Acceptance`, `## Rollback`, `## Owner`; counted in the test) and the
  inner fences are intact (same `codeBlock` count as the fence's content has): same file.
  *(Note: the audit says the corpus has no whole-document wrapper; this fence is a nested one, so the
  whole-document shape is covered by the inline rows above.)*
- `canApply` is false for a `bash` fence, an indented code block, and a `markdown` fence inside a
  list item: same file.
- `corpusProperties` with `targets` = the two fence-line spans: `unwrap-markdown-fence.test.ts`.
- The existing corpus mutation test (`operations.test.ts:~407`) stays green with the new operation
  registered.

**Tests.** Gates: `pnpm precheck`, `pnpm gate:fidelity`.

**Do not.** Do not use `codeBlock.value` (it drops the last newline). Do not re-indent, trim or
convert anything inside the content. Do not offer the operation for non-markdown fences or for
document selections.

**Risks and open questions.** Content lines inside a fence indented 1 to 3 spaces are returned
verbatim (the CommonMark strip of up to the fence's indent is not applied); the decline above makes
that unreachable for indented fences, but report any corpus file where the replacement differs from
`content` minus one ending.

### E-07 — Promote and demote headings

**Model:** sonnet · **Size:** S · **Depends on:** E-01 · **Parallel with:** E-06, E-08 to E-11, E-04, E-05

**Outcome.** Select a heading (which selects its whole section) and run **Promote heading** or
**Demote heading**: the `#` run of that heading **and of every sub-heading in its section** moves one
level, so the outline keeps its shape. Closing `#` runs, text and every other byte are untouched.

**Why now.** `08` §4.2 #19; the README and agent-answer cases where an assistant answered at the
wrong level.

**Paths.**
- `packages/core/src/operations/heading-level.ts` (new, exports `promoteHeading` and `demoteHeading`), `heading-level.test.ts` (new)
- `packages/core/src/operations/index.ts` (one import line, two array entries)

**Build order.**
1. `canApply`: `node?.type === 'heading'` and `range.start === node.src.start` (the section range
   from `operationInputFor`, `selection/input.ts:31-34`). Appliesto `['section']`.
2. `run`: collect every heading in `input.document` whose `src` lies inside `input.range` (walk the
   AST, so a `# comment` inside a fenced block is never touched). For each, the `#` run is the bytes
   `[h.src.start, h.src.start + h.level)`; confirm `text` has `#` there via `textIndex` (E-01), else
   the heading is setext. If any heading in the section is setext, or any would leave 1 to 6, return
   `replacement === text` with a `summary` that says why ("Cannot promote: a heading is already level
   1" / "Not changed: the section contains a setext heading"). Otherwise `replaceSpans` the `#` runs.
   The closing run of `## Title ##` is not a target.
3. Tests with the kit; `targets` = the `#` runs.

**Acceptance.**
- Rows (LF/CRLF/no trailing newline by the kit): h2 with two h3 children; the last section of a file;
  `## Close me ##` keeps its closer; a heading inside a blockquote; an h1 promote refuses; an h6
  demote refuses; a section containing a setext heading refuses; a section with a `# comment` inside
  a fence leaves the fence alone; leading spaces before `##`: `heading-level.test.ts`.
- `demoteHeading(promoteHeading(x)) === x` wherever both apply, over every heading of every corpus
  file (`inverse` in `corpusProperties`): same file.
- The minimal-diff property with `#`-run targets holds over the corpus: same file.
- Reading position: nothing to test beyond the shared splice path.

**Tests.** Gates: `pnpm precheck`, `pnpm gate:fidelity`.

**Do not.** Do not convert setext headings (refuse). Do not touch the heading text or its id (the
sanitiser derives ids). Do not apply to a `document` selection. Do not add a span variant here.

**Risks and open questions.** `canApply` cannot see bytes, so the setext refusal is a `run`-time
decline with a notice; if that reads badly in the menu, report it and consider adding a `setext`
flag to `Heading` (an AST contract change, ADR-0045 allows it by PR) instead of guessing here.

### E-08 — Renumber a list, convert bullets and numbers, turn glyph bullets into a list

**Model:** opus · **Size:** M · **Depends on:** E-01 · **Parallel with:** E-06, E-07, E-09, E-10, E-11, E-04, E-05

**Outcome.** Four operations that rewrite **marker bytes only**: **Renumber list** (`1. 1. 1.` and
`4. 1. 2. 3.` become a proper sequence; start and delimiter kept), **List to numbers**, **List to
bullets**, and **Bullets from glyphs** (a paragraph whose lines start with `•` or `–`, as chat tools
emit, becomes a real list).

**Why now.** `28-llm-answer.md` has all three shapes (`1. 1. 1.` numbering at the file's lines 40 to 47 and a `4.` that
restarts after a code block at lines 68 to 73, and the `•`/`–` block at lines 19 to 23, which parses as one
paragraph with soft breaks); `08` §4.2 #20 and #21.

**Paths.**
- `packages/core/src/operations/list-markers.ts` (new, exports the four operations and a `markerSpans(list)` helper), `list-markers.test.ts` (new)
- `packages/core/src/operations/index.ts` (one import line, four array entries)

**Build order.**
1. `markerSpans(list: List): {item: ListItem; marker: Source; number?: number; delimiter?: '.' | ')'}[]`:
   the marker is `[item.src.start, item.children[0].src.start)` minus trailing spaces; read the
   number and delimiter from the text via `textIndex`.
2. **Width rule (the trap).** Changing a marker's width changes the indentation its continuation
   lines and nested blocks need (`10. a` needs 4, `9. a` needs 3; `- a` needs 2). Marker-only rewrites
   are safe only when every item that would change width is **one line with no children**, or when the
   new width is not larger than the old and the existing indent still satisfies it. Otherwise the
   operation declines at `run` with a summary ("Not changed: renumbering would re-indent a nested
   item"). Do not re-indent continuation lines in this story.
3. `renumberList`: `appliesTo ['block']`, `node.type === 'list' && node.ordered`; item `i` gets
   `start + i`, delimiter kept, first item's number kept (an already-correct list returns
   `replacement === text`). `listToNumbers`: bullets to `1.`, `2.` … (start 1). `listToBullets`: ordered
   to `-`. Task markers are in the paragraph (`[ ]`), so they are unaffected. Nested lists are not
   rewritten (only the selected list's own markers). `bulletsFromGlyphs`: `node.type === 'paragraph'`,
   at least two lines, every line starts with `•`, `–`, `—` or `·` followed by a space; `run` replaces
   each glyph with `-` (marker bytes only; the glyph is 3 bytes, the new marker 1).
4. Tests with the kit; `targets` = the marker spans (`markerSpans`) or the glyph spans.

**Acceptance.**
- Rows: `1. 1. 1.` renumbers to `1. 2. 3.`; a list starting at `4.` keeps its start; `1)` delimiter kept;
  a list with a nested bullet list under item 2 renumbers; a 9-to-10 item list whose items are one
  line widens `9.`→`10.` correctly while one with a nested block declines with the summary; a loose
  list; a task list stays a task list; bullets to numbers and back for a plain list; the glyph
  paragraph of `28-llm-answer.md` becomes five `-` items and **re-parses as one list of five items**
  (asserted); a paragraph where only some lines have glyphs is not offered: `list-markers.test.ts`
  (kit adds LF, CRLF, no trailing newline).
- `renumberList` is idempotent; `listToBullets(listToNumbers(x))` equals `x` for lists of `-`
  bullets with single-line items: `corpusProperties` flags in the same file.
- The minimal-diff property with marker-span targets holds over every list of every corpus file.

**Tests.** Gates: `pnpm precheck`, `pnpm gate:fidelity`.

**Do not.** Do not re-indent continuation lines or nested lists. Do not renumber nested lists as a
side effect. Do not change the delimiter or the start number. Do not guess a bullet character beyond
`-`.

**Risks and open questions.** The decline rule will fire for lists with multi-line items, which is
common in agent output; report how often it fires over the corpus. If the author wants re-indenting,
that is a new story with its own property (continuation indentation counts as a target span).

### E-09 — Sort list items

**Model:** opus · **Size:** M · **Depends on:** E-01 · **Parallel with:** E-06 to E-08, E-10, E-11, E-04, E-05

**Outcome.** Select a list and run **Sort list items**: its top-level items are reordered A to Z
(natural order: "item 2" before "item 10"), each item carrying its nested items, task state and
continuation lines with it. Markers stay where they are, so an ordered list stays numbered 1, 2, 3.
Nothing is emitted that the file did not contain: the bytes are a permutation.

**Why now.** `08` §4.2 #23 (medium risk: loose lists, blank lines).

**Paths.**
- `packages/core/src/operations/sort-list-items.ts` (new), `sort-list-items.test.ts` (new)
- `packages/core/src/operations/index.ts` (one import line, one array entry)

**Build order.**
1. `canApply`: `node?.type === 'list'`, at least two items. `appliesTo ['block']`.
2. `run`: for each top-level item `i`, the **marker** `[item.src.start, item.children[0].src.start)`
   stays at position `i`; the **content** is `[item.children[0].src.start, item.src.end)` and
   moves. The **separators** between items (line endings, blank lines of a loose list) stay where
   they were. Output = `M0 C(σ0) S0 M1 C(σ1) S1 … Mn C(σn)`. So no newline is ever created: CRLF
   and loose lists come out right by construction.
3. Sort key: the content's first line with markup left as written, compared with
   `new Intl.Collator('en', { numeric: true, sensitivity: 'base' })` (a fixed locale so the output
   does not depend on the reader's machine), stable for equal keys. `replacement === text` if the
   order is already sorted. `summary`: "Sorted N items".
4. Tests; `targets` = the content spans; plus a **permutation property** in the test: the multiset of
   content strings is unchanged.

**Acceptance.**
- Rows: tight bullets; ordered list (numbers stay `1. 2. 3.` in place); task items (state travels);
  items with nested lists and continuation paragraphs (children travel); loose list with blank-line
  separators; equal keys keep order; "item 2" before "item 10"; emoji and CJK items; one item (not
  offered); already sorted (no change); LF/CRLF/no trailing newline by the kit:
  `sort-list-items.test.ts`.
- Idempotence and the permutation property over every list of every corpus file:
  `corpusProperties` with `idempotent: true`, same file.
- The sorted list re-parses with the same number of items and the same total number of descendants.

**Tests.** Gates: `pnpm precheck`, `pnpm gate:fidelity`.

**Do not.** Do not sort nested lists. Do not renumber. Do not move separators with items. Do not use
`localeCompare` with the default locale. Do not offer a descending variant.

**Risks and open questions.** An item whose last line is followed by a blank line that belongs to the
list (loose) versus to the next block: use the AST's `src.end` of each item, which excludes it; check
the loose-list rows against the parser, not against intuition.

### E-10 — Pretty-print JSON and re-indent YAML inside fences

**Model:** opus · **Size:** M · **Depends on:** E-01 · **Parallel with:** E-06 to E-09, E-11, E-04, E-05

**Outcome.** Select a `json` fenced block and run **Pretty-print JSON**: the content is re-indented
two spaces per level; strings and numbers are copied byte for byte, so nothing is rounded, escaped
or reordered, and invalid-but-readable JSON (the trailing comma in `28-llm-answer.md`) is formatted,
not rejected. Select a `yaml` block and run **Re-indent YAML**: indentation is normalised to two
spaces per level and everything else is left alone.

**Why now.** `08` §4.2 #22; the handbook (`docs/research/reader-artifacts/03-structured-output.md`
via `08` §4.1 #13) bans parse-then-print because it drops comments and reorders; this is token-level.

**Paths.**
- `packages/core/src/operations/format-json.ts` (new, exports `formatJson` the operation and `formatJsonText(s)` the function), `format-json.test.ts` (new)
- `packages/core/src/operations/format-yaml.ts` (new), `format-yaml.test.ts` (new)
- `packages/core/src/operations/index.ts` (two import lines, two array entries)

**Build order.**
1. `formatJsonText(text: string, eol: string): string | null`: a tokenizer (strings with escapes,
   numbers, `true false null`, `{ } [ ] : ,`, whitespace) and a writer: two-space indent, `"key": value`,
   one item per line, empty containers stay `{}` and `[]`, a trailing comma is kept as the token it
   is. Anything else (comments, single quotes, unquoted keys, more than one top-level value) returns
   `null`. Idempotent.
2. `formatJson: Operation`: `codeBlock`, `lang` `json`, top-level and column 0 (as E-06). `run`:
   `replaceSpans(text, [{ the content span, formatted }])` using `sliceByBytes`/`textIndex`, so the fence
   lines are untouched; the content keeps its final line ending. `null` from the tokenizer gives
   `replacement === text` and `summary` "Not formatted: not strict JSON near line N". If Phase C
   shipped `copy-json-pretty`, change it to call `formatJsonText` so there is one tokenizer.
3. `formatYaml: Operation`, `lang` `yaml` or `yml`, top-level, column 0. Re-indent only. For each
   non-blank line compute `(depth, trimmed text)` from an indent stack (a line indented more than the
   previous content line opens a level; less pops to the matching level); rewrite the leading
   whitespace as `2 * depth` spaces. Comment lines take the depth of the next content line. **Decline**
   (no change, with a summary naming the reason) when the block has a tab in leading whitespace, a
   block scalar indicator (`|`, `>`, with or without chomp or indent digits) at the end of a line, a flow
   collection (`[`, `{`) open across lines, or more than one `---` document. After rewriting,
   recompute `(depth, trimmed text)` for every line and require it to equal the original sequence;
   otherwise decline. An already-normalised block returns `replacement === text`.
4. Tests with the kit; `targets` = the content span (JSON), the leading-whitespace spans (YAML).

**Acceptance.**
- JSON rows: nested objects and arrays; numbers `1e10`, `-0`, `1.0` and a 25-digit integer unchanged;
  strings with `é`, escaped quotes and CJK unchanged; the trailing comma of `28-llm-answer.md`
  (its `json` fence at lines 92 to 100) formatted and the comma kept; comments or single quotes
  decline with the summary; already pretty (no change); minified input; the fence in a list item not
  offered; LF/CRLF/no trailing newline by the kit (output newlines use `eolOf` of the content):
  `format-json.test.ts`.
- `formatJsonText` is idempotent over every `json` fence in the corpus and the output has the same
  sequence of tokens as the input ignoring whitespace: same file.
- YAML rows: 4-space and mixed indents to 2; a sequence under a key at the same indent; comments between
  keys; the `yaml` fence of `28-llm-answer.md` (line 193); a block scalar
  declines; a tab declines; a flow list across lines declines; already normalised (no change):
  `format-yaml.test.ts`.
- Minimal-diff: JSON changes only inside the content span, YAML only in leading whitespace, over the
  corpus: both test files via `corpusProperties`.

**Tests.** Gates: `pnpm precheck`, `pnpm gate:fidelity`.

**Do not.** Do not parse and print (no `JSON.parse`/`JSON.stringify`, no YAML library: they reorder,
re-escape, drop comments and change numbers). Do not add a dependency. Do not touch the fence lines.
Do not add a minify variant.

**Risks and open questions.** The YAML half is the weaker one: its value is modest and its decline
list is long. If the structure-preserving check cannot be made tight inside the story, **ship JSON
alone, leave `format-yaml.ts` out, and say so in the PR**; that is an acceptable outcome. Report
the corpus YAML blocks that decline.

### E-11 — Plain-text copy, and the guard that no operation strips markdown as a splice

**Model:** sonnet · **Size:** S · **Depends on:** E-01, Phase C · **Parallel with:** E-06 to E-10, E-04, E-05

**Outcome.** A reader who types "strip" in the palette finds **Copy as plain text (strip markdown)**:
the selection's text with no markup and straight quotes goes to the clipboard, the document is
untouched. A test makes it impossible to add a destructive "strip" splice by accident.

**Why now.** `08` §4.2 #26 and §4.1 #3: the brief lists "strip markdown to plain text"; the audit
says the safe form is the copy form and the splice form must not be built (it violates "never touch
a byte the user did not ask to change").

**Paths.**
- `packages/core/src/operations/copy-plain-text.ts` (new, **only if Phase C did not ship it**) and its test
- `packages/core/src/operations/index.ts` (one line, only if built)
- `packages/core/src/operations/registry.test.ts` (from E-01; add the guard)

**Build order.**
1. Check what Phase C shipped: `grep -rn "plain" packages/core/src/operations/`. If an operation that
   puts markup-free text on the clipboard exists, do not build another; set its title to "Copy as
   plain text (strip markdown)" (a one-line edit in that file) so palette search finds it.
2. If absent, build `copyPlainText` per `08` §4.1 #3: `clipboard.text` is the inline text of the
   selection joined, straight quotes (the AST holds the author's characters; the smart typography
   is a render step), list items one per line with their markers dropped, table rows as tab-separated
   lines, code kept verbatim, links as their text, images as alt text; `replacement === text`.
   Applies to `block`, `section` and `document`.
3. In `registry.test.ts`: no operation in `OPERATIONS` whose id does not start with `copy-` may match
   `/strip|plain|unformat|remove-markup/`; the test's failure message says "stripping is a copy form
   (E-11); a splice would touch bytes nobody asked about".

**Acceptance.**
- (If built) rows over a paragraph with emphasis, a link, inline code and a footnote reference; a
  nested list; a table; a heading; the section of a heading; CRLF input gives the clipboard text with
  `\n` (clipboards are not files; say so in the test) and `replacement === text` in every row:
  `copy-plain-text.test.ts`; and the existing copy fidelity test
  (`operations.test.ts:369-405`) covers it automatically (every `copy-` id).
- The palette's `>` list contains an entry matching "strip" for a paragraph selection:
  `apps/desktop/test/palette.test.mjs`-style case in `apps/desktop/test/operations-copy.test.mjs`.
- The guard test fails when a fake splice operation with id `strip-markdown` is added to a copy of
  `OPERATIONS` (use `canFail`): `registry.test.ts`.

**Tests.** Gates: `pnpm precheck`.

**Do not.** Do not register any non-`copy-` operation that removes markup. Do not run smart
typography. Do not change copy-section or copy-code-clean.

**Risks and open questions.** If Phase C's plain-text copy exists and is titled differently, this is
a 10-line change; do not rewrite it.

### E-12 — Spike: how does the clipboard's HTML reach Rendered mode?

**Model:** sonnet (with the author for a few minutes) · **Size:** S · **Depends on:** — · **Parallel with:** E-01 to E-03, E-13, E-14, E-16

**Outcome.** A one-page decision, `docs/spike/paste-event.md`, that says which route delivers the
clipboard's text and HTML to the app on macOS WKWebView, with the evidence, so E-15 is not built on
a guess.

**Why now.** `08` §7.2 marks it **unverified**: the clipboard plugin has no `read_html`
(tauri-plugin-clipboard-manager 2.3.3 exposes `read_text`, `read_image` and writers); the only route
that needs no Rust and no new capability is the webview `paste` event, and macOS may disable the
Edit > Paste item when nothing editable is focused (`docs/design/09-app-shell.md:~72` says Edit's
predefined paste is native).

**Paths.**
- `docs/spike/paste-event.md` (new). Nothing else is merged; the throwaway probe lives on a local
  branch.

**Build order.**
1. On a local branch, add a probe: a `paste` listener on `document` that logs
   `event.clipboardData.types`, the lengths of `getData('text/plain')` and `getData('text/html')`, and
   `event.target.tagName`, to the console and to `shell.mark` (so it reaches the startup-marks log
   without devtools). Also log `keydown` for `Mod+V` and whether it was `defaultPrevented`.
2. Put plain text and HTML on the pasteboard (copy a table and a heading from a web page, and copy a
   markdown answer from a chat tool), build the app (`run` skill or `pnpm --filter @marxy/desktop
   tauri dev`), focus the article with a click on a block, press `Mod+V`, then use Edit > Paste. Record
   for each: did `paste` fire; were both flavours present; was the menu item enabled. The agent
   cannot press keys in the built app unless computer-use is on: **ask the author to do step 2 and
   read the log back**.
3. If no `paste` event fires with nothing editable focused, try, in this order, and record each:
   (a) a visually hidden `contenteditable` ("paste catcher") focused on `Mod+V` keydown, read in its
   `paste` event, refocus after; (b) `navigator.clipboard.read()` from the keydown (permission and
   gesture behaviour in WKWebView); (c) a Rust command over `arboard` (this widens capabilities; list
   it as a last resort and say what it would add to `capabilities/default.json`).
4. Prove the **handler logic** (not the delivery) in Playwright WebKit with a synthetic
   `ClipboardEvent` carrying a `DataTransfer`; keep that snippet in the document for E-15's test.
5. Write the note: the chosen route; a table of route × (macOS WKWebView, Playwright WebKit, WebKitGTK:
   not verified, no Linux hardware, ADR-0046); what E-15 must implement; the `Mod+V` and menu
   behaviour.

**Acceptance.**
- `docs/spike/paste-event.md` exists, names the tauri and wry versions from `Cargo.lock`, and states
  for macOS: does `paste` fire on a non-editable focus; are `text/plain` and `text/html` both
  present; which route E-15 uses. Evidence is pasted log lines, not prose.
- The synthetic-event snippet runs in Playwright WebKit and shows both payloads read inside the
  handler.
- Nothing from the probe branch is merged (`git diff origin/main --stat` shows only the new doc).

**Tests.** None run in CI. Gates: `pnpm precheck` (the doc passes the docs checks).

**Do not.** Do not merge the probe. Do not add `clipboard-manager:allow-read-text` or any capability.
Do not add a `clipboardRead` to `shell-api`. Do not read the clipboard outside a user gesture.

**Risks and open questions.** WebKitGTK cannot be tested; record it as unverified. If every webview
route fails on macOS, the decision is the Rust command route and E-15 grows by a capability and a
command; say so plainly and stop for the author.

### E-13 — Open a scratch (untitled) document that writes nothing until Save As

**Model:** opus · **Size:** M · **Depends on:** Phase B · **Parallel with:** E-01 to E-03, E-12, E-14, E-16

**Outcome.** The app can open text that is not a file: it renders and behaves like a document
(selection, operations, undo, find, outline, Source mode), the title says it is untitled, the window
does not warn on close unless the reader changed it, and **no file exists** until Save As. This is
the shared substrate for paste (E-15) and for the diff (E-17).

**Why now.** `08` §7.1 "new app-side concept": `untitled` is mentioned in `save.ts:85` and
`docs/design/01-buffer.md:92` ("`untitled` buffers cannot be saved without a path from
`shell.saveDialog`") but nothing creates one.

**Paths.** (today's modules; on Phase B's tree these are the store and view modules)
- `apps/desktop/src/document/untitled.ts` (new: `isUntitled(path)`, `nextUntitledPath()`)
- `apps/desktop/src/document/store.ts` (a new `openUntitled(bytes: Uint8Array, opts?: {label?: string})` transition) or, before Phase B, `apps/desktop/src/app.ts`
- `apps/desktop/src/save.ts:85-86`, `apps/desktop/src/title.ts:6`, `apps/desktop/src/close.ts` (replace `path === 'untitled'` with `isUntitled(path)`)
- `apps/desktop/src/render/images.ts` (`pathsForDocument`, `:21-26`: an untitled path has no directory)
- `apps/desktop/src/selection/view.ts` (`followLink` relative-link branch, `:~160-185`)
- `apps/desktop/test/scratch-document.test.mjs` (new)
- `changelog.d/e-13-scratch-document.md`

**Build order.**
1. `untitled.ts`: paths are `untitled` (first) and `untitled:2`, `untitled:3`… so two scratch
   documents never share an undo history or a position record. `isUntitled(path)` is a strict match
   on that shape.
2. `openUntitled(bytes)`: create a store with `path = nextUntitledPath()`, `disk = bytes` (the
   baseline is what the document was born with, so `dirty` is derived as "buffer differs from what it
   was born with" and a scratch the reader only read closes without a prompt), `buffer = createBuffer(path,
   bytes)`; render through the one open path; **no watch registered**, no position persistence
   (`positionPersistence` is keyed by path), no palette history entry, no index entry, not in the
   Back/forward stack (`recordNavOpen`, `selection/view.ts:~108`).
3. Title: `title.ts:6` returns the untitled form; make it "Untitled" plus ` •` when dirty.
4. Save As: `save.ts:85-86` uses `isUntitled(path)`; after a successful write the store re-keys to
   the new path (`renameDocumentPath`, `commands/edits.ts:85`, is today's version of this), starts
   watching it, and records the read. Save (`Mod+S`) on an untitled document opens the dialog, as the
   design says.
5. Relative resources: an untitled document has **no directory**. `pathsForDocument('untitled:2')`
   must not treat the path as a directory (`images.ts:21-26` would return `documentDir = 'untitled:2'`);
   relative images stay blocked boxes and relative links show the existing notice "That link points
   outside this folder and was not opened" (`selection/view.ts:~176-179`), never a read of the
   filesystem. Remote images follow Phase B's setting.
6. Export `openScratch(text: string, opts?: {label?: string})` from `apps/desktop/src/document/` for E-15
   and E-17 (encodes UTF-8, calls `openUntitled`, shows the transient notice "Opened as a new
   document (not saved)").

**Acceptance.**
- `openScratch('# Hi\n\n- [ ] a\n')` renders an `h1` and a task; selecting the task and toggling it
  works and is one undo step; the memory shell records **zero** `writeFileAtomic` calls through all of
  that: `scratch-document.test.mjs` (see `explicit-save.test.mjs` for how writes are observed).
- Closing a never-edited scratch does not raise the close guard; after one operation it does:
  `scratch-document.test.mjs`, with `close-guard.test.mjs` unchanged.
- `Mod+Shift+S` writes exactly the buffer's bytes to the picked path, the title becomes that file's
  name, the document is watched and `Mod+S` now writes in place: same file.
- Two scratch documents opened in a row have different paths, and undo in one does not touch the
  other: same file.
- A relative image and a relative link in a scratch document are inert (a notice, no filesystem read):
  same file.
- The existing save, close and title tests stay green: `save.test.mjs`, `explicit-save.test.mjs`,
  `save-close-r5.test.mjs`, `close-guard.test.mjs`, `save-trust-r4.test.mjs`.

**Tests.** As above. Gates: `pnpm precheck`, `pnpm gate:no-network`.

**Do not.** Do not write a temp file. Do not add the scratch to the index, the palette's recent list
or the saved reading positions. Do not add a "new document" command (the app is not a writing tool;
scratch documents come from the clipboard and from the diff). Do not change `shell-api`.

**Risks and open questions.** The biggest unknown is the store's shape after Phase B. If it keeps a
single open document, opening a scratch replaces the current one and must go through the existing
unsaved-changes guard; report that this makes paste intrusive and ask whether the split (Phase D) is
expected first. Window title for untitled is today `marxy` (`title.ts:6`); the author may want
"Untitled — Marxy".

### E-14 — Turn a clipboard payload into markdown

**Model:** opus · **Size:** M · **Depends on:** — · **Parallel with:** E-01 to E-03, E-12, E-13, E-16

**Outcome.** Two pieces, no UI: a pure function that decides what a clipboard payload *is* (markdown
text, an HTML copy from a chat tool, JSON, plain text) and a converter that turns a chat tool's HTML
into markdown, **after** the sanitiser has run over it.

**Why now.** `08` §4.4 #33 and §8: HTML to markdown is "the single piece with real code risk"
(nested lists, tables, code language hints), and it needs golden pairs before a UI depends on it. The
core sanitiser is a tokenizer, not a tree (`packages/core/src/sanitize/sanitize-html.ts:1-30`) and
core takes no DOM, so the converter lives in the desktop app over `DOMParser`.

**Paths.**
- `packages/core/src/paste/classify.ts` (new), `classify.test.ts` (new), `packages/core/src/index.ts` is **not** edited (import by path, like `operations`)
- `apps/desktop/src/paste/html-to-markdown.ts` (new), `apps/desktop/src/paste/index.ts` (new; exposes `window.marxyPaste` for the test only)
- `apps/desktop/test/paste-convert.test.mjs` (new)
- `apps/desktop/test/fixtures/paste/*.html` and `*.md` (new golden pairs)
- `scripts/registry.json` (`innerHtmlAllowedIn` gains `apps/desktop/src/paste/`, because `new DOMParser()` is a matched route, `check-registry.mjs:38`)

**Build order.**
1. `classify.ts`: `classifyClipboard(payload: {text?: string; html?: string}): { kind: 'empty' | 'markdown'
   | 'html' | 'json' | 'text'; markdown?: string }`. Order: empty or whitespace only gives `empty`;
   if `text` looks like markdown (a fence line, an ATX heading, two or more list lines, a GFM table
   delimiter row, or two or more inline marks of `**`, `` ` ``, `[](`) the kind is `markdown` and
   the **text is used as is, byte for byte** (an assistant's "copy" button gives markdown in
   `text/plain`; that is the author's exact bytes and beats any conversion); else if `html` has a
   block-level element (`p div h1-h6 ul ol li table pre blockquote br`) the kind is `html`; else if
   `text` is a JSON object or array (`JSON.parse` succeeds) the kind is `json`, `markdown` is the
   text in a fence one backtick longer than any run in it (`fenceFor(text)`), tagged `json`, and
   **not reformatted**; else `text`, used as is.
2. `html-to-markdown.ts`: `htmlToMarkdown(html: string): string`. First `sanitizeHtml(html)` from core
   (`packages/core/src/sanitize/sanitize-html.ts:69`; it keeps `code class="language-x"`,
   `policy.ts:162`), then `new DOMParser().parseFromString(clean, 'text/html')` (inert: no script runs,
   nothing is inserted into the live DOM, so no sink is added), then walk the tree: `h1-h6` to ATX;
   `p`; `br` to a backslash line break; `ul`/`ol`/`li` nested with 2 and 3 space indents, a
   checkbox input to `[ ]`/`[x]`; `pre > code.language-x` to a fence (length chosen so content cannot
   close it) with the language; inline `code` with a backtick run longer than any inside; `strong`/`b`,
   `em`/`i`, `del`/`s`; `a[href]` to `[text](href)`; `img` to `![alt](src)` (rendering still blocks
   remote images under the Phase B setting); `blockquote`; `hr`; `table` to a GFM table (header from
   `thead` or the first row, cell text flattened, `|` escaped, a `br` in a cell to `<br>`); `div` and
   `span` transparent. Escape `\`, `` ` ``, `*`, `_`, `[`, `]`, `<` in text, and a leading `#`, `-`, `+`,
   `>` or `1.` at a line start. Collapse whitespace as HTML does. Ensure one trailing newline.
3. `paste/index.ts`: `convertClipboard(payload): { markdown: string; kind }` combining both; sets
   `window.marxyPaste = { classifyClipboard, htmlToMarkdown, convertClipboard }` (a test hook in the
   same style as `window.marxySelection`, `selection/view.ts:~370`; if Phase B moved hooks to a
   test-only entry, use it).
4. Golden pairs under `apps/desktop/test/fixtures/paste/`, **hand-written to the structure chat
   tools produce** (they are synthetic; real payloads were not collected, `08` §8): headings and
   inline marks; nested lists with checkboxes; a fenced Python block and inline code containing a
   backtick; a table with an alignment-free header and a `|` in a cell; "div soup" with wrapper
   `div class="markdown prose"` and styled `span`s; a hostile payload (`<script>`, `onerror`, a
   `javascript:` href, a `style` attribute) whose markdown contains none of them. Write each `.html`
   as the clipboard would deliver it and each `.md` as the exact expected output.

**Acceptance.**
- `classifyClipboard` table: markdown in `text/plain` beside a rendered `text/html` is classified
  `markdown` and returns the text unchanged; HTML only is `html`; `{"a":1}` is `json` and is not
  reformatted; `hello` is `text`; whitespace is `empty`; a backtick-heavy JSON gets a longer fence:
  `classify.test.ts` (runs under `pnpm --filter @marxy/core test`).
- Each golden pair: `htmlToMarkdown(html) === md`, byte for byte: `paste-convert.test.mjs` (Playwright
  WebKit, calling `window.marxyPaste`).
- **Semantic property:** for each pair, render the produced markdown with `renderSafeHtml` and compare
  its `textContent` (whitespace-normalised) with the original HTML's `textContent` (sanitised):
  equal. This is what keeps the converter honest on inputs that have no golden: same file.
- The hostile pair's markdown contains no `<script`, no `javascript:`, no `onerror`: same file.
- Nothing is inserted into the live document: the test asserts `document.body.innerHTML` is unchanged
  after a conversion: same file. `node scripts/check-registry.mjs` is green with the new allow-list
  entry.

**Tests.** Stay green: `pnpm --filter @marxy/core test` (sanitiser vectors). Gates: `pnpm precheck`,
`pnpm gate:no-network`, `node scripts/check-registry.mjs`.

**Do not.** Do not read the clipboard here (E-15). Do not reformat markdown that arrived as
markdown. Do not insert parsed markup into the live DOM. Do not add a conversion dependency (no
`turndown`); if one is ever wanted it goes through the licence gate first. Do not guess a code
language: use the `language-*` class or none.

**Risks and open questions.** Whether real chat-tool payloads convert as well as the synthetic
pairs is unknown; the author should drop two or three real ones into the fixtures directory and the
pair test will tell. The "looks like markdown" threshold is a heuristic; report the first real
payload it misclassifies.

### E-15 — Paste in Rendered mode opens the clipboard as a scratch document

**Model:** opus · **Size:** M · **Depends on:** E-12, E-13, E-14 · **Parallel with:** E-17

**Outcome.** With a document on screen and nothing editable focused, `Mod+V` (or Edit > Paste)
opens the clipboard as a new untitled document: markdown as it came, an assistant's HTML converted
to markdown, JSON in a fence. Pasting into the palette, find, Source mode or the block editor still
pastes there. Nothing is written until Save As.

**Why now.** `08` §4.4 #33, "highest paste value: read an answer typeset, then copy sections from
it"; Rendered mode has no caret to receive a paste, so the target is a new document.

**Paths.**
- `apps/desktop/src/paste/listen.ts` (new)
- `apps/desktop/src/paste/index.ts` (E-14's file: add `installPaste()`)
- `apps/desktop/src/app.ts` or the Phase B composition root (one call to `installPaste()`); `apps/desktop/src/commands/` only if E-12 chose a route that needs a palette command
- `apps/desktop/test/paste-open.test.mjs` (new)
- `changelog.d/e-15-paste-scratch.md`

**Build order.**
1. Implement the route E-12 chose. For the default (document `paste` event):
   `document.addEventListener('paste', handler)`. In `handler`: if the event target is editable
   (`inEditable`, `selection/bind.ts:58-62`, reuse it) return and let the native paste happen;
   otherwise `event.preventDefault()`, read `clipboardData.getData('text/plain')` and `('text/html')`
   **synchronously** (the data is only valid during the event), `convertClipboard` (E-14), and
   `openScratch(markdown)` (E-13). A payload with files and no text shows the notice "Marxy opens text
   from the clipboard".
2. Size cap 2 MB with the notice "That is too large to open from the clipboard"; `empty` shows
   "The clipboard has no text".
3. If E-12 chose the hidden-catcher route, the catcher is created lazily, lives outside `#doc`, and
   is registered in `scripts/registry.json` first.
4. Privacy: the clipboard is read **only** inside a paste event the reader caused; no polling, no
   background read; `navigator.clipboard.read` is not called on the default route.
5. Trust: the scratch renders under the default policy (HTML allow-list, remote images per Phase B's
   setting); the pasted HTML never reaches the DOM except as the markdown the pipeline renders and
   sanitises.

**Acceptance.**
- A synthetic paste event with `text/plain` = a markdown answer and `text/html` = its rendering opens
  a scratch document whose buffer bytes equal the **plain text exactly** (not the converted HTML):
  `paste-open.test.mjs`.
- HTML-only payload (golden `.html` from E-14) opens a scratch whose buffer equals the golden `.md`.
- JSON-only payload opens a document whose first block is a `json` code block with the JSON bytes
  unchanged.
- A paste while the palette query input or find is focused does not open a document and pastes into
  the input: same file; same inside the block editor and Source mode (`.cm-content` is editable).
- After pasting, the memory shell has recorded zero `writeFileAtomic`; `Mod+Shift+S` writes the buffer
  bytes: same file.
- `navigator.clipboard.read` is never called (spy): same file.
- Previous document: with a dirty open document, pasting does not lose its edits (store keeps it, or
  the existing guard prompts): same file.
- `palette-input-guards.test.mjs`, `palette.test.mjs`, `source-mode-shell.test.mjs` stay green.

**Tests.** As above. Gates: `pnpm precheck`, `pnpm gate:no-network`, `node scripts/check-registry.mjs`.

**Do not.** Do not read the clipboard in the background, on focus or on a timer. Do not add a
`clipboardRead` to `shell-api` or a capability (unless E-12's decision, approved by the author,
requires it). Do not insert the pasted HTML into the DOM. Do not write a file.

**Risks and open questions.** Whether the macOS Edit menu delivers the event at all is E-12's
answer; if the menu's Paste is disabled with no editable focus, `Mod+V` may never reach the page
and the catcher route is needed. A reader pasting a 50-line shell snippet gets a document; whether
`text` that is not markdown should open in a scratch at all (versus a notice) is the author's call;
the default here is "yes, as a plain document".

### E-16 — Compute a line diff in core

**Model:** opus · **Size:** M · **Depends on:** — · **Parallel with:** E-01 to E-03, E-12 to E-14

**Outcome.** A pure function in core that diffs two texts line by line and formats the result as a
unified diff: the engine behind "show what changed".

**Why now.** `docs/research/reader-artifacts/05-diffs-provenance.md` Part A default: "when it must
compute one, use a line-level histogram diff over source lines, implemented in `packages/core` with
no dependency" **[C]**, and the `07` split-view study says "two versions of a regenerated file
deserves its own diff story".

**Paths.**
- `packages/core/src/diff/lines.ts` (new), `packages/core/src/diff/unified.ts` (new), `packages/core/src/diff/diff.test.ts` (new)
- `packages/core/src/index.ts` (one export line)

**Build order.**
1. `lines.ts`: `diffLines(a: string, b: string, opts?: {maxLines?: number}): DiffOp[] | null` with
   `DiffOp = {kind: 'equal' | 'delete' | 'insert'; aStart: number; aEnd: number; bStart: number; bEnd:
   number}` (line indices). Lines split on `\r\n`, `\n`, `\r`; **compared without their ending**
   (a file that only changed from LF to CRLF has no line changes; E-16 reports that separately).
   Histogram: pick the common line with the lowest occurrence count in the region as the anchor,
   recurse on both sides, fall back to a Myers shortest-edit search when every common line occurs
   more than 64 times; trim a common prefix and suffix first. Returns `null` over `maxLines`
   (default 50,000 lines per side).
2. `unified.ts`: `unifiedDiff(a, b, opts?: {context?: number; aLabel?: string; bLabel?: string}):
   { text: string; added: number; removed: number; eolChanged: boolean } | null`. Git's shape: `---`/`+++`
   labels, `@@ -a,b +c,d @@` hunks with 3 lines of context, a leading space, `-` or `+`, and the
   `\ No newline at end of file` line after a last line that has no ending (the handbook: it is not a
   change, `05-diffs-provenance.md` Part A "The no-newline marker"). Identical content gives
   `text === ''`. `eolChanged` is true when the endings of the common lines differ.
3. Tests, including a test-local `applyUnified(a, text)`.

**Acceptance.**
- Round trip: for 200 seeded random pairs of small texts and for every pair of corpus markdown
  files that share a name stem (e.g. `03-ai-plan.md` against itself with edits applied by the test),
  `applyUnified(a, unifiedDiff(a, b).text) === b`: `diff.test.ts`.
- Identical inputs give an empty diff; fully different inputs give one hunk; a single changed line in a
  1,000-line file gives one hunk with 3 lines of context each side; `a\nb\nc\n` against `a\nB\nc` (no
  final newline) prints the `\ No newline at end of file` line under the changed last line; CRLF to
  LF only gives `text === ''` and `eolChanged === true`; an inserted block that moves a repeated line
  (`}`) does not drag the rest of the file into the diff (histogram's reason to exist): `diff.test.ts`.
- `git apply --check` accepts the output for ten cases (skipped when `git` is not on `PATH`): same
  file, via `node:child_process`.
- A 10,000-line file with scattered edits diffs without error; the elapsed time is **printed**, not
  asserted (ADR-0032): same file. Over `maxLines` returns `null`.
- `pnpm --filter @marxy/core test` and `typecheck` green; core still has no Node built-in outside
  tests (`scripts/check-boundaries.mjs`).

**Tests.** Gates: `pnpm precheck`, `node scripts/check-boundaries.mjs`.

**Do not.** Do not add a diff dependency (`diff`, `diff-match-patch`) without the licence gate. Do
not add word-level or moved-block diffing. Do not colour anything (no UI here). Do not hide
whitespace changes (the text stays verbatim).

**Risks and open questions.** The handbook notes a thesis reporting pathological histogram output
and that git's default is Myers; if a corpus pair gives a plainly worse diff than `git diff`, report
it and switch the default to Myers (the structure above already contains it).

### E-17 — Show what changed in a regenerated file

**Model:** opus · **Size:** M · **Depends on:** E-13, E-16, Phase B · **Parallel with:** E-15

**Outcome.** Two palette commands, available only when they mean something. **Show what changed on
disk** appears after the file was rewritten under the reader (live reload applied a new version) and
opens a document containing the unified diff of the version they were reading against the new one.
**Show unsaved changes** appears when the buffer differs from the file and shows that diff. Both
open a scratch document (E-13) holding a summary line and one `diff` fence. It is not a split, not a
mode and not a persistent mark.

**Why now.** The handbook's compare task (`01-reading-tasks.md` §7) and `05-diffs-provenance.md`
Part B ("Changed since last read"): a regenerated agent file is the common case, and a split of two
unrelated documents is the failure mode the handbook names. This is the minimal slice: the diff on
request.

**Paths.**
- `apps/desktop/src/commands/compare.ts` (new), `apps/desktop/src/commands/index.ts` (one line)
- `apps/desktop/src/document/store.ts` (a `previousDisk: Uint8Array | null` field set by the `reload` transition; before Phase B, `app.ts:803-821` `reloadOpenFromDisk` and a module variable)
- `apps/desktop/test/compare.test.mjs` (new)
- `changelog.d/e-17-show-changes.md`

**Build order.**
1. Store: on `reload(bytes)` with a clean buffer, set `previousDisk` to the disk bytes just replaced.
   It is **view state held in memory only**: never written, never persisted, cleared on `close` and when a
   different document opens. A reload that conflicts with unsaved edits (the kept-edits path,
   `app.ts:862`) does not set it.
2. `commands/compare.ts`: `compare.since-reload` ("Show what changed on disk", `when`:
   `previousDisk !== null`) and `compare.unsaved` ("Show unsaved changes", `when`: `dirty`). Each:
   decode both sides as UTF-8 (a non-UTF-8 file uses the replacement characters; the diff is for
   reading, not for writing), `unifiedDiff` (E-16) with labels `before` and `after`, then
   `openScratch(text)` (E-13) with the document `# Changes in <file name>`, a line "12 lines added, 3
   removed since the file last changed on disk", and the diff in a `diff` fence one backtick longer
   than any run inside it. Identical content: a transient notice "No difference". `null` (too large):
   "Too large to compare here". `eolChanged` with no hunks: "Only the line endings differ".
3. The diff renders as code with the markers in column one (today `diff` is tokenised but unclassed,
   so it is monochrome with markers intact: `05-diffs-provenance.md` "Marxy today"); no colour work
   here.

**Acceptance.**
- Open a corpus file, change it on disk (the live-reload simulation in `live-reload.test.mjs`), wait
  for the reload; the palette lists "Show what changed on disk" and not "Show unsaved changes"; the
  command opens a scratch document whose `diff` fence contains the expected `-` and `+` lines and
  whose summary counts are right: `compare.test.mjs`.
- Edit with a task toggle; the palette lists "Show unsaved changes"; the diff is exactly the marker
  line (`-` and `+` of the three bytes' line): same file.
- The original document is unchanged by the command (same buffer bytes, same position, `dirty`
  unchanged) and Back returns to it at its reading position: same file.
- With nothing changed neither command is listed: same file.
- `previousDisk` is cleared when another document opens: same file.
- No file is written: zero `writeFileAtomic` calls: same file.
- `live-reload.test.mjs`, `data-loss.test.mjs`, `persist-reading.test.mjs` stay green.

**Tests.** Gates: `pnpm precheck`.

**Do not.** Do not make this a split, a mode or a margin mark. Do not persist the previous version
or send it anywhere (no network, no telemetry; it is in memory and deleted with the document). Do not
add diff colour classes or theme tokens here. Do not diff against a file the reader picks (that is a
later story).

**Risks and open questions.** "Since the file last changed on disk" shows only one step back; a
file regenerated three times shows the last change. Keeping the version the reader last *read* (not the
last reload) is the handbook's "changed since last read" and needs a persisted snapshot; leave it,
and report whether the author wants it. Colouring the two sides is a taste story with new classes in
`registry.json` and a mapping in `packages/core/src/highlight/scopes.ts`.

### E-18 — Prove the screen criterion and sync the documents

**Model:** opus · **Size:** M · **Depends on:** E-04 to E-11, E-15, E-17 · **Parallel with:** —

**Outcome.** One end-to-end test that performs the phase's screen criterion on an LF file and a CRLF
file and asserts that every byte outside what was touched is identical, and the documents (ADR
statuses, the operations catalogue, the keyboard map, the scope list) say what now exists.

**Why now.** The criterion is the phase's definition of done; no single story's tests prove the
composition (paste, unwrap, tick, edit in place, save).

**Paths.**
- `apps/desktop/test/phase-e-flow.test.mjs` (new)
- `apps/desktop/test/fixtures/e-answer-fenced.md` (new: an assistant's answer wrapped in one four-backtick `markdown` fence, with a one-line preamble, a heading, a list with `- [ ]` items, a paragraph with a typo, a pretty-printable JSON fence; invented content, `example.invalid` hosts)
- `docs/adr/0048-*.md`, `docs/adr/0049-*.md` (status lines), `docs/operations.md` (the v1.1 candidates table becomes the shipped catalogue; the "four per release" wording becomes the per-selection verb limit if the author accepts it), `docs/design/03-selection-and-operations.md` (a short table of the new operations and their ids; each operation's own cases live in its test), `docs/design/09-app-shell.md` (keymap, if E-04 did not), `docs/scope.md` (the items that moved)
- `packages/core/src/operations/registry.test.ts` (the verb-count check, below)
- `changelog.d/e-18-adept-at-both.md`

**Build order.**
1. The fixture, plus a CRLF twin made in the test with `crlf()` semantics.
2. `phase-e-flow.test.mjs` (boot as `operations-edit.test.mjs:41-65`): dispatch a synthetic paste
   (plain text = the fixture, HTML = a rendering) → a scratch opens; click the fenced block; run
   `unwrap-markdown-fence` from the palette; click two task checkboxes; click the typo paragraph, press
   `Mod+Enter`, replace one word, press `Esc`; `Mod+Shift+S` to a path in the memory shell. Read the
   saved bytes. Compute the **expected** bytes in the test by applying the four splices (fence
   lines removed, two three-byte markers, one word) to the fixture bytes directly, assert equality,
   and assert with the kit's `assertMinimalDiff` that the saved bytes differ from the fixture only inside
   those four target spans. Then press `Mod+Z` five times and assert the buffer equals the pasted text.
   Run it for LF and CRLF (every line ending in the saved CRLF file is CRLF; no bare LF).
3. A registry-level check in `registry.test.ts`: for each selection kind in a fixed set of nodes
   (paragraph, heading, list, task item, table cell, markdown fence, json fence, a run of blocks), the
   number of applicable `group: 'selection'` commands is printed; assert each of the **new**
   operations of this phase has an explicit rank or sits below the copy verbs if Phase C's menu ranks
   rows, so the seven-row cap shows copy verbs first.
4. Documents: set ADR-0048 to accepted if the author has accepted it (ask in the PR); ADR-0049 stays
   "proposed, not scheduled" and gets one line saying Phase E built nothing for it; update the
   catalogue and keymap.

**Acceptance.**
- `phase-e-flow.test.mjs` passes for LF and CRLF, and fails when the edit-in-place splice is
  neutralised (run once with `foldSlice` replaced by a version that normalises line endings, as
  `align-table-pipes CRLF case fails when line endings are normalised` does at `operations.test.ts:~440`;
  keep that as a second test with `canFail`).
- `pnpm precheck --all` green.
- Every ADR, doc and scope line named above is changed or the PR says why not.

**Tests.** All gates in "Verification at the end of the phase".

**Do not.** Do not weaken an earlier story's test to make this pass. Do not add a screenshot
baseline. Do not change any contract. Do not edit `docs/taste-review/queue.md` (no gate reads it).

**Risks and open questions.** The test depends on E-12's paste route being testable with a synthetic
event; if the chosen route is the catcher, drive the real keystroke instead. If the verb cap check
shows a selection kind with more than seven rows for operations that are not copy verbs, report which
and let the author choose what leaves the menu (it stays in the palette).

## What this phase deliberately leaves out

- **A caret or live rendering in Rendered mode.** The island is a code-face editor on one block's
  bytes (ADR-0048); the typeset text has no caret, no `contenteditable`, no IME path.
- **Editing more than one block at a time**, or a document at a time: that is Source mode
  (`Mod+E`).
- **User-defined operations.** ADR-0049 is recorded in Phase A as proposed and not scheduled: a line in
  `config.toml` naming a command that receives the selected bytes on stdin. Phase E builds nothing for
  it; the operation contract is deliberately left able to carry it (a user operation is `string →
  string`, tested by the same fidelity property).
- **Span-level text tools in Source mode** (sort lines, join, case, trim, fix quotes, rewrap):
  `08` §6.2 puts them in Source, via a CodeMirror selection turned into an `OperationInput`. Not here.
- **Strip markdown as a splice**, and **"normalise document"** (`08` §4.2 #26, #27): destructive;
  guarded by E-11's test.
- **Pasting into Source mode** as markdown or as a fence (`08` §4.4 #34 to #36), **section to new
  document** (#31), **cross-document extract** (#32): the scratch document makes #31 cheap later.
- **Minify JSON**, descending sort, re-indenting nested list items, promote/demote over a span.
- **Diff colour** (two new token classes and a mapping in `highlight/scopes.ts`), **word-level and
  moved-block diff**, **changed-since-last-read marks in the live page** (needs a persisted snapshot),
  **diff of two arbitrary files**, and anything that makes the split view a diff.
- **A hover copy glyph, a selection popover, a gutter handle.** Rejected in `08` §5.
- **`copy-with-reference`** (needs the whole source in `OperationInput`, ADR-0036 P04).
- **Linux paste behaviour** (WebKitGTK is unverified until a Linux desktop exists, ADR-0046).
