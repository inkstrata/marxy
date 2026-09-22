# Aesthetics acceptance test

The answer to "when has 'aesthetics paramount' been achieved?" (Q3, ADR-0014). Two tiers.
Tier 1 runs on every PR; tier 2 runs at the end of every phase and before any release.

## Tier 1 — mechanical, in CI (`scripts/gate-aesthetics.mjs`)

Runs the corpus through the real renderer in Playwright WebKit on both platforms, at three
widths and three sizes, dark then light, and asserts:

| Check | Assertion | Source constraint |
| --- | --- | --- |
| Grid conformance | for every block-level element, `top mod line-box` ≤ 0.5 px | 2 |
| Measure | column width in `ch` ∈ [60, 75] at 14, 17, 21, 24 px | 1 |
| Contrast | body text ≥ 7:1, secondary text ≥ 4.5:1, every code token ≥ 4.5:1 on the code background, in **dark first**, then light | 4, ADR-0024 |
| Zero layout shift | cumulative layout shift = 0 from first paint through fonts, images, math | images/reserved dims |
| Rag quality | per paragraph: coefficient of variation of line lengths, count of lines < ⅓ measure (excluding last), consecutive-hyphen runs — each ≤ stored baseline + 5 % | 7 (K–P) |
| Hanging punctuation | opening quotes and hyphens at line starts/ends sit outside the text edge by ≥ 40 % of their advance | 7 |
| Heading hierarchy | headings differ from body in size and weight only; no colour; no `border`/`hr` decoration in the default theme | 4 |
| Code voice | mono family ≠ text family; mono x-height within 5 % of text x-height at the same size | 5 |
| Chrome at rest | with no interaction, the only visible non-text element is the scrollbar | 6 |
| Screenshot diff | per engine, per fixture, pixel diff ≤ 0.1 % against the committed baseline unless the PR updates the baseline with a queue entry | drift |

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
