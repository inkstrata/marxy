# X-33: Source's layout across modes, sizes and kinds

Investigation only; no product code. Driver: [`matrix.mjs`](matrix.mjs) (`node docs/taste-review/2026-10-14-source-layout/matrix.mjs`,
about 5 minutes, headless WebKit, rewrites `results.json`, `matrix.md` and `shots/`). Raw boxes for every cell, including
the gutter and fold-gutter rows, are in [`results.json`](results.json); screenshots are in [`shots/`](shots/).

## The answer for F-98

**F-98's cause is not in Source's layout at all. It lives in one configuration: the release build's Content Security Policy.**
In the shipped CSP (`apps/desktop/src-tauri/tauri.conf.json`: `style-src 'self'`, no `'unsafe-inline'`; a release build adds a style
nonce, which makes WebKit ignore `'unsafe-inline'` anyway, `docs/design/06-shell.md`) every runtime `<style>` element is refused.
CodeMirror styles itself with runtime `<style>` elements (style-mod's `StyleSet` creates a `<style>` under `document.head`; it uses a
constructable sheet only for a ShadowRoot), so **no CodeMirror rule applies at all**: not the base theme, and not Marxy's own
theme (`apps/desktop/src/source/theme-bridge.ts`). Without the base theme `.cm-scroller` is `display: block` instead of
`display: flex`, so the fold gutter, the number gutter and the text stack one under another; the font is `system-ui`, the line
height is `normal`, the focus ring is the browser's, and there is no gutter column. That is every row of the F-98 table.

Every layout rule in `theme-bridge.ts` is correct: **48 of 48 cells that run under the dev harness (no CSP) lay out right**, in
every mode, kind and size (table below). The same cells under the release CSP (`csp-*`) reproduce the author's screenshot
exactly. Compare [`source-gutter-broken.png`](../2026-10-14-source-gutter/source-gutter-broken.png) with
[`shots/csp-untitled.png`](shots/csp-untitled.png) (and `csp-base`, `csp-rs`): chevron at the top, a tall empty block (the fold
column's invisible rows), a second chevron above `1`, numbers `1`-`20` stacked, the text a full gutter-height below, a blue focus
ring round the text only.

**Where F-98's implementor starts**

- Culprit: `apps/desktop/src/source/editor.ts`, `baseExtensions()` (the `exts` array): it installs no `EditorView.cspNonce`, and no
  code in the repo does (`grep -rn "cspNonce\|nonce" apps/desktop/src` finds only the comment in `frontispiece/index.ts`). The
  policy is `tauri.conf.json` `app.security.csp` `style-src`. The CSP gate (`scripts/check-csp.mjs`, `test/release-csp.test.mjs`)
  covers the palette, KaTeX, hyphenation and the user theme, and never mounts an editor, which is why this shipped.
- Verified fix shape, in the harness: adding `EditorView.cspNonce.of(document.querySelector('style[nonce]')?.nonce ?? '')` to
  `baseExtensions` makes `csp-base`, `csp-untitled` and `csp-rs` all pass (scroller `display: flex`, JetBrains Mono, numbers on
  their rows). I reverted it; it is not in this PR. Two refusals still log in that harness (`app.html`, unattributed; possibly
  my skeleton injection), so do not assert zero refusals without checking what they are. **Unverified in the real shell**: the
  harness injects the nonce on every `<style>` (`injectStyleNonces`), the way `release-csp.test.mjs` does; whether Tauri puts a
  readable nonce on the page's inline `<style>` in the packaged app must be confirmed with `scripts/smoke-built-app.mjs`
  (tauri-driver). If it does not, the alternatives are: host the editor in a ShadowRoot (style-mod then uses an adopted sheet),
  or load CodeMirror's rules from a static stylesheet instead of runtime `<style>`.
- **The card's reproduction will not fail on main in the dev harness.** `source-gutter.test.mjs` boots the dev build with no CSP, and
  all 48 non-CSP cells pass on main. The F-98 test must serve the built app under the release policy and nonce, as
  `release-csp.test.mjs` does (`releaseStyleCsp`, `injectStyleNonces`), open Source (Cmd+3), and assert: `.cm-scroller` is
  `display: flex`, the first `.cm-lineNumbers` row top equals the first `.cm-line` top (my `csp-*` cells: 457.6 against 43/64 on
  main, a 300 px drift), and the content font is the mono face. Do it for a Markdown and a code file, and for the block editor
  inside Rendered (same CodeMirror, same CSP; not measured here).
- F-98's guess ("gutter elements losing their flex row ... a `display` or `position` rule from a recent V-12 or W-12 change") is wrong, and
  its "check whether it needs both fold and numbers" question is answered: it needs neither. A short document with no fold marks is
  just as broken under the CSP, and every fold/number combination is fine without it.

The card's claim 3 (20 numbers for 19 lines, "a blank line with no number") is the same stack: the status bar's `19 lines` is the
bar's own count and the 20th row is the empty line after the final newline (the caret is at Ln 20). It is not a count bug in the
gutter: all cells show numbered rows equal to the line count.

## Method

Document: 20 lines, line 7 blank, line 12 a 299-character line (`line N ab...` for the rest). Real app (`bootApplication` over the
memory shell, the shipped `index.html` skeleton and inline style) in headless Playwright WebKit, 1000 x 800 unless the cell says
otherwise. Baseline `base-night`: a saved Markdown file, folded window, one pane, Source, line numbers on (`line_numbers = true`),
folding on, no aids, Night. Every other cell changes one thing off the baseline; combinations are those the screenshot's case needs
(Untitled with numbers on, in each window state, width, theme and aid). Untitled is built two ways: typed (Cmd+N, Source, keyboard) and
`handle.openScratch`. Boxes are `getBoundingClientRect` in CSS px; "gutters" is `.cm-gutters`; "numbered rows" counts visible
`.cm-lineNumbers .cm-gutterElement`s with digits; lines is `doc.lines`; gaps are the editor's left and right distance from its pane.
A cell is judged wrong when the first number is more than 1 px off the first line's top, the gutter is right of the text or above it, rows
drift, numbered rows differ from the line count, the scroller is not `display: flex`, or a gutter is duplicated. Screenshots: Night
for every cell, plus Paper for the baseline (`base-paper`) and the Untitled case (`untitled-typed-paper`,
`combo-untitled-w1400-paper`). Wrap is not a setting: Markdown, text and Untitled wrap (prose look), code does not (code look); both
are in the table. "Folding off" exists only in large-file mode (`gutterExtensions(!isLargeSourceFile)`); `large-*` cells use a 2.1 MB
file with lines 5 and 12 padded (over `LARGE_FILE_BYTES`, 2,097,152). The special-characters view is always on; `special-*` cells put
zero-width, BEL, no-break space, tab and a bidi override into the text. "unf" is the unfolded window, "P" is Paper.

## Matrix

Columns: gutters top/left and first `.cm-line` top/left in px; numbered rows over line count (`-` where the active editor is not
the one counted, i.e. Split and the CSP harness); the editor's gap to its pane's left and right edge.

| cell | file | width | gutters top/left | first .cm-line top/left | numbered rows / lines | editor left gap / right gap to pane | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| base-night | doc.md | 1000 | 43/129.5 | 64/213.5 | 20 / 20 | 29 / 29 | ok |
| base-paper | doc.md | 1000 P | 43/129.5 | 64/213.5 | 20 / 20 | 29 / 29 | ok |
| kind-txt | doc.txt | 1000 | 43/129.5 | 64/213.5 | 20 / 20 | 29 / 29 | ok |
| kind-rs | doc.rs | 1000 | 60/29 | 81/113 | 20 / 20 | 29 / 29 | ok |
| kind-json | doc.json | 1000 | 60/29 | 81/113 | 20 / 20 | 29 / 29 | ok |
| kind-py | doc.py | 1000 | 60/29 | 81/113 | 20 / 20 | 29 / 29 | ok |
| kind-log | doc.log | 1000 | 60/29 | 81/113 | 20 / 20 | 29 / 29 | ok |
| kind-csv | doc.csv | 1000 | 60/29 | 81/113 | 20 / 20 | 29 / 29 | ok |
| kind-noext | doc | 1000 | 60/29 | 81/113 | 20 / 20 | 29 / 29 | ok |
| ln-off | doc.md | 1000 | none | 64/213.5 | 0 / 20 | 29 / 29 | ok |
| ln-off-rs | doc.rs | 1000 | none | 81/113 | 0 / 20 | 29 / 29 | ok |
| ln-default-md | doc.md | 1000 | none | 64/213.5 | 0 / 20 | 29 / 29 | ok |
| ln-default-rs | doc.rs | 1000 | 60/29 | 81/113 | 20 / 20 | 29 / 29 | ok |
| ln-toggled-on-md | doc.md | 1000 | 43/129.5 | 64/213.5 | 20 / 20 | 29 / 29 | ok |
| ln-toggled-off-on-rs | doc.rs | 1000 | 60/29 | 81/113 | 20 / 20 | 29 / 29 | ok |
| large-md | doc.md | 1000 | 60/29 | 81/113 | 20 / 20 | 29 / 29 | ok |
| large-rs | doc.rs | 1000 | 60/29 | 81/113 | 20 / 20 | 29 / 29 | ok |
| large-ln-off | doc.md | 1000 | none | 81/113 | 0 / 20 | 29 / 29 | ok |
| aid-whitespace | doc.md | 1000 | 43/129.5 | 64/213.5 | 20 / 20 | 29 / 29 | ok |
| aid-column-guide | doc.md | 1000 | 43/129.5 | 64/213.5 | 20 / 20 | 29 / 29 | ok |
| aid-both-rs | doc.rs | 1000 | 60/29 | 81/113 | 20 / 20 | 29 / 29 | ok |
| special-md | doc.md | 1000 | 43/129.5 | 64/213.5 | 20 / 20 | 29 / 29 | ok |
| special-rs | doc.rs | 1000 | 60/29 | 81/113 | 20 / 20 | 29 / 29 | ok |
| untitled-typed-ln-on | Untitled (typed) | 1000 | 43/110.4 | 64/194.4 | 20 / 20 | 29 / 29 | ok |
| untitled-typed-ln-default | Untitled (typed) | 1000 | 43/110.4 | 64/194.4 | 20 / 20 | 29 / 29 | ok |
| untitled-typed-ln-off | Untitled (typed) | 1000 | none | 64/194.4 | 0 / 20 | 29 / 29 | ok |
| untitled-typed-toggle | Untitled (typed) | 1000 | none | 64/194.4 | 0 / 20 | 29 / 29 | ok |
| untitled-typed-toggle-twice | Untitled (typed) | 1000 | 43/110.4 | 64/194.4 | 20 / 20 | 29 / 29 | ok |
| untitled-scratch-ln-on | Untitled (scratch) | 1000 | 43/110.4 | 64/194.4 | 20 / 20 | 29 / 29 | ok |
| untitled-typed-paper | Untitled (typed) | 1000 P | 43/110.4 | 64/194.4 | 20 / 20 | 29 / 29 | ok |
| unfolded | doc.md | 1000 unf | 89/273 | 110/357 | 20 / 20 | 21 / 21 | ok |
| unfolded-untitled | Untitled (typed) | 1000 unf | 146/273 | 167/357 | 20 / 20 | 21 / 21 | ok |
| unfolded-rs | doc.rs | 1000 unf | 129/273 | 150/357 | 20 / 20 | 21 / 21 | ok |
| split-mode | doc.md | 1500 unf | 89/771 | 110/855 | 20 / - | 21 / 21 | ok |
| split-mode-folded | doc.md | 1000 | 43/523 | 64/607 | 20 / - | 23 / 23 | ok |
| two-panes-folded | doc.md | 1000 | 43/23 | 64/107 | 20 / 20 | 23 / 23 | ok |
| two-panes-folded-both-source (pane 1) | doc.md | 1000 | 43/23 | 64/107 | 20 / 20 | 23 / 23 | ok |
| two-panes-folded-both-source (pane 2) | doc.md | 1000 | 43/523 | 64/607 | 20 / 20 | 23 / 23 |  |
| w800 | doc.md | 800 | 43/29.5 | 64/113.5 | 20 / 20 | 23 / 23 | ok |
| w1400 | doc.md | 1400 | 43/329.5 | 64/413.5 | 20 / 20 | 229 / 229 | ok |
| w1920 | doc.md | 1920 | 43/589.5 | 64/673.5 | 20 / 20 | 489 / 489 | ok |
| w1400-rs | doc.rs | 1400 | 60/229 | 81/313 | 20 / 20 | 229 / 229 | ok |
| w1920-rs | doc.rs | 1920 | 60/489 | 81/573 | 20 / 20 | 489 / 489 | ok |
| w800-untitled | Untitled (typed) | 800 | 43/23 | 64/107 | 20 / 20 | 23 / 23 | ok |
| w1400-untitled | Untitled (typed) | 1400 | 43/310.4 | 64/394.4 | 20 / 20 | 229 / 229 | ok |
| h600 | doc.md | 1000 | 43/129.5 | 64/213.5 | 20 / 20 | 29 / 29 | ok |
| combo-untitled-unfolded-ws | Untitled (typed) | 1000 unf | 146/273 | 167/357 | 20 / 20 | 21 / 21 | ok |
| combo-untitled-guide | Untitled (typed) | 1000 | 43/110.4 | 64/194.4 | 20 / 20 | 29 / 29 | ok |
| combo-untitled-w1400-paper | Untitled (typed) | 1400 P | 43/310.4 | 64/394.4 | 20 / 20 | 229 / 229 | ok |
| csp-base | doc.md | 1000 | 43/29 | 457.6/29 | 20 / - | 29 / 29 | first number -300 px from first line top; rows drift up to 300.2 px; scroller display block |
| csp-untitled | Untitled (scratch) | 1000 | 43/29 | 457.6/29 | 20 / - | 29 / 29 | first number -300 px from first line top; rows drift up to 300.2 px; scroller display block |
| csp-rs | doc.rs | 1000 | 60/29 | 360.2/29 | 20 / - | 29 / 29 | first number -300 px from first line top; rows drift up to 300.2 px; scroller display block |


Reading the table by axis:

- **Kind**: Markdown, text and Untitled use the prose look (gutter 129.5 or 110.4 px from the window edge at 1000 px, text column
  centred); code kinds use the code look (gutter at the pane edge at 1000 px, text 84 px in). No difference among `.rs`, `.json`,
  `.py`, `.log`, `.csv` or no extension.
- **Line numbers** on/off/default/toggled at run time, for Markdown, code and Untitled: right in every cell. The default for Untitled
  is on, for a saved `.md` off (see N-2).
- **Folding** off (large file): no fold gutter, numbers still on their rows (`large-*`, 20 of 20).
- **V-08** whitespace, column guide, both; **special characters**: no change to any box.
- **Window**: folded vs unfolded, Split (folded at 1000, unfolded at 1500), two panes (folded, md + md and md + rs): every pane's
  gutter sits in its own pane and each editor's left and right gaps are equal (23 px; 21 px unfolded; 29 px single pane).
- **Width** 800 to 1920 and height 600: all right.
- **Theme**: Night and Paper identical in every box.
- **Release CSP** (`csp-*`): wrong, the F-98 bug.

## Cells that are wrong

| Cells | What | Maps to |
| --- | --- | --- |
| `csp-base`, `csp-untitled`, `csp-rs` (and by the same mechanism every Source editor in a release build, and probably the block editor in Rendered) | No CodeMirror styles apply: scroller `display: block`, stack of fold gutter, numbers and text; `system-ui` font; browser focus ring. First number 300 px above the first line's top. | **F-98** (all five rows of its table). The cause is the CSP, not the layout; see above. |

No dev-harness cell is wrong. Not wrong, but F-100's evidence:

| Cells | Measured | Maps to |
| --- | --- | --- |
| `base-night` / `base-paper`, `kind-txt`, `untitled-*` | Folded window at 1000 px: prose Source's gutter left edge is **129.5 px** (Untitled 110.4 px) from the window edge, the editor's right edge is 29 px from it. The gutter floats with the centred 66-character column | **F-100** |
| `w1400`, `w1920` | gutter at 329.5 and 589.5 px from the edge (editor gaps 229 and 489 px) | **F-100** |
| `kind-rs` etc. at 1000 px | gutter at 29 px (pane edge); at `w1400-rs` 229 px, at `w1920-rs` 489 px | **F-100** |
| `w800` | gutter at 29.5 px: the column fills; fine | none |
| `unfolded`, `unfolded-rs`, `split-*`, `two-panes-*` | gutter 21 to 23 px from its own pane's edge, at the frame's inset | none, but note for F-100: 21 to 23 px is the frame's 12 px margin plus its 9 px editor inset, over the card's 16 px bound; decide there whether the frame counts |

The rule behind F-100 is `sourceRules()` in `apps/desktop/src/source/theme-bridge.ts`: `start`, `gutterStart` and
`'.cm-gutters': { marginInlineStart: gutterStart }` centre the column on the window (`max(0px, calc((100% - column) / 2 - GUTTER))`,
`column` = `PROSE_COLUMN` or `CODE_COLUMN` = `100ch`), the V-12 / L-07 design ("the column stays on the window's axis"). F-100 is a decision to
overturn that for Source, so it edits those three rules (plus `.cm-content`'s `width`/`minWidth`), not the frame. Its dependency on F-98
should read: the fix must first make the styles load in a release build, or F-100 cannot be seen there either.

## Proposed cards (new defects; not boarded)

**N-1 (Sev-1, size S) Source's editor is styled under the release CSP, with a test that mounts one.** This is the F-98 fix
restated at its real scope: install `EditorView.cspNonce` (or another CSP-safe way to deliver CodeMirror's rules) for every editor,
Source, the Rendered block editor and any other `EditorView`; extend `release-csp.test.mjs` or `source-gutter.test.mjs` to open Source
and the block editor under the release policy and fail on a block-level scroller, a `system-ui` font or a drifting first number;
extend `scripts/check-csp.mjs`'s `runtimeStyleProblems` to flag an `EditorView` built without the nonce facet. Recommendation: fold
into F-98 and retitle F-98 "Source and the block editor are styled in the release build"; keep its dev-harness acceptance (one row
per line, numbers and lines share a top, both toggles, Night and Paper, wrap on and off) as the layout regression tests, which pass
today.

**N-2 (Sev-3, size S) Untitled's Source agrees with itself.** An Untitled document opens in Source with line numbers **on** and a prose
(wrapping) look, while a saved `.md` has numbers **off** and the same look: `defaultLineNumbersForPath` reads the path's extension (an
Untitled path has none, so it counts as "code, numbers on") while `sourceWraps` and `isUntitled` treat a scratch document as Markdown "until
it is named" (`editor.ts`). In the unfolded window the toolbar's kind chip also says `Code` for a typed Untitled while Source sets it as
prose (`shots/unfolded-untitled.png`). Pick one meaning of "Untitled is Markdown" and apply it to the number default, the kind chip
and the metrics. Cells: `untitled-typed-ln-default` (20 numbers) against `ln-default-md` (none).

**Not defects, noted so nobody chases them:** unfolded Split at 1000 px refuses with a notice ("needs a window at least 1433 px wide");
`panes().openIn('other', ...)` returns null in the unfolded window (not looked into; the harness opens two panes in the folded window).
Measuring right after a first paint can catch a wrapped line in the fallback face (the mono face loads at first paint), which looks like
a one-row gutter drift; `matrix.mjs` paints before it measures. The top bar's `N lines` for a file ending in a newline is one less than
the gutter's last number (the caret's Ln 20), as in the screenshot; I did not test its definition.

## Not covered

The real Tauri shell (not run headless here; the smoke driver is the check), the block editor in Rendered under the CSP, widths
between 800 and 1920 other than 1000/1400, digits beyond 2 in the number column (F-98 acceptance), the Windows build.
