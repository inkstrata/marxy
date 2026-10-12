# X-21: a design pass on the chrome, Source and the news, toward mock v2

**In short.** The author asked on 2026-10-11 for "an aesthetics/usability pass" on the app chrome and the Source view,
with the emphasis on "movement toward the v2 mockup", checked visually. This pass drove the real app headless and set
each state beside the mock-v2 page that draws it: thirteen screens, Night and Paper, 52 images, in
[`docs/taste-review/2026-10-x21/`](../../taste-review/2026-10-x21/index.html). It finds that the app has the mock's
skeleton (the regions, their sizes, the chrome face and size, the fold model) but not its surface: the bands stop short
of the window and leave a dead column, the toolbar is words, Source has none of its frame, the palette and the
Transform sheet are plainer than their specs, and a notice still pushes the text down. Most gaps are the app not yet
having built what the mock specifies; a few are places where the mock is silent or disagrees with a ruling, and those
are questions for the author. X-19 (notices, errors and popups) is folded in: its twelve questions are carried below,
de-duplicated, beside the new ones. Twelve cards (U-00 to U-10 and V-05) close the gaps biggest first; one draft ADR
(ADR-0070, proposed) makes the app-beside-mock pair a standing part of every UI story. **Nothing here changes product
code.** Written against `origin/main` at `04a5c386`.

## How the evidence was made

- **The app.** The full-app harness of `roadmap-2026-10/harness-map.md`: `apps/desktop/app.html` with the shipped
  skeleton and inline CSS (`test/support/two-pane.mjs`), `bootApplication` over the memory shell, Playwright WebKit,
  headless, 1440 x 900 at a device scale of 1 (760 x 900 for the narrow window). Paper is `variant = "light"` in the
  memory shell's `/config`; the body attribute alone does not take (the harness-map gotcha). The app reads **the mock's
  own corpus** (`mock-v2/shared/corpus.js`, the same paths under `/Users/reader`), so both sides show the Postgres
  upgrade plan, `indexer.rs` and the rest.
- **The mock.** Each mock-v2 page from disk in the same WebKit, with its web fonts from the CDN, the theme set to Night
  or Paper through its own `marxy.prefs`, the one-time fold hint suppressed. The result sheet in 01 is drawn from its own
  markup and classes: since round 7 nothing in the mock calls `resultSheet` (transforms moved into the palette), so it
  cannot be reached by a click.
- **Measured** with `getBoundingClientRect` and computed style in the same pages; every px below is from those runs.
  `capture.mjs` beside the images regenerates them all: from `apps/desktop`, `node
  ../../docs/taste-review/2026-10-x21/capture.mjs <worktree> <outdir>`.
- **Not checked.** Motion (peek, fold, toast timing), VoiceOver, forced colours, the built app's real window (traffic
  lights, title bar, vibrancy). Two harness artefacts are not gaps: the "56y" ages on files opened before the index
  feed arrived (the memory shell reports an mtime of 0) and a library preview heading taken from a shell comment in a
  fence (the capture's own index entries).

## The gaps, ranked by what the reader meets

"Drifted" means the mock (its `.md` is the spec) is right and the app has not got there; "decision" means the mock is
silent, wrong, or disagrees with a ruling, and the author is asked below.

| # | Gap | Evidence (pair, region, measured) | Class | Card |
| --- | --- | --- | --- | --- |
| 1 | **A notice pushes the text down.** It sits in the pane's flow above the article. | `07-notice`, `07-notice-folded`: the h1 moves from y 261 to 300.2 (**39.2 px**) when "Copied as Markdown" arrives; the notice is a 503 x 39 static box with square corners in the text face at 13.05 px. The mock's news is a 219 x 34 pill, bottom centre at y 827 above the status bar, inverted ground, 10 px radius, an icon, 12.5 px chrome face | drifted (the author's rule, 2026-10-11); *where* it floats is a decision (F-46, PR #618, floats it over the pane's top edge, covering the first lines) | U-02 |
| 2 | **A dead column and an empty bar in the unfolded window.** | `01-unfolded`, `03-split`: toolbar, tabs and strip end at x 1188 (w 936); 252 px on the right hold nothing; a 26 px status bar spans the window with no text. In Paper the empty column is a different ground from the page. Cause: `base.css` keeps the grid symmetric (`--marxy-ws-side: max(left, right)`, bands in column 2 only) so the reading column stays window-centred, and the inspector (W-09, PR #607) and status bar (W-11, uncarded) have no fill. The mock's bands run to the window edge (toolbar w 1188 from x 252) | drifted: ADR-0058 item 6 forbids *reflow*, not a band reaching the edge; and W-05's own rule, "a door shows only what is behind it", rules out an empty status bar | U-01 |
| 3 | **Source has no frame.** | `02-source`, `02-source-folded`: the app draws bare text (14 on 21 px, ADR-0067) in a 629 px column from x 406, no gutter for Markdown, no bars. The mock frames it (inset 14 px, radius 13): a 24 px top bar (path segments, UTF-8, LF, indent, 3,116 bytes, 89 lines), a 17 px column ruler, a 46 px gutter, a 24 px bottom bar (Ln, Col, byte, measures, U+002D), an 8 px strip of marks. `02-fold-up-workspace.md` §Split and Source adopts the same frame "whether full-window, in Split, or folded" | drifted (V-05 is in `05-plan.md`, never carded); the Markdown gutter is a decision (L-06.1 and `reader-artifacts/10-spec.md` say off for Markdown, the mock and 02 draw it) | V-05 |
| 4 | **The toolbar is words.** | `01-unfolded`: twelve text buttons (Sidebar, ←, →, Read, Split, Source, report, Copy, ▾, Transform, Find, …); one svg (the kind glyph) against the mock's 17; title and folder on one 13 px line; no `+`, Export or inspector toggle. The mock: 28 px icon buttons (r 999), a 233 px segmented Read / Split / Source with glyphs, a two-line title (13 px / 650) over the path (11 px), "Report" capitalised in a chip, Copy as a split button, Export, Transform as a wand, Find, inspector | drifted | U-03 |
| 5 | **The palette is a bare list.** | `04-palette`, `04-palette-commands`: 640 x 502 at y 32; a 42 px field with no placeholder and no search glyph; 28 px one-line rows; on `>`, **149 rows, no group header, no glyph, no secondary line**, thirteen "Show this file as ..." in the first screen. The mock: 860 x 630 at y 99, a 51 px field with its prompt and an Esc chip, a 39 px row of mode chips, 46 px two-line rows (glyph, title, path or group, key chip), Recent and Suggested groups, a 399 px preview, a 65 px footer of key hints | drifted for the field, glyphs, groups, chips and footer; the preview is W-13; the row height is a decision (W-04 gave every menu, the palette included, a 28 px row) | U-04 |
| 6 | **The Transform sheet wears the reading face and cannot be closed by pointer.** | `06-transform-sheet`: the title "Transform the document" and the column labels are `h2`/`h3` and take the page's heading rule: **Literata 600 at 14.95 px**; no close button; Before and After do not wrap, and the After text runs to the sheet's edge (its `pre` is 1,753 px wide inside a 1,088 px sheet); backdrop 0.1 alpha. The mock: chrome face, a close button, the counts in the header ("3,108 → 3,032 chars"), wrapped columns, Apply as the one filled action at the right | drifted for face, close and wrap; which action is primary is a decision (the palette rule: Enter copies, ⌘Enter replaces) | U-05 |
| 7 | **The sidebar and the tabs are flat.** | `01-unfolded`: the sidebar is a flush 252 px panel with "Library" and "Recent" as plain labels, no search field, no section chevrons, 26 px rows; the mock's is an inset card (x 8, r 13) with a search field (⌘K chip), 11 px / 600 section heads with chevrons and quiet counts, 28 px rows, the index status at the foot. Tabs are 182 px with the close always drawn (far from a short name) and the active tab drawn as a button with an accent line; the mock's are 220 px (130 for a short name), the active one continuous with the page, the close on hover, a `+` at the end | drifted (the tree is W-08; the inset card and the traffic-light inset are a decision tied to the window style) | U-06, U-07 |
| 8 | **The narrow window keeps everything and squeezes the page.** | `08-narrow` (760 px): the 252 px sidebar stays and a 156 px dead column is reserved on the right: the panes get 448 px and the toolbar folds into "…". The mock hides the sidebar below 900 px (and lays the inspector over its own Source pane, which it gets wrong) | decision (the mock is half wrong) | U-08 |
| 9 | **The tool strip is one word.** | `01-unfolded`: "Changes" alone in a 32 px band; the mock's 40 px strip leads with the kind ("REPORT", 11 px / 600) and gives each tool a glyph (Paths, Changes rev 3 → 5, Split by H2) and a customise control | drifted | U-09 |
| 10 | **The library is a list where the mock is a table.** | `05-library`: 49 px two-line rows (title, path, kind) with an age; scopes as text tabs; plain Open buttons. The mock: a collection header with its facts (214 files, 9.7 MB, indexed, watching), Kind / Status / Modified filter menus beside the query, columns (Name, Path, Measure, Modified, Status), 30 px rows, a status bar of counts. The mock is silent on "why it matched", which the app adds and should keep | drifted for the look; Q-04 to Q-08 hold the actions | U-10 |
| 11 | **Code is under-coloured.** | `03-code`: the app colours calls and strings only; the mock gives keywords, types, constants and comments their own hues (comments italic); the app's gutter has no rule and brighter numbers | drifted; V-13 (ADR-0068) is ready and covers it | (V-13) |
| 12 | **Read sets front matter as a table and the h1 large.** | `01-folded`: a key/value head above the title (`reader-artifacts/10-spec.md`, "a quiet key and value head") where the mock folds it to one line ("Front matter · 2 keys, folded", ⌃⌘I to show); h1 33 px / 560 against 29.75 / 590; inline code without the mock's chip | decision (outside the chrome; listed so it is not lost) | none |

Usability, across the screens:

- **Discoverability.** The app's toolbar is legible (words) but long; icons with tooltips and the shortcut in the
  tooltip (the mock) are shorter and leave the title room. The palette has no prompt telling the reader that `>`, `/`,
  `#` and `:` exist; the mock's placeholder and chips are the teaching surface, and the footer names the keys. Keep both.
- **Keyboard paths.** The chords match the mock (W-19: ⌘K and ⌘P, ⇧⌘P, ⌘/, ⌘1 to ⌘3, ⌘E, ⌘\). Not yet: a key to
  dismiss or focus a notice (X-19 question 10), Esc closing a peek (W-03.1, ready), a close button for pointer readers
  on the sheet.
- **Focus.** The palette field shows focus only as a 2 px accent line at its foot, and the sheet's first button takes
  focus with a heavy accent ring. One focus ring for every surface, from the W-04 spec, is in U-04 and U-05.
- **Fold and unfold.** The model is right and matches the mock (two states, windows open folded, remembered panels).
  What breaks the illusion is the unfolded frame: the dead column makes the workspace look unfinished (gap 2).
- **Read, Split, Source.** The mock's segmented control says which one is on with a glyph and a ground; the app says it
  with an accent line under a word. Split gives Read the larger share in the mock (1.3 : 1); the app splits evenly.
- **Where news goes.** Gap 1 and the X-19 questions below.

## Direction

**The recommended path: build the mock's surface onto the skeleton the app already has, in the order the reader sees
it.** The app's regions, sizes and tokens already copy the mock (`base.css`: sidebar 252, inspector 300, toolbar 52,
tabs 34, status 26; the chrome face at 13 px; radii 6, 9 and 13). What is missing is drawing: icons, grounds, the
frame, the groups. So the cards are mostly look and layout inside files that exist, each judged by a pair of
screenshots against the mock screen it moves toward. Five rules hold every card:

1. **The mock's `.md` is the spec, its HTML the picture.** Where the app departs, the departure is written down (an ADR,
   a ruling in the ledger, or a line in the card) and the pair shows it.
2. **Nothing enters the reading column's flow.** Every surface a card adds floats or lives in a region, and joins
   `SURFACES` in `apps/desktop/test/no-displacement.test.mjs`.
3. **A door shows only what is behind it** (W-05's rule, made general): a region or control with nothing to show is
   not drawn, so the unfolded window never shows an empty band.
4. **Tokens only.** Grounds, edges, washes and status colours come from the contract v2 roles (ADR-0059); no literal
   colour in a card's diff.
5. **The column holds still.** Fold, unfold, a dock, a peek, a sheet or a notice never changes the reading column's
   measure, and never moves the line under the eye.

**Where the mock is silent or wrong, two options and a recommendation:**

- **The dead column (gap 2).** (a) Let the bands and the panes' ground run to the window's right edge while the reading
  column stays centred on the window, as now: the column still never moves when the sidebar or inspector comes and
  goes. (b) Centre the column in the space between the panels, as the mock does: it shifts sideways when a panel docks
  (the mock's "it only shifts sideways"). **Recommended (a)**: it removes the dead band and keeps the strongest reading
  of ADR-0058 item 6; (b) is the mock's but moves the text the reader is looking at on every dock.
- **Where a notice floats (gap 1).** (a) At the pane's top edge, as F-46 does: near the toolbar, but over the first
  lines of text. (b) A pill at the bottom centre of the pane, above the status bar, as the mock does: over the last
  lines, away from where the eye usually is, and never under the toolbar. **Recommended (b) for outcomes and refusals**,
  with F-46 as the stopgap it calls itself; a decision the reader must make (Save / Discard on leaving) stays a notice
  with its actions, floating at the same place, until X-19 question 3 is answered.
- **The Markdown gutter in Source (gap 3).** (a) Off for Markdown, as today (L-06.1, `10-spec.md`): prose reads as
  prose. (b) On, as the mock and 02 draw it: every Source is an editor and `path:line` is the task. **Recommended (a)
  with the frame's bottom bar carrying `Ln, Col`**, so the line is always known without numbering prose; the reader's
  `line_numbers` toggle stays.
- **Folded Source.** (a) The frame, centred at 960 px (the mock and 02). (b) The bare column (ADR-0067's centred column,
  today). **Recommended (a)**: the bars are byte facts, and folded Source is still Source; the frame's text column keeps
  ADR-0067's measure inside it.
- **The sheet's primary action (gap 6).** (a) Copy result, as today and as the palette's Enter. (b) Apply, as the mock.
  **Recommended (a)**: one rule across palette and sheet (Enter copies, ⌘Enter applies), drawn the mock's way (filled,
  at the right).
- **Palette rows (gap 5).** (a) 28 px one-line rows (W-04's menu row). (b) The mock's 46 px two-line rows. **Recommended
  (b) in the palette only**: a file's folder and a command's group are what tell two rows apart; menus keep 28 px.
- **The narrow window (gap 8).** (a) Below 900 px the sidebar is not docked by default (it peeks), and the right
  reserve is zero. (b) Keep both docked and let the toolbar overflow. **Recommended (a)**; the inspector, when W-09 lands,
  lays over the page only folded or narrow, never over Source.

### Notices, errors and popups (X-19, folded in)

The chrome pass treats news as chrome. Its recommended answer, for the author to confirm through the questions below:
**outcomes and refusals are floating pills at the bottom centre of the pane they are about, in the chrome face, with
a glyph and a word for the kind (done, not done, needs you), announced politely; they stack upward, at most three, and
fade after 4 s unless the reader is over them or they carry an action; a refusal says what was not done and that the
file is unchanged. A decision the reader must make floats at the same place and stays until answered. Nothing about a
file is ever drawn into its column or its text.** It meets X-19's seven constraints as written (never displace, faithful,
no network, accessible, keyboard reachable, nothing at rest, a pane never moves for the other's news). It needs no new
token: the surface, the status roles and their washes are ADR-0059's. X-19 keeps its own deliverables (the ADR, the
mock-ups from the real stylesheet, the verification plan); U-02 is the implementation card that waits on them.

## Questions for the author

X-19's twelve, de-duplicated (its 1 and 9 are one question here), then the new ones. Each has a recommendation; none is
decided by this pass.

**From X-19 (notices, errors, popups)**

1. **One region for the window or one per pane, and where it floats?** (X-19 1 and 9.) Recommended: per pane, so a split
   window says which file the news is about; app news in the focused pane; floating at the pane's bottom centre (the
   mock), with F-46's top edge as a stopgap.
2. **Transient or persistent?** Recommended: outcomes fade at 4 s (paused under the pointer or focus), refusals and
   errors stay until dismissed, decisions stay until answered.
3. **Where does a decision live?** (Save / Discard on leaving; window close is native.) Recommended: a floating notice
   with its actions, focus moved to it, keyboard-answerable; the native dialog stays for window close.
4. **Does the clipboard get its own surface?** Recommended: not in this pass; copy and paste news uses the common pill
   (format and size, as the mock's "Copied as Markdown · 3.1 KB"); a clipboard surface is its own design.
5. **Do refusals and errors look different from outcomes?** Recommended: yes, by a glyph and a word as well as the
   status colour (`--marxy-color-status-*`), never by colour alone.
6. **Sound or an OS notification?** Recommended: never by default; an opt-in for long jobs is a later question.
7. **A history of past notices?** Recommended: a bounded in-memory list behind a palette command ("Recent notices"),
   nothing on disk.
8. **Where does progress for slow work appear?** Recommended: in the status bar when it exists (W-11), else a quiet pill
   that becomes the outcome when the work ends.
9. **Keys.** Recommended: one key to focus the newest notice (its actions then on Tab), Esc dismisses a focused notice;
   Esc's existing order (sheet, find, peek) is unchanged.
10. **Wording.** Recommended: one template, "what happened · what is unchanged · what to do", applied in one string pass.
11. **What may proceed while the pass runs?** Recommended: wrong-text fixes and F-46 proceed; new notice kinds and new
    popups wait for U-02.

**New from this pass**

12. **The dead column (gap 2): bands to the window edge with the column still window-centred (recommended), or centre
    the column between the panels as the mock does?**
13. **Source frame: build V-05 as the mock and 02 draw it, folded too?** Recommended yes, with the column inside the
    frame at ADR-0067's measure.
14. **Line numbers for Markdown in Source:** off as today (recommended, with `Ln, Col` in the bottom bar) or on as the
    mock?
15. **The Transform sheet's primary action:** Copy (recommended, one rule with the palette) or Apply (the mock)?
16. **Palette rows:** two-line 46 px in the palette (recommended) or W-04's 28 px everywhere?
17. **Toolbar:** icons with tooltips as the mock (recommended), keeping words only on the Read / Split / Source control?
18. **The narrow window:** undock the sidebar below 900 px (recommended)?
19. **Unfolded, Read or Split by default?** The mock's `view` setting opens a report in Split on unfold; the app opens
    Read. Recommended: Read, as today, with the per-kind default in Settings (W-12).
20. **The sidebar as an inset card with the window controls in it** (the mock) or a flush panel (today)? It depends on the
    window's title-bar style (ADR-0038); recommended: the inset card once the title bar is an overlay.
21. **Front matter in Read:** a quiet head above the title (`10-spec.md`, today) or folded to one line (the mock, with
    ⌃⌘I and W-17)? Outside the chrome; recommended to settle with W-17.
22. **Adopt ADR-0070** (every UI story ships an app-beside-mock pair)? Recommended yes.

## Cards

Ordered so the biggest visible gaps close first; U-00 is tooling every done-check uses, so it lands first and in
parallel. Sonnet is the default model. Each card names the mock screen it moves toward, and its done-check includes the
**pair**: the screens named, in Night and Paper, captured by U-00 (until it lands, by
`docs/taste-review/2026-10-x21/capture.mjs`) into `docs/taste-review/<date>-<id>/` with an `index.html`, and compared by
the reviewer with the X-21 pair of the same name. Every card that adds or moves a surface adds it to `SURFACES` in
`apps/desktop/test/no-displacement.test.mjs` (F-45). Paths were checked with `git ls-files` on `04a5c386`; *new*
marks a file that does not exist.

Already planned elsewhere, not re-carded here, and each should gain a pair in its done-check: **W-09** inspector
(PR #607; `01-unfolded`), **W-11** status bar (`01-unfolded`), **W-13** palette preview (`04-palette`), **W-08** sidebar
tree (`01-unfolded`), **V-13** highlighting (`03-code`), **F-46** notices float (PR #618; `07-notice`).

| Id | What | Mock screen | Model / effort | Size | Depends on |
| --- | --- | --- | --- | --- | --- |
| U-00 | The pair harness: `scripts/mock-pair.mjs` | all | sonnet / low | S | — |
| U-01 | The unfolded frame: bands to the edge, no empty region | 01-workspace | sonnet / medium | S | Q12 |
| U-02 | News floats: notices as pills off the column | 01-workspace (toast) | sonnet / high | M | X-19 answers (Q1–Q11), F-46 |
| U-03 | The toolbar in icons, with the segmented view control and the two-line title | 01-workspace | sonnet / medium | M | Q17 |
| V-05 | The Source frame: top bar, ruler, gutter, mark strip, bottom bar | 02-source | sonnet / high | L | Q13, Q14 |
| U-04 | The palette's field, glyphs, groups, chips and footer | 04-palette | sonnet / medium | M | Q16; W-13 for the preview |
| U-05 | The Transform sheet on the chrome spec | 01-workspace (result sheet) | sonnet / low | S | Q15 |
| U-06 | The sidebar's look: search field, section heads, rows | 01-workspace | sonnet / medium | S | Q20 for the inset card |
| U-07 | The tabs' look: width, active ground, close on hover, `+` | 01-workspace | sonnet / low | S | — |
| U-08 | The narrow window | 01-workspace at 760 | sonnet / low | S | Q18, U-01 |
| U-09 | The tool strip: the kind label and glyphs | 01-workspace, 03-content-modes | sonnet / low | S | — |
| U-10 | The library's table: columns, filters, header | 05-collections | sonnet / medium | M | Q-03 (merged) |

---

### U-00 — The pair harness: one command makes the app-beside-mock pair for a screen

**Model:** sonnet (low) · **Size:** S · **Depends on:** nothing · **Parallel with:** everything

**Outcome.** `node scripts/mock-pair.mjs <screen...> --out <dir>` boots the full app in the harness over the memory shell
with the mock's corpus, drives it to each named state (the thirteen of X-21: `01-folded`, `01-unfolded`, `02-source`,
`02-source-folded`, `03-split`, `03-code`, `04-palette`, `04-palette-commands`, `05-library`, `06-transform-sheet`,
`07-notice`, `07-notice-folded`, `08-narrow`), renders the matching mock-v2 page, and writes
`<screen>-<night|paper>-{app,mock}.png` plus an `index.html` of the pairs. Headless WebKit, no GUI. The mock may load its
fonts from the network; the app page may not (the no-network rule is unchanged for the app).

**Why now.** ADR-0070 asks every UI story for a pair; without one command, every story re-writes X-21's capture.

**Paths.** *New:* `scripts/mock-pair.mjs` (lifted from `docs/taste-review/2026-10-x21/capture.mjs`), `scripts/mock-pair.test.mjs`
(node: the screen table, the file names, the refusal of an unknown screen). *Edit:* `docs/hygiene.md` (one row),
`docs/ci-contract.md` (says it is not on the PR path). *Read:* `apps/desktop/test/support/two-pane.mjs`,
`roadmap-2026-10/harness-map.md`.

**Acceptance.** Run on `main`, it reproduces X-21's 52 images (same states; pixels may differ by font hinting). A typo in a
screen name exits non-zero and lists the names. It never runs in CI.

**Do not.** Put it on the PR path; gate on pixel equality (the pair is for a human).

---

### U-01 — The unfolded frame: the bands reach the window edge, and no region shows empty

**Model:** sonnet (medium) · **Size:** S · **Depends on:** the author's Q12 (recommended option (a)) · **Parallel with:**
U-03, U-04, U-05, V-05 · **Mock:** `01-workspace` (unfolded)

**Outcome.** Unfolded, the toolbar, tabs and strip span from the sidebar's edge to the window's right edge (to the
inspector's edge when it is docked); the panes' ground does too; the reading column stays exactly where it is today,
centred on the window, at its measure. The status bar region is not drawn while nothing fills it (it appears when W-11
registers a fill), and the inspector reserve is zero while the inspector is hidden or has no fill. Folded is unchanged.

**Why now.** It is the largest visible gap in every unfolded pair, and the fix is CSS in one block of `base.css`.

**Paths.** *Edit:* `packages/theme/src/base.css` (the `body[data-marxy-workspace="unfolded"]` block: the band columns
`2 / -1` when the inspector is hidden; `#marxy-main` keeps its centred column by its own margin, not by the mirror
column), `apps/desktop/src/workspace/state.ts` or `regions.ts` (a region with no fill is `hidden`: `hasFill` already
exists), `apps/desktop/src/workspace/workspace.test.mjs` (geometry). *Read:* ADR-0058 item 6, `INSPECTOR_MIN_WINDOW`.

**Acceptance.** At 1440 x 900 with the sidebar docked and no inspector: the toolbar's right edge is 1440 (today 1188);
no element covers x 1188 to 1440 with a different ground from the page; the status bar region is `hidden` while
unfilled; the reading column's left edge and width are identical to `main` (W-02's geometry test). Docking and undocking
the sidebar does not move the column. **Pair:** `01-unfolded`, `03-split`, Night and Paper, against X-21's.

**Tests and gates.** `workspace.test.mjs`, `toolbar.test.mjs`, `tabs.test.mjs`, `sidebar.test.mjs`; `gate:aesthetics`
(both states; the folded cases unchanged); `pnpm check`.

**Do not.** Move the reading column; touch the folded page; add a fill to the status bar or inspector (W-11, W-09).

**Risks.** The mirror column is also what keeps the column centred when the sidebar docks; the replacement must hold that
with a test, not by eye.

---

### U-02 — News floats: every notice is a pill off the reading column

**Model:** sonnet (high) · **Size:** M · **Depends on:** X-19's ADR and the author's answers to Q1 to Q11; F-46
(PR #618) merged first, as the stopgap this replaces · **Parallel with:** U-01, U-03 · **Mock:** `01-workspace` (the
toast, `G.toast` in `mock-v2/shared/app.js`)

**Outcome.** As X-19's ADR rules; the recommended form: each pane's notice region is a floating layer at the pane's
bottom centre, above the status bar; a notice is a pill in the chrome face with a glyph and a kind word (done, not done,
needs you), its text, and its actions; outcomes fade at 4 s, paused under the pointer or focus; refusals and errors stay
until dismissed; a decision stays until answered and takes focus. Up to three stack upward. `role="status"` stays
polite; a decision is `role="alertdialog"`. A key focuses the newest notice and Esc dismisses a focused one. Nothing moves
the text, folded, unfolded, in Split or in Source.

**Why now.** It is the author's rule ("nothing inserted into the document's flow") and the top gap; F-46 only moves the
box.

**Paths.** *Edit:* `apps/desktop/src/notices/index.ts` (the region and the line; the kinds gain `refused` and `decision`
beside `blocked` and `info`), `packages/theme/src/base.css` (`#marxy-notices`, `.marxy-notice*`, on the surface spec of
W-04), `apps/desktop/index.html` (the inline copy), `scripts/registry.json` (any new class or data attribute),
`apps/desktop/test/no-displacement.test.mjs` (notices join `SURFACES` if F-46 has not added them),
`docs/design/09-app-shell.md` §Notices, `apps/desktop/src/close.ts` only for the decision's role and focus.
*Read:* X-19's inventory (`16-design-pass-notifications.md`), `notices/blocked.ts`, `notices/disk.ts`.

**Acceptance.** A notice raised and dismissed with the article scrolled, folded, unfolded, in Split and in Source: the
first visible line's rect and `scrollTop` are unchanged to the pixel (F-45's guard, both panes). A transient notice is
gone after 4 s and stays while hovered. The unsaved-changes decision is answerable by keyboard alone. Forced colours
keep its outline; reduced motion removes its slide. **Pair:** `07-notice`, `07-notice-folded`, Night and Paper.

**Tests and gates.** `no-displacement.test.mjs`, `round3-desktop.test.mjs`, `pane-close-guard.test.mjs`,
`close-guard.test.mjs`; `gate:aesthetics` (its notice rows); `pnpm check`.

**Do not.** Change a notice's words (the wording pass is its own card after Q10); add sound or OS notifications; keep a
history on disk.

**Risks.** The aesthetics gate's notice cells (L-05) were written for an in-flow notice; F-46 already retires
`noticeColumn/sight`; the rest move with the baselines in this PR.

---

### U-03 — The toolbar in icons, with the segmented view control and the two-line title

**Model:** sonnet (medium) · **Size:** M · **Depends on:** Q17 · **Parallel with:** U-01, U-04 · **Mock:** `01-workspace`
(toolbar; `01-workspace.md` §Toolbar controls)

**Outcome.** The toolbar reads as the mock's: the sidebar toggle, back and forward as 28 px icon buttons in a pill; the
title (13 px / 650) over the folder path (11 px, secondary), right-click for Reveal and Open in external editor; Read /
Split / Source as one segmented control with a glyph and a word each; the kind chip capitalised ("Report") with its glyph;
`+`, Copy (split), Export, Transform (wand), Find, inspector toggle as icon buttons with tooltips naming the shortcut.
A control whose command is absent is not drawn (W-05). The overflow keeps its fade and its `…`.

**Why now.** The toolbar is in every unfolded screen; today it is twelve words.

**Paths.** *New:* `apps/desktop/src/workspace/toolbar-icons.ts` (the glyphs as inline SVG strings, drawn with
`currentColor`; the set's licence in the file head). *Edit:* `apps/desktop/src/workspace/toolbar.ts`
(`TOOLBAR_ITEMS`, `mountToolbar`), `apps/desktop/src/workspace/kind-chip.ts` (the label's case),
`packages/theme/src/base.css` (`.marxy-toolbar`), `scripts/registry.json`, `apps/desktop/src/workspace/toolbar.test.mjs`,
`toolbar-items.test.ts`. *Read:* `kind-icons/icons.ts` (the glyph style to match).

**Acceptance.** Every control has an accessible name and a tooltip with its key; the segmented control is a radio group
(arrow keys move, one tab stop); at chrome size 26 the row still scrolls with the fade; no svg uses a literal colour.
**Pair:** `01-unfolded`, Night and Paper.

**Tests and gates.** `toolbar.test.mjs`, `toolbar-items.test.ts`, `workspace.test.mjs`; `pnpm check` (registry, licence).

**Do not.** Add a control the mock does not have; change a command's behaviour; draw a theme button (the mock has none).

**Risks.** An icon set is a dependency: Lucide (ISC) is the mock's; copy only the glyphs used, with the licence.

---

### V-05 — The Source frame: top bar, ruler, gutter, mark strip, bottom bar

**Model:** sonnet (high) · **Size:** L · **Depends on:** Q13 and Q14; V-12 (merged) · **Parallel with:** U-03, U-04 ·
**Mock:** `02-source` (`02-source.md` §Anatomy; `02-fold-up-workspace.md` §Split and Source)

**Outcome.** Source sits in a frame: a hairline edge (`--marxy-color-rule`), radius 13, text on the page ground, inset
12 to 14 px from the pane unfolded and centred at 960 px folded. A 24 px top bar: the path as quiet segments; encoding,
line endings, indentation as detected, size in bytes, line count (endings and indentation open their menu). A 16 px
column ruler on the editor's character grid (ticks every 5 and 10, numbers every 10, the caret's column, a selection's
span), hidden below 520 px and with soft wrap. The gutter as ADR-0067 rules (off for Markdown unless Q14 says on). An
8 px right strip of marks at exact bytes (invisible and bidi characters, find matches). A 24 px bottom bar: `Ln, Col ·
byte`, the measures, the character under the caret by code point and name, the language. Every item is derived from
the bytes; nothing interprets them. The text inside keeps ADR-0067's size, line box and column.

**Why now.** Source is half the author's ask; the frame is the visible difference between "a text box" and "an editor
that shows exactly what a file contains".

**Paths.** *New:* `apps/desktop/src/source/frame.ts` (the bars, mounted around `.cm-editor`), `apps/desktop/src/source/ruler.ts`,
`apps/desktop/src/source/frame.test.mjs` (WebKit). *Edit:* `apps/desktop/src/source/editor-cm6.ts` (mount point),
`packages/theme/src/base.css` (the frame block), `apps/desktop/index.html`, `scripts/registry.json`,
`docs/design/09-app-shell.md` §Source mode. *Read:* `source/line-numbers.ts`, `source/stray-bytes.ts`, ADR-0067.

**Acceptance.** The ruler tick for column N is within 0.5 px of character N's centre at 14 and 18 px Source text (the
mock's own check is 0.04 px with a Range); the bars never cover text and scroll does not move them; a CRLF file says
CRLF, a mixed one Mixed, a BOM file "UTF-8 with BOM"; the bottom bar's code point names U+200B. Opening Source does not
move the reading column of the other pane. **Pair:** `02-source`, `02-source-folded`, `03-split`, Night and Paper.

**Tests and gates.** `frame.test.mjs`; the Source WebKit tests; `gate:aesthetics` (its Source rows); `pnpm check`.

**Do not.** Add a formatting toolbar, minimap, outline or lint marks on the text; change Source metrics (ADR-0067).

**Risks.** Bar heights change the number of lines in view (ADR-0067's "about 37 in 800 px"): say the new count.

---

### U-04 — The palette's field, glyphs, groups, chips and footer

**Model:** sonnet (medium) · **Size:** M · **Depends on:** Q16; W-13 for the preview pane (not in this card) ·
**Parallel with:** U-03, V-05 · **Mock:** `04-palette` (`04-palette.md` §Anatomy)

**Outcome.** The palette is 860 px wide (clamped to the window), its field has a search glyph, the prompt "Search files,
or type > for commands, / for content, # headings, : for a line" and an Esc chip; a row of mode chips (Everything,
Commands >, Headings #, Sections @, Content /, Collections ~, Line :) as toggle buttons; results in groups with a header
(Recent, Suggested, Files, and each command group: Navigate, File, View, Copy, Source, Extract, Transform); rows of two
lines (glyph, title, folder or group; the key or age at the right); a footer of key hints. The "Show this file as ..."
commands collapse into one row that opens its own list. Leaves room for W-13's preview at the right.

**Why now.** The palette is the folded window's only door; the mock's prompt and chips are how a reader learns the modes.

**Paths.** *Edit:* `apps/desktop/src/palette/view.ts`, `apps/desktop/src/palette/commands.ts` (group names),
`apps/desktop/src/palette/empty-state.ts` (Suggested), `packages/theme/src/base.css` (`#marxy-palette` layout; rows keep
the W-04 ratios at two lines), `scripts/registry.json`, `apps/desktop/test/palette.test.mjs`. *Read:* `palette/keys.ts`,
`kind-icons/icons.ts`.

**Acceptance.** A chip click swaps the prefix and keeps the query; the listbox announces the highlighted row and its
group; `>` shows group headers and no group has more than one "Show this file as" row; the field has an accessible name
and the prompt; keyboard order is field, chips, list. **Pair:** `04-palette`, `04-palette-commands`, Night and Paper.

**Tests and gates.** `palette.test.mjs`, `no-displacement.test.mjs` (the palette is already a surface); `pnpm check`.

**Do not.** Build the preview (W-13) or `@` sections; change ranking (A-06).

---

### U-05 — The Transform sheet on the chrome spec

**Model:** sonnet (low) · **Size:** S · **Depends on:** Q15 · **Parallel with:** everything except W-21.1 (same file; land
after it) · **Mock:** `01-workspace` result sheet (`01-workspace.md` §Result sheet)

**Outcome.** The sheet's title and column labels are in the chrome face (no page heading rule reaches them); a close
button at the top right (Esc as before); the header carries the chain and the counts ("3,108 → 3,032 characters");
Before and After wrap, padded inside their columns, with a hairline between; the primary action is drawn filled at the
right (Copy result per Q15's recommendation, Apply beside it), the others at the left; the backdrop is the palette's.

**Why now.** It is the most visible place where reading type leaks into chrome.

**Paths.** *Edit:* `apps/desktop/src/transform/sheet.ts` (its runtime sheet `marxy-transform-style`; the `h2`/`h3`),
`apps/desktop/test/transform-sheet.test.mjs`. *Read:* `base.css` surface spec.

**Acceptance.** Computed font-family of the title is `--marxy-face-chrome`'s; no element inside the sheet is wider than
the sheet; the close button has a name and returns focus where it came from. **Pair:** `06-transform-sheet`, Night and
Paper.

**Tests and gates.** `transform-sheet.test.mjs`, `transform-clipboard.test.mjs`, `no-displacement.test.mjs`.

**Do not.** Change what the actions do or their keys; touch the chain's worker (W-21.1).

---

### U-06 — The sidebar's look: search field, section heads, rows

**Model:** sonnet (medium) · **Size:** S · **Depends on:** W-07 (merged); Q20 only for the inset card · **Parallel with:**
U-07, W-08 (separate rules; coordinate `sidebar-view.ts`) · **Mock:** `01-workspace` (sidebar; `01-workspace.md` round 6)

**Outcome.** A search field at the top that opens the palette (⌘K chip); section heads at 11 px / 600 in the faint text
role with a chevron and a quiet count when collapsed; rows of 28 px with the kind glyph, the title and a quiet age; the
active document's row on the accent wash; the index status and Settings at the foot. With Q20 answered (a), the panel
becomes the inset card (8 px margin, radius 13) and reserves the window controls' row.

**Paths.** *Edit:* `apps/desktop/src/workspace/sidebar-view.ts`, `packages/theme/src/base.css` (the sidebar block),
`scripts/registry.json`, `apps/desktop/test/sidebar.test.mjs`.

**Acceptance.** Every head is a button with `aria-expanded`; the search field has a name and opens the palette; rows keep
one tab stop with arrow roving. **Pair:** `01-unfolded`, Night and Paper.

**Do not.** Add Repositories or Folders (W-08).

---

### U-07 — The tabs' look: width, active ground, close on hover, the `+`

**Model:** sonnet (low) · **Size:** S · **Depends on:** W-06 (merged) · **Parallel with:** U-06 · **Mock:** `01-workspace`
(tabs)

**Outcome.** Tabs up to 220 px, shrinking to fit; the active tab's ground is the page's and continuous with it (no
button outline, no accent underline); the close button shows on hover, focus and the active tab; the unsaved dot takes its
place when dirty; a `+` at the end opens the New menu (W-14's commands, drawn only if registered).

**Paths.** *Edit:* `apps/desktop/src/workspace/tabs-view.ts`, `packages/theme/src/base.css` (`.marxy-tabs`),
`apps/desktop/src/workspace/tabs.test.mjs`.

**Acceptance.** A short name's close sits beside it; the active tab is distinguishable without colour (a ground and a
weight); the `+` is absent when no New command exists. **Pair:** `01-unfolded`, Night and Paper.

---

### U-08 — The narrow window

**Model:** sonnet (low) · **Size:** S · **Depends on:** U-01, Q18 · **Parallel with:** U-06 · **Mock:** `01-workspace` at
760 px (the sidebar half; not its inspector-over-Source half)

**Outcome.** Below 900 px the sidebar is not docked by default (the left edge still peeks it, its key still docks it),
the right reserve is zero, and the panes take the window; the toolbar drops its title before its controls (as the mock's
`.tb-title` rule). Above 900 px nothing changes.

**Paths.** *Edit:* `apps/desktop/src/workspace/state.ts` (`arrangementFor`, beside `INSPECTOR_MIN_WINDOW`),
`packages/theme/src/base.css`, `apps/desktop/src/workspace/workspace.test.mjs`.

**Acceptance.** At 760 px the panes are at least 700 px wide (today 448); a remembered docked sidebar is still honoured
when the reader docked it at this width. **Pair:** `08-narrow`, Night and Paper.

---

### U-09 — The tool strip: the kind label and glyphs

**Model:** sonnet (low) · **Size:** S · **Depends on:** K-07 (merged) · **Parallel with:** everything · **Mock:**
`01-workspace` (strip), `03-content-modes` (one strip per kind)

**Outcome.** The strip leads with the kind in capitals (11 px / 600, faint), each tool has a glyph and a word, at most
four tools per kind as the mock lists them (round 6), and the band is 40 px; a kind with no tools hides the band (W-05).

**Paths.** *Edit:* `apps/desktop/src/workspace/strip.ts`, `apps/desktop/src/workspace/kind-chip.ts` (`mountStrip`),
`packages/theme/src/base.css`, `apps/desktop/src/workspace/strip.test.ts`.

**Acceptance.** The reading column does not move when the strip appears or hides (the band height is reserved by the
grid). **Pair:** `01-unfolded`, Night and Paper.

---

### U-10 — The library's table: columns, filters, header

**Model:** sonnet (medium) · **Size:** M · **Depends on:** Q-03 (merged) · **Parallel with:** U-04 · **Mock:**
`05-collections` (`05-collections.md`)

**Outcome.** A header with the scope's name and facts (files, size, indexed, watching); filter menus (Kind, Status,
Modified) beside the query field that write query terms; rows as a table (Name with glyph, Path, Measure, Modified,
Status marks) at 30 px; "why it matched" kept as a quiet second line or a column (the mock is silent; keep the app's).
The preview's actions on the surface spec.

**Paths.** *Edit:* `apps/desktop/src/library/view.ts`, `apps/desktop/src/library/rows.ts`, `packages/theme/src/base.css`,
`apps/desktop/test/library.test.mjs`.

**Acceptance.** The table is a grid with column headers announced; sorting by a header matches the Sort control; the
filters only write query text (no hidden state). **Pair:** `05-library`, Night and Paper.

**Do not.** Add bulk actions (Q-05, Q-08).

---

## What this unblocks, and the ledger

- **X-19** keeps its row (`needs author`); its questions are 1 to 11 above, and U-02 is its implementation card.
- **W-04.1** (notices on the chrome spec) is absorbed by U-02 if the author agrees; until then it stays paused.
- New ledger rows, all `waiting on X-21`: U-00 to U-10 and V-05.
- **ADR-0070** (proposed): every UI story ships an app-beside-mock pair, and the mock's `.md` is the chrome spec until an
  ADR or ruling departs from it.
