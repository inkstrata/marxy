# Colour, contrast and access for artifacts

*This chapter settles the colour and access demands that artifacts add on top of the sibling handbook's body and code-token work: diff line and word backgrounds, log levels, alert types, invisible-character markers, blocked-content notices, fold markers, changed-since-last-read marks, and the focus rings on all of them. The finding that matters to a reader app: the official diff palettes in wide use were tuned for their own code colours, and most of them push at least one common token below 4.5:1 once the word highlight is under it. Marxy can do better because it owns its code palette, but only if the tints are designed against that palette and the marker character stays the primary cue.*

Evidence grades: **[A]** replicated findings or a meta-analysis · **[B]** one well-designed study · **[C]** small, limited or mixed studies · **[D]** expert convention, or convergence of shipping tools, without a direct test · **[X]** contested or contradicted. Part of the [Reader Artifacts Handbook](README.md).

## What binds artifact colour

Colour is asked to carry more in an artifact than in prose, and the rules that bind it are few. The sibling handbook's [Color and Accessibility](../reader-typography/09-color-access.md) sets the base (WCAG 2.2 AA, the contrast formula, colour-vision deficiency); this section applies it to the new roles.

| Requirement | What it demands here | Source |
| --- | --- | --- |
| 1.4.1 Use of Color (A) | Colour is not the only visual means of conveying information or distinguishing an element. "Visual means" includes text, patterns, icons and lightness differences of 3:1 or more | Understanding 1.4.1[^u141] |
| 1.4.3 Contrast (Minimum) (AA) | 4.5:1 for text, so every code token *on every tint it can land on* | sibling chapter[^sib] |
| 1.4.11 Non-text Contrast (AA) | 3:1 for parts of graphics required to understand the content and for focus indicators; a text glyph used as a symbol is treated as non-text; decorative or redundant visuals are exempt | Understanding 1.4.11[^u1411] |
| 1.4.10 Reflow (AA) | 320 CSS px without two-dimensional scrolling, except where layout has meaning; the page names code indentation as such a case | Understanding 1.4.10[^u1410] |
| 2.4.7 Focus Visible (AA), 2.4.11 Focus Not Obscured (Minimum) (AA) | A focused control is visible and not entirely hidden by author content (a sticky header, a summoned panel) | Understanding 2.4.11[^u2411] |
| 2.3.3 Animation from Interactions (AAA) | Interaction-triggered motion can be turned off; `prefers-reduced-motion` is the named technique | Understanding 2.3.3[^u233] |

Two consequences shape everything below. First, a diff's background tint is *redundant* if the `+` or `-` in column one stays in the text, so the tint needs no 3:1 luminance against the ground (1.4.11's Understanding page says a graphic whose information is also given as text is not required for understanding; applying that to a diff tint beside a `+` marker is my analogy, not a ruling on diffs **[D]**); but the text on top of it needs 4.5:1, and that is where published palettes fail. Second, anything that carries a meaning *without* a text equivalent (a fold glyph, a changed-since-last-read rule, a focus ring) does need 3:1.

Two user-agent modes also matter, and they are not the same:

- **Forced colours** replaces `color`, `background-color`, `border-color`, `outline-color` and `text-decoration-color` with system colours, and sets non-URL `background-image`, `box-shadow` and `text-shadow` to none.[^mdnforced][^cssadjust] A diff tint is a background colour, so it disappears; markers, borders and outlines survive (recoloured). It is a Windows feature in practice: a June 2025 MDN compat-data issue, one reporter on one MacBook, says macOS Increase Contrast does *not* trigger it in Safari.[^bcd] That is a Safari observation, not a WebKit or WKWebView statement, and it was not tested in a Tauri shell; the likely reading is that a macOS Marxy will not see forced colours, and a later Windows shell would **[C]**.
- **`prefers-contrast`** takes `no-preference`, `more`, `less` and `custom`, is Baseline since May 2022, and reads the OS setting.[^mdncontrast] It is the mode a Marxy macOS reader can actually meet. Whether WKWebView inside Tauri reports it was not tested.

> **Marxy today.** No rule anywhere in `packages/` or `apps/` mentions `forced-colors`, `prefers-contrast` or `prefers-reduced-motion` (grep of `*.css`, `*.ts`, `*.html`, excluding tests); the only `prefers-*` query is `prefers-color-scheme` in `apps/desktop/src/render/headless.ts` line 306. The one focus rule is `:is(pre, table):focus-visible { outline: 2px solid var(--marxy-color-accent); outline-offset: 2px }` in `packages/theme/src/base.css` line 250.

## Diff colours in the wild, measured

The brief for this chapter asked for the official diff colours, composited and tested against real code colours. Here is the method, so that it can be reproduced; the scripts live in the session scratchpad, not the repository.

> **Measured.** *Sources.* GitHub Primer primitives 11.10.0 (MIT, read from `package.json`), built theme files `dist/css/functional/themes/{light,dark,light-colorblind,dark-colorblind,light-tritanopia,dark-tritanopia}.css`, with the token structure confirmed in `src/tokens/component/diffBlob.json5`.[^primer] VS Code (MIT) default themes in `extensions/theme-defaults/themes/` (`dark_vs`, `light_vs`, `2026-dark`, `2026-light`) and the built-in fallbacks in `src/vs/platform/theme/common/colors/editorColors.ts`.[^vscode] (Primer's v11 names for the red-green set are `*-colorblind`; the same changelog line calls them Protanopia & Deuteranopia.[^ghcb]) *Compositing.* Each 8-digit hex is composited in sRGB over the theme's ground; a word highlight is composited over the composited line background, as it sits in a browser. *Contrast.* WCAG 2.2 relative luminance and ratio, no rounding. *Text sets.* Primer: the default foreground and the five `prettylights-syntax-*` colours in the theme file (comment, constant, entity, keyword, string). VS Code: the editor foreground plus the two token colours read from `dark_vs`/`light_vs` (comment, `constant.language`), so its "lowest token" is the lowest of *only* those. *CVD.* Machado, Oliveira and Fernandes' model, severity 1.0, using matrices that the skeptic pass checked digit for digit against the authors' own page (they equal the BSD-3 `colour-science` `machado2010.py` values), applied to linearised sRGB;[^machado][^colour] *tritan caveat:* the 2009 paper says it does not model tritanopia and simulates only tritanomaly by a spectral shift, so the tritan columns below are that model's severity-1.0 extreme, an approximation outside what the paper validates, and are less trustworthy than protan and deutan; *distance.* OKLab ΔE, the Euclidean distance in Ottosson's OKLab, with his published M1/M2 matrices, multiplied by 100.[^oklab]

### Palettes

| Palette | Ground | Added line / word | Removed line / word |
| --- | --- | --- | --- |
| Primer light | `#ffffff` | `#dafbe1` / `#aceebb` | `#ffebe9` / `#ffcecb` |
| Primer dark | `#0d1117` | `#12261e` / `#1d572d` | `#25181c` / `#792f2e` |
| Primer light, colorblind | `#ffffff` | `#ddf4ff` / `#b6e3ff` | `#fff1e5` / `#ffd8b5` |
| Primer dark, colorblind | `#0d1117` | `#132339` / `#224d88` | `#2c1f1a` / `#723e1f` |
| Primer light, tritanopia | `#ffffff` | `#ddf4ff` / `#b6e3ff` | `#ffebe9` / `#ffcecb` |
| Primer dark, tritanopia | `#0d1117` | `#132339` / `#224d88` | `#25181c` / `#792f2e` |
| VS Code Dark (default) | `#1e1e1e` | `#373d29` / `#4b5a2a` | `#4b1818` / `#6f1313` |
| VS Code Light (default) | `#ffffff` | `#ebf1dd` / `#d7e8b1` | `#ffcccc` / `#ffa3a3` |
| VS Code 2026 Dark | `#121314` | `#17231a` / `#2a4c2d` | `#2d1919` / `#693331` |
| VS Code 2026 Light | `#ffffff` | `#ebf1dd` / `#d5e0be` | `#ffcccc` / `#f3afaf` |

Composited values. Sources: Primer dark line is `#2ea04326` and `#f851491a`, word `#2ea04366` and `#f8514966`; light colorblind line `#ddf4ff`/`#fff1e5`; VS Code Dark default line `#9bb95533`/`#ff000033` (built-in `defaultInsertColor` 155,185,85 at 0.2 and `defaultRemoveColor` 255,0,0 at 0.2), word `#9ccc2c33`/`#ff000033` in dark and `#9ccc2c40`/`#ff000033` in light (`diffInserted`/`diffRemoved` in `editorColors.ts`); 2026 Dark line `#347d3926`/`#c93c3726`, word `#57ab5a4d`/`#f470674d`. VS Code 2026 Light defines only the word colours (`#587c0c26`, `#ad070726`); its lines fall back to the built-in default, an assumption I did not confirm by loading the theme in an editor.

Two facts about the data worth keeping. GitHub's red-green colour-blind sets move the *added* side from green to blue and the *removed* side from red to orange, and its tritanopia sets move only the added side to blue; the dark colour-blind word highlights keep the default's 0.4 alpha.[^primer] VS Code's defaults use a fixed 20% overlay of saturated green and red, the strongest tints of the ten, and (with 2026 Light, which inherits the default lines) the only sets whose two sides differ in lightness.

### Text on the tints

The ratio of the default code text, and of the lowest of the sampled token colours, on the four backgrounds. Bold with ✗ is below 4.5:1.

| Palette | Text on add line / del line / add word / del word | Lowest token (as sampled) on the same four |
| --- | --- | --- |
| Primer light | 14.2 / 13.8 / 11.8 / 11.2 | keyword 4.81 / 4.67 / **4.00 ✗** / **3.81 ✗** |
| Primer dark | 14.6 / 15.8 / 7.9 / 8.6 | comment 5.44 / 5.90 / **2.94 ✗** / **3.19 ✗** |
| Primer light, colorblind | 13.9 / 14.3 / 11.6 / 11.8 | keyword **4.42 ✗** / 4.55 / **3.70 ✗** / **3.77 ✗** |
| Primer dark, colorblind | 14.5 / 14.7 / 7.8 / 8.0 | comment 5.42 / 5.49 / **2.91 ✗** / **2.98 ✗** |
| Primer light, tritanopia | 13.9 / 13.8 / 11.6 / 11.2 | keyword 4.71 / 4.67 / **3.93 ✗** / **3.81 ✗** |
| Primer dark, tritanopia | 14.5 / 15.8 / 7.8 / 8.6 | comment 5.42 / 5.90 / **2.91 ✗** / **3.19 ✗** |
| VS Code Dark | 7.6 / 9.8 / 5.1 / 8.0 | comment **3.38 ✗** / **4.37 ✗** / **2.26 ✗** / **3.54 ✗** |
| VS Code Light | 18.2 / 14.8 / 16.0 / 11.0 | comment **4.44 ✗** / **3.61 ✗** / **3.92 ✗** / **2.70 ✗** |
| VS Code 2026 Dark | 8.7 / 8.9 / 5.2 / 5.3 | comment 4.89 / 4.97 / **2.90 ✗** / **2.96 ✗** |
| VS Code 2026 Light | 14.1 / 11.5 / 11.8 / 8.9 | comment **4.44 ✗** / **3.61 ✗** / **3.72 ✗** / **2.82 ✗** |

Every palette passes for its default text and every palette fails for at least one token on a word highlight; on a line tint alone, six of ten pass (the four that fail: Primer light colorblind, VS Code Dark, VS Code Light, VS Code 2026 Light). The failures are mostly the comment colour, which is the same finding as the sibling's theme audit ([Code](../reader-typography/06-code.md): comments fail in 11 of 12 failing themes) moved onto a new background. VS Code Dark's comment colour is 5.0:1 on its plain ground (`#6a9955` on `#1e1e1e`, same computation), so the tint is what costs it: a 20% red or green overlay lifts the background toward the token's own lightness. Primer's token colours are its own and its tints are its own, and the two were not tuned against each other: the word highlight is `alpha 0.4` of the full-strength green, which lifts the ground more than the comment colour can afford. The sampled token sets are small, so treat the table as a lower bound on failures.

### Colour-vision simulation

OKLab ΔE (×100) between the added and removed *line* backgrounds after simulating each deficiency, and between the word backgrounds; and the lightness gap |ΔL|×100 between the two lines with normal vision. A working threshold of ΔE 4 is my choice, taste rather than evidence **[D]**; its only anchor is that CSS Color 4 takes one just-noticeable difference as an OkLCh distance of 0.02, that is 2 in these units, so 4 is about two JNDs.[^csscolor] That JND is for a threshold-level, small-patch difference; the spec does not say it holds for large tints or for dichromats, and no source sets a reading-task threshold.

| Palette | Line ΔE: normal / protan / deutan / tritan | Word ΔE: normal / protan / deutan / tritan | Line ΔL, normal |
| --- | --- | --- | --- |
| Primer light | 6.4 / **3.2** / **0.9** / 6.2 | 13.8 / 6.3 / **1.6** / 13.6 | 0.2 |
| Primer dark | 5.9 / 4.5 / **2.3** / 6.3 | 17.6 / 7.5 / **1.3** / 20.2 | 2.3 |
| Primer light, colorblind | 5.1 / **3.5** / 4.7 / 5.6 | 12.4 / 9.8 / 11.6 / 12.8 | 1.2 |
| Primer dark, colorblind | 6.7 / 6.0 / 6.5 / 7.2 | 18.8 / 16.7 / 18.1 / 17.5 | 0.3 |
| Primer light, tritanopia | 4.9 / **2.9** / **3.4** / 6.0 | 11.2 / 7.0 / 8.0 / 13.5 | 0.2 |
| Primer dark, tritanopia | 6.3 / 6.1 / 5.4 / 7.4 | 19.1 / 15.0 / 16.2 / 20.8 | 2.9 |
| VS Code Dark | 10.7 / 9.9 / 5.4 / 11.7 | 17.6 / 16.1 / 8.0 / 17.4 | 5.8 |
| VS Code Light | 9.1 / 8.6 / 5.6 / 9.5 | 17.4 / 15.6 / 9.4 / 17.4 | 5.9 |
| VS Code 2026 Dark | 5.2 / **2.1** / **0.4** / 6.1 | 12.5 / **4.4** / **1.7** / 14.4 | 0.0 |
| VS Code 2026 Light | 9.1 / 8.6 / 5.6 / 9.5 | 12.4 / 11.2 / 6.9 / 12.9 | 5.9 |

What the numbers say, and do not:

- Default green/red tints collapse for red-green deficiencies, as expected: Primer dark's line pair falls to ΔE 2.3 under deuteranopia simulation, and VS Code 2026 Dark's to 0.4. GitHub's colour-blind sets fix it by moving to blue and orange: the dark colour-blind set keeps line ΔE ≥ 6.0 in all three simulations, the dark tritanopia set ≥ 5.4, and the light colour-blind set ≥ 3.5.
- **Only the VS Code defaults separate the pair by lightness alone** (|ΔL|×100 of about 5.8, so the pair survives greyscale). Every Primer palette, colour-blind or not, has a lightness gap under 3, and 2026 Dark has none. GitHub's design relies on hue (and, in the product, on the `+`/`−` markers and line-number colours), not on lightness. Okabe and Ito's guidance is the opposite emphasis: lightness and saturation differences, redundant cues, red-green avoided.[^cud] **[D]** for both.
- The ΔE results are from a simulation model; the paper reports a Farnsworth-Munsell 100-Hue experiment with normal and colour-deficient subjects and a comparison with Brettel et al. for reference, and it explicitly declines to model tritanopia.[^machado] Simulations at severity 1.0 are the dichromat worst case for protan and deutan; anomalous trichromats do better.

No study was found comparing diff colourings by reader accuracy on any task. What ships is convention, and it has converged on green and red for added and removed (6 of 10 palettes here: Primer default light and dark and all four VS Code sets; the two GitHub colour-blind sets use blue and orange, and the two tritanopia sets blue and red) **[D]** (converged: 6 of 10 palettes surveyed). Convergence says readers expect it, not that it helps.

## A Marxy diff pair

The design constraints, in order, come from the sibling handbook, from [Code typography](04-code-typography.md), and from the measurements above:

1. The marker character in column one is the primary cue, in the code text colour ([Diffs and provenance](05-diffs-provenance.md)).
2. Every Marxy code token stays at 4.5:1 or better on every tint it can land on: the line tints and the (stronger) word tints.
3. The added and removed tints differ in *lightness*, by at least about 0.05 in OKLab L with normal vision (the search accepted 0.025 in the simulations; light protan reaches 0.037), so they survive greyscale, and stay ≥ ΔE 4 apart from each other in the protan, deutan and tritan simulations. The constraint is on the pair, not on each tint against the ground (see the asymmetry below).
4. Tints are low chroma and near the block ground's lightness, so that no tint can be read as a token (which sit at L 0.76 in dark).
5. Foreground hue is never used; only backgrounds carry tint ([Code typography](04-code-typography.md), status hues).

> **Measured.** I searched OKLCH space in a script: add hue 140 to 170, delete hue 20 to 40, chroma 0.03 to 0.045 for lines and 1.6 times that for words, lightness offsets from the block ground in steps of 0.005 to 0.09, rejecting any candidate below 4.5:1 for the code text and the four tokens on any of the four backgrounds or with a line-pair ΔL gap under 0.025 in any simulation, then hand-rounding to hex. The dark pair below is close to the search's best score; the light pair was constrained hard by contrast headroom (below). Values were then re-measured from the hex.

| | Role | Hex | OKLCH (L, C, h°) | Lowest token on it (contrast) |
| --- | --- | --- | --- | --- |
| Dark, ground `#1d1c19` | added line | `#1b2f28` | 0.286, 0.029, 170 | number/constant 6.43 |
| | removed line | `#2d140b` | 0.226, 0.044, 40 | number/constant 7.85 |
| | added word | `#1f4438` | 0.355, 0.048, 170 | number/constant **4.91** |
| | removed word | `#4a1e0e` | 0.297, 0.072, 40 | number/constant 6.44 |
| Light, ground `#f1eee8` | added line | `#cce3c6` | 0.891, 0.046, 139 | comment 4.77 |
| | removed line | `#ffe7e6` | 0.947, 0.026, 20 | comment 5.54 |
| | added word | `#c0e2b8` | 0.877, 0.067, 140 | comment **4.60** |
| | removed word | `#ffdcdb` | 0.923, 0.039, 20 | comment 5.13 |

Code text (`#e3dfd6` dark, `#1c1b19` light) is 8.1 to 13.0:1 and 12.1 to 14.6:1 on the same backgrounds; the secondary text colour, which line numbers use, is 5.3 to 6.5 on the line tints in dark and 5.0 to 5.8 in light. The one place a Marxy text colour drops under 4.5 is dark secondary text on the added *word* tint (4.05), which matters for invisible-character markers (below).

| Simulation | Dark: line ΔE / word ΔE / line ΔL×100 | Light: line ΔE / word ΔE / line ΔL×100 |
| --- | --- | --- |
| Normal | 9.0 / 12.4 / 6.0 | 8.4 / 10.4 / 5.6 |
| Protan | 9.0 / 11.0 / 8.9 | 4.7 / 4.6 / 3.7 |
| Deutan | 6.3 / 6.9 / 5.6 | 5.9 / 5.3 / 5.7 |
| Tritan | 10.5 / 15.3 / 5.7 | 7.4 / 8.8 / 5.2 |

Read against the target: dark clears every threshold with room; light clears them with less (protan line ΔE 4.7, word 4.6). Greyscale (WCAG luminance): in dark the added line has 2.1 times the ground's luminance and the removed line is level with it; in light the added line is 16% darker and the removed line within 2% of the ground.

Three properties of the pair are choices, not consequences, and each is a fair target for taste review:

- **Additions are raised; deletions rest.** In both themes the removed line sits at the ground's lightness and takes its identity from a warm hue and the `-` marker; the added line is the emphatic one. This is why the removed line is nearly invisible against the ground in greyscale (ΔE 4.1 dark, 2.4 light, and 0.3 under deutan in light). Recomputed by the skeptic pass, the removed line's ΔE from the ground is 2.7 / 2.6 (protan / deutan) in dark and 1.2 / 0.3 in light, and the light removed word's is 4.1 / 2.6: at or below the chapter's own ΔE 4, and near one to two CSS JNDs. So the removed tint is close to decoration and the `-` marker carries the cue. The asymmetry is a choice, not forced by contrast headroom: a search over hue 20 to 30 shows light removed lines such as `#f3d8d7` keep the comment colour at 4.85:1 while sitting ΔE 4.5 or more from the ground in all four simulations, at the cost of a stronger word step to sit beyond it. **[D]**
- **The dark added line is 0.060 above the ground, slightly over the 0.05 that [Code typography](04-code-typography.md) proposes; the word tints are 0.13 to 0.07 above it.** The line tint is close to the rule; the word tint is deliberately outside it, because it must be a step beyond the line, and it appears only behind changed runs.
- **The light word tint is a weak second step** (ΔE 1.8 to 2.9 from its line tint, at or below about one and a half CSS JNDs and under the chapter's own ΔE 4), because the light palette's lowest token (comment `#85521a`, 5.63:1 on the ground) leaves only about 20% luminance headroom. Buying a stronger word step means darkening the light comment, string, number and function colours: a token change, out of this chapter's scope. **[D]**

Hue: in dark the added tint is 170°, teal-green, 41° from the `string` hue (129°); the removed tint is 40°, 37° from the `comment` amber (77°). In light the gap closes: the added tint is 139° and the `string` token 138°, the same hue, and the removed tint 20° against the comment's 64°. The skeptic pass computed both pairs: contrast of string or comment text on the tints is 4.6 to 9.0:1 (all pass) and the OKLab ΔE between token colour and tint is 40 to 57, an order of magnitude past the JND, so the overlap costs no legibility; it is a taste question of whether green text on a green tint reads as one thing. They are backgrounds and the token hues are foreground, so the "two meanings on one hue" trap in [Code typography](04-code-typography.md) does not strictly apply, but amber text sitting on a brown-red tint is worth a look by eye. The hues are not Okabe-Ito colours: with red-green pairs the tint alone can never be the only cue, and it is not.

> **Default.** A diff fence or diff file line whose first character is `+` or `-` (not `+++`/`---` headers) gets a full-width line tint from the table above, applied to the `.marxy-line` element so that wrapped continuation rows keep it (WCAG 1.4.10: a wrapped line must not lose its cue on row 2); the marker stays in the text in the code text colour; a word-level highlight uses the word tint on a plain `span` (not `<mark>`, see Screen readers). Header, hunk and context lines are untinted. Under `prefers-contrast: more`, add a 3px inline-start border in the code text colour, solid for additions and dashed for deletions, so the two are separated by pattern and lightness rather than tint. **[D]** (rests on the sibling's restraint findings and my measurements; no study tests any diff colouring).

> **Marxy today.** `markup.inserted` and `markup.deleted` map to no class in `packages/core/src/highlight/scopes.ts` (twelve classes, none diff); `tokens.css` defines no diff token; a diff fence renders uncoloured. Nothing is contradicted, nothing is applied.

## Log levels, alerts and other severity words

The sibling's rule, restated by [Structured output](03-structured-output.md), is that a level is a *word*, and the level word is the carrier. Colouring it adds a redundant channel and, in a code block, a second meaning for the amber and red hues. Marxy's palette has four foreground hues at L 0.76 already spoken for.

> **Default.** Log level: the level word (`ERROR`, `WARN`) in the strong weight (`--marxy-weight-strong`, 700), the text colour unchanged. No tint on log lines. **[D]** Chapter 03 already recommends this; the finding here is that it is also what leaves colour budget intact: bold at unchanged colour has the full 12.8:1 (dark) and 14.9:1 (light) that the code text has on its ground.

**Alerts** (GitHub's five: NOTE, TIP, IMPORTANT, WARNING, CAUTION[^ghalert]) are the one role where the ecosystem uses colour and icon together, and GitHub's own docs say to use them sparingly, one or two per article.[^ghalert] Marxy's design language forbids coloured headings, boxes around callouts by default, and asks that hierarchy read in greyscale. No study was found on whether type-coloured alerts help readers or trained readers to skip them; five hues would also need five measured pairs.

> **Default.** No hue. An alert is a blockquote whose first line is the type word in the strong weight and text colour, over the existing quote rule (whose edge colour is a mix of `--marxy-color-quote-rule` and the secondary text colour, `base.css` line 153). Types are told apart by the word, which every reader and screen reader already gets. **[D]**

> **Marxy today.** No corpus fixture and no code in `packages/core/src` handles `[!NOTE]`-style alerts (grep of `fixtures` and `packages/core/src`); such a line renders as literal text inside a blockquote.

## Markers, folds, focus and the small roles

The measured contrast of each small role in the proposed pair's palette (dark / light):

| Role | Colour used | On | Ratio | Needs |
| --- | --- | --- | --- | --- |
| Fold glyph (▸ ▾ or `…`) | secondary text | ground | 6.9 / 6.5 | 3:1 (1.4.11) |
| Focus ring on a fold, block or table | accent | ground | 8.5 / 6.4 | 3:1 |
| Same ring beside an added / removed line | accent | tint | 6.6 / 8.0 dark, 4.9 / 5.7 light | 3:1 |
| Changed-since-last-read rule | accent, 2px, in the margin | ground | 8.5 / 6.4 | 3:1 |
| Invisible-character marker (␛ and friends) | secondary text | code ground | 6.4 / 5.9 | 4.5:1 |
| Same, inside an added word tint | secondary text | tint | **4.05 ✗** / 4.8 | 4.5:1 |
| Same, in code text colour instead | code text | added word tint | 8.1 / 12.1 | 4.5:1 |
| Blocked-content notice text | text | notice ground | 13.2 / 14.9 | 4.5:1 |
| Same, secondary | secondary text | notice ground | 6.3 / 5.9 | 4.5:1 |

- **Invisible-character markers** inside a diff must use the code text colour: the secondary colour fails on the dark added-word tint, and the character being flagged is exactly what a diff reviewer needs to see (trailing spaces, tabs). Draw the marker as a glyph in the text flow, not a background, so that it survives forced colours. **[D]**
- **Changed-since-last-read** is a border, not a fill, for two reasons: a border survives forced colours and a fill does not, and its presence versus absence is a lightness difference of at least 3:1, which 1.4.1 counts as a visual means. Chapter 05 says how loud it may be; this chapter says it may not be a background. **[D]**
- **Focus** on new controls (fold buttons, marker chips) should reuse the existing 2px accent ring at 2px offset; it has 4.9:1 or more against every tint, so it passes 1.4.11 even when the focused control sits on a diff line. A summoned panel that covers a focused fold would fail 2.4.11 in spirit; scroll the focused control clear of it.[^u2411] **[D]**
- **Find and selection** paint an opaque background over a diff tint, and the sibling measured tokens on them. No new check is needed beyond confirming that the paint order keeps them above the tint.

> **Marxy today.** Blocked remote images produce one text notice (`apps/desktop/src/notices/blocked.ts`, `notify({ kind: 'blocked', ... })`), region `#marxy-notices`; no CSS rule for `.marxy-notice` was found in `packages/` (grep), so its colours are inherited. No fold, invisible-character or changed-since-last-read mark exists yet.

## Screen readers, transcripts and folds

Evidence here is thin: the `ins`/`del` claims rest on one practitioner's page (Roselli), so they are one source, not converging ones. **[C]** at most.

- **`ins` and `del`.** Adrian Roselli's testing reports that NVDA announces them, JAWS added then rolled back its support in April 2020 after customer feedback (his table of later versions was not read here), and VoiceOver on iPadOS is less useful for `s` than `del`; a CSS-generated-content workaround exists, but his 2024 update advises against it for non-macOS users because hidden text is too verbose.[^roselli] **[C]** The `a11ysupport.io` page for `ins_element` returned 404 in this session, so no structured support data was found. `<mark>` is announced by JAWS and NVDA, in different words.[^roselli]
- **Consequence for word highlights.** Use a plain class-bearing `span`, not `<mark>` or `<ins>`/`<del>`: the diff's semantics live in the line marker, already text, and screen readers should hear one signal, not two. Do not `aria-hide` the marker, and do not replace it with generated content. **[D]** What a screen reader says for a bare `+` or `-` at the start of a code line was not tested, and I make no claim.
- **Transcripts.** ARIA 1.2 defines `role="log"` for sequentially updated content such as chat histories, an area where new messages arrive while focus is elsewhere.[^aria] A transcript Marxy opens from disk is a finished document: nothing arrives, so live-region semantics add nothing. Use a heading (or a labelled group) per turn, which also gives the outline and the reader's heading navigation something to work with; this reads the spec's purpose, and no test was run. **[D]**
- **Folds.** The ARIA Authoring Practices disclosure pattern is a button with `aria-expanded`, operated by Enter and Space.[^apg] Marxy's sanitiser drops `<details>` markup (it renders open, ADR-0009), so folds are Marxy's own lens, and the pattern applies: a real `<button>` with `aria-expanded`, in the tab order only when the fold is summoned, state in view state, never in the buffer. Grade **[D]** (a published pattern, no reader study).
- **Motion.** WCAG 2.3.3 (AAA) names `prefers-reduced-motion` as the way to make interaction-triggered motion optional.[^u233] Marxy's spirit is instant; the default is to animate nothing, and the media query becomes a guard against a future theme or a later addition rather than a feature. **[D]**

## What the gate would and would not catch

Every colour this chapter proposes has to be held by a check that can fail, or the next token edit will move it unnoticed. An independent read of the aesthetics gate (`scripts/gate-aesthetics.mjs`, verified 2026-09-25 against commit `d373abc`) shows how much of that holds today.

> **Marxy today.** (1) The contrast check samples **one element per class**, not every colour pair: the first `p`, the first `.marxy-caption` and the first `code` in each fixture (`gate-aesthetics.mjs` around lines 237 to 264). Links, deleted text, list markers, table heads, `kbd`, footnote text, the twelve token colours on selection and find, and control borders are not measured by it. The palettes are pinned by value in `packages/theme/test/palettes.json` and by `grid.test.mjs`, so today's colours pass, but nothing fails if a value moves. (2) `.marxy-caption` is emitted and styled nowhere; the gate looks for it, so that branch never runs. The type scale lists a caption role (`docs/design-language.md`), and `--marxy-size-caption` is a token, but no stylesheet or renderer uses either. (3) Five tokens in the frozen contract are read by nothing outside their own definition, the default themes and tests: `--marxy-color-find`, `--marxy-color-find-current`, `--marxy-color-notice`, `--marxy-progress-rule` and `--marxy-justify`. A theme author is promised knobs that do nothing, and the diff, marker and notice colours proposed above would join them unless a gate reads them. (4) The width matrix is 720, 960 and 1280 px (`WIDTHS` in the gate); there is no 320 px pass, so the reflow and 1.4.12 checks the sibling handbook's spec asks for have no run. (5) No stylesheet or app file contains `forced-colors`, `prefers-contrast` or `prefers-reduced-motion`; the sibling spec lists forced colours and reduced motion as verification items, and this chapter's markers depend on them.

> **Default.** The contrast check in the gate walks every text-bearing computed style per fixture and variant, and every text-on-tint pair proposed in [the diff pair](#a-marxy-diff-pair), not a sample. A token is not added to the contract without a reader in a stylesheet and a check that reads its value. Grade: engineering; a check that cannot fail for something in the diff does not belong on the pull-request path (`AGENTS.md`), and a check that samples cannot fail for most of it.

## Gaps

The recommendations need token and class names that do not exist; each needs an ADR and a `scripts/registry.json` entry before code. The frozen contract in `packages/theme/src/contracts/` is not the blocker: additive tokens are allowed by ADR (ADR-0008 as quoted in `tokens.css`), and [Code typography](04-code-typography.md) proposes the same route.

| Need | Proposed name | Blocked by |
| --- | --- | --- |
| Four diff tints (dark and light values above) | `--marxy-color-diff-add`, `-diff-del`, `-diff-add-word`, `-diff-del-word` | theme-contract, registry |
| Diff line and word classes | new scope classes beyond the twelve, or line-level classes on `.marxy-line` | scopes.ts, registry |
| Level weight | expressed as a token class (chapter 03 gap) | scopes.ts |
| `prefers-contrast` / `forced-colors` / `prefers-reduced-motion` rules | none: system-owned in `base.css` | none (a story) |
| A machine contrast gate for every text-on-tint pair | none | aesthetics gate |

Recorded in [`data/09.json`](data/09.json).

## What I could not verify

- A reading-task threshold for OKLab difference; the ΔE 4 threshold is a multiple (about two) of the CSS Color 4 JND, chosen by me.
- The full set of VS Code token colours (only comment and `constant.language` were read); Primer's syntax colours beyond the five sampled.
- That VS Code 2026 Light's line tints fall back to the built-in default.
- Screen-reader speech for diff markers, and whether WKWebView reports `prefers-contrast`.
- Nothing further on Machado: the skeptic pass read the paper (its tritanopia disclaimer is now stated in the text) and confirmed the matrices against the authors' page; that page does not say whether they apply to linear or gamma-encoded RGB, and the linear reading is an assumption.
- `a11ysupport.io` data on `ins`/`del`: the page returned 404.

[^u141]: W3C, "Understanding Success Criterion 1.4.1: Use of Color", *WCAG 2.2 Understanding* (docs page, read via fetch summary). [w3.org/WAI/WCAG22/Understanding/use-of-color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html). Accessed 2026-09-25.
[^u1411]: W3C, "Understanding Success Criterion 1.4.11: Non-text Contrast", *WCAG 2.2 Understanding* (docs page, read via fetch summary). [w3.org/WAI/WCAG22/Understanding/non-text-contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html). Accessed 2026-09-25.
[^u1410]: W3C, "Understanding Success Criterion 1.4.10: Reflow", *WCAG 2.2 Understanding* (docs page, read via fetch summary). [w3.org/WAI/WCAG22/Understanding/reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html). Accessed 2026-09-25.
[^u2411]: W3C, "Understanding Success Criterion 2.4.11: Focus Not Obscured (Minimum)", *WCAG 2.2 Understanding* (docs page, read via fetch summary; it also refers to 2.4.7). [w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html). Accessed 2026-09-25.
[^u233]: W3C, "Understanding Success Criterion 2.3.3: Animation from Interactions", *WCAG 2.2 Understanding* (docs page, read via fetch summary). [w3.org/WAI/WCAG22/Understanding/animation-from-interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html). Accessed 2026-09-25.
[^sib]: "Color and Accessibility", *Reader Typography Handbook* (repository chapter, read in full; the contrast formula and WCAG table). [09-color-access.md](../reader-typography/09-color-access.md). Accessed 2026-09-25.
[^mdnforced]: MDN, "forced-colors" media feature (docs page, read via fetch summary). [developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/forced-colors). Accessed 2026-09-25.
[^cssadjust]: W3C, *CSS Color Adjustment Module Level 1*, Candidate Recommendation Snapshot, 7 May 2026 (spec, sections on forced colour palettes and `forced-color-adjust`, read via fetch summary). [drafts.csswg.org/css-color-adjust-1](https://drafts.csswg.org/css-color-adjust-1/). Accessed 2026-09-25.
[^bcd]: captainbrosset (GitHub handle), "css.at-rules.media.forced-colors: maybe add a note about Apple devices?", *mdn/browser-compat-data* issue 27143, 25 June 2025 (issue page, read via fetch summary; the reporter tested on a MacBook). [github.com/mdn/browser-compat-data/issues/27143](https://github.com/mdn/browser-compat-data/issues/27143). Accessed 2026-09-25.
[^mdncontrast]: MDN, "prefers-contrast" media feature (docs page, read via fetch summary). [developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-contrast](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-contrast). Accessed 2026-09-25.
[^primer]: GitHub, *Primer primitives* 11.10.0, MIT (`package.json` licence field), `src/tokens/component/diffBlob.json5` and built themes `dist/css/functional/themes/*.css` (source, values extracted by script). [github.com/primer/primitives](https://github.com/primer/primitives). Accessed 2026-09-25.
[^ghcb]: GitHub, "Protanopia & Deuteranopia Colorblind Themes Beta", *GitHub Changelog*, 19 April 2022 (docs page, read via fetch summary; it says the earlier single colour-blind theme was split into Protanopia & Deuteranopia and Tritanopia). [github.blog/changelog/2022-04-19-protanopia-deuteranopia-colorblind-themes-beta](https://github.blog/changelog/2022-04-19-protanopia-deuteranopia-colorblind-themes-beta/). Accessed 2026-09-25.
[^vscode]: Microsoft, *Visual Studio Code*, MIT (`LICENSE.txt`), `extensions/theme-defaults/themes/{dark_vs,light_vs,2026-dark,2026-light}.json` and `src/vs/platform/theme/common/colors/editorColors.ts` (source). [github.com/microsoft/vscode](https://github.com/microsoft/vscode). Accessed 2026-09-25.
[^machado]: Gustavo M. Machado, Manuel M. Oliveira and Leandro A. F. Fernandes, "A Physiologically-based Model for Simulation of Color Vision Deficiency", *IEEE Transactions on Visualization and Computer Graphics* 15(6):1291-1298, 2009 (paper PDF read by the skeptic pass; matrices confirmed against the authors' page at inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation; the paper does not model tritanopia). [doi.org/10.1109/TVCG.2009.113](https://doi.org/10.1109/TVCG.2009.113). Accessed 2026-09-25.
[^colour]: Colour Developers, *colour-science*, BSD-3-Clause (file header), `colour/blindness/datasets/machado2010.py` (source; severity-1.0 matrices for protanomaly, deuteranomaly and tritanomaly, equal to the authors' published values; its docstring cites Machado's 2010 thesis). [github.com/colour-science/colour](https://github.com/colour-science/colour/blob/develop/colour/blindness/datasets/machado2010.py). Accessed 2026-09-25.
[^oklab]: Björn Ottosson, "A perceptual color space for image processing", 23 December 2020 (blog post; M1 and M2 matrices, public domain or MIT, read via fetch summary). [bottosson.github.io/posts/oklab](https://bottosson.github.io/posts/oklab/). Accessed 2026-09-25.
[^cud]: Masataka Okabe and Kei Ito, "Color Universal Design (CUD): How to make figures and presentations that are friendly to colorblind people", 2002, modified 2008 (docs page, read via fetch summary). [jfly.uni-koeln.de/color](https://jfly.uni-koeln.de/color/). Accessed 2026-09-25.
[^ghalert]: GitHub, "Basic writing and formatting syntax", section Alerts, *GitHub Docs* (docs page, read via fetch summary). [docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax). Accessed 2026-09-25.
[^roselli]: Adrian Roselli, "Tweaking Text Level Styles", 2017, with a 2024 update (practitioner testing, read via fetch summary). [adrianroselli.com/2017/12/tweaking-text-level-styles.html](https://adrianroselli.com/2017/12/tweaking-text-level-styles.html). Accessed 2026-09-25.
[^aria]: W3C, *Accessible Rich Internet Applications (WAI-ARIA) 1.2*, roles `log`, `insertion`, `deletion` (spec, read via fetch summary; the summary truncated the implicit `aria-live` value, which I do not cite). [w3.org/TR/wai-aria-1.2](https://www.w3.org/TR/wai-aria-1.2/#log). Accessed 2026-09-25.
[^apg]: W3C, "Disclosure (Show/Hide) Pattern", *ARIA Authoring Practices Guide* (docs page, read via fetch summary). [w3.org/WAI/ARIA/apg/patterns/disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/). Accessed 2026-09-25.
[^csscolor]: W3C, *CSS Color Module Level 4*, gamut-mapping section, one JND as an OkLCh difference of 0.02 (spec text, grep of the fetched page). [w3.org/TR/css-color-4](https://www.w3.org/TR/css-color-4/). Accessed 2026-09-26.
