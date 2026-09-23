<!-- Generated from source/05-line-breaking.md by source/to-gfm.mjs; edit the source, then run the script. -->

# Knuth-Plass Line Breaking

*Where a line ends looks like a detail and decides most of what makes justified text good or bad. Browsers and most apps fill each line and move on; TeX, InDesign and a handful of others weigh every break in the paragraph against every other. This chapter explains both, measures the difference on real fonts, surveys who implements what, and covers the hyphenation, microtypography and pagination that surround the line breaker.*

Evidence grades: **[A]** replicated findings or a meta-analysis · **[B]** one well-designed study · **[C]** small, limited or mixed studies · **[D]** expert convention without a direct test · **[X]** contested or contradicted. Part of the [Reader Typography Handbook](README.md).

## The problem

A paragraph offers many places to break: after every space, after hyphens, and at each hyphenation point a dictionary allows. Any choice of breaks that keeps every line within the measure is legal, and there are astronomically many of them. The choice matters because every line almost never fills the measure exactly. The leftover space has to go somewhere. In ragged-right text it collects at the end of the line and makes the right edge uneven. In justified text it is shared among the word spaces, and a line with too few spaces for its slack shows the wide gaps that make badly justified text look full of holes.

Two families of algorithm dominate.

**First-fit** (also called greedy) fills each line with as many words as fit and breaks at the last opportunity. It is fast, simple, and never reconsiders an earlier line. Browsers, word processors and most UI toolkits use it.

**Total-fit** considers the whole paragraph and chooses the set of breaks whose total cost is lowest. It was described by Donald Knuth and Michael Plass in 1981 and implemented in TeX.[^kp] It sometimes takes a slightly worse break early on to avoid a terrible one later, and it can trade a little tightness on one line against looseness on the next.

## The model: boxes, glue and penalties

Knuth and Plass reduce a paragraph to three kinds of item, and the abstraction is worth learning because it expresses almost every typographic rule as a number.

**Boxes** are material of fixed width: a word, or a fragment of a word between hyphenation points. They never stretch.

**Glue** is space with three values: a natural width, how far it may stretch, and how far it may shrink. An interword space in TeX's Computer Modern text font is 3.33 points wide at 10 points, with 1.67 points of stretch and 1.11 of shrink: half the space in stretch and a third in shrink.[^cmr] A line may break at glue that follows a box, and glue at the start of a line disappears.

**Penalties** mark possible breaks that cost something (or forbid one). A hyphenation point is a penalty with the width of a hyphen, which appears only if the line breaks there, and a cost. TeX's default is 50. A penalty of 10,000 or more forbids a break; one of -10,000 or less forces one. A flag marks penalties that insert a hyphen, so that consecutive hyphenated lines can be charged extra.

Everything else is expressed in these terms. A paragraph ends with a penalty forbidding a break, then "parfillskip" glue that can stretch indefinitely, then a forced break, so the last line may be as short as it likes. Ragged-right setting gives interword glue no stretch and adds stretchable glue at the end of every line. Centred text puts it at both ends. A paragraph that flows around a figure simply has a different target width for each line.

## Scoring a line

For a candidate line from one break to another, add up the natural widths of its items, their total stretch and their total shrink. The **adjustment ratio** *r* says how hard the line's glue must work to fill the measure:

- If the line is short, *r* is the missing width divided by the total stretch. At *r* = 1 every space is stretched by its full allowance, which in TeX's font means half as wide again as normal.
- If the line is long, *r* is the excess divided by the total shrink, as a negative number. Below *r* = -1 the line cannot be made to fit, and the break is infeasible.

**Badness** turns *r* into a cost that rises steeply: roughly 100 × |*r*|³, capped at 10,000. A line stretched to its full allowance has badness 100; one stretched to half its allowance, about 12.

**Demerits** combine badness with penalties and style rules. For each line, TeX computes (line penalty + badness)², adds the square of the break's penalty (or subtracts it, for a negative penalty that encourages a break), and adds fixed surcharges:

- **double-hyphen demerits** when two consecutive lines end in hyphens;
- **final-hyphen demerits** when the second-to-last line ends in a hyphen;
- **adjacent demerits** when a line's *fitness class* differs sharply from the previous line's.

There are four fitness classes: tight (*r* below -0.5), decent (up to 0.5), loose (up to 1) and very loose (above 1). The surcharge applies when a tight line sits next to a loose or very loose one, or a decent line next to a very loose one, because a sudden change of texture is more visible than a uniformly loose paragraph.

The best paragraph is the sequence of breaks with the lowest total demerits. Squaring the badness is what makes the algorithm spread slack around: two moderately loose lines cost less than one tight line and one very loose one.

## Finding the best breaks efficiently

A naive search would try every combination of breaks. Knuth and Plass instead use dynamic programming over *active nodes*. Scanning the paragraph from the start, the algorithm keeps a list of break positions that could still begin a feasible line. At each new legal break it evaluates a line from every active node, keeps the cheapest way of arriving at this break (one per fitness class, so the adjacency rule can still be applied), and removes any active node that is now too far back to reach without overfilling a line. When the scan reaches the forced break at the end, following the stored links backwards from the cheapest final node gives the optimal set of breaks.

Because a line can only hold so many words, the active list stays short: roughly as many nodes as there are feasible break positions within one line's reach. The work is therefore close to linear in the length of the paragraph, and in practice a paragraph of a few hundred words breaks in well under a millisecond.

The algorithm is exact with respect to its cost model. It finds the minimum-demerits paragraph for the given widths, stretchabilities and penalties, and no other. Its quality is entirely a matter of whether the cost model captures what readers see. It knows nothing about rivers of white running down a paragraph, or about a word repeated at the start of successive lines.

### How TeX uses it

TeX wraps the algorithm in up to three passes.[^tex]

1. A first pass without hyphenation, accepting only lines with badness up to `\pretolerance` (plain TeX: 100). If every line can be set that well without hyphens, TeX never hyphenates.
2. A second pass with hyphenation, accepting badness up to `\tolerance` (200).
3. If that fails and `\emergencystretch` is set, a third pass that pretends every line has that much extra stretch. This lets it choose among bad options instead of giving up. Without this pass, TeX sets overfull or underfull lines and warns.

The default costs are a line penalty of 10, a hyphen penalty of 50, 10,000 double-hyphen and adjacent demerits, and 5,000 final-hyphen demerits.

The emergency pass matters more than its name suggests. TeX reports every badness from 8,192 upward as 10,000, so beyond a stretch ratio of about 4.3 every line is equally "bad" and the algorithm can no longer tell a merely ugly line from an absurd one. The implementation behind the measurements and the demo in this chapter hit exactly this. Without emergency stretch, at phone widths it happily chose a line stretched 29 times its allowance to save demerits elsewhere. With 3 em of emergency stretch, a commonly used setting, the problem disappeared.

## Try it

The demo below runs a complete Knuth-Plass implementation (boxes, glue and penalties with TeX's default parameters and three passes) in your browser, against a first-fit breaker and against your browser's own `text-wrap: pretty`. It measures every word with your browser's rendering of the page font, so the three columns use identical widths. The first sample is the paragraph from the Brothers Grimm that Knuth and Plass used as the running example in their paper.

> **Interactive demo.** The published handbook runs a Knuth–Plass breaker, a first-fit breaker and the browser's `text-wrap: pretty` side by side here. The same code is `lab/kp.js`; open `lab/linebreak-lab.html` in a Chromium browser to run it.

Things to try:

- **Justified text at 30 to 40 characters.** Both methods produce very loose lines, because short lines have too few spaces to absorb the slack. Total-fit mostly buys fewer hyphens there, not better spacing.
- **Justified text at 60 to 75 characters.** The total-fit paragraph has visibly more even spacing.
- **Ragged right.** The differences shrink, and the total-fit right edge is only a little more even.
- **Hyphenation off.** This shows how much work hyphenation does for any algorithm.

## Measured: first-fit, total-fit and Chromium

To put numbers on the difference, the same four paragraphs were set in four fonts (Literata, Source Serif 4, EB Garamond and Inter at 18px) at five target line lengths from 30 to 80 average characters, justified and ragged: 160 configurations in all. Each was broken three ways: first-fit, the Knuth-Plass implementation above, and Chromium's own layout with `text-wrap: wrap` and `text-wrap: pretty`, with the breaks read back from the rendered page. Every break was then scored under the same cost model, so the columns are directly comparable. Hyphenation points were identical for all methods.

| Target characters per line | Mean adjustment ratio, first-fit | total-fit | Very loose lines per paragraph, first-fit | total-fit | Widest space (em), first-fit | total-fit | Hyphens per paragraph, first-fit | total-fit | Lines per paragraph, first-fit | total-fit |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 30 | 2.03 | 1.90 | 11.0 | 11.1 | 0.93 | 0.81 | 2.7 | 0.9 | 17.4 | 17.1 |
| 40 | 1.73 | 1.36 | 7.6 | 6.1 | 0.74 | 0.69 | 1.1 | 0.1 | 13.1 | 12.8 |
| 50 | 1.25 | 0.79 | 4.9 | 3.8 | 0.57 | 0.45 | 1.3 | 0.5 | 10.3 | 10.2 |
| 66 | 0.92 | 0.34 | 2.8 | 1.3 | 0.43 | 0.35 | 0.6 | 0.6 | 7.5 | 7.5 |
| 80 | 0.58 | 0.22 | 0.9 | 0.2 | 0.35 | 0.32 | 0.4 | 0.3 | 6.5 | 6.5 |

The table averages 16 paragraphs per row. The adjustment ratio is how far a line's spaces are stretched relative to their allowance, where 1 means spaces half as wide again as normal. A very loose line has a ratio above 1. The widest space is the largest interword space in the paragraph, in ems; the normal space in these fonts is 0.2 to 0.25 em.

Four findings stand out.

**Chromium's `text-wrap: wrap` is first-fit.** It chose exactly the same breaks as the first-fit model in 158 of 160 configurations. The two exceptions were lines that fitted to within a fraction of a pixel. This also validates the measurement: the script's widths match the engine's.

**At comfortable line lengths, total-fit is clearly better.** At 66 characters it cut the mean stretch by more than half and the number of very loose lines from 2.8 to 1.3 per paragraph. At 80 characters it cut very loose lines by four-fifths and left no line beyond TeX's tolerance. It produced one line fewer than first-fit in 12 of the 80 justified paragraphs and one line more in only one.

**At phone widths, nothing rescues justified text.** At 30 characters both methods leave about 11 very loose lines in a paragraph of 17. The widest space in each paragraph averages about four times the normal width, and reaches eight times in the worst case. Total-fit spends its advantage on avoiding hyphens (0.9 per paragraph against 2.7) rather than on spacing, because TeX's costs weight a hyphen heavily. Lowering the hyphen penalty shifts that balance, but no parameter can make 30-character justified lines even.

**Chromium's `text-wrap: pretty` is an orphan guard, not a paragraph optimizer.** It changed the breaks in only 5 of the 80 justified paragraphs, all of them paragraphs whose last line was very short (9 to 20 per cent of the measure). In each case it pulled words down to fill the last line to 24 to 61 per cent, and in every case the interior spacing paid for it. The mean stretch rose in all five, and in two of them the worst line's stretch more than doubled:

| Font | Characters | Paragraph | Last-line fill, wrap | Last-line fill, pretty | Mean ratio, wrap | Mean ratio, pretty | Mean ratio, total-fit |
| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: |
| Literata | 40 | narrow | 0.09 | 0.24 | 1.98 | 2.41 | 1.62 |
| Literata | 50 | frog | 0.13 | 0.38 | 1.30 | 1.96 | 1.75 |
| Source Serif 4 | 30 | frog | 0.20 | 0.61 | 1.95 | 2.68 | 1.61 |
| EB Garamond | 50 | frog | 0.12 | 0.38 | 0.99 | 1.65 | 1.09 |
| Inter | 40 | frog | 0.14 | 0.45 | 1.39 | 1.88 | 0.66 |

The source code explains why. Chromium's scoring line breaker is modelled on Android's high-quality breaker, but its "optimal" path, used by `pretty`, is capped at the last four lines of a paragraph.[^blink] It can repair an ending but never sees the paragraph's interior. That is a defensible choice for a browser, where optimizing every paragraph on every layout would be expensive, but it means `text-wrap: pretty` in Chromium will not fix justified body text. WebKit's implementation, shipped in Safari 26, runs over the whole paragraph with its own stretch and shrink model and aims for at least two words on the last line.[^webkit] It was not measured here, and Firefox has not implemented `pretty` at all.[^bcd-lb]

The specification allows all of this. CSS Text 4 defines `pretty` only as preferring quality over speed across multiple lines, and it has just added a separate value, `avoid-short-last-line`, for exactly what Chromium's `pretty` does. No engine ships it yet.[^csstext4]

For ragged-right text the differences are smaller, as the model predicts:

| Target characters per line | Spread of line ends (SD, em), first-fit | total-fit | Chromium pretty | Largest gap at line end (em), first-fit | total-fit | Chromium pretty | Last-line fill, first-fit | total-fit | Chromium pretty |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 30 | 0.65 | 0.51 | 0.67 | 2.37 | 1.90 | 2.43 | 0.46 | 0.45 | 0.47 |
| 40 | 0.74 | 0.63 | 0.76 | 2.53 | 2.40 | 2.68 | 0.47 | 0.47 | 0.50 |
| 50 | 0.75 | 0.65 | 0.81 | 2.48 | 2.29 | 2.65 | 0.59 | 0.61 | 0.62 |
| 66 | 0.63 | 0.55 | 0.63 | 2.16 | 2.05 | 2.16 | 0.91 | 0.92 | 0.91 |
| 80 | 0.51 | 0.48 | 0.51 | 1.62 | 1.55 | 1.62 | 0.55 | 0.55 | 0.55 |

Total-fit made line endings modestly more even at every length: the spread of line ends fell by 6 to 22 per cent. Chromium's `pretty` again changed only paragraphs with short last lines.

> **How this was measured.** Chromium 152 on Windows 11. Samples: the Grimm paragraph from Knuth and Plass's paper (Margaret Hunt's public-domain translation) and three original paragraphs of 70 to 90 words, with dictionary hyphenation points inserted as soft hyphens and filtered to TeX's minimum fragments (two letters before a hyphen, three after). Widths came from canvas `measureText` in the rendered font. Parameters were TeX's plain-format defaults, with interword stretch of 1/2 and shrink of 1/3 of the space, 3 em of emergency stretch, and 2 em of line-end stretch for ragged right. Line length was set as the target number of average characters times the font's measured average character width. Browser breaks were recovered from per-character client rectangles and mapped back onto the same items. The raw results are saved as JSON.

## What the evidence says about readers

Everything above measures typographic quality in typographers' terms: evenness of spacing, hyphen counts, raggedness. Whether readers read faster or understand more from total-fit paragraphs is a separate question, and **no study was found that tests it**. Knuth and Plass's own comparisons were typographic measurements, not reader tests. On difficult copy, the optimum reduced the standard deviation of spacing from 0.65 to 0.53, lines with very wide spaces from 24 to 7, and hyphens from 119 to 80, compared with best-fit.[^kp-exp] The authors themselves called their demerit formula "quite arbitrary", justified by experience rather than reader data. **[D]**

The older research on justification points in two directions, and chapter 2 grades it:

- **Crude justification hurts.** Justification made by inserting whole extra spaces slowed reading.[^trollip] Justified short lines lowered comprehension for poorer readers.[^gregory]
- **The method matters.** Justification that spread space proportionally between and within words was read faster than ragged text.[^campbell]

None of these studies used TeX- or InDesign-quality justification, so the question that matters to a reader app is open **[X]**. The honest position is that total-fit breaking removes the most visible defects of justified text, very loose lines and runs of hyphens. Whether that makes reading measurably better is untested. It is worth doing for justified text because the defects it removes are the ones readers notice. It should not be sold as a reading-speed feature.

## Who implements what

| System | Line breaking | Notes |
|---|---|---|
| TeX, pdfTeX, XeTeX | Total-fit, three passes | Reference implementation (`tex.web` §813–890); pdfTeX adds font expansion and protrusion; XeTeX adds protrusion and ICU breaking but no expansion |
| LuaTeX | Total-fit, replaceable | `linebreak_filter` lets Lua replace or call the breaker; hyphenates the whole paragraph first |
| LuaMetaTeX / ConTeXt | Total-fit with configurable extra passes | `\parpasses` recipes vary tolerance, emergency stretch and costs per pass; up to 31 fitness classes; penalties for orphans, one-letter words and repeated line edges |
| Typst 0.15 | Total-fit ("optimized") for justified text, first-fit otherwise | Uses the paper's (1 + badness + penalty)² formula without fitness classes; runs an approximate pass first to prune the exact one; overhanging punctuation on by default; hyphenates only justified text by default |
| Adobe InDesign | Paragraph Composer (default) evaluates all lines together; Single-line Composer finalizes line by line | Default word spacing 80/100/133 per cent; glyph scaling and letter spacing kept within about ±3 per cent |
| Apache FOP | Knuth-style breaker with four fitness classes | Also applies the model to page breaking |
| Android | `BREAK_STRATEGY_HIGH_QUALITY` (whole paragraph, default for TextView), `BALANCED`, `SIMPLE` (default for EditText) | Minikin scores slack squared, not TeX badness; hyphenation off by default since Android 10; inter-character justification from API 35 |
| Chromium | First-fit; `pretty` re-optimizes at most the last 4 lines, only when the last line is under a third of the measure or ends a run of hyphens | Modelled on Android's breaker; `balance` limited to 6 lines |
| WebKit | First-fit; `pretty` (Safari 26) re-optimizes the whole paragraph | Improves rag, avoids short last lines, reduces hyphenation; rivers not handled |
| Gecko | First-fit; no `pretty` | `balance` supported |
| Apple TextKit / Core Text | First-fit with orphan avoidance (`lineBreakStrategy.pushOut`) | No documented paragraph optimizer |
| DirectWrite, Skia (Flutter), KOReader's crengine | First-fit | crengine condenses spaces and hyphenates when a word does not fit |
| LibreOffice Writer | First-fit | Recent versions added hyphenation zone, minimum word length, hyphenation across columns and pages, and (25.8) minimum, desired and maximum word spacing |
| Rust `textwrap` | First-fit or optimal-fit | Optimal-fit runs in linear time with the SMAWK algorithm on a simplified squared-gap cost |
| JavaScript | Bram Stein's `typeset`, Robert Knight's `tex-linebreak` | Both implement Knuth-Plass |

Sources for the table are in the notes.[^impl]

## Faster and simpler relatives

The total-fit problem is an instance of the **least-weight subsequence** problem: choose break positions to minimize the sum of per-line costs. Hirschberg and Larmore showed in 1987 that it reduces to a shortest-path problem, solvable in O(*n* log *n*) time for suitable costs and in linear time for some. Later work (Wilber; Galil and Park; Eppstein, Galil and Giancarlo) reached linear time for concave costs, using the SMAWK matrix-searching algorithm.[^lws]

These fast algorithms need a cost that depends only on each line's total width through a convex function, which is what minimum-raggedness formulations (sum of squared slack) provide. TeX's full model breaks that property in four ways:

- badness saturates at 10,000;
- infeasible lines are cut off outright;
- demerits depend on the previous line's fitness class and hyphen flag;
- looseness and varying line lengths add state.

So the linear-time algorithms apply to simplified models, like Rust `textwrap`'s squared-gap cost, which runs about four times slower than first-fit. TeX's richer model runs in near-linear time in practice without them, because the active list stays short.

**Balanced wrapping** (`text-wrap: balance`) is a different objective: make all lines as equal as possible, for headings and captions. The CSS specification lets browsers skip balancing beyond ten lines. Chromium balances at most 6 lines, Firefox 10, and WebKit has no limit.

## Hyphenation

### Patterns

Almost every open hyphenation system descends from Frank Liang's 1983 Stanford thesis.[^liang] Instead of a dictionary of hyphenated words, Liang's method stores short letter patterns with digits between letters. At each position the highest digit wins, and an odd digit permits a hyphen. The patterns are packed into a compact trie. For TeX82, 4,919 patterns (4,447 distinct) found 89.3 per cent of the hyphens in a 49,858-word pocket dictionary with essentially no errors. The method is fast, small and language-independent: the same code serves every language that has patterns.

TeX's rules on top of the patterns are worth copying:

- a minimum of 2 letters before a hyphen and 3 after (`\lefthyphenmin` and `\righthyphenmin`);
- words must have at least five letters;
- capitalized words are hyphenated only if `\uchyph` allows;
- hyphenation is attempted only if the first pass fails, so text that sets well without hyphens gets none.

Consecutive hyphens and a hyphen on the second-to-last line are discouraged by demerits rather than forbidden outright. Bringhurst's craft rules agree: leave at least two characters behind and take at least three forward, avoid more than three consecutive hyphenated lines, and never leave a stub as the last line of a paragraph.

### Licences matter if you bundle patterns

The standard collection of patterns, hyph-utf8, carries a licence per language, and not all are permissive.[^hyphlic]

| Licence | Languages |
|---|---|
| MIT, BSD or similar | English (GB), German (1996 spelling), French, Spanish, Dutch, Polish, Portuguese |
| Permissive notice (notice must be kept) | English (US; Kuiken's extended set) |
| MIT or LPPL (your choice) | Italian, Danish, Ukrainian, Modern Greek |
| **LPPL only** | Swedish, Russian, Turkish |
| **GPL** | Czech |
| **MPL / GPL / LGPL** | Hungarian |

The LPPL-only and GPL files need legal review before they go into a closed-source app. LibreOffice's libhyphen (tri-licensed LGPL, GPL and MPL) extends the pattern method with non-standard hyphenation, where letters change at the break (old German "ck" becoming "k-k", Hungarian "ssz" becoming "sz-sz"), which TeX's model cannot express. For JavaScript, Hyphenopoly (MIT, WebAssembly) is the maintained choice. For Rust, Typst's `hypher` embeds patterns for 48 languages.

### Browser hyphenation

`hyphens: auto` needs a declared language and a dictionary. Chrome has hyphenated on all desktop platforms since version 88, Firefox ships its own dictionaries, and Safari uses the operating system's. Coverage differs: Chrome lacks Polish, Finnish, Catalan and Turkish, Firefox lacks Indic languages, and Safari lacks many Central and Eastern European languages. As chapter 1 showed, embedded engines may ship no dictionaries at all. `hyphenate-limit-chars` (Chrome 109, Firefox 137, not Safari) controls minimum word and fragment lengths. The limit on consecutive hyphenated lines and the rule against hyphenating a paragraph's last word are specified but unimplemented.

A reader that needs consistent hyphenation across platforms, or that runs its own line breaker, should ship pattern-based hyphenation itself rather than rely on the engine.

## Microtypography: protrusion and expansion

Two refinements make justified text look more even without changing the line breaks much.

**Margin kerning (protrusion)** lets punctuation and the edges of round letters hang slightly into the margin, so the edge *looks* straight. Hyphens, periods and quotation marks hang most.

**Font expansion** lets each line widen or narrow its glyphs by a percent or two, so less of the slack falls on word spaces. It traces to Hermann Zapf's hz-program, developed with URW in the early 1990s and described as having later been acquired by Adobe.[^hz] Hàn Thế Thành's 2000 doctoral thesis built both into pdfTeX, integrated with the box-and-glue model so that expansion gives the line breaker more flexibility. Informal ratings at conferences suggested readers rarely notice expansion of up to about 2 to 3 per cent. They noticed runs of hyphens, rivers and bad kerning far more.[^thanh] **[C]**

The LaTeX `microtype` package exposes these features. Protrusion works in pdfTeX, LuaTeX and XeTeX; expansion only in pdfTeX and LuaTeX. InDesign offers optical margin alignment and glyph scaling. Typst hangs punctuation by default. On the web, only Safari implements `hanging-punctuation` (fully from 26.5), and no browser implements glyph expansion. A reader with its own renderer can implement protrusion simply: give each protruding character a negative margin equal to a fraction of its width at line edges.

## Pagination

Breaking a chapter into pages is the same kind of problem one level up, and much harder.

**TeX's page builder is greedy.** It adds lines to the page and remembers the best break so far. The cost combines page badness with penalties for:

- a single line of a paragraph left at the foot of a page (`\clubpenalty`, 150 in plain TeX);
- the last line of a paragraph at the head of the next (`\widowpenalty`, 150);
- a page ending on a hyphen (`\brokenpenalty`, 100).

It breaks as soon as the page overflows.[^pagebuilder] Michael Plass's 1981 thesis showed that some pagination problems with floating figures are NP-complete. Its exact results could not be verified for this handbook.

**Global pagination is research, not product.** Frank Mittelbach's framework (DocEng 2016) optimizes page breaks globally, Knuth-Plass style, using paragraph variants that run a line longer or shorter. His 2017 work adds float placement.[^mittelbach] Brüggemann-Klein, Klein and Wohlfeil showed no online algorithm can approximate optimal pagination, and proposed minimizing page turns by dynamic programming.[^bkw]

**E-readers paginate with CSS columns.** Readium and Foliate lay a chapter out as columns the width of the screen. Page breaking therefore inherits the browser's rules: `widows` and `orphans` work in Chromium and Safari but not Firefox, and `break-after: avoid` (keeping a heading with what follows) works only in Chromium.[^bcd-page] A heading stranded at the bottom of a page is the most visible pagination fault in web-based e-readers, and a reader that paginates itself should fix it first.

## Engineering it into a reader

1. **Decide per paragraph type.** Run total-fit breaking on justified body paragraphs; use the engine's own breaking for headings (with `balance`), lists, tables, code (never) and verse (never).
2. **Hyphenation and justification are one decision.** Real engines couple them. TeX hyphenates only when the first pass fails, Typst only when justifying, and Android cuts its hyphen penalty to a quarter when justifying. Justify without hyphenation only at wide measures.
3. **Do not justify narrow columns.** Below about 45 characters per line, fall back to ragged right. The measurements above show no algorithm makes 30-character justified lines even.
4. **Cache by paragraph.** Resizing or changing the font invalidates every break, but the work is per paragraph and parallel. Cache results keyed on paragraph, width, face, size and settings, and recompute visible paragraphs first.
5. **Bound the cost.** Keep a fallback (first-fit) for paragraphs too long to optimize interactively. Knuth and Plass's appendix processes long paragraphs in windows and emits all but the last line. Chromium's four-line limit and Android's greedy default for editable text exist for the same reason.
6. **Use emergency stretch, not unlimited tolerance.** As shown above, raising the tolerance to 10,000 lets the algorithm concentrate slack into absurd lines. Emergency stretch keeps bad lines distinguishable.
7. **Keep it deterministic.** TeX uses fixed-point arithmetic so results are identical across machines. A reader that syncs positions across devices needs the same guarantee, or page numbers will drift.
8. **Render what you computed.** If breaking happens in script, emit explicit lines with the computed word spacing, as the demo does, and keep the underlying text intact for selection, search and screen readers.

[^kp]: Donald E. Knuth and Michael F. Plass, "Breaking Paragraphs into Lines", *Software: Practice and Experience* 11(11), 1119–1184, November 1981. Reprinted with additions in Knuth, *Digital Typography* (CSLI, 1999), chapter 3. [doi.org/10.1002/spe.4380111102](https://doi.org/10.1002/spe.4380111102).
[^cmr]: The font dimensions of cmr10: interword space 3.33333pt, stretch 1.66666pt, shrink 1.11111pt. Knuth, *The TeXbook* (1984), Appendix F, and *Computer Modern Typefaces* (1986).
[^blink]: Chromium source, `third_party/blink/renderer/core/layout/inline/score_line_break_context.h` (`kMaxLinesForOptimal = 4`, `kMaxLinesForBalance = 6`) and `score_line_breaker.h`, read 22 September 2026. [github.com/chromium/chromium](https://github.com/chromium/chromium/blob/main/third_party/blink/renderer/core/layout/inline/score_line_break_context.h).
[^webkit]: Jen Simmons, "Better typography with text-wrap pretty", WebKit blog, 8 April 2025, [webkit.org/blog/16547](https://webkit.org/blog/16547/better-typography-with-text-wrap-pretty/); WebKit source, `InlineContentConstrainer.cpp`.
[^bcd-lb]: MDN browser-compat-data 8.1.2 (17 September 2026), `css.properties.text-wrap-style`: `pretty` in Chrome 117 (as the `text-wrap` value) and Safari 26; not in Firefox.
[^csstext4]: CSS Text Module Level 4, Working Draft of 14 August 2026, §5.4 `text-wrap-style`, and its changes section (the value was briefly named `avoid-orphans`). [w3.org/TR/css-text-4](https://www.w3.org/TR/css-text-4/).
[^tex]: Knuth, *TeX: The Program* (1986), part 38 "Breaking paragraphs into lines" and part 39; *The TeXbook*, chapter 14; parameter values from `plain.tex`. [ctan.org/tex-archive/systems/knuth/dist](https://ctan.org/tex-archive/systems/knuth/dist).
[^kp-exp]: Knuth and Plass 1981, pp. 1127–1130 (first-fit, best-fit and total-fit compared) and p. 1165, Figure 20 (difficult copy); p. 1129 on the formula being "quite arbitrary".
[^trollip]: Stanley Trollip and Gregory Sales, "Readability of computer-generated fill-justified text", *Human Factors* 28(2):159–163, 1986. [doi.org/10.1177/001872088602800204](https://doi.org/10.1177/001872088602800204).
[^gregory]: Margaret Gregory and E. C. Poulton, "Even versus uneven right-hand margins and the rate of comprehension in reading", *Ergonomics* 13(4):427–434, 1970. [doi.org/10.1080/00140137008931157](https://doi.org/10.1080/00140137008931157).
[^campbell]: Anthony Campbell, Frank Marchetti and D. J. K. Mewhort, "Reading speed and text production: a note on right-justification techniques", *Ergonomics* 24(8):633–640, 1981. [doi.org/10.1080/00140138108924885](https://doi.org/10.1080/00140138108924885).
[^impl]: TeX: `tex.web`, plain.tex, *The TeXbook* ch. 14; pdfTeX manual 1.40.27, XeTeX reference guide and LuaTeX manual 1.21 (2025); LuaMetaTeX manual (February 2026); Typst 0.15 documentation (`par`, `text`) and `crates/typst-layout/src/inline/linebreak.rs`; Adobe InDesign help (updated June 2026); Apache FOP `BreakingAlgorithm.java`; Android `LineBreaker`, `TextView` and `LineBreakConfig` references and Minikin `OptimalLineBreaker.cpp`; Chromium `score_line_breaker.h` and `score_line_break_context.h`; WebKit blog, April 2025; Apple `NSParagraphStyle.LineBreakStrategy`; Microsoft `DWRITE_WORD_WRAPPING`; LibreOffice release notes 7.4–26.2; `textwrap` 0.16.4 documentation.
[^lws]: Daniel Hirschberg and Lawrence Larmore, "The least weight subsequence problem", *SIAM Journal on Computing* 16(4):628–638, 1987; Robert Wilber, *Journal of Algorithms* 9(3):418–425, 1988; Zvi Galil and Kunsoo Park, *Information Processing Letters* 33(6):309–311, 1990; Aggarwal, Klawe, Moran, Shor and Wilber, "Geometric applications of a matrix-searching algorithm" (SMAWK), *Algorithmica* 2:195–208, 1987.
[^liang]: Franklin Mark Liang, *Word Hy-phen-a-tion by Com-put-er*, Stanford PhD thesis, 1983 (report STAN-CS-83-977), abstract and Table 5. [tug.org/docs/liang](https://tug.org/docs/liang/liang-thesis.pdf).
[^hyphlic]: Licence headers of the `hyph-*.tex` files in the hyph-utf8 repository, read September 2026. [github.com/hyphenation/tex-hyphen](https://github.com/hyphenation/tex-hyphen); hunspell/hyphen README for libhyphen.
[^hz]: Peter Karow, "Le programme hz", *Cahiers GUTenberg* 27:34–70, 1997, a translation of a 1993 URW note; the acquisition by Adobe is reported there and in Hàn Thế Thành's thesis, not in an Adobe source.
[^thanh]: Hàn Thế Thành, "Micro-typographic extensions to the TeX typesetting system", doctoral thesis, Masaryk University, 2000, reprinted in *TUGboat* 21(4). [tug.org/TUGboat/Articles/tb21-4/tb69thanh.pdf](https://tug.org/TUGboat/Articles/tb21-4/tb69thanh.pdf). Robert Schlicht, *microtype* package documentation, version 3.2c (2026).
[^pagebuilder]: Knuth, `tex.web` part 45 ("The page builder") and §890; plain.tex lines 290–293.
[^mittelbach]: Frank Mittelbach, "A General Framework for Globally Optimized Pagination", DocEng 2016, pp. 11–20, [doi.org/10.1145/2960811.2960820](https://doi.org/10.1145/2960811.2960820); "Effective Floating Strategies", DocEng 2017, pp. 29–38.
[^bkw]: Anne Brüggemann-Klein, Rolf Klein and Stefan Wohlfeil, "On the pagination of complex documents", in *Computer Science in Perspective*, Springer, pp. 49–68.
[^bcd-page]: MDN browser-compat-data 8.1.2: `widows` and `orphans` (Chrome 25, Safari 1.3, not Firefox); `break-after: avoid` recognized but without effect in Firefox and Safari. Readium CSS pagination documentation (CSS03).
