<!-- Generated from source/06-code.md by source/to-gfm.mjs; edit the source, then run the script. -->

# Code and Syntax Highlighting

*Code is the one kind of text a reader must never reflow, justify, hyphenate or "improve", and the one kind most readers colour. This chapter covers how highlighting engines work and which to embed, what the research says about colour in code (less than its popularity suggests), how to design a theme that meets contrast requirements (most popular themes do not), and the typography of code blocks.*

Evidence grades: **[A]** replicated findings or a meta-analysis · **[B]** one well-designed study · **[C]** small, limited or mixed studies · **[D]** expert convention without a direct test · **[X]** contested or contradicted. Part of the [Reader Typography Handbook](README.md).

## Code is verbatim text

Every rule in this chapter follows from one fact: in code, every character and every space can carry meaning. Python and YAML use indentation as syntax. Makefiles distinguish tabs from spaces. A string literal's spaces are data. So a reader must:

- **preserve whitespace exactly** (`white-space: pre`, or `pre-wrap` if wrapping is allowed);
- **never justify, hyphenate or apply `text-wrap: pretty` or `balance`** to code;
- **never apply the user's letter- or word-spacing settings** to code. Word spacing widens every space and breaks space-based alignment;
- **never substitute characters.** No smart quotes in code, and no ligatures that change what is copied;
- **keep the copied text identical to the source.** Line numbers, prompts and gutters must stay out of the selection.

The block below is set the way this chapter recommends. Comments stay readable rather than dimmed, and definitions carry weight as well as colour. Every token meets the contrast minimum in both themes, and the block scrolls instead of wrapping, with keyboard focus so it can be scrolled without a mouse.

```python
def adjustment_ratio(natural, stretch, shrink, width):
    """How hard a line's spaces must work to fill the measure (Knuth & Plass, 1981)."""
    if natural < width:
        return (width - natural) / stretch if stretch > 0 else float("inf")
    if natural > width:
        return (width - natural) / shrink if shrink > 0 else float("-inf")
    return 0.0  # a perfect fit: spaces at their natural width
```

## How highlighting engines work

There are four families of highlighter, and the choice between them is a choice about accuracy, speed and size.

**Regular-expression lexers** match patterns line by line. highlight.js, Prism, Pygments, Rouge and Chroma work this way. They are small and fast and cover hundreds of languages, but they cannot understand structure, so nested or context-dependent syntax (template literals, heredocs, embedded languages) is often coloured wrongly.

**TextMate grammars** are also regex-based but keep a stack of rules across lines, which handles nesting and embedded languages far better. VS Code's tokenizer uses them, and so do GitHub's highlighter, Shiki, Starry Night and, since early 2026, Zola's new Giallo engine.[^tm] Their weakness is the grammar ecosystem itself: VS Code's own release notes say many of its TextMate grammars are no longer maintained, which is why it began piloting tree-sitter.[^vscode-ts]

**Parsers** build a syntax tree and colour its nodes. Tree-sitter parses incrementally, is robust to errors, and highlights through query files (`highlights.scm`, `locals.scm`, `injections.scm`). Neovim, Helix, Zed and Emacs use it, and GitHub uses it for "several" languages alongside TextMate grammars.[^treesitter] CodeMirror 6's Lezer is a similar incremental parser for the browser.

**Semantic tokens** come from a language server that knows what each identifier is: a parameter, a constant, a deprecated method. They were standardized in version 3.16 of the Language Server Protocol and layer on top of lexical highlighting.[^lsp] A reader has no language server, so semantic highlighting is out of reach. Static readers are limited to the first three families.

### Choosing one for a reader

| Engine | Mechanism | Coverage | Size and output | Notes |
|---|---|---|---|---|
| Shiki 4 | TextMate grammars; Oniguruma WASM or a JavaScript regex engine | 242 languages (full bundle), 65 themes | Full bundle 1.2 MB gzipped; web bundle 695 KB; fine-grained imports; HTML with inline styles, CSS variables for dual themes | Same results as VS Code; used by Astro, VitePress, Starlight |
| Starry Night 3 | GitHub's TextMate grammars | "600+" | 185 KB core gzipped plus grammars; outputs hast with GitHub classes | Ships colour-blind and high-contrast themes |
| highlight.js 11 | Regex modes with language auto-detection | 193 core languages | Small; HTML with `hljs-` classes | Auto-detection is its distinctive feature (mdBook turns it off) |
| Prism 1.30 | Regex grammars | 297 languages | Small; `token` classes | Version 2 is in alpha (September 2026); version 1 accepts only security fixes |
| Pygments 2.21 | Regex state machines | about 600 lexers | Server-side (Python) | Standard for Sphinx and MkDocs |
| tree-sitter 0.27 | Incremental parser plus queries | hundreds of community grammars of mixed quality | One WASM file per language in the browser | Best accuracy for supported languages; heavier to ship |
| Lezer / CodeMirror 6 | Incremental LR parser | about 25 native languages plus legacy modes | Modular | Good fit for editable or very long code |

> **Recommendation.** Highlight at import time, not on every render: a reader's books do not change. Use Shiki (or Starry Night for GitHub parity) to convert code blocks to styled spans once, store the result, and render from it. Themes then come from CSS variables, so switching light and dark costs nothing. Fall back to plain monospace, never to guessed highlighting, when a block's language is unknown. Auto-detection is wrong often enough to be worse than no colour.

## What the research says about colour in code

Syntax highlighting is nearly universal, and the evidence for it is thin.

| Study | Participants | Task | Result | Grade |
|---|---|---|---|---|
| Sarkar 2015 | 10 graduate students, within-subjects | Mentally executing short Python functions | Faster with highlighting (median 8.4 s), fewer eye movements between code and answer; the advantage shrank with experience | **[C]** |
| Hakala, Nykyri and Sajaniemi 2006 | 16 students analysed | Visual search in Java | No significant effect of colour scheme; a strong learning effect confounds the comparison | **[C]** |
| Beelders and du Plessis 2016 | 34 students, between-subjects | Predicting C# output, eye tracking | No significant differences in fixations or regressions; colour rated easier and more pleasant | **[C]** |
| Hannebauer, Hesenius and Gruhn 2018 | 390 undergraduates | Comprehension tasks in Java | No evidence that highlighting improves novices' comprehension | **[B]** |

The largest study found no effect on correctness.[^hannebauer] The positive results are speed effects in small samples that fade with experience.[^sarkar] No study found for this handbook compares proportional with monospaced code, tests programming ligatures, or compares dimmed with emphasized comments. Advice on those is convention **[D]**. Related work on code layout is contested: the classic finding that 2 to 4 spaces of indentation aid comprehension did not replicate in 2019, and camelCase versus underscore studies disagree.[^layout] **[X]**

The honest conclusion: readers like highlighting, it may speed up reading of short code a little, and it does not measurably improve understanding. That argues for restrained highlighting done accessibly, not for elaborate schemes.

## Designing a code theme

### Fewer colours, reliably applied

Theme design has two schools. The dominant one, codified in the Base16 framework's 16 roles, colours every token class: keywords, strings, numbers, functions, types, variables, operators.[^base16] A minimalist school, argued most forcefully by Nikita Prokopov in 2025 and embodied in his Alabaster theme, colours only what readers look for. That means strings, constants, comments and top-level definitions. It leaves keywords, calls and variables (about three-quarters of code) in the default colour, because "if everything is highlighted, nothing stands out".[^tonsky] Prokopov cites no studies **[D]**, but his argument fits the research: if colour does little for comprehension, its main job is navigation, and navigation needs a few salient landmarks, not a rainbow.

**Comments** are the sharpest disagreement. Most themes dim them (Base16 assigns comments to the same slot as the line highlight), on the theory that code matters more than commentary. The minimalists emphasize them, on the theory that a comment is the author telling you something important. Nord's official VS Code port brightened its comments after user complaints.[^nord] Whichever you choose, comments are text and must meet contrast requirements, and that is where most themes fail.

### Most popular themes fail contrast requirements

WCAG's contrast minimum applies to all text, with exceptions only for incidental text and logos. Nothing exempts syntax tokens, so every token colour must reach 4.5:1 against the code background.[^wcag143] Using the exact colours from each theme's official source files, as collected for this handbook, the contrast of each token class was computed against the theme's background. Each value below is drawn in the token's own colour on the theme's background.

| Theme | Mode | Text | Comment | String | Keyword | Function | Number | Type |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| GitHub Light Default | light | 15.80 | 4.55 | 12.81 | 5.36 | 5.05 | 7.59 | 7.39 |
| GitHub Dark Default | dark | 16.02 | 6.15 | 12.31 | 7.51 | 9.72 | 9.73 | 9.77 |
| Solarized Dark | dark | 4.75 | **2.79** ✗ | 4.75 | 4.69 | **4.08** ✗ | 4.75 | 4.68 |
| Solarized Light | light | **4.13** ✗ | **2.48** ✗ | **2.93** ✗ | **2.97** ✗ | **3.41** ✗ | **2.93** ✗ | **2.98** ✗ |
| One Dark | dark | 6.57 | **2.32** ✗ | 6.94 | 4.75 | 5.92 | 5.68 | 8.10 |
| Monokai (original) | dark | 13.94 | **3.03** ✗ | 10.44 | **3.93** ✗ | 9.58 | 5.23 | 9.01 |
| Dracula | dark | 13.36 | **3.03** ✗ | 12.74 | 5.97 | 10.38 | 8.36 | 10.29 |
| Nord (VS Code port) | dark | 9.25 | **2.43** ✗ | 6.13 | 4.64 | 6.24 | **4.41** ✗ | 5.99 |
| Gruvbox Dark (medium) | dark | 10.75 | **4.02** ✗ | 7.14 | **4.29** ✗ | 7.14 | 5.37 | 8.69 |
| Gruvbox Light (medium) | light | 10.22 | **3.24** ✗ | **4.29** ✗ | 7.60 | **4.29** ✗ | 5.94 | **3.33** ✗ |
| Tomorrow | light | 8.46 | **3.22** ✗ | **3.85** ✗ | 5.17 | 4.99 | **2.51** ✗ | **2.51** ✗ |
| Tomorrow Night | dark | 9.80 | 5.69 | 8.22 | 6.18 | 6.18 | 6.65 | 10.26 |
| Catppuccin Latte | light | 7.06 | **3.49** ✗ | **2.96** ✗ | 4.79 | **4.34** ✗ | **2.64** ✗ | **2.31** ✗ |
| Catppuccin Mocha | dark | 11.34 | 5.81 | 11.03 | 8.07 | 7.79 | 9.27 | 12.91 |
| Tokyo Night | dark | 8.10 | **2.50** ✗ | 9.35 | 7.39 | 6.79 | 8.40 | 7.27 |
| VS Code Dark Modern | dark | 10.26 | 4.95 | 6.24 | 5.59 | 11.66 | 9.70 | 8.09 |
| VS Code Light Modern | light | 11.20 | 5.14 | 7.85 | 8.59 | 6.10 | 4.60 | 4.59 |
| Alabaster (light) | light | 19.60 | 5.94 | **3.90** ✗ | 19.60 | 5.72 | 6.53 | 5.72 |
| This handbook, dark | dark | 13.59 | 8.31 | 11.61 | 9.88 | 9.51 | 11.07 | 9.51 |
| This handbook, light | light | 15.64 | 5.96 | 6.24 | 6.83 | 6.62 | 6.24 | 6.62 |

A bold ratio marked ✗ is below WCAG AA (4.5:1).

Of the 18 published themes measured, 12 have at least one token class below the WCAG AA minimum, and in 11 of them it is the comments. Light themes fare worse: Solarized Light fails even for its body text (4.13:1), and Tomorrow and Catppuccin Latte put constants and types near 2.5:1. The themes that pass everything are GitHub's defaults, which VS Code's 2026 default themes also use, Tomorrow Night, Catppuccin Mocha and VS Code's Modern themes. This handbook's own code colours were designed to pass: every token class reaches at least 8.3:1 in the dark theme and 5.9:1 in the light one.

> **Trap.** Solarized's design uses deliberately reduced contrast, and its reputation rests on that restraint. Its documentation describes lightness relationships designed in CIELAB so that light and dark modes keep the same perceived contrast.[^solarized] That goal and WCAG's minimum are simply incompatible for its comment colour. If a reader offers popular themes by name, audit them first, and adjust failing colours (usually by lightening comments on dark grounds and darkening accents on light ones) rather than shipping them as published.

### Colour vision and non-colour cues

About one man in twelve has a colour-vision deficiency, most often red-green.[^nei] Two rules follow, from WCAG's use-of-colour criterion and from Okabe and Ito's Color Universal Design guidance:[^cud]

- colour must never be the only carrier of meaning;
- adjacent categories should differ in lightness, not just hue.

For highlighting, that means diffs keep their + and − markers and do not rely on red and green, and error spans get an underline, not just a colour. Distinguishing comments by italic as well as colour, as many themes do, is a useful second cue. Build palettes in OKLCH, which makes lightness an explicit, perceptually meaningful coordinate. Then *vary* lightness between categories deliberately rather than equalizing it, because the eye discriminates lightness better than hue.[^oklab]

### Themes and the reader's theme

The code theme must follow the reader's theme. Store highlighted tokens as classes or CSS variables, and let the theme define the colours. Under Windows forced-colours mode, syntax colours are replaced by system colours. That is correct behaviour, and it is one more reason nothing may depend on colour alone.[^forced]

## Typography of code

### The monospace face

Monospace remains the norm for code because alignment, column limits and tabular constructs depend on it. No empirical study comparing monospaced with proportional code was found **[D]**. Choose a face that distinguishes the classic confusables: 0 and O, 1, l and I, and rn from m. Chapter 3's shortlist covers the candidates (JetBrains Mono, Source Code Pro, Intel One Mono, Atkinson Hyperlegible Mono, Cascadia).

**Ligatures.** Butterick's argument against programming ligatures is that code characters carry exact meanings. A `!=` rendered as ≠ is indistinguishable from the real character U+2260, and context-blind substitution is guaranteed to be wrong somewhere, for instance inside strings and regular expressions.[^butterick-lig] Fira Code's counter-argument is that ligatures are only rendering and the underlying text is unchanged. Both are opinions **[D]**. For a reader, whose users are reading other people's code, the conservative choice is right: ligatures off by default. Font makers agree enough to ship ligature-free versions (Cascadia Mono, JetBrains Mono NL), and VS Code ships with ligatures off.

### Size and the monospace quirk

Browsers keep a separate, smaller default size for monospace text (13px against 16px), and apply it only when the font family is exactly the single generic `monospace`, which is what the HTML user-agent stylesheet gives `<code>` and `<pre>`. Neither CSS nor HTML specifies this, but all three engines do it.[^quirk] Naming any specific face (`"JetBrains Mono", monospace`), or even `monospace, monospace`, restores the inherited size. Beyond that, monospace faces tend to look larger than the surrounding text at equal size, because of their wide characters and x-heights that are mostly 0.49 to 0.55 em and reach 0.62 (chapter 3's table). Set inline code at about 0.85 to 0.9 em of the text around it, or normalize with `font-size-adjust`.

### Line length, tabs and line height

Code has its own line-length conventions, set by style guides rather than typography:

- PEP 8: 79 characters.
- Black: 88.
- Google's Java style: 100.
- Google's C++, Python and JavaScript styles: 80.
- rustfmt: 100.
- The Linux kernel prefers 80 but moved checkpatch's warning to 100 in 2020.[^codelen]

A reader should display code at its authored width, which means a code block often needs to be wider than the prose measure. Let code blocks extend into the margin on wide screens (these pages do) and scroll on narrow ones.

Tabs default to 8 columns in CSS (`tab-size`). Many codebases assume 4, so expose it as a setting and respect any `.editorconfig`-style hint the source carries.

Code needs more leading than prose at the same size, because monospace lines are dense and indentation creates ragged vertical edges. VS Code's default works out to 1.5 times the font size on macOS and 1.35 elsewhere; 1.5 to 1.6 is a good range for reading.

### Wrap or scroll?

On a phone, long code lines must either scroll horizontally or wrap. Both have costs.

- **Scrolling** preserves structure and is what WCAG's reflow guidance permits for content whose meaning depends on indentation and unbroken lines. Its Understanding document discusses code under content that benefits from two-dimensional layout, shows a passing example of code scrolling within its own container, and points to technique G224, which suggests reducing indentation at narrow widths.[^reflow]
- **Wrapping** keeps everything in view but can mislead: a wrapped Python line looks like two statements. If you wrap, indent continuation lines past the original indentation (VS Code's `wrappingIndent` offers "same", "indent" and "deepIndent"), and mark them with a gutter symbol.

Default to scrolling, offer wrapping as a user choice, and never wrap indentation-sensitive languages silently.

### Accessibility of code blocks

- **Keyboard access.** A horizontally scrolling `<pre>` with no focusable content cannot be scrolled from the keyboard in Safari. axe-core flags this as a serious violation. Chrome made such regions focusable by default only in version 132.[^axe] Give every scrolling code block `tabindex="0"`, an accessible name and a visible focus style. These pages do.
- **Contrast** applies to every token (above).
- **Screen readers** read highlighted code token by token as spans. No authoritative source was found on how much this fragments navigation, so test with VoiceOver and NVDA rather than assuming.
- **Copying.** Keep line numbers outside the copyable text (a separate column, or generated content), keep the source characters intact under any ligatures, and offer a copy button that copies the original source, not the rendered DOM.

[^tm]: VS Code, "Syntax Highlight Guide"; GitHub Linguist, CONTRIBUTING.md; Shiki guide; Zola changelog 0.22.0 (January 2026). [code.visualstudio.com/api/language-extensions/syntax-highlight-guide](https://code.visualstudio.com/api/language-extensions/syntax-highlight-guide).
[^vscode-ts]: VS Code release notes 1.97 ("Tree-Sitter based syntax highlighting for typescript") and 1.99. [github.com/microsoft/vscode-docs](https://github.com/microsoft/vscode-docs).
[^treesitter]: Tree-sitter documentation, "Syntax Highlighting" (including the statement that it is used on GitHub.com for several languages). [tree-sitter.github.io](https://tree-sitter.github.io/tree-sitter/3-syntax-highlighting.html).
[^lsp]: Language Server Protocol specification 3.17, `textDocument/semanticTokens` (since 3.16). [microsoft.github.io/language-server-protocol](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#textDocument_semanticTokens).
[^hannebauer]: Christoph Hannebauer, Marc Hesenius and Volker Gruhn, "Does syntax highlighting help programming novices?", *Empirical Software Engineering* 23(5):2795–2828, 2018. [doi.org/10.1007/s10664-017-9579-0](https://doi.org/10.1007/s10664-017-9579-0).
[^sarkar]: Advait Sarkar, "The impact of syntax colouring on program comprehension", PPIG 2015, pp. 49–58. [advait.org/files/sarkar_2015_syntax_colouring.pdf](https://advait.org/files/sarkar_2015_syntax_colouring.pdf). Also Hakala, Nykyri and Sajaniemi, PPIG 2006; Tanya Beelders and Jean-Pierre du Plessis, *Journal of Eye Movement Research* 9(1), 2016, [doi.org/10.16910/jemr.9.1.1](https://doi.org/10.16910/jemr.9.1.1).
[^layout]: Miara et al., *Communications of the ACM* 26(11), 1983; Bauer et al., ICPC 2019 (non-replication); Binkley et al., ICPC 2009; Sharif and Maletic, ICPC 2010.
[^base16]: Base16 styling guidelines (roles base00 to base0F), chriskempson/base16 and tinted-theming/home. [github.com/tinted-theming/home](https://github.com/tinted-theming/home).
[^tonsky]: Nikita Prokopov, "I am sorry, but everyone is getting syntax highlighting wrong", 15 October 2025 (opinion). [tonsky.me/blog/syntax-highlighting](https://tonsky.me/blog/syntax-highlighting/).
[^nord]: nordtheme/visual-studio-code changelog, version 0.8.0 (April 2019), comment colour brightened. [github.com/nordtheme/visual-studio-code](https://github.com/nordtheme/visual-studio-code).
[^wcag143]: W3C, WCAG 2.2, Success Criterion 1.4.3 Contrast (Minimum). [w3.org/TR/WCAG22](https://www.w3.org/TR/WCAG22/#contrast-minimum).
[^solarized]: Ethan Schoonover, Solarized README, sections on "selective contrast" and CIELAB lightness. [github.com/altercation/solarized](https://github.com/altercation/solarized).
[^nei]: US National Eye Institute, "Color Blindness" (updated November 2025). [nei.nih.gov](https://www.nei.nih.gov/learn-about-eye-health/eye-conditions-and-diseases/color-blindness).
[^cud]: Masataka Okabe and Kei Ito, *Color Universal Design* (2008). [jfly.uni-koeln.de/color](https://jfly.uni-koeln.de/color/). WCAG 2.2 Success Criterion 1.4.1 Use of Color.
[^oklab]: Björn Ottosson, "A perceptual color space for image processing", 23 December 2020, [bottosson.github.io/posts/oklab](https://bottosson.github.io/posts/oklab/); CSS Color Level 4, §9.4 `oklab()` and `oklch()`.
[^forced]: MDN, `forced-colors` media feature and `forced-color-adjust`; CSS Color Level 4 §6.2 system colours.
[^butterick-lig]: Matthew Butterick, "Ligatures in programming fonts: hell no", *Practical Typography*, 29 March 2019. [practicaltypography.com](https://practicaltypography.com/ligatures-in-programming-fonts-hell-no.html). Counterpoint: Fira Code README.
[^quirk]: MDN, `font-family`, "Monospace font size"; engine sources: Chromium `web_preferences.h` (`default_fixed_font_size = 13`), WebKit `UnifiedWebPreferences.yaml`, Firefox `all.js`; the rule applying only to a single generic family in Blink `font_description.h`, WebKit `FontCascadeDescription.h` and Servo `font.rs`.
[^codelen]: PEP 8; Black documentation, "Line length"; Google style guides; rustfmt `max_width`; Linux kernel commit bdc48fa11e46 (2020) and `coding-style.rst`.
[^reflow]: W3C, Understanding WCAG 2.2 Success Criterion 1.4.10 Reflow, and Technique G224 "Accounting for meaningful text indentation and Reflow". [w3.org/WAI/WCAG22/Understanding/reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html).
[^axe]: axe-core rule `scrollable-region-focusable` and Deque University documentation; Chrome, "Keyboard focusable scrollers" (Chrome 132). [dequeuniversity.com/rules/axe/4.11/scrollable-region-focusable](https://dequeuniversity.com/rules/axe/4.11/scrollable-region-focusable).
