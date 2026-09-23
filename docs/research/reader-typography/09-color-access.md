<!-- Generated from source/09-color-access.md by source/to-gfm.mjs; edit the source, then run the script. -->

# Color and Accessibility

*Accessibility in a reader is not a checklist appended at the end. It is most of what the reading settings are for. This chapter sets out the WCAG requirements that bind a reader's text, what the evidence says about contrast, polarity and dark mode, how to design themes that pass, and what readers with low vision and dyslexia actually need, which is often not what the market offers them.*

Evidence grades: **[A]** replicated findings or a meta-analysis · **[B]** one well-designed study · **[C]** small, limited or mixed studies · **[D]** expert convention without a direct test · **[X]** contested or contradicted. Part of the [Reader Typography Handbook](README.md).

## The requirements that bind a reader

Most readers will be held to WCAG 2.2 at level AA, which is the basis of EN 301 549 and of most accessibility law. In the European Union the European Accessibility Act has applied since 28 June 2025 and names both e-readers and e-books. It requires fonts of adequate size and shape, sufficient contrast, adjustable spacing between letters, lines and paragraphs, and flexibility and choice in the presentation of e-book content.[^eaa] Notably, EN 301 549, the standard usually used to demonstrate compliance, declares e-books outside its scope, so no harmonised e-book benchmark exists yet.[^en301549]

The WCAG 2.2 success criteria that apply to text (paraphrased):[^wcag]

| Criterion | Level | Requirement |
|---|---|---|
| 1.4.3 Contrast (Minimum) | AA | Text at least 4.5:1 against its background; large text (about 24px, or 18.7px bold) at least 3:1 |
| 1.4.4 Resize Text | AA | Text can be enlarged to 200% without loss of content or function |
| 1.4.6 Contrast (Enhanced) | AAA | 7:1, or 4.5:1 for large text |
| 1.4.8 Visual Presentation | AAA | For blocks of text: user-selectable colours, width at most 80 characters (40 for CJK), not justified, line spacing at least 1.5 and paragraph spacing at least 1.5 times line spacing, resizable to 200% without horizontal scrolling. The mechanism may come from the user agent |
| 1.4.10 Reflow | AA | No two-dimensional scrolling at 320 CSS px wide, except for content that needs two-dimensional layout (code blocks can qualify; chapter 6) |
| 1.4.11 Non-text Contrast | AA | Interface components and their states at least 3:1 against adjacent colours |
| 1.4.12 Text Spacing | AA | Nothing breaks when users set line height to 1.5, paragraph spacing to 2 times the font size, letter spacing to 0.12 em and word spacing to 0.16 em |

Three points are easy to miss.

- **Contrast thresholds are not rounded.** 4.499:1 fails.[^u143]
- **1.4.12's values come from research.** They trace to McLeish's 2007 study of letter spacing and reading speed in young readers with low vision, where speed rose up to about 0.25 em of extra spacing. They are a baseline users must be able to reach, not a ceiling.[^u1412]
- **1.4.8 is AAA but describes exactly what a reader's settings do.** A reader that offers colour choice, width limits, unjustified text and adjustable spacing meets it by design.

### Contrast, computed

Contrast ratio is (L1 + 0.05) / (L2 + 0.05), where L is relative luminance computed from linearized sRGB channels as 0.2126 R + 0.7152 G + 0.0722 B. The linearization threshold changed in 2021 from 0.03928 to 0.04045 to match the current sRGB definition, which makes no practical difference.[^wcagdef] The formula is simple and has known weaknesses: it rates some dark-on-dark pairs too kindly and some light pairs too harshly. A replacement, APCA, was proposed for WCAG 3 and appeared in 2021 drafts. It has been absent from every WCAG 3 working draft since July 2023, and the current draft (September 2026) says the contrast method is yet to be determined.[^wcag3] Build to WCAG 2's formula. It is what you will be held to.

## Polarity: dark text or light?

**Dark text on a light ground reads slightly better for most people in most conditions.** Controlled studies found positive polarity (dark on light) produced better acuity and proofreading than negative polarity, in darkness and in office lighting, in younger and older adults alike. The advantage grows as text gets smaller, and one study linked it to smaller pupils under a bright ground, which sharpen the eye's optics.[^polarity] **[A]** Counter-intuitively, the legibility penalty for light-on-dark text was *largest* in dark surroundings in a glance-reading study.[^dobres2017] **[B]** On legibility grounds, a dark room is not a reason for dark mode.

That does not make dark themes wrong, because legibility is not the only thing that matters:

- **Comfort and glare.** A bright page in a dark room is uncomfortable for many readers, whatever its legibility. The effect on sleep of reading on bright screens at night is real, although colour filters do not fix it (chapter 2).
- **Preference.** Many readers choose dark themes and say they read more comfortably.
- **Low vision.** A subset of readers with low vision, especially those with light scatter in the eye, read 10 to 50 per cent faster with light text on dark.[^lowvision] **[B]**
- **Battery** on OLED screens.

The evidence argues for choice, not for either theme as a universal default. The legibility cost of a dark theme is small at comfortable text sizes and grows as text shrinks, so a reader that defaults to dark should also default to generous sizes. These pages default to dark, and the reading settings switch themes in one step.

**What the evidence does not support:**

- that dark mode "reduces eye strain" in general;
- that pure black on pure white must be avoided;
- that sepia or blue-tinted themes improve reading.

These are conventions or preferences **[D]**, and the handbook treats them that way. Chapter 2 grades the studies in detail.

## Designing a dark theme properly

A dark theme is not an inverted light theme. The craft conventions below are all **[D]**, but each follows from something measurable.

**Avoid the extremes, keep the contrast.** Pure white on pure black (21:1) is harsher than it needs to be. The halo around bright text on black, particularly for readers with astigmatism, is widely reported by designers but not well studied. These pages use an off-black ground (#14181b) and off-white body text (#d7dde0), 13:1, far above the AAA threshold of 7:1. Secondary text is 7.7:1, so even it meets AAA.

**Lighten the weight.** Light strokes on a dark ground look heavier than the same strokes dark on light. That is the irradiation illusion, and the raster pipeline compounds it (chapter 1). Type designers compensate with a lighter weight or grade in dark mode. Variable fonts with a grade axis (Roboto Serif, Roboto Flex, Google Sans) can lighten without changing widths, so nothing reflows. With only a weight axis, a small reduction reflows slightly but is still worth doing. These pages set body text at weight 380 in dark mode and 400 in light, with headings at 540 against 580.

**Desaturate accents.** Saturated colours vibrate on dark grounds. Keep accents lighter and less saturated than their light-theme counterparts, and check each one's contrast separately.

**Raise, do not shadow.** On dark grounds, elevation reads better as a slightly lighter surface than as a shadow.

**Check the whole palette, both themes.** The handbook's palette, computed with the WCAG formula:

| Role | Dark theme | Light theme |
|---|---|---|
| Body text on ground | 13.0:1 | 14.8:1 |
| Headings on ground | 15.7:1 | 17.2:1 |
| Secondary text on ground | 7.7:1 | 6.7:1 |
| Links and accent on ground | 9.1:1 | 6.3:1 |
| Code tokens on code ground (lowest) | 8.3:1 | 6.0:1 |
| Control borders on ground (WCAG 1.4.11) | 3.6:1 | 3.4:1 |

Building this handbook caught one failure of its own. The first version's form-control borders were 1.9:1, below the 3:1 that 1.4.11 requires for component boundaries. They were fixed with a dedicated control-edge colour. It is exactly the kind of error that checking the whole palette, not just body text, exists to catch.

## Colour vision deficiency

About one man in twelve, and far fewer women, has a colour-vision deficiency, most commonly red-green.[^nei] WCAG 1.4.1 requires that colour never be the only way information is conveyed. For a reader that covers:

- links (underline them in running text);
- highlights and search results (add an outline or a mark in the margin);
- annotation colours (label them or give them patterns);
- evidence or status indicators;
- diffs in code.

This handbook's evidence grades are an example. They differ by fill (solid, tinted, outlined, dashed, dotted) as well as colour, so they survive greyscale and every form of colour blindness.

## Low vision

Low vision is the largest group of readers with disabilities. Legge and Bigelow's review, the most authoritative source on print size, shows that reading speed is roughly constant above a critical print size and falls steeply below it. Readers with low vision have larger critical sizes, often far larger.[^legge] **[A]** The practical consequences for a reader:

- **Size must go very large.** Readium CSS recommends user font sizes from 75 to 250 per cent, and Firefox Reader View goes up to 128px.[^readers] Text at 200 to 400 per cent must still reflow into a single column without horizontal scrolling (WCAG 1.4.10).
- **Reflow beats magnification.** Zooming a fixed page forces horizontal panning on every line; enlarging reflowable text does not.
- **Weight and contrast settings help some readers.** Offer a heavier weight and a high-contrast theme as options.
- **Letterform clarity is claimed rather than proven.** Atkinson Hyperlegible and Intel One Mono were designed with low-vision input, but no independent study of either was found **[D]**.
- **Respect platform settings.** Honour the operating system's text size, bold text, reduced transparency, increased contrast, forced colours (Windows) and reduced motion.

## Dyslexia

Dyslexia is a difficulty with decoding written words, and the evidence on what typography does for it is clearer than its marketing suggests.

**Special fonts do not help.** OpenDyslexic and Dyslexie have been tested head to head against ordinary fonts, and neither improved reading speed or accuracy. In the one study where Dyslexie appeared to help, the effect disappeared once its wider letter spacing was matched. A 2026 meta-analysis of 15 studies found an average effect of essentially zero (g = −0.04).[^dysfonts] **[A]** A reader may offer such fonts, because some readers prefer them, but should not present them as a treatment. The same applies to Lexend, whose published evidence is a single unreviewed demonstration by its developers.

**Spacing can help some readers.** Extra-large letter spacing, with word and line spacing enlarged in proportion, improved accuracy and speed in a study of 74 Italian and French dyslexic children.[^zorzi] Adolescents and adults with dyslexia gained too.[^sjoblom] Later studies qualify this. One found that wider spacing reduced errors but not reading time, for children with and without dyslexia alike. Another found that letter spacing increased *without* matching word spacing slowed reading, so the two must rise together.[^galliussi] **[X]** WCAG 1.4.12's spacing values are a reasonable floor for the settings, and a reader should allow more.

**Layout conventions.** The British Dyslexia Association's style guide (2023 edition) recommends sans-serif faces at 12 to 14 points, letter spacing of about 35 per cent of the average letter width with word spacing at least 3.5 times that, line spacing of 1.5, an off-white background, left-aligned text, no italics, underlining or all capitals, and lines (the guide says sentences) of 60 to 70 characters. It cites no research **[D]**; chapter 2 examines the evidence behind each recommendation.

**What a reader should offer:** adjustable letter and word spacing that move together, adjustable line spacing, ragged right, a choice of faces including a plain sans, and text-to-speech with word highlighting (which the EAA requires of e-readers).

## Motion, focus and the settings panel itself

- **Motion.** Page-turn animations and animated scrolling must respect `prefers-reduced-motion`.
- **Focus.** Every control, including scrolling code blocks and tables, must be reachable by keyboard and show a visible focus ring.
- **The settings panel.** Its labels must be real labels, its values announced, and its changes applied without moving focus. A reading-settings panel that fails accessibility checks undermines everything it is for.

[^eaa]: Directive (EU) 2019/882 (European Accessibility Act), articles 2 and 31, Annex I §I.1(a)(iv), §I.2(o) and §IV(f). [eur-lex.europa.eu/eli/dir/2019/882/oj](https://eur-lex.europa.eu/eli/dir/2019/882/oj).
[^en301549]: ETSI EN 301 549 V4.1.1 (2026-09), Annex ZB note 2. [etsi.org](https://www.etsi.org/deliver/etsi_en/301500_301599/301549/04.01.01_60/en_301549v040101p.pdf).
[^wcag]: W3C, Web Content Accessibility Guidelines 2.2, Recommendation (current edition 12 December 2024). [w3.org/TR/WCAG22](https://www.w3.org/TR/WCAG22/).
[^u143]: W3C, Understanding Success Criterion 1.4.3 Contrast (Minimum). [w3.org/WAI/WCAG22/Understanding/contrast-minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).
[^u1412]: W3C, Understanding Success Criterion 1.4.12 Text Spacing, research section (McLeish 2007; Chung 2002; Zorzi et al. 2012). [w3.org/WAI/WCAG22/Understanding/text-spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html).
[^wcagdef]: WCAG 2.2 glossary, "contrast ratio" and "relative luminance", with note on the 0.04045 threshold.
[^wcag3]: W3C, WCAG 3.0 Working Draft of 10 September 2026 (editor's note on the contrast algorithm); earlier drafts of 2021 included APCA, while drafts from 24 July 2023 onward do not. [w3.org/TR/wcag-3.0](https://www.w3.org/TR/wcag-3.0/).
[^polarity]: Cosima Piepenbrock, Susanne Mayr, Iris Mund and Axel Buchner, "Positive display polarity is advantageous for both younger and older adults", *Ergonomics* 56(7):1116–1124, 2013, [PubMed 23654206](https://pubmed.ncbi.nlm.nih.gov/23654206/); Buchner and Baumgartner, *Ergonomics* 50(7), 2007; Piepenbrock et al., *Ergonomics* 57(11), 2014 (pupil size).
[^lowvision]: Gordon E. Legge, "Reading digital with low vision", *Visible Language* 50(2):102–125, 2016, section "Contrast and Lighting"; Legge and colleagues, "Psychophysics of reading. II. Low vision", *Vision Research* 25(2), 1985.
[^dobres2017]: Jonathan Dobres, Nadine Chahine and Bryan Reimer, "Effects of ambient illumination, contrast polarity, and letter size on text legibility under glance-like reading", *Applied Ergonomics* 60:68–73, 2017.
[^nei]: US National Eye Institute, "Color Blindness". [nei.nih.gov](https://www.nei.nih.gov/learn-about-eye-health/eye-conditions-and-diseases/color-blindness).
[^legge]: Gordon E. Legge and Charles A. Bigelow, "Does print size matter for reading?", *Journal of Vision* 11(5):8, 2011. [doi.org/10.1167/11.5.8](https://doi.org/10.1167/11.5.8).
[^readers]: Readium CSS, user preferences documentation (CSS12); Firefox `AboutReader.sys.mjs` font-size steps. [github.com/readium/readium-css](https://github.com/readium/readium-css).
[^dysfonts]: Lisa Wery and Jennifer Diliberto, "The effect of a specialized dyslexia font, OpenDyslexic, on reading rate and accuracy", *Annals of Dyslexia* 67:114–127, 2017; Sietske Kuster and colleagues, "Dyslexie font does not benefit reading in children with or without dyslexia", *Annals of Dyslexia* 68:25–42, 2018; Eva Marinus and colleagues, *Dyslexia* 22(3), 2016; Azzarello and colleagues, "Does font improve reading in dyslexic children? A meta-analysis", *Annals of Dyslexia*, 2026, [doi.org/10.1007/s11881-026-00389-8](https://doi.org/10.1007/s11881-026-00389-8).
[^zorzi]: Marco Zorzi and colleagues, "Extra-large letter spacing improves reading in dyslexia", *PNAS* 109(28):11455–11459, 2012. [PubMed 22665803](https://pubmed.ncbi.nlm.nih.gov/22665803/).
[^sjoblom]: Amanda Sjoblom, Elizabeth Eaton and Steven Stagg, *British Journal of Educational Psychology* 86(4):630–639, 2016, [PubMed 27629067](https://pubmed.ncbi.nlm.nih.gov/27629067/); Steven Stagg and Nora Kiss, *Research in Developmental Disabilities* 119, 2021.
[^galliussi]: Britt Hakvoort and colleagues, *Journal of Experimental Child Psychology* 164:101–116, 2017; Jessica Galliussi and colleagues, "Inter-letter spacing, inter-word spacing, and font with dyslexia-friendly features", *Annals of Dyslexia* 70, 2020, [PubMed 32172467](https://pubmed.ncbi.nlm.nih.gov/32172467/).
