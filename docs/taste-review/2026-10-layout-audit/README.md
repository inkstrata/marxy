# Layout audit, October 2026 (L-00)

A geometry probe over the corpus. It measures the page and states facts; it does not judge them. L-01
reads `probe.json`, confirms or kills H1 to H7 from it, and writes the findings. Hypotheses are in
`docs/plan/roadmap-2026-10/07-layout-and-reading.md`.

- Measured: `origin/main` at `b04a49bbf347`, webkit-macos, 28 documents x 96 cells = 2688 renders.
- Matrix: widths 320, 480, 659, 720, 960, 1280, 1600, 2560 px; sizes 16, 20, 28 px; dark and light; scrollbars overlay and classic (classic is 15 px, forced with `::-webkit-scrollbar` to model WebKitGTK).
- Errors during the run: 0.

## Regenerate

```bash
node scripts/probe-layout.mjs --ref origin/main                 # everything here; about 20 minutes
node scripts/probe-layout.mjs --out /tmp/probe --files 05-pathological-table-and-nesting.md --widths 320,960 --sizes 20 --variants dark
node scripts/probe-layout.mjs --readme-only                     # this file, from probe.json
node --test scripts/probe-layout.test.mjs                       # the negative controls and the determinism check
```

The probe renders through the harness entry the aesthetics gate uses (`apps/desktop/dist/render.js`). Two runs
over the same tree give an identical `probe.json` (no timestamps; numbers rounded to 0.01 px). The probe is not
in CI; L-02 promotes its rules into the gate.

## How to read it

Every number is CSS px. The column is the article's content box. `dL` and `dR` are a block's left and right box
edges from the column's, so a positive `dR` is past the right edge. `offsetFromWindow` is the column's axis minus the
window's; `offsetFromClient` uses the window minus the scrollbar. Margins are the leftmost ink edge from the window's
left, and the window's right edge (less the scrollbar) from the rightmost ink edge. An offender carries the hypothesis
it is evidence for and a metric in px; the rules are written out under `definitions` in `probe.json`.

## Headline numbers, per hypothesis

Taken over the size-20, dark cells (both scrollbar modes where the key says so). The keys are in `probe.json` under `headlines`.

### H1. Wide blocks grow to one side only

| key | value |
| --- | --- |
| `cellsMeasured` | 95 |
| `cellsWithAsymmetricBlock` | 80 |
| `maxBlockOverhangDifferencePx` | 950.41 |
| `maxPageInkAsymmetryPx` | 950.4 |
| `maxBodyInkAsymmetryPx` | 27.84 |
| `bodyInkCellsThatReachTheColumn` | 160 |
| `maxTableDRight` | 950.41 |
| `maxPreDRight` | 498.84 |
| `minDLeftAnyWideBlock` | 0 |

### H2. Blocks use different left edges

| key | value |
| --- | --- |
| `leftEdgePxByKind_960_20_dark` | `{"dl.front":{"textLeftFromColumnMin":0,"textLeftFromColumnMax":0},"h1":{"textLeftFromColumnMin":0,"textLeftFromColumnMax":0},"h2":{"textLeftFromColumnMin":0,"textLeftFromColumnMax":19},"h3":{"textLeftFromColumnMin":0,"textLeftFromColumnMax":0},"h4":{"textLeftFromColumnMin":0,"textLeftFromColumnMax":0},"h5":{"textLeftFromColumnMin":0,"textLeftFromColumnMax":0},"h6":{"textLeftFromColumnMin":0,"textLeftFromColumnMax":0},"li":{"textLeftFromColumnMin":0,"textLeftFromColumnMax":150},"p":{"textLeftFromColumnMin":0,"textLeftFromColumnMax":38},"p>img":{"textLeftFromColumnMin":278.58,"textLeftFromColumnMax":288.58},"pre":{"textLeftFromColumnMin":15,"textLeftFromColumnMax":17.36},"table":{"textLeftFromColumnMin":0,"textLeftFromColumnMax":0}}` |
| `cellsWithEdgeOffender` | 120 |
| `cellsMeasured` | 224 |

### H3. Hanging marks are wider than the gutter floor

| key | value |
| --- | --- |
| `maxMarkHangPx` | 45 |
| `maxOlMarkerHangPx` | 45 |
| `maxCheckboxHangPx` | 13.75 |
| `maxPunctuationHangPx` | 10.8 |
| `cellsWithMarkPastGutterFloor` | 65 |
| `cellsWithMarkClipped` | 27 |
| `widestWindowWithOffender` | 720 |

### H4. A classic scrollbar moves the centre and overflows set lines

| key | value |
| --- | --- |
| `classicCellsWithScrollbar` | 178 |
| `scrollbarPx` | 15 |
| `maxColumnShiftPx` | 7.5 |
| `maxCentreOffsetFromWindowClassicPx` | 7.5 |
| `maxCentreOffsetFromWindowOverlayPx` | 0 |
| `maxCentreOffsetFromClientClassicPx` | 0 |
| `cellsWithLinesOverflowingImmediately` | 57 |
| `cellsWithLinesOverflowingSettled` | 57 |
| `maxLineOverflowImmediatePx` | 21.94 |
| `maxLineOverflowOverlayPx` | 6.94 |
| `cellsWithHorizontalPageScroll` | 3 |

### H5. Blocks pass the gutter floor (nested blocks, scrollbars)

| key | value |
| --- | --- |
| `cellsWithBlockPastGutterFloor` | 2 |
| `nestedOffenders` | 0 |
| `maxPastFloorPx` | 164.6 |
| `maxNestedPastFloorPx` | 0 |
| `nestedWideBlocksMeasured_960` | `{"pre":3,"table":0}` |
| `scrollingBlocks` | 232 |
| `classicHorizontalScrollbarMaxPx` | 15 |

### H6. Notices are off the column and out of sight

| key | value |
| --- | --- |
| `noticeEdgeVsColumnLeft_960` | 61.11 |
| `noticeEdgeVsColumnLeft_320` | 32 |
| `noticeRegionPadVsArticleGutter_960` | `[48,24]` |
| `noticeRegionPadVsArticleGutter_320` | `[48,16]` |
| `noticeLineHeightInGridUnits` | 1.4 |
| `noticeHeightInGridUnits` | 2.97 |
| `noticePushesTextDownPx` | 59.5 |
| `cellsWhereNoticeIsOutOfViewWhenScrolled` | 178 |
| `cellsMeasuredScrolled` | 179 |
| `sourceModeNoticeFixed` | true |
| `adHocNoticeBuilders` | 18 |

### H7. Source mode lacks the basics (static facts only)

Source mode is CodeMirror, not part of the render entry: these are static facts with file:line (see static.H7), measured by L-01 where it needs a render.

| key | value |
| --- | --- |
| `syntaxHighlightingReferences` | 0 |
| `contentPaddingRules` | 1 |
| `foldGutterAlwaysOn` | true |
| `lineNumberChoiceInSessionStorage` | true |
| `searchPanelStyleRules` | 0 |
| `sourceOverlayFixedFullWindow` | true |

## Ranked offenders, by hypothesis

The worst blocks across the whole matrix, the worst block of each document and kind (the worst cell kept), by the size of the miss in px; `probe.json` keeps up to three per document and kind. `H4` here includes the steady-state overlay misses (set lines that already overflow before any scrollbar appears); the classic-scrollbar numbers are under the headline table.

### H1. Wide blocks grow to one side only

| # | document | cell | kind | depth | px | bytes | what |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `01-long-technical.md` | 2560 px, 16 px type, dark, overlay scrollbar | table | 0 | 1011.53 | 9071-11149 | box overhangs the column 0 left, 1011.53 right |
| 2 | `05-pathological-table-and-nesting.md` | 2560 px, 16 px type, dark, overlay scrollbar | table | 0 | 1011.53 | 57-5814 | box overhangs the column 0 left, 1011.53 right |
| 3 | `32-long-reference.md` | 2560 px, 20 px type, light, classic scrollbar | table | 0 | 885.69 | 30822-31354 | box overhangs the column 0 left, 885.69 right |
| 4 | `06-math.md` | 2560 px, 16 px type, dark, overlay scrollbar | pre | 0 | 615.08 | 164-471 | box overhangs the column 0 left, 615.08 right |
| 5 | `18-agent-transcript.md` | 2560 px, 16 px type, dark, overlay scrollbar | pre | 0 | 615.08 | 1468-1579 | box overhangs the column 0 left, 615.08 right |
| 6 | `19-source-file.md` | 2560 px, 16 px type, dark, overlay scrollbar | pre | 0 | 615.08 | 102-3471 | box overhangs the column 0 left, 615.08 right |
| 7 | `24-issue-thread.md` | 2560 px, 16 px type, dark, overlay scrollbar | pre | 0 | 615.08 | 1544-2785 | box overhangs the column 0 left, 615.08 right |
| 8 | `28-artifact-fences.md` | 2560 px, 16 px type, dark, overlay scrollbar | pre | 0 | 615.08 | 155-539 | box overhangs the column 0 left, 615.08 right |
| 9 | `30-notebook-export.md` | 2560 px, 16 px type, dark, overlay scrollbar | pre | 0 | 615.08 | 972-1177 | box overhangs the column 0 left, 615.08 right |
| 10 | `32-long-reference.md` | 2560 px, 16 px type, dark, overlay scrollbar | pre | 0 | 615.08 | 13572-13889 | box overhangs the column 0 left, 615.08 right |

### H2. Blocks use different left edges

| # | document | cell | kind | depth | px | bytes | what |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `10-hostile.md` | 960 px, 28 px type, dark, overlay scrollbar | p>img | 0 | 404.8 | 950-263124 | text starts 404.8 from the column's left edge (box 0) |
| 2 | `30-notebook-export.md` | 960 px, 28 px type, dark, overlay scrollbar | p>img | 0 | 400.3 | 4583-4605 | text starts 400.3 from the column's left edge (box 0) |
| 3 | `24-issue-thread.md` | 960 px, 28 px type, dark, overlay scrollbar | p>img | 0 | 390.8 | 5998-6055 | text starts 390.8 from the column's left edge (box 0) |
| 4 | `24-issue-thread.md` | 960 px, 28 px type, dark, overlay scrollbar | pre | 0 | 22.98 | 1544-2785 | text starts 22.98 from the column's left edge (box 0) |
| 5 | `28-artifact-fences.md` | 960 px, 28 px type, dark, overlay scrollbar | pre | 0 | 22.98 | 772-813 | text starts 22.98 from the column's left edge (box 0) |
| 6 | `02-readme-real-world.md` | 960 px, 28 px type, dark, overlay scrollbar | pre | 0 | 21 | 508-536 | text starts 21 from the column's left edge (box 0) |
| 7 | `03-ai-plan.md` | 960 px, 28 px type, dark, overlay scrollbar | pre | 0 | 21 | 1006-1149 | text starts 21 from the column's left edge (box 0) |
| 8 | `06-math.md` | 960 px, 28 px type, dark, overlay scrollbar | pre | 0 | 21 | 164-471 | text starts 21 from the column's left edge (box 0) |
| 9 | `09-gfm-everything.md` | 960 px, 28 px type, dark, overlay scrollbar | pre | 0 | 21 | 1169-1196 | text starts 21 from the column's left edge (box 0) |
| 10 | `10-hostile.md` | 960 px, 28 px type, dark, overlay scrollbar | pre | 0 | 21 | 263207-263290 | text starts 21 from the column's left edge (box 0) |

### H3. Hanging marks are wider than the gutter floor

| # | document | cell | kind | depth | px | bytes | what |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `01-long-technical.md` | 320 px, 28 px type, dark, overlay scrollbar | ol-marker | 0 | 63 |  | ol-marker hangs 63 left of the column; its left edge is -47 (gutter floor 16, clipped) |
| 2 | `02-readme-real-world.md` | 320 px, 28 px type, dark, overlay scrollbar | ol-marker | 0 | 63 |  | ol-marker hangs 63 left of the column; its left edge is -47 (gutter floor 16, clipped) |
| 3 | `03-ai-plan.md` | 320 px, 28 px type, dark, overlay scrollbar | ol-marker | 0 | 63 |  | ol-marker hangs 63 left of the column; its left edge is -47 (gutter floor 16, clipped) |
| 4 | `09-gfm-everything.md` | 320 px, 28 px type, dark, overlay scrollbar | ol-marker | 0 | 63 |  | ol-marker hangs 63 left of the column; its left edge is -47 (gutter floor 16, clipped) |
| 5 | `15-prose-volume.md` | 320 px, 28 px type, dark, overlay scrollbar | ol-marker | 0 | 63 |  | ol-marker hangs 63 left of the column; its left edge is -47 (gutter floor 16, clipped) |
| 6 | `24-issue-thread.md` | 320 px, 28 px type, dark, overlay scrollbar | ol-marker | 0 | 63 |  | ol-marker hangs 63 left of the column; its left edge is -47 (gutter floor 16, clipped) |
| 7 | `28-llm-answer.md` | 320 px, 28 px type, dark, overlay scrollbar | ol-marker | 0 | 63 |  | ol-marker hangs 63 left of the column; its left edge is -47 (gutter floor 16, clipped) |
| 8 | `31-essay.md` | 320 px, 28 px type, dark, overlay scrollbar | ol-marker | 0 | 63 |  | ol-marker hangs 63 left of the column; its left edge is -47 (gutter floor 16, clipped) |
| 9 | `32-long-reference.md` | 320 px, 28 px type, dark, overlay scrollbar | ol-marker | 0 | 63 |  | ol-marker hangs 63 left of the column; its left edge is -47 (gutter floor 16, clipped) |

### H4. A classic scrollbar moves the centre and overflows set lines

| # | document | cell | kind | depth | px | bytes | what |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `32-long-reference.md` | 320 px, 20 px type, dark, classic scrollbar | p.set-line | 0 | 21.94 | 122772-122877 | a set line runs 21.94 past its paragraph's content box |
| 2 | `30-notebook-export.md` | 320 px, 28 px type, dark, classic scrollbar | p.set-line | 0 | 20.44 | 3818-3877 | a set line runs 20.44 past its paragraph's content box |
| 3 | `31-essay.md` | 480 px, 20 px type, dark, classic scrollbar | p.set-line | 0 | 20.25 | 8241-9113 | a set line runs 20.25 past its paragraph's content box |
| 4 | `15-prose-volume.md` | 659 px, 28 px type, light, classic scrollbar | p.set-line | 0 | 19.19 | 39255-40026 | a set line runs 19.19 past its paragraph's content box |
| 5 | `28-llm-answer.md` | 480 px, 20 px type, dark, classic scrollbar | p.set-line | 0 | 18.82 | 1736-1823 | a set line runs 18.82 past its paragraph's content box |
| 6 | `01-long-technical.md` | 720 px, 28 px type, dark, classic scrollbar | p.set-line | 0 | 18.68 | 3375-3432 | a set line runs 18.68 past its paragraph's content box |
| 7 | `14-marxy-plan.md` | 320 px, 16 px type, dark, classic scrollbar | p.set-line | 0 | 16.4 | 23-396 | a set line runs 16.4 past its paragraph's content box |
| 8 | `09-gfm-everything.md` | 320 px, 16 px type, light, classic scrollbar | p.set-line | 0 | 16.25 | 1694-1749 | a set line runs 16.25 past its paragraph's content box |
| 9 | `24-issue-thread.md` | 720 px, 28 px type, dark, classic scrollbar | p.set-line | 0 | 15.74 | 4384-4677 | a set line runs 15.74 past its paragraph's content box |
| 10 | `18-agent-transcript.md` | 320 px, 20 px type, light, classic scrollbar | p.set-line | 0 | 15.53 | 2406-2513 | a set line runs 15.53 past its paragraph's content box |

### H5. Blocks pass the gutter floor (nested blocks, scrollbars)

| # | document | cell | kind | depth | px | bytes | what |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `30-notebook-export.md` | 320 px, 28 px type, dark, classic scrollbar | pre | 0 | 185.6 | 5071-6174 | ink is outside the window (clipped) |
| 2 | `28-llm-answer.md` | 320 px, 28 px type, dark, classic scrollbar | pre | 0 | 2 | 2582-3001 | ink is outside the window (clipped) |

### H6. Notices are off the column and out of sight

| # | document | cell | kind | depth | px | bytes | what |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | (any document) | 960 px, 28 px type, dark, overlay scrollbar | notice | 0 | 183.35 |  | notice box edges 183.34 / -183.34 from the column (its region pads 48px, the article's gutter is 24px) |

## Worst per block kind

So a loud kind (a centred image in H2) cannot hide the rest: the worst block of each kind, per hypothesis.

### H1

| kind | blocks affected | worst document | cell | px |
| --- | --- | --- | --- | --- |
| pre | 138 | `06-math.md` | 2560 px, 16 px type, dark, overlay scrollbar | 615.08 |
| table | 75 | `01-long-technical.md` | 2560 px, 16 px type, dark, overlay scrollbar | 1011.53 |

### H2

| kind | blocks affected | worst document | cell | px |
| --- | --- | --- | --- | --- |
| p | 61 | `32-long-reference.md` | 960 px, 28 px type, light, classic scrollbar | 19.31 |
| p>img | 4 | `10-hostile.md` | 960 px, 28 px type, dark, overlay scrollbar | 404.8 |
| pre | 183 | `24-issue-thread.md` | 960 px, 28 px type, dark, overlay scrollbar | 22.98 |

### H3

| kind | blocks affected | worst document | cell | px |
| --- | --- | --- | --- | --- |
| checkbox | 29 | `03-ai-plan.md` | 320 px, 16 px type, dark, overlay scrollbar | 13.75 |
| ol-marker | 106 | `01-long-technical.md` | 320 px, 28 px type, dark, overlay scrollbar | 63 |
| punct | 1085 | `14-marxy-plan.md` | 320 px, 28 px type, light, classic scrollbar | 14.59 |

### H4

| kind | blocks affected | worst document | cell | px |
| --- | --- | --- | --- | --- |
| p.set-line | 863 | `32-long-reference.md` | 320 px, 20 px type, dark, classic scrollbar | 21.94 |

### H5

| kind | blocks affected | worst document | cell | px |
| --- | --- | --- | --- | --- |
| pre | 3 | `30-notebook-export.md` | 320 px, 28 px type, dark, classic scrollbar | 185.6 |

### H6

| kind | blocks affected | worst document | cell | px |
| --- | --- | --- | --- | --- |
| notice | 2 | (any document) | 960 px, 28 px type, dark, overlay scrollbar | 183.35 |

## The cases

The author has no list of observed errors (ruling of 2026-10-07). The ranked offenders above, per hypothesis, and
the worst-per-kind tables are the cases L-01 works from; each row names a document, a cell and a byte range, so it can be
reproduced with `--files`, `--widths` and `--sizes`.

## Static facts (H6, H7)

Read from the source tree with file and line; a render cannot show these. Source mode is CodeMirror and is not part of the render entry.

### H1

- `preMaxWidth`: `packages/theme/src/base.css:300`
- `tableMaxWidth`: `packages/theme/src/base.css:376`
- `roomToken`: `packages/theme/src/base.css:101`

### H3

- `gutterFloors`: `packages/theme/src/base.css:98`, `packages/theme/src/base.css:127`, `packages/theme/src/base.css:131`
- `olHang`: `packages/theme/src/base.css:196`
- `checkboxHang`: `packages/theme/src/base.css:208`

### H6

- `noticeRegionPadding`: `packages/theme/src/base.css:37`
- `noticeLineHeight`: `packages/theme/src/base.css:48`
- `sourceModeFixed`: `apps/desktop/index.html:18`
- `adHocBuilders`: `apps/desktop/src/close.ts:68`, `apps/desktop/src/close.ts:70`, `apps/desktop/src/notices/blocked.ts:74`, `apps/desktop/src/notices/blocked.ts:78`, `apps/desktop/src/notices/blocked.ts:85`, `apps/desktop/src/notices/blocked.ts:93`, and 12 more
- `notifyCallers`: 19

### H7

- `syntaxHighlighting`: no match
- `contentPadding`: `apps/desktop/src/source/theme-bridge.ts:41`
- `activeLine`: `apps/desktop/src/source/theme-bridge.ts:47`
- `foldGutter`: `apps/desktop/src/source/editor.ts:95`
- `lineNumberStorage`: `apps/desktop/src/source/line-numbers.ts:16`, `apps/desktop/src/source/line-numbers.ts:24`
- `sourceMount`: `apps/desktop/index.html:16`
- `lineHeight`: no match
- `searchPanelStyle`: no match

## Files

- `probe.json`: every cell, per document: viewport, column, centre, margins, set lines, marks, per-kind aggregates, offender counts and the worst offender per hypothesis. The block lists (`blocks`, fields in `blockFields`) are kept at 320, 960 and 1600 px, size 20, dark only; the other cells keep aggregates. `rankings` and `rankingsByKind` are across the whole matrix; `notices` is the notice region per cell (it does not depend on the document).
- `contact-sheets/`: one per width, 8 files, every document at size 20, dark, overlay scrollbar, clipped around its worst offender (or the top). Hairlines: window centre cyan, column edges green, gutter floor yellow dashed, room limit magenta dashed; offenders in red.
- `overlays/`: 15 full-size overlays, the top three documents for each hypothesis, in the worst cell.
- An overlay for every cell that has an offender is not committed (several hundred megabytes at this matrix); `--overlays-dir DIR` writes them, one `<document>-<cell>.png` each, for whatever `--files`, `--widths`, `--sizes`, `--variants` and `--scrollbars` select.

## What the probe does not do, and caveats

- It does not judge. A `reaches: false` margin means the document has no ink at the column's right edge, so that asymmetry says nothing.
- The harness fixes `#marxy-main` to the window width; the probe releases it after the render so the main fills the window as it does in the app. A classic scrollbar is injected after the page is set (a scrollbar that appears after first text), which is the H4 case; `linesImmediate` is read at once, `lines` after 600 ms.
- The notice is a synthetic region built the way `apps/desktop/index.html` builds it; the harness page has none.
- Light and dark can differ by sub-pixel type weight, so both are kept.
- Source mode, the palette and the outline are not rendered. H7 is static facts until L-01 probes it.
