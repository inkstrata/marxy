<!-- Generated from source/10-spec.md by source/to-gfm.mjs; edit the source, then run the script. -->

# Reader Typography Spec

*The recommendations of the whole handbook, stated as a specification. It gives each default, the range readers may change it within, the rules that couple settings together, the overrides by content type and script, the decisions behind the choices, and the tests that verify an implementation. Each line links to the chapter that argues for it.*

Evidence grades: **[A]** replicated findings or a meta-analysis · **[B]** one well-designed study · **[C]** small, limited or mixed studies · **[D]** expert convention without a direct test · **[X]** contested or contradicted. Part of the [Reader Typography Handbook](README.md).

## Defaults and ranges

For Latin-script body text in a reflowable book. Values are CSS equivalents; native implementations should match them in visual angle.

| Setting | Default | User range | Grade | Why (chapter) |
|---|---|---|---|---|
| Text face | Literata (serif); Atkinson Hyperlegible Next offered as sans | Any bundled or installed face | **[D]** | Designed for screen reading, full features, no RFN ([Fonts](03-fonts.md)) |
| Size | 18px phone, 19px tablet, 20px desktop (in `rem`) | 75–250%, and further for low vision | **[A]** for the floor | x-height at or above about 0.2° ([Evidence](02-evidence.md)) |
| Size across faces | Match x-heights, not point sizes | Automatic | **[D]** | x-heights differ by up to a third ([Fonts](03-fonts.md)) |
| Measure | 66 average characters | 45–80, bounded by the screen | **[C]** | Preference and one comprehension result; no speed optimum ([Spacing](04-spacing-layout.md)) |
| Measure unit | Characters × measured average character width | Automatic | Measured | `ch` gives 75–104 characters for "66ch" ([Fonts](03-fonts.md)) |
| Line height | 1.5, unitless | 1.3–2.0 | **[C]**/**[D]** | Floor near 1.2–1.5; WCAG AAA; matches reading systems ([Spacing](04-spacing-layout.md)) |
| Paragraphs | The book's own style; else 1em indent (books) or 0.75em space (articles) | Indent 0–3rem, spacing 0–2rem, never both | **[D]** | Book convention ([Content types](07-content-types.md)) |
| Letter spacing | Font default (0) | 0–0.5rem; rises with word spacing | **[A]** that default is best for most | Spacing helps only some readers, and only with word spacing ([Evidence](02-evidence.md)) |
| Word spacing | Font default (0) | 0–1rem | as above | WCAG 1.4.12 requires tolerance of 0.16em |
| Alignment | Ragged right, hyphenated | Justified (total-fit breaking) where the measure is at least 45 characters | **[X]** for justification | Greedy justification makes loose lines; no algorithm fixes narrow columns ([Line breaking](05-line-breaking.md)) |
| Hyphenation | On for body text in languages with patterns | On or off | **[D]** | Needed for good justification, helps ragged text at narrow widths |
| Theme | Follow the system; dark and light offered | Dark, light, plus high contrast | **[A]** for the legibility difference | Dark on light is slightly more legible; comfort and low vision favour choice ([Color & access](09-color-access.md)) |
| Dark-theme weight | About 5% lighter than light theme (or a lower grade) | Automatic | **[D]** | Light strokes on dark look heavier |
| Contrast | Body text 7:1 or better in both themes | High-contrast theme | WCAG | AA minimum 4.5:1; aim for AAA |
| Page model | Paged for books, scrolling for articles and docs | Either | **[C]** | Small lean toward paging for deep reading ([Spacing](04-spacing-layout.md)) |
| Notes | Pop-up (paged) or margin notes (wide screens) | Also endnotes | **[D]** | Keep notes near their reference ([Content types](07-content-types.md)) |
| Code | Monospace, no ligatures, highlighted at import, scrolls in its own container | Wrap on or off, tab width | **[C]** for highlighting | ([Code](06-code.md)) |

## Coupling rules

The settings are not independent, so the reader must enforce these relationships.

1. **The measure follows the face and size.** When size or face changes, recompute the column width from the face's average character width, so the character count holds. Clamp to the screen with the minimum gutters.
2. **Justification needs width.** If the computed measure falls below 45 characters, set ragged right, whatever the setting says, and tell the user why in the settings panel.
3. **Letter spacing drags word spacing.** When the user raises letter spacing, raise word spacing by at least the same number of ems.
4. **Leading has script floors.** Multiply the user's line height by the script factor (1.17 for CJK, 1.1 for Devanagari and Hebrew with points, 1.07 for Thai and several Indic scripts, following Readium), and never go below 1.5 for CJK.
5. **Script rules override user spacing.** Letter spacing is never applied to cursive or Indic scripts. Justification is never applied to Thai in a browser engine. CJK is always justified inter-character, or at least never ragged by default.
6. **Genre overrides user spacing where meaning is at stake.** In verse, code, math and tables, only size and face apply (chapter 7).
7. **Dark theme implies generous size.** The legibility cost of light-on-dark grows as text shrinks, so do not ship a dark default with small text.

## Overrides by content type

| Content | Alignment | Hyphenation | Paragraphs | Spacing controls apply | Other |
|---|---|---|---|---|---|
| Fiction | Default | Default | Indent | All | Preserve italics and scene breaks |
| Non-fiction | Default | Default | Book's own | All | Margin or pop-up notes |
| Documentation | Ragged | Prose only | Space | Prose only | Code verbatim; admonitions by label, not colour |
| Poetry | As authored | Never | Stanza space | Size, face | Hanging indent for turnovers; keep stanzas across pages |
| Drama | Ragged | Speeches only | Speaker labels | Size, face | Small-capital speaker names |
| Code | Never altered | Never | – | Size, face | Scroll; no ligatures; focusable |
| Math | As authored | Never | – | Size | Font with a MATH table |
| Tables | By column | Never in numbers | – | Size | Tabular lining figures; scroll container |

## Overrides by script

From [Multilingual Text Layout](08-multilingual.md):

| Script | Line height floor | Justification | Hyphenation | Letter spacing | Other |
|---|---|---|---|---|---|
| Japanese, Chinese | 1.5–2.0 | Inter-character; compress punctuation | Western words only | Never | Vertical writing and right-to-left pages when the book says so; ruby; emphasis marks |
| Korean | 1.5+ | Even spacing | None | Never | `word-break: keep-all` if the book is eojeol-broken |
| Arabic, Persian | 1.6+ | Inter-word only (no kashida in engines) | None | Never | Right to left; no styling inside words |
| Urdu | 2.0+ | As Arabic | None | Never | Nastaʿlīq font named explicitly |
| Hebrew | 1.5+ (more with points) | Inter-word | Rare | Allowed (emphasis) | Right to left |
| Devanagari, other Indic | 1.6+ | Inter-word | Syllable-based where available | Never | Tall metrics; do not clip |
| Thai, Lao, Khmer | 1.6+ | Leave ragged in browsers | None | Never | Dictionary segmentation; zero-width spaces if present |

## Decisions

Short records of the choices that were not obvious, in the style of architecture decision records.

### Default face: Literata
**Context.** A reader needs one text face that is comfortable at length, fully featured, broadly multilingual and legally bundleable.
**Decision.** Literata, with Atkinson Hyperlegible Next as the offered sans, and a system-font option.
**Consequences.** No Reserved Font Name, so it can be subset freely. Latin, Greek and Cyrillic are covered; other scripts fall back to Noto. The project has been dormant since 2023, so fixes are the app's responsibility.

### Measure from average character width
**Context.** The obvious CSS (`max-width: 66ch`) overshoots by 14 to 58 per cent depending on the face.
**Decision.** Store each face's measured average character width and compute the column from it, recomputing on size changes, because optical sizes change widths.
**Consequences.** Needs one measurement per face and optical-size range. The live colophon in these pages shows the result.

### Ragged right by default, total-fit justification as an option
**Context.** Justified text is traditional for books. Browsers justify greedily, which leaves loose lines, and no reader study shows justification helps.
**Decision.** Default to ragged right with hyphenation. Offer justification, implemented with a total-fit line breaker with TeX-like costs and emergency stretch, only where the measure is at least 45 characters.
**Consequences.** Requires breaking lines in script (or natively) and caching per paragraph. Kindle and Foliate default to justified, so some readers will expect it, and the setting is one tap away.

### Offer both themes; dark weight lighter
**Context.** Dark text on light is slightly more legible, most of all in dark rooms, while many readers prefer dark themes and some low-vision readers read faster with them.
**Decision.** Follow the system theme by default. Design both themes to the same contrast standard, and lighten text weight on dark.
**Consequences.** Two palettes to audit, and variable fonts or two weights to ship.

### Fonts self-hosted from upstream, all features kept
**Context.** Fonts served by the Google Fonts API lack small caps, old-style figures and other features because of default subsetting.
**Decision.** Bundle upstream releases. Subset only with all layout features kept, and rename any font with a Reserved Font Name that is subset.
**Consequences.** Larger downloads for CJK, handled by per-language on-demand packs.

### Highlight code at import, with an audited theme
**Context.** Most popular themes fail contrast; highlighting's measured benefit is small; auto-detection guesses wrong.
**Decision.** Highlight known languages once at import with TextMate grammars. Use a restrained theme that passes 4.5:1 for every token in both modes. Show plain monospace for unknown languages.
**Consequences.** Import-time cost. Themes need a contrast audit before shipping.

### No dyslexia-font claims
**Context.** Dyslexia fonts do not work, according to a 2026 meta-analysis. Spacing helps some readers.
**Decision.** Offer spacing controls prominently. Offer any requested font without claims. Do not market typography as a dyslexia treatment.

## A token sketch

A starting point for implementation in CSS custom properties, matching the defaults above.

```css
:root {
  --text-face: "Literata", "Literata Fallback", serif;
  --avg-char-em: 0.46;          /* measured per face; see chapter 3 */
  --measure-chars: 66;
  --measure: calc(var(--measure-chars) * var(--avg-char-em) * 1em);
  --text-size: 1.125rem;        /* 18px at default settings */
  --leading: 1.5;
  --para-indent: 1em;           /* or 0 when --para-space is set */
  --para-space: 0;
  --letter-space: 0;
  --word-space: 0;
  --text-weight: 400;
}
@media (min-width: 48em) { :root { --text-size: 1.1875rem; } }
@media (min-width: 72em) { :root { --text-size: 1.25rem; } }

[data-theme="dark"] { --text-weight: 380; }

.reading {
  font-family: var(--text-face);
  font-size: var(--text-size);
  font-weight: var(--text-weight);
  line-height: var(--leading);
  max-width: var(--measure);
  letter-spacing: var(--letter-space);
  word-spacing: calc(var(--word-space) + var(--letter-space));
  hyphens: auto;
  text-wrap: pretty;
  font-optical-sizing: auto;
  font-kerning: normal;
}
.reading p + p { text-indent: var(--para-indent); margin-top: var(--para-space); }
.reading :is(pre, code, math, table, .verse) { letter-spacing: 0; word-spacing: 0; hyphens: manual; }
.reading :lang(ar, fa, ur, hi, mr, ne, bn, th) { letter-spacing: 0; }
```

## Verification

A typography implementation can be tested mechanically far more than most teams do. These checks follow from the chapters and should run in continuous integration.

**Contrast.** Compute WCAG contrast for every text colour against every surface it appears on, in both themes: body, secondary, links, code tokens (including against line-highlight and selection backgrounds), and control borders at 3:1. Fail below the threshold; do not round.

**Text spacing (WCAG 1.4.12).** Apply the four overrides (line height 1.5, paragraph spacing 2em, letter spacing 0.12em, word spacing 0.16em) with a user stylesheet. Assert that no text is clipped or overlaps.

**Zoom and reflow.**
- Render at 320 CSS pixels wide and at 200 and 400 per cent zoom.
- Assert no horizontal page scrolling except inside code and table containers.
- Assert text reaches 200 per cent of its default size.

**Measure.** Render a long paragraph per face and size, count characters per line from client rectangles (skipping zero-width rectangles at hyphenated breaks), and assert the average is within 10 per cent of the target.

**Font integrity.** For each bundled face, probe the features you rely on (small caps, old-style and tabular figures) by width comparison, and assert they respond. Check the licence files ship.

**Hyphenation.** Probe that `hyphens: auto` actually hyphenates in each supported engine and language: a long word in a narrow box, heights compared against `hyphens: manual`. Fall back to bundled patterns where it does not.

**Line breaking.** For the justified path, run the chapter 5 comparison on a fixed corpus. Assert the mean adjustment ratio, the count of very loose lines and the hyphen count stay within their baselines. Assert breaks are identical across platforms, so that deterministic pagination can rely on them.

**Pagination.** Assert that the same settings always yield the same page count and page starts, and that no heading ends a page.

**Forced colours and reduced motion.** Render under `forced-colors: active` and assert that meaning survives (links, highlights, diffs). Assert that page-turn animations honour `prefers-reduced-motion`.

**Keyboard.** Tab through a chapter. Every scrolling region and every control is reachable with a visible focus ring.

## Testing with readers

When you change a default, test it with readers the way chapter 2 describes:

- measure reading speed *and* comprehension on passages long enough to matter;
- counterbalance order;
- report preference separately from performance;
- report letter sizes as visual angles;
- change one variable at a time.

Expect small effects. Most typographic changes that designers can see do not move reading speed measurably, and a test that finds a large effect deserves suspicion before celebration.
