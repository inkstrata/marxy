# Taste review queue

| Date | PR / story | What the reader would notice | Artifacts | Question for the reviewer | Decision |
| --- | --- | --- | --- | --- | --- |
| 2026-09-18 | MARXY-17 | Typeface pair for the default theme (review #0) | `docs/taste-review/review-0/` — 20 PNGs, both pairs, five passages, 1× and 2×; see **Review #0** below | Literata + JetBrains Mono, or Source Serif 4 + IBM Plex Mono? Live with each for a week on the long document. | pending |
| 2026-09-18 | spike | WebKitGTK vs macOS weight at reading size | `docs/spike/results/u26-tauri-specimen-17-dpr2-off0.png`, `mac-pwwebkit-specimen-17-dpr2-off0.png` | Does the Linux rendering (lighter by ~70 units) read acceptably before compensation, and is +50 or +75 the right correction? | pending |

## Review #0 — the default typeface pair

The decision this artifact exists to settle: **ADR-0015 is proposed until this review**. Pair A is
its default, pair B its fallback. Both sets are `fixtures/corpus/01-long-technical.md` (a 3,000-word
technical document, tables and inline code throughout) set at the type scale in
`docs/design-language.md` on a 68 `ch` measure, rendered by `node scripts/specimen/render.mjs` and
checked by `node scripts/specimen/verify.mjs`. Every face is vendored under `fonts/` and inlined
into the page, so the specimen downloads nothing.

Read each pair for a week's worth of attention before comparing them side by side. The pairs are
not meant to be judged a page at a time — the question is which one you would still want to be
reading on the fourth page.

| | Pair A | Pair B |
| --- | --- | --- |
| Body and headings | Literata (variable, `opsz` 7–72 default 12, `wght` 200–900) | Source Serif 4 (variable, `opsz` 8–60 default 20, `wght` 200–900) |
| Code | JetBrains Mono (variable, `wght` 100–800) | IBM Plex Mono (static 400) |
| Column at 68 `ch` | 670.09 px (9.855 px per character) | 594.75 px (8.747 px per character) |
| Whole document height | 9,381 px | 9,725 px |
| Real italic vendored | yes | **no** — the browser slants the roman |

The same measure in `ch` gives the two pairs columns 75 px apart, and the narrower pair sets the
longer document. That is design constraint 1 working as intended, not a bug, but it is the first
thing to look at: 68 `ch` is the right number for exactly one of these faces. A `ch` is the digit
advance, and both faces put that on their optical-size axis, so the column moves as a reader
enlarges the type — Literata's digit widens from 0.579 em at 13 px to 0.585 em at 33 px, Source
Serif 4's narrows from 0.535 em to 0.491 em.

### What to compare

Each passage is captured at the same point in the document in both pairs, at 1× and 2×. Compare
across a row, never down a column.

| Passage | What it shows | Pair A | Pair B |
| --- | --- | --- | --- |
| 1 | title, opening prose, first section heading | [1×](review-0/pair-a-literata-jetbrains-mono/p1-opening-1x.png) · [2×](review-0/pair-a-literata-jetbrains-mono/p1-opening-2x.png) | [1×](review-0/pair-b-source-serif-4-ibm-plex-mono/p1-opening-1x.png) · [2×](review-0/pair-b-source-serif-4-ibm-plex-mono/p1-opening-2x.png) |
| 2 | inline code inside body text (design constraint 5) | [1×](review-0/pair-a-literata-jetbrains-mono/p2-inline-code-1x.png) · [2×](review-0/pair-a-literata-jetbrains-mono/p2-inline-code-2x.png) | [1×](review-0/pair-b-source-serif-4-ibm-plex-mono/p2-inline-code-1x.png) · [2×](review-0/pair-b-source-serif-4-ibm-plex-mono/p2-inline-code-2x.png) |
| 3 | a wide data table and its figures | [1×](review-0/pair-a-literata-jetbrains-mono/p3-table-1x.png) · [2×](review-0/pair-a-literata-jetbrains-mono/p3-table-2x.png) | [1×](review-0/pair-b-source-serif-4-ibm-plex-mono/p3-table-1x.png) · [2×](review-0/pair-b-source-serif-4-ibm-plex-mono/p3-table-2x.png) |
| 4 | h2 above h3 above body, space-above ratios | [1×](review-0/pair-a-literata-jetbrains-mono/p4-heading-stack-1x.png) · [2×](review-0/pair-a-literata-jetbrains-mono/p4-heading-stack-2x.png) | [1×](review-0/pair-b-source-serif-4-ibm-plex-mono/p4-heading-stack-1x.png) · [2×](review-0/pair-b-source-serif-4-ibm-plex-mono/p4-heading-stack-2x.png) |
| 5 | a bulleted list late in the document (grid drift) | [1×](review-0/pair-a-literata-jetbrains-mono/p5-late-list-1x.png) · [2×](review-0/pair-a-literata-jetbrains-mono/p5-late-list-2x.png) | [1×](review-0/pair-b-source-serif-4-ibm-plex-mono/p5-late-list-1x.png) · [2×](review-0/pair-b-source-serif-4-ibm-plex-mono/p5-late-list-2x.png) |

The 1× set is the one to judge: it is the density most readers are on, and it is where a face with
too much stroke contrast or too small an x-height falls apart. The 2× set is for looking closely at
letterforms, terminals and the fit of inline code against the body.

### What would count as wrong

Any one of these is a reason to reject a pair outright rather than tune it:

1. **Body text at 17 px that you enlarge.** If you want to reach for a size control on passage 1,
   the face is wrong; 17 px is the scale's decision and it is not moving for a typeface.
2. **Inline code that outsizes the line it sits in.** Passage 2 is the test of design constraint 5:
   the mono at 14 px must match the body's x-height and sit inside the 28 px line box. If the code
   chips look like a different, larger document intruding, the mono is wrong. Both pairs break long
   filenames mid-token here; judge how each looks when it does.
3. **Headings that shout.** 600 in a text serif should read as hierarchy from size, not as bold.
   Passage 4: if the h2 feels heavier than its size warrants, the face's 600 is too dark.
4. **Visible drift on passage 5.** Every block edge should still be landing on the 28 px grid a
   thousand lines in. Vertical rhythm that has gone soft by the end of the document is fatal.
5. **Figures that do not line up.** Passage 3: the score columns are numerals in the body face; if
   they read as ragged or as a different size from the text around them, the face's figures are
   wrong for a reader who reads tables.
6. **Stroke contrast that thins out at 1×.** Compare the two 1× captures of passage 1 directly: a
   face whose thins disappear at reading size on a white page is disqualified.
7. **A pair that reads as two documents.** The body and the mono should look like they were chosen
   together. Passage 2 at 2× is where a mismatch of weight, width or x-height shows.

### The checklist from ADR-0015

The ADR's reasoning, restated as things to confirm or overturn with the sets in front of you:

- [ ] **Extended screen reading.** The face was designed for reading on screens for long stretches,
      and passages 1 and 5 bear that out rather than just asserting it.
- [ ] **Optical size across the scale.** The scale runs 13 px to 33 px, and **both** faces have an
      optical-size axis that the specimen follows (`font-optical-sizing: auto`, so every size in
      both sets is a different drawing, not one drawing scaled). The two axes do different amounts
      of work. Measured with the specimen's own `@font-face` at weight 400, as the width of a fixed
      70-character sentence divided by the font size — the number the measure and the rag depend on:

      | | 13 px | 17 px | 33 px | axis pinned |
      | --- | --- | --- | --- | --- |
      | Literata (`opsz` 7–72) | 34.202 | 34.159 | 33.989 | 34.212 at every size |
      | Source Serif 4 (`opsz` 8–60) | 34.696 | 33.266 | 31.285 | 32.193 at every size |

      Literata's axis moves advances 0.6% across the scale; Source Serif 4's moves them 9.8%,
      setting its caption sizes wider than its pinned drawing and its title sizes tighter. Neither
      number says which is better: a face that barely changes is consistent across the scale, a
      face that changes a lot is tuned per size and has more to get wrong. Look at the caption row
      of passage 3 against the title of passage 1, in both pairs, and say which you prefer.
- [ ] **A weight axis that goes below regular.** ADR-0015 rules out iA Writer Quattro because its
      axis starts at 400 and cannot be tuned down for Linux, where WebKitGTK renders lighter.
      Both pairs here start at 200, so both pass; confirm that still matters to you.
- [ ] **Monospace x-height suited to code in body text** (design constraint 5) — passage 2.
- [ ] **Bundled unmodified, under a licence that can ship.** All four faces are OFL 1.1 with the
      licence verbatim beside them, unmodified, no network fetch (ADR-0006). Confirmed mechanically.
- [ ] **The long document set in both pairs, and a choice recorded.** This artifact.

### Caveats — what this specimen is not

The specimen is Chromium on macOS at the scale and measure, and nothing else. It does **not** show
the shipping renderer: Knuth–Plass line breaking, hanging punctuation and grid snapping are not in
it (MARXY-25 onwards), so the rag is the browser's greedy rag in both pairs and should not be held
against either face. The per-platform `--marxy-weight-offset` is 0 here; WebKitGTK will render both
pairs lighter (see the spike entry above). The document has no fenced code blocks, so the mono
faces are judged on inline code only. Pair B has no vendored italic — the slants in its tables and
emphasis are synthetic, which is itself a cost of choosing it: a real Source Serif 4 italic would
have to be vendored before it could be the default.

### Decision to record

One line, in `docs/taste-review/2026-09-review-0/decisions.md`: **pair A or pair B**, and whether
68 `ch` survives the choice. Pair A confirms ADR-0015 and moves it from proposed to accepted; pair B
overturns it, and the follow-up PR swaps the two `--marxy-font-*` tokens, vendors the Source Serif 4
italic, and rewrites the ADR's decision and consequences.
