# Cards for the fourth wave: K-05 split, V-02, F-32

**In short.** The replan of 2026-10-11 ([12-replan-2026-10-11.md](12-replan-2026-10-11.md)) splits K-05 so the kind
reaches the reader before the look is ruled, writes the V-02 card, adds F-32 so parallel operation stories stop
conflicting, X-11 (the taste walk), and the cards that give merged parts a door: J-04 (Copy as), J-05 (paste), W-19
(keys) and F-33 (the store walk). J-04 to F-33 were drafted by a Sonnet agent from `main` at `7b543931` and ruled by
the lead: `⇧⌘C` opens Copy as with Markdown preselected; a transient pasteboard item pastes (only concealed ones are
refused, ADR-0065 item 3); J-04 ships the six targets that exist and J-03.1 adds three; pane focus keeps `⌘⌥←`/`⌘⌥→`
and loses `⌘1`/`⌘2`. D-15's card is amended in place (`roadmap-2026-10/04-phase-d.md`). Every card here is Sonnet; none
needs Opus unless it fails once.

---

### K-05a — The kind, decided once at open, on the pane root and in the palette

**Model:** sonnet (medium) · **Size:** S · **Depends on:** K-03, K-04 (merged); lands **after D-15** (both edit
`document/open.ts`) · **Parallel with:** W-02, J-04 · *Steps 1 to 3 of K-05 (`10-cards-wave-3.md`); steps 4 and 5
are K-05b.*

**Outcome.** Every pane's root carries `data-marxy-kind="<kind>"`, decided once when the file opens by
`detectFileKind` with the reader's `[[kind]]` rules and *show as*, and kept through live reloads. An extension-less
`README`, `CONTRIBUTING`, `CHANGELOG`, `CHANGES` or `HISTORY` opens Rendered (ADR-0060 item 8). The palette row reads
the kind recorded in the index. **No theme profile changes**: the look of every kind is today's until K-05b.

**Why now.** K-03's detection and K-04's rules are merged and nothing calls them when a file opens (the survey of
2026-10-11). This is the smallest change that makes them reach the reader, and K-07, K-08 to K-13 and K-20 hang on
the attribute. It no longer waits on H-04's taste ruling.

**Paths.** As K-05's, without `packages/theme/default/theme.css` and `base.css`: `document/open.ts`,
`pane/dom.ts`, `pane/pane-set.ts`, `source/default-mode.ts`, `palette/view.ts`, `docs/design/09-app-shell.md`, and
their tests.

**Build order.** K-05 steps 1 to 3.

**Acceptance.** K-05's first, second, fourth and fifth bullets (the fifth with no declared differences at all: the
corpus renders exactly as on `main`).

**Tests and gates.** As K-05, plus `pnpm gate:fidelity`.

**Do not.** Add a `[data-marxy-kind]` rule to any stylesheet; re-detect on a reload; add a chip (K-07).

---

### K-05b — The `article`, `readme` and `report` profiles

**Model:** sonnet (medium) · **Size:** S · **Depends on:** K-05a, H-04 (#551, held for the author's taste) ·
*Steps 4 and 5 of K-05.*

**Outcome, paths, acceptance.** K-05's step 4 and 5 and its third bullet, in `packages/theme/default/theme.css` and
`packages/theme/src/base.css`, with a before-and-after artifact in `docs/taste-review/` (the profiles move the page:
the author judges them in the app).

---

### V-02 — Table tools in Source

**Model:** sonnet (medium) · **Size:** M · **Depends on:** V-01 (merged) · **Parallel with:** anything outside
`source/` and `commands/source-edit.ts`

**Outcome.** With the caret in a GFM table in a pane's Source editor, the reader can align its columns (respecting
the alignment row's `:` markers), add a row below, add a column after the caret's, sort the rows by the caret's
column, and copy the table as CSV. Palette commands under "Source", with keys where `02-source.md` gives one; no
toolbar, no panel, no mark on the text (mock-v2 `FEATURES.md:107`, `01-galley-keep-knead-leave.md:48`).

**Why now.** The last Source tool that needs no workspace region; V-01 left the place for it.

**Paths.**
- New: `packages/core/src/source-edit/table.ts` and its test (pure functions from text and a caret offset to a splice
  or null; the table's span from the parse, never a regex over lines).
- Edit: `apps/desktop/src/source/structure.ts`, `apps/desktop/src/commands/source-edit.ts`,
  `docs/design/09-app-shell.md` (the key table).
- Read and reuse: `packages/core/src/operations/align-table-pipes.ts` (align is that operation scoped to one table),
  `operations/pack-table.ts` (the CSV writer), `operations/display-width.ts`.

**Build order.** 1. Find the table under the caret from the parse (byte span of the `table` node). 2. Align: call
`alignTablePipes` on that span only. 3. Add row and column: one splice each, cells empty, widths from the aligned
form only when the table was aligned before. 4. Sort: byte-wise order of the column's cell text (say so in the
command title), header and alignment rows fixed, stable. 5. Copy as CSV through the existing copy path (C-07), not a
new clipboard write.

**Acceptance.**
- Each command with the caret outside a table does nothing and says nothing.
- Align, add row, add column and sort keep a CRLF file CRLF, a BOM a BOM and a missing final newline missing (a test
  per command, mutated to fail).
- Escaped pipes (`\|`) and pipes inside inline code stay inside their cell; a table inside a list item or a block
  quote keeps its prefix on every line.
- Sort is one undo step and leaves the header and alignment rows in place.
- CSV of a fixture table matches C-07's `copy-table` output for the same table.
- No new element in the Source frame (`gate:aesthetics`).

**Tests and gates.** `packages/core/src/source-edit/table.test.ts`, `apps/desktop/test/source-structure.test.mjs`;
`pnpm check`, `pnpm gate:fidelity`, `gate:golden`.

**Do not.** Add the operations to `MUTATING_OPERATIONS` or the transform catalogue (these are Source commands, not
transforms); reflow a cell's text; touch Rendered.

**Risks.** A table whose rows have unequal cell counts: add column pads only rows that reach the caret's column; say
so in the PR.

---

### F-32 — Operation lists one entry per line, in id order

**Model:** sonnet (low) · **Size:** XS · **Depends on:** — · **Lands first in wave 4**, before J-04 and J-03.1

**Outcome.** `MUTATING_OPERATIONS`, `CLIPBOARD_OPERATIONS` (`packages/core/src/operations/index.ts`) and the transform
catalogue (`transforms/registry.ts`, J-03) are written one entry per line, sorted by id, with a trailing comma, and a test asserts the
order. Two stories that each add an operation then touch different lines, and git merges them without a conflict
(the lists conflicted for E-06/E-07, E-08/E-10 and J-03).

**Paths.** `packages/core/src/operations/index.ts`, `packages/core/src/transforms/registry.ts`, `operations.test.ts`.

**Acceptance.** The order test fails on an unsorted list; `OPERATIONS` keeps its contents (a set comparison against
`main`'s); where the order is user-visible (the palette's group order), the palette sorts for itself, unchanged on
screen (`palette.test.mjs`).

**Do not.** Change an operation, an id or a title.

---

### X-11 — The taste walk: today's work in front of the author in one sitting

**Model:** sonnet (low) · **Size:** S · **Depends on:** — · **Parallel with:** anything (docs and screenshots only;
no product code)

**Outcome.** One folder, `docs/taste-review/2026-10-walk/`, with a `README.md` the author reads top to bottom in
about twenty minutes: one section per decision, each with a before-and-after pair at 1280 × 800 in both variants
where it applies, one sentence on what changed, the question, and the lead's recommendation. The author answers by
editing a `verdict:` line under each section (keep / change: … / revert).

**Why now.** The direction's visible stories have not reached the author in the app, and H-04 (#551) blocks the
whole look track on a taste ruling. Screenshots from the headless harness cost minutes; a round of rework found
after v0.6.0 costs days.

**Sections, in order.**
1. H-04 (#551): `main` against the PR branch, Night and Paper, on `01-readme`, a long article, a code-heavy page and
   the split; and the type set's licence state (vendored now; H-04.1 needs a download).
2. Split (Phase D): two documents beside each other, the notice bar in a pane (the survey's `07-split.png`).
3. The verb menu and *All actions…* (E), and the palette's operations under `>`.
4. H-03.1: the palette and outline edges, light and dark.
5. K-18: the kind glyphs in palette rows, the html glyph called out.
6. K-03: a task-list document detected as `report` (what the reader would see once K-05 lands: the attribute only).
7. E-11: copy-plain keeping list markers (the copied text, shown as text).
8. V-01: the keys `⌃⇧→` and `⌃⇧B` against the macOS emacs defaults (a table, no screenshot).
9. Source metrics today (18 on 30 px) against V-12's proposed 14 on 21 px, a `.py` file, both variants.
10. The 16 rows in `docs/taste-review/queue.d/`: one line each linking its artifact, grouped by area.

**Paths.** New: `docs/taste-review/2026-10-walk/README.md` and its PNGs (keep the folder under 8 MB: 1280 px wide
PNGs, no full-page captures over 2,400 px tall), and the capture script `docs/taste-review/2026-10-walk/capture.mjs`
(Playwright WebKit over the memory shell, the recipe in `roadmap-2026-10/harness-map.md`). For the PR branch, a
second worktree of #551's head; never check it out in the main checkout.

**Acceptance.** Every section has its pair or says why not; every PNG is referenced; `capture.mjs` regenerates the
set from one command, which the README states; `pnpm check` passes.

**Do not.** Change product code, themes or goldens; launch a GUI window; download fonts; post anything to a PR.

---

### J-04 — Copy as with every target

**Model:** sonnet (medium) · **Size:** M · **Depends on:** J-02 (merged), J-03 (merged), C-07 (merged), F-32 (ready; lands first) (J-03.1 not needed: rows come from the registry, so its three targets appear when it lands) · **Parallel with:** W-02, K-05a

**Outcome.** `⇧⌘C` opens a *Copy as* menu at the pointer for the selection, else the block under the pointer, else the document, in Rendered and in Source. The rows are the eight targets of ADR-0065 item 1: Markdown, plain text, rich text, HTML source, Slack, Jira wiki, JSON string, quote with source. A choice writes **one pasteboard item** holding every representation the target needs, through `Shell.clipboardWriteItem` (J-02), and says one quiet notice: format and size ("Copied as Slack, 1.2 KB"). A `copy_format` key in `config.toml` (default `markdown`) names the row that is first and chosen by Enter. Every other copy verb (`selection.copy-*`, `op.copy-*`) moves to the same write path. `runTransform` gets its first callers.

**Why now.** J-02's write API and J-03's library have no reader-facing caller (survey, 2026-10-11): `clipboardWriteItem` is called by nothing outside the shell layer, `runTransform` by nothing at all. ADR-0065 item 1 calls these eight targets essential. W-21, J-06 and J-08 wait on this path.

**Paths.**
- New: `packages/core/src/operations/copy-as.ts` and `copy-as.test.ts` (`COPY_TARGETS`: `{ id, name, build(input) -> { text, html? } }`; the only place that names the eight targets), `apps/desktop/src/commands/copy-write.ts` (`writeCopy(ctx, rep, label)`: builds the `ClipboardRep[]`, calls `clipboardWriteItem`, says the notice), `apps/desktop/src/commands/copy-as.ts` (the commands `copy-as.<target>` and `copy-as.menu`), `apps/desktop/test/copy-as.test.mjs`.
- Edit: `packages/core/src/transforms/registry.ts` (read only for `runTransform` at `:97`, `TRANSFORMS` at `:85`, `NOT_YET` at `:37`; edit nothing), `packages/core/src/index.ts` (export `COPY_TARGETS`), `apps/desktop/src/commands/copy-text.ts` (`write` at `:10` calls `ctx.shell.clipboardWrite`: route it through `writeCopy`), `apps/desktop/src/selection/apply.ts` (`apply` at `:11`, the `clipboardWrite` call at `:19`; `copiedNotice` at `:7` stays for titles but the notice now carries the size), `apps/desktop/src/commands/registry.ts` (`AppContext.shell` at `:10` is `Pick<Shell, 'clipboardWrite'>`: add `clipboardWriteItem`), `apps/desktop/src/selection/bind.ts` (`NO_SHELL` at `:44`; the `Mod+Shift+C` branch at `:237` that runs `runMarkdownCopy`; add a passive `pointermove` record of the last pointer position over the article, and the same key in Source, where `inEditable` skips it today at `:227`), `apps/desktop/src/selection/verb-menu.ts` (`openVerbMenu` at `:187`: take an optional `rows` so the Copy as targets use the same menu; the `Mod+Shift+C` hint at `:55` and `palette/view.ts:489` go, see Risks), `apps/desktop/src/commands/index.ts` (register), `apps/desktop/src/harness/app-harness.ts` (`:90` stand-in shell), `packages/theme/src/config.ts` (`Config` at `:33`, `DEFAULTS` at `:56`, `KNOWN` at `:70`, `parseConfig` at `:96`: add `copyFormat`), `docs/design/11-config-and-storage.md`, `docs/design/09-app-shell.md` §Keyboard map (`Mod+Shift+C` row at `:102`), `docs/design/03-selection-and-operations.md`.
- Read: `packages/core/src/operations/copy-source.ts` (`copySource`), `copy-plain.ts` (`copyPlain`), `copy-rich.ts` (`copyRich`: `{ text, html }`), `packages/core/src/transforms/convert.ts` (`quote` at `:90`, `jsonString` at `:74`), `apps/desktop/src/shell/clipboard.ts` (the type names, `checkWrite`), `apps/desktop/src/shell/memory.ts` (`clipboardWriteItem` at `:286`, `lastPasteboardWrite`, `pasteboardNativeWrites`), `apps/desktop/src/theme/reader-config.ts` (how config reaches the app), `mock-v2/06-clipboard.md` §Copy formats and `01-workspace.md` §Keyboard.

**Build order.**
1. `copy-as.ts` in core, pure. Markdown = `copySource`'s text. Plain = `copyPlain`'s text. Rich = `copyRich`'s `{ text, html }`. HTML source = the same html, as the text. JSON string = `runTransform('json-string', md)`. Quote with source = `runTransform('quote', md)` then a `— [title](path)` line (title is the first heading, else the file name; the path is the buffer's). Slack and Jira = `runTransform('to-slack' | 'to-jira', md)`. A target whose transform is in `NOT_YET` is left out of `COPY_TARGETS`, so the list is whatever `TRANSFORMS` can run.
2. `writeCopy`: `public.utf8-plain-text` always, `public.html` when the target has html, `transient` false (a reader's copy is not a temporary write). No RTF: nothing in core makes it, and HTML plus plain text is what Mail, Notes, Slack and the editors read for rich text; RTF is a later story if the author asks for it. If `clipboardWriteItem` rejects `unsupported` (Linux: `pasteboard/mod.rs` answers that off macOS), fall back to `clipboardWrite({ text, html })` and say the same notice.
3. Move `copy-text.ts` `write` and `apply.ts:19` onto `writeCopy`. After this `clipboardWrite` has no caller outside `writeCopy`'s fallback; mark it `@deprecated` in `packages/shell-api/src/index.ts:112` and leave the Rust command alone (`src-tauri` is code-owned).
4. The menu and the key: record the pointer, resolve the target (selection, else `selectAt` the element under the pointer, else the document), open the menu with the eight rows, the `copy_format` row first. In Source: the selected text, else the whole file.
5. `copy_format` parsing: an unknown value warns and falls back to `markdown`, as `variant` does at `config.ts:112`.

**Acceptance.**
- Each of the eight targets, for a selected heading, a table and the document of a corpus fixture, writes exactly one item: `lastPasteboardWrite` has the expected types and bytes, `pasteboardNativeWrites` is 1, the `clipboardWrite` call count is 0 (`copy-as.test.mjs` fails on `main`, where every copy is a `clipboardWrite`).
- Rich writes `public.html` that equals `copyRich`'s html byte for byte; no other target writes `public.html`. HTML source writes that html as text only.
- The notice names the format and the size in bytes of the text representation, once, transient; no second notice.
- With a memory shell whose `clipboardWriteItem` rejects `unsupported`, the same click copies through `clipboardWrite` and the notice is unchanged.
- `runTransform` is called by `copy-as.ts` for the five transform targets (`copy-as.test.ts` stubs the registry and sees the ids `json-string`, `quote`, `to-slack`, `to-jira`); a target whose id is in `NOT_YET` is not in `COPY_TARGETS` (fails if a target is offered that cannot run).
- A document with CRLF and a BOM: Markdown copies the selected bytes exactly (BOM never in the copy); JSON string keeps the CRLF as `\r\n` escapes, because `json-string` is `literal`.
- `⇧⌘C` in Source with a selection copies that text and not the line; with none, the file. With the pointer over a block in Rendered and no selection, that block; over nothing, the document.
- `copy_format = "slack"` puts Slack first and Enter copies it; `copy_format = "nope"` warns and Markdown is first (`config` test).
- Nothing is read from the clipboard: the memory shell's `pasteboardDataReads` is empty after every case.

**Tests.** `packages/core/src/operations/copy-as.test.ts`, `packages/theme/src/config.test.ts` (or where `parseConfig` is tested), `apps/desktop/test/copy-as.test.mjs` (WebKit, memory shell), the existing `verbs.test.ts`, `verb-menu.test.mjs` and `selection` copy tests, changed for the one write path. Gates: `pnpm check`, `pnpm gate:fidelity` (core operations touched), `pnpm gate:no-network`, `pnpm gate:golden` if a golden of a copy moves.

**Do not.** Add a toolbar button (W-05); record or list copies (J-08); read the clipboard; write RTF or a custom type; change what `⌘C` copies by default (`COPY_DEFAULT` stays); touch `src-tauri`; add a ninth target; implement `to-slack`, `to-jira` or `to-html` here (J-03.1).

**Risks.** (1) `to-slack`, `to-jira` and `to-html` are in `NOT_YET` on `main` (`registry.ts:37-41`; J-03 shipped 45 of 50), so with J-03.1 unmerged only six rows exist. The lead ruled (2026-10-11): ship the six; the menu reads the registry, and J-03.1 adds its three rows with no J-04 change (a test proves a seventh transform appears). (2) `⇧⌘C` already means "copy exact markdown" (`MARKDOWN_COPY`, `verbs.ts:132`, `bind.ts:237`, the verb menu's hint). The mockup (`01-workspace.md:139`) and ADR-0065 make it Copy as. The menu's Markdown row is the same bytes, one key more; the lead ruled by the mockup and ADR-0065 (2026-10-11): `⇧⌘C` opens Copy as with Markdown as its first, preselected row, so `⇧⌘C` Return is the old behaviour; the author may veto. (3) `mock-v2/06-clipboard.md` says plain text is `⇧⌘C`; `01-workspace.md` says the menu. The card follows the ruling in `06-reconciliation.md` (menu). (4) A pointer record needs a listener on the article; keep it passive and at most one object write per event.

---

### J-05 — Paste: HTML becomes Markdown in Source; in Rendered it opens a scratch document

**Model:** sonnet (high) · **Size:** M · **Depends on:** J-02 (merged), E-13 (merged, #550), E-14 (merged, #535); J-04 lands first (both edit `commands/registry.ts` and `commands/index.ts`) · **Parallel with:** K-05a, W-05

**Outcome.** On a reader's paste, Marxy reads the pasteboard's types through `shell.clipboardTypes()`, refuses a concealed item, and reads HTML and text through `clipboardRead`. In a Source pane, `⌘V` with HTML on the clipboard inserts the HTML as Markdown (E-14's converter) at the caret, as one undo step, in the buffer's own line endings; with plain text only, `⌘V` stays the editor's own paste, byte for byte as today. In Rendered, `⌘V` opens the clipboard as Markdown in a new scratch document (E-13). `⌥⇧⌘V` (*Paste and Match Style*, `09-macos.md:149`) pastes the plain text unconverted. A converted paste says so in one notice. E-12's spike is **superseded**: J-01 and J-02 read the native pasteboard on a reader action, so paste is a command over `shell-api`, not the webview's `paste` event (`12-replan`; E-15's work is this card's).

**Why now.** E-14's converter is imported by nothing in the app: `apps/desktop/src/paste/index.ts` only registers `window.marxyPaste` for its own test, and J-02's `clipboardRead` has no caller. A reader who copies from a web page or a chat tool and pastes into a `.md` gets what the webview decides.

**Paths.**
- New: `apps/desktop/src/source/paste.ts` (a CodeMirror extension: a `paste` DOM handler plus the insert; imported lazily with the editor), `apps/desktop/src/commands/paste.ts` (`paste.rendered` on `Mod+V`, `source.paste-plain` on `Mod+Alt+Shift+V`), `apps/desktop/src/paste/read-clipboard.ts` (types, concealed check, reads, `convertClipboard`), tests `apps/desktop/test/paste-source.test.mjs` and `paste-rendered.test.mjs`.
- Edit: `apps/desktop/src/source/editor.ts` (`baseExtensions` at `:132`, the `exts` list at `:158` to `:190`: add the extension), `apps/desktop/src/paste/index.ts` (drop the `window.marxyPaste` assignment at `:23` from the import path, or keep it behind the test entry; `paste-convert.test.mjs` builds this file as its entry, so keep that working), `apps/desktop/src/commands/index.ts`, `apps/desktop/src/commands/registry.ts` (`AppContext.shell` gains `clipboardTypes`, `clipboardRead` after J-04's change), `docs/design/09-app-shell.md` §Keyboard map, `docs/design/06-shell.md`.
- Read: `apps/desktop/src/paste/html-to-markdown.ts` (`htmlToMarkdown` at `:269`: sanitiser first, then an inert `DOMParser`), `packages/core/src/paste/classify.ts` (`classifyClipboard` at `:52`, `fenceFor`), `apps/desktop/src/source/structure.ts` (`apply` at `:60`: the model for one-transaction, one-undo edits and for writing `\n` as `state.lineBreak`), `source/buffer-commit.ts` (`lineSeparatorFor` at `:24`, `cmDocText` at `:13`), `apps/desktop/src/document/scratch.ts` (`openScratch` at `:16`), `shell/clipboard.ts` (the type names, `READABLE`), `apps/desktop/test/fixtures/paste/*.html` and `*.md`, `paste-convert.test.mjs`, ADR-0065 items 2, 3, 5, `mock-v2/09-macos.md:148-149`.

**Build order.**
1. `read-clipboard.ts`: `clipboardTypes()`; if the list holds `org.nspasteboard.ConcealedType`, return a refusal (a `TransientType` item pastes as any other: ADR-0065 item 3 refuses concealed items only, and transient means "do not record", not "do not paste") and read nothing; else read `public.html` and `public.utf8-plain-text` (a missing type is `null`; a `permission` or `invalid` rejection is a refusal with its message). Run `convertClipboard`.
2. Source: the `paste` handler looks at `event.clipboardData.types` only (no data) and takes the event, with `preventDefault`, only when `text/html` is among them; otherwise it does nothing and the editor pastes as before. Then it reads through step 1. A refusal gets a notice and the buffer is untouched. Insert only when the kind is `html`; for `markdown`, `text`, `json` or `empty` insert the clipboard's own text exactly as the native paste would have (a Source buffer is not a Markdown document: no fence is added to JSON).
3. The insert: one `state.update` over the selection ranges, `"\n"` written as `state.lineBreak`, any U+FEFF removed from the inserted text, `userEvent: 'input.paste'`, `isolateHistory.of('full')`.
4. Rendered: `paste.rendered` runs the same read; any kind becomes Markdown (`convertClipboard`); `openScratch(markdown, { label: 'Pasted' })`. Empty says "Nothing to paste". It is not bound in Source, the find field or the palette (`commandForKey` leaves editable targets alone).
5. `source.paste-plain`: reads `public.utf8-plain-text` and inserts it as step 3, with no conversion and no notice of one.
6. The notice, once, transient: "Pasted as Markdown (converted from HTML)". Not shown for plain pastes.

**Acceptance.**
- HTML on the pasteboard, `⌘V` in Source: the buffer holds the golden Markdown of each `fixtures/paste/*.html` pair, and one `⌘Z` restores the buffer's bytes exactly (`paste-source.test.mjs` fails on `main`, where the webview pastes the text part).
- A CRLF buffer: every line break of the insert is `\r\n` and no bare `\n` is in the saved bytes; an LF buffer gets `\n`; a mixed one gets `\n` and the existing endings are untouched. A BOM buffer saves with its one BOM and an insert holding U+FEFF adds none.
- A concealed item (a fake item with `ConcealedType`): no data read (`pasteboardDataReads` empty), a notice names the refusal, the buffer and the scratch count are unchanged. A `TransientType` item pastes normally (a test pins it).
- Hostile payloads: each of `hostile-page.html` and the E-14 tests' other hostile inputs pasted into Source gives only the golden text; the page makes no request (a Playwright `route` that aborts and counts sees zero), no script runs, and `document.body` outside the editor is byte-identical before and after.
- Plain text only on the pasteboard: `⌘V` inserts through the editor's own handler and `clipboardTypes` is not called (the call log shows no pasteboard read).
- Rendered `⌘V` opens a scratch whose bytes equal `convertClipboard`'s; the file on disk is untouched; Save As is the first write (E-13's rule).
- `⌥⇧⌘V` with HTML and text on the pasteboard inserts the text, byte for byte, and the notice does not appear.
- Nothing watches the pasteboard: no `clipboardTypes` or `clipboardRead` call at boot, on focus, or after a copy (the call log).

**Tests.** `paste-source.test.mjs`, `paste-rendered.test.mjs`, the existing `paste-convert.test.mjs` and `apps/desktop/src/shell/clipboard.test.ts` unchanged, `source-structure.test.mjs`'s chord test (the new keys must not collide). Gates: `pnpm check`, `pnpm gate:fidelity` (editor and document code touched), `pnpm gate:no-network`, `pnpm gate:golden`.

**Do not.** Read the clipboard on a timer or on focus; add a history (J-08); change `html-to-markdown.ts`'s policy or the sanitiser (code-owned); convert in a pane that is not Source or Rendered; fence JSON in Source; add a toolbar button; bind `⇧⌘V` (J-09's).

**Risks.** This card writes into documents; ask for an adversarial review (undo, CRLF, a paste over a multi-selection, a paste while a conflict is pending). (1) Native paste into several selection ranges splits lines across them; the card's insert puts the whole Markdown into every range. Say which in the PR. (2) Scratch with two panes opens in the **other** pane (`pane/index.ts:176`) and replaces its document, with a prompt if unsaved; a reader pasting in Rendered may not expect that. (3) A very large HTML payload is converted on the main thread; measure a 5 MB paste and report it. (4) If `check-boundaries` or the shell-boundary test refuses an import of `shell/clipboard.ts` from `commands/`, export the type names from `packages/shell-api/src/index.ts` (an ordinary contracts PR, ADR-0045). (5) The `paste` event on WebKit may not fire for `⌥⇧⌘V`; the registry key is the reliable route.

---

### W-19 — Keys: `⌘K`, `⇧⌘P`, `⌘/`, and `⌘1` to `⌘3` for Read, Split and Source

**Model:** sonnet (medium) · **Size:** S · **Depends on:** A-13 (merged), W-02 (it moves `⌘\` to fold and Open beside to `⌥⌘\`, in the same `pane/keys.ts` table this card edits) · **Parallel with:** J-05, K-05a

**Outcome.** Five reader-visible changes, each through the one key path. `⌘K` opens the palette (`⌘P` stays). `⇧⌘P` opens it on commands (`>`). `⌘/` opens it on `>` (see Risks: there is no Transform group yet). `⌘1`, `⌘2`, `⌘3` choose Read, Split and Source for the focused pane. Pane focus leaves `⌘1`/`⌘2`: it keeps `⌘⌥←` and `⌘⌥→`, which are already bound. `/` stays content search; `⌘E` stays the toggle; `⌘\`, `⇧⌘\` and `⌥⌘\` are not touched.

**Why now.** The author ruled these keys on 2026-10-10 (`06-reconciliation.md` rows 1 to 3); on `main` `⌘K`, `⇧⌘P`, `⌘/` and `⌘3` do nothing and `⌘1`/`⌘2` focus panes (survey, 2026-10-11). The palette view says `Mod+P` alone (`palette/view.ts:1001`); `docs/design/09-app-shell.md:87` already says `Mod+Shift+P`.

**Paths.**
- New: `apps/desktop/src/commands/view-mode.ts` (`view.mode-read`, `view.mode-split`, `view.mode-source`, each `global: true`), `apps/desktop/test/keys-table.test.mjs` (node: one table across every binding), `apps/desktop/test/view-modes.test.mjs` (WebKit, `test/support/split-same.mjs`'s `withPanes`).
- Edit: `apps/desktop/src/palette/view.ts` (the `keydown` listener at `:1001`: accept `k` as well as `p`; `shift` with `p` calls `summon('>')`; `Mod+/` calls `summon('>')`; each toggles closed when the palette is already open on that query; `summon` at `:834`), `apps/desktop/src/pane/keys.ts` (`PANE_CHORDS` at `:28`: delete the `Digit1` and `Digit2` rows; keep `ArrowLeft` and `ArrowRight` with `alt`), `apps/desktop/src/commands/pane-focus.ts` (`key: 'Mod+1'` at `:28` and `'Mod+2'` at `:36` become `Mod+Alt+ArrowLeft` and `Mod+Alt+ArrowRight`, documentation for the palette), `apps/desktop/src/commands/pane-split-same.ts` (move the body of `run` into an exported `splitSame(ctx)`, so Split reuses it), `apps/desktop/src/commands/index.ts`, `apps/desktop/test/pane-focus.test.mjs` (its `Mod+1`/`Mod+2` cases at `:1`, `:293` and `:302` become `Mod+Alt+Arrow`), `docs/design/09-app-shell.md` §Keyboard map (`:78-104`).
- Read: `scripts/registry.json` and `scripts/check-registry.mjs` (see Risks: neither holds keys), `apps/desktop/src/source/structure.ts` (`registryChord` at `:143`), `apps/desktop/test/source-structure.test.mjs:251` (the one chord-collision test that exists), `apps/desktop/src/commands/navigation.ts` (`view.toggle-mode`, `Mod+E`, at `:45`), `apps/desktop/src/menu/menu-commands.ts` and `src-tauri/src/main.rs:937-946` (the native menu's accelerators: `E`, `[`, `]`, `P`, `O`, `Q`, `W`), ADR-0058 item 7, D-11's per-pane mode (`rendered-view.ts:140` `mode`, `toggleMode`, `jumpToSource`).

**Build order.**
1. `keys-table.test.mjs` first: it collects every chord from `commands()` (`key`, `keys`), `PANE_CHORDS`, the palette's own chords and the native menu's accelerators, through `registryChord`, and fails on a duplicate. Today it must pass; it is the check the new keys are added under.
2. `⌘K`, `⇧⌘P`, `⌘/` in the palette listener; `commandsForPalette` is unchanged.
3. Remove the two digit rows from `PANE_CHORDS`; re-point the focus commands' `key` text. Pane focus is then `⌘⌥←`/`⌘⌥→` (the chord is proposed to the author; it needs no new binding and `pane-focus.test.mjs:107` already tests it).
4. `view-mode.ts`: Read and Source set the focused pane's mode only (`toggleMode()` when it differs). Split, with one pane that has a document: `splitSame(ctx)`, then the new right pane `jumpToSource(at)`; the left stays Rendered. With two panes on one path: left Rendered, right Source. With two panes on different paths: a notice ("Split shows one document twice; this window has two. Close one pane first.") and no change.
5. Update the keyboard map table.

**Acceptance.**
- `⌘K` opens the palette from Rendered and from Source, and a second press closes it; `⌘P` still does both; `⇧⌘P` opens it with `>` typed and the command list showing; `⌘/` the same (`palette.test.mjs` cases fail on `main`).
- `/` in the palette still searches content; `⌘E` still toggles; `⌘F`, `⌘[`, `⌘]` unchanged (`navigation-keys.test.mjs`).
- `⌘3` on a Rendered pane makes it Source and `⌘1` makes it Rendered, with the reading position kept (`view-modes.test.mjs`); each is a no-op when already there and does not flip it (fails if built on `toggleMode` alone).
- `⌘2` on one pane with a document opens the same document in the other pane, Rendered left and Source right; on two panes over two files it changes nothing and says why.
- `⌘1` and `⌘2` no longer move focus; `⌘⌥←` and `⌘⌥→` do, including from inside CodeMirror and with the palette closed (`pane-focus.test.mjs`).
- No chord is bound twice across commands, pane chords, palette chords and native accelerators (`keys-table.test.mjs`); `⌘\`, `⇧⌘\` and `⌥⌘\` rows are byte-identical to W-02's.
- In Source, `⌘/` opens the palette and does not toggle a comment (`source-structure.test.mjs:247` already says no source command takes it).

**Tests.** `keys-table.test.mjs`, `view-modes.test.mjs`, `palette.test.mjs`, `pane-focus.test.mjs`, `navigation-keys.test.mjs`, `source-structure.test.mjs`. Gates: `pnpm check`. `pnpm gate:fidelity` is not needed (no document code), unless `splitSame` moves a file in `document/`.

**Do not.** Re-bind `⌘\`, `⇧⌘\` or `⌥⌘\` (W-02 owns them); rename the `view.open-beside` or `view.close-pane` ids; build the toolbar's Read/Split/Source control (W-05); add a Transform group to the palette (W-21); change the native menu (W-20); bind `⌘3` to anything else in Source.

**Risks.** (1) The brief and the plan say "every key through `scripts/registry.json` and `check-registry.mjs`". They hold no keys: the registry is of marks, events, attributes and prefixes. The key table is `Command.key`/`keys` (`commands/registry.ts:34-36`), `PANE_CHORDS`, the palette's hard-coded `⌘P` and the native menu, and the only collision test covers commands alone. Step 1 closes that. (2) Split with two different documents: ADR-0058 item 7 defines Split as one document twice and keeps two documents' scrolls independent. This card refuses rather than closing a pane that may hold unsaved text; the author may rule otherwise. Scroll linking by source position (ADR-0058 item 7) is not built anywhere on `main`, so Split is two independent views until it is. (3) The plan says `⌘/` opens "transforms under `>`", but the palette has no Transform group: command groups are `document | selection | view | app`, and J-04/W-21 add the entries. Until then `⌘/` lists the operations, as `>` does. (4) `⇧⌘P` is free in the palette's handler only because it tests `!event.shiftKey`; check it does not collide with WebKit's own page-setup chord in the Tauri build. (5) Chord for pane focus: `⌘⌥←`/`⌘⌥→`, already in `PANE_CHORDS`; name it in the PR for the author's veto.

---

### F-33 — A standing data-safety walk over the store

**Model:** sonnet (high) · **Size:** M · **Depends on:** nothing (D-10, D-10.1 and V-07 are merged) · **Parallel with:** anything that does not edit `document/` or `save.ts`

**Outcome.** One seeded, model-based test drives the real `DocumentStore`, the real `save()`, the store registry and the watch's reload rules through the memory shell, in random order, and checks an oracle after every step. Seeds are fixed in CI (default 40) and many more run nightly (`MARXY_WALK_SEEDS=2000`); a failure prints its seed and its step list, and `MARXY_WALK_SEED=<n>` replays it. Every later data-safety story adds an operation or an invariant to this one file instead of writing its own probes.

**Why now.** Four stories in two days (D-10, D-10.1, E-04, V-07) each found a silent-overwrite or lost-typing path by hand: D-10's review found a self-link `readFile` re-arming the guard and a config re-read doing the same. Their probes were reviewers' scripts that did not reach the repository (`gh pr view 538 --comments` has the verdicts and "an 82-seed walk", with no script and none in `git log`). J-05, E-04, V-02 and W-06 write into documents next.

**Paths.**
- New: `apps/desktop/test/support/prng.mjs` (mulberry32, from `document/store.test.ts:584`), `apps/desktop/test/support/store-walk.mjs` (the model, `OPS`, `INVARIANTS`, the runner), `apps/desktop/test/store-walk.test.mjs` (node: store, registry, save, memory shell), `apps/desktop/test/store-walk-panes.test.mjs` (WebKit: the same op script through two real panes).
- Edit: `apps/desktop/src/shell/memory.ts` (the shell has no `peekFile` or `exists`, so the store's own stale-write check, `store.ts:439`, is skipped there: add both, unrecorded in `calls`, as `hasFile` is, `memory.ts:70`), `apps/desktop/test/support/split-same.mjs` only to export what the panes layer needs, `.github/workflows/nightly.yml` is code-owned: do not edit it, hand the lead the one line to add (`MARXY_WALK_SEEDS=2000 node --test --experimental-strip-types apps/desktop/test/store-walk*.test.mjs`).
- Read: `apps/desktop/src/document/store.ts` (`StoreIo` at `:18`, `save` at `:426`, `reload` at `:116`, `resolveConflict` at `:132`, `commitSource` at `:98`, `apply` at `:88`), `apps/desktop/src/save.ts` (`save` at `:76`, `SaveDeps`), `apps/desktop/src/document/live-reload.ts` (`watchDocument` at `:101`: the rules `reload` is called under), `document/registry.ts` (`createStoreRegistry`), `apps/desktop/src/commands/document.ts` (the V-07 commands, `:76-110`), `apps/desktop/test/support/two-pane.mjs` (`bootTwoPanes`, `guard: true` emulates the Tauri stale-write guard at `:108`), `save-as-onto-open.test.mjs`, `split-watch.test.mjs`, `data-loss.test.mjs`, `store-undo.test.mjs`, and the property test at `store.test.ts:583-653` (random splices, undo to the original bytes).

**Build order.**
1. `memory.ts`: `peekFile(path)` and `exists(path)`. A test shows a second program's write (`remove` and `setFile`-style helpers already exist) is visible to `peekFile` and does not arm anything.
2. The model: per path, `disk` (what the model believes is there), `lastApp` (bytes the app last wrote there), `outside` (outside writes made, with whether a notice or a conflict has announced each), `typed` (unique tokens inserted, each with the store that holds it). Documents start from corpus-like fixtures with CRLF, mixed endings and a BOM, so fidelity is exercised, not assumed.
3. The operations, each weighted: open (one or two panes on a path, through the registry), edit by operation (`store.apply`, the Rendered route), Source edit then fold (`commitSource`), fold only, undo, redo, save, Save As (to a fresh path, to an existing file, to a path open in the other pane clean, and to one open and dirty), outside write, outside delete, outside write then delete then restore, keep mine / take theirs (`resolveConflict`), reload with `holds` true and false, close a pane, reopen.
4. The oracle, after every step (`INVARIANTS`):
   - **I1 no silent overwrite.** Every `writeFileAtomic` to a path that existed was preceded by disk equal to that store's baseline (`snapshot().disk`), or was a Save As the reader picked. A write over an outside write the reader had not been told about is a failure.
   - **I2 bytes on disk are known.** At every step the bytes at each path are the last app write, an outside write the model made, or a path the model never touched.
   - **I3 no lost byte without a notice.** Each typed token is in the buffer, or on disk after a save, or in a `(mine)` copy, or was dropped by a step that says so (`undo`, `take theirs`, close-discard); a refusal (`conflict()` pending, held apart, Save As onto a dirty pane) leaves it in the buffer and the model checks a notice or the pending conflict exists.
   - **I4 an outside write is announced.** Dirty buffer plus outside write gives `conflict()` non-null and `save()` writes nothing; clean buffer gives the new bytes in the buffer; an outside delete keeps the buffer.
   - **I5 one store per path.** Two views on a path share a store (`registry.views`); Save As onto a clean open path rejoins, onto a dirty one refuses (D-10.1).
   - **I6 fidelity.** An unchanged buffer saves nothing; an edit changes only its bytes (the `store.test.ts` property, restated per step on the saved bytes).
5. The runner: `prng(seed)`, `MARXY_WALK_SEEDS` (default 40), `MARXY_WALK_SEED` (one seed), 20 to 60 steps a seed, the step list printed on failure. Keep one test per seed so a failure names it.
6. The panes layer: replay the same op script through `bootTwoPanes` with `guard: true`, real `watchDocument`, real Source editors and the notice regions, 6 seeds by default; it is the only place "typed in Source, not yet folded, held apart" is real. If the first PR is too large, ship the node layer and leave this file as a card of its own (F-33.1); say so in the PR.
7. A mutation check: temporarily make `save` skip the `peekFile` comparison (`store.ts:439`) and a seed within the default 40 fails; record that in the PR. Do the same for `reload` ignoring `holds`.

**Acceptance.**
- With the `peekFile` comparison at `store.ts:439` removed, the walk fails on a named seed in I1 (and passes on `main`); with `reload` ignoring a dirty buffer, it fails in I3 or I4 (`store-walk.test.mjs`; both mutations are listed in the PR and are not committed).
- With D-10's two fixes reverted in a scratch branch (the baseline in the store; `peekFile` before `readFile` on a self link), the panes layer fails (`store-walk-panes.test.mjs`).
- `MARXY_WALK_SEED=<n>` reruns exactly one seed and gives the same trace twice (a determinism test: the same seed, the same step list, the same final bytes).
- The default run adds under 20 s to `apps/desktop` tests on the CI runner (the PR reports the time); `MARXY_WALK_SEEDS=2000` runs without a leak (heap does not grow with seeds).
- `memory.ts` gains `peekFile` and `exists` with no change to any existing call-log assertion (the app-harness call record is fixed; `hasFile` is the precedent).

**Tests.** `apps/desktop/test/store-walk.test.mjs`, `store-walk-panes.test.mjs`, plus the memory shell test beside `memory-search.test.ts`. Gates: `pnpm check`; `pnpm gate:fidelity` (the document and save path are the subject, though no core file changes).

**Where later stories plug in.** `store-walk.mjs` exports `OPS` and `INVARIANTS`, each a plain object. A story adds one op (`{ name, weight, applicable(model), run(driver, model, rand) }`) and, if it adds a promise, one invariant (`{ name, check(model, world) }`): E-04 (a block edit in place; does Esc keep it), J-05 (an insert from paste), V-02 (table tools), F-21 (history recorded at commit), W-06 (closing a tab that is dirty), D-15 (a large beside a small file). A story's PR must run the walk with 200 seeds and say so.

**Do not.** Change `store.ts`, `save.ts` or `live-reload.ts` (a failure the walk finds is its own story, not this card's fix); add a dependency; use `Math.random` or the clock; edit `nightly.yml` or `ci.yml` (code-owned); weaken an invariant to make a seed pass.

**Risks.** (1) The node layer re-states `watchDocument`'s decisions (when a change is 'kept', when `holds` is asked), so it can drift from them; the panes layer is the cross-check and the PR should say which invariants only the node layer covers. (2) The memory shell has no stale-write guard of its own (the browser harness emulates one, `two-pane.mjs:108`); the node layer tests the store's baseline alone, which is the stricter test, and the Tauri guard stays a second layer, as D-10's review said. (3) A false positive costs trust: D-10's review met one (the walk's own `Mod+Z` undid typed text). Make every undo an op the model knows. (4) Save As onto an existing file the reader picked is a legal overwrite (the OS dialog asks); the model must treat it as such or I1 over-fires. (5) `mulberry32` is now in three places (`store.test.ts`, `search-incremental.test.ts`, the new support file); leave the first two alone.
