# Cards: the clipboard studio

**Date:** 2026-10-10 · **For:** the implementors the lead dispatches once ADR-0066 is ruled · **Read
with:** `../roadmap-2026-10/00-orchestration.md` §3 to §5, [05-plan.md](05-plan.md),
[06-reconciliation.md](06-reconciliation.md), the design in [studio/](studio/README.md)

**In short.** Six build cards for v0.7.0 (J-07 to J-12) and two held cards (J-13, J-14), written from
J-D1's design in the shape of [07-cards-wave-1.md](07-cards-wave-1.md). They build clipboard history
of Marxy's own copies (ADR-0066's option A), the Clipboard view, its settings and Privacy line, the
workbench, and saved pipelines. **None starts before the author rules on ADR-0066.** If the author
chooses option B, J-07 to J-12 stand as written and J-14 is released; if the author lifts 06 row 5,
J-13 is released. The ring has no card (`studio/ring.md`: later).

## Shared rules for every card

The shared rules of [07](07-cards-wave-1.md#shared-rules-for-every-card) hold, and three more:

- **History records at one place.** After J-08, every clipboard write in `apps/desktop/src` goes
  through `writeCopy` in `apps/desktop/src/clipboard/write.ts`, native copies included (a `copy` event
  handler); a test fails on any other call to the shell's write, on `execCommand('copy')`, and on a
  copy path that bypasses the handler.
- **Nothing reads the clipboard but a reader action** (ADR-0065 item 3). A card that adds a read names
  the action, and its test asserts the memory shell saw no read without it. J-01's pasteboard commands
  are not permission-gated, so this rule rests on the frontend and on these tests.
- **A read refuses concealed, transient and auto-generated items** before reading data (J-01 refuses
  concealed ones; the frontend the other two, by default pending the author).
- **Plain files only** (commitment 3): no SQLite, no new dependency for storage, every data file a
  `"version": 1` envelope written through `writeFileAtomic`.

## Order and waves

| Wave | Cards | Waits for |
| --- | --- | --- |
| 1 | J-07 | The author's ruling on ADR-0066 |
| 2 | J-08 | J-02, J-04, J-07 |
| 3 | J-09; J-10 when W-12 has merged | W-02, W-04, W-19; W-12 |
| 4 | J-11 | J-03, J-06, W-21, E-13, E-16, J-09 |
| 5 | J-12 | J-11 |
| held | J-13 (collect), J-14 (watching) | The author |

J-09 and J-10 have disjoint paths and can run together. If v0.7.0 is full, J-12 moves to v0.8.0 first.

---

### J-07 — The history model and the secret patterns, in core

**Model:** sonnet · **Size:** M · **Depends on:** ADR-0066 accepted · **Parallel with:** J-02, J-03, J-04

**Outcome.** A pure model of clipboard history in `packages/core`: add with coalescing, retention,
pins, delete, and search; and the fixed list of secret patterns. No clock, no storage, no DOM: time
and limits are arguments.

**Why now.** ADR-0066 items 3, 4 and 7. Every surface after it (the store, the view, the ring if it
ever comes) shares one model, tested once.

**Paths.**
- New: `packages/core/src/clipboard/history.ts`, `history.test.ts`, `secrets.ts`, `secrets.test.ts`,
  `privacy.ts` (the two privacy constants), `privacy.test.ts`.
- Edit: `packages/core/src/index.ts` (exports).

**Build order.**
1. Types: `ClipItem { id, at, bytes, format, source: {path, start, end, line} | null, origin: 'copy' |
   'workbench' | 'kept', pinned, reps: { text: string; html?: string } }` and `NotRecorded { at,
   source, reason: 'secret' | 'too-large' }`.
2. `addItem(state, candidate, opts)` returns the new state, or a `NotRecorded`: refuses text over
   `opts.maxItemBytes` (1 MB) and, with `opts.skipSecrets`, text `looksLikeSecret` matches; coalesces
   with the newest item when the text is equal (moves it to the top, updates `at`).
3. `retain(state, { keepItems, keepDays, maxBytes, now })`: drops unpinned items past the count, the
   age (when `keepDays > 0`) and the 32 MB total, oldest first. Pinned items are never dropped.
4. `pin`, `unpin`, `remove(ids)`, `search(state, query, limit)` (case-folded substring over text and
   source path; returns the matching line and the total count).
5. `secrets.ts`: `looksLikeSecret(text)` over the table in ADR-0066 item 7 (prefix and length per
   issuer, PEM blocks, three-segment `eyJ` JWTs, and `.env` lines whose key matches
   `/(SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|PRIVATE_KEY)/i`), each a regular expression with one positive
   and one near-miss fixture. A match anywhere in the text refuses the whole item.
6. `privacy.ts`: `CLIPBOARD_HISTORY_PRIVACY_LINE` and `CLIPBOARD_WATCH_PRIVACY_LINE`.

**Acceptance.**
- `history.test.ts`: `coalesces_equal_newest`, `refuses_over_cap`, `refuses_secret_when_on`,
  `keeps_secret_when_off`, `retain_drops_oldest_unpinned`, `retain_never_drops_pinned`,
  `retain_by_age_only_when_days_positive`, `retain_total_bytes`, `search_returns_matching_line`,
  `search_reports_total_past_limit`. Each fails with its branch removed.
- `secrets.test.ts`: every pattern matches its fixture and not its near miss
  (`each_pattern_positive_and_near_miss`); prose with "key" or "token" in it is not a secret
  (`prose_not_secret`); one secret line inside a long text refuses the whole text
  (`match_anywhere_refuses_item`); `DB_PASSWORD=hunter2` matches and `PASSWORD=` (empty) does not
  (`env_line_needs_value`).
- `privacy.test.ts` reads `docs/adr/0066-clipboard-history.md` and asserts both constants appear in it
  verbatim, with the ADR's line breaks and list indent collapsed to single spaces (`privacy_lines_match_adr`), as P-02's test reads ADR-0063.
- `pnpm precheck` green; `check-boundaries` passes (no DOM, no Node built-ins in core).

**Tests.** The three files above. Gates: `pnpm precheck`, `pnpm check`.

**Do not.** Read a clock (`Date.now`) or the environment inside the model. Store anything but the
fields above. Add a dependency.

**Risks.** Secret patterns that are too eager refuse ordinary copies; keep each pattern anchored to its
issuer's prefix and length, and test the near miss.

---

### J-08 — Recording at the write path; the four keys; history as plain files

**Model:** opus · **Size:** M · **Depends on:** J-02, J-04, J-07 · **Parallel with:** W-stories that do not touch `apps/desktop/src/clipboard/`

**Outcome.** Every copy Marxy makes goes through one function, `writeCopy`, that writes the clipboard
and records the copy in history: the verbs, `runCopyShortcut`'s fallback, and native copies (Source's
CodeMirror, the Edit menu's Copy, text fields) through a `copy` event handler. `clipboard_history`, `clipboard_keep_items`, `clipboard_keep_days` and
`clipboard_skip_secrets` are parsed. In `session` history lives in memory; in `keep` it is the files
ADR-0066 item 5 names. *Keep the clipboard*, *Pause* / *Resume* and the two clears are palette commands.

**Why now.** ADR-0066 items 1, 3 to 6. Recording where Marxy writes is what makes option A need no
watching.

**Paths.**
- New: `apps/desktop/src/clipboard/write.ts` (the one write path), `write.test.ts`,
  `apps/desktop/src/clipboard/copy-event.ts` (the `copy` handler), `copy-event.test.ts`,
  `apps/desktop/src/clipboard/history-store.ts` (memory and file stores), `history-store.test.ts`,
  `apps/desktop/src/commands/clipboard-history.ts` (the commands), `clipboard-history.test.ts`.
- Edit: the clipboard write call sites (today `apps/desktop/src/commands/copy-text.ts:11` and
  `apps/desktop/src/selection/apply.ts:19`, plus any J-04 and J-06 added) to call `write.ts`;
  `apps/desktop/src/selection/apply.ts:54` (`runCopyShortcut`'s `document.execCommand('copy')` becomes
  `writeCopy`); the Source editor's setup in `apps/desktop/src/source/` only if CodeMirror's copy needs
  the selection's byte range passed to the handler; `apps/desktop/src/theme/app-config.ts` and
  `apps/desktop/src/theme/reader-config.ts` (the four keys reach the app);
  `apps/desktop/src/commands/index.ts` (register); `packages/theme/src/config.ts` and `config.test.ts`
  (the four keys); `docs/design/11-config-and-storage.md` (the keys, the `clipboard/` rows in *Data
  files*, the exception under *What is never stored*); `scripts/registry.json` (any new names).

**Build order.**
1. `write.ts`: `writeCopy(ctx, reps, meta: { format, source, origin, transient })` calls J-02's write,
   then, unless `transient`, `history.add` (J-07). A failed write records nothing.
2. Point every call site at `writeCopy`; replace the `execCommand('copy')` fallback; install the
   `copy` and `cut` handler on the document (capture phase). Only when it has the full text (Source's
   from the editor's state, never the DOM; a text field's from its selection range) does it fill
   `event.clipboardData` synchronously, prevent the webview's write, and pass the text and HTML, with
   its source (document and byte range in Source, else `null`), to `writeCopy`; otherwise it leaves the
   native copy alone, unrecorded. Add a test that scans `apps/desktop/src` and fails on any other call to the shell's
   clipboard write, on `execCommand('copy')`, and on a `copy` or `cut` listener outside `copy-event.ts`
   (`single_write_path`).
3. `history-store.ts`: a memory store for `off` (records nothing) and `session`; a file store for `keep`
   under `<data>/clipboard/` from `shell.configPaths()`: item files first, then `index.json`, each
   through `writeFileAtomic`; at load, reconcile (delete unnamed item files, drop entries with no
   file), rename an unparseable index to `index.json.bad-<timestamp>` with one notice.
4. Mode changes: `session` → `keep` asks to keep this session's items; `keep` → `session`/`off` asks and
   deletes `clipboard/`; `session` → `off` drops memory.
5. Commands: `>Keep the clipboard` (J-02 read, types first; concealed, transient and auto-generated
   items refused before any data is read, with history.md's notice;
   empty says so), `>Pause clipboard history` / `>Resume clipboard history` (session-only state),
   `>Clear unpinned clipboard history`, `>Clear all clipboard history` (each with a confirmation and a
   10-second Undo held in memory).

**Acceptance.**
- `write.test.ts`: `records_after_successful_write`, `transient_not_recorded`,
  `failed_write_records_nothing`, `single_write_path`.
- `copy-event.test.ts`: `native_copy_recorded` (a `copy` event over a text selection writes once
  through `writeCopy` and records it), `source_copy_carries_byte_range`, `edit_menu_copy_recorded`,
  `webview_write_cancelled` (the event's default is prevented, so nothing reaches the pasteboard twice),
  `unrecognised_context_falls_back_native` (an image or an unforeseen element: no prevention, nothing
  recorded), `failed_write_keeps_native_copy` (J-02's write rejects: `clipboardData` still holds the
  text), `source_long_selection_full_text` (a Source selection longer than the viewport is copied
  whole), `cut_recorded`.
- `history-store.test.ts` (memory shell): `session_writes_no_file` (the shell's file log is empty after
  ten copies), `keep_writes_items_then_index`, `keep_reconciles_orphans`, `corrupt_index_set_aside`,
  `keep_to_session_deletes_folder`, `clear_deletes_files_and_undo_restores`.
- `clipboard-history.test.ts`: `keep_clipboard_reads_once_on_command`, `keep_clipboard_refuses_concealed`,
  `keep_clipboard_refuses_transient_and_autogenerated` (zero data reads, through J-02's fake),
  `no_read_without_command` (the shell saw no read across the other tests; this test carries the
  reader-action rule, which J-01's ungated commands leave to the frontend).
- `config.test.ts`: each key's default, clamp and invalid fallback.
- `pnpm precheck` and `pnpm check` green.

**Tests.** The files above, one at a time. Gates: `pnpm precheck`, `pnpm check`.

**Do not.** Read the clipboard outside *Keep the clipboard*. Leave `execCommand('copy')` or an unhandled
native copy. Poll anything. Write outside
`<data>/clipboard/`. Use SQLite or add a storage dependency. Touch `packages/shell-api` (J-02 owns it).

**Risks.** J-04 and J-06 may add write sites after this card is cut; the `single_write_path` test finds
them. The 32 MB bound keeps a full scan cheap; record a 500-item search time in the PR.

---

### J-09 — The Clipboard view: the history pane

**Model:** opus · **Size:** L · **Depends on:** J-08, W-02, W-04, W-19 · **Parallel with:** J-10

**Outcome.** `⇧⌘V` (outside an editable field, if the author confirms the README's item 4),
`>Clipboard history` and *Clipboard history…* in the Copy as menu open the
Clipboard view in the workspace: history beside an empty workbench pane, or one column when folded or
under 900 px. Every state, row action, key and the foot line of [studio/history.md](studio/history.md).

**Why now.** The surface that gives history to the reader; the workbench (J-11) fills its right pane.

**Paths.**
- New: `apps/desktop/src/clipboard/view.ts`, `view.test.ts`, `apps/desktop/src/clipboard/view.css`,
  `apps/desktop/test/clipboard-view.test.mjs` (WebKit).
- Edit: `apps/desktop/src/commands/clipboard-history.ts` (open, close, row commands); the Copy as menu
  file J-04 owns (one item, after a separator); W-19's key registry (`⇧⌘V` and the view-scoped keys);
  `scripts/registry.json` (the view's classes and data attributes, first). `apps/desktop/src/app.ts`
  only if mounting needs it, and then no other story in the wave touches it (00 §5).

**Build order.**
1. Register the names and keys; mount the view as a workspace view (W-02), with `Esc` returning to the
   document at its reading position.
2. The pane: head and menu, search, format chips, grouped rows (virtualised past 200), preview,
   selection bar, foot line; then every state in history.md's table.
3. Row actions through the verb menu (ADR-0054), at most seven; *Copy* through `writeCopy` (J-08);
   *Open the source* at the byte range, or at the line with the changed-text notice.
4. The keyboard model: `listbox` with `aria-activedescendant`, type-to-search, the keys in the studio
   README's table, nothing else.

**Acceptance.**
- `view.test.ts`: `enter_copies_item_back` (one write with the stored reps, tagged, not transient),
  `alt_enter_opens_workbench`, `copy_joined_oldest_first`, `delete_then_undo`, `states_render`
  (off, empty session, empty keep, paused, no match, error), `search_shows_matching_line`.
- `clipboard-view.test.mjs` (WebKit, run alone): opens with `⇧⌘V` outside an editable field and does
  not inside one (`shift_cmd_v_in_field_is_not_the_view`, coordinated with J-05's paste key), `Esc` restores the reading
  position; the folded one-column layout; W-01's at-rest check passes with the view closed.
- The keys pass W-19's registry check (no collision with `⌘K`, `⌘P`, `⌘E`, `⌘/`, `/`).
- A taste-review entry with the plates' states as screenshots is welcome, not required.

**Tests.** As above, serially. Gates: `pnpm precheck`, `pnpm check`, the lite suite file alone.

**Do not.** Show any count of use, or the view at rest. Read the clipboard. Add a toolbar button.
Show content in a *not recorded* row.

**Risks.** The view's two panes must not squeeze the reading measure when it closes (the column never
reflows, W-02).

---

### J-10 — Settings › Clipboard and the Privacy line

**Model:** sonnet · **Size:** S · **Depends on:** W-12, J-08 · **Parallel with:** J-09

**Outcome.** W-12's settings view gains a Clipboard section with the four keys, the default copy
format (J-04) and the two clears; the Privacy page shows `CLIPBOARD_HISTORY_PRIVACY_LINE` while history
is not off, and in `keep` the folder, its size and *Reveal*, as [studio/rules.md](studio/rules.md)
draws them.

**Why now.** ADR-0066 item 8: the Privacy page names the whole action.

**Paths.**
- New: the Clipboard section file under W-12's settings directory (named in W-12's PR), with its test.
- Edit: W-12's Privacy page file and its test; `apps/desktop/src/theme/app-config.ts` and
  `apps/desktop/src/theme/reader-config.ts` (the keys the rows read and write); `scripts/registry.json`
  if new names.

**Build order.** The rows, written through `setTopLevelKey` only where they differ from the default;
the mode-change questions from J-08; the Privacy line from `@marxy/core`, never retyped.

**Acceptance.**
- A test asserts the Privacy page renders `CLIPBOARD_HISTORY_PRIVACY_LINE` exactly when
  `clipboard_history` is `session` or `keep`, and not when `off` (`privacy_line_follows_mode`).
- A test asserts changing *Keep at most* rewrites only that line of a fixture `config.toml`
  (`clipboard_row_writes_one_line`).
- *Remove after* is disabled with its reason unless `keep` (`days_row_disabled_unless_keep`).

**Tests.** As above. Gates: `pnpm precheck`, `pnpm check`.

**Do not.** Retype the Privacy sentence. Add option B's rows (J-14).

---

### J-11 — The workbench

**Model:** opus · **Size:** L · **Depends on:** J-03, J-06, W-21, E-13, E-16, J-09 · **Parallel with:** nothing on `apps/desktop/src/clipboard/`

**Outcome.** The right pane of the Clipboard view: an input (history item, the clipboard on the
reader's choice, the selection, the document), an ordered list of steps from J-03's library, and the
output as Before, After or Diff, with Copy, Copy as, *As input* and *Open as scratch document*, as in
[studio/workbench.md](studio/workbench.md).

**Why now.** W-21 runs one transform; the workbench chains them and is where a pipeline is made.

**Paths.**
- New: `packages/core/src/clipboard/chain.ts`, `chain.test.ts` (running a chain: per-step outputs,
  errors keep input, skips, the empty and no-change flags), `apps/desktop/src/clipboard/workbench.ts`,
  `workbench.test.ts`, `apps/desktop/test/clipboard-workbench.test.mjs` (WebKit).
- Edit: `apps/desktop/src/clipboard/view.ts` (mount the pane), `apps/desktop/src/commands/clipboard-history.ts`
  (*Open in the workbench*, the palette entries), W-21's result sheet file (*Open in the workbench*),
  `scripts/registry.json`.

**Build order.** `chain.ts` first, pure and tested; then the input with its source chip (the
clipboard read only on that choice); the step list with the picker reusing the palette's transform list
and preview; the output views with E-16's diff; Copy through `writeCopy` with `origin: 'workbench'`.

**Acceptance.**
- `chain.test.ts`: `runs_in_order`, `failing_step_keeps_input`, `skipped_step_passes_through`,
  `flags_empty_and_no_change`, `per_step_outputs`.
- `workbench.test.ts`: `clipboard_read_only_on_choice`, `clipboard_input_refuses_concealed_transient_autogenerated`, `copy_records_workbench_origin`,
  `over_1mb_runs_nothing`, `never_writes_a_document` (the shell's file log holds no write after every
  action), `as_input_keeps_steps`.
- `clipboard-workbench.test.mjs` (WebKit, alone): add, reorder (`⌥↑` `⌥↓`), skip and remove steps by
  keyboard; `⌘↵` copies.

**Tests.** As above. Gates: `pnpm precheck`, `pnpm check`, `pnpm gate:fidelity` (the transforms).

**Do not.** Write a document, or offer *Write back*. Add the Rendered view, Compare or *Send to*
targets beyond the four. Bind `⌘E`, `⌘D`, `⌘R` or `⌘1` to `⌘4`.

---

### J-12 — Saved pipelines in `config.toml`

**Model:** sonnet · **Size:** M · **Depends on:** J-11, W-19 · **Parallel with:** nothing on `packages/theme/src/config.ts`

**Outcome.** `[[pipeline]]` tables are parsed from `config.toml`; *Save as pipeline…* appends one,
byte-faithfully; each pipeline is a palette command and, with a `key`, an in-app key; run on a
selection through the result sheet, or on the clipboard with Undo, as
[studio/workbench.md](studio/workbench.md#saved-pipelines) specifies.

**Why now.** A chain worth keeping is the reader's tool (ADR-0049): configuration they own.

**Paths.**
- Edit: `packages/theme/src/config.ts` and `config.test.ts` (parse and `appendPipeline`),
  `apps/desktop/src/theme/app-config.ts` and `apps/desktop/src/theme/reader-config.ts` (pipelines reach
  the app),
  `apps/desktop/src/clipboard/workbench.ts` (*Save as pipeline…*, *Load*),
  `docs/design/11-config-and-storage.md` (the `[[pipeline]]` section).
- New: `apps/desktop/src/commands/pipelines.ts`, `pipelines.test.ts`.

**Build order.** Parse with the warnings listed in the spec; `appendPipeline(bytes, p)` writing one
table at the end with the file's own line ending; register `Run pipeline: <name>` commands; check each
`key` against W-19's registry.

**Acceptance.**
- `config.test.ts`: `pipeline_parsed`, `unknown_step_skips_pipeline`, `duplicate_name_dropped`,
  `over_64_dropped`, `taken_key_ignored`, `append_preserves_every_byte` (a fixture with comments,
  CRLF endings and tables).
- `pipelines.test.ts`: `runs_on_selection_as_one_splice`, `runs_on_clipboard_only_on_command`,
  `refuses_concealed_transient_autogenerated_clipboard`,
  `undo_restores_previous_clipboard`.

**Tests.** As above. Gates: `pnpm precheck`, `pnpm check`, `pnpm gate:fidelity`.

**Do not.** Register a global key, a Services entry or a Shortcuts intent. Rewrite or reformat any
existing line of `config.toml`. Run a pipeline on launch, on a timer or on a copy.

---

### J-13 — Collect in Marxy (held)

**Model:** sonnet · **Size:** M · **Depends on:** the author lifting 06 row 5; J-08, J-09

**Outcome.** [studio/collect.md](studio/collect.md): a mode started from the palette or the history
menu in which each copy in Marxy appends a piece and the clipboard holds the joined pieces; the pill
while it is on; the review sheet; *Stop* records one joined item.

**Paths.** New: `apps/desktop/src/clipboard/collect.ts`, `collect.test.ts`; Edit:
`apps/desktop/src/clipboard/write.ts`, `apps/desktop/src/commands/clipboard-history.ts`,
`scripts/registry.json`.

**Acceptance.** `collect.test.ts`: `each_copy_appends_and_writes_joined`, `stop_records_one_item`,
`stack_never_written_to_disk`, `full_stack_refuses_next_copy`, `pill_shown_only_while_collecting`.

**Do not.** Watch pastes, paste in sequence, collect from other apps, or keep the stack past a quit.

---

### J-14 — Opt-in watching of other apps' copies (held)

**Model:** opus · **Size:** L · **Depends on:** the author choosing ADR-0066 option B, and an
amendment to ADR-0065 item 3; J-01, J-08, J-10

**Outcome.** ADR-0066 option B as designed there and in [studio/rules.md](studio/rules.md#option-b-watching):
`clipboard_watch` (off) and `clipboard_never_from`; a native watcher reading `changeCount` every
500 ms only while Marxy runs and the switch is on; types before data; the never-recorded list; the
second Privacy line; the macOS refusal path that turns the switch off.

**Paths.** New: `apps/desktop/src-tauri/src/pasteboard/watch.rs` (with the fake's tests); Edit:
`apps/desktop/src-tauri/src/pasteboard/mod.rs`, `apps/desktop/src-tauri/src/main.rs`,
`packages/shell-api/src/index.ts` (an event, by ADR), `packages/theme/src/config.ts`, the J-10
settings files, `docs/design/06-shell.md`.

**Acceptance.** Through the fake pasteboard: `concealed_never_read`, `transient_and_autogenerated_skipped`,
`excluded_app_skipped`, `watch_off_reads_nothing`, `denied_read_turns_switch_off`; a live macOS check,
`#[ignore]`d in CI, quoted in the PR with the macOS version and whether the system alert appeared.

**Do not.** Watch while the switch is off or Marxy is quit. Read data before types. Record images or
file references.
