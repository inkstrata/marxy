# 07 — Layout and reading: the page measured against the research (lane L)

**Date:** 2026-10-07 · **Status:** folded into the roadmap by the lead; L-00 dispatched, the rest sequenced
below · **Runs:** as its own lane beside Phase B, inside the same four-agent cap (`00-orchestration.md` §5).

Story cards follow the house shape (`02-phase-b.md`). Ids are `L-nn`. L-01 judged the hypotheses and
finalised L-02 onward as full cards ("Findings" and "Stories" below); the evidence is
`docs/research/reader-typography/12-conformance.md`.

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

## Goal and screen criterion

*Added by L-01.*

**Goal.** At every width a reader uses, the page is set like a well-made book, and each property
below is a number a gate can fail:
- the column is centred on what the reader sees;
- every block starts on the column's edge, or hangs into the margin on purpose;
- wide content grows evenly into the room on both sides;
- the app's own notices sit on the same column and stay in sight;
- Source has a column of its own.

**Screen criterion.** The lane is done when L-02's geometry checks pass over the corpus with no
expected-failure rows left. The matrix is widths 320, 480, 720, 960, 1280 and 1600 px, sizes 16, 20
and 28 px, both variants, and overlay and classic scrollbars. Every rule is measured as L-00's probe
measures it (`probe.json` `definitions`):

1. **Centre.**
   - Overlay scrollbar: where body text reaches the column, its left and right ink margins are equal
     within 1 px.
   - Classic scrollbar: the column's axis is the visible area's axis within 0.5 px.
2. **Edges.** Every top-level block's text starts on the column's left edge, within 1 px. The only
   exceptions are declared hangs:
   - list markers, checkboxes, hung punctuation and hung initial letters;
   - a blockquote's indent;
   - a lone image, which is centred;
   - a wide block grown about the axis.
3. **Room.**
   - No block box passes the column plus `room` on either side, at any depth.
   - No mark sits left of the gutter floor, except hung punctuation.
   - No ink is cut off by the window.
4. **Lines.**
   - Once the relayout has settled, no set line runs past its paragraph's box.
   - The page never scrolls sideways.
5. **Notices.**
   - A notice box is on the column's edges within 1 px.
   - It is in view at any scroll position.
   - It is a whole number of grid units high.
   - In Source it never covers text.
6. **Access.** With the four WCAG 1.4.12 overrides applied as a theme, and at 40 px text, nothing is
   clipped, nothing overlaps and the page does not scroll sideways.

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
| `apps/desktop/index.html` (inline Source and notice rules) | D-01 (pane skeleton and app-shell CSS; corrected by L-01: B-13 does not list it) | before D-01 starts, or folded into D-10 / D-11 |
| `app.ts`, `save.ts`, `close.ts`, `trust/controller.ts` | B-10, B-11, then B-12 to B-15 serially | after B-15, or only at call sites with the lead's say-so |
| `apps/desktop/src/notices/*` | B-09.1 (merge verdict, #357); D-10 rewrites the call sites | after B-09.1, **before** D-10 |
| `apps/desktop/src/source/*` | D-11 rewrites `editor.ts` | before D-11, or folded into it |
| `packages/typeset/src/index.ts` | B-02.5 (in review), B-17 | after B-02.5 |

- **Do not file anything through the Jira, CSV or `out-of-plan.mjs` path.** New work goes into the plan
  as a phase-document section (`00-orchestration.md` §2 and §7).
- **Keep ledgers to a minimum.** The typography conformance table is a one-off section of the findings
  document, not a new tracked ledger with a tool.

## Hypotheses to test

Each is read off `origin/main`; L-00 confirms or kills it. *Judged by L-01: see "Findings" below.*

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

## Findings (L-01, 2026-10-07)

The evidence is in `docs/research/reader-typography/12-conformance.md`:
- §1 judges each hypothesis, with the cause at file:line;
- §2 is the conformance table above, filled in;
- §3 describes the lab probes.

Numbers are cited as `probe:` or `lab:`, both in `docs/research/reader-typography/lab/data/`:
- `probe:` is `layout-probe.json`, the slice of L-00.1's probe that is cited, copied from the dated
  kit it was generated into (`docs/taste-review/2026-10-layout-audit/`) by `lab/layout/slice-probe.mjs`;
- `lab:` is `layout.json`, written by `lab/layout/run.mjs`.

### What the page gets wrong, worst first

| | Verdict | The number | Fixed by |
|---|---|---|---|
| H1 | **Confirmed.** Wide code and tables grow right only, as ADR-0033 §5 chose. | 150.41 px right, 0 left at 960 px; 80 of 95 cells (`probe:headlines.H1`) | L-04 |
| H6 | **Confirmed.** The notice is off the column and out of sight. | 61.11 px off the column at 960 px (an `em` basis of 16 px against 20), 32 px at 320 px; out of view when scrolled in 178 of 179 cells; 2.97 grid units high; fixed over Source (`probe:headlines.H6`) | L-05 |
| H3 | **Confirmed below 720 px.** List markers pass the gutter floor. | 45 px marker against a 16/24 px floor; −47 px (cut off) at 320 px with 28 px type (`probe:headlines.H3`) | L-03 |
| H2 | **Confirmed for code.** Code text starts inside the prose edge. Images are centred by design. Blockquotes are a declared indent. The paragraph offenders are a probe artefact (a hung initial capital). | 15–17.36 px (`probe:headlines.H2`) | L-04; the artefact in L-02 |
| H4 | **Killed as a centring error**: the visible area stays centred (client offset 0). **Confirmed as a transient overflow at ≤ 720 px** until the 100 ms relayout. | 42 cells, up to 15.5 px; 2–6 px of sideways scroll in 14 cells over all sizes, 3 of them in the size-20 dark cells (`probe:headlines.H4`) | L-03 |
| H7 | **Confirmed on `main`.** L-06 answers the looks. | `probe:headlines.H7` | L-06 (#383), L-06.1, L-07, F-04 |
| H5 | **Killed.** Nested blocks end exactly at the room limit. The two corpus offenders are trailing spaces in `pre-wrap`. | `pastRoomRightPx` 0 at every depth (`lab:nested`) | — (L-02 drops the artefact) |

The conformance pass finds nothing else as large. Where the code does not meet the spec, the lines
are these:
- CJK leading: 1.5, against the coupling rule's × 1.17 (decision 9, L-08.1).
- Documents are never tagged with their language: German gets English hyphenation (L-08.2).
- Display math scrolls with no tab stop (L-08.3).
- Light find matches are 1.01:1 (L-11).
- Notes are endnotes (deferred, L-09).

Three departures are recorded on purpose and stay:
- text in `px` (decision 7);
- code wraps instead of scrolling (ADR-0033 §5);
- no `text-box-trim` (ADR-0030's grid does the job).

Text spacing (WCAG 1.4.12) and 200 % text pass, but no gate holds them; L-02 adds the gate.

### Decisions

The first eight questions take the defaults recorded in `rulings.md` ("Lane L inputs", 2026-10-07).
Each comes with a before/after pair: today's measurement, then the default's, measured by injecting
the proposed CSS into the page (`lab:decisions`). Decision 9 is new: the conformance pass raised it,
and it has no ruling yet.

1. **Wide-block overflow: symmetric, right-only, or none?**
   - *Recorded:* symmetric.
   - *Before/after* (`03-ai-plan.md`, page boxes): asymmetry 150.41 → −0.02 px at 960 px and
     310.41 → 0.2 px at 1280 px. The widest `pre` goes from 0 / +150.41 px to −150.42 / +150.41 px.
   - *Consequence:* the code text of a block wider than the column now starts left of the prose
     edge: 135.42 px at 960 px on `06-math.md`. It is a declared hang. This overturns ADR-0033 §5,
     which L-04 amends.
2. **The code box edge: hang the box by its padding?**
   - *Recorded:* hang it.
   - *Before/after:* code text sits 15 px from the prose edge today, and 0.08 px after, at 960 px.
   - *Fallback:* at 480 px (room 0) the text stays 15 px in, so the box never passes the gutter floor.
3. **Lone images centred, other blocks flush?**
   - *Recorded:* keep images centred.
   - *Before/after:* centred, the image starts 278.58 px in; flush, it would start at 0
     (`24-issue-thread.md`, 960 px). No change.
4. **A classic scrollbar: `scrollbar-gutter: stable both-edges`?**
   - *Recorded:* yes. **In this harness it had no effect, or a worse one** (macOS Playwright
     WebKit, the scrollbar forced by `::-webkit-scrollbar`). The ruling is unchanged; L-03's Linux
     measurement decides.
   - *Before/after:* tested on `31-essay.md` at 480 px, a scrollbar appearing after first text.

     | Treatment | Column moves | Lines past their box | Furthest past |
     |---|---|---|---|
     | Today | 7.5 px | 113 | 15.25 px |
     | `stable` | 7.5 px (no change) | 113 | 15.25 px |
     | `stable both-edges` | 15 px | 291 | 30.25 px |
     | `overflow-y: scroll` | 0 | 0 | 0 |

   - *What the lab shows:* no gutter was reserved before the scrollbar appeared (the root's
     `clientWidth` equalled `innerWidth` under both `stable` values), and once it appeared
     `both-edges` reserved it on both sides. A control on a box that is not the viewport
     (`lab:decisions.d4control`) reserved none either, with the forced scrollbar or the engine's own
     (an overlay of width 0 on macOS). So the harness cannot tell its model from the engine, and
     nothing here describes WebKitGTK's native classic scrollbar. `overflow-y: scroll` kept
     everything still, but it shows an empty track at rest on short documents: chrome at rest.
   - *Recommendation, for the author to confirm:* L-03 re-measures on Linux WebKit. If WebKitGTK
     shows the same, keep today's behaviour: the visible area is centred, and the overflow lasts only until the relayout, at
     ≤ 720 px. Do not add a track at rest.
5. **Where notices sit: sticky at the top of the viewport, reserving their height?**
   - *Recorded:* yes.
   - *Before/after* (`15-prose-volume.md`):
     - edge from the column: 61.11 → 0 px at 960 px, 32 → 0 px at 320 px;
     - when the reader is scrolled: out of view (top −2700 px) → in view (top 0).
   - *Consequence:* WebKit has no CSS scroll anchoring, so the app's anchor keeps the reading
     position when a notice appears above it.
6. **Source column: the Rendered column for markdown; at most 100 characters, centred, for code;
   both on the page ground?**
   - *Recorded:* yes.
   - *Before/after* (computed from the 0.6 em mono advance in `lab:faces` and the 60 px side
     padding):
     - today a Source line runs 77 characters at 960 px, 107 at 1280 px and 227 at 2560 px, on the
       code ground;
     - after, markdown is 611 px wide (56 characters of 18 px mono) and code at most 1080 px.
   - *Consequence:* Source wraps lines (`source/editor.ts:166`). At 56 columns, 49.5 % of the
     corpus's non-blank markdown lines wrap, against 24.3 % at 80 columns; in this repository's
     `docs/` it is 72.1 % against 60.4 %. The author may prefer the Rendered measure in characters
     (66 columns, 713 px) to its width in pixels; L-07 keeps it a single value.
7. **Size ramp: 18 / 19 / 20 px in `em` steps, or 20 px fixed?**
   - *Recommended (L-01's to recommend):* keep 20 px fixed and keep the `px` unit. No ADR is needed,
     because nothing changes.
   - *Before/after:* the ramp changes only windows narrower than 659 px, where the window clamps the
     column. At 480 px a line holds 46.6 characters at 20 px against 51.8 at 18 px. From 720 px up
     the measure is 66 characters either way.
   - *Why:*
     - the steps in ch. 4 serve phones and tablets held at different distances, and a desktop
       window read from one distance is neither;
     - shrinking text moves toward the x-height floor ch. 2 grades [A];
     - the reader's size setting (15–50 px, and 200 % measured clean in `lab:text200`) does what
       `rem` does in a browser, and the shell has no browser text-size setting to multiply.
8. **Margin notes above 76 em: now, or after v1?**
   - *Recorded:* after v1.
   - *Before/after:* today 58 footnotes sit at the ends of four corpus documents. The right margin
     they could use is 310 px at 1280 px and 470 px at 1600 px.
   - *Consequence:* when L-09 lands, wide blocks give up the right room to the notes column.
9. **New: CJK line height: 30 px (1.5, on the grid), or 35 px (1.75, coupling rule 4's × 1.17)?**
   - *Not in `rulings.md`.* 35 px is not a whole number of 15 px grid units. The paragraph would be
     padded back onto the grid at its end, as code and tables are.
   - *Before/after:* Han ink is 18.5 px at 20 px (`lab:faces.cjk`). The gap between lines is 11.5 px
     (0.58 of the character) at 30 px and 16.5 px (0.83) at 35 px. Ch. 4 reads JLREQ and clreq as a line
     height of 1.5 to 2.0, and both values meet the spec's 1.5 floor.
   - *Recommended default:* 35 px. Evidence first: the coupling rule gives it, and the grid already
     tolerates islands.
   - *Until the author answers,* L-08.1 is not dispatched.

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

### Fix stories (finalised by L-01)

The candidate table is replaced by the cards below. Paths are exact, so the lead can slot the stories
into waves. A story marked **[baselines]** regenerates `fixtures/baselines/**` (macOS locally, Linux in
the CI image) and must be the only baseline story in its wave (`00-orchestration.md` §5).

| Id | Story | Model | Size | Depends on | Status |
|---|---|---|---|---|---|
| L-00.1 | Correct the probe's H4 and H6 findings and give every hypothesis a control | sonnet | S–M | L-00 | merged, [#382](https://github.com/inkstrata/marxy/pull/382) |
| L-02 | Gate the geometry | sonnet | M | B-02, L-01 | ready after B-02 |
| L-03 | Keep marks inside the gutter and the column still under a classic scrollbar **[baselines]** | opus | S | L-02 | after L-02 |
| L-04 | Grow wide blocks evenly and hang the code box **[baselines]** | opus | M | L-03 | after L-03 |
| L-05 | Make notices one component, on the column and in sight **[baselines if a gated render shows a notice]** | opus | M | B-15; before D-01 | after B-15 |
| L-06 | Source mode basics I: looks | sonnet | M | — | merged, [#383](https://github.com/inkstrata/marxy/pull/383) |
| L-06.1 | Remember the line-number choice in `config.toml` (the lead's card, below) | sonnet | S | L-06 | ready |
| L-07 | Source mode basics II: a column on the page ground | opus | M | L-06, L-11; before D-11 | after L-11 |
| L-08.1 | Set CJK paragraphs at the script's leading **[baselines]** | sonnet | S | decision 9, L-04, F-11 | waits for the author |
| L-08.2 | Tag the article with the document's language | sonnet | S | B-15 | after B-15 |
| L-08.3 | Give a scrolling display formula a tab stop | sonnet | XS | — | ready now (not beside B-02.4) |
| L-09 | Margin notes above 76 em | opus | L | after v1 (decision 8) | deferred |
| L-10 | Keep code on the grid at every text size | sonnet | S | — | merged, [#378](https://github.com/inkstrata/marxy/pull/378) |
| L-11 | Find matches are visible in the light variant (the lead's card, below) | sonnet | S | — | ready now |

### L-02 — Gate the geometry

**Model:** sonnet · **Size:** M · **Depends on:** B-02 (the gate measures the app), L-01 ·
**Parallel with:** anything outside its paths

**Outcome.** The six rules of the screen criterion are checks in the aesthetics gate, so a page that
is off-centre, off the column's edge, past its room, cut off by the window, or unreadable with
WCAG 1.4.12 spacing or at 200 % text turns the pull request red. Where today's page fails a rule, the
failure is listed with the story that clears it. When that story merges, it deletes the row. A
listed failure that starts to pass also fails the gate, so the list can never go stale.

**Why now.** H1, H2, H3 and H6 are confirmed with numbers (`12-conformance.md` §1), and none of them
is gated: `checkMeasure` checks the line length, `checkNoHorizontalPageScroll` sideways scroll, and
`layout.test.mjs:70` centring on one synthetic page. Text spacing and 200 % text pass today
(`lab:textSpacing`, `lab:text200`), but nothing holds them.

**Paths.**
- `scripts/gate-aesthetics.mjs`
- `scripts/probe-layout.mjs` (export the in-page rules; fix two artefacts), `scripts/probe-layout.test.mjs`
- `docs/aesthetics-acceptance.md` (the six checks), `docs/ci-contract.md` (one row per check)
- `changelog.d/L-02.md`

**Build order.**
1. In the probe, fix the two artefacts L-01 found, each with a control in `probe-layout.test.mjs`:
   - **H2:** a `.marxy-hang` initial letter is ink that is allowed to hang. Today the ink edge reads
     as the second letter: 13.72 px on `32-long-reference.md`.
   - **H5:** whitespace-only client rects in a `pre-wrap` line are not ink. A run of trailing spaces
     reads as ink 185.6 px outside the window on `30-notebook-export.md`.
2. Export `measureInPage` and the offender rules from `probe-layout.mjs`, and import them in the gate.
   There is one implementation; the gate does not copy it.
3. Add the checks to the renders the gate already makes, plus one classic-scrollbar render per
   document at 480 and 960 px (the probe's `CLASSIC_CSS`):
   - `checkCentred`, against the **client** axis (the window less the scrollbar). A classic
     scrollbar puts the column 7.5 px from the window's axis and 0 from the client's
     (`probe:headlines.H4`); only the client axis is an error;
   - `checkBlockEdges`, with the declared hangs of the screen criterion;
   - `checkRoom`, at any depth;
   - `checkMarks`: no mark left of the gutter floor except hung punctuation, and nothing outside
     the window;
   - `checkNoClip`;
   - `checkNoticeColumn`, on the app's real region now that the gate measures the app;
   - `checkTextSpacing`: the four overrides loaded as a reader theme, so the typesetter sets with
     them;
   - `checkText200`: reader size 40 through the config.
   The classic render injects the scrollbar after first text, as the probe does, and then waits for
   the app's own relayout (100 ms after the article's width changes, `app.ts:665-675`, plus its
   passes) before it measures. The gate measures the app after B-02, so the relayout runs there. H4's
   transient overflow (42 cells at ≤ 720 px; 2–6 px of sideways scroll in 14) is therefore not an
   expected failure. If it is still there after the relayout, that is a bug: add an H4 row owned by
   L-03 and say so in the PR.
4. Add the expected-failure table to the gate. Each row is `{ check, document, cell, story }` and
   names L-03, L-04 or L-05. The gate fails on:
   - an unlisted failure;
   - a listed row that passes.

   No `|| true`, no retries.
5. Record the gate's wall time before and after in the PR. There is no ceiling (ADR-0032).

**Acceptance.**
- Each new check has a negative control that fails without its rule:
  - `node --test scripts/probe-layout.test.mjs` for the two artefacts;
  - `node scripts/gate-aesthetics.mjs --selftest` for the six checks.
- `pnpm gate:aesthetics --mechanical` passes on the corpus, with the expected-failure table listing
  exactly the H1, H2-code, H3 and H6 cases.
- A row whose case passes turns the gate red: a test with a doctored table.
- `pnpm precheck` green.

**Do not.**
- Change `base.css`, any `src/` file or a baseline.
- Loosen a threshold.
- Put a check that can fail for the machine (timing) on the pull-request path.

**Risks.**
- B-02's gate takes 461 s. The classic renders add two per document, so reuse a page where you can.
- The classic scrollbar is a forced `::-webkit-scrollbar` model. On the Linux CI image, check that
  the column moves by half a scrollbar, as on macOS.

### L-03 — Keep marks inside the gutter and the column still under a classic scrollbar [baselines]

**Model:** opus · **Size:** S · **Depends on:** L-02 · **Parallel with:** nothing that touches
baselines

**Outcome.** A list marker or a checkbox hangs into the margin only as far as there is room, so at
320 to 720 px it stays inside the gutter's floor instead of crossing it or leaving the window. Under
a classic scrollbar, the column is as still as the engine allows (decision 4, as answered after
this story's measurement).

**Why now.** H3: the marker is at −47 px at 320 px with 28 px type, and 27 cells are cut off. H4:
when a classic scrollbar appears, set lines run up to 15.5 px past their box at ≤ 720 px until the
relayout (`12-conformance.md` §1).

**Paths.**
- `packages/theme/src/base.css`: the list and checkbox rules (`:178-222`), and the root scrollbar rule if
  decision 4 adopts one
- `packages/theme/test/layout.test.mjs`
- `fixtures/baselines/**` (regenerated)
- `changelog.d/L-03.md`

**Build order.**
1. Hang only into the room:
   - top-level ordered lists get `padding-inline-start: max(0px, 2.25em - var(--marxy-room))`;
   - checkbox items get the same with `1.25em`.

   The marker's left edge is then never left of the column minus `room`, which is never left of the
   gutter floor.
2. Decision 4: run `lab/layout/run.mjs`'s `d4` pairs on Linux WebKit, in the CI image
   (`mcr.microsoft.com/playwright:v1.63.0-noble`).
   - If `scrollbar-gutter: stable both-edges` keeps the column still there and nothing overflows,
     adopt it on `html`.
   - Otherwise, change nothing and record the numbers in the PR for the author. The recommendation
     is to keep today's page.
   - `overflow-y: scroll` is not an option: it is chrome at rest.
3. Delete L-02's expected-failure rows for H3 (and for classic centring, if step 2 adopts a rule),
   then regenerate the baselines.

**Acceptance.**
- `layout.test.mjs`, on a 320 px page at 28 px with a top-level ordered list and a task list: the
  marker's and checkbox's left edges are at or right of 16 px. This fails today (−47 px).
- On a 1280 px page, the markers still hang fully: the text of item 1 is on the column's edge, and
  the marker is 2.25 em left of it.
- L-02's `checkMarks` passes with no H3 rows.
- A deliverable, not a test: decision 4's numbers (the `d4` pairs and `d4control`) are in the PR
  body, Linux and macOS side by side, for the author's answer.

**Do not.** Touch `packages/typeset/src/index.ts` (the relayout already heals H4's overflow;
F-04 owns resize). Add a track at rest.

**Risks.** A list whose markers hang partly reads as slightly indented at narrow widths. That is the
correct trade (ch. 4, "a minimum gutter"), but put it in the taste queue.

### L-04 — Grow wide blocks evenly and hang the code box [baselines]

**Model:** opus · **Size:** M · **Depends on:** L-03 · **Parallel with:** nothing that touches
baselines

**Outcome.** Two changes, so the page is balanced and every block shares the prose's left edge:
- A code block or table wider than the column grows evenly about the column's axis, up to the room
  on each side (decision 1).
- A code block no wider than the column hangs its box by its padding, so the code text starts on
  the prose's left edge (decision 2).

**Why now.** H1 is the largest error on the page: 150.41 px right and 0 left at 960 px, and up to
1011.53 px at 2560 px. H2: code text sits 15–17 px inside the prose edge.

**Paths.**
- `packages/theme/src/base.css`: §Code (`pre`, `:297-313`), §Tables (`table`, `:374-387`), and the
  `--marxy-room` comment (`:99-101`)
- `packages/theme/test/room.test.mjs`
- `docs/adr/0033-typography-follows-the-research.md`: amend §5, which says code "starts at the
  column's left edge … grows into the right margin". Cite the ruling of 2026-10-07.
- `fixtures/baselines/**` (regenerated), `changelog.d/L-04.md`

**Build order.**
1. **Symmetric growth.**
   - A `pre` or `table` is centred on the column's axis, with `max-width: calc(100% + 2 *
     var(--marxy-room))`. The `pre` keeps its 100-column cap.
   - The lab's proposal, `position: relative; left: 50%; translate: -50% 0`, measured −0.02 px of
     asymmetry at 960 px (`lab:decisions.d1d2`). Compare a breakout grid on the article and keep
     whichever leaves the scroll container, focus ring and selection rects right.
2. **Hung box.** Set `pre`'s `min-width: calc(100% + 2 * min(var(--marxy-half), var(--marxy-room)))`.
   Where the room is at least the padding, the code text starts on the prose edge (0.08 px measured).
   Where it is not, the box stays in the column and the text stays inset (the fallback below the
   gutter floor).
3. Amend ADR-0033 §5 and the `base.css` comment above `code, kbd, pre`.
4. Delete L-02's H1 and H2-code expected-failure rows, then regenerate the baselines.

**Acceptance.**
- `room.test.mjs` at 960 px. Each case fails today:
  - a wide table's left overhang equals its right within 1 px (0 against 150.41 today);
  - a wide `pre`'s left overhang equals its right within 1 px;
  - a `pre` narrower than the column has its first character on the prose's left edge within 1 px
    (15 px today).
- At 480 px (room 0), the same `pre` keeps its 15 px inset and its box stays inside the column.
- A nested wide table, at depth 2 in a list, stays inside the room on both sides (`lab:nested`'s
  page, as a fixture in the test).
- L-02's `checkRoom` and `checkBlockEdges` pass with no H1 or H2-code rows.

**Do not.**
- Change tables' text alignment: it is already on the edge.
- Make code scroll instead of wrap (ADR-0033 §5 keeps wrapping).
- Touch the typesetter.

**Risks.**
- Code text in a wide block now starts left of the prose edge, by up to `room` (135.42 px measured
  on `06-math.md` at 960 px). That is the price of decision 1. Show it in the taste queue
  with a before/after pair.
- `.marxy-selected` draws its bar 3 px left of the box, and find highlights sit on client rects;
  check both on a moved block.

### L-05 — Make notices one component, on the column and in sight [baselines if a gated render shows a notice]

**Model:** opus · **Size:** M · **Depends on:** B-15 (the `save.ts` and `close.ts` call sites); before
D-01 (`index.html`) · **Parallel with:** L-02 to L-04, if no baseline moves

**Outcome.** A notice is one component in the right place:
- **Placement:** it sits on the article's column, stays in sight when the reader is scrolled
  (sticky at the top of the viewport, decision 5), and is a whole number of grid units high. In
  Source it never covers text.
- **One builder:** every notice is built by `notify()`, with up to two actions and a Details
  disclosure. The five files that build their own DOM move onto it.
- **Role:** a status is `role=status`; a failure (save failed, file removed) is `role=alert`.

**Why now.** H6:
- the box is 61.11 px off the column at 960 px and 32 px off at 320 px;
- it is out of view when scrolled in 178 of 179 cells;
- it is 2.97 grid units high;
- it is fixed over Source (`index.html:18`).

`09-app-shell.md` §Notices says the region never overlaps the text. The artifacts spec's coupling
rule 2 says every unit is whole grid units.

**Paths.**
- `apps/desktop/src/notices/*` (`index.ts`: `notify`, `ensureNoticesRegion`; `blocked.ts`,
  `truncation.ts` onto `notify`)
- `apps/desktop/src/theme/theme-document.ts` (its call site only)
- `apps/desktop/src/save.ts`, `apps/desktop/src/close.ts`: call sites only, after B-15, with the
  lead's say-so
- `packages/theme/src/base.css` §Notices (`:24-76`)
- `apps/desktop/index.html`: the one rule at `:18`, and the Source mount's top. Only before D-01
  starts; otherwise this step goes to D-10, step 4.
- `scripts/registry.json` (any new name, such as a custom property for the region's height)
- `apps/desktop/test/notices-*.test.mjs`
- `fixtures/baselines/**`, only if a gated render shows a notice (say which)
- `changelog.d/L-05.md`

**Build order.**
1. **Column.**
   - The region takes the article's font size, so its `em` column is the article's: 0 px off,
     measured as `probe:headlines.H6.noticeEdgeIfRegionFontMatchedArticle_960`.
   - Its side padding is the article's gutter (16 / 24 px), not `3rem`.
2. **Grid.** Line box, padding and border add up to a whole number of grid units.
3. **Sticky.**
   - `position: sticky; top: 0` on the page ground.
   - When a notice appears while the reader is scrolled, keep the reading position with the app's
     anchor. WebKit has no `overflow-anchor`.
4. **Source.** Delete the fixed rule. The Source mount starts below the region: the region publishes
   its height as a custom property.
5. **One builder.**
   - `notify({ text, kind, actions ≤ 2, details? })`.
   - Move the five builders onto it.
   - Choose `role` by kind.
   - Check the 4 s transient against WCAG 2.2.1 and 2.2.2, and record the reading in the PR. Pausing
     on hover and focus is the likely answer.

**Acceptance.** WebKit tests. Each fails today:
- The notice box is on the article's column edges within 1 px at 320 and 960 px (today 32 and
  61.11 px).
- Scrolled three screens down, a new notice is in view, and the paragraph under the reading line
  has not moved by more than 1 px.
- The notice's height is a whole number of grid units (today 2.97).
- In Source, the notice box does not intersect `.cm-content`'s first line.
- `git grep -n "marxy-notice" apps/desktop/src -- ':!apps/desktop/src/notices/index.ts' ':!*.test.*'`
  finds no DOM building (today five files).
- A save failure has `role=alert`; a blocked-content notice has `role=status`.

**Do not.**
- Add a modal.
- Edit `index.html` after D-01 has started.
- Change notice wording (B-09.1 settled it).

**Risks.**
- Sticky inside `#marxy-main` needs the main to be the full document height. It is today; D-01's
  panes change that, which is why this goes before D-01.

### L-06 — Source mode basics I: looks

**Model:** sonnet · **Size:** M · **Status:** merged,
[#383](https://github.com/inkstrata/marxy/pull/383)

**Outcome.** Source is coloured from `--marxy-tok-*` through a `HighlightStyle`, and its lines sit
on the 30 px code line box. Padding is in grid units, the active line is a `color-mix`, the fold
gutter appears only with line numbers, the theme is re-applied live through a compartment, the
search panel is styled from tokens, and ligatures are off. This answers H7's looks.

Left to other stories:
- persistence of the line-number choice: L-06.1;
- the column and the ground: L-07;
- the reading position: F-04.

**Paths** (as merged): `apps/desktop/src/source/{highlight-style,theme-bridge,editor}.ts`,
`apps/desktop/test/source-looks.test.mjs`. Also `apps/desktop/package.json`, `pnpm-lock.yaml` and
`scripts/allowlists/dependencies.json` for `@lezer/highlight`.

### L-07 — Source mode basics II: a column on the page ground

**Superseded (2026-10-08) by K-04** (`09-code-view.md`), which takes this outcome and acceptance with Source's own metrics.

**Model:** opus · **Size:** M · **Depends on:** L-06 (merged), L-11 (same file, `source/theme-bridge.ts`) · **Parallel with:**
anything outside `source/` · **Before:** D-11

**Outcome.** Source reads as a page, not a full-window editor:
- **Markdown:** a column as wide as Rendered's.
- **Code files:** a column of at most 100 characters.
- Both are centred on the window, on the page ground, with line numbers hung in the left margin
  (decision 6). Turning numbers on or off never moves the text.

**Why now.** H7, which L-06 leaves open. On `main` the editor is a full-window fixed overlay on the
code ground with 60 px side padding: 107 characters a line at 1280 px and 227 at 2560 px. The
artifacts spec puts the line-number gutter "hung in the left margin".

**Paths.**
- `apps/desktop/src/source/theme-bridge.ts`
- `apps/desktop/test/source-place.test.mjs` (new)
- `changelog.d/L-07.md`

**Build order.**
1. **Ground.** The editor and its gutters use `--marxy-color-bg`. Check that every `--marxy-tok-*` and
   the secondary colour keep 4.5:1 on it in both variants (`palettes.test.mjs` already covers the
   page ground for Rendered's tokens; extend it if Source's set differs).
2. **Column.**
   - Markdown: `.cm-content`'s width is
     `--marxy-measure-chars × --marxy-avg-char × --marxy-size-body`, Rendered's column in pixels.
     Keep it one value, so the author can switch to characters (decision 6's note).
   - Code files: `100ch` in the mono face.
   - Centre the content on the window's axis; the gutters sit outside the content box.
3. **Numbers.** Hung left of the column, never shifting its axis.
4. Leave `index.html` untouched: the mount stays fixed and full-window, and the theme does the rest.

**Acceptance.** WebKit tests in `source-place.test.mjs`. Each fails today:
- At 960 and 1280 px, the markdown content's axis is the window's axis within 1 px, with numbers on
  and off.
- A markdown line wraps at Rendered's column width within one character.
- A `.ts` line wraps at 100 characters.
- The numbers' right edge is at or left of the content's left edge.
- The background is `--marxy-color-bg` in both variants.

**Do not.**
- Touch the reading position or `sourceVisibleByteOffset` (F-04).
- Touch `editor.ts` (D-11) or `index.html` (D-01).

**Risks.**
- CodeMirror lays out its gutters and content as flex siblings, so centring the content alone
  needs care with wrapping and selection painting.
- Decision 6's consequence: 49.5 % of the corpus's markdown lines wrap at 56 columns.

### L-08.1 — Set CJK paragraphs at the script's leading [baselines]

**Model:** sonnet · **Size:** S · **Depends on:** the author's answer to decision 9; L-04 (baselines);
F-11 and B-02.8 (they hold `packages/typeset/src/index.ts`)

**Outcome.** A paragraph that is mostly CJK is set at the script's line height (35 px at 20 px type
if decision 9 takes its default). Its block is padded back onto the grid at its end, as code and
tables are. Latin text is unchanged.

**Why now.** Coupling rule 4 and "Overrides by script": × 1.17 for CJK. Today every script gets
30 px (`lab:cjkInPage`).

**Paths.**
- `packages/typeset/src/index.ts`: mark the paragraph it already detects at `:259` with a
  `data-marxy-script="cjk"` attribute, and nothing else
- `scripts/registry.json` (the attribute)
- `packages/theme/src/base.css` (one rule)
- `packages/typeset/test/` (a mark test), `packages/theme/test/grid.test.mjs`
- `fixtures/baselines/**` (`07-cjk` moves), `changelog.d/L-08.1.md`

**Acceptance.**
- In `07-cjk.md` at 960 px, a CJK paragraph's line pitch is 35 px (30 today), and its block height
  is a whole number of grid units (`grid.test.mjs`).
- Every other corpus document's rag and grid baselines are unchanged.

**Do not.** Set leading by `:lang()`: documents are untagged (L-08.2).

**Risks.** The grid pass treats paragraphs as constructed, not as islands. If padding a paragraph
needs a change to `grid.ts`, stop and report.

### L-08.2 — Tag the article with the document's language

**Model:** sonnet · **Size:** S · **Depends on:** B-15 (the render path moves into the view)

**Outcome.** A document that states its language in front matter (`lang: de`, `lang: ja`) is set
in that language:
- the typesetter stops applying English hyphenation patterns to it;
- Han text takes the regional forms its language implies.

An untagged document keeps today's `en`. Most documents are English, and turning hyphenation off for
every untagged file costs more than a few wrong breaks; record that trade in the PR.

**Why now.** Every document is `lang="en"` (`index.html:2`), so untagged French gets
`an-ti-con-sti-tu-tion-nelle-ment` (`lab:hyphenation.typesetter`). Ch. 8: "carry language
information through from every source it can".

**Paths.**
- `packages/core/src/render/frontmatter.ts` (read and validate `lang` as a BCP 47 tag)
- `apps/desktop/src/view/rendered-view.ts` (set `lang` on the article)
- tests beside each
- `changelog.d/L-08.2.md`

**Acceptance.**
- With `lang: de`, no paragraph carries an en-us hyphenation point. This fails today.
- With `lang: ja`, the article has `lang="ja"`.
- An invalid tag is ignored with no notice.
- An untagged document is byte-identical in the gate.

**Do not.** Add language detection, or patterns beyond the allow-list (ADR-0006).

### L-08.3 — Give a scrolling display formula a tab stop

**Model:** sonnet · **Size:** XS · **Depends on:** — · **Parallel with:** anything outside its paths;
not beside B-02.4 or the start-up cleanup, which also edit `startup/idle-work.ts`

**Outcome.** A display formula wider than the column, which scrolls (`base.css:453`), can be reached
and scrolled from the keyboard, as a scrolling table already can.

**Why now.** Ch. 4 "Wide content" and the spec's keyboard check: every scrolling region is reachable.
`focusableScrollers` gives tables a tab stop and nothing else (`startup/idle-work.ts:97-103`).

**Paths.**
- `apps/desktop/src/startup/idle-work.ts` (`focusableScrollers`)
- its test
- `changelog.d/L-08.3.md`

**Acceptance.** A WebKit test at 320 px. It fails today:
- A display formula wider than the column has `tabindex="0"` and an `aria-label`.
- A formula that fits has neither.

### L-09 — Margin notes above 76 em (deferred to after v1)

**Model:** opus · **Size:** L · **Status:** deferred by decision 8; not dispatched.

**Outcome when taken up.** Footnotes sit in the right margin beside their reference when the window
is wider than 76 em, and open in place below that (ch. 4 "Notes", the spec's Notes line). Wide blocks
then yield the right room to the notes column, which revisits decision 1.

**Paths, provisionally.** The core footnote render (`packages/core/src/render/render-html.ts`),
`packages/theme/src/base.css`, `apps/desktop/src/render/*`.

### L-10 — Keep code on the grid at every text size

**Model:** sonnet · **Size:** S · **Status:** merged, [#378](https://github.com/inkstrata/marxy/pull/378)
· *Added 2026-10-07 by the lead, from A-10.4's stop.*

**Outcome (as merged).** At every body size the reader can choose (15–50 px), a code line box is a
whole number of grid units, as design-language constraint 5 asks. `sizeProperties(size)`
(`apps/desktop/src/theme/reader-config.ts:67-74`) now sets four properties, and `applyReaderConfig`
(`:93-117`) applies them, removing all four at the default size:
- `--marxy-size-body`;
- `--marxy-line-box` (`lineBoxFor`, `:49-51`);
- `--marxy-size-code`, from `codeSizeFor` (`:58-60`): 0.9 of the body size to the half pixel, after
  `06-code.md` "Size and the monospace quirk";
- `--marxy-line-box-code`, equal to the body line box (two grid units).

Front-matter code cells are `1.2em` of their caption (`base.css:256`), so the label-to-value
proportion holds at every size. At size 20 nothing changes and no baseline moved.

**Checked by.**
- `packages/theme/test/taste.test.mjs`: every integer size 15–50 measured through `applyReaderConfig`.
- `apps/desktop/test/reader-config.test.mjs`: `sizeProperties(20)` equals the `tokens.css` values.

**Order** (L-01; the lead sequences):
- **Now, on their own paths:** L-11, L-06.1 and L-08.3.
  - L-08.3 edits `startup/idle-work.ts`, which B-02.4 (parked, committed locally) and the later
    start-up cleanup also edit, so it does not run beside either.
  - L-07 and L-11 both edit `source/theme-bridge.ts` (L-11 for Source's find matches). L-11 goes
    first, being smaller, and then L-07, before D-11.
- **After B-02 merges:** L-02, then L-03, then L-04, each alone in its wave for baselines. L-08.1
  follows L-04, once the author has answered decision 9 and F-11 has merged.
- **After B-15:** L-05 (before D-01; otherwise its Source step folds into D-10) and L-08.2.
- **After v1:** L-09.

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
