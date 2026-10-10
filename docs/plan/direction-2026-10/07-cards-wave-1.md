# Cards: the direction's first wave

**Date:** 2026-10-10 · **For:** the implementors the lead dispatches beside Phase D · **Read with:**
`../roadmap-2026-10/00-orchestration.md` §3 to §5, [05-plan.md](05-plan.md), [06-reconciliation.md](06-reconciliation.md)

**In short.** Seven cards, written from the table rows in `05-plan.md` in the shape of
`../roadmap-2026-10/04-phase-d.md`: three decision records (H-01, K-01, K-02), the native pasteboard
(J-01), the clipboard studio's design (J-D1), and two `collection.toml` parsers (Q-01, P-02). None
depends on Phase D, and none touches a Phase D path. Where `mock-v2/` and documents 01 to 04
disagree, 06 says which wins; these cards follow 06.

## Shared rules for every card

- One story, one branch (`type/<id>-slug`, for example `docs/h-01-token-contract-v2`), one worktree
  under `../marxy-wt/<ID>`, one PR against `main`. A Conventional Commits subject ending `(<ID>)`. No
  attribution lines.
- Every story adds `changelog.d/<ID>.md` (one reader-facing line ending `(<ID>)`), unless nothing a
  reader or developer can see changed, in which case the PR says so.
- Do not edit a path outside the card. If a needed change lives elsewhere, stop and report.
- New data attributes, marks and events go into `scripts/registry.json` before any code uses them.
- **A decision record's acceptance is half mechanical, half review.** The mechanical half is a named
  test or gate that fails without the change. The review half is the list under *The record answers*,
  which the reviewer checks line by line; a record that leaves one unanswered is returned.
- Tests run serially and targeted: one file at a time, never the full WebKit suite, never in
  parallel with other runs. The machine's load has reached 100 when agents did otherwise.
- The settled rulings are not reopened: `⌘K` palette with `⌘P` alias, `/` content search, `⌘E`
  the Read/Source toggle, a Transform button and no Extract button, Night (dark) and Paper (light)
  as the defaults, no collect stack, no model, session or tag metadata, no telemetry, state in plain
  files.

## Waves

| Wave | Cards | Why |
| --- | --- | --- |
| now | H-01, K-01, K-02 (Opus); Q-01, P-02 (Sonnet); J-01 (Opus); J-D1 (Opus) | No Phase D dependency. The ADRs are small and unblock H-02, H-03, K-03, K-04 |
| — | Q-01 and P-02 both add a required field to `Collection` in `collection.ts` | They touch the same lines (`TOP_KEYS`, the `Collection` interface, `EMPTY`, the unparseable early return, the final `return`) and the same two desktop lines (`apps/desktop/src/collection/load.ts:38`, `load.test.ts:63`) and C-03's `deepEqual` cases in `collection.test.ts` (`:81`, `:87`). Git reports textual conflicts; each is one added field, so the second to merge resolves by keeping both. Both cards own those lines |

Models follow 00 §1: Opus for decisions, contracts and native code; Sonnet for the two parsers, which
have a complete precedent in C-03.

---

### H-01 — Write ADR-0059, the token contract v2, and reserve its names

**Model:** opus · **Size:** S · **Depends on:** nothing · **Parallel with:** K-01, K-02, Q-01, P-02, J-01, J-D1

**Outcome.** ADR-0059 fixes the names, units and meanings of the `--marxy-*` roles that contract v2
adds, so H-02 (the contrast gate), H-03 (the tokens) and H-04 (Night and Paper) can be built without
another decision. The kind scope's data attribute is reserved in the registry.

**Why now.** ADR-0031: a token's name, unit and meaning change only by ADR. H-02, H-03, K-05 and
K-19 all wait on this record (`05-plan.md`, Phase H).

**Paths.**
- New: `docs/adr/0059-token-contract-v2.md`.
- Edit: `docs/adr/README.md` (replace the reserved `0059` row with a linked one), `docs/adr/0008-themes-are-declarative-documents.md`
  and `docs/adr/0031-token-values-are-taste.md` (one "Amended by ADR-0059" line each in the header),
  `docs/theme-contract.md` (a section listing the v2 roles as *decided, not yet shipped*, pointing at
  H-03), `scripts/registry.json` (`dataAttributes`: `data-marxy-kind`, `data-marxy-lang`),
  `scripts/check-registry.test.mjs` (one case).
- Read: `docs/plan/direction-2026-10/03-kinds-and-the-look.md` §Token contract v2 and §Themes can
  restyle any kind; `mock-v2/shared/app.css`, `mock-v2/07-themes.md`, `mock-v2/TYPOGRAPHY.md`;
  `packages/theme/src/tokens.css`, `packages/theme/tokens.contract.json`, `scripts/check-tokens.mjs`
  (its kinds `length|number|colour|family|ratio|keyword`); ADR-0030 (`0030-grid-unit-is-half-a-line.md`, the line box), ADR-0055 (the
  find edge, a recent token ADR to imitate).

**Build order.**
1. Take 03's mapping table as the starting list. Decide what it leaves open: the three accent
   siblings (03 says "three new siblings" for `--accent-strong`, `--accent-fg`, `--accent-wash`);
   the status set (`ok`, `warn`, `err`, `info`, each with a wash, or fewer); whether
   `--marxy-face-article` exists beside `-serif`, `-sans`, `-readme`, `-mono` (mock-v2 has five
   reading faces: book, article, sans, readme, code; 03's table has four); `--marxy-face-chrome`
   and `--marxy-size-chrome`.
2. For each new token: name, kind (one of `check-tokens.mjs`'s), unit, meaning in one line, and the
   v1 token it falls back to when a v1 theme does not set it (a v1 theme must keep rendering).
3. The kind scope: `data-marxy-kind="<kind>"` on the pane root (K-05 sets it); inside it a theme sets
   the same `--marxy-*` tokens, with no `--k-*` family (03, last row). Say which tokens a theme may
   set per kind and which it may not (the line box and grid stay global: ADR-0030, `0030-grid-unit-is-half-a-line.md`), and that the
   validator clamps per-kind values (H-03).
4. `data-marxy-lang` for per-language colour (K-19), reserved now so the registry is touched once.
5. The contract version: v1 themes still load, with what warning (ADR-0008's versioning).
6. Write the record in the house shape (Status `proposed`; Context, Decision numbered, Consequences,
   Rejected, How we would know this was wrong), then the index row and the two "Amended by" lines.
7. Registry entries and one `check-registry.test.mjs` case that a source file using
   `data-marxy-kind` passes.

**Acceptance.**
- `scripts/registry.json` lists `data-marxy-kind` and `data-marxy-lang`; the new case in
  `scripts/check-registry.test.mjs` fails with the entries removed.
- `docs/adr/README.md` links `0059-token-contract-v2.md`; ADR-0008 and ADR-0031 name it.
- `pnpm check` 8/8 (`check-tokens` unchanged: no token is added to `tokens.css` here).
- *The record answers* (review): every new name with kind, unit, meaning and v1 fallback; the three
  accent siblings named; the face roles decided, including article; the chrome face and size; which
  tokens are per-kind and which are global; the contract version and v1 behaviour; why there is no
  `--k-*` family; contrast floors each colour role must meet (so H-02 can gate them: text 4.5:1,
  large text and edges 3:1, per `docs/research/reader-typography/`).

**Tests.** `scripts/check-registry.test.mjs`. Gates: `pnpm check`, `pnpm precheck`.

**Do not.** Add tokens to `tokens.css` or `tokens.contract.json` (H-03). Change a v1 token's name,
unit or meaning. Copy mock-only layout names (`--win`, `--side`, `--side-w`, `--tb-h`, `--sb-h`).
Set values (taste, H-04).

**Risks.** The registry has no token list (only `tokenPrefix`), so tokens are reserved by the record
itself, not by a machine; H-03's `check-tokens` change is where they become enforced.

---

### K-01 — Write ADR-0060: kinds

**Model:** opus · **Size:** S · **Depends on:** nothing · **Parallel with:** H-01, K-02, Q-01, P-02, J-01, J-D1

**Outcome.** ADR-0060 says what a kind is, names the fourteen kinds of v1, how a file's kind is
detected (and what is never a signal), how a reader overrides it, and how kind relates to the two
modes. A `KINDS` constant in core's contracts holds the names, tested against the record, so K-03
detects into a closed set.

**Why now.** ADR-0005 says "Markdown opens Rendered; anything else opens Source." Every K story after
this one needs that line amended. Detection today is `defaultModeForPath` in
`apps/desktop/src/source/default-mode.ts:16` (`RENDERED_EXT` = `.md .markdown .mdx .txt`).

**Paths.**
- New: `docs/adr/0060-kinds.md`, `packages/core/src/contracts/kinds.ts`,
  `packages/core/src/contracts/kinds.test.ts`.
- Edit: `docs/adr/README.md` (the reserved row), `docs/adr/0005-two-modes.md` (an "Amended by
  ADR-0060" header line). There is no contracts barrel; importers name `contracts/kinds.ts` directly.
- Read: `06-reconciliation.md` rows 7 and 8; `03-kinds-and-the-look.md` §Kinds, §Detection,
  §Profiles; `mock-v2/03-content-modes.md`; `docs/research/reader-artifacts/10-spec.md`.

**Build order.**
1. The set: `article` (the default, replacing `prose`), `report`, `book`, `readme`, `docs`, `code`,
   `transcript`, `data`, `notes`, `changelog`, `log`, `terminal`, plus `diff` and `html` (06 row 7).
   Verse, slides and drama are later and not in the set.
2. Detection order: a reader rule (`[[kind]]` in `config.toml`, first match wins; K-04 builds it),
   then bytes and name (extension, file name, shebang), then shape (JSONL with role objects, speaker
   headings, a report's working headings), then a byline (`author` with `published` or `source`) may
   point to `article` (06 row 8), then `article`. Reasons are kept for the chip and inspector.
3. **Never a signal:** `model`, `session`, `generated_by`, or any field naming a tool or who wrote
   the file. State it as a rule a test can hold (K-03's goldens).
4. Kind and mode: a kind has a default mode (Rendered or Source); the reader's `read = true` and
   *show as* override it; `⌘E` still toggles. Which kinds open in Rendered by default today and which
   wait for their K story (a kind with no profile yet reads as today).
5. Where a per-file choice lives (Marxy's own data files, like positions) versus a folder rule (the
   reader's `config.toml`).
6. `kinds.ts`: `export const KINDS = [...] as const; export type Kind = typeof KINDS[number];` and
   `DEFAULT_KIND = 'article'`. `kinds.test.ts` reads `docs/adr/0060-kinds.md` and asserts its kind table lists
   exactly `KINDS`, in order.

**Acceptance.**
- `KINDS` has the fourteen names; `kinds.test.ts` fails if a name is added to or dropped from either
  the record's table or the constant.
- `docs/adr/README.md` links the record; ADR-0005 names it.
- `pnpm check` and `pnpm precheck` green (`check-boundaries`: core's new file imports nothing).
- *The record answers* (review): the fourteen kinds, each with one line on how it is read; the
  detection order; the never-a-signal rule; the byline rule and why it is not authorship; kind versus
  mode; where per-file and per-folder choices live; what happens to a kind with no profile yet.

**Tests.** `packages/core/src/contracts/kinds.test.ts`. Gates: `pnpm check`, `pnpm precheck`.

**Do not.** Write detection code (K-03) or `[[kind]]` parsing (K-04). Change `default-mode.ts`.
Add a kind beyond the fourteen.

**Risks.** `kinds.test.ts` reading a Markdown file from core's test is a new pattern; keep the
parse to one table and fail with a clear message if the table moves.

---

### K-02 — Write ADR-0061: derived views

**Model:** opus · **Size:** M · **Depends on:** nothing · **Parallel with:** H-01, K-01, Q-01, P-02, J-01, J-D1

**Outcome.** ADR-0061 decides how a view can show structure whose text is not a substring of the
buffer (a JSONL transcript's turns) while every node still carries byte provenance to the lines it
came from, so K-12 can build the JSONL transcript view without breaking ADR-0003.

**Why now.** Research proposal P10 (`docs/research/reader-artifacts/proposals/P10-derived-transcript-view.md`)
calls this the most invasive change in the handbook and says it is blocked by the AST contract.
ADR-0003 ("One buffer, one AST with byte provenance") and `AST_INVARIANTS` in
`packages/core/src/contracts/ast.ts` (header comment lines 5 to 8; the invariants near line 70) are
what it amends.

**Paths.**
- New: `docs/adr/0061-derived-views.md`.
- Edit: `docs/adr/README.md` (the reserved row), `docs/adr/0003-one-buffer-one-ast.md` (an "Amended by
  ADR-0061" header line), `docs/research/reader-artifacts/proposals/P10-derived-transcript-view.md`
  (its status line: decided by ADR-0061), and the research coverage ledger if P10's status is tracked
  there (`docs/research/reader-artifacts/coverage.json`, entry `proposal.P10`; run `node docs/research/reader-artifacts/tools/check.mjs`).
- Read: P10 in full; ADR-0003, ADR-0004 (editing is transformation), ADR-0045 (contracts by PR);
  `packages/core/src/contracts/ast.ts`; `docs/plan/direction-2026-10/04-capture.md` (reading AI
  sessions in place); `mock-v2/03-content-modes.md` (transcript).

**Build order.**
1. Name the problem in bytes: a JSONL line holds a JSON string; the reader wants the decoded text.
   The decoded text is not a substring, so a text node's `value` cannot equal `buffer[start, end)`.
2. Decide the shape: a derived node (or derived tree) whose provenance is the whole source line (or
   the JSON value's byte range), whose displayed text is a pure function of those bytes, and which is
   never edited in place. Say how selection and Copy behave over it (copy the derived text? the source
   line? both, as two representations?), how *Jump to source* lands, and how the fidelity property
   (`pnpm gate:fidelity`) still holds for everything that is not derived.
3. Decide where it lives: a separate tree beside the AST, or nodes in it with a `derived` mark.
   Weigh both against `AST_INVARIANTS` and the goldens.
4. Operations: transformations (ADR-0004) never take a derived range as input; say what the verb
   menu offers on one.
5. Commitment 4 (nothing hidden silently): a derived view marks that it is derived, with Source one
   action away.
6. Write the record; the index row; the ADR-0003 and P10 lines.

**Acceptance.**
- `docs/adr/README.md` links the record; ADR-0003 and P10 name it. The coverage check
  (`node docs/research/reader-artifacts/tools/check.mjs`) only catches a ledger mismatch; it passes without the
  record and is not proof of it. The record itself is judged by the review list below.
- `pnpm check` green.
- *The record answers* (review): what a derived node is, its provenance, and the invariant that
  replaces `value === bytes` for it; separate tree or marked nodes, and why; selection, Copy and Jump
  to source over derived text; why no operation edits it; how Rendered marks it as derived; what
  `AST_INVARIANTS` and the goldens gain; how we would know it was wrong (P10's falsifier: readers
  prefer Source for transcripts).

**Tests.** None new beyond the coverage check. Gates: `pnpm check`.

**Do not.** Edit `packages/core/src/contracts/ast.ts` (K-12 adds the types the record decides). Build
any transcript view.

**Risks.** Decoding JSON strings can produce bidi or zero-width characters that the raw line shows
escaped; the record must say they stay visible (commitment 4).

---

### J-01 — The native pasteboard in Rust

**Model:** opus · **Size:** M · **Depends on:** nothing · **Parallel with:** H-01, K-01, K-02, Q-01, P-02, J-D1

**Outcome.** Three Tauri commands on macOS read the pasteboard's types, read chosen representations,
and write several representations as one item tagged with Marxy as its source. Nothing watches the
pasteboard; nothing calls the read commands yet (J-02 wires them into `shell-api`). Today's
`clipboard_write` keeps working unchanged.

**Why now.** ADR-0065 items 2, 3 and 5: one copy is one item with every representation, tagged
`org.nspasteboard.source`, Marxy's temporary writes marked `org.nspasteboard.TransientType`; reads only
on a reader action, types first, concealed items refused. `tauri-plugin-clipboard-manager` cannot list
types, read HTML or tag the source. Today: `clipboard_write` at `apps/desktop/src-tauri/src/main.rs:66-81`
(`write_text` or `write_html`), registered at `:1131`; the plugin at `:1093`; unit tests near `:1182`.

**Paths.**
- New: `apps/desktop/src-tauri/src/pasteboard/mod.rs` (types, the `Pasteboard` trait, the commands'
  logic), `apps/desktop/src-tauri/src/pasteboard/macos.rs` (NSPasteboard through `objc2` and
  `objc2-app-kit`), `apps/desktop/src-tauri/src/pasteboard/fake.rs` (an in-memory pasteboard for tests,
  `#[cfg(test)]`).
- Edit: `apps/desktop/src-tauri/src/main.rs` (`mod pasteboard;`, register the three commands; the commands
  live in `pasteboard/mod.rs`, as `clipboard_write` lives in `main.rs` today, not under `commands/`: fix the stale
  line in `docs/design/06-shell.md` that says every command lives under `commands/`),
  `apps/desktop/src-tauri/Cargo.toml` and `Cargo.lock` (`objc2` 0.6.4, `objc2-app-kit` 0.3.2 and the matching
  `objc2-foundation`, the versions already in the lock, under a new `[target.'cfg(target_os = "macos")'.dependencies]`), `apps/desktop/src-tauri/capabilities/default.json`
  only if Tauri requires a permission entry for app commands (it does not by default; check
  `build.rs`), `docs/design/06-shell.md` (Commands table: three rows).
- **Code-owned:** `capabilities/` is owned by the author (`.github/CODEOWNERS`); if the story touches
  it, the author merges. Say so in the PR.

**Build order.**
1. `pasteboard/mod.rs`: `trait Pasteboard { fn types(&self) -> Vec<String>; fn read(&self, ty: &str) ->
   Option<Vec<u8>>; fn write_item(&mut self, reps: &[(String, Vec<u8>)]) -> Result<(), Error>; }`,
   and the pure logic on top: `read_types`, `read_reps(wanted)`, `write_reps(reps, transient)`.
2. `read_types` returns the types of the first item. If they include `org.nspasteboard.ConcealedType`,
   `read_reps` returns `Err(Concealed)` and reads no data (the fake counts data reads). `read_reps`
   reads only the requested types, in the order text (`public.utf8-plain-text`), HTML (`public.html`),
   RTF (`public.rtf`), URL (`public.url`), PNG image (`public.png`), each capped (say 16 MB; return
   `TooLarge` past it).
3. `write_reps` clears the pasteboard once and writes one `NSPasteboardItem` holding every
   representation plus `org.nspasteboard.source` = Marxy's bundle id, and
   `org.nspasteboard.TransientType` when `transient`.
4. `macos.rs` implements the trait over `NSPasteboard::generalPasteboard()`; all calls on the main
   thread (Tauri's `run_on_main_thread` or the command's main-thread attribute).
5. Only `macos.rs` is `cfg(target_os = "macos")`; the trait, the types, the logic and the fake compile everywhere,
   so `cargo clippy -D warnings` on the Linux job finds no dead code.
6. Commands: `pasteboard_types() -> Vec<String>`, `pasteboard_read(types: Vec<String>) -> PasteboardRead`
   (base64 for binary types), `pasteboard_write(reps, transient: bool)`. On other platforms they return
   a clear `Unsupported` error (Linux keeps the plugin path; ADR-0046 ships macOS).
7. Leave `clipboard_write` and the plugin as they are.

**Acceptance.**
- Through the fake: a write of plain + HTML + RTF is one item holding all three plus the source type
  (`pasteboard::tests::one_item_every_rep`); with `transient` it also holds `TransientType`
  (`::transient_marked`); a concealed item's read returns `Concealed` with zero data reads
  (`::concealed_refused_unread`); `read_reps` reads only requested types (`::reads_only_requested`);
  an over-cap representation returns `TooLarge` (`::cap`). Each test fails with its branch removed.
- `cargo clippy -- -D warnings` and `cargo test` green in `apps/desktop/src-tauri`.
- A live check on macOS, `#[ignore]`d in CI: `cargo test -- --ignored pasteboard_live` writes plain +
  HTML, reads both back exactly, and reads the source type. Its output is quoted in the PR.
- `docs/design/06-shell.md` lists the three commands.

**Tests.** The five fake tests and the ignored live test in `pasteboard/`. Gates: `cargo test`,
`cargo clippy`, `pnpm precheck` (it routes `src-tauri` to the `rust` job), `pnpm check` (`check-deps`
for the new crates' licences).

**Do not.** Poll or observe `changeCount`. Read the clipboard from any code path other than the read
command. Remove or change `clipboard_write`. Edit `packages/shell-api` (J-02). Add a clipboard history.

**Risks.** `objc2` crate versions must match what `tauri`'s own macOS stack pulls in, or the build
doubles them; check `Cargo.lock`. macOS 15.4+ shows a pasteboard privacy alert on programmatic reads
from another app; record what the live check shows, since J-05's paste flow depends on it.

---

### J-D1 — Design the clipboard studio to a buildable spec (design, not code)

**Model:** opus · **Size:** L · **Depends on:** nothing · **Parallel with:** everything (documents only)

**Outcome.** A specification of the clipboard studio that an implementor can build from, in the
mock-v2 style (Markdown pages, with HTML pages that reuse `mock-v2/shared/`), plus a drafted ADR for
clipboard history's privacy, plus the studio's build stories written as cards. The author rules on
the ADR; nothing is built from this story.

**Why now.** ADR-0065 item 6: history, pipelines saved to keys, compare, snippets, the ring and the
collect stack are not built from `mock-v2/06-clipboard.html`; the author ruled the page insufficient as
a design. 06 row 5 keeps the collect stack dropped until this design.

**Paths.**
- New: `docs/plan/direction-2026-10/studio/` (`README.md` first; one page per surface; HTML pages
  using `../mock-v2/shared/`), `docs/adr/0066-clipboard-history.md` (status `proposed`),
  `docs/plan/direction-2026-10/08-cards-studio.md` (the build cards).
- Edit: `docs/adr/README.md` (one row, 0066), `docs/plan/direction-2026-10/05-plan.md` (Phase J: the
  build stories J-07 onward as table rows, pointing at 08), `docs/plan/direction-2026-10/README.md`
  (the documents table).
- Read: `mock-v2/06-clipboard.md` and `.html` (reference); ADR-0065; ADR-0044; ADR-0063 (a standing
  rule's privacy line, the pattern to follow); commitment 2 and 3 in `AGENTS.md`; J-01's card above.

**Build order.**
1. Inventory the mock's surfaces (history, the workbench, compare, the side panel's Copy as,
   Pipelines, Stack and Snippets tabs, clipboard rules, the transform catalogue, the ring, collect)
   and, for each, decide: build, change, or leave. Say why in a line.
2. **History first, because it decides the rest.** The mock polls `changeCount` twice a second, which
   ADR-0065 item 3 forbids ("nothing watches the pasteboard"). Design at least two options: (a) history
   of Marxy's own copies only, recorded when Marxy writes, no watching; (b) opt-in watching of every
   app's copies, off by default, with what the Privacy page says, what is never recorded (concealed,
   transient, auto-generated types; secret patterns), retention, and where it is stored (plain files
   in Marxy's data directory, commitment 3: no SQLite). Draft ADR-0066 choosing one, with the other
   rejected or deferred, for the author to rule.
3. For each surface you keep: entry points (key, palette command, toolbar), states (empty, normal,
   large, error), the keyboard model, what it reads and writes, and what it may never do. Match the
   settled keys (no new key that collides with `⌘K`, `⌘P`, `⌘E`, `⌘/`, `/`).
4. The ring (`⌥⌘V`, a non-activating panel) and optional synthesized `⌘V` need Accessibility
   permission: say whether v1 builds them, and what the reader sees if permission is refused.
5. Write the build cards in `08-cards-studio.md` in this document's shape (goal, paths, steps,
   acceptance tied to tests, do not), ordered, each naming its model and size.
6. Add the rows to 05 and the README.

**Acceptance.**
- Every relative link in the new pages resolves: a short Node script (kept in your scratchpad) walks each
  new `.md` and `.html` file and resolves every relative `href`/`src` and Markdown link; its output, zero
  unresolved, is quoted in the PR.
- The new HTML pages load nothing remote: no Google Fonts and no unpkg (the `mock-v2/shared/` pages do;
  the studio's pages use system faces and inline SVG, or link `mock-v2/shared/app.css` without its remote
  imports). `grep -En 'https?://' studio/*.html` lists only sample text, quoted in the PR.
- *The spec answers* (review): every mock surface with a build/change/leave verdict; history's options
  and the ADR's choice, with the Privacy page line verbatim; nothing that reads the clipboard without
  a reader action unless ADR-0066 (pending the author) allows it; no SQLite, no telemetry, no
  model/session/tag metadata; keys checked against the rulings; each build card has paths, tests and
  a model.

**Do not.** Write product code. Mark ADR-0066 accepted. Reintroduce the collect stack as decided
(design it, and leave the decision to the author). Change the clipboard rulings in 06.

**Risks.** The design can grow without bound; cap it at what v0.7.0's milestone can carry and list
the rest as later.

---

### Q-01 — Saved queries in `collection.toml`, parsed in core and appended byte-faithfully

**Model:** sonnet · **Size:** S · **Depends on:** nothing · **Parallel with:** P-02 (append-only overlap in `collection.ts`)

**Outcome.** A reader's saved queries (the sidebar's Smart collections, 06 row 12) are declared state in
`collection.toml` as `[[query]]` tables. Core parses them with warnings for anything malformed, and can
append one without changing any other byte, the way `appendRoot` appends a folder.

**Why now.** ADR-0062 item 4: saved queries live in `collection.toml`, appended byte-faithfully. Q-02
(the query language), Q-03 (the library view) and Q-07 (the sidebar) build on it. The precedent is
C-03: `packages/core/src/index-model/collection.ts` (`parseCollection` `:69`, `appendRoot` `:158`,
`TOP_KEYS` = `root`, `deny`).

**Format.**

```toml
[[query]]
name = "Open plans"
q = "kind:report has:tasks in:~/.claude/plans"
description = "Plans with open tasks"   # optional
```

`q` is stored as the reader wrote it; Q-02 parses it. Built-in smart collections (near-duplicates,
broken paths) are code, not rows, and are never written here.

**Paths.**
- Edit: `packages/core/src/index-model/collection.ts` (`TOP_KEYS` gains `query`; `Collection` gains
  `queries: readonly SavedQuery[]`; a `QUERY_KEYS` set; `appendQuery(bytes, query, ctx)`),
  `packages/core/src/index-model/collection.test.ts` (including C-03's two `deepEqual` cases, which gain
  `queries: []`), `apps/desktop/src/collection/load.ts:38` and `load.test.ts:63` (one `queries: []` each, the
  required field's only consequence), `packages/core/src/index-model/index.ts` (appended exports),
  `docs/design/11-config-and-storage.md` (§`collection.toml`: the table), `docs/design/07-index-and-palette.md`
  only if it says saved searches are not built.
- Read: ADR-0062, ADR-0053, `mock-v2/05-collections.md` §Smart collections.

**Build order.**
1. `SavedQuery { name: string; q: string; description?: string }`. Parse each `[[query]]`: `name` and
   `q` required non-empty strings after trimming for the check (stored as written); `name` at most 80
   characters and unique (case-insensitive; a later duplicate is dropped with a warning naming it);
   `q` at most 1,000 characters; unknown keys reported in `unknownKeys` as roots' are; a `query` that is
   not an array of tables is a warning, not a throw. Cap at 200 queries (warning past it).
2. `appendQuery`: refuse an unparseable file ("edit it by hand", as `appendRoot`), refuse a duplicate
   name, keep the file's line ending, add a newline first if the file lacks a final one, write
   `[[query]]`, `name`, `q` and `description` if present, each through the existing `tomlString`; parse
   the result and check the last query is the one appended.
3. Document the table in design 11.

**Acceptance.**
- Parsing: valid queries come back in file order; a missing `name` or `q`, an over-long field, a
  duplicate name and a non-table `query` each yield a warning and no query (`collection.test.ts`,
  one case each).
- `appendQuery` keeps every input byte as a prefix of the output over the same base files C-03's tests
  use (LF, CRLF, no final newline, empty file, comments, a BOM) and the appended query parses back
  equal (`collection.test.ts`); a name with quotes, backslashes, control characters and non-ASCII
  round-trips exactly.
- An existing `collection.toml` with only `[[root]]` and `[deny]` parses exactly as before (C-03's
  tests green; their two `deepEqual` expectations gain only `queries: []`).
- `pnpm precheck` and `pnpm check` green.

**Tests.** `packages/core/src/index-model/collection.test.ts`. Gates: `pnpm precheck`, `pnpm check`.

**Do not.** Parse the query language (Q-02). Touch `apps/desktop` beyond the two lines above (the sidebar is Q-07). Store
anything but `name`, `q` and `description`. Add `model:`, `session:` or `tag:` anywhere.

**Risks.** P-02 edits the same file; keep your edits to `TOP_KEYS`, the `Collection` type, and new
functions, so a rebase is mechanical.

---

### P-02 — Capture rules in `collection.toml`: parse, validate, and the Privacy line

**Model:** sonnet · **Size:** S · **Depends on:** nothing · **Parallel with:** Q-01 (append-only overlap in `collection.ts`)

**Outcome.** A reader's `[[capture]]` rules (ADR-0063) parse in core into validated rules, with a
warning for each rule Marxy refuses and why, and the Privacy page's sentence exists as one constant
the settings page (W-12) will show. Nothing copies anything yet (P-03).

**Why now.** ADR-0063 item 1: `[[capture]] from = "<glob>" to = "<folder>"`, Marxy ships no rule;
item 6 gives the Privacy line verbatim. P-03 (the copier) needs validated rules first.

**Paths.**
- New: `packages/core/src/index-model/capture.ts`, `packages/core/src/index-model/capture.test.ts`.
- Edit: `packages/core/src/index-model/collection.ts` (`TOP_KEYS` gains `capture`; `Collection` gains
  `captures: readonly CaptureRule[]`; `parseCollection` calls `parseCaptures` from `capture.ts`),
  `packages/core/src/index-model/collection.test.ts` (one case: a file with roots and captures; C-03's two
  `deepEqual` cases gain `captures: []`), `apps/desktop/src/collection/load.ts:38` and `load.test.ts:63` (one
  `captures: []` each), `packages/core/src/index-model/index.ts` (appended exports for P-03),
  `docs/design/11-config-and-storage.md` (the table and its validation rules).
- Read: ADR-0063, `docs/plan/direction-2026-10/04-capture.md` §Capture rules, `collection.ts`'s
  `resolveRootPath` and deny handling.

**Build order.**
1. `CaptureRule { from: string; to: string; fromBase: string }`: `from` and `to` resolved for `~` the
   way roots are; `fromBase` is the first fixed folder in `from` (the part before the first glob
   character), which P-03 uses to keep relative paths (04: "keeping its path relative to the first
   fixed folder").
2. Refuse, with a warning naming the rule: a missing or non-string `from` or `to`; a relative path; a
   `from` with no fixed folder (`**/*.md`); a `to` that is `/` or the home folder itself; a `to` inside
   `fromBase` or a `fromBase` inside `to` (a loop); a `to` inside Marxy's own config or data folder
   (the C-14 rule; take the folders as an optional `ownFolders` on `parseCollection`'s context, default `[]`, so
   no caller changes; wiring the desktop loader to pass them is P-03's); a `to` matching
   a deny glob. Unknown keys go to `unknownKeys`. Cap at 32 rules.
3. `export const CAPTURE_PRIVACY_LINE = "Marxy copies files matching your capture rules from \`from\` to \`to\` on this disk, while it is running."`
   (ADR-0063 item 6, verbatim), and `capturePrivacyLines(rules)` that fills in each rule's paths for
   the page.
4. Document it in design 11.

**Acceptance.**
- Two valid rules parse in order with the right `fromBase` (`capture.test.ts`).
- Each refusal in step 2 yields a warning naming the rule and no rule (`capture.test.ts`, one case
  each; each fails if its check is removed).
- `CAPTURE_PRIVACY_LINE` equals ADR-0063's sentence; the test reads the ADR, joins its wrapped lines
  (whitespace runs to one space) and compares, backticks included, so the two cannot drift.
- A `collection.toml` without `[[capture]]` parses exactly as before (C-03's tests green; their `deepEqual`
  expectations gain only `captures: []`), and one with roots and captures yields both (`collection.test.ts`).
- `pnpm precheck` and `pnpm check` green.

**Tests.** `capture.test.ts`, `collection.test.ts`. Gates: `pnpm precheck`, `pnpm check`.

**Do not.** Copy, watch or write any file (P-03). Add a rule to any template or default. Add an
`appendCapture` (the reader writes rules by hand until a story asks otherwise). Touch `apps/desktop` beyond the two
lines above.

**Risks.** Q-01 edits the same file; keep edits to `TOP_KEYS`, the `Collection` type and one call,
so a rebase is mechanical.

---

## Added 2026-10-10, after the first merges

### Q-02 — The query language in core: tokens, completion, unknown keys as text

**Model:** sonnet · **Size:** M · **Depends on:** Q-01 (merged) · **Parallel with:** anything outside `packages/core/src/index-model/`

**Outcome.** One parser in core turns what a reader types in the library's query field (and, later, a saved
query's `q`) into a typed query: field terms, plain words, phrases, exclusions, `OR` groups and any-of values,
with each token's byte range in the input so the field can draw chips. Unknown keys and incomplete values are
kept as text and flagged, never dropped and never an error. A completion function suggests keys and values at a
caret. Nothing evaluates a query yet (Q-03).

**Why now.** ADR-0062 item 3; Q-03 (the library view), Q-07 (the sidebar's smart collections) and the palette's
`@` sections (W-13) all read queries. The grammar is the mock's (`mock-v2/05-collections.md` §Query syntax),
which wins over ADR-0062's shorter key list per 06; ADR-0062's exclusions hold.

**Grammar.** Plain words search text; tokens combine with AND; `OR` (upper case) separates alternatives; a
leading `-` excludes; commas inside a value mean any of; `"…"` is a phrase. Keys: `kind:`, `is:`, `has:`,
`modified:`, `words:`, `tasks:`, `size:`, `path:`, `in:`. Values: `is:` takes `unread`, `read`, `changed`,
`pinned`, `dup`, `broken`, `archived`, `recent`, `error`, `captured`; `has:` takes `code`, `paths`, `links`,
`tasks`; `modified:` takes `today`, `yesterday`, or a comparison with a unit (`min`/`m`, `h`, `d`, `w`, `mo`, `y`);
`words:`, `tasks:` and `size:` take comparisons (`>`, `<`, `>=`, `<=`, bare) with `k`, `kb`, `mb`.

**Paths.**
- New: `packages/core/src/index-model/query.ts`, `packages/core/src/index-model/query.test.ts`.
- Edit: `packages/core/src/index-model/index.ts` (appended exports), `docs/design/07-index-and-palette.md`
  (a short "Query syntax" section pointing at the mock's table).

**Build order.**
1. Types: `Query = { groups: Group[] }` (OR of groups), `Group = Term[]` (AND), `Term` is
   `{ kind: 'field'; key; values: string[]; op?; negated; range }`, `{ kind: 'word' | 'phrase'; text; negated; range }`,
   or `{ kind: 'unknown' | 'incomplete'; text; range }`. `range` is `[start, end)` in UTF-16 code units of the input.
2. `parseQuery(input: string): Query` — a single left-to-right scan, no regex backtracking over the whole input;
   an unclosed quote runs to the end and is a phrase flagged incomplete; `-` alone is a word.
3. Normalise comparisons to numbers (`2k` → 2000, `1mb` → 1,048,576 bytes, `<7d` → 7 days in ms) in the
   term, keeping the written text.
4. `completeQuery(input, caret): { replace: [start, end); items: { label; insert; detail? }[] }` — keys after a
   space or at the start, values after a known key; `in:` values come from a caller-supplied list of
   collection names; `has:tasks` and `tasks:` parse but are not suggested (the mock's rule).
5. **No authorship keys.** `model:`, `session:`, `tag:`, `is:ai` and `is:live` are not keys: they parse as
   `unknown` (text), and are never suggested.

**Acceptance.**
- Every row of the mock's syntax table parses to the expected terms (`query.test.ts`, one case per row).
- `OR`, `-`, commas and quotes combine as the mock says (`is:unread OR is:changed`, `-kind:code`,
  `kind:report,transcript`, `"pg_upgrade --link"`).
- An unknown key is an `unknown` term with its text; `words:>` is `incomplete`; neither throws.
- `model:x`, `session:y`, `tag:z`, `is:ai`, `is:live` are `unknown` and never in a completion list (a test per
  name; it fails if any becomes a key).
- Every term's `range` slices the input to exactly the token's text (a property test over random inputs:
  ranges are in order, non-overlapping, and inside the input).
- `parseQuery` never throws on any string (the same property test, 10,000 random inputs including quotes,
  dashes, colons, unicode and lone surrogates) and runs in linear time (a 100 KB input parses in under 50 ms,
  recorded, not asserted).
- `completeQuery` suggests keys at the start, values after `is:`, and collection names after `in:`.
- `pnpm precheck` and `pnpm check` green (core stays platform-free).

**Tests.** `packages/core/src/index-model/query.test.ts`. Gates: `pnpm precheck`, `pnpm check`.

**Do not.** Evaluate a query against the index (Q-03). Add a persistent full-text index (ADR-0062 item 5).
Add any key that names who or what wrote a file.

**Risks.** `OR` precedence: the mock says groups; treat `a b OR c` as `(a AND b) OR c` and say so in the doc.

## Notes for cards not yet written

- **P-03 (capture copier), from the P-02 review.** At copy time: realpath `fromBase` and `to` and re-run the loop
  and own-folder checks on the resolved paths; never follow a symlink out of `fromBase`; check each
  destination's realpath stays under `to`; skip a source resolved under `to` or an own folder; and pass
  `ownFolders` from `apps/desktop/src/collection/load.ts:67`, which does not yet. Fold `ς`/`Σ` (final sigma)
  with `.toUpperCase().toLowerCase()`; add an uppercase deny-glob test.
- **Q-01 follow-up tests.** The lone-surrogate refusal has no test and its message does not say why; no
  astral-character test at the 80/81 limit; the `last.q` post-append check survives mutation.
  `COLLECTION_TEMPLATE` still documents only `[[root]]` and `[deny]`.
- **B-25.1, pre-existing.** ```` ```mermaid&#32;x ```` gets no caption while the paragraph before it is styled as
  one; `"bash session"` in `languages.generated.ts` can never match a class.
