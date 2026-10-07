# 07 — Layout and reading: the page measured against the research (lane L)

**Date:** 2026-10-07 · **Status:** folded into the roadmap by the lead; L-00 dispatched, the rest sequenced
below · **Runs:** as its own lane beside Phase B, inside the same four-agent cap (`00-orchestration.md` §5).

Story cards follow the house shape (`02-phase-b.md`). Ids are `L-nn`. L-00 and L-01 are full cards; L-02
to L-09 are candidates that L-01 finalises in this document before the lead dispatches them.

## Context

Reading the corpus in the app, the author saw errors a ruler would catch:
- the column is badly centred;
- the left and right margins differ;
- tables sit in the wrong place relative to the margins.

None of this is gated today:
- `checkMeasure` checks the line length.
- `checkNoHorizontalPageScroll` checks for sideways scroll.
- `layout.test.mjs:70` checks centring on one synthetic page, not across the corpus.

Notices and Source mode have the same kind of gap: they were built ad hoc and never measured against the
spec.

There are two research handbooks:
- **Reader typography** (`docs/research/reader-typography/`, the authority under ADR-0033) has no record of
  which of its defaults Marxy meets.
- **Reader artifacts** has `coverage.json`, but layout is not its subject.

The aim is three things:
1. Turn "it looks wrong" into numbers a machine can fail.
2. Find each cause.
3. Hand the lead a short set of fix stories whose paths do not collide with the running B lane or with
   Phase D.

Every fix is justified by a line of `10-spec.md` (either handbook) or by `docs/design/09-app-shell.md`, or
it says why it departs from them.

## Ground rules (do not interfere with the running implementor)

- **Read from `origin/main`, not local `main`.** The main checkout at `~/Dev/marxy` lags `origin/main`.
  Each story works in its own worktree, `../marxy-wt/<id>`, branched from `origin/main`.
- **Never touch:**
  - `../marxy-wt/lead`;
  - `docs/plan/roadmap-2026-10/progress.md` or `handoff.md` (PR #349);
  - `orchestration/` (paused, `PAUSED.md`);
  - the worktrees of B-02, B-10, B-11, B-02.5 and B-09.1.
- **Collision map** (from the in-flight survey). Fix stories must respect it; the investigation itself
  (L-00 and L-01) touches none of these.

| Path | Held by | Earliest a fix may touch it |
|---|---|---|
| `scripts/gate-aesthetics.mjs`, `fixtures/baselines/**`, `docs/aesthetics-acceptance.md` | B-02 (running) | after B-02 merges, and as the only baseline change in its wave |
| `packages/theme/src/base.css` | free, but any change moves baselines | same as above |
| `apps/desktop/index.html` (inline Source and notice rules) | B-13 | after B-13 |
| `app.ts`, `save.ts`, `close.ts`, `trust/controller.ts` | B-10, B-11, then B-12 to B-15 serially | after B-15, or only at call sites with the lead's say-so |
| `apps/desktop/src/notices/*` | B-09.1 (merge verdict, #357); D-10 rewrites the call sites | after B-09.1, **before** D-10 |
| `apps/desktop/src/source/*` | D-11 rewrites `editor.ts` | before D-11, or folded into it |
| `packages/typeset/src/index.ts` | B-02.5 (in review), B-17 | after B-02.5 |

- **Do not file anything through the Jira, CSV or `out-of-plan.mjs` path.** New work goes into the plan
  as a phase-document section (`00-orchestration.md` §2 and §7).
- **Keep ledgers to a minimum.** The typography conformance table is a one-off section of the findings
  document, not a new tracked ledger with a tool.

## Hypotheses to test

Each is read off `origin/main`; L-00 confirms or kills it.

**H1. Wide blocks grow to one side only.**
- `pre` (`base.css:~300`) and `table` (`:~376`) use `max-width: calc(100% + var(--marxy-room))` and stay
  left-anchored, so wide code and tables overflow into the right margin only.
- The page's visual mass shifts right, and the left and right margins differ on every page that has a wide
  block.
- ch. 4 lets wide content "exceed the text measure (into the margin column)" but says nothing about which
  side. With a centred column and no margin notes, the asymmetry is a choice nobody made.

**H2. Blocks use different left edges.**
- Code boxes (`pre`: background plus `--marxy-half` padding) align the *box* to the column, so the code
  text sits 15 px inside the prose edge.
- Tables have no padding, so their *text* aligns to the column.
- Blockquotes (rule plus padding), the front-matter `dl`, and notices (a box plus `3rem` side padding,
  `base.css:29-37`) each add another edge.
- Images that stand alone are centred (`base.css:~443`); every other block is flush-left.

**H3. Hanging marks are wider than the gutter's floor.**
- Ordered-list markers hang 2.25 em (45 px at 20 px type), checkboxes hang 1.25 em, and the typesetter's
  hanging punctuation also hangs.
- All of these exceed the 16 px narrow gutter, and the 24 px gutter too.
- So at narrow widths the left ink edge passes the gutter or is clipped. The 320 px test only checks page
  overflow.

**H4. A classic scrollbar moves the centre.**
- The viewport scrolls. With a classic scrollbar (WebKitGTK on Linux, or macOS with "show scroll bars:
  always"), `margin-inline: auto` centres on the window minus the scrollbar.
- If the scrollbar appears *after* first text (A-02 sends the first screens, then appends the rest in idle
  chunks), the column shifts about 7 px once the paragraphs are set.
- Lines already set against the old width may then overflow, unless the resize relayout (MARXY-280) fires
  on that change.
- Only the 960 px overlay-scrollbar case is captured today.

**H5. Tables inside other blocks pass the room.**
- Inside a list item or blockquote, `100%` is the indented box, but `--marxy-room` is measured from the
  page column.
- So a nested wide table, or a nested `pre`, can run past the gutter by the indent.
- In addition:
  - `display:block` on a table puts its scrollbar at a width that ignores the gutter;
  - the trailing `padding-inline-end` on cells leaves a ragged right edge;
  - `snapToGrid` padding is untested on scrolled tables.

**H6. Notices are off the column and out of sight.**
- `#marxy-notices` has a `3rem` side padding against the article's 16/24 px gutter, so the edges differ at
  narrow widths.
- The region sits in flow above the article. A disk-changed notice that arrives while the reader is far
  down the page is never seen, and when it is it pushes the text down.
- `line-height: 1.4` at caption size is not a whole number of grid units (artifacts spec, coupling rule 2).
- In Source mode it is `position: fixed` over the text (`index.html:18`), which contradicts `09-app-shell.md`
  ("never overlapping the text").
- Five components build their own `.marxy-notice` DOM and bypass `notify()`:
  - `blocked.ts`;
  - `truncation.ts`;
  - `save.ts`;
  - `close.ts`;
  - `theme-document.ts`.

  The survey read stale `main`; recheck after B-09 and B-09.1.
- *L-00 review (2026-10-07):* the 61 px offset at 960 px is not the padding: `#marxy-notices` sizes its column
  in `em` at the browser's 16 px instead of the article's 20 px. The padding matters only at 320 px.

**H7. Source mode lacks the basics.** Confirmed on `origin/main`:
- There is no `syntaxHighlighting` or `HighlightStyle`. The Lezer languages parse but nothing colours them,
  and `--marxy-tok-*` reaches only Shiki.
- The editor is a full-window fixed overlay on the *code* ground, with no column and no centring.
- The `.cm-content` padding is `30px 60px`, and the comment calls that "the grid unit", but the grid unit
  is half that.
- The line height is CodeMirror's default, not the 30 px code line box.
- The theme is read once, so a change of variant or theme is not applied live.
- `.cm-activeLine` uses `${selection}33`, which works only for six-digit hex.
- The fold gutter is always on, which is chrome at rest for markdown. Artifacts spec: "a fold gutter
  *where line numbers show*".
- The line-number choice lives in `sessionStorage`, but the spec says "the choice persists".
- There is no search-panel styling.
- Scroll position: MARXY-302 is still open, and `sourceVisibleByteOffset` reads a `scrollTop` that is
  probably always 0.

## Beyond the brief: what else the research says Marxy should do

L-01 measures each of these and records Applied, Open or Contradicted. They are candidates, not decisions.

| Spec line | Says | Suspected state |
|---|---|---|
| Typography 10-spec, Size; ch. 4 "Size" | 18 / 19 / 20 px stepped by `em` media queries; text in `rem`, never `px` | Open: body is a fixed 20 px token in `px` (`.marxy-empty` too) |
| Coupling rule 1 | The measure follows the face and size; clamp to the screen with the minimum gutters | Partly: `--marxy-avg-char` is one number; a user theme with another face? |
| Coupling rule 2 | Below 45 characters, set ragged right whatever the setting | Check the typesetter at 320–480 px |
| Coupling rule 4; Overrides by script | CJK line height ×1.17 and at least 1.5; Indic and Thai factors | Check `07-cjk.md` and `08-rtl.md` against the grid pass |
| ch. 4 "Headings" | `text-wrap: balance` on long headings; keep a heading with the next block | Check |
| ch. 4 "Vertical rhythm" | `text-box-trim` to align boxes to ink; spacing in `rlh` | Open; could simplify `snapToGrid` |
| ch. 4 "Margins" | The column is centred and the margins are what is left, with a minimum gutter | The geometry probe tests this (H1–H4) |
| ch. 4 "Notes" | Margin notes on screens wider than 76 em, pop-ups below; "endnotes at the end of a scrolling chapter are the worst option" | Contradicted: footnotes are endnotes. This is the one feature that would *use* the wide gutter, and it competes with H1's room on the right |
| ch. 4 "Wide content" | Scrolls in its own focusable container; the page never scrolls sideways | Applied for tables (tabindex); check `pre` and math |
| Verification "Text spacing" (WCAG 1.4.12) | Apply the four overrides; assert nothing clips or overlaps | Not in Tier 1: a gate gap |
| Verification "Zoom" | 200 % and 400 %; text reaches 200 % | 400 % only |
| Verification "Hyphenation" | Probe that `hyphens: auto` works per engine; fall back to bundled patterns | Unknown for WebKitGTK |
| ch. 3 / Size across faces | Match x-heights; a fallback face with `size-adjust` | Check `Literata Fallback` and the CJK fallbacks |
| Typography `06-code.md`; artifacts 10-spec, Code | Highlight with an audited theme; check contrast against the line-highlight and selection backgrounds | Open for Source (H7); active-line contrast unchecked |
| Artifacts 10-spec, line-number gutter | Hung in the left margin, secondary colour at 4.5:1 or better, never selectable | Check what MARXY-239 shipped |
| Artifacts coupling rule 2 | Every unit — fold, gutter, notice, label — is a whole number of grid units | Notices are not (H6) |

Reader-artifacts rows already filed (MARXY-233, 237, 238, 239, 240) are **not** re-filed. L-01 lists only
where they meet layout.

---

## Stories

### L-00 — Measure the page: a geometry probe and a contact sheet over the corpus

**Model:** sonnet · **Size:** M · **Depends on:** none (it reads B-01's render entry and builds its own copy
if B-02 has moved it) · **Parallel with:** everything in B; no shared paths

**Outcome.** One command measures every block in every corpus document and draws the column, gutters and
room over a screenshot. Each of the author's complaints is then a number with a file and a width.

**Paths.**
- New: `scripts/probe-layout.mjs`, `scripts/probe-layout.test.mjs` (a synthetic page with a known
  asymmetry, as a negative control).
- Output only: `docs/taste-review/2026-10-layout-audit/` (a dated kit, per the no-rotting-paths rule), with
  `probe.json`, PNGs and a `README.md`.

**Build order.**
1. Render through the app's harness entry. Import `buildRenderEntry` from `scripts/gate-aesthetics.mjs`
   read-only; never edit it.
2. Use Playwright WebKit (`scripts/playwright-webkit.mjs`).
3. Run the matrix:
   - widths 320, 480, 659 (the column plus gutters), 720, 960, 1280, 1600 and 2560;
   - sizes 16, 20 and 28;
   - dark and light;
   - **scrollbars overlay and classic** (force classic with `::-webkit-scrollbar { width: 15px }` injected,
     to model WebKitGTK).
4. Record per document and cell:
   - the window axis against the column axis (centre offset in px);
   - the left margin against the right margin of body-text ink;
   - per block: kind, nesting depth, border box and ink box (Range client rects), each edge as a delta from
     the column's left and right edges, whether it is past the gutter floor or clipped, and whether it has
     its own scrollbar;
   - per set line: its width against the paragraph's content box (lines overflowing after a late
     scrollbar, H4);
   - the notice region's edges and its distance from the viewport top when the reader is scrolled.
5. Draw an overlay PNG per cell, with hairlines at the window centre, column edges, gutter floor and room
   limit, and a red box around every block that breaks the rules. Add a one-page contact sheet per width.
6. Rank the offenders in `README.md`: the worst N blocks by |delta|, grouped by hypothesis H1–H7.

**Acceptance.**
- The negative control fails the way it should (`probe-layout.test.mjs`).
- The run is deterministic: two runs give an identical `probe.json`.

**Do not.** Edit the gate, the baselines, `base.css` or any `src/` file. Add the probe to CI (that is L-02).

### L-00.1 — Correct the probe's H4 and H6 findings and give every hypothesis a control

**Model:** sonnet · **Size:** S–M · **Depends on:** L-00 · *Added 2026-10-07 by the lead, from L-00's review
(merged with the return open).*

**Outcome.** The probe's numbers L-01 builds on are true:
- **H4:** the probe counts the typesetter's deliberately hung hyphen (~7 px) as line overflow, and its
  "settled" read skips the app's 100 ms resize relayout (`app.ts`), so 21.9 px / 57 cells are inflated.
  Exclude hung punctuation, and wait for the relayout.
- **H6:** the 61 px at 960 px comes from `#marxy-notices` sizing its column in `em` at the browser's 16 px,
  not the article's 20 px. It is not caused by the padding, which matters only at 320 px. Fix the `why`
  string and the README.
- **Controls:** add a negative control for H2, H4, H5 and H6, and for the client-axis centre. Each must go
  silent when its rule is silenced.
- **README:** say plainly that H5 is untested, because the corpus has no nested wide table.
- **Notice builders:** the count of ad-hoc notice builders is five, not 18 lines.
- **`--ref`:** record the SHA actually rendered, not just the label.
- **Rankings:** also rank at 960 and 1280 px at 20 px.
- **Weight:** re-encode the contact sheets at JPEG quality 45 (option D, about 5.5 MB packed). Regenerate the
  kit.

**Paths.** `scripts/probe-layout.mjs`, `scripts/probe-layout.test.mjs`, `docs/taste-review/2026-10-layout-audit/`.

**Acceptance.** Every hypothesis has a control that fails when its rule is silenced. The H4 and H6 headlines
are restated with their true causes. The kit is regenerated and stays deterministic.

---

### L-01 — Write the findings: each hypothesis judged, a typography conformance pass, and the fix cards finalised

**Model:** opus · **Size:** M · **Depends on:** L-00 · **Parallel with:** B lane

**Outcome.** One document a reader of the plan can act on:
- each of H1–H7 confirmed or killed, with numbers from L-00;
- the conformance table above, filled in and measured (Applied, Open or Contradicted, with file:line);
- the author's decisions set out as questions with a recommended default and a before/after pair from the
  probe;
- L-02 onward rewritten with real paths, sizes and acceptance, ready for the lead to paste into a phase
  document.

**Paths.**
- New: `docs/research/reader-typography/12-conformance.md` (dated to its commit, as artifacts 10-spec does).
- `docs/plan/roadmap-2026-10/07-layout-and-reading.md` (this document): add the lane's goal and screen
  criterion, and rewrite L-02 onward as full cards in place of the candidate table.
- New: `docs/taste-review/queue.d/L-01.md` (optional).
- `06-story-index.md` and `progress.md` belong to the lead. Hand the index rows over in the PR body; do not
  edit those files. The author's answers to the decisions go to `rulings.md` through the lead.

**Build order.**
1. The author has no list of observed errors (`rulings.md`, 2026-10-07): treat L-00's ranked offenders as
   the cases, and reproduce the worst of each hypothesis.
2. For each hypothesis, record a verdict, the evidence, the cause at file:line, and the smallest fix.
3. Run the conformance pass. Probe the research's verification items in WebKit with small headless pages in
   `docs/research/reader-typography/lab/`:
   - text spacing (1.4.12);
   - 200 % zoom;
   - the hyphenation probe;
   - fallback x-heights;
   - CJK leading;
   - ragged right below 45 characters.
4. Write up the decisions (below), then finalise the cards.

**Decisions to put to the author** (each with a recommended default):
1. **Wide-block overflow.** The default is **symmetric**: a block wider than the column grows about the
   column's axis, up to `room` on each side. The alternative is right-only (today) or no overflow.
   Follows ch. 4 "keep the text column centred".
2. **The code box edge.** The default is to **hang the box**: the `pre` box outdents by its padding, so
   code text shares the prose's left edge, with a fallback below the gutter floor. Tables then also align
   by text. Taste row MARXY-199 already asks the neighbouring question.
3. **Centred images against flush-left blocks.** Keep images centred (figure convention), and make every
   other block flush with the column.
4. **Classic scrollbar.** The default is `scrollbar-gutter: stable both-edges` on the scroller, so the
   centre never moves.
5. **Where notices sit.** The default is a region that is **sticky at the top of the viewport**, inside the
   column, that never overlaps text: when a notice appears, the page reserves its height at the top, with
   no shift of the reading position (the position is kept by anchor). The alternative is the bottom of the
   viewport.
6. **Source column.** The default for markdown source is the Rendered column width in the code face, with
   numbers hung in the left margin. For code files, the default is a column of at most 100 characters,
   centred. Both sit on the page ground, not the code ground.
7. **Size ramp.** Adopt 18 / 19 / 20 px stepped in `em`, or keep 20 px fixed on a desktop app. A token
   unit change needs an ADR (`check-tokens.mjs`).
8. **Margin notes** (sidenotes) above 76 em. File them now in Phase C or D, or defer to v1.1. They compete
   with decision 1 for the right margin.

**Acceptance.**
- `pnpm precheck` and `node scripts/check-pr.mjs --range` pass.
- Each hypothesis has a verdict backed by a `probe.json` key.
- Each conformance row cites a spec line and a measurement or file:line.
- Every finalised card names a test or gate for each criterion.

### Candidate fix stories (L-01 finalises these; the lead sequences them)

Paths are given so the lead can slot them into waves. A story that moves baselines is marked **[baselines]**
and must be the only one in its wave.

| Id | Story | Model / size | Paths | Earliest |
|---|---|---|---|---|
| L-02 | Gate the geometry. Promote the probe's rules into `gate-aesthetics.mjs`: `checkCentred` (body ink margins equal within 1 px, both scrollbar modes), `checkBlockEdges` (every block's left edge is the column edge or a declared hang), `checkRoom` (no block past the gutter floor at any depth), `checkNoClip`, `checkTextSpacing` (WCAG 1.4.12), and 200 % zoom. Known failures carry deferral markers naming L-03 to L-05 (A-11.1). | sonnet M | `scripts/gate-aesthetics.mjs`, `docs/aesthetics-acceptance.md`, `docs/ci-contract.md` | after B-02 |
| L-03 | Centre the page truly: the scrollbar gutter (decision 4), a gutter floor no smaller than the widest hang (H3), notices padded to the article's gutter (H6), and fix the set-line overflow after a late scrollbar if H4 holds **[baselines]** | opus S–M | `packages/theme/src/base.css`, `packages/theme/test/layout.test.mjs`; the typeset relayout trigger only if H4 holds (`packages/typeset/src/index.ts`, after B-02.5) | after L-02 |
| L-04 | Make wide blocks and tables one policy: symmetric room (decision 1), hung code box (decision 2), nested blocks measured against the page column (H5), and table scrollbar and edge fixes **[baselines]** | opus M | `packages/theme/src/base.css`, `packages/theme/test/room.test.mjs`, `fixtures/corpus` (add a nested wide table if none exists) | after L-03 |
| L-05 | Make notices one component. `notify()` gains up to two actions plus Details. The five ad-hoc builders move onto it. Sticky placement (decision 5) with a grid-multiple height. In Source it reserves space instead of overlaying (it is per pane in D-10, so stay compatible with D-10 step 4). Choose `role=status` or `role=alert` by kind. Check the 4 s transient against WCAG 2.2.1. | opus M | `apps/desktop/src/notices/*`, `base.css` §Notices; the call sites in `save.ts` and `close.ts` only with the lead's approval | after B-09.1 and B-11; **before D-10** |
| L-06 | Source mode basics I (looks): a `HighlightStyle` mapping Lezer tags to `--marxy-tok-*` (the contrast-audited tokens, one palette for both modes); the code line box on the 30 px grid; padding in grid units; the active line by `color-mix`; the fold gutter only where numbers show; the line-number choice persisted; theme and variant applied live through a compartment; search panel styled. | sonnet M | `apps/desktop/src/source/theme-bridge.ts`, `editor.ts` (extension list only), new `source/highlight-style.ts`, `apps/desktop/test/source-*.test.mjs` | now (no overlap) — **before D-11** |
| L-07 | Source mode basics II (place): the column and centring (decision 6), done inside the CodeMirror theme so `index.html` stays untouched; numbers hung in the margin; scroll position kept both ways (MARXY-302 and the `scrollTop` bug) | opus M | `source/theme-bridge.ts`, `source/mode-switch.ts`, its tests | after L-06; before D-11 |
| L-08 | Typography conformance fixes that L-01 marks Open, each small and each citing its spec line. Likely: the size ramp (if accepted, with an ADR for the unit), heading balance, ragged right below 45 characters, CJK leading factor, fallback `size-adjust` **[baselines]** | split per finding | `packages/theme/src/*`, `packages/typeset/*` | after L-04 |
| L-09 | Margin notes above 76 em (only if decision 8 says now) | opus L | core footnote AST, `base.css`, `render/*` | Phase C or later |

### L-10 — Keep code on the grid at every text size

**Model:** sonnet · **Size:** S · **Depends on:** — · *Added 2026-10-07 by the lead, from A-10.4's stop.*

**Outcome.** At every body size the reader can choose (15–50 px), a code line box is a whole number of
grid units, as design-language constraint 5 asks. Today `applyReaderConfig`
(`apps/desktop/src/theme/reader-config.ts:89-93`) overrides `--marxy-size-body` and `--marxy-line-box`
(`lineBoxFor(size) = 2*round(0.75*size)`) but never `--marxy-line-box-code`, which stays 30 px with an
18 px face: on the grid only at 20 and 40. B-02.1's review flagged the same.

**Paths.** `apps/desktop/src/theme/reader-config.ts` (derive the code line box and, if the research
says so, the code size from the body size), its test; `packages/theme/test/taste.test.mjs` (extend
A-10.4's default-size check to every size).

**Acceptance.** For every integer size 15–50, `--marxy-line-box-code` ÷ grid unit is an integer (a test
that fails on today's code); the default size 20 renders byte-identically (no baseline change);
code-voice x-height ratio at each size recorded in the PR, not gated. Cite `06-code.md` for the
code-size rule chosen.

**Do not.** Change the default size's values or any baseline.

**Suggested order:**
- L-00 and L-01 now, in parallel with B (no shared paths).
- L-06 now.
- After B-02 merges: L-02, then L-03, then L-04, each alone for baselines.
- L-05 and L-07 slot between B-15 and D-10 or D-11. Alternatively the lead folds L-05 into D-10 and L-07
  into D-11, if the D lane starts first.

## Verification

- **L-00:**
  - Run `node scripts/probe-layout.mjs --ref origin/main`.
  - Check that the negative control fails (`node --test scripts/probe-layout.test.mjs`).
  - Open the contact sheets and check that the author's cases are in the ranked list.
- **L-01:** run `pnpm precheck` and `node scripts/check-pr.mjs --range`. Each conformance row has evidence;
  each card's acceptance names a test or gate.
- **Fix stories:**
  - `pnpm gate:aesthetics` passes with L-02's checks, and each deferral marker is removed by the story it
    names.
  - Re-run the probe before and after, and attach the pair to `queue.d/<id>.md` (optional).
  - Run `pnpm done <id>` and `node scripts/open-pr.mjs <id>`, per the roadmap PR path.
- **Non-interference:** before every push, check `git diff --name-only origin/main...HEAD` against the
  collision map. None of these stories may touch the lead ledger, `orchestration/` or another story's paths.

### L-06.1 — Remember the line-number choice in `config.toml`

**Model:** sonnet · **Size:** S · **Depends on:** L-06 · *Added 2026-10-07 by the lead, from the L-06 review.*

**Outcome.** Showing or hiding line numbers in Source survives a relaunch. The `line_numbers` key already exists
(`packages/theme/src/config.ts`, `docs/design/11-config-and-storage.md`), but the app never reads it: the choice
lives in `sessionStorage` (`apps/desktop/src/source/line-numbers.ts`) and `app.ts` hard-codes `lineNumbers: false`.
Read it in `readReaderConfig`, write it from the toggle with `setTopLevelKey` (byte-faithful, A-14.1), and apply it
only when the key is present: `parseConfig` defaults it to `false`, which would otherwise override the per-path
default (numbers on for code files). Make the parsed value tri-state, or check presence.

**Paths.** `apps/desktop/src/theme/reader-config.ts`, `apps/desktop/src/source/line-numbers.ts`,
`packages/theme/src/config.ts` (tri-state only), their tests, `changelog.d/L-06.1.md`.

**Acceptance.** Toggle, relaunch: same choice. No key: the per-path default holds. The toggle changes only the
value's bytes in `config.toml` (a fidelity test like A-14.1's).

### L-11 — Find matches are visible in the light variant

**Model:** sonnet · **Size:** S · **Depends on:** L-06 (#383) · *Added 2026-10-07 by the lead, from the L-06 review;
rewritten after its first attempt stopped.*

**Outcome.** In the light variant every find match is distinguishable from the page and code grounds, and the
current match from the others. Measured: light `--marxy-color-find` (`#fcefc0`) is about 1.01:1 against the code
ground (`#f1eee8`) and `find-current` 1.14:1 against `find`. A fill alone cannot meet both 3:1 against the
grounds (WCAG 1.4.11; needs relative luminance ≤ 0.25) and 4.5:1 for every `--marxy-tok-*` on it (the comment
token needs ≥ 0.67; `10-spec.md`, and the gate's `TINT_PAIR_RULES`). So the fill stays pale for reading, and a
2 px outline (or underline) token from the same hue family carries the 3:1 against both grounds and the
current-versus-other difference.

**Paths.** `packages/theme/default/theme.css` (light values; dark values live in `tokens.css`) and
`packages/theme/src/tokens.css` (a new `--marxy-color-find-edge` token, through `scripts/registry.json` and the
token contract; adding a token name needs the token ADR process in AGENTS.md: a short ADR amendment, or the lead
says if an existing token can serve), `packages/theme/test/palettes.json` and `palettes.test.mjs`, the Source search
panel rule L-06 added in `apps/desktop/src/source/theme-bridge.ts`.

**Acceptance.** A palette test: the edge is 3:1 or more against page and code grounds in both variants, and current
versus other differ by 3:1 or more on some channel; text on either fill keeps 4.5:1 (unchanged). A WebKit test in
Source: a match carries the edge.

**Do not.** Style Rendered find: it does not exist on main yet. D-13 builds it and must use the same tokens and
edge, which D-13's card now says.
