<!-- Generated from source/11-sources.md by source/to-gfm.mjs; edit the source, then run the script. -->

# Typography Source Ledger

*Every important source behind the handbook, graded for quality, with a note on what each one shows and what it does not. It includes the sources that turned out weaker than their reputations, and the claims the research could not verify, which were left out of the chapters on purpose.*

Evidence grades: **[A]** replicated findings or a meta-analysis · **[B]** one well-designed study · **[C]** small, limited or mixed studies · **[D]** expert convention without a direct test · **[X]** contested or contradicted. Part of the [Reader Typography Handbook](README.md).

## How sources were chosen and graded

The research behind this handbook was carried out in September 2026, reading sources directly rather than through summaries. Sources fall into three tiers.

- **Tier 1, primary.** The paper itself, the standard's own text, a font's own repository and licence, an engine's source code, or the implementers' own documentation.
- **Tier 2, recognized expertise.** Authoritative books and experts writing about their own field, and MDN's browser compatibility data.
- **Tier 3, reputable secondary.** Used sparingly and always labelled.

Wikipedia, listicles, font aggregator sites, AI-generated summaries and vendor claims presented as evidence were excluded. Where only an abstract could be read, the entry says so. Evidence grades for findings (**[A]** to **[X]**) are explained on the orientation page.

## Line breaking and typesetting systems

**Knuth and Plass (1981), "Breaking Paragraphs into Lines"**, *Software: Practice and Experience* 11(11):1119–1184. Tier 1, read in full.
: The founding paper for the box, glue and penalty model and the total-fit algorithm. Its comparisons with first-fit and best-fit are typographic measurements on the authors' own texts, not reader studies. The authors call their demerit formula arbitrary and justified by experience. [doi.org/10.1002/spe.4380111102](https://doi.org/10.1002/spe.4380111102)

**Knuth, `tex.web`, `plain.tex` and *The TeXbook***. Tier 1.
: The reference implementation. It differs from the paper in its demerit formula, infinity threshold, fitness-class definitions and pass structure; both are described in chapter 5. [ctan.org](https://ctan.org/tex-archive/systems/knuth/dist)

**Knuth (1989), "The new versions of TeX and METAFONT"**, *TUGboat* 10(3). Tier 1.
: Introduces `\emergencystretch` and the hyphenation-minimum parameters in TeX 3.0.

**Liang (1983), *Word Hy-phen-a-tion by Com-put-er***, Stanford thesis. Tier 1, read in full.
: The pattern method behind nearly every open hyphenation system; 4,919 patterns found 89.3 per cent of hyphens with essentially no errors. [tug.org/docs/liang](https://tug.org/docs/liang/liang-thesis.pdf)

**Hàn Thế Thành (2000), "Micro-typographic extensions to the TeX typesetting system"**, thesis, reprinted in *TUGboat* 21(4). Tier 1.
: Margin kerning and font expansion in pdfTeX. Its reader evidence is informal conference ratings, not controlled studies.

**Mittelbach (2016, 2017)**, DocEng papers on globally optimized pagination and float placement. Tier 1, abstracts read.
: The state of the art in optimal pagination. It is research code, not a product feature.

**Engine sources and blogs.** Tier 1.
: Chromium `score_line_breaker.h` and `score_line_break_context.h` show that `pretty` is limited to 4 lines and `balance` to 6. The WebKit blog (April 2025) describes whole-paragraph `pretty` in Safari. Android's `LineBreaker` references and Minikin's `OptimalLineBreaker.cpp` show squared-slack scoring. Typst's documentation and `linebreak.rs` show the paper's formula without fitness classes.

**CSS Text Level 3 and 4.** Tier 1.
: `text-wrap-style`, including the new `avoid-short-last-line`, plus hyphenation properties, `text-justify`, spacing properties and the cursive letter-spacing rule. [w3.org/TR/css-text-4](https://www.w3.org/TR/css-text-4/)

**MDN browser-compat-data 8.1.2** (17 September 2026). Tier 2.
: All browser version numbers in the handbook. Per-language hyphenation entries are hard to verify and may lag.

## Reading research

**Legge and Bigelow (2011), "Does print size matter for reading?"**, *Journal of Vision* 11(5):8. Tier 1/2, read in full.
: The authority on print size: critical print size, the fluent range, and x-height as the measure of size. It is the single most important source for size defaults. [doi.org/10.1167/11.5.8](https://doi.org/10.1167/11.5.8)

**Calabrèse and colleagues (2016)**, MNREAD norms, *IOVS* 57(8). Tier 1.
: 645 readers aged 8 to 81. Critical print size for young adults comes out at about half the consensus figure, a reminder that the value depends on method.

**Rayner (1998)**, eye movements review, *Psychological Bulletin* 124(3). Tier 1/2, read in full.
: The standard numbers for fixations, saccades and perceptual span.

**Dyson (2004)**, "How physical text layout affects reading from screen", *Behaviour & Information Technology* 23(6). Tier 2, read in full.
: The best review of screen layout research. It shows that longer lines are often read faster on screen and separates preference from performance. Several primary studies it summarizes could not be read directly and are cited through it.

**Atilgan, Xiong and Legge (2020)**, *PNAS* 117(48). Tier 1, read in full.
: Line-length floor of about 13 characters; phones cannot serve readers with low acuity at any print size.

**Rello, Pielot and Marcos (2016)**, "Make It Big!", CHI. Tier 1, read in full.
: Widely cited for "use 18-point text". Its sizes appear to be CSS pixels despite being called points, it did not measure reading time, and its smallest sizes were below critical print size. It supports "don't go below the critical size" more than any specific number.

**Wallace and colleagues (2022)**, "Towards Individuated Reading Experiences", *ACM TOCHI* 29(4). Tier 1, read in full.
: Widely cited for "the right font makes you read 35 per cent faster". The figure is each person's best minus worst of noisy measurements. Across the whole sample, font was not significant. The durable finding is that preference does not predict speed.

**Arditi and Cho (2005, 2007)**, *Vision Research*. Tier 1, read in full.
: Serifs make no difference to reading speed. Capitals are more legible than lowercase at equal point size for small print.

**Piepenbrock and colleagues (2013, 2014)**; **Buchner and Baumgartner (2007)**; **Dobres and colleagues (2016, 2017)**. Tier 1.
: Positive polarity advantage, strongest for small text and, in glance reading, in dark surroundings.

**Delgado and colleagues (2018)**; **Clinton (2019)**; **Salmerón and colleagues (2024)**; **Kong, Seo and Zhai (2018)**. Tier 1, meta-analyses, abstracts read.
: The screen-inferiority effect: small, concentrated in informational text under time pressure, with mechanisms in metacognition rather than legibility.

**Sanchez and Wiley (2009)**; **Haverkamp and colleagues (2022)**. Tier 1.
: Scrolling versus paging: a small lean toward paging for deep reading.

**Dyslexia studies.** Tier 1.
: Zorzi and colleagues (2012, *PNAS*), Kuster and colleagues (2018), Marinus and colleagues (2016), Wery and Diliberto (2017), Galliussi and colleagues (2020), Hakvoort and colleagues (2017) and the 2026 meta-analysis by Azzarello and colleagues (*Annals of Dyslexia*). Together: special fonts do not help, and spacing sometimes helps some readers.

**Justification studies.** Tier 1, abstracts read.
: Gregory and Poulton (1970), Campbell, Marchetti and Mewhort (1981), Trollip and Sales (1986). Crude justification hurts; better methods may not. None tested modern paragraph-optimizing justification.

**Syntax highlighting studies.** Tier 1.
: Sarkar (2015), Hakala and colleagues (2006), Beelders and du Plessis (2016), Hannebauer, Hesenius and Gruhn (2018). Small speed effects and no comprehension effect in the largest study.

## Standards and accessibility

**WCAG 2.2** and its **Understanding** documents. Tier 1.
: The binding requirements. Chapter 2 notes that 1.4.12's values are override-robustness targets with research behind only the letter-spacing value, and that 1.4.8's values cite no tests. [w3.org/TR/WCAG22](https://www.w3.org/TR/WCAG22/)

**WCAG 3.0 Working Draft** (10 September 2026). Tier 1.
: The contrast algorithm is still undetermined; APCA has not appeared in drafts since July 2023.

**European Accessibility Act** (Directive 2019/882) and **EN 301 549 V4.1.1**. Tier 1.
: E-readers and e-books are in scope of the Act. The harmonised standard excludes e-books.

**W3C Internationalization layout requirements** (JLREQ, clreq, klreq, alreq, the Hebrew draft, ilreq and the gap analyses). Tier 1.
: The basis of chapter 8. Their maturity varies: Myanmar has no document, and the Hebrew and Indic ones are drafts or stale.

**CSS Fonts 4 and 5, CSS Inline 3, CSS Values 4, CSS Writing Modes, CSS Ruby, MathML Core, EPUB 3.3.** Tier 1.

**Unicode Standard 18.0 and its annexes** (UAX #9, #14, #29, #50), and **CLDR 48**. Tier 1.

## Fonts and licensing

**SIL Open Font License 1.1 and its FAQ** (openfontlicense.org). Tier 1, read in full.
: The rules on bundling, embedding, and Reserved Font Names under subsetting and conversion. The FAQ is internally inconsistent on whether bundled apps must include the licence text.

**Font repositories and Google Fonts metadata.** Tier 1.
: Every licence, version, axis range and feature claim in chapter 3.

**google/fonts issue 1335** and the **fontTools subsetter defaults**. Tier 1.
: Why API-served fonts lack small caps and figure styles.

**OpenType specification** (Microsoft). Tier 1.
: Axis definitions (including the points-based `opsz`), OS/2 metrics, `USE_TYPO_METRICS`.

**WOFF 2.0 Evaluation Report** and **Incremental Font Transfer**. Tier 1.

## Craft references

**Bringhurst, *The Elements of Typographic Style***. Tier 2.
: Checked against the 1992 and 1996 editions; the 2012 version 4.0 could not be opened. The minimum paragraph indent changed from "one em" to "one en" between editions. The rule "never both indent and space" is Butterick's, not Bringhurst's.

**Butterick, *Practical Typography***. Tier 2, read directly.
: Numeric ranges for size, leading, line length and paragraphs. It is opinionated and sometimes at odds with Bringhurst (dashes, modular scales, baseline grids).

**Rutter, *Web Typography* and webtypography.net**. Tier 2.
: Screen adaptations of Bringhurst, hyphenation settings for the web, and the case against `ch` for measure.

**Standard Ebooks Manual of Style**. Tier 2.
: The most rigorous public guide to e-book typography: poetry, drama, letters and notes.

**Chicago Manual of Style, 18th edition**. Tier 2.
: Only paragraph titles were verifiable without a subscription. Several web sources cite 17th-edition paragraph numbers that no longer match.

**Tufte CSS**; **Gwern Branwen, "Sidenotes in Web Design"** (Tier 3, practitioner survey).
: Margin notes on screens.

**Google and Microsoft developer style guides**. Tier 1 for their own practice.

## Reading systems

**Readium CSS 2.0.5.** Tier 1.
: Defaults, the user-settings model and ranges, script line-height factors. Its warning that Blink cannot hyphenate on Windows is out of date.

**Firefox Reader View source, KOReader source, Foliate schema, Amazon KDP Help, Apple Books Asset Guide.** Tier 1.
: What shipping readers actually do. Apple's guide contradicts itself on px versus percentage font sizes.

## Code and colour

**Official theme repositories** (GitHub Primer, Solarized, One Dark, Monokai via archived original, Dracula spec, Nord, Gruvbox, Tomorrow, Catppuccin, Tokyo Night, VS Code theme-defaults, Alabaster). Tier 1.
: The colour values behind chapter 6's contrast table. Two discrepancies surfaced. Solarized's official vim file uses a different green (#719e07) from its README (#859900), and Dracula's specification makes numbers orange while its official VS Code port makes them purple.

**Prokopov (2025), "I am sorry, but everyone is getting syntax highlighting wrong"**. Tier 3, opinion.
: The minimalist argument, presented as opinion.

**Ottosson (2020)**, OKLab; **CSS Color 4**; **Okabe and Ito**, Color Universal Design; **US National Eye Institute**. Tier 1.

## Sources that were weaker than their reputation

These appear in the chapters, but with their limits stated. Several are widely cited for claims they do not support.

- **"The right font makes you read 35 per cent faster"** (Wallace and colleagues, 2022). It is a best-minus-worst difference within each person, and there was no population effect.
- **"Use 18-point text"** (Rello and colleagues, 2016). The units are ambiguous and reading time was not measured.
- **"Good typography puts readers in a good mood"** (Larson and Picard, 2005–2006). It rests on a 4-of-10 versus 0-of-9 result whose reported significance does not survive an appropriate test.
- **"45 to 75 characters is optimal"** (Bringhurst). It is print convention, and screen research finds speed often rises with longer lines.
- **WCAG 1.4.8 and 1.4.12's numbers.** Only 1.4.12's letter-spacing value has research behind it (a study of 14 readers), and the Understanding document links a citation to the wrong PDF.
- **Lexend's reading claims.** They rest on one unreviewed demonstration by its developers, with a fixed order that favours the font.
- **Atkinson Hyperlegible and Intel One Mono.** Both were designed with care and with input from people with low vision, but no independent evaluation was found.
- **The British Dyslexia Association style guide.** A useful checklist that cites no research. Its live page returned an error in September 2026.
- **"Dark mode reduces eye strain."** No good study supports it. One recent paper concluded it despite finding no significant difference.

## Claims that could not be verified and were left out

The research could not verify these, so the chapters do not assert them:

- Tinker and Paterson's original print findings, including specific leading optima and "all caps is 12 per cent slower". They are widely repeated from secondary sources.
- Any eye-tracking measurement of the cost of hyphenation at line ends.
- Halation from light text on dark backgrounds for readers with astigmatism.
- Benefits of sepia themes.
- A standard size compensation between scripts (for example, how much larger Devanagari should be set to match Latin).
- The one-page-per-minute rule for screenplays.
- The exact NP-completeness results in Michael Plass's 1981 thesis.
- The current licence terms for Apple's New York and Amazon's Bookerly.
- Which languages GitHub highlights with tree-sitter.
- Screen-reader behaviour with syntax-highlighted code.
- Whether browsers exclude CSS-generated line numbers from copied text.

## Original measurements

Four sets of measurements were made for this handbook, in Chromium 152 on Windows 11, with scripts that saved their raw results:

- **Font metrics for 79 families** (66 open-source, 13 installed with Windows): heights read from rendered outlines at text size, and average character widths from a 1,527-character English sample.
- **A line-breaking comparison over 160 configurations:** first-fit, a Knuth-Plass implementation with TeX's defaults, and Chromium's own `wrap` and `pretty`, all scored under the same cost model.
- **Contrast ratios for 18 published code themes,** computed from their official colour values.
- **Engine behaviour probes:** hyphenation availability, canvas optical sizing, feature stripping in served fonts, and client-rectangle behaviour at hyphenated breaks.

Their methods are described where they are used, in chapters 1, 3, 5 and 6. They are measurements of one engine on one platform at one time: reproduce them before relying on them for another.
