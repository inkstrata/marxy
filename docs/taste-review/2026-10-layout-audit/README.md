# Layout audit, October 2026 (L-00)

A geometry probe over the corpus. It measures the page and states facts; it does not judge them. L-01
reads `probe.json`, confirms or kills H1 to H7 from it, and writes the findings. Hypotheses are in
`docs/plan/roadmap-2026-10/07-layout-and-reading.md`.

- Measured: the working tree at `a7cde7305699` (`--ref` is only a label and selects nothing; this run's label was `origin/main`, which was `a7cde7305699`), webkit-macos, 28 documents x 96 cells = 2688 renders.
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

Not errors: the column moving by half a classic scrollbar (maxColumnShiftPx, maxCentreOffsetFromWindowClassicPx) is what a classic scrollbar does, and maxCentreOffsetFromClientClassicPx 0 says the visible area stays centred. Set-line overflow is read as the 15 px scrollbar first reflows the page, before the app's own relayout (100 ms after clientWidth changes, apps/desktop/src/app.ts); the headless render entry has no such observer, so how long it shows is not measured. The typesetter's hung hyphens and punctuation are not counted (maxHungHyphenPastOverlayPx is their size, with no scrollbar).

| key | value |
| --- | --- |
| `classicCellsWithScrollbar` | 178 |
| `scrollbarPx` | 15 |
| `maxColumnShiftPx` | 7.5 |
| `maxCentreOffsetFromWindowClassicPx` | 7.5 |
| `maxCentreOffsetFromWindowOverlayPx` | 0 |
| `maxCentreOffsetFromClientClassicPx` | 0 |
| `cellsWithLinesOverflowingClassic` | 42 |
| `cellsWithLinesOverflowingOverlay` | 0 |
| `maxLineOverflowClassicPx` | 15.5 |
| `maxLineOverflowOverlayPx` | 0 |
| `maxHungHyphenPastOverlayPx` | 6.94 |
| `cellsWithHorizontalPageScroll` | 3 |

### H5. Blocks pass the gutter floor (nested blocks, scrollbars)

Untested for nested tables: no table in the corpus sits inside a list or blockquote (nestedWideBlocksMeasured_960.table is 0), and the only nested pre are three in blockquotes of 24-issue-thread. nestedOffenders 0 means no sample, not that H5 is dead. Cell right padding and snapToGrid on scrolled tables are not measured. The two ranked H5 rows are classic-scrollbar clipping at 320 px, not the nested case.

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
| `noticeRegionFontPxVsArticle_960` | `[16,20]` |
| `noticeColumnPxVsArticle_960` | `[488.92,611.16]` |
| `noticeEdgeIfRegionFontMatchedArticle_960` | 0 |
| `noticeEdgeIfRegionPaddingMatchedArticle_960` | 61.11 |
| `noticeRegionPadVsArticleGutter_320` | `[48,16]` |
| `noticeEdgeIfRegionPaddingMatchedArticle_320` | 0 |
| `noticeLineHeightInGridUnits` | 1.4 |
| `noticeHeightInGridUnits` | 2.97 |
| `noticePushesTextDownPx` | 59.5 |
| `cellsWhereNoticeIsOutOfViewWhenScrolled` | 178 |
| `cellsMeasuredScrolled` | 179 |
| `sourceModeNoticeFixed` | true |
| `adHocNoticeBuilderFiles` | 5 |
| `adHocNoticeBuilderLines` | 18 |

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

The worst blocks across the whole matrix, the worst block of each document and kind (the worst cell kept), by the size of the miss in px; `probe.json` keeps up to three per document and kind. `H4` here is set lines past their box in any cell, hung hyphens excluded.

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
| 1 | `15-prose-volume.md` | 320 px, 20 px type, light, classic scrollbar | p.set-line | 0 | 15.5 | 23222-23961 | a set line runs 15.5 past its paragraph's content box (hung hyphens and punctuation not counted) |
| 2 | `31-essay.md` | 320 px, 20 px type, dark, classic scrollbar | p.set-line | 0 | 15.5 | 5808-6127 | a set line runs 15.5 past its paragraph's content box (hung hyphens and punctuation not counted) |
| 3 | `32-long-reference.md` | 320 px, 16 px type, dark, classic scrollbar | p.set-line | 0 | 15.5 | 8369-9005 | a set line runs 15.5 past its paragraph's content box (hung hyphens and punctuation not counted) |
| 4 | `24-issue-thread.md` | 480 px, 20 px type, light, classic scrollbar | p.set-line | 0 | 15.49 | 3049-3476 | a set line runs 15.49 past its paragraph's content box (hung hyphens and punctuation not counted) |
| 5 | `28-llm-answer.md` | 480 px, 20 px type, dark, classic scrollbar | p.set-line | 0 | 15.49 | 4958-5316 | a set line runs 15.49 past its paragraph's content box (hung hyphens and punctuation not counted) |
| 6 | `03-ai-plan.md` | 720 px, 28 px type, dark, classic scrollbar | p.set-line | 0 | 15.46 | 134-284 | a set line runs 15.46 past its paragraph's content box (hung hyphens and punctuation not counted) |
| 7 | `30-notebook-export.md` | 320 px, 16 px type, dark, classic scrollbar | p.set-line | 0 | 15.45 | 8873-8977 | a set line runs 15.45 past its paragraph's content box (hung hyphens and punctuation not counted) |
| 8 | `01-long-technical.md` | 480 px, 28 px type, light, classic scrollbar | p.set-line | 0 | 15.44 | 7832-7892 | a set line runs 15.44 past its paragraph's content box (hung hyphens and punctuation not counted) |
| 9 | `16-api-reference.md` | 480 px, 28 px type, light, classic scrollbar | p.set-line | 0 | 15.4 | 1574-1733 | a set line runs 15.4 past its paragraph's content box (hung hyphens and punctuation not counted) |
| 10 | `18-agent-transcript.md` | 320 px, 20 px type, dark, classic scrollbar | p.set-line | 0 | 15.4 | 160-352 | a set line runs 15.4 past its paragraph's content box (hung hyphens and punctuation not counted) |

### H5. Blocks pass the gutter floor (nested blocks, scrollbars)

| # | document | cell | kind | depth | px | bytes | what |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `30-notebook-export.md` | 320 px, 28 px type, dark, classic scrollbar | pre | 0 | 185.6 | 5071-6174 | ink is outside the window (clipped) |
| 2 | `28-llm-answer.md` | 320 px, 28 px type, dark, classic scrollbar | pre | 0 | 2 | 2582-3001 | ink is outside the window (clipped) |

### H6. Notices are off the column and out of sight

| # | document | cell | kind | depth | px | bytes | what |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | (any document) | 960 px, 28 px type, dark, overlay scrollbar | notice | 0 | 183.35 |  | notice box edges 183.34 / -183.34 from the column: #marxy-notices sizes its column in em at its own 16px font (the article's is 28px), so its column is 488.92px against 855.61px; with the article's font size the edge would be 0 off, with the article's gutter as side padding 183.34 off (region padding 48px, article gutter 24px: padding matters only where the window clamps the box) |

## Ranked offenders at the cells a reader uses

The same ranking restricted to 960 px and 1280 px windows, 20 px type, dark, overlay scrollbar, so the order is not set by window width alone. Every row is at that cell.

### 960 px, 20 px type, dark, overlay scrollbar

#### H1

| # | document | kind | depth | px | bytes | what |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `01-long-technical.md` | table | 0 | 150.41 | 9071-11149 | box overhangs the column 0 left, 150.41 right |
| 2 | `02-readme-real-world.md` | table | 0 | 150.41 | 763-1043 | box overhangs the column 0 left, 150.41 right |
| 3 | `03-ai-plan.md` | table | 0 | 150.41 | 690-988 | box overhangs the column 0 left, 150.41 right |
| 4 | `03-ai-plan.md` | pre | 0 | 150.41 | 1151-1493 | box overhangs the column 0 left, 150.41 right |
| 5 | `05-pathological-table-and-nesting.md` | table | 0 | 150.41 | 57-5814 | box overhangs the column 0 left, 150.41 right |
| 6 | `06-math.md` | pre | 0 | 150.41 | 164-471 | box overhangs the column 0 left, 150.41 right |

#### H2

| # | document | kind | depth | px | bytes | what |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `10-hostile.md` | p>img | 0 | 288.58 | 950-263124 | text starts 288.58 from the column's left edge (box 0) |
| 2 | `30-notebook-export.md` | p>img | 0 | 285.08 | 4583-4605 | text starts 285.08 from the column's left edge (box 0) |
| 3 | `24-issue-thread.md` | p>img | 0 | 278.58 | 5998-6055 | text starts 278.58 from the column's left edge (box 0) |
| 4 | `24-issue-thread.md` | pre | 0 | 17.36 | 1544-2785 | text starts 17.36 from the column's left edge (box 0) |
| 5 | `28-artifact-fences.md` | pre | 0 | 17.36 | 772-813 | text starts 17.36 from the column's left edge (box 0) |
| 6 | `02-readme-real-world.md` | pre | 0 | 15 | 508-536 | text starts 15 from the column's left edge (box 0) |

#### H3

No offenders.

#### H4

No offenders.

#### H5

No offenders.

#### H6

| # | document | kind | depth | px | bytes | what |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | (any document) | notice | 0 | 61.13 |  | notice box edges 61.11 / -61.12 from the column: #marxy-notices sizes its column in em at its own 16px font (the article's is 20px), so its column is 488.92px against 611.16px; with the article's font size the edge would be 0 off, with the article's gutter as side padding 61.11 off (region padding 48px, article gutter 24px: padding matters only where the window clamps the box) |

### 1280 px, 20 px type, dark, overlay scrollbar

#### H1

| # | document | kind | depth | px | bytes | what |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `01-long-technical.md` | table | 0 | 310.41 | 9071-11149 | box overhangs the column 0 left, 310.41 right |
| 2 | `03-ai-plan.md` | pre | 0 | 310.41 | 1151-1493 | box overhangs the column 0 left, 310.41 right |
| 3 | `05-pathological-table-and-nesting.md` | table | 0 | 310.41 | 57-5814 | box overhangs the column 0 left, 310.41 right |
| 4 | `06-math.md` | pre | 0 | 310.41 | 164-471 | box overhangs the column 0 left, 310.41 right |
| 5 | `16-api-reference.md` | table | 0 | 310.41 | 618-1146 | box overhangs the column 0 left, 310.41 right |
| 6 | `18-agent-transcript.md` | pre | 0 | 310.41 | 1468-1579 | box overhangs the column 0 left, 310.41 right |

#### H2

| # | document | kind | depth | px | bytes | what |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `10-hostile.md` | p>img | 0 | 288.58 | 950-263124 | text starts 288.58 from the column's left edge (box 0) |
| 2 | `30-notebook-export.md` | p>img | 0 | 285.08 | 4583-4605 | text starts 285.08 from the column's left edge (box 0) |
| 3 | `24-issue-thread.md` | p>img | 0 | 278.58 | 5998-6055 | text starts 278.58 from the column's left edge (box 0) |
| 4 | `24-issue-thread.md` | pre | 0 | 17.36 | 1544-2785 | text starts 17.36 from the column's left edge (box 0) |
| 5 | `28-artifact-fences.md` | pre | 0 | 17.36 | 772-813 | text starts 17.36 from the column's left edge (box 0) |
| 6 | `02-readme-real-world.md` | pre | 0 | 15 | 508-536 | text starts 15 from the column's left edge (box 0) |

#### H3

No offenders.

#### H4

No offenders.

#### H5

No offenders.

#### H6

| # | document | kind | depth | px | bytes | what |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | (any document) | notice | 0 | 61.13 |  | notice box edges 61.11 / -61.12 from the column: #marxy-notices sizes its column in em at its own 16px font (the article's is 20px), so its column is 488.92px against 611.16px; with the article's font size the edge would be 0 off, with the article's gutter as side padding 61.11 off (region padding 48px, article gutter 24px: padding matters only where the window clamps the box) |

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
| p.set-line | 861 | `15-prose-volume.md` | 320 px, 20 px type, light, classic scrollbar | 15.5 |

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
- `adHocBuilders`: `apps/desktop/src/close.ts:71`, `apps/desktop/src/close.ts:73`, `apps/desktop/src/notices/blocked.ts:74`, `apps/desktop/src/notices/blocked.ts:78`, `apps/desktop/src/notices/blocked.ts:85`, `apps/desktop/src/notices/blocked.ts:93`, and 12 more
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
- The harness fixes `#marxy-main` to the window width; the probe releases it after the render so the main fills the window as it does in the app. A classic scrollbar is injected after the page is set (a scrollbar that appears after first text), which is the H4 case; `lines` is read as that reflow leaves it, before the app's own relayout (100 ms after `clientWidth` changes, `apps/desktop/src/app.ts`). The headless render entry has no resize observer, so the probe cannot say how long an overflow shows; L-01 must not read it as "relayout does not help". Hung hyphens and punctuation are not line overflow and are left out.
- H5 is untested for nested tables: the corpus has no table inside a list or blockquote, so `nestedOffenders 0` means no sample. L-01 should add one synthetic nested-table page.
- The classic-scrollbar column shift and centre offset from the window are what a classic scrollbar is; the visible area stays centred (`offsetFromClient` 0). They are not errors.
- `--ref` is a label only. The probe renders whatever tree it runs in; the Measured line says which.
- The notice is a synthetic region built the way `apps/desktop/index.html` builds it; the harness page has none.
- Light and dark can differ by sub-pixel type weight, so both are kept.
- Source mode, the palette and the outline are not rendered. H7 is static facts until L-01 probes it.
