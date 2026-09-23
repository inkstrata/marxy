---
slug: evidence
number: 2
title: The Reading Evidence
short: Evidence
h1: The Reading Evidence
lede: Typography is full of confident numbers (45 to 75 characters, a line height of 1.5, 16 pixels, never justify), and most of them come from convention rather than experiment. This chapter goes back to the research, study by study, to establish what vision science, psychology and HCI have shown about size, line length, spacing, typefaces, case, contrast, polarity, justification, reading media and scrolling, and where they have shown nothing at all.
description: What vision science and reading research establish about size, line length, spacing, typefaces, contrast and polarity, and where the research is silent.
when: you need to defend a default with evidence, or judge a claim someone made
icon: book
---

## How to read this chapter

Each finding carries an evidence mark: {{A}} for replicated results or meta-analyses, {{B}} for one well-designed study, {{C}} for small or mixed studies, {{D}} for convention with no direct test, and {{X}} for contested or contradicted claims. Three cautions apply throughout.

- **Preference is not performance.** Readers reliably prefer layouts that do not make them read faster or understand more, and the reverse. Every section below keeps the two apart.
- **Glance tasks are not reading.** Many legibility studies measure how quickly people recognize single words or letters flashed briefly, which matters for dashboards and signs. Paragraph reading behaves differently, and a result from one does not transfer to the other.
- **Sizes must be angular.** A "12-point" result means nothing without the viewing distance. The research that generalizes reports letter size as visual angle, and so does this chapter.

## What the eyes do while reading

A designer needs a handful of numbers about eye movements. For skilled readers of English, from Rayner's review {{A}}:[^rayner]

| Measure | Value |
|---|---|
| Average fixation in silent reading | about 225 ms (typically 200–250) |
| Average forward jump (saccade) | 7–9 letter spaces |
| Regressions (backward jumps) | 10–15% of saccades |
| Perceptual span | 3–4 letters left of fixation, 14–15 right (reversed in Hebrew) |
| Words fixated | about 85% of content words, 35% of function words |
| Line ends | first and last fixations land 5–7 letters in from each end |

Two consequences shape layout. Eye movements scale with letters, not with degrees, so line length is best expressed in characters. And every new line costs a return sweep, a long jump back to the left that often undershoots and needs a correction. Return sweeps affect about a fifth of all fixations in reading.[^returnsweeps]

## Size

### Critical print size

The foundational result comes from decades of psychophysics, summarized by Legge and Bigelow. Reading speed is at its maximum across a wide band of letter sizes and falls steeply below a **critical print size**.[^legge] {{A}}

- The consensus critical size for normal vision is an x-height of about **0.2 degrees** of visual angle, varying from roughly 0.15 to 0.3 by reader, font and method.
- Speed stays at its maximum from there up to about **2 degrees**, a tenfold range.
- Typical printed books and newspapers have x-heights of 0.23 to 0.24 degrees. Conventional print therefore sits just above the critical size, near the bottom of the fluent range.
- Online news text measured by the same authors averaged 0.21 degrees, and home-page text 0.19, partly below it.

**The critical size depends on method.** Norms from the MNREAD test (645 people aged 8 to 81) put the critical size for young adults at about 0.1 degrees, roughly half the consensus figure, rising to about 0.18 degrees by age 81.[^mnread] {{A}} MNREAD uses short sentences read aloud, so treat 0.2 degrees as a cautious value for sustained reading rather than a hard threshold.

**Older readers** keep near-normal speed at comfortable sizes but lose more at very small and very large ones. They are more affected by glare, poor lighting and low contrast.[^akutsu] {{B}}

### Converting to screens

The CSS reference pixel is defined as a visual angle of about 0.0213 degrees, one pixel on a 96-dpi display at arm's length.[^refpx] An x-height of 0.2 degrees is therefore about 9.4 reference pixels. For faces with x-heights of 0.45 to 0.52 em, that means a font size of **about 18 to 21 CSS pixels**, provided the device honours the reference pixel at the actual viewing distance.

Phones are held closer than the conventional 40 cm. Measured distances average 36 cm for text messages, 32 cm for web pages, and 29 cm after an hour of reading a novel, drifting closer as time passes.[^distance] {{B}} Phone manufacturers scale CSS pixels for this, but not exactly, so size on phones should be checked by computing angles for real devices at about 30 cm.

!!! measured "Derived"
    These pages default to 18px text on phones, 19px on tablets and 20px on large screens, set in Literata, whose x-height is 0.507 em. At 18px that is an x-height of about 9.1 reference pixels, or 0.19 degrees if the device honours the reference pixel. That is at the consensus critical size, and about twice the MNREAD figure for young adults. Readers who need more can scale freely.

### Screen studies of size

- **Rello, Pielot and Marcos (2016)** is the most cited screen study.[^rello2016] 104 adults read Spanish Wikipedia passages in Arial at six sizes, on a 17-inch display at about 60 cm, with eye tracking.
  - Fixations shortened as size rose to about 22.
  - Comprehension was lower at the two smallest sizes.
  - Readers rated 18 most readable.

  The authors recommend body text of at least 18 points. Their "points" appear to be CSS pixels, though, reading time was not measured, and the smallest sizes sat at or below the critical print size. The result supports "text near the critical size hurts" {{B}} rather than any particular number {{C}}.
- **Atilgan, Xiong and Legge (2020)** simulated laptop, tablet and phone windows.[^atilgan] Reading speed held up until lines fell below about **13 characters** for normal vision (about 8 for low vision). At simulated low acuity, no print size on a phone-width window allowed reading at more than half the maximum speed. {{B}} This sets a floor for phones, not an optimum.

Research is silent on long-duration reading at the screen sizes people use today, and on phone reading with controlled viewing distance.

## Line length

The familiar rule of 45 to 75 characters, with 66 ideal, comes from Bringhurst, who presents it as convention for print {{D}}.[^bringhurst] The screen research says something different.

- **Longer lines are often read faster on screens.** Dyson's review finds that most screen studies measured faster reading with longer lines, within the range tested, which goes up to about 100 characters. Characters per line matter more than physical width.[^dyson] {{A}}
  - Duchnicky and Kolers found 80-character lines read 30 per cent faster than 40-character lines, with no loss of comprehension.
  - Dyson and Kipping found 100 characters per line read faster than 25, while readers rated 55 easiest.
- **Comprehension may favour moderate lines.** Dyson and Haselgrove found better comprehension at 55 characters per line than at 100, with no speed–accuracy trade-off.[^dysonhaselgrove] {{B}} It is one study.
- **Preference consistently favours moderate lines** of roughly 55 to 70 characters.
- **For low vision, line width did not matter** across 35 to 90 characters in a study of 43 older readers.[^rubin] {{B}}
- **Below about 13 characters, speed collapses** (Atilgan above).

So the evidence gives a floor (about 13 characters), weak support for a comprehension advantage at moderate lengths, and a preference for 55 to 70 characters. No study has found an upper limit beyond which longer lines stop helping speed. A reader should default to a moderate measure because readers prefer it and it may aid comprehension, and should let readers widen it. It should not claim that 66 characters is optimal for reading speed, because the evidence says otherwise.

## Line spacing

- **Normal readers need a minimum separation, then gain little.** Chung found reading speed rose as vertical spacing increased to about 1.2 to 1.5 times single spacing, then levelled off. Five participants, an artificial task, but a clear mechanism: lines too close together crowd each other.[^chung2004] {{C}}
- **Very tight spacing hurts comprehension.** In Rello's study, 0.8 times the browser default lowered comprehension; spacings from 1.0 to 1.8 did not differ in fixation duration.[^rello2016] {{B}}
- **Wider spacing makes return sweeps less accurate, not more.** A 2023 eye-tracking study found wider line spacing shortened fixations but made return sweeps land less accurately.[^chiu] {{C}} This cuts against the untested old advice that long lines need extra leading so the eye can find the next line.
- **Low vision:** extra leading alone does little. Double spacing added about 7 words per minute for readers with central scotomas, worthwhile only for very slow readers.[^calabrese2010] {{B}} Doubling line and word spacing together helped readers with macular disease by 26 to 46 per cent.[^blackmore] {{C}}

**WCAG's numbers are not research findings.** Success Criterion 1.4.12 requires that content survive users setting line height to 1.5, paragraph spacing to 2 times the font size, letter spacing to 0.12 em and word spacing to 0.16 em. Its Understanding document grounds only the letter-spacing value in research: McLeish's study of 14 young readers with low vision. It cites nothing for the other three.[^u1412] {{D}} Success Criterion 1.4.8's 80-character limit and 1.5 line spacing cite no research that tests them either.[^u148] {{D}} They are reasonable accessibility floors and user-override targets, not optimal defaults.

## Letter spacing, word spacing and crowding

Recognition in reading is limited mainly by spacing, not size, through **crowding**: neighbouring letters interfere with each other's recognition, more so away from the point of fixation.[^pelli] {{A}}

- **For normal readers, default spacing is about optimal.** Tighter spacing hurts; wider spacing does not help, and in one eye-tracking study it slowed fast readers.[^spacingnormal] {{A}}
- **Letter and word spacing interact.** Taking space from within words and adding it between words shortened reading times in one study. The effect of extra letter spacing depends on the font's default spacing.[^slattery] {{B}}
- **For dyslexia, the evidence is contested.** Extra-large letter spacing, with word and line spacing enlarged too, improved accuracy and speed in 74 Italian and French dyslexic children, with no significant effect in reading-level-matched controls.[^zorzi] Critics argued the control result may reflect limited power. Later studies are mixed:
  - one found wider spacing reduced errors but not reading time, and not specifically for dyslexic children;[^hakvoort]
  - one found wider letter spacing *without* matching word spacing slowed reading;[^galliussi]
  - studies in adolescents and adults found gains.[^sjoblom]
  - One study found benefits only in the subgroup of dyslexic readers with elevated crowding.[^joo]

  {{X}}. The most defensible summary: extra spacing sometimes helps some poor readers, mostly in accuracy, and only when word spacing grows with letter spacing.

## Typefaces

- **Serifs make no practical difference.** Purpose-built fonts differing only in serifs produced no difference in reading speed.[^arditicho] A sans version of the same design was recognized a few milliseconds faster in word decisions, and eye tracking showed no difference in sentence reading time.[^perea] Stroke contrast, not serifs, explains the small threshold differences that do exist.[^minakata2022] {{A}}
- **Familiarity is quickly acquired.** Twenty minutes with a font made reading in it faster; unusual letter shapes did not slow reading but were disliked.[^beierlarson] {{B}}
- **Width and weight matter at the extremes.** Condensed type changed eye movements but not reading speed. Extra weight helps recognition only at small sizes, and very light and very heavy weights hurt.[^beierweight] {{B}} for recognition, {{C}} for reading.
- **Individual differences are real but smaller than advertised.** Wallace and colleagues tested 16 size-normalized fonts on 352 people reading on their own devices.[^wallace] Each person's fastest font beat their slowest by 35 per cent, preference did not predict speed, and no font was best for everyone. At the population level, though, font was not a significant factor at all. Picking each person's best and worst of five noisy measurements inflates the gap between them, and comprehension was near ceiling. {{C}} for large gains from font matching; {{B}} for "what readers prefer is not what makes them fastest".
- **Glance legibility differs from reading.** In briefly flashed word decisions, humanist sans faces needed shorter exposures than square grotesques, and dark-on-light text needed about 39 per cent shorter exposures than light-on-dark.[^dobres2016] {{B}} for glance tasks. These results inform interface labels, not paragraphs.
- **Aesthetics may affect mood and effort but not speed.** In Larson and colleagues' studies, good typography did not change reading speed or comprehension. It lowered self-reported workload in one study and frowning-muscle activity in another. The headline "good typography puts readers in a better mood" result rests on a creative task in which 4 of 10 readers solved the problem with good typography against 0 of 9 with poor typography. Its reported significance does not survive an appropriate test.[^larson] {{C}}

## Case, italic and bold

- **All capitals are not inherently less legible.** At equal point size, capitals were more legible at small sizes and read faster near the acuity limit, because capital letters are physically larger.[^arditicase] The common claim that lowercase reads faster traces to older print studies that could not be verified for this handbook. {{X}}
- **Italic** reduced reading performance for dyslexic readers in one eye-tracking study.[^rellofonts] {{C}}
- **Bold** did not speed reading for people with central vision loss. Extreme stroke widths slow everyone.[^bold] {{B}}
- **Underlining:** no verified study.

## Contrast and polarity

- **Contrast barely matters until it is low.** For normal vision, a tenfold drop in contrast cut reading speed by less than half, and reading speed is maximal down to a contrast of 5 to 10 per cent.[^contrast] {{A}} Low vision needs much higher contrast. No evidence was found that pure black on pure white harms reading; advice to avoid it is convention {{D}}.
- **Dark text on light reads slightly better.** Positive polarity produced better proofreading and acuity than negative polarity in darkness and office lighting alike, in younger and older adults. The advantage grows as characters shrink, and one study linked it to smaller pupils under a bright ground.[^polarity] {{A}}
- **The penalty for light-on-dark text is largest in dark surroundings.** In glance-reading tests, negative polarity was worst in a dark room; in bright ambient light both polarities did well.[^dobres2017] {{B}} This contradicts the common intuition that a dark room calls for dark mode, at least for legibility.
- **Some low-vision readers do better with reversed contrast.** A subset read 10 to 50 per cent faster with light text on dark, attributed to light scatter in the eye.[^legge2016] {{B}}
- **No evidence that dark mode reduces eye strain.** The studies found are small, mixed, and in one case concluded the opposite of their own primary result.[^darkmode] {{C}}
- **Blue light and sleep.** Reading on a light-emitting tablet before bed, compared with a printed book, delayed sleep and suppressed melatonin.[^chang] {{B}} But iPhone's Night Shift made no measurable difference to sleep in a randomized trial of 167 people. A Cochrane review found blue-filtering lenses probably make little or no difference to eye strain.[^bluelight] {{A}} There is no reading-performance evidence for sepia themes {{D}}.

The design conclusion is chapter 9's: offer both themes, default by context or preference, and do not claim health benefits for either.

## Justification and hyphenation

- **Crude justification slows reading; good justification may not.**
  - Justification by inserting extra spaces slowed reading with no comprehension difference.[^trollip] {{B}}
  - Justified 7-word lines lowered comprehension for poorer readers only, and 12-word lines showed no disadvantage.[^gregory] {{B}}
  - Justification that spread space proportionally between and within words was read *faster* than ragged text.[^campbell] {{B}}
  - Readers preferred justified text while searching ragged text faster.[^ling2007] {{C}}

  The method matters. {{X}}
- **No study compares optimal with greedy line breaking on readers.** Chapter 5's measurements show total-fit breaking produces far more even spacing, but whether that improves reading has never been tested. Claims that it does are {{D}}.
- **No verified study of the cost of end-of-line hyphenation** was found.

## Reading media: screens versus paper

- **Comprehension is somewhat lower on screens, mostly for informational text under time pressure.**
  - Delgado and colleagues' meta-analysis of 54 studies found a paper advantage of g = −0.21.[^delgado] The gap was larger when reading was timed, held for informational but not narrative texts, and grew with publication year.
  - Clinton's meta-analysis of 33 studies found −0.25 overall: −0.32 for expository text and −0.04 for narrative.[^clinton] Readers' confidence was better calibrated on paper.
  - A 2024 meta-analysis found a smaller gap for handheld devices (about −0.1).[^salmeron] {{A}}
- **The likely mechanisms are not typographic.** Readers on screens regulate their study time worse and are overconfident when reading is self-paced.[^ackerman] Kindle readers of a 28-page story comprehended as well as paperback readers but were worse at placing events in order, attributed to weaker physical cues about position.[^mangen] {{B}} to {{C}}

Two implications for a reader app follow, neither proven: make position in the text visible and stable (page numbers, a location indicator, consistent pagination), and support deeper processing (annotation, review) rather than skimming.

## Scrolling versus paging

- **Scrolling reduced understanding of long argumentative texts** for readers with lower working-memory capacity.[^sanchez] {{B}}
- **Paging helped readers remember where information appeared** in an older study, without a significant comprehension difference.[^piolat] A 2022 study of 145 students on phones and tablets found a trend toward better integrated understanding with paging (p = 0.066) and more strategic looking back, while scrolling on a tablet was the more enjoyed experience.[^haverkamp] {{C}}

The lean toward paging for deep reading is consistent but small. That argues for offering both, which chapter 4 recommends.

## Measuring readability in your own product

If you test typography in a reader, the literature's pitfalls are well documented.[^methods]

1. **Speed–accuracy trade-offs:** faster reading can mean shallower reading. Always measure comprehension alongside speed.
2. **Preference is not performance.** Ask both, report both, and do not substitute one for the other.
3. **Practice and novelty.** Readers speed up across a session. In Wallace's study the second screen of a passage was read 39 words per minute faster than the first. Counterbalance the order.
4. **Short passages and proxy measures,** such as fixation duration without reading time, do not predict sustained reading.
5. **Ceiling effects:** comprehension tests that everyone passes detect nothing.
6. **Small samples and between-subjects designs** cannot detect font effects of realistic size.
7. **Selecting each person's best condition** inflates the apparent benefit through regression to the mean.
8. **Uncontrolled size:** report letter sizes as visual angles.
9. **Confounded variables:** size changes characters per line, and "dyslexia fonts" have wider spacing. Vary one thing at a time.

For reference, adult silent reading in English averages about 238 words per minute for non-fiction and 260 for fiction.[^brysbaert]

## What the evidence supports, in one table

| Question | Best-supported answer | Grade |
|---|---|---|
| How large must text be? | x-height at or above about 0.2° for sustained reading; more for older readers and low vision | {{A}} |
| What is the best line length? | No optimum for speed up to about 100 characters; a floor at about 13; readers prefer 55–70; one study favours 55 for comprehension | {{C}} |
| What line spacing? | At least about 1.2–1.5 times single spacing; little gain beyond | {{C}} |
| Serif or sans? | No practical difference | {{A}} |
| Is there a best font? | Not for everyone; preference does not predict performance | {{B}} |
| Do dyslexia fonts help? | No; spacing, not letterforms, carries any benefit | {{A}} |
| Does extra letter spacing help dyslexia? | Sometimes, mostly accuracy, only with more word spacing | {{X}} |
| Dark or light? | Dark text on light is slightly more legible, especially in dark rooms; some low-vision readers prefer the reverse | {{A}} |
| Does dark mode reduce eye strain? | No evidence either way from good studies | {{C}} |
| Justified or ragged? | Depends on justification quality; crude justification hurts | {{X}} |
| Screen or paper? | Screens slightly worse for informational text under time pressure | {{A}} |
| Scroll or page? | Small lean toward paging for deep reading | {{C}} |

[^rayner]: Keith Rayner, "Eye movements in reading and information processing: 20 years of research", *Psychological Bulletin* 124(3):372–422, 1998 (Table 1; pp. 375–381). [doi.org/10.1037/0033-2909.124.3.372](https://doi.org/10.1037/0033-2909.124.3.372).
[^returnsweeps]: Timothy Slattery and Adam Parker, "Return sweeps in reading", *Psychonomic Bulletin & Review* 26(6):1948–1957, 2019. [doi.org/10.3758/s13423-019-01636-3](https://doi.org/10.3758/s13423-019-01636-3).
[^legge]: Gordon E. Legge and Charles A. Bigelow, "Does print size matter for reading? A review of findings from vision science and typography", *Journal of Vision* 11(5):8, 2011 (sections on the fluent range and x-height; Tables 2, 4–6). [doi.org/10.1167/11.5.8](https://doi.org/10.1167/11.5.8).
[^mnread]: Aurélie Calabrèse and colleagues, "Baseline MNREAD measures for normally sighted subjects from childhood to old age", *Investigative Ophthalmology & Visual Science* 57(8):3836–3843, 2016 (n = 645). [doi.org/10.1167/iovs.16-19580](https://doi.org/10.1167/iovs.16-19580). Conversion from logMAR to degrees is this handbook's arithmetic.
[^akutsu]: Hiroko Akutsu, Gordon Legge and colleagues, "Psychophysics of reading X: Effects of age-related changes in vision", *Journal of Gerontology* 46(6):P325–P331, 1991 (abstract only).
[^refpx]: W3C, CSS Values and Units Level 4, §6.2 (the reference pixel). [w3.org/TR/css-values-4](https://www.w3.org/TR/css-values-4/#reference-pixel).
[^distance]: Yuliya Bababekova and colleagues, *Optometry and Vision Science* 88(7):795–797, 2011; Jennifer Long and colleagues, *Clinical and Experimental Optometry* 100(2):133–137, 2017 (abstracts only).
[^rello2016]: Luz Rello, Martin Pielot and Mari-Carmen Marcos, "Make It Big! The Effect of Font Size and Line Spacing on Online Readability", CHI 2016, pp. 3637–3648. [doi.org/10.1145/2858036.2858204](https://doi.org/10.1145/2858036.2858204).
[^atilgan]: Nilsu Atilgan, Ying-Zi Xiong and Gordon Legge, "Reconciling print-size and display-size constraints on reading", *PNAS* 117(48):30276–30284, 2020. [doi.org/10.1073/pnas.2007514117](https://doi.org/10.1073/pnas.2007514117).
[^bringhurst]: Robert Bringhurst, *The Elements of Typographic Style*, §2.1.2.
[^dyson]: Mary C. Dyson, "How physical text layout affects reading from screen", *Behaviour & Information Technology* 23(6):377–393, 2004 (pp. 379–391), which reports Duchnicky and Kolers (1983) and Dyson and Kipping (1998). [doi.org/10.1080/01449290410001715714](https://doi.org/10.1080/01449290410001715714).
[^dysonhaselgrove]: Mary C. Dyson and Mark Haselgrove, "The influence of reading speed and line length on the effectiveness of reading from screen", *International Journal of Human-Computer Studies* 54(4):585–612, 2001 (abstract and Dyson's summary). [doi.org/10.1006/ijhc.2001.0458](https://doi.org/10.1006/ijhc.2001.0458).
[^rubin]: Gary Rubin and colleagues, *Ophthalmic and Physiological Optics* 26(6):545–554, 2006 (abstract).
[^chung2004]: Susana Chung, "Reading speed benefits from increased vertical word spacing in normal peripheral vision", *Optometry and Vision Science* 81(7):525–535, 2004 (abstract).
[^chiu]: Tzu-Yao Chiu and Denis Drieghe, *Attention, Perception & Psychophysics* 85(8):2834–2858, 2023 (abstract).
[^calabrese2010]: Aurélie Calabrèse and colleagues, "Small effect of interline spacing on maximal reading speed in low-vision patients", *IOVS* 51(2):1247–1254, 2010.
[^blackmore]: Sarah Blackmore-Wright and colleagues, *PLoS ONE* 8(11):e80325, 2013.
[^u1412]: W3C, Understanding WCAG 2.2 Success Criterion 1.4.12, research section. [w3.org/WAI/WCAG22/Understanding/text-spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html). McLeish 2007, *British Journal of Visual Impairment* 25(2).
[^u148]: W3C, Understanding WCAG 2.2 Success Criterion 1.4.8. [w3.org/WAI/WCAG22/Understanding/visual-presentation](https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html).
[^pelli]: Denis Pelli and Katharine Tillman, "The uncrowded window of object recognition", *Nature Neuroscience* 11(10):1129–1135, 2008; Pelli and colleagues, *Journal of Vision* 7(2):20, 2007.
[^spacingnormal]: Susana Chung, *IOVS* 43(4), 2002; Marjolein van den Boer and Britt Hakvoort, "Default spacing is the optimal spacing for word reading", *Quarterly Journal of Experimental Psychology* 68(4), 2015; Sebastian Korinth and colleagues, *Frontiers in Psychology* 11:444, 2020.
[^slattery]: Timothy Slattery and Keith Rayner, *Attention, Perception & Psychophysics* 75(6), 2013; Slattery, Yates and Angele, *Journal of Experimental Psychology: Applied* 22(4), 2016.
[^zorzi]: Marco Zorzi and colleagues, "Extra-large letter spacing improves reading in dyslexia", *PNAS* 109(28):11455–11459, 2012; critique by Skottun and Skoyles, *PNAS* 109(44), 2012.
[^hakvoort]: Britt Hakvoort and colleagues, *Journal of Experimental Child Psychology* 164:101–116, 2017.
[^galliussi]: Jessica Galliussi and colleagues, *Annals of Dyslexia* 70(1):141–152, 2020.
[^sjoblom]: Amanda Sjoblom, Elizabeth Eaton and Steven Stagg, *British Journal of Educational Psychology* 86(4), 2016; Steven Stagg and Nora Kiss, *Research in Developmental Disabilities* 119, 2021.
[^joo]: Sung Jun Joo and colleagues, "Optimizing text for an individual's visual system", *Cortex* 103:291–301, 2018.
[^arditicho]: Aries Arditi and Jianna Cho, "Serifs and font legibility", *Vision Research* 45(23):2926–2933, 2005.
[^perea]: Carmen Moret-Tatay and Manuel Perea, *Journal of Cognitive Psychology* 23(5), 2011; Perea, *Psicothema* 25(1):13–17, 2013.
[^minakata2022]: Katsumi Minakata and Sofie Beier, "The dispute about sans serif versus serif fonts", *Acta Psychologica* 228, 2022.
[^beierlarson]: Sofie Beier and Kevin Larson, "How does typeface familiarity affect reading performance and reader preference?", *Information Design Journal* 20(1):16–31, 2013.
[^beierweight]: Minakata and Beier, *Applied Ergonomics* 97, 2021 (width); Beier and Oderkerk, *Acta Psychologica* 199, 2019 (weight); Beier and Thiessen, *Ergonomics* 69(9), 2026 (review).
[^wallace]: Shaun Wallace and colleagues, "Towards Individuated Reading Experiences: Different Fonts Increase Reading Speed for Different Individuals", *ACM TOCHI* 29(4), Article 38, 2022 (§6.1–6.2). [doi.org/10.1145/3502222](https://doi.org/10.1145/3502222).
[^dobres2016]: Jonathan Dobres and colleagues, *Ergonomics* 59(10):1377–1391, 2016.
[^larson]: Kevin Larson, Richard Hazlett, Barbara Chaparro and Rosalind Picard, "Measuring the Aesthetics of Reading", *People and Computers XX*, pp. 41–56, 2006. The significance recheck (Fisher's exact test, p ≈ 0.09 two-sided) is this handbook's.
[^arditicase]: Aries Arditi and Jianna Cho, "Letter case and text legibility in normal and low vision", *Vision Research* 47(19):2499–2505, 2007.
[^rellofonts]: Luz Rello and Ricardo Baeza-Yates, "Good fonts for dyslexia", ASSETS 2013 (abstract).
[^bold]: Susana Chung and Jean-Baptiste Bernard, "Bolder print does not increase reading speed in people with central vision loss", *Vision Research* 153, 2018; Bernard and colleagues, *Vision Research* 84, 2013.
[^contrast]: Gordon Legge, Gary Rubin and Andrew Luebker, "Psychophysics of reading V: The role of contrast in normal vision", *Vision Research* 27(7), 1987; Legge, "Reading digital with low vision", *Visible Language* 50(2), 2016.
[^polarity]: Axel Buchner and Nina Baumgartner, *Ergonomics* 50(7), 2007; Cosima Piepenbrock and colleagues, *Ergonomics* 56(7), 2013, *Ergonomics* 57(11), 2014, and *Human Factors* 56(5), 2014.
[^dobres2017]: Jonathan Dobres, Nadine Chahine and Bryan Reimer, "Effects of ambient illumination, contrast polarity, and letter size on text legibility under glance-like reading", *Applied Ergonomics* 60:68–73, 2017.
[^legge2016]: Gordon Legge, "Reading digital with low vision", *Visible Language* 50(2):102–125, 2016, section "Contrast and Lighting".
[^darkmode]: Tanvi Sethi and Mounia Ziat, *Ergonomics* 66(12), 2023; Sengsoon and Intaruk, *IJERPH* 22(4), 2025.
[^chang]: Anne-Marie Chang and colleagues, "Evening use of light-emitting eReaders negatively affects sleep", *PNAS* 112(4):1232–1237, 2015.
[^bluelight]: Kara Duraccio and colleagues, *Sleep Health* 7(4), 2021; Sumeer Singh and colleagues, Cochrane review CD013244, 2023.
[^trollip]: Stanley Trollip and Gregory Sales, "Readability of computer-generated fill-justified text", *Human Factors* 28(2), 1986.
[^gregory]: Margaret Gregory and E. C. Poulton, "Even versus uneven right-hand margins and the rate of comprehension in reading", *Ergonomics* 13(4), 1970.
[^campbell]: Anthony Campbell, Frank Marchetti and D. J. K. Mewhort, *Ergonomics* 24(8), 1981.
[^ling2007]: Jonathan Ling and Paul van Schaik, *Displays* 28(2), 2007.
[^delgado]: Pablo Delgado, Cristina Vargas, Rakefet Ackerman and Ladislao Salmerón, "Don't throw away your printed books", *Educational Research Review* 25:23–38, 2018.
[^clinton]: Virginia Clinton(-Lisell), *Journal of Research in Reading* 42(2):288–325, 2019.
[^salmeron]: Ladislao Salmerón and colleagues, *Journal of Educational Psychology* 116(2):153–172, 2024.
[^ackerman]: Rakefet Ackerman and Morris Goldsmith, *Journal of Experimental Psychology: Applied* 17(1), 2011.
[^mangen]: Anne Mangen, Gérard Olivier and Jean-Luc Velay, *Frontiers in Psychology* 10:38, 2019.
[^sanchez]: Christopher Sanchez and Jennifer Wiley, "To scroll or not to scroll", *Human Factors* 51(5), 2009.
[^piolat]: Annie Piolat, Jean-Yves Roussey and Olivier Thunin, *International Journal of Human-Computer Studies* 47(4), 1997 (reported via Haverkamp and colleagues).
[^haverkamp]: Yvonne Haverkamp and colleagues, *Reading and Writing* 36(7):1589–1608, 2022.
[^methods]: Keith Rayner and colleagues, *Psychological Science in the Public Interest* 17(1), 2016; Dyson 2004; Wallace and colleagues 2022; Marinus and colleagues 2016.
[^brysbaert]: Marc Brysbaert, "How many words do we read per minute?", *Journal of Memory and Language* 109, 2019.
