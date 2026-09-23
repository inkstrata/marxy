---
slug: multilingual
number: 8
title: Multilingual Text Layout
short: Multilingual
h1: Multilingual Text Layout
lede: Almost every rule in the other chapters is a Latin-script habit. Japanese books are justified character by character and have no concept of ragged right. Arabic is never hyphenated and must never be letter-spaced. Thai has no spaces between words. A reader that applies English typography to everything will quietly break a large share of the world's books. This chapter sets out what changes by script, what browsers can do today, and the traps that catch most readers.
description: What changes for Chinese, Japanese, Korean, Arabic, Hebrew, Indic and Southeast Asian scripts, and for mixed-language text.
when: your content is not only English
icon: globe
---

## Where the rules come from

The authoritative sources for non-Latin layout are the W3C Internationalization Working Group's layout requirements documents, written with native typographers: JLREQ for Japanese, clreq for Chinese, klreq for Korean, alreq for Arabic and Persian, and a family of "script resources" and "gap analysis" documents for Devanagari, Thai, Lao, Khmer and others.[^w3cdocs] The gap analyses matter most for engineering, because they record, issue by issue, what browsers still get wrong. Their maturity varies widely. JLREQ (2020) is a finished Note and clreq was revised this month. The Indic and Ethiopic requirements are stale 2020 drafts, Hebrew exists only as an editor's draft, and Myanmar has no W3C document at all.

Nearly everything in this chapter is documented convention {{D}}. Reading research on non-Latin scripts exists but is thin, and none of it overturns the practices recorded here.

## One rule above all: tag the language

Language tags change what a text engine does, and untagged text gets the least appropriate behaviour. CSS Text says language-specific behaviour applies only when the content language is known.[^tagging] That covers:

- **Glyph selection.** Unicode unified the Chinese, Japanese and Korean forms of thousands of characters under single code points and leaves the choice of regional form to fonts and language tags. The numbers are not small: in the main CJK block, Source Han Sans needs at least two different glyph designs for more than 12,000 code points, and five distinct designs for 69 of them.[^shs] Untagged Han text renders in whatever regional form the reader's browser language settings imply.
- **Line breaking.** Japanese and Chinese breaking rules, the `line-break` strictness levels, and phrase-based breaking (`word-break: auto-phrase`) only apply to text tagged Japanese or Chinese.
- **Hyphenation.** `hyphens: auto` needs both a declared language and a dictionary for it.
- **Case mapping.** Turkish dotless i and Greek accent removal in capitals depend on the tag.
- **Emphasis marks.** Their default position differs between Chinese and Japanese.
- **Quotation marks** for the `<q>` element.

A reader should carry language information through from every source it can: EPUB package metadata, `xml:lang` and `lang` attributes, HTTP Content-Language, and, as a last resort, detection. Use script-bearing tags where they matter: `zh-Hans` and `zh-Hant` rather than `zh-CN` and `zh-TW`, and `zh-Hant-HK` for Hong Kong.[^langtags] Tag the reader's own interface text too, so that a Japanese reader's table of contents does not render in Chinese glyph forms.

!!! trap "Trap"
    Language detection is not a substitute for tagging. Short strings, names and mixed passages are routinely misdetected, and a misdetected Japanese passage gets Chinese glyphs and Chinese line breaking. Trust explicit tags first, detect only untagged text, and let users correct the language of a book.

## Chinese, Japanese and Korean

### Direction and when vertical text is required

Japanese novels are almost always set vertically, as are the major newspapers; official and educational documents are mostly horizontal.[^jlreq-dir] In Taiwan, literary works are still commonly vertical, while mainland Chinese publishing is mostly horizontal.[^clreq-dir] A reader for Japanese fiction must therefore support vertical right-to-left text (`writing-mode: vertical-rl`) with right-to-left page progression, taken from the EPUB spine's `page-progression-direction`. Inside vertical Japanese, single Latin letters and acronyms stand upright, longer Latin words are rotated a quarter turn clockwise, and two-digit numbers are set horizontally within the vertical line (tate-chu-yoko, CSS `text-combine-upright`).[^jlreq-latin]

### Line breaking

CJK text may break between almost any two characters, subject to prohibition rules (Japanese *kinsoku*). Closing brackets, full stops, commas, small kana, the prolonged sound mark and iteration marks must not begin a line; opening brackets must not end one; and some sequences must never be split: doubled dashes and ellipses, runs of European digits with their separators, a number with its unit or currency sign.[^kinsoku] clreq defines four strictness levels, from none (Taiwanese and Hong Kong newspapers) to strict, and recommends a "basic" level.[^clreq-break] Korean may break at any syllable or only between words (eojeol), chosen per document. In CSS the choice is `word-break: normal` versus `keep-all`.[^klreq]

Browsers implement the common prohibitions through UAX #14 and the `line-break` property. Chromium can also break Japanese and Korean at phrase boundaries (`word-break: auto-phrase`, Chrome 119), which is kinder to short lines and headings.[^bcd]

### Justification, not ragged right

JLREQ is explicit that Japanese book composition has no equivalent of Western ragged right: body text is justified.[^jlreq-just] clreq says the same for Chinese. Space is taken up or given back in a documented order: first word spaces in embedded Latin text, then the half-em space around punctuation, then the space between Japanese and Latin text, and only then evenly between all characters. Reducing space is preferred to expanding it.

Two practices make this work:

- **Punctuation compression.** CJK commas, full stops and brackets occupy half an em of ink but are set in a full-em cell. When two meet (a closing bracket followed by a full stop) or when one falls at the start or end of a line, the extra half-em is removed. CSS `text-spacing-trim` automates this, but only Chrome supports it (from version 123) and only some of its values.[^bcd] Chinese national rules additionally require full-width punctuation at the end of a line to be trimmed to half width.[^clreq-trim]
- **CJK-Latin spacing.** JLREQ and clreq put a quarter-em space between ideographs and Latin letters or European digits, none at line edges. CSS `text-autospace` inserts one-eighth of an ideographic width. Every shipping engine defaults it to off, contrary to the specification's own default, so nothing happens unless the page turns it on (Chrome 140 supports only the basic values; Firefox 145 and Safari 18.4 support more).[^bcd]

### Line spacing and line length

CJK needs more leading than Latin text. JLREQ puts the gap between lines at half an em to a full em, with a full em preferred for lines longer than about 35 characters, and notes that more than an em helps only if ruby sits between the lines.[^jlreq-lh] clreq gives the same 50 to 100 per cent range. In CSS terms that is a `line-height` of about 1.5 to 2.0, against the Western norm of roughly 1.2 to 1.5. klreq gives no normative value for Korean.[^klreq] JLREQ caps horizontal Japanese lines at about 40 characters, and clreq describes book lines of 17 to 40 characters, at most 48 horizontally. WCAG's AAA guidance of 40 characters for CJK is consistent with both.

### Ruby, emphasis marks, and the missing italic

Ruby are the small readings set beside characters: furigana in Japanese, bopomofo or pinyin in Chinese. They are half the base size in Japanese, placed above horizontal text and to the right of vertical text.[^jlreq-ruby] Bopomofo sits to the right of each character even in horizontal text, with tone marks in their own column. No browser renders that correctly yet (Safari 18.2 comes closest).[^bcd] Emphasis is shown with dots beside characters (`text-emphasis`), placed above in Japanese and Korean and below in horizontal Chinese.[^emph] More commonly, emphasis is shown by changing typeface: Japanese sets emphasis in a Gothic face against Mincho body text, and Chinese sets quotations and dialogue in Kai and emphasis in a heavier Hei.[^clreq-face] That is the CJK substitute for italic. Synthesizing an oblique from a CJK font is wrong.

### Fonts and file sizes

The open-source workhorses are Source Han Sans and Source Han Serif, released by Adobe and Google (Google distributes the identical design as Noto Sans CJK and Noto Serif CJK). They come as pan-CJK fonts that switch regional forms by language tag, or as region-specific subsets that need no tagging and are much smaller.[^shs] Even subsets are large. Measured on 2026-09-22, a Japanese-subset variable WOFF2 of Source Han Sans is 4.1 MB, the Chinese-subset 7.6 MB, and the pan-CJK variable collection 32.1 MB. Google Fonts serves CJK families as 100 to 124 unicode-range slices ordered by character frequency, so a page downloads only the slices it uses. Google reported an 80 per cent reduction for Japanese against sending the whole font.[^gf-cjk] A reader has three options:

1. rely on system CJK fonts (small downloads, uneven quality);
2. bundle region-specific subsets for the languages its users read (large app, consistent quality);
3. download per language on demand.

Offline reading makes the first or third the usual choice. Incremental Font Transfer, the W3C standard intended to solve this properly, is still a Candidate Recommendation Draft.[^ift]

## Arabic, Persian and Urdu

### Direction, numbers and bidi

Arabic script runs right to left, including page order, but numbers run left to right even when written in Arabic digits. There are three digit families in use: European, Arabic-Indic (U+0660 to U+0669, used in Egypt, Saudi Arabia and Iraq) and Extended Arabic-Indic (U+06F0 to U+06F9, used in Iran and Afghanistan). They carry different bidirectional properties, which changes how a mixed sentence is ordered.[^alreq-num] The common assumption that Arabic means Arabic-Indic digits is wrong: in CLDR, the Unicode locale database, the default numbering system for `ar` is Latin digits, while `ar-EG` and `ar-SA` default to Arabic-Indic and Persian to Extended Arabic-Indic.[^cldr]

Use HTML `dir` attributes, `dir="auto"` for user content, and `<bdi>` for embedded runs of unknown direction, rather than the CSS `direction` property, which CSS Writing Modes tells authors not to use in HTML.[^wm]

### Joining, spacing and styling

Arabic letters join. Four consequences follow for a reader.

- **Never add letter-spacing to Arabic.** CSS Text forbids opening gaps between the letters of a cursive script. An engine may turn letter-spacing into elongation instead, but none does.[^cursive] A reader's "letter spacing" control must not apply to Arabic runs.
- **Do not style inside words.** A search highlight or a bold span in the middle of a word breaks the join in Gecko and WebKit.[^alreq-gap-style] Highlight whole words, or draw highlights as an overlay.
- **Justification is not inter-word spacing.** Arabic typography justifies with a combination of inter-word space, extension of the baseline between letters (kashida), wider alternate letterforms and ligatures. No browser engine performs kashida justification: all three only stretch the spaces between words.[^alreq-just] Justified Arabic in a browser therefore looks gappy in a way no Arabic reader would accept from print. Inserting tatweel characters (U+0640) to fake it breaks as soon as text reflows, and the gap analysis explicitly recommends against it.
- **No hyphenation.** Arabic and Persian lines break between words.

### Vertical extent and styles

Arabic ascenders and descenders reach far beyond Latin ones, and stacked diacritics add more. Underlines need extra offset, and tight line heights clip marks.[^alreq-vert] Naskh is the default text style. Nastaʿlīq, with its sloping, cascading baseline, is the preferred style for Urdu and for much Persian writing, and needs markedly more line height. Falling back from a Nastaʿlīq font to a Naskh one is treated as a readability and cultural failure for Urdu readers.[^urdu] CSS defines a `generic(nastaliq)` family for this, but no browser supports it, so a reader must name a Nastaʿlīq font (Noto Nastaliq Urdu or Gulzar) explicitly for Urdu.

## Hebrew

Hebrew is right-to-left, not cursive, and has no case. Spaces are both the break points and the justification points, so Western-style justification works. Three differences matter:

- Italic is controversial, and newspapers use bold where English would use italics.
- Letter-spacing is a legitimate emphasis device, unlike in Arabic.
- Pointed text (niqqud) appears in children's books, poetry and religious texts, and cantillation marks in Biblical texts; both may need a different font and a larger size.

The maqaf behaves like a hyphen.[^hlreq] The W3C requirements exist only as an editor's draft, so treat them as a guide rather than a settled reference.

## Devanagari and other Indic scripts

Indic scripts combine consonants into conjuncts and attach vowel signs above, below and around them, so shaping is essential and grapheme clusters matter. Lines break preferably between words; danda (।) must not begin a line; hyphenation, where used, follows syllable boundaries.[^ilreq]

- **Letter-spacing splits conjuncts** in all three browser engines, and browsers add a trailing space at the end of a tracked range.[^devagap] Avoid tracking Indic text entirely.
- **Tall metrics.** Vowel signs rise above the headline and descend below the baseline. Google Fonts' vertical-metric rules single out Devanagari, with Vietnamese and Arabic, as scripts whose metrics may exceed 130 per cent of the em.[^gfvm] Give Indic text more leading than Latin, and never clip line boxes.
- **Size matching.** Fonts differ in apparent size at the same `font-size`, which makes mixed Devanagari and Latin lines look disorganized.[^devagap] No authoritative source quantifies a standard compensation, so match sizes per font pair by measurement (chapter 3's x-height table shows the method for Latin).

Firefox has no hyphenation dictionaries for Hindi, Bengali, Tamil, Telugu or other Indic languages. Chrome does.[^bcd]

## Thai, Lao, Khmer and Myanmar

Thai and Lao use spaces between phrases, not words, and Khmer uses none at all. Line breaking therefore needs dictionary-based word segmentation. CSS requires a browser without a dictionary to allow breaks between any letters, which is legible but ugly.[^cssseg] Dictionary quality varies: ICU's Khmer dictionary makes poor breaks, keeping even the Khmer name for "United States of America" whole.[^khmrgap] A reader should prefer text that marks word boundaries with zero-width spaces, where publishers provide it, and can use `Intl.Segmenter` (in all three engines) for its own word-level features such as selection and look-up.

Thai and Lao stack vowels and tone marks above and below the base letter, up to four glyphs plus a tone, and Khmer stacks subjoined consonants. All need extra leading. Justification is expected to stretch spaces and then letters, but inter-character justification of Thai fails in every engine.[^thaigap] Leave Thai ragged unless you can do better than the browser.

Much Myanmar-language text is still encoded in Zawgyi, an ad hoc font-specific encoding that is not Unicode-conformant and renders correctly only with that one font.[^zawgyi] A reader importing Myanmar content must detect Zawgyi and convert it to Unicode, or the text will render as nonsense.

## Other scripts, briefly

Traditional Mongolian is written only vertically, top to bottom with columns running left to right (`vertical-lr`), and has no italic tradition; a synthesized slant must lean clockwise.[^mlreq] Tibetan breaks after the syllable separator tsheg (U+0F0B) and builds tall consonant stacks.[^tlreq] Ethiopic separates words with its own wordspace (፡) or an ordinary space, and forbids terminal punctuation at the start of a line. Its hyphenation rules are an open question even in the W3C draft.[^elreq]

## Per-script summary

| Script | Break unit | Justification | Hyphenation | Leading | Direction | Browser gaps, September 2026 |
|---|---|---|---|---|---|---|
| Japanese | Character, with kinsoku; phrases in headings | Inter-character, punctuation compressed first | Western words only | Line gap 0.5–1 em (line-height about 1.5–2.0) | Horizontal, or vertical-rl with right-to-left pages | `text-spacing-trim` Chrome only; warichu unsupported |
| Chinese | Character, four strictness levels | Inter-character; line-end punctuation trimmed | Western words only | Line gap 50–100% | Mostly horizontal; vertical common in Taiwanese literature | Autospace off by default; Kai and Fangsong generics unsupported; bopomofo ruby incomplete |
| Korean | Syllable or word (per document) | Even spacing | None specified | No norm in klreq | Mostly horizontal | klreq sections unfinished |
| Arabic, Persian | Word | Spaces, kashida, alternates, ligatures | None | Taller than Latin | Right to left; numbers left to right | No engine does kashida |
| Urdu (Nastaʿlīq) | Word | Letter stretching | None | Much taller | Right to left | No Nastaʿlīq generic family |
| Hebrew | Word | Inter-word | Rare | Larger with niqqud | Right to left | Requirements only drafted |
| Devanagari | Word; syllables kept together | Inter-word | By syllable | Tall metrics | Left to right | Letter-spacing splits conjuncts; danda at line start |
| Thai, Lao | Word, by dictionary | Spaces, then letters | None | Marks above and below | Left to right | Thai justification broken everywhere |
| Khmer | Word, by dictionary or ZWSP | Spaces, then letters | None | Stacks | Left to right | Dictionary quality |
| Mongolian | Word | Not specified | Not specified | Not specified | Vertical-lr only | Form controls |

## The traps that catch most readers

1. **Untagged content.** It gets the wrong glyphs, no hyphenation, the wrong line breaking and the wrong emphasis side.
2. **Fallback to the wrong style.** Urdu falling back to Naskh, Chinese quotations losing their Kai face, and system CJK fonts with off-centre dashes and ellipses.[^fallbackgaps]
3. **Latin letter-spacing applied everywhere.** It breaks Arabic joins, splits Indic conjuncts and mangles Thai.
4. **Latin justification applied everywhere.** Gappy Arabic, broken Thai. And ragged-right CJK, which looks wrong to its readers.
5. **Synthesized italic and bold.** Italic has no place in CJK, is controversial in Hebrew, and must slant differently in Arabic and Mongolian. CSS Fonts gives `:lang(ar) { font-synthesis: none; }` as an example of switching synthesis off per language.[^synth]
6. **`line-height: normal` with fallback fonts.** With `normal`, every fallback glyph can grow its line; with a number, only the first available font counts.[^inline] Set line height numerically, and larger for tall scripts.
7. **Too little leading for ruby and emphasis marks,** which makes lines uneven. In-page search also fails on ruby-annotated text.
8. **Styling inside words,** which breaks Arabic joins.
9. **Page direction.** Vertical Japanese, Traditional Chinese, Arabic and Hebrew books turn their pages right to left. Take the direction from the EPUB spine and the writing mode, not from the interface language.
10. **Zawgyi-encoded Myanmar text** and other legacy encodings.

!!! rec "Recommendation"
    Treat language as part of the text, not a property of the book. Store it per run, apply script-specific rules from it (letter-spacing off for cursive and Indic scripts, justification rules, leading minimums, synthesis off, page direction), and expose "letter spacing", "justify" and "hyphenate" as settings that apply only to the scripts where they are safe.

## Localize the interface, preserve the text

Digits and quotation marks inside a book are the author's text. CSS itself insists that typographic transforms must not change meaning, and regional practice varies too much for a reader to guess. Arabic-language websites increasingly use European digits, and Devanagari readers disagree about native digits.[^digits] Preserve them. Localize only what the reader generates: page numbers, progress, dates, chapter counters. CLDR supplies the numbering system and quotation marks for each locale (German „…", French «…», Japanese 「…」), and CSS `quotes: auto` uses them for the `<q>` element.[^cldr]

[^w3cdocs]: W3C Internationalization, layout requirements index and the individual documents: [w3.org/International/layout](https://www.w3.org/International/layout), JLREQ (Group Note, 11 August 2020), clreq (draft of 1 September 2026), klreq (21 March 2026), alreq (2 October 2025), Hebrew (editor's draft only), ilreq and elreq (2020 Working Drafts).
[^tagging]: CSS Text Module Level 3, §1.3 (languages and typesetting), §5.2 (`line-break`), §5.3 (hyphenation). [w3.org/TR/css-text-3](https://www.w3.org/TR/css-text-3/).
[^shs]: Adobe, Source Han Sans 2.005 ReadMe, "Glyph Sharing Statistics" (p. 16) and subset fonts (pp. 1–3). [github.com/adobe-fonts/source-han-sans](https://github.com/adobe-fonts/source-han-sans).
[^langtags]: W3C i18n, "Choosing a language tag" (2026) and "Language tags in HTML and XML". [w3.org/International/questions/qa-choosing-language-tags](https://www.w3.org/International/questions/qa-choosing-language-tags).
[^jlreq-dir]: JLREQ §2.3.1 and §2.3.2. [w3.org/TR/jlreq](https://www.w3.org/TR/jlreq/).
[^clreq-dir]: clreq §2.1.1. [w3.org/TR/clreq](https://www.w3.org/TR/clreq/).
[^jlreq-latin]: JLREQ §3.2.3 (Latin text in vertical writing).
[^kinsoku]: JLREQ §3.1.7, §3.1.8 and §3.1.10.
[^clreq-break]: clreq §6.1.1 and §6.1.2.
[^klreq]: klreq §7.1.1 (breaking by syllable or eojeol) and §7.4.1 (line spacing, where 160% appears only as an example). [w3.org/TR/klreq](https://www.w3.org/TR/klreq/).
[^bcd]: MDN browser-compat-data, main branch as of 22 September 2026 (release 8.1.2). Current browsers then: Chrome 154, Firefox 156, Safari 27. [github.com/mdn/browser-compat-data](https://github.com/mdn/browser-compat-data).
[^jlreq-just]: JLREQ §3.8 (line adjustment).
[^clreq-trim]: clreq §6.3.2.3, citing the national standard GB/T 15834.
[^jlreq-lh]: JLREQ §2.4.2 (notes on line gap and line length); clreq §7.1.1.5.
[^jlreq-ruby]: JLREQ §3.3.
[^emph]: CSS Text Decoration Level 3, §3.4 (emphasis mark position by language). [w3.org/TR/css-text-decor-3](https://www.w3.org/TR/css-text-decor-3/).
[^clreq-face]: clreq §3.1.1 (Song, Kai, Hei and Fangsong and their roles); JLREQ §3.3.9.
[^gf-cjk]: Google Developers Blog, "Google Fonts launches Japanese support", 28 September 2018 (vendor-reported figures). The slice counts were checked against the CSS2 API on 22 September 2026: 124 slices for Noto Sans JP, 101 to 109 for the Chinese families. [developers.googleblog.com](https://developers.googleblog.com/en/google-fonts-launches-japanese-support/).
[^ift]: W3C, Incremental Font Transfer, Candidate Recommendation Draft, 18 November 2025. [w3.org/TR/IFT](https://www.w3.org/TR/IFT/).
[^alreq-num]: alreq §6.1 (numerals and their bidi classes). [w3.org/TR/alreq](https://www.w3.org/TR/alreq/).
[^cldr]: Unicode CLDR 48 (cldr-json 48.2.2), `numbers.json` default numbering systems and `delimiters.json` quotation marks. [github.com/unicode-org/cldr-json](https://github.com/unicode-org/cldr-json).
[^wm]: CSS Writing Modes Level 4, §2.1. [w3.org/TR/css-writing-modes-4](https://www.w3.org/TR/css-writing-modes-4/).
[^cursive]: CSS Text Level 3, §7.2.1 and Appendix D (cursive scripts: Arabic, Hanifi Rohingya, Mandaic, Mongolian, N'Ko, Phags Pa, Syriac).
[^alreq-gap-style]: W3C, Arabic Script Gap Analysis (8 September 2026), issue 222; opacity revealing glyph overlaps, issue 221. [w3.org/TR/alreq-gap](https://www.w3.org/TR/alreq-gap/).
[^alreq-just]: alreq §7.2 (six justification mechanisms); Arabic gap analysis issue 225 (engines stretch inter-word spaces only; tatweel insertion not recommended).
[^alreq-vert]: alreq §7.4; gap analysis issue 223 (underline offset).
[^urdu]: Arabic gap analysis issue 276; Richard Ishida, Urdu orthography notes (updated April 2026), on Nastaʿlīq line height. [r12a.github.io/scripts/arab/ur.html](https://r12a.github.io/scripts/arab/ur.html).
[^hlreq]: W3C, Hebrew Layout Requirements, editor's draft: sections on letterforms, characters, quotations and spacing. [w3c.github.io/hlreq](https://w3c.github.io/hlreq/).
[^ilreq]: ilreq §4.1–4.2 (2020 Working Draft). [w3.org/TR/ilreq](https://www.w3.org/TR/ilreq/).
[^devagap]: W3C, Devanagari Gap Analysis, issues 117 and 118 (letter-spacing), 96 (size mismatch), 88 (danda at line start). [w3.org/TR/deva-gap](https://www.w3.org/TR/deva-gap/).
[^gfvm]: Google Fonts, vertical metrics guidance (gf-docs), rules 4 and 11. [github.com/googlefonts/gf-docs](https://github.com/googlefonts/gf-docs/tree/main/VerticalMetrics).
[^cssseg]: CSS Text Level 3 §5 and §5.5; CSS Text Level 4 §6.1.1.3.
[^khmrgap]: W3C, Khmer Gap Analysis (4 September 2026), line-breaking section. [w3.org/TR/khmr-gap](https://www.w3.org/TR/khmr-gap/).
[^thaigap]: W3C, Thai Gap Analysis, issue 48. [w3.org/TR/thai-gap](https://www.w3.org/TR/thai-gap/).
[^zawgyi]: Unicode Consortium, Myanmar Scripts and Languages FAQ. [unicode.org/faq/myanmar.html](https://www.unicode.org/faq/myanmar.html).
[^mlreq]: W3C, Mongolian Layout Requirements (10 July 2025). [w3.org/TR/mlreq](https://www.w3.org/TR/mlreq/).
[^tlreq]: W3C, Tibetan Layout Requirements (30 July 2024). [w3.org/TR/tlreq](https://www.w3.org/TR/tlreq/).
[^elreq]: W3C, Ethiopic Layout Requirements §3.1–3.3 (2020 Working Draft). [w3.org/TR/elreq](https://www.w3.org/TR/elreq/).
[^fallbackgaps]: Arabic gap analysis issue 276; Chinese gap analysis issues 587 and 430. [w3.org/TR/clreq-gap](https://www.w3.org/TR/clreq-gap/).
[^synth]: CSS Fonts Level 4, §2.8 (font synthesis). [w3.org/TR/css-fonts-4](https://www.w3.org/TR/css-fonts-4/).
[^inline]: CSS Inline Layout Level 3, §5.3. [w3.org/TR/css-inline-3](https://www.w3.org/TR/css-inline-3/).
[^digits]: CSS Text Level 3 §2.1; Arabic gap analysis §6.7; Devanagari gap analysis issue 91.
