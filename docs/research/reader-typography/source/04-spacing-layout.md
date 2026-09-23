---
slug: spacing-layout
number: 4
title: Spacing and Page Layout
short: Spacing & layout
h1: Spacing and Page Layout
lede: Size, line length, line spacing and paragraph spacing are four settings that behave like one, because each changes what the others should be. This chapter sets them from evidence where it exists and from convention where it does not. It then moves outward to the page, covering margins, headings, rhythm, notes and the choice between scrolling and pages, and it looks at what existing reading systems actually ship.
description: Size, leading, measure, paragraphs, hierarchy, margins, notes, and the choice between scrolling and pages.
when: you are setting the page geometry and the vertical rhythm
icon: layout
---

## Four settings that behave like one

The classic interactions, all craft knowledge {{D}}, are these:

- **Size and measure.** A larger face at the same column width means fewer characters per line. Set the measure in characters, and let the width follow the size.
- **Measure and leading.** Longer lines are traditionally given more leading. The rationale is that the eye can find the next line, though the one eye-tracking study that tested this found wider spacing made return sweeps *less* accurate (chapter 2). What is well established is that lines closer than about 1.2 times single spacing crowd each other.
- **Face and size.** Two faces at the same nominal size differ in apparent size by up to a third, because x-heights differ (chapter 3). Match x-heights, not point sizes.
- **Leading and paragraph spacing.** Space between paragraphs is only visible as a signal if it clearly exceeds the space between lines.

A reader therefore should not expose four independent sliders with fixed defaults. Changing one should adjust the defaults of the others, or at least keep the relationships sane. The measure should track the size in characters, and the leading should not fall below a floor as the measure grows.

## Size

**Default: 18 to 20 CSS pixels for a face with an x-height near 0.5 em, larger on small screens held close.** The evidence (chapter 2) puts the critical print size at an x-height of about 0.2 degrees, which is about 9.4 CSS reference pixels, or a font size of 18 to 21 pixels for common text faces. Conventional print sits only just above that, so there is no reason to go below it and some reason to go above it for older readers. Butterick's range for the web is 15 to 25 pixels, justified by screens being read from further away than print.[^butterick-size] These pages use 18px on phones, 19px on tablets and 20px on large screens, in Literata.

**Always in relative units.** Set text in `rem` (or `em`), never in `px` and never primarily in viewport units, so that the reader's own browser or system text size multiplies it. WCAG's failure technique F94 names viewport-unit text sizing specifically. Fluid `clamp()` expressions with a `vw` term can stop text reaching 200 per cent of its size under zoom, because viewport units shrink as the user zooms.[^f94] Step sizes up with media queries measured in `em`, which respond to zoom correctly, as these pages do. A newer CSS mechanism, `<meta name="text-scale">` with `env(preferred-text-scale)`, lets a page adopt the operating system's text-size preference directly. It exists only in Chrome so far.[^textscale]

**Readers change size more than anything else.** Readium CSS recommends a user range of 75 to 250 per cent; Firefox Reader View steps from 12 to 128 pixels, defaulting to 20.[^readers] Apply size changes to the reading text, not by zooming the whole interface.

## Measure (line length)

**Default: about 66 average characters, with a user range from about 45 to 80.** The convention is Bringhurst's: 45 to 75 characters for a single column in a serif text face, with 66 widely regarded as ideal, and 40 to 50 in multi-column work.[^bringhurst-measure] Butterick widens it to 45 to 90.[^butterick-measure] The evidence is weaker than the convention (chapter 2). On screens, speed often favours longer lines, one study found better comprehension at 55 than 100 characters, and readers consistently prefer 55 to 70. A moderate default with room to widen serves both.

**Set it from the face's average character width, not with `ch`.** Chapter 3's measurements show `max-width: 66ch` gives 75 to 104 real characters per line depending on the face, because `ch` is the width of the zero. Richard Rutter, the author of the standard reference on web typography, reached the same conclusion and now recommends a `rem`-based limit instead.[^rutter-ch] Compute the width as characters × average character width in ems, and recompute it when the face or size changes, since optical sizes change widths too.

**Narrow screens set the measure for you.** A phone held upright gives 30 to 45 characters at comfortable sizes. That is below the conventional range but well above the 13-character floor where reading slows. It is also the strongest argument for ragged-right text on phones (chapter 5).

**CJK is different.** JLREQ caps horizontal Japanese lines at about 40 characters and clreq describes book lines of 17 to 40. WCAG's AAA guidance of 40 for CJK agrees (chapter 8).

## Line spacing (leading)

**Default: 1.5 for Latin body text, with a user range from about 1.3 to 2.0.**

- **Butterick** gives 120 to 145 per cent of the font size.[^butterick-lh]
- **Bringhurst** says to choose a basic leading that suits the face, the size and the measure.
- **The evidence** gives a floor near 1.2 to 1.5 and little gain beyond it (chapter 2).
- **WCAG 1.4.8** asks for at least 1.5 at AAA, and **1.4.12** requires content to survive users setting 1.5.
- **Existing readers:** Readium CSS defaults to 1.5 with a user range of 1 to 2; Firefox Reader View defaults to 1.6; Foliate to 1.5.[^readers]

A default of 1.5 sits at the top of Butterick's craft range, meets WCAG's AAA guidance outright, and matches the reading systems. It is slightly generous for long lines in large-x-height faces, which a user can tighten.

**Always unitless.** Set `line-height: 1.5`, not `24px` and not `normal`. `normal` varies from 1.0 to 1.68 across faces (chapter 3) and lets fallback glyphs push individual lines apart.

**More for tall scripts.** Readium multiplies its base line height by per-language factors:

| Factor | Languages |
|---|---|
| 1.167 | Japanese, Korean, Chinese, and several others |
| 1.1 | Hebrew, Hindi, Kannada, Punjabi |
| 1.067 | Bengali, Khmer, Malayalam, Tamil, Thai |

JLREQ and clreq imply 1.5 to 2.0 for CJK.[^readium-i18n] A reader should apply script-specific minimums automatically.

## Paragraphs

**Indent or space, never both.** Butterick states it outright. Bringhurst describes indents as the plainest paragraph marker, and block paragraphs separated by white lines as soulless in long runs.[^para]

- **Books** (fiction, long non-fiction): first-line indent of about 1 em, no space between paragraphs, no indent after headings and breaks. Standard Ebooks uses exactly this, and so does the Readium CSS default stylesheet.
- **Documentation, articles, and anything with frequent lists, code and figures**: space between paragraphs and no indent, because indents look lost next to block elements.
- **Space big enough to read as a signal.** WCAG 1.4.8 asks that paragraph spacing be at least 1.5 times the line spacing. With 1.5 leading, a gap of 0.75 em puts successive paragraphs' baselines 2.25 em apart, which satisfies that reading and is what these pages use. WCAG 1.4.12 separately requires content to survive users adding 2 em after paragraphs.

A reader should honour the book's own paragraph style (indent or space) by default. It should offer "paragraph spacing" and "paragraph indent" as user settings, as Readium does (0 to 2 rem and 0 to 3 rem), and switch the other off when one is chosen.

## Word and letter spacing

**Leave both at the font's defaults, and let users increase them together.** For normal readers default spacing is about optimal, and wider letter spacing without wider word spacing slows reading (chapter 2). Bringhurst's rule is not to letterspace lowercase without reason. He does letterspace capitals and small capitals by 5 to 10 per cent, and Butterick by 5 to 12.[^caps] The user settings should allow at least WCAG 1.4.12's 0.12 em letter spacing and 0.16 em word spacing, and more. Readium allows up to 0.5 rem and 1 rem respectively. When letter spacing rises, word spacing should rise with it.

Never apply letter spacing to Arabic or other cursive scripts, or to Indic scripts. It breaks joins and splits conjuncts (chapter 8). Readium disables letter spacing for right-to-left languages for this reason.

## Headings and hierarchy

- **Few levels.** Butterick recommends at most three levels, preferably two.
- **Space before size.** Distinguish headings first by space, putting more above than below so the heading binds to its text, then by weight, and only modestly by size.[^headings]
- **No hyphenation, no widowed headings.** Keep a heading with the paragraph that follows it. In CSS, `break-after: avoid` works only in Chromium (chapter 5).
- **Balance long headings** with `text-wrap: balance`, which every current engine supports.
- **Scales:** Tim Brown's modular scales derive sizes from a ratio such as 1.25 or 1.5. Butterick rejects them in favour of judgement. Either works if applied consistently {{X}}. These pages use a ratio of about 1.25 to 1.3 between levels.
- **Numbered sections** help any document that will be cited or cross-referenced. Butterick recommends tiered numbers (1, 1.1, 1.1.1) over mixed numerals and letters. These pages number sections by chapter.

## Vertical rhythm and baseline grids

Print designers align every line to a baseline grid so that lines back each other up through the paper and columns align. On the web it is contested {{X}}. Rutter and others argue for a rhythm based on the line height, with every margin and heading spacing a multiple of it. Jason Santa Maria and Butterick argue that images, form elements, fallback fonts and fluid layouts make strict grids brittle and the benefit small.[^grids] Two new CSS features lower the cost:

- `text-box-trim` removes the extra space above the first line and below the last, so text boxes align to their ink. It is now in all three engines (Chrome 133, Firefox 154, Safari 18.2).
- The `rlh` unit expresses spacing as multiples of the root line height.

A sensible compromise: keep spacing in multiples of the line height where it is easy, trim text boxes, and do not fight to hold a grid across figures and code.

## Margins

Print book margins follow canons. Bringhurst describes 2:3:4:6 (inner, head, fore-edge, foot) as a sound, elegant medieval structure, and he captions a construction diagram as Tschichold's, after Villard de Honnecourt.[^margins] No credible source was found that transfers these canons to reflowable screens. On a screen, margins follow from the measure. Once the text column is the right width, the margins are whatever is left, with a minimum gutter. These pages keep at least 16px on phones and 24px on larger screens.

Useful screen conventions:

- keep the text column centred, or offset to leave room for margin notes;
- make the bottom margin in paged mode slightly larger than the top, so the text block does not look as if it is sagging (Butterick);
- respect the safe-area insets on phones with rounded corners and notches;
- in paged mode, keep page margins constant across pages so the text block does not jump.

## Notes, figures and tables

Chapter 7 covers conventions by genre. The layout rules are:

- **Notes beside, not below.** On wide screens, put notes in the margin beside their reference. These pages use margin notes on screens wider than 76 em and tap-to-open notes on narrower ones. In paged mode, pop-up notes are the equivalent. Endnotes at the end of a scrolling chapter are the worst option on screens.[^notes]
- **Figures near their reference,** never more than a screen away.
- **Wide content scrolls in its own container.** Tables, code and wide figures may exceed the text measure (into the margin column on wide screens), and scroll horizontally in their own focusable container on narrow ones. The page itself must never scroll sideways.

## Scrolling or pages

Readers have used both for a decade, and the evidence (chapter 2) shows a small lean toward pages for deep reading and for remembering where things were, with scrolling more enjoyed on tablets. The two also differ in what they cost to build.

| | Scrolling | Paged |
|---|---|---|
| Implementation | The engine's default | CSS multi-column or a custom paginator |
| Position memory | Weak (scroll offsets shift with every layout change) | Strong (stable page numbers, if pagination is deterministic) |
| Line breaking quality | Greedy unless you break lines yourself | Same, plus page-break quality to manage |
| Headings and notes | Easy | Must keep headings with text and place notes on the page |
| Font or size change | Keeps position easily | Must re-paginate and find the reader's place again |
| Accessibility | Simple | Needs care: screen readers read the flow, not the pages |

**Offer both**, as Apple Books (curl, fade or scroll), Foliate and KOReader do. Default to pages for books and scrolling for articles and documentation. In paged mode:

- keep a visible position (page of chapter, percentage, time left);
- make page turns instant or honour reduced motion;
- never strand a heading at a page foot;
- re-paginate deterministically so that the same settings always give the same page numbers.

## What existing reading systems ship

Their defaults and settings are a useful baseline, and they mostly agree.[^readers]

| System | Default size | Line height | Measure | Alignment | Notable settings |
|---|---|---|---|---|---|
| Readium CSS 2 | Publisher's, user range 75–250% | 1.5 (×1.07–1.17 for some scripts) | Left to the app (was 40 rem) | Publisher's | Word and letter spacing, paragraph spacing and indent, hyphenation, ligatures, columns, accessibility normalization |
| Firefox Reader View | 20px | 1.6 | 30 em | Start | Sans default; 12–128px; character and word spacing; light, dark, sepia, contrast, grey themes |
| Kindle | Publisher body text must be unset (1em) | Must be unset | Device | Justified by default | Ragged-right option; publisher fonts can be switched off; Enhanced Typesetting adds hyphenation and kerning |
| Apple Books | User | User slider | User margins slider | Justify on or off | Line, character and word spacing sliders; Line Guide focus mode |
| Foliate | 16px | 1.5 | 720px max | Justified, hyphenated | Up to 2 columns |
| KOReader | User | 100% preset (70–130%) | Margins | Justified | TeX-pattern hyphenation, word-spacing and word-expansion controls, HarfBuzz kerning, hinting and gamma |

Kindle's rules for publishers are the most instructive. Body text must not set a font size, line height, font face, colour or margins, because the reading system must be free to apply the reader's choices. That is the right model for any reader. Book styles describe structure, and the reader owns presentation.

[^butterick-size]: Matthew Butterick, *Practical Typography*, "Point size". [practicaltypography.com/point-size.html](https://practicaltypography.com/point-size.html).
[^f94]: W3C, WCAG 2.2 Technique F94, "Failure of Success Criterion 1.4.4 due to incorrect use of viewport units to resize text"; Adrian Roselli, "Responsive Type and Zoom" (updated October 2025). [w3.org/WAI/WCAG22/Techniques/failures/F94](https://www.w3.org/WAI/WCAG22/Techniques/failures/F94).
[^textscale]: CSS Fonts Level 5, §2 (text-scale meta element), Working Draft 13 September 2026; MDN browser-compat-data 8.1.2 (Chrome 146 for the meta element, 138 for the environment variable).
[^readers]: Readium CSS 2.0.5 documentation (CSS03, CSS12, CSS28) and `css/vars/i18n.json`; Firefox `AboutReader.sys.mjs` and `all.js` (reader preferences); Amazon KDP Help, "Text Guidelines – Reflowable" and "Enhanced Typesetting"; Apple, "Read books in the Books app on iPhone"; Foliate settings schema; KOReader `creoptions.lua` and `defaults.lua`.
[^bringhurst-measure]: Robert Bringhurst, *The Elements of Typographic Style*, §2.1.2 (verified in the 1992 and 1996 editions).
[^butterick-measure]: Butterick, *Practical Typography*, "Line length". [practicaltypography.com/line-length.html](https://practicaltypography.com/line-length.html).
[^rutter-ch]: Richard Rutter, clagnut.com, post 2432 (2024), on `ch` and line length. [clagnut.com/blog/2432](https://clagnut.com/blog/2432).
[^butterick-lh]: Butterick, *Practical Typography*, "Line spacing". [practicaltypography.com/line-spacing.html](https://practicaltypography.com/line-spacing.html).
[^readium-i18n]: Readium CSS `css/vars/i18n.json` (line-height compensation factors); JLREQ §2.4.2; clreq §7.1.1.5.
[^para]: Butterick, "First-line indents" and "Space between paragraphs"; Bringhurst §2.3.1–2.3.2; Standard Ebooks Manual of Style §8.4.
[^caps]: Bringhurst §2.1.6–2.1.7; Butterick, "Letterspacing".
[^headings]: Butterick, "Headings", "Hierarchical headings" and "Space above and below"; Tim Brown, "More Meaningful Typography", *A List Apart*, 2011.
[^grids]: Richard Rutter, "Compose to a Vertical Rhythm", *24 ways*, 2006; Jason Santa Maria, "Baseline Grids on the Web", 2012; Butterick, "Grids"; CSS Inline Layout Level 3 §6 (`text-box-trim`); MDN browser-compat-data.
[^margins]: Bringhurst, chapter 8 (1996 edition numbering); Butterick, "Page margins".
[^notes]: Bringhurst §4.3; Tufte CSS; Gwern Branwen, "Sidenotes in Web Design" (practitioner survey). [gwern.net/sidenote](https://gwern.net/sidenote).
