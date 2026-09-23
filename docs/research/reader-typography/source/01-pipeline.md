---
slug: pipeline
number: 1
title: The Typesetting Pipeline
short: Pipeline
h1: The Typesetting Pipeline
lede: Between a string of characters and a page someone can read lie eight distinct stages, each with its own standards, failure modes and libraries. Knowing where a decision is made (the font, the shaper, the line breaker, the rasterizer) is most of the work of getting it right, and it decides which stack a reader should be built on.
description: How text becomes a laid-out page: Unicode, segmentation, shaping, line breaking, justification, pagination and rasterization, with the vocabulary the rest of the handbook uses.
when: you are new to typesetting, or you are choosing a rendering stack
icon: text
---

## The stages at a glance

Every text engine, from TeX to a phone's label widget, does the same work in roughly the same order. The names vary; the stages do not.

<ol class="stages">
<li><b>Text and structure.</b> A sequence of Unicode code points, with markup saying which runs are headings, emphasis, code, or another language.</li>
<li><b>Segmentation.</b> Finding user-perceived characters (grapheme clusters), words, sentences and the places a line may break.</li>
<li><b>Bidirectional ordering.</b> Resolving which runs read left to right and which right to left.</li>
<li><b>Itemization and font fallback.</b> Splitting text into runs of one script, one language and one font, and choosing a font that actually has the glyphs.</li>
<li><b>Shaping.</b> Turning characters into positioned glyphs: ligatures, kerning, contextual forms, mark placement.</li>
<li><b>Line breaking and justification.</b> Choosing where each line ends, then distributing the leftover space.</li>
<li><b>Pagination or scrolling.</b> Stacking lines into pages or a continuous column, deciding where to split paragraphs and where notes and figures go.</li>
<li><b>Rasterization.</b> Turning glyph outlines into pixels, with hinting, anti-aliasing and gamma decisions that change how heavy text looks.</li>
</ol>

The order matters because each stage consumes the previous stage's output. Line breaking needs shaped widths, so a line breaker that measures unshaped characters will be wrong for any font with kerning or ligatures, and hopelessly wrong for Arabic or Devanagari. Hyphenation interacts with shaping too: a word split across lines must be reshaped as two pieces, because a ligature or a contextual form may not survive the split.

## A working vocabulary

The rest of the handbook uses these terms without further explanation.

Em
: The font size. In CSS, `1em` equals the computed `font-size`. Historically it was the height of the metal body a letter was cast on, which is why an em says nothing about how large the letters look.

x-height
: The height of lowercase letters without ascenders, such as x, relative to the em. It is the single best predictor of how large a face appears, and it varies widely: in the faces measured for this handbook it runs from about 0.41 em (EB Garamond) to 0.56 em (Merriweather). Two faces at the same `font-size` can differ in apparent size by a third.

Cap height, ascender, descender
: The heights of capitals, of letters like d and h, and the depth of letters like p and q, all as fractions of the em.

Baseline
: The line letters sit on. Leading is measured from baseline to baseline.

Leading, line height
: The distance between baselines. In CSS it is `line-height`, and the name "leading" comes from the strips of lead typesetters placed between lines. A unitless value such as `1.5` is a multiple of the font size and is almost always what you want, because it scales with the text.

Measure
: The length of a line, usually expressed in characters because that is what readers experience. Chapter 4 argues for measuring it that way and shows why the CSS `ch` unit misleads.

Tracking and kerning
: Tracking (`letter-spacing`) adds the same space between every pair of letters. Kerning adjusts specific pairs, such as AV or To, using values stored in the font. Kerning should almost always be on. Tracking lowercase body text almost never helps, though small capitals and all-caps labels benefit from a little.

Glyph and character
: A character is an abstract unit of text (the code point U+0066, "f"). A glyph is a shape in a font. One character can map to several glyphs, and several characters to one glyph: the "fi" ligature is one glyph for two characters.

Grapheme cluster
: What a reader thinks of as one character. "é" can be one code point or two (e plus a combining accent). Many emoji are several code points joined together. Cursor movement, selection and truncation must work in grapheme clusters, never in code points or UTF-16 units.

Optical size
: A design adjusted for the size it will be read at. Text cuts have larger x-heights, lower contrast and looser spacing than display cuts. Variable fonts expose this as the `opsz` axis, which CSS sets automatically from the font size.

Glue, boxes and penalties
: The model Knuth and Plass used for line breaking: words are boxes of fixed width, spaces are glue that can stretch and shrink, and penalties mark places where a break is possible at a cost. Chapter 5 is built on it.

## Unicode, segmentation and bidirectional text

A reader receives text as Unicode, usually UTF-8. Three Unicode annexes define the analysis every later stage depends on.[^uax]

**Text segmentation (UAX #29)** defines grapheme clusters, words and sentences. Grapheme clusters govern the cursor, selection, deletion and search highlighting. Word boundaries drive double-click selection and are the starting point for hyphenation. Sentence boundaries matter for text-to-speech and for "read from here" features. For languages written without spaces between words, such as Thai, Lao, Khmer and Burmese, word boundaries cannot be found by rule at all and need a dictionary. ICU ships one for each of these languages.

**The line breaking algorithm (UAX #14)** classifies every character by how it behaves at a line edge and yields the legal break opportunities: after spaces, after hyphens, between most ideographs, never before a closing parenthesis or inside a number. It deliberately stops there. It says where a break may go, not which of the possible breaks is best. Choosing among them is the line breaker's job (stage 6), and that choice is where the difference between a greedy and an optimal paragraph comes from. UAX #14 also expects tailoring for particular languages; Japanese kinsoku rules, for example, forbid certain punctuation at the start of a line.

**The bidirectional algorithm (UAX #9)** resolves the display order of mixed left-to-right and right-to-left text. An English sentence quoting Hebrew, or an Arabic paragraph containing a number and a URL, is stored in logical order and displayed in a resolved visual order. A reader must apply it per paragraph, isolate embedded runs so that neighbouring punctuation does not jump sides (CSS `unicode-bidi: isolate`, or the `<bdi>` element), and mirror its interface for right-to-left books.

Normalization belongs here too. The same visible text can arrive in different code point sequences. Search, hyphenation dictionaries and font coverage checks should use a normalized form (NFC is the usual choice), while the text is displayed as it arrived.

## Itemization and font fallback

Before shaping, text is split into runs that share one script, one language, one direction and one font. The language matters even within a script: the same Han character is drawn differently for Japanese, Simplified Chinese, Traditional Chinese and Korean readers, and a Serbian or Bulgarian reader expects some Cyrillic letters to differ from Russian forms. Fonts choose these regional forms from the language tag, so untagged text renders in whichever form the font treats as default. Chapter 8 covers this in detail.

Fallback is the next decision. No single font covers all of Unicode (a font format holds at most 65,535 glyphs), so when the primary face lacks a character the engine walks a list of fallback fonts. In CSS that list is `font-family` followed by the platform's own fallback chain; native toolkits have their own. Fallback is where many reading apps look broken: an emoji or a single Greek word arrives in a face with different metrics, and the line it sits on grows taller. Chapter 3 lists fallback strategies that keep line spacing stable.

## Shaping

Shaping turns a run of characters into glyphs with positions. For English it applies kerning and standard ligatures. For Arabic it chooses among initial, medial, final and isolated forms and joins letters. For Devanagari it reorders vowel signs and forms conjuncts. For every script it positions combining marks. The rules live in the font, in OpenType tables such as GSUB (substitution) and GPOS (positioning).[^ot] The shaping engine reads them.

In practice one shaping engine dominates. HarfBuzz is an open-source OpenType shaper, and its users include Chrome, Firefox, Edge, Android, Flutter, LibreOffice, GNOME, Qt, XeTeX, Adobe's InDesign and Photoshop, and Amazon's Kindle.[^hb] HarfBuzz is explicit about what it does not do: bidirectional ordering, line breaking, hyphenation and justification are left to other components. Apple's Core Text and Microsoft's DirectWrite have their own shapers. For a reader built on a web engine or a platform toolkit, shaping is already solved. For a custom engine, HarfBuzz is the only sensible starting point. Writing a shaper is a multi-year project, and a shaper that handles English correctly but Indic scripts incorrectly is worse than useless for a multilingual library.

Shaping is also where optional typographic features are switched on: old-style or lining figures, tabular or proportional figures, true small capitals, discretionary ligatures, stylistic sets. In CSS these are the `font-variant-*` properties, with `font-feature-settings` as the low-level fallback. A feature only works if the font contains it, and, as chapter 3 shows, some web font services strip features the upstream font includes.

## Line breaking and justification

With shaped widths in hand, the line breaker chooses where each line ends from the opportunities UAX #14 allowed, plus any hyphenation points a dictionary adds. Almost every system in daily use, including all browsers and most word processors, does this greedily: fill the line, break at the last opportunity that fits, move on. A few systems (TeX and its descendants, InDesign's paragraph composer, Typst, Android's high-quality mode) consider the whole paragraph and choose the set of breaks with the lowest total cost. The difference is small in wide columns and large in narrow ones, and it matters most when text is justified, because justification turns every line's leftover space into visibly stretched word spaces.

This is the subject of [chapter 5](@line-breaking), which explains the algorithm, measures it against Chromium's line breaker, and includes a live comparison.

## Pagination and scrolling

Lines are then stacked into a scrolling column or into pages. Scrolling is the web's default and needs little machinery. Pagination needs a page builder that decides where each page ends. It should avoid stranding the first line of a paragraph at the foot of a page or the last line at the head of the next, keep headings with the text that follows, and place notes and figures near their references. Optimal pagination is a much harder problem than optimal line breaking, and most systems solve it greedily. E-reading systems built on web engines usually paginate with CSS multi-column layout, laying the chapter out as one very tall column split into screen-sized columns. Chapter 4 weighs scrolling against pages, and chapter 5 covers the algorithms.

## Rasterization

Finally, glyph outlines become pixels. Three decisions shape the result.

**Hinting** adjusts outlines to fit the pixel grid at small sizes. It mattered enormously on low-resolution screens and matters much less at today's densities, but Windows at 100% scaling still has low-density displays where hinting makes text visibly crisper.

**Anti-aliasing** smooths edges with intermediate shades. Subpixel anti-aliasing (ClearType on Windows) triples horizontal resolution by addressing the red, green and blue stripes of an LCD separately, at the cost of colour fringes and complications with transparency, rotation and scaling. Grayscale anti-aliasing is now the norm. Apple dropped subpixel text rendering in macOS 10.14 Mojave, and Microsoft's DirectWrite documentation advises grayscale in most cases from Windows 8 on.[^aa] The non-standard `-webkit-font-smoothing` property that many stylesheets set affects macOS only.

**Gamma and stem weight.** How dark a thin stroke looks depends on how coverage is blended into colour. Coverage is linear but screens are not, so naive blending makes dark-on-light text look heavier and light-on-dark text thinner. Correcting the gamma thins glyphs, and some engines compensate by deliberately darkening stems at small sizes (FreeType calls this stem darkening).[^ft] The result is that the same font at the same size can look noticeably heavier on one platform than another, and the raster pipeline itself pushes weight in opposite directions for the two polarities. That is one more reason to check a dark theme's text weight on real devices rather than by eye on one screen.

Rasterization is also where dark mode changes typography. Light text on a dark ground appears heavier and slightly larger than dark text on a light ground, an effect usually attributed to irradiation, the eye's tendency to let bright regions spread into dark ones. Type designers compensate with a lighter grade in dark mode, and these pages use a text weight of 380 instead of 400 when the theme is dark. Chapter 9 discusses how strong the case for it is.

## Choosing a stack

A reader's typography is bounded by its text engine. There are three realistic choices.

**A web engine** (a WebView, Electron, or the browser itself) provides the whole pipeline, excellent shaping and fallback, EPUB-compatible CSS, and accessibility for free. Its limits are the ones this handbook keeps meeting: greedy line breaking with only limited help from `text-wrap: pretty`, hyphenation that depends on dictionaries the embedding may not ship, and no control over pagination beyond CSS fragmentation. The engine's own line breaker cannot be replaced, but text can be broken in script and emitted as explicit lines. The demo in chapter 5 does this, at the cost of re-layout work on every resize.

**Platform toolkits** (Core Text and TextKit on Apple platforms, the Android text stack, DirectWrite on Windows) give native performance and system integration. Android's text stack is notable for offering whole-paragraph line breaking and hyphenation as built-in options. Their limits are portability and uneven support for book-style features across platforms.

**A custom engine** built from components (HarfBuzz for shaping, ICU or a Unicode library for segmentation and bidi, a hyphenation library with TeX patterns, and your own line breaker and paginator, drawing through Skia or the platform) gives complete control, including Knuth-Plass justification and real pagination. It also makes you responsible for text selection, accessibility trees, input methods and every script your users read. Rust's text ecosystem and Skia's paragraph module have made this path shorter than it used to be, but it is still the most expensive choice.

!!! rec "Recommendation"
    Build on a web engine unless justified, paginated book typography is a core product requirement you are willing to staff. If it is, a hybrid is often the best trade: keep the web engine for shaping, fallback, selection and accessibility, and compute line breaks in script for body paragraphs only, falling back to native breaking for everything else.

## What the measurements here revealed about engines

Building the measurements for this handbook turned up four engine behaviours worth knowing before you rely on them. All were observed in Chromium 152, the engine embedded in the Claude desktop app, on Windows 11.

- **`hyphens: auto` can silently do nothing.** The property was accepted (`CSS.supports` returned true) but produced no hyphenation at all, because the embedded engine ships without hyphenation dictionaries. Full Chrome downloads them on demand; many embedded Chromium builds and WebViews do not. Test it: lay out a long word in a narrow box with `hyphens: auto`, then with `hyphens: manual`, and compare the heights.
- **Canvas text honours optical sizing.** Chromium's 2D canvas applies the `opsz` axis from the specified font size, exactly as layout does, so script-side measurement matches rendering, provided the canvas `font` string uses the same weight and size as the text.
- **Optical size follows the specified size, not the drawn size.** Text drawn at 16px and scaled up is still the 16px design. That is correct, and it means a zoomed or transformed view does not switch to the display cut.
- **Client rectangles around a hyphenated break are doubled.** After a line breaks at a soft hyphen, the first character of the next line also reports a zero-width rectangle at the end of the previous line. Code that finds line breaks from `getClientRects()` must skip zero-width rectangles, or it will misplace every hyphenated break.

## Typesetting systems as prior art

A reader is a typesetting system with a live audience, and the batch systems before it solved most of its problems first.

TeX (1978, rewritten in 1982) introduced total-fit line breaking, pattern-based hyphenation and a rigorous box-and-glue model that remains the reference for paragraph quality. pdfTeX added margin kerning and font expansion, and LuaTeX opened the paragraph builder to scripting. troff and its descendants predate TeX and still format Unix manual pages. Adobe InDesign brought whole-paragraph composition to commercial publishing. Typst, a modern system with fast incremental compilation, uses whole-paragraph breaking for justified text. CSS Paged Media processors (Prince, WeasyPrint, Vivliostyle, Paged.js) typeset books from HTML, and their support for footnotes, running heads and page floats shows how far CSS can go.

Chapter 5 compares the line breakers of these systems in detail.

[^uax]: Unicode Standard Annex #29, *Unicode Text Segmentation*; #14, *Unicode Line Breaking Algorithm*; #9, *Unicode Bidirectional Algorithm*. The annexes are revised with each Unicode version. [unicode.org/reports/tr29](https://www.unicode.org/reports/tr29/), [tr14](https://www.unicode.org/reports/tr14/), [tr9](https://www.unicode.org/reports/tr9/).
[^ot]: Microsoft, *OpenType specification*, chapters on the GSUB and GPOS tables. [learn.microsoft.com/typography/opentype/spec](https://learn.microsoft.com/en-us/typography/opentype/spec/).
[^hb]: HarfBuzz manual (version 14.5.0), "What is HarfBuzz?" and "What HarfBuzz doesn't do", [harfbuzz.github.io](https://harfbuzz.github.io/); the list of users is in the project README, [github.com/harfbuzz/harfbuzz](https://github.com/harfbuzz/harfbuzz).
[^aa]: Apple, WWDC 2018 session 209, "What's New in Cocoa for macOS"; Microsoft, "Introducing DirectWrite", section on text rendering. [learn.microsoft.com](https://learn.microsoft.com/en-us/windows/win32/directwrite/introducing-directwrite).
[^ft]: FreeType, "On Slight Hinting, Proper Text Rendering, Stem Darkening and LCD Filters", and the `no-stem-darkening` property reference. [freetype.org](https://freetype.org/freetype2/docs/hinting/text-rendering-general.html).
