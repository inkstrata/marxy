---
slug: fonts
number: 3
title: Open Reading Fonts
short: Fonts
h1: Open Reading Fonts
lede: A reader app ships its typefaces inside the product, so the choice is legal as well as typographic. This chapter covers what a reading face needs and what the licences allow. It gives a verified catalogue of open-source faces for text, code and other scripts, with metrics measured for this handbook, and it covers the delivery details that silently strip features or shift layouts.
description: Open-source typefaces for long-form reading, code and other scripts: licences, measured metrics, what to bundle and how to load it.
when: you are choosing or licensing typefaces
icon: font
---

## What a reading face needs

Research says less about typefaces than typographers would like. It has established a few things firmly, and those constrain the choice more than taste does.

**Size matters far more than style.** Reading speed is roughly constant across a wide band of letter sizes and falls off sharply below a critical size.[^legge] What sets a face's effective size is its x-height, not its nominal point size, which is why the metrics tables below matter more than any specimen. {{A}}

**Serifs, by themselves, make no measurable difference.** Controlled comparisons that vary serifs while holding everything else constant find no effect on legibility or reading speed.[^arditi] The serif versus sans debate is about genre, texture and familiarity, not performance. {{X}} (studies disagree at the margins)

**No single face is best for everyone, and preference is a poor guide.** In the largest study to date, 352 people read in five of 16 size-matched fonts. The fastest font varied from person to person, and each reader's own preferred font was not their fastest.[^wallace] The headline figure, 35 per cent between a reader's fastest and slowest font, overstates the effect: across the whole sample, font was not a significant factor, and picking each reader's best and worst of noisy measurements inflates the gap. The defensible conclusion is modest but still argues for letting readers choose: no face suits everyone, and readers cannot reliably tell which suits them. {{B}} for the preference finding, {{C}} for the size of the gains.

**Special "dyslexia fonts" do not help.** OpenDyslexic and Dyslexie have been tested directly and produce no benefit, and what benefit Dyslexie showed in one study vanished once letter spacing was matched. A 2026 meta-analysis of 15 studies found an average effect of essentially zero.[^dysfonts] Spacing matters; the letterforms do not. {{A}}

Beyond that, selection rests on craft knowledge {{D}}:

- a generous but not extreme x-height;
- open apertures, so that c, e and s stay distinct at small sizes;
- moderate stroke contrast, so that hairlines do not vanish on low-density screens or glare in dark mode;
- distinct shapes for confusable characters (I l 1, O 0, rn and m);
- a true italic rather than a slanted roman;
- old-style and tabular figures and real small capitals;
- optical sizes;
- and coverage of every language your readers read.

A reader's default face should also be *unremarkable at length*: a face with strong personality charms for a page and wearies for a novel.

## Licences: what a reader app may ship

### The SIL Open Font License

Almost every font in this chapter is licensed under the SIL Open Font License 1.1 (OFL). Its terms for an app are generous but have one trap.[^ofl]

- **Bundling is allowed in any app, including commercial, closed-source and paid ones.** The fonts may not be sold on their own.
- **You must ship the copyright notice and the licence text** with every copy. An "open-source licences" screen that shows each font's `OFL.txt` satisfies this. The FAQ is inconsistent about whether a font bundled inside a program needs the licence text; follow the stricter reading and include it.
- **Documents made with the fonts are unaffected.** Embedding a font in a PDF, even as a subset, is allowed without restriction.
- **Reserved Font Names (RFNs) are the trap.** A font may declare names that modified versions must not use. Under the FAQ, subsetting, instancing a variable font, re-hinting or converting to another format all count as modification. So an app that subsets a font with an RFN must rename it, internally and anywhere the name is shown to users, unless the author grants permission. Plain WOFF2 compression with unchanged metadata is the one conversion that keeps the name.[^ofl-faq]

That makes the RFN column in the catalogue below a practical constraint. Among the strongest candidates, **Literata, EB Garamond, Noto (except Noto CJK), Inter, JetBrains Mono and the Atkinson Hyperlegible families declare no RFN** and can be subset freely. **Source Serif 4, Source Sans 3, Source Code Pro and Noto CJK** ("Source"), **IBM Plex** ("Plex"), **Merriweather, Lora, Lato, the PT families, Cascadia, Monaspace, Intel One Mono, Mona Sans and the SIL fonts** all declare RFNs. Note that Google Fonts' copy of Source Serif 4 omits the RFN line that Adobe's upstream licence declares; the upstream declaration governs.

### Other licences you will meet

| Licence | Typical fonts | What it means for an app |
|---|---|---|
| Apache 2.0 | Roboto Slab (Roboto itself moved to OFL in 2023) | Bundling allowed; ship the licence; modified files need change notices |
| Ubuntu Font Licence 1.0 | Ubuntu, Ubuntu Mono, Ubuntu Sans | Format conversion counts as modification; lightly modified versions must be named "*Name* derivative" |
| Bitstream Vera | DejaVu, parts of Hack | Modified versions must drop "Bitstream" and "Vera" from their names |
| GUST Font License (LPPL) | Latin Modern, TeX Gyre, New Computer Modern | Distributing only part of the font counts as modification and must be identified as such |
| MIT | ET Book, Hack's own work | Ship the notice; otherwise unrestricted |
| CC BY 4.0 / CC BY-SA 4.0 | Twemoji graphics, Luciole / OpenMoji | Attribution required; share-alike for OpenMoji adaptations |
| Bitstream Charter | Charter, XCharter | Unrestricted use and modification with the notice kept |

### Free to use is not free to ship

Several faces that readers expect are not redistributable.[^vendorlic]

- **Georgia, Verdana and Segoe UI** may not be redistributed, converted or self-hosted. An app may use them where Windows has installed them, and nowhere else.
- **SF Pro** is licensed only for mock-ups of Apple interfaces. Apps on Apple platforms get SF and New York as system fonts, but may not bundle them.
- **Input and Berkeley Mono** require paid licences for use in apps.
- **Bookerly and Amazon Ember** have no public licence for third-party use.

A reader may still list system fonts it finds installed, which is what Readium's default font stacks do.

## The served-file trap: features that disappear

Measuring fonts for this handbook turned up a problem worth knowing before you choose a delivery method. The same fonts behaved differently depending on where the files came from.

!!! measured "Measured"
    Width probes in Chromium 152 asked fonts served by the Google Fonts CSS API for small capitals (`font-variant-caps: small-caps` with synthesis disabled, and `font-feature-settings: "smcp"`), old-style figures and tabular figures. For EB Garamond, Source Serif 4, Literata and others, the small-capital and old-style requests produced no change at all, although the upstream source files of all three include both features. System fonts with the same features responded normally.

The cause is documented, although not prominently. The Google Fonts API subsets the fonts it serves with the fontTools subsetter's default feature list, which keeps ligatures, kerning, contextual alternates, fractions and script-shaping features. It drops small caps, old-style, lining and tabular figures, case-sensitive forms, slashed zero and stylistic sets. A Google Fonts issue recording this has been open since 2017, and a 2026 comment from the team said only that they are aware of it.[^gf1335] Two of the families probed, Crimson Pro and Libre Caslon Text, turned out to have no small capitals in their upstream sources either. The catalogue below records which features each face actually has.

!!! rec "Recommendation"
    Self-host fonts from their upstream releases, or from the complete downloads, when you need typographic features. When you subset, keep every layout feature (`pyftsubset --layout-features='*'`) and the name table, and remember that subsetting a font with a Reserved Font Name obliges you to rename it.

## A shortlist by role

The catalogue that follows is long. These are the recommendations, with reasons.

**Default text face: Literata.** It was designed by TypeTogether as the typeface of Google Play Books, specifically for long-form reading on screens, and it has almost everything a reader needs:

- optical sizes from 7 to 72, with weights 200 to 900 and a true italic;
- small caps and old-style, lining, tabular and proportional figures in its sources;
- Latin with Vietnamese, Greek and Cyrillic;
- no Reserved Font Name.

Its x-height (0.507 em at text size) is generous without being extreme. Its one weakness is dormancy: the last release was in 2023. It is the face these pages are set in.

**Alternatives for the default serif:**
- **Source Serif 4** (optical sizes 8 to 60, broad features, but RFN "Source" and no small caps in the italic).
- **Charis 7** (SIL's expanded Charter, excellent Latin and Cyrillic coverage, static weights; version 7 adds kerning and old-style figures that Google Fonts' older copy lacks).
- **Gentium Book 7** (polytonic Greek).
- **Noto Serif** (coverage and a full feature set).
- **EB Garamond** (a classic book face; its small x-height of 0.41 em means it must be set about a quarter larger, 22px against Literata's 18px, to look the same size).

**Sans for readers who prefer it: Atkinson Hyperlegible Next.** It was designed with the Braille Institute for readers with low vision. It emphasises distinct letterforms, comes in weights 200 to 800 with italics, and declares no RFN. Its legibility claims are the designers' {{D}}; no independent reading study was found. It is the second face in these pages' reading settings. Alternatives: **Noto Sans** (the fullest feature set among sans faces here), **Source Sans 3** and **IBM Plex Sans** (a multi-script family).

**Code: JetBrains Mono or Source Code Pro,** with **Intel One Mono** and **Atkinson Hyperlegible Mono** for readers with low vision. Intel One Mono was developed with feedback from low-vision and legally blind developers at each stage, according to its designers {{D}}. **Cascadia Code** covers Arabic and Hebrew. **Iosevka** can be custom-built to any width and style. Chapter 6 covers ligatures and disambiguation.

**A coordinated family: IBM Plex or Noto.** Plex has serif, sans, mono and math faces plus Arabic, Devanagari, Hebrew, Japanese, Korean, Chinese and Thai sans, under one design and one licence, with RFN "Plex". Noto covers far more scripts with no RFN outside CJK.

## Catalogue

Versions, licences and features were verified against each font's upstream repository and Google Fonts metadata in September 2026. "Features" lists typographic features found in the font's own sources. As explained above, a copy served by an API may lack them.

### Serif text faces

| Face | Designer | Licence and RFN | Axes | Scripts | Reading features in source | Notes |
|---|---|---|---|---|---|---|
| Literata | TypeTogether | OFL, no RFN | opsz 7–72, wght 200–900 | Latin, Vietnamese, Greek, Cyrillic | onum lnum pnum tnum smcp c2sc zero frac sups | Made for Google Play Books; release 3.103 (2023) |
| Source Serif 4 | Frank Grießhammer, Adobe | OFL, RFN "Source" | opsz 8–60, wght 200–900 | Latin, Vietnamese, Greek, Cyrillic | onum lnum pnum tnum smcp c2sc zero frac (italic lacks smcp) | 4.005 (2023) |
| Charis 7 | SIL Global | OFL, RFN "Charis", "SIL" | static 400–700 | Latin and Cyrillic incl. linguistic | smcp c2sc onum lnum frac, many alternates | Based on Bitstream Charter; Google Fonts still serves v6 |
| Gentium Book 7 | SIL Global | OFL, RFN "Gentium", "SIL" | static | Latin, Greek incl. polytonic, Cyrillic | as Charis | Renamed from Gentium Book Plus |
| EB Garamond | Georg Duffner, Octavio Pardo | OFL, no RFN | wght 400–800 | Latin, Vietnamese, Greek, Cyrillic | onum lnum pnum tnum smcp c2sc swsh hlig, ss01–07 | Revival of the Berner specimen of 1592 |
| Noto Serif | Google | OFL, no RFN | wdth 62.5–100, wght 100–900 | Latin, Vietnamese, Greek, Cyrillic | onum lnum pnum tnum smcp c2sc zero frac | Pairs with script-specific Noto Serifs |
| Merriweather | Sorkin Type | OFL, RFN "Merriweather" | opsz 18–144, wdth 87–112, wght 300–900 | Latin, Vietnamese, Cyrillic | onum lnum pnum tnum smcp c2sc zero frac | Very large x-height; opsz starts at 18 |
| Alegreya | Huerta Tipográfica | OFL, no RFN | wght 400–900 | Latin, Vietnamese, Greek, Cyrillic | onum lnum pnum tnum smcp c2sc frac | Designed for literature; dormant since 2020 |
| Vollkorn | Friedrich Althausen | OFL, no RFN | wght 400–900 | Latin, Vietnamese, Greek, Cyrillic | onum lnum pnum tnum smcp c2sc zero frac | Dormant |
| Spectral | Production Type | OFL | static 200–800 | Latin, Vietnamese, Cyrillic | onum lnum pnum tnum smcp c2sc zero | Screen-first serif |
| Piazzolla | Huerta Tipográfica | OFL, no RFN | opsz 8–30, wght 100–900 | Latin, Vietnamese, Greek, Cyrillic | onum lnum pnum tnum smcp c2sc | Compact, for small sizes |
| Crimson Pro | Jacques Le Bailly | OFL, no RFN | wght 200–900 | Latin, Vietnamese | onum lnum pnum tnum frac; no small caps | For book-length texts |
| STIX Two Text | Tiro Typeworks for STI Pub | OFL, RFN "TM Math" | wght 400–700 | Latin, Vietnamese, Greek, Cyrillic | onum pnum smcp c2sc | Pairs with STIX Two Math |
| Libertinus Serif | Libertinus project | OFL, RFNs "Linux Libertine", "Biolinum", "STIX Fonts" | static | Latin, Vietnamese, Greek, Cyrillic, Hebrew | onum lnum pnum tnum smcp c2sc | Family includes Sans, Mono, Math |
| Roboto Serif | Commercial Type | OFL, no RFN | GRAD −50–100, opsz 8–144, wdth 50–150, wght 100–900 | Latin, Vietnamese, Cyrillic | onum lnum pnum tnum zero frac | Grade axis allows dark-mode weight changes without reflow |
| Newsreader | Production Type | OFL, no RFN | opsz 6–72, wght 200–800 | Latin, Vietnamese | tnum pnum only | For on-screen reading; no old-style figures or small caps |
| Lora | Cyreal | OFL, RFN "Lora" | wght 400–700 | Latin, Vietnamese, Cyrillic | tnum pnum frac; no onum or smcp | Maintained (2025) |
| Libre Baskerville | Impallari Type | OFL, RFN "Libre Baskerville" | wght 400–700 | Latin | frac; no onum or smcp | Tuned for 16px web text |
| PT Serif | ParaType | OFL, RFNs "PT Sans", "PT Serif", "ParaType" | static | Latin, Cyrillic | not verified | Unmaintained since 2010 |

### Sans text faces

| Face | Designer | Licence and RFN | Axes | Scripts | Reading features in source | Notes |
|---|---|---|---|---|---|---|
| Atkinson Hyperlegible Next | Braille Institute, Applied Design Works | OFL, no RFN ("Hyperlegible" is a trademark) | wght 200–800 | Latin | tnum pnum frac | For low vision; Mono sibling |
| Noto Sans | Google | OFL, no RFN | wdth 62.5–100, wght 100–900 | Latin, Vietnamese, Greek, Cyrillic, Devanagari | onum lnum pnum tnum smcp c2sc zero frac | Fullest feature set among the sans faces here |
| Source Sans 3 | Paul D. Hunt, Adobe | OFL, RFN "Source" | wght 200–900 | Latin, Vietnamese, Greek, Cyrillic | not verified | Humanist |
| IBM Plex Sans | Mike Abbink, Bold Monday | OFL, RFN "Plex" | wdth 75–100, wght 100–700 | Latin, Vietnamese, Greek, Cyrillic (plus separate script families) | not verified | Largest coordinated family |
| Inter | Rasmus Andersson | OFL, no RFN | opsz 14–32, wght 100–900 | Latin, Vietnamese, Greek, Cyrillic | tnum pnum zero frac cv01–16; no onum or smcp | Interface face first |
| Open Sans | Steve Matteson | OFL, no RFN | wdth 75–100, wght 300–800 | Latin, Vietnamese, Greek, Cyrillic, Hebrew | onum lnum pnum tnum smcp c2sc | Relicensed to OFL |
| Public Sans | US Web Design System | OFL | wght 100–900 | Latin, Vietnamese | onum lnum pnum tnum | Based on Libre Franklin |
| Andika 7 | SIL Global | OFL, RFN "Andika", "SIL" | static | Latin and Cyrillic, extended | SIL feature set | For literacy and beginning readers |
| Lexend | Bonnie Shaver-Troup and others | OFL, RFN "RevReading Lexend" | wght 100–900; widths are separate families | Latin, Vietnamese | zero frac | Claims about reading performance are not supported by independent evidence (chapter 2) |
| Google Sans / Google Sans Flex | Google | OFL since November 2025 | GRAD, opsz, wght (Flex adds wdth, slnt, ROND) | about 25 scripts | not verified | New candidate superfamily with Google Sans Code |

### Monospace faces

| Face | Licence and RFN | Axes and italic | Ligatures | Notes |
|---|---|---|---|---|
| JetBrains Mono | OFL, no RFN | wght 100–800, italic | on by default; "NL" build has none | Tall lowercase for small sizes |
| Source Code Pro | OFL, RFN "Source" | wght 200–900, italic | none | zero, cv01–17 alternates |
| IBM Plex Mono | OFL, RFN "Plex" | wght 100–700 (variable since 2026), italic | none | Part of Plex |
| Intel One Mono | OFL, RFN "Intel" | wght 300–700, italic | optional (ss01, off) | Developed with low-vision developers' feedback |
| Atkinson Hyperlegible Mono | OFL, no RFN | wght 200–800, italic | not verified | Low vision |
| Cascadia Code / Mono | OFL, RFN "Cascadia Code" | wght 200–700, italic and cursive italic | Code has them; Mono does not | Arabic, Hebrew, Cyrillic, Greek |
| Fira Code | OFL, no RFN | wght 300–700, no italic | on (calt) | Many alternates |
| Iosevka | OFL | custom builds, many widths | configurable | Not on Google Fonts |
| Monaspace | OFL, RFN "Monaspace" | five metric-compatible families | optional groups | "Texture healing" borrows space from neighbouring narrow glyphs |
| Noto Sans Mono | OFL, no RFN | wdth, wght; no italic | none | smcp, onum available |
| Inconsolata | OFL | wdth 50–200, wght 200–900 | optional (dlig) | By Raph Levien |
| Courier Prime | OFL | four styles | none | For screenplays |

### Coordinated families

**IBM Plex** (serif, sans, condensed, mono, math, and sans for Arabic, Devanagari, Hebrew, Japanese, Korean, Simplified and Traditional Chinese and Thai), **Noto** (serif, sans, mono, display, math, emoji and symbol faces for more than 150 writing systems), **Source** (Serif, Sans, Code and the Han faces), **Libertinus** (serif, sans, mono, math) and **Google Sans** (sans, flex, code) are the families whose members share proportions closely enough to mix in one page. Measured x-heights confirm it. IBM Plex Sans, Serif and Mono share an x-height of 0.516 em, and Noto Sans, Noto Serif and Open Sans share 0.536 em.

## Measured metrics

Specimens show personality; metrics predict layout. The tables below were measured for this handbook in Chromium 152 from fonts served by Google Fonts (and, for comparison, fonts installed with Windows 11). Heights were read from rendered outlines at 16px, which for variable fonts with an optical-size axis means the 16px design, at sub-pixel precision. Widths come from laying out a 1,527-character English sample.

What the columns mean:

- **x-height and cap height** are fractions of the em.
- **Average character** is the mean advance per character of English text, spaces included.
- **Width of 0** is what the CSS `ch` unit measures.
- **Characters in 66ch** is how many average characters actually fit in `max-width: 66ch`.
- **Size matching Literata 18px x-height** is the font size needed for the same apparent size.
- **line-height: normal** is what the browser uses when you do not set a line height.

### Serif

<!--DATA:font-metrics-serif-->

### Sans

<!--DATA:font-metrics-sans-->

### Monospace

<!--DATA:font-metrics-mono-->

### System fonts on Windows 11 (not redistributable; for comparison)

<!--DATA:font-metrics-system-->

Three lessons follow from these numbers.

**`ch` is the wrong unit for measure.** The digit zero is wider than an average character in every proportional face measured, by 13 to 58 per cent. So `max-width: 66ch` yields anywhere from 75 characters per line (Roboto Serif, Source Serif 4) to 104 (Petrona), and more than 90 in many popular faces. Set the measure from the face's average character width instead: 66 characters is `66 × average character width` ems, about 30.4em for Literata. That is what these pages do, and the live colophon under each chapter title reports the result on your screen. Monospace faces are the exception, because every character is as wide as the zero.

**Never rely on `line-height: normal`.** It ranges from 1.0 (Ubuntu Mono) to 1.68 (Besley) in the faces measured, because each font declares its own ascent, descent and line gap, and browsers read different metric tables on different platforms.[^inline] It also lets fallback fonts enlarge individual lines. Always set a unitless line height.

**Match x-heights when readers switch faces.** At the same font size, EB Garamond's lowercase is 19 per cent smaller than Literata's and Merriweather's 10 per cent larger. A reader offering a choice of faces should scale each to a common x-height, so that switching the face does not also switch the apparent size. The table's matching-size column gives the factors, and CSS `font-size-adjust` can do it automatically (Chrome 127, Firefox, Safari 17).[^bcd]

## Optical sizes

Variable fonts with an `opsz` axis carry different designs for different sizes. Browsers select them automatically (`font-optical-sizing: auto`), and so does Chromium's canvas: the measurements showed canvas text changing design with the specified size, exactly as page layout does. The effect on layout is larger than most people expect.

<!--DATA:opsz-table-->

The same string in Source Serif 4 is 16.5 per cent narrower at 72px than at 12px, because display designs are tighter. Inter shrinks by 8.7 per cent and Roboto Serif by 8.5 per cent, while Literata changes by under 3 per cent. Georgia, a static font, does not change at all. Two consequences follow for a reader:

- Characters per line cannot be computed once and reused across text sizes.
- A reader's "text size" control changes the design, not just the scale. That is intended (small text gets sturdier letters), but it means layouts must be recomputed at each size.

**The opsz unit is contested.** The OpenType specification defines optical size in typographic points and asks software to choose it from the size at 100 per cent zoom, letting users override it. Every browser instead sets `opsz` equal to the font size in CSS pixels, which makes text slightly lighter and tighter than the designers intended, since a CSS pixel is three-quarters of a point. A CSS proposal to add a conversion factor has been open since 2019.[^opsz] A reader that controls its own rendering can set `font-variation-settings: "opsz" <value>` explicitly and tune the value per face. {{X}}

## Scripts beyond Latin

Chapter 8 covers layout; here are the fonts. All of these are under the OFL unless noted, and versions were checked in September 2026.

- **Chinese, Japanese, Korean:** Source Han Sans and Serif, distributed by Google as Noto Sans and Serif CJK (RFN "Source"; region-specific subsets for Japan, Korea, mainland China, Taiwan and Hong Kong); BIZ UDPGothic and UDPMincho; LXGW WenKai (a Kai style); Pretendard (Korean); Shippori Mincho and Zen Old Mincho (Japanese book faces). Region subsets of Source Han Sans are 25 to 48 MB per archive of all weights. Google Fonts serves CJK as about 120 frequency-ordered unicode-range slices per font.
- **Arabic, Persian, Urdu:** Amiri (Naskh, for books), Scheherazade New and Lateef (SIL), Noto Naskh Arabic, Vazirmatn (Persian), Markazi Text, and for Urdu Noto Nastaliq Urdu or Gulzar.
- **Hebrew:** Frank Ruhl Libre, David Libre, Noto Serif and Sans Hebrew, Heebo.
- **Indic:** the Tiro Indic families (Devanagari, Bangla, Gurmukhi, Kannada, Tamil, Telugu, each with a true italic), Noto, Mukta, Hind, Anek.
- **Southeast Asian and others:** Noto for Thai, Lao, Khmer and Myanmar; Sarabun (Thai); Padauk (Myanmar, SIL); Abyssinica SIL (Ethiopic).
- **Math:** STIX Two Math, Libertinus Math and Fira Math (OFL), Latin Modern Math and New Computer Modern (GUST licence). A math font needs an OpenType MATH table for MathML to lay out properly.
- **Emoji and last resort:** Noto Color Emoji (OFL fonts), Noto Emoji (monochrome), Twemoji graphics (CC BY 4.0), OpenMoji (CC BY-SA 4.0), and the Unicode Consortium's Last Resort font (OFL, now maintained by Unicode), which shows a symbol for the block of any character no font covers.

## Loading and fallback

**Format.** Ship WOFF2 for the web and TTF or OTF for native platforms. WOFF2 compresses TrueType-outline fonts about 24 to 27 per cent better than WOFF 1.0 at the median, and CFF-outline fonts about 14 per cent better.[^woff2]

**Subsetting.** Subsetting by script (unicode-range slices) shrinks downloads dramatically, but keep all layout features, keep the name table, and rename fonts with RFNs. Incremental Font Transfer, the standard that would stream only the glyphs a page uses, is a Candidate Recommendation Draft with no implementation report yet.[^ift]

**Font display.** For body text, CSS recommends `font-display: fallback`: a very short invisible period, then the fallback face, swapping to the web font only if it arrives within about three seconds. That avoids a paragraph visibly re-flowing under a reader's eyes.[^fonts4] For an app with bundled fonts this does not arise. For downloaded fonts it does.

**Fallback metrics.** When a fallback face is showing, its different widths and heights shift the layout when the real font arrives. CSS lets you adjust a local fallback to match: `size-adjust` scales it (Chrome 92, Firefox 92, Safari 17), and `ascent-override`, `descent-override` and `line-gap-override` match its vertical metrics (Chrome and Firefox, but not yet shipping Safari). These pages define "Literata Fallback" faces on Georgia and Noto Serif, scaled by 106.7 and 98.1 per cent. Those factors are the ratio of Literata's measured average character width to each fallback's, so that line breaks survive the swap.

!!! trap "Trap"
    `font-size-adjust: from-font` looks like the answer to fallback sizing, but while the web font is still loading, the "first available font" is the fallback itself, so it has nothing to match. Use explicit `size-adjust` factors measured per pair instead, as above.

[^legge]: Gordon E. Legge and Charles A. Bigelow, "Does print size matter for reading? A review of findings from vision science and typography", *Journal of Vision* 11(5):8, 2011. [doi.org/10.1167/11.5.8](https://doi.org/10.1167/11.5.8).
[^arditi]: Aries Arditi and Jianna Cho, "Serifs and font legibility", *Vision Research* 45(23):2926–2933, 2005. [PubMed 16099015](https://pubmed.ncbi.nlm.nih.gov/16099015/).
[^wallace]: Shaun Wallace, Zoya Bylinskii, Jonathan Dobres and others, "Towards Individuated Reading Experiences: Different Fonts Increase Reading Speed for Different Individuals", *ACM Transactions on Computer-Human Interaction* 29(4), 2022. [doi.org/10.1145/3502222](https://doi.org/10.1145/3502222).
[^dysfonts]: Wery and Diliberto 2017 (OpenDyslexic), *Annals of Dyslexia* 67; Kuster et al. 2018 (Dyslexie), *Annals of Dyslexia* 68; Marinus et al. 2016, *Dyslexia* 22(3); Galliussi et al. 2020, *Annals of Dyslexia* 70; Azzarello et al. 2026, *Annals of Dyslexia*, meta-analysis (g = −0.04). Details in chapter 2.
[^ofl]: SIL Open Font License 1.1, official text, conditions 1–5 and definitions. [openfontlicense.org](https://openfontlicense.org/open-font-license-official-text/).
[^ofl-faq]: OFL-FAQ version 1.1-update7 (November 2023), items 1.3–1.4, 1.10–1.16, 1.20, 2.2–2.9, 3.1, 5.3–5.8; SIL, "Web fonts and Reserved Font Names". [openfontlicense.org/ofl-faq](https://openfontlicense.org/ofl-faq/).
[^vendorlic]: Microsoft, Font redistribution FAQ (sections Web, Document embedding, Redistribution); Apple, fonts licence at [developer.apple.com/fonts](https://developer.apple.com/fonts/); [input.djr.com/license](https://input.djr.com/license/); U.S. Graphics, Berkeley Mono purchase terms.
[^gf1335]: google/fonts issue 1335, "Why don't all OpenType features work in fonts served via the API?" (opened 2017, open in September 2026); issue 10177 (the `case` feature stripped, 2026); fontTools subsetter default layout features, `Lib/fontTools/subset/__init__.py`. [github.com/google/fonts/issues/1335](https://github.com/google/fonts/issues/1335).
[^inline]: CSS Inline Layout Level 3, §3.2 and §5.3; OpenType OS/2 table, `fsSelection` bit 7 (USE_TYPO_METRICS). [w3.org/TR/css-inline-3](https://www.w3.org/TR/css-inline-3/).
[^bcd]: MDN browser-compat-data 8.1.2 (17 September 2026): `font-size-adjust` Chrome 127, Firefox 3, Safari 16.4 (two-value syntax and `from-font` Safari 17); `@font-face` `size-adjust` Chrome 92, Firefox 92, Safari 17; metric overrides Chrome 87, Firefox 89, Safari Technology Preview only.
[^opsz]: OpenType specification, "opsz" axis tag (registered design-variation axes); CSS Fonts Level 4 §8.1; csswg-drafts issues 807, 4430 and 13331. [github.com/w3c/csswg-drafts/issues/4430](https://github.com/w3c/csswg-drafts/issues/4430).
[^woff2]: W3C, WOFF 2.0 Evaluation Report (Working Group Note, 2016). [w3.org/TR/WOFF20ER](https://www.w3.org/TR/WOFF20ER/).
[^ift]: W3C, Incremental Font Transfer, Candidate Recommendation Draft, 18 November 2025. [w3.org/TR/IFT](https://www.w3.org/TR/IFT/).
[^fonts4]: CSS Fonts Level 4 §4.9, `font-display` values and recommended timings. [w3.org/TR/css-fonts-4](https://www.w3.org/TR/css-fonts-4/).
