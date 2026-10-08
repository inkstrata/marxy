# Aesthetics acceptance test

The answer to "when has 'aesthetics paramount' been achieved?" (Q3, ADR-0014). Two tiers.
Tier 1 runs on every PR; tier 2 runs at the end of every phase and before any release.

## Tier 1 — mechanical, in CI (`scripts/gate-aesthetics.mjs`)

Runs the corpus through the real app in Playwright WebKit on both platforms, at three widths and
four sizes, dark then light, and asserts. Each page is rendered by the app harness
(`apps/desktop/gate.html`, B-02): `startApp` over a memory shell, so highlighting, KaTeX, notices
and user-theme loading are in every page measured and in every screenshot baseline. The
pull-request path runs `--mechanical` (every check below except the two baseline comparisons, rag
and screenshot); the nightly run adds them (ADR-0047).

| Check | Assertion | Source constraint |
| --- | --- | --- |
| Grid conformance | for every block-level element, `top mod line-box` ≤ 0.5 px | 2 |
| Measure | column in average characters of the text face = 66 ± 10 % at 16, 20, 24, 28 px (never `ch`, ADR-0033) | 1 |
| Contrast | every **text-bearing** computed foreground/background pair in the article (body text ≥ 7:1 on the page ground, code text ≥ 7:1 on the code ground, everything else ≥ 4.5:1, ratios never rounded); every declared **text-on-tint** pair from the theme (`--marxy-color-selection`, find, notice, code background and any diff tints) for the default theme and every `fixtures/themes` theme, dark then light | 4, ADR-0024, ADR-0033 |
| Reflow and access media | corpus rendered at **320** px and at **400** % zoom, and under `forced-colors: active`, `prefers-contrast: more` and `prefers-reduced-motion: reduce`; no page-level horizontal scroll | WCAG 1.4.10, Reader Artifacts ch.9 |
| Zero layout shift | cumulative layout shift = 0 from first paint through fonts, images, math | images/reserved dims |
| Rag quality | per paragraph: coefficient of variation of line lengths, count of lines < ⅓ measure (excluding last), consecutive-hyphen runs — each ≤ stored baseline + 5 % | 7 (K–P) |
| Hanging punctuation | opening quotes and hyphens at line starts/ends sit outside the text edge by ≥ 40 % of their advance | 7 |
| Heading hierarchy | headings differ from body in size and weight only; no colour; no `border`/`hr` decoration in the default theme | 4 |
| Code voice | mono family ≠ text family; mono x-height within 5 % of text x-height at the same size | 5 |
| Chrome at rest | with no interaction, the only visible non-text element is the scrollbar | 6 |
| Geometry: centred | the column's axis is the axis of what the reader sees (the window less a classic scrollbar) within 0.5 px; where body text reaches both edges of an overlay-scrollbar page, its left and right ink margins agree within 1 px | L-02, screen criterion 1 |
| Geometry: block edges | every top-level block's text starts on the column's left edge within 1 px; the declared hangs are the only exceptions (list markers, checkboxes, hung punctuation and hung initial letters; a blockquote's indent; a lone image, centred; a wide block grown about the axis) | L-02, 2 |
| Geometry: room | no block box passes the column plus `--marxy-room` on either side, at any depth, and a box that overhangs the column overhangs both sides alike within 1 px | L-02, 3 |
| Geometry: marks | no list marker or checkbox sits left of the gutter floor | L-02, 3 |
| Geometry: no clip | no ink is cut off by the window; no set line runs past its paragraph's box once the app's relayout has settled; the page never scrolls sideways | L-02, 3 and 4 |
| Geometry: notice column | on the app's own `#marxy-notices` region: a notice is on the column's edges within 1 px, in view three screens down, a whole number of grid units high, and in Source never on the first line of text | L-02, 5 |
| Geometry: text spacing | with the four WCAG 1.4.12 overrides loaded as a reader theme (line height 1.5, paragraph spacing 2, letter spacing 0.12, word spacing 0.16, all in em), nothing is clipped, no block overlaps, no set line passes its box and the page does not scroll sideways | WCAG 1.4.12, L-02, 6 |
| Geometry: 200 % text | the same, with the reader's size set to 40 px through the config | WCAG 1.4.4, L-02, 6 |
| Screenshot diff | per engine, per fixture, pixel diff ≤ 0.1 % against the committed baseline unless the PR updates the baseline (a taste-review entry in `docs/taste-review/queue.d/` is welcome, not required) | drift |

The geometry checks read the rules from `scripts/probe-layout.mjs` (`geometryFailures`, `noticeFailures`,
`surveyInPage`), the one implementation of where the column, the blocks and the marks sit. They run on the
renders the gate already makes (widths 720, 960 and 1280 and the four sizes at 960, both variants; the 320 px
reflow render), on one classic-scrollbar render per document at 480 and 960 px (the scrollbar appears after
first text and the app's relayout is awaited), and on extra renders for text spacing (320 and 960 px), 200 %
text (960 px) and the notice in Source (320 and 960 px). Where today's page fails a rule, the case (check,
sub-check, document, cell) is listed in `EXPECTED_FAILURES` in the gate with the story that clears it, and that
story deletes the row. The gate fails on a case that is not listed and on a listed case that now passes, so
the list can neither hide a new fault nor go stale. `node scripts/gate-aesthetics.mjs --mechanical
--emit-expected` prints the cases found as rows; `--files a.md,b.md` narrows a run to those documents.

Baselines live under `fixtures/baselines/<engine>/`. A PR that changes them must say why in
the taste-review queue.

## Tier 2 — human, scheduled

At each phase gate, the reviewer receives a folder prepared by the agents, never a request
mid-task:

1. **Blind side-by-side.** Three corpus documents (the long technical document, a real README,
   an AI plan) rendered in Marxy, Typora and Marked 2 at the same width, all three in their
   dark theme (Marxy's primary variant, ADR-0024), labelled A/B/C,
   screenshots printed or viewed at reading distance. Reviewer ranks. **Pass:** Marxy first on
   at least two of three.
2. **The fourth page.** Scroll the 5,000-word document to its end in Marxy; note whether the
   grid has drifted or the rag has degraded anywhere. **Pass:** nothing noted.
3. **First reaction.** One person who has not seen Marxy opens a README in it and says the
   first thing that comes to mind, recorded verbatim. **Pass:** the remark is about how it
   looks, not about a feature or a missing one.
4. **The Linux check.** Items 1–2 repeated on a Linux laptop at 1× and 2× scale, once per phase.

Results, including failures and the decisions they triggered, go in `docs/taste-review/`
with the date and the commit reviewed. A tier-2 failure blocks the phase's release; it does
not block merging.

## What this test does not do

It cannot tell you the typeface is right. That is taste review #0, done once, by living with
two candidates for a week (ADR-0015).
