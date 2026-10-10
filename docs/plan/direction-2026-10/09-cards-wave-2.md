# Cards: the direction's second wave

**Date:** 2026-10-10 · **For:** the implementors the lead dispatches beside Phase D · **Read with:**
[07-cards-wave-1.md](07-cards-wave-1.md) (the shared rules, which apply here unchanged),
[05-plan.md](05-plan.md), [06-reconciliation.md](06-reconciliation.md)

**In short.** Eight cards that the wave-1 records unblocked: the token contract's first code (H-03), the
`[[kind]]` rules and *show as* (K-04), the index's four new file types (K-06), the kind icons (K-18),
the at-rest gate for two states (W-01), the changed-on-disk choice (V-07), the clipboard capability
in `shell-api` (J-02) and the transform library (J-03). The models are Sonnet by default. Three rows
are Opus in `05-plan.md` and change a seam (H-03, W-01, J-02); each says **Try Sonnet first** (author,
2026-10-10: be cost-effective), so the lead starts on Sonnet and escalates only on a return. H-03.1, the repoint H-03 left for later, is
recorded at the end (#523).

State of the stories these wait on, as of 2026-10-10 evening: **merged**: H-01 (#490), H-02 (#506),
K-01 (#500), J-01 (#502). **Open**: K-03 (#510, reviewed, merge pending), J-01.1 (#512), D-11 (#496).
**Not started**: E-01, D-14, H-04. K-02's record (ADR-0061) is merged (#501).

| Card | Model | Size | Depends on | Ready |
| --- | --- | --- | --- | --- |
| H-03 | opus (Sonnet first) | M | H-01 merged | now |
| K-04 | sonnet | M | K-01 merged; K-03 #510 open (merge it first: the card extends its `KindRule`) | after K-03 |
| K-06 | sonnet | S | K-03 #510 open | after K-03 |
| K-18 | sonnet | S | K-03 #510 open | after K-03 |
| W-01 | opus (Sonnet first) | S | none | now |
| V-07 | sonnet | M | none | now |
| J-02 | opus (Sonnet first) | M | J-01 merged; J-01.1 #512 open (merge first: it changes the commands this card wraps) | after J-01.1 |
| J-03 | sonnet | L | E-01 not started | after E-01 |

---

### H-03 — Contract v2 in `tokens.css`: the names, the kind scope, the validator

**Model:** opus · **Size:** M · **Depends on:** H-01 (merged) · **Parallel with:** K-04, W-01, V-07
**Try Sonnet first** (author, 2026-10-10: be cost-effective); escalate if the loader's kind-scope clamps need a design the ADR does not give.

**Outcome.** ADR-0059's 27 names are declared in `tokens.css` as their v1 fallbacks, the kind scope
`[data-marxy-kind]` is clamped like `:root`, and a v1 theme renders byte for byte as before. No value is
chosen (H-04).

**Why now.** H-04, W-04, H-06, H-07, K-05 and K-19 wait on the names being real. ADR-0031: a name enters
the contract with a declaration, a kind and a comment.

**Paths.**
- Edit: `packages/theme/src/tokens.css`, `packages/theme/tokens.contract.json` (27 entries plus the
  system-owned `--marxy-root-size-*` copies), `packages/theme/src/loader.ts` (`SPOKEN_CONTRACT` 1 to 2, the
  contract-1 warning of item 9, per-kind clamping in `clampThemeValues`), `packages/theme/src/loader.test.ts`,
  `packages/theme/src/base.css` (move the `--marxy-measure` computation from `:root` to the pane scope),
  `apps/desktop/src/source/theme-bridge.ts` and `highlight-style.ts` (`tok-marker`, `tok-heading`, `tok-link`),
  `docs/theme-contract.md` (decided, not yet shipped, becomes shipped), `scripts/check-tokens.mjs` if it needs a case.
- Read: ADR-0059 items 1 to 9; `scripts/gate-contrast.mjs` (it already reads the v2 roles and says "not yet declared").

**Build order.**
1. Declare each name in `tokens.css` as `var(<fallback>)` or its literal, with a comment (item 2). `pnpm check` (`check-tokens`) passes.
2. Root copies `--marxy-root-size-body` and friends as `var(<original>)`; `applyReaderConfig` unchanged.
3. Loader: accept contract 2; contract 1 keeps today's rendering with ADR-0059's warning text; an unset v2 role in a contract-2 theme warns by name.
4. Kind scope in `clampThemeValues`: clamp the measure 45 to 80 and the line box as at `:root`; drop a global-only name with a warning naming it; reject an absolute length for a size token with a warning naming token and kind; compile a ratio to `calc(<ratio> * var(<root copy>))`; report the `:root` slot cycle (item 7).
5. Bridge: the three `tok-*` names reach Source's markers, headings and links.

**Acceptance.**
- A theme-less page and the default theme render identical computed styles for every v1 token (a test over `tokens.css`).
- A contract-1 theme sets `--marxy-color-text` and its `--marxy-color-text-strong` resolves to that colour (test fails if the fallback is `var(--marxy-color-text)` on the wrong scope).
- `[data-marxy-kind="log"] { --marxy-measure-chars: 120 }` loads clamped to 80 with a warning; `--marxy-color-surface` inside it is dropped with a warning.
- `--marxy-size-body: 0.85` in a kind scope compiles to the `calc`; `18px` there is rejected naming token and kind.
- `--marxy-font-text: var(--marxy-face-sans)` on `:root` alone is a theme error; inside a kind scope it is valid.
- `pnpm check`, `gate:contrast` (still "not yet declared", not failing), the theme package tests.

**Tests.** `packages/theme/src/loader.test.ts` (one case per bullet), `scripts/check-tokens.test.mjs`. Gates: `pnpm check`, `gate:aesthetics` (the page must not move: the measure's move is the risk).

**Do not.** Set a v2 value (H-04); change a v1 name, kind or meaning; edit `default/theme.css` or its `contract = 1`; add a `--k-*` token; set `data-marxy-kind` on a pane (K-05).

**Risks.** Moving `--marxy-measure` off `:root` can change the column's width by a pixel; the aesthetics gate is the check. If the loader work outgrows M, split the validator as H-03.1 and say so.

---

### K-04 — `[[kind]]` rules in `config.toml`, and *show as* for one file

**Model:** sonnet · **Size:** M · **Depends on:** K-01 (merged), K-03 (#510 open; this card reads its `KindRule` and `detectKind`) · **Parallel with:** H-03, W-01

**Outcome.** A reader's `[[kind]]` tables in `config.toml` are parsed and passed to detection; "Always open this folder as" appends one without touching another byte; *show as* for one file is kept in `kinds.json` and beats a rule (ADR-0060 items 1 and 9).

**Why now.** Without rules a reader cannot read `~/.claude/projects/**/*.jsonl` as transcripts; K-07's kind chip needs *show as* to exist.

**Paths.**
- Edit: `packages/theme/src/config.ts` (parse `[[kind]]` into `KindRule[]`, add `kind` to `KNOWN`; a new `appendKindRule(bytes, rule)` beside `setTopLevelKey`), `packages/theme/src/config.test.ts`, `docs/design/11-config-and-storage.md` (the `[[kind]]` table and `kinds.json`).
- New: `packages/core/src/kind/show-as.ts` and `show-as.test.ts` (the `kinds.json` envelope: version guard, size cap, quarantine of a corrupt file, never evicts; model it on `packages/core/src/position/storage.ts`), `apps/desktop/src/commands/kind.ts` (palette commands *Show as* and *Always open this folder as*).
- Read: ADR-0060 items 1, 7 and 9; `packages/core/src/index-model/collection.ts` (`appendRoot`, `appendQuery`: the byte-preserving precedent) and `apps/desktop/src/commands/collection.ts`.

**Build order.**
1. Parse: a rule needs `glob` and `is` (one of `KINDS`); `read` is optional; an invalid rule is dropped with a warning naming its index; first match in file order wins (already `detectKind`'s job).
2. `appendKindRule`: appends a `[[kind]]` block, creating the file from its template if absent; every existing byte, comment and CRLF kept.
3. `kinds.json`: get, set, and at the cap refuse with a notice naming the cap.
4. Commands, and the wire from the open path to `detectKind({ rules, showAs })`. A kind is decided once when a file opens (item 6).

**Acceptance.**
- Appending a rule to a config with comments, CRLF and an existing `[[kind]]` leaves every earlier byte identical (a test that compares prefixes).
- Two rules matching one path: the first wins; `is = "nonsense"` is dropped with a warning.
- *Show as* beats a rule; a rule beats detection; removing the *show as* entry restores the rule's kind.
- At the cap a new choice is refused with a notice and no earlier choice is lost; a corrupt `kinds.json` is quarantined and the app opens.
- `kinds.json` holds a kind and nothing else (a test over its serialisation: no front-matter value, no tool name).

**Tests.** `config.test.ts`, `show-as.test.ts`. Gates: `pnpm check`, `gate:golden` (K-03's goldens must not change).

**Do not.** Change `detectKind` or its goldens (K-03's); add a settings page (W-12); evict a *show as*; write to the document.

**Risks.** `apps/desktop/src-tauri` writes `config.toml` atomically already; reuse that shell call, do not add a Tauri command (a code-owned path).

---

### K-06 — Index `.log`, `.csv`, `.tsv` and `.jsonl`, and record each entry's kind

**Model:** sonnet · **Size:** S · **Depends on:** K-03 (#510 open) · **Parallel with:** K-18, K-04

**Outcome.** The four extensions are indexed and searchable by name and content, and every `IndexEntry` records its ADR-0060 kind, decided from the path alone (tiers 1 to 3), so the palette and the library can group by kind.

**Why now.** `classify` in `packages/core/src/index-model/kinds.ts` allows only Markdown, text, a source list and a theme; logs and JSONL are invisible to the palette today.

**Paths.**
- Edit: `packages/core/src/index-model/kinds.ts` (`classify`: the four extensions), `packages/core/src/contracts/index-entry.ts` (an optional `readerKind?: Kind`; the existing `kind` stays, it names the file class, and a reviewed contract: `contracts.test.ts`), `packages/core/src/index-model/entry.ts` (call `detectKind({ path, head: new Uint8Array() })`), `packages/core/src/index-model/persist.ts` and `apps/desktop/src/index/service.ts` (`:240` validates a stored entry: accept the optional field, snapshot version stays 1), `packages/core/src/index-model/deny.ts` only if `.log` is denied there, and the matching tests.
- Read: ADR-0060 item 3 and item 6 (the walk reads no bytes, so shape tiers 4 to 6 are not run here).

**Build order.** 1. Extensions in `classify` (`.log` and `.csv`, `.tsv`, `.jsonl` as `source`). 2. The field, optional so an old snapshot loads. 3. Fill it in `entryFromCandidate` from the path. 4. A file that is large (a log) stays under `INDEX_LIMITS` and the content-search size ceiling (`ceiling.ts`).

**Acceptance.**
- A fixture tree with one of each extension indexes all four, each with the expected `readerKind` (`log`, `data`, `data`, `data`); a `.md` entry gets `article` (path alone names nothing else).
- A snapshot written before this change loads without a rebuild.
- The 20k-entry build test (`build-perf.test.ts`) does not slow measurably.
- A `.jsonl` is not refined to `transcript` by the index (that needs bytes, opened by K-03's caller).

**Tests.** `entry.test.ts`, `persist.test.ts`, `contracts.test.ts`. Gates: `pnpm check`, `gate:golden`.

**Do not.** Read file bytes in the walk; change any file's opening mode (ADR-0060 item 8: K-03 and K-06 change none); touch `default-mode.ts`.

**Risks.** Two `kind` fields on one entry will confuse; the comment on the new one says which is which. Binary or huge `.log` files: the existing size ceiling decides, not new code.

---

### K-18 — The kind icon set: one glyph per kind, 14 to 16 px

**Model:** sonnet · **Size:** S · **Depends on:** K-03 (#510 open, for the `Kind` names; the set itself needs only `KINDS`, merged with K-01) · **Parallel with:** K-06

**Outcome.** A function from a kind (and, for `code`, a language id) to an inline SVG glyph, drawn on a 16-unit grid with a 1.5 px stroke and no page outline (03, §Kind icons), plus the palette's rows using it. Sidebar and tabs adopt it when W-stories build them.

**Why now.** The palette and the library mark files by kind; K-07's chip and W-09's tree need the set. It is the only visible K-03 result with no other dependency.

**Paths.**
- New: `apps/desktop/src/kind-icons/icons.ts` (one path string per kind, pure), `icons.test.ts`, `apps/desktop/src/kind-icons/icons.css` or a rule in `packages/theme/src/base.css`.
- Edit: `apps/desktop/src/palette/view.ts` (`:469` builds the rows: an `aria-hidden` icon span before the title), `scripts/registry.json` (a class name if the registry needs one).
- Read: `03-kinds-and-the-look.md` §Kind icons, §Per-language colour; `mock-v2/shared/` for the mock's glyphs; ADR-0059 item 8 (`data-marxy-lang`, `--marxy-lang`: K-19 declares it).

**Build order.** 1. Fourteen glyphs: paragraph with a short last line (article, notes), heading bar (report), open book (readme, book), `</>` (code), `{ }` (data), ticked lines (log), `>_` (terminal), two speech marks (transcript), `±` (diff), a page for html; 03 draws ten and names no glyph for `docs`, `changelog` or `book`, so give them the nearest (heading bar, ticked lines, open book) and list the mapping in the test. 2. `currentColor` for stroke, never a fixed colour, so a theme's text roles colour it. 3. The palette row. 4. `code` carries `data-marxy-lang` when a language is known; the colour waits for K-19.

**Acceptance.**
- Every member of `KINDS` has a glyph (a test that fails when a kind is added without one).
- Each glyph is within the 16-unit box, uses `currentColor` and has no fill-only page outline (a parse of the path strings and the SVG attributes).
- A palette row shows its kind's icon, is unchanged for a screen reader (`aria-hidden`), and the row's height does not change (the aesthetics gate's palette case if present, else a geometry test).
- CSP stays valid: inline SVG, no `style` attribute with a non-allowed value (`check-csp`).

**Tests.** `icons.test.ts`, `palette/view` tests. Gates: `pnpm check`, `gate:bundle`.

**Do not.** Draw a file outline; set a fixed colour; add a sidebar or tab (W); name a vendor or tool in an icon (ADR-0060 item 5).

**Risks.** The palette rows are rebuilt in place by C-04's patching (`:510`); the icon span must be patched with the label.

---

### W-01 — The at-rest gate for two states

**Model:** opus · **Size:** S · **Depends on:** nothing (ADR-0058 is accepted) · **Parallel with:** H-03, V-07
**Try Sonnet first** (author, 2026-10-10: be cost-effective); escalate if the unfolded case needs more than a selector and a self-test.

**Outcome.** `checkChrome` takes the window's state. Folded it asserts exactly what it asserts today; unfolded it allows the workspace's regions and still fails a stray element. The gate's self-test proves both can fail.

**Why now.** ADR-0058's Consequences name W-01 as the story that precedes W-02: the workspace must not land with the gate watching nothing.

**Paths.**
- Edit: `scripts/gate-aesthetics.mjs` (`checkChrome` at `:766`, its call at `:976`, its self-test case at `:1229`), `scripts/registry.json` (the attribute W-02 will set: reserve `data-marxy-workspace`, values `folded` and `unfolded`, and say so in the card for W-02), `apps/desktop/test/pane-set.test.mjs` (`:68` cites `checkChrome`: keep it true).
- New: a crafted unfolded page in the self-test (`crafted()` plus a workspace skeleton), no product code.
- Read: ADR-0058 items 1 to 3; `docs/design-language.md` constraint 6; `02-fold-up-workspace.md` (the regions).

**Build order.** 1. `checkChrome(page, { state })`: `folded` is today's body, unchanged. 2. `unfolded`: elements inside `[data-marxy-workspace-region]` regions are allowed (name the regions: sidebar, toolbar, tabs, strip, inspector, status bar); anything else visible outside `#marxy-main` and the regions fails. 3. Self-test cases: folded page plus a stray `<mark>` fails (exists); unfolded page with regions passes; unfolded page with a stray element fails; folded page with a region present fails. 4. The corpus run calls folded only, as today.

**Acceptance.**
- The existing `chrome` self-test still fails the stray `<mark>` (folded strictness unchanged: diff of the folded branch is empty).
- The four new self-test cases pass and each can fail (the gate's `missed` and `falseAlarms` lists stay empty).
- `pnpm gate:aesthetics --mechanical` is unchanged on the corpus.
- Registry: the attribute names are listed before use (`check-registry`).

**Tests.** The gate's own self-test; `scripts/check-registry.test.mjs`. Gates: `pnpm check`, `gate:aesthetics`.

**Do not.** Build any workspace chrome (W-02); loosen the folded case; change a baseline screenshot.

**Risks.** The region attribute is a promise W-02 must keep; if W-02 prefers other names, W-02 edits the registry and this gate in one change.

---

### V-07 — A file changed on disk over unsaved edits: keep mine as a copy, or take theirs

**Model:** sonnet · **Size:** M · **Depends on:** nothing · **Parallel with:** H-03, W-01

**Outcome.** Today the store answers `'kept'` and a notice says "your edits were kept". This card lets the reader act: *Keep mine as a copy* writes the buffer to a new file beside the original and loads the disk's bytes; *Take theirs* discards the unsaved edits for the disk's bytes. Never silent, never overwriting.

**Why now.** The stale-write guard refuses to save over a changed file (`packages/core/src/position/stale-write.ts`), so a reader with edits and a changed file is stuck with no way forward.

**Paths.**
- Edit: `apps/desktop/src/document/store.ts` (a transition `resolveConflict(choice, bytes)`; ADR-0037 amendment line), `apps/desktop/src/document/live-reload.ts` (`:133` and `:200` raise the conflict state), `apps/desktop/src/notices/disk.ts` (the notice names both commands), `apps/desktop/src/palette/commands.ts` (two commands, `when` holds only in a conflict), tests beside each; `docs/adr/0037-one-document-store.md` (a one-line amendment).
- Read: ADR-0018, ADR-0037, `save.ts`, `shell-api` `writeFileAtomic`.

**Build order.** 1. The store remembers a pending conflict (the disk bytes it refused). 2. *Keep mine*: choose `name (mine).ext` (then `(mine 2)`), write with `writeFileAtomic`, never over an existing file, then adopt the disk bytes as the store's disk and buffer; history cleared as in 'reloaded'. 3. *Take theirs*: adopt the disk bytes. 4. A further external change while pending updates the held bytes. 5. Save while pending keeps the existing refusal.

**Acceptance.**
- Dirty buffer plus an external write: `'kept'`, the notice names both choices, nothing is lost, the title still shows unsaved.
- *Keep mine*: the copy's bytes equal the buffer exactly (CRLF, BOM kept); the original equals the disk's; the store is clean; a second conflict makes `(mine 2)`, not an overwrite.
- *Take theirs* with Source text not yet folded in: those edits are counted (`sourceHasUnfoldedEdits`), so the choice acts on them.
- The commands are absent from the palette when there is no conflict.
- A failed copy write leaves the buffer and the pending state unchanged and says why.

**Tests.** `store.test.ts`, `live-reload.test.ts`, `commands.test.ts`. Gates: `pnpm check`, targeted WebKit file only.

**Do not.** Merge or diff the two versions; overwrite a file; add a dialog (notices have no buttons: use commands); change the folded window's chrome.

**Risks.** The notice region has no action buttons (`NoticeInput` is text only); commands are the surface. If the author wants buttons, that is a W-04 question. A new store transition is a seam: ask before widening it past the card.

---

### J-02 — `shell-api`: read the clipboard and write several representations

**Model:** opus · **Size:** M · **Depends on:** J-01 (merged); J-01.1 (#512 open: it narrows the same Rust commands, merge it first) · **Parallel with:** J-03
**Try Sonnet first** (author, 2026-10-10: be cost-effective); escalate if the contract needs a design beyond ADR-0065 item 5.

**Outcome.** `shell-api` gains `clipboardTypes()`, `clipboardRead(type)` and `clipboardWriteItem(reps, meta)` over J-01's `pasteboard_*` commands, with the memory shell's matching fakes and contract tests. The old `clipboardWrite` stays until J-04 moves its callers.

**Why now.** J-04 to J-08 and J-11 all call it; ADR-0065 item 3 makes a reader action the only way in.

**Paths.**
- Edit: `packages/shell-api/src/index.ts` (the `Shell` interface, near `clipboardWrite`), `apps/desktop/src/shell/tauri.ts` (`:87` the `Pick`, `:300` the implementation), `apps/desktop/src/shell/memory.ts` (`:46`, `:229`: a settable fake pasteboard that records every call), their tests (`memory-search.test.ts` shows the pattern), `docs/design/06-shell.md`.
- Read: `apps/desktop/src-tauri/src/pasteboard/mod.rs` (the types, `ConcealedType` refusal, the size cap, the reserved types), ADR-0065 items 2, 3, 5.

**Build order.** 1. Types: `PasteboardTypes`, `ClipboardRep = { type, bytes }`, `ClipboardMeta = { transient?: boolean }`; errors reuse `ShellError` (`code: 'permission'` for a concealed item, `'invalid'` for a reserved type). 2. The three methods on `Shell`. 3. Tauri: invoke `pasteboard_types`, `pasteboard_read`, `pasteboard_write` with J-01's argument shapes. 4. Memory: types list, read by type, concealed fake item refuses unread, write records one item. 5. A contract test runs the same cases over the memory shell and (macOS only) the Tauri shell's stub.

**Acceptance.**
- A concealed fake item: `clipboardRead` rejects `permission` and the fake records zero data reads.
- `clipboardWriteItem` with two representations is one call to the native write (one item, not two); a reserved type is rejected before any native call.
- No code path reads the clipboard except through a method a command calls: a test asserts the memory shell logs no read at construction or on focus.
- `clipboardWrite` behaves exactly as before (its callers' tests unchanged).
- `check-boundaries` passes: `shell-api` imports nothing from `apps/desktop`.

**Tests.** `packages/shell-api` has no tests yet: add `apps/desktop/src/shell/clipboard.test.ts`. Gates: `pnpm check`, `cargo test` for the pasteboard module only if Rust changes (it should not).

**Do not.** Edit `src-tauri` (code-owned; J-01.1 owns it); add polling or a change observer; build a history or a command (J-04, J-06, J-08); remove `clipboardWrite`.

**Risks.** J-08's Do-not (08-cards-studio.md) leaves `packages/shell-api` to this card; J-08 only calls what is added here. Read the J-01.1 diff before starting.

---

### J-03 — The transform library in core

**Model:** sonnet · **Size:** L · **Depends on:** E-01 (not started: the helpers and the test kit, `packages/core/src/operations/text-helpers.ts` and `test-kit.ts`) · **Parallel with:** J-02

**Outcome.** The mockup's 50 transforms (`mock-v2/06-clipboard.md` §Transform catalogue, ids kept) as pure `string -> string` functions in core, in groups, behind one registry (`id`, `name`, `group`, `fn`), each run under the fidelity property and a table of rows.

**Why now.** ADR-0065 item 4: the palette, toolbar and verb menu must agree on one library. J-06, W-21 and J-11 wait on it.

**Paths.**
- New: `packages/core/src/transforms/` (`registry.ts`, one file per group: `clean.ts`, `case.ts`, `lines.ts`, `markdown.ts`, `data.ts`, `encode.ts`, plus a `*.test.ts` per file), `packages/core/src/transforms/ids.json` (the 50 ids and names, the single list the tests and the palette read).
- Edit: `packages/core/src/index.ts` (export the registry), `scripts/registry.json` if a gate needs it, `packages/core/scripts/golden.ts` only if the fidelity gate must see the library.
- Read: ADR-0004, ADR-0065 item 4, `packages/core/src/operations/` (E's operations already cover unwrap, promote, sort, align; reuse, do not copy), `docs/plan/direction-2026-10/studio/` for the verdicts on which transforms are in.

**Build order.** 1. Registry and `ids.json`; a test that every id in the mock's table exists. 2. The Clean group first (`strip-emoji`, `strip-frontmatter`, `strip-citations`, `strip-bold`, `strip-hr`, `collapse-blank`, `normalize-bullets`, `normalize-headings`, `demote`). 3. The rest by group, one commit each. 4. A transform that E's operations already do calls that operation's text form. 5. Code fences and front matter are left alone by every transform that says "outside code".

**Acceptance.**
- Every id is present once and each is deterministic (same input, same output, no clock, no random).
- Every transform keeps a CRLF input CRLF and a BOM a BOM; a property test over the corpus fails if a transform changes a byte it does not mean to (the minimal-diff property from E-01).
- Idempotence is asserted where the catalogue says so (`collapse-blank`, `strip-hr`).
- A transform given a fenced block returns the fence's bytes unchanged.
- `check-boundaries`: no DOM, no Node built-ins, no Tauri.

**Tests.** One table per group via E-01's `tableTest`. Run one file at a time. Gates: `pnpm check`, `gate:fidelity`, `gate:golden`.

**Do not.** Port from the prototype's JavaScript without tests; add a Rust twin (the mock's note is superseded by ADR-0065 item 4, which says core); add a UI (W-21, J-06); call the clipboard.

**Risks.** L: split by group if one PR passes a reviewable size (the lead decides after the Clean group). Until E-01 lands there is no test kit; do not start by writing a local one.

---

### H-03.1 — The palette and outline read the contract-2 edge roles (recorded after the fact)

**Model:** sonnet · **Size:** S · **Depends on:** H-03 (merged) · **State:** #523 open, written from the lead's brief with no card; this entry is its record.

**Outcome.** The palette and the outline stop reading the two names ADR-0059's Consequences retire, `--marxy-color-border` and `--marxy-color-accent-muted`, and read the roles that replace them: `--marxy-color-rule-strong` for the outline of a surface (the palette, the outline, the palette's notice rule), `--marxy-color-edge` for the palette query field's bottom edge, and `--marxy-color-accent-wash` for the selected outline row and the active palette row. No new name. H-03 left this repoint out; it is the "split the validator as H-03.1" the H-03 card anticipated, for a different reason.

**Paths.** `apps/desktop/src/palette/view.ts`, `apps/desktop/src/outline/view.ts`, and a new `apps/desktop/test/chrome-edges.test.mjs` (a theme that sets the three roles repaints the surfaces; with none set they resolve to the v1 fallbacks). A contract-1 theme resolves through `tokens.css`'s fallbacks to the rule, secondary-text and selection colours.

**A visible change, for the author's taste.** The old literals (`#444` and white at 8 %) were undeclared fallbacks, wrong in the light variant; the repoint makes them follow the theme. The default theme's chrome is therefore not byte-identical to before, in dark as well as light. The lead reviewed and merged on that reading; the author sees it in the app and may overturn it.

**Checked.** `gate:contrast` 430 pairs, 0 failing; `check-tokens` ok (93 tokens); `gate:aesthetics --mechanical` ok; `pnpm precheck` 7 of 7.

**Do not.** Declare a name; touch `tokens.css`; set a value (H-04).
