# Code as read: typography against the grid

*This chapter settles how source code and snippets are set when they are read rather than edited: monospace metrics against Marxy's 15 px grid, what tabs mean, whether long lines wrap or scroll, when a block earns a line-number gutter and what copying does with it, how many hues a block may spend, and what inline code does to a Knuth–Plass paragraph. The sibling handbook's [Code](../reader-typography/06-code.md) chapter covered highlighting engines, theme contrast and ligatures; this one builds on it and goes where it did not. Most of the evidence is engineering fact or expert convention. Where a claim rests on measurement, the method is given so it can be repeated.*

Evidence grades: **[A]** replicated findings or a meta-analysis · **[B]** one well-designed study · **[C]** small, limited or mixed studies · **[D]** expert convention, or convergence of shipping tools, without a direct test · **[X]** contested or contradicted. Part of the [Reader Artifacts Handbook](README.md).

## Monospace metrics against the grid

### The numbers

Marxy sets body text in Literata at 20 px on a 30 px line, so the grid unit is 15 px (ADR-0030, ADR-0033). Code is JetBrains Mono at 18 px on its own 30 px line (`tokens.css` lines 11–14). From the sibling's measured metrics ([Fonts](../reader-typography/03-fonts.md), "Monospace"):

| Quantity | Value | Derivation |
| --- | ---: | --- |
| Literata x-height at 20 px | 10.14 px | 0.507 em × 20 |
| JetBrains Mono x-height at 18 px | 9.90 px | 0.550 em × 18 |
| Ratio | 97.6 % | inside design-language constraint 5's 3 % |
| Code leading, in em | 1.667 | 30 / 18 |
| Code leading, in x-heights | 3.03 | 30 / 9.90 |
| Prose leading, in x-heights | 2.96 | 30 / 10.14 |
| One code column (`1ch`) | 10.8 px | 0.600 em × 18 |
| Prose column | 611.2 px | 66 × 0.463 em × 20 |
| Code columns that fit in the prose column | 53.8 | (611.2 − 2 × 15 padding) / 10.8 |

The x-height match is well founded: size is the one typographic variable with replicated evidence behind it **[A]**, and x-height, not nominal size, sets effective size (sibling chapter 3). The 3 % tolerance is convention **[D]**. Note what 18 px also buys: an advance of exactly 10.8 px, so 100 columns are 1,080 px and every column count in this chapter is an integer multiple of a round number.

The number that matters to a reader at 18 px is that the prose column holds only 53 code columns. Of 126 non-empty code lines in the fixture corpus (from `packages/core/goldens/*.html.txt`), 40 (32 %) are wider than that, 22 (17 %) wider than 79 and 10 (8 %) wider than 100.

### Leading: 1.667 is the grid's number, and the evidence does not object

No study of line spacing for source code was found. The searches (line spacing and code readability; eye-tracking studies of code comprehension) returned studies of code layout in which spacing was a control, not a variable, and prose studies. That is a finding: code leading is set by convention **[D]**.

The conventions do not agree with each other. GitHub's design system sets code blocks at 13 px with its `normal` line-height token, which is 1.5, and lists 1.625 for text of 12–13 px.[^primer] VS Code computes its line height from the font size when the setting is 0.[^vscode] The sibling handbook puts VS Code's result at 1.5 on macOS and 1.35 elsewhere and recommends 1.5–1.6 for reading code ([Code](../reader-typography/06-code.md), "Line length, tabs and line height"). At 1.667 Marxy is above that range **[D]**.

The comparison is not like for like, but the correction runs the other way from a first reading. Leading is seen against the x-height, and JetBrains Mono's x-height is 0.550 em against Literata's 0.507. The sibling's 1.5–1.6 range is stated for *code* ("Code needs more leading than prose"), not for text faces. In the code face's own x-heights it is 1.5 / 0.550 = 2.73 to 1.6 / 0.550 = 2.91; Marxy's 3.03 is 4 % above the top of that range and 11 % above its bottom. (Dividing by Literata's 0.507 instead gives 2.96–3.16 and would put Marxy inside, but that measures code leading in the wrong face's x-height.) What survives: Marxy's code line is 2.4 % looser than its own prose in x-heights, so it is consistent with the page, and it sits above the sibling's range in both em and x-heights. No study says that is a problem **[D]**.

> **Default.** Code line box 30 px = 2 grid units, at 18 px (1.667 em, 3.03 x-heights; above the sibling's 1.5–1.6 in em and in the mono's own x-heights, see above). Do not move to 1.5 (27 px): it is off the grid; the evidence neither favours nor forbids it. Grade **[D]**; if the reader's size setting scales code, keep the line at a whole number of grid units.

### Inline code and the line box

Inline code is 0.9 em (18 px inside 20 px text, matching block code) with `line-height: 1` (`base.css` lines 173–176). The `line-height: 1` is load-bearing.

> **Measured.** Playwright 1.63.0, WebKit 26.6 (build 2359) and Chromium 153.0.8010.12, headless, macOS. A 611 px paragraph of Literata 20 px/30 px (weight 380) holding `<code>` in the repository's `JetBrainsMono[wght].ttf` at `font-size: 0.9em`. With the paragraph's 30 px line height inherited by the code the paragraph measured 32.2 px (WebKit) and 33 px (Chromium) tall for one line; with `line-height: 1` on the code, exactly 30 px in both, equal to a paragraph with no code. The extra 2–3 px comes from the mono face's ascent and descent sitting on a different baseline offset inside a line box of the same height; a document with a code span on every line would drift by 2–3 px per line without the rule. In Marxy's own stylesheet (`renderSafeHtml` output with `tokens.css` and `base.css`) a two-line paragraph with two code spans and one without measured 60 px in both engines.

A one-line rule that keeps two faces on one grid is correct and cheap. Nothing to change.

### Code in lists, quotations and tables

> **Measured.** Same harness, Marxy's own rendering of a fixture (markdown → `renderSafeHtml` → `tokens.css` + `base.css`) at a 1,280 px viewport, WebKit and Chromium agreeing to within a pixel. A fenced block at top level is 611.2 px wide (53 columns of code text); the same block inside a blockquote is 592.2 px (52 columns), 19 px narrower (the quote's 15 px of padding and 2 px rule account for 17; the other 2 px were not traced); inside a list item it is 611.2 px because the list adds no indent in this stylesheet. A two-line block is 90 px tall (2 × 30 + 30 padding), a four-line block 150: a `pre` is always 30 n + 30 px, a whole number of grid units, so `snapToGrid` has nothing to pad in normal cases. A table row is 60 px (30 px line + 2 × 15 px cell padding), two units. Table type is 18 px on the 30 px code line; a code span inside a cell is 0.9 × 18 = 16.2 px, keeping the 97.6 % x-height relation to its neighbours.

Nothing here breaks the grid. What the numbers show is a width cost: nesting code costs about two columns per level in a quotation, and a list costs none. That is small against the 32 % of corpus lines already wider than the prose column, and the room a block may take from the margin is computed against the window, not the container (`--marxy-room`, `base.css` line 43), so a nested block does not get the margin back.

> **Marxy today.** `tokens.css` lines 11–14 (sizes, 30 px code line); `base.css` lines 165–208 (`code`, `pre`, `.marxy-line`, `table`); `packages/typeset/src/grid.ts` (islands padded to whole units).

## Ligatures

The sibling settled the policy: off, because `!=` drawn as ≠ is a different character to the reader, though the bytes are unchanged ([Code](../reader-typography/06-code.md), "Ligatures"). This chapter confirms it holds in Marxy and adds what the sibling did not check.

**Confirmed off in Rendered mode.** `base.css` lines 167–168 set `font-variant-ligatures: none` and `font-feature-settings: "calt" 0, "liga" 0` on `code, kbd, pre`. VS Code's own default is the same pair (`"liga" off, "calt" off`, for `fontLigatures: false`).[^vscode] JetBrains Mono draws its programming ligatures through contextual alternates, which is why `calt` must be named.

> **Measured.** Same harness. With the bundled JetBrains Mono at 18 px and nothing turning ligatures off, both engines draw `!=` `->` `=>` `<=` `>=` as their combined glyphs; with `font-variant-ligatures: none` a screenshot of the same string differs (the typed characters are drawn). The advance width of the test string is identical either way (183.6 px, WebKit; 183.61 px, Chromium), so the ligatures are invisible to any width-based check and only pixels or a font-feature assertion reveal them. Assert on the computed style, not on layout.

**Gap: Source mode.** The CodeMirror view in Source mode (`apps/desktop/src/source/editor.ts` lines 52–79) adds no ligature rule of its own, and neither does the theme bridge (`source/theme-bridge.ts` sets font family, size and colours only). `base.css`'s rule is scoped to `code, kbd, pre`, and CodeMirror's `.cm-content` is none of those, and no other file in `packages/theme` or `apps/desktop` sets `font-variant-ligatures` or `calt`; so by reading the code the rule does not reach Source mode and JetBrains Mono's default `calt` ligatures are on there. This is inferred from the stylesheets, not measured in the running app. Source mode is where non-markdown files open, so a `!=` there would be drawn as ≠ in exactly the content the policy protects. A machine gate is cheap: assert `font-variant-ligatures: none` on `.cm-content`.

> **Default.** Ligatures off in Rendered and Source, `calt` and `liga` both named. Grade **[D]** (sibling; converged: VS Code, Cascadia Mono and JetBrains Mono NL all ship a no-ligature configuration).

> **Marxy today.** Rendered: applied (`base.css` lines 167–168). Source: not applied, by code reading (unmeasured in the app).

## Tabs

CSS `tab-size` has an initial value of 8, a number being a multiple of the advance of the space character.[^csstext] Marxy sets `tab-size: 4` on `pre` (`base.css` line 192), and `apps/desktop/src/render/highlight.ts` line 10 hard-codes `TAB = 4` to compute a line's leading whitespace for the hanging indent. CodeMirror's `EditorState` default tab size is 4 (measured with `@codemirror/state` 6.7.5; `source/` sets none). So a file indented with tabs is shown at 4 columns in both modes.

EditorConfig separates two facts that CSS conflates. `indent_style` says whether tabs or spaces are used; `indent_size` is the columns per level and the width of soft tabs; `tab_width` is the columns a tab character occupies and defaults to `indent_size`; if `indent_size` is `tab`, it takes the value of `tab_width`.[^ec] A repository that indents with tabs and says `indent_size = 2` therefore asks for tabs of two columns, and a reader honouring it would set `tab-size: 2`. Nothing in the Marxy source or docs reads an `.editorconfig`; a search for the string in `packages`, `apps` and `docs` outside this handbook found no use.

**What GitHub does.** GitHub renders tab-indented code at a viewer-chosen size: since September 2021 each account has a "Tab size preference" in Appearance settings,[^ghtab] and in July 2025 a global CSS update made the setting apply anywhere code is displayed, including README code blocks; it affects only tab characters.[^ghtab2] A 2021 discussion thread records GitHub staff pointing to that setting as the answer, and a commenter in March 2025 reported that `.editorconfig` did not seem to work per repository.[^gh4893] The 2021 changelog and docs page say nothing about a default size or about `.editorconfig`, so whether GitHub reads it is **not verified**; the reader-side preference is the documented mechanism. The 2021 thread also shows users already treating `.editorconfig` as a "hack" for tab width on GitHub (posts of August 2021), which suggests it once had an effect there, but no GitHub document confirms it, so nothing here relies on it.

**Evidence on indentation.** Miara and colleagues (1983) tested Pascal programs at several indentation levels and found 2–4 spaces best for comprehension; a 2019 non-exact replication with 22 participants (students) and Java found no indication that indentation level affected comprehension or visual effort, and could not replicate the earlier result (the replication's own abstract and introduction, read; Miara's paper itself was not reachable, so its details are second-hand through Bauer).[^bauer] Bauer's summary is that Miara found 2 spaces best and 0 worst, with 2 to 4 recommended. The honest reading is that the best indentation width is an open question **[X]**: one older study for 2–4 (known only through Bauer's account), one small failure to replicate that may simply be underpowered. That is an argument for not choosing a width on the reader's behalf.

> **Default.** `tab-size: 4` when the source carries no hint, as now. Where the file's directory tree carries an `.editorconfig` (Source mode, where a path is known; not for a markdown fence), use `tab_width` if present, else numeric `indent_size`, else 4; never `indent_size = tab` without a `tab_width`. Bound the value to 1–8. The rest is the reader's setting. Grade **[D]**. The 4 default is chosen because it is the only width both CodeMirror and `highlight.ts` already agree on; no evidence prefers it over 2 or 8.

> **Operation.** None. A tab width is a rendering setting; it must never change bytes (`gate:fidelity`). If `TAB` in `highlight.ts` and `tab-size` in `base.css` are ever made variable, both must read one source, or the hanging indent of wrapped rows will be wrong for tab-indented files (a tab counted as 4 columns while drawn as 2).

> **Marxy today.** `base.css` line 192 (`tab-size: 4`); `highlight.ts` lines 9–10; no EditorConfig reader anywhere. Applied as a constant, open as a setting.

## Wrap policy

### Where the block may grow

At the default size the block grows into the right margin up to `min(100% + room, 100ch + 30px)`, where `room` is `(100vw − column) / 2 − 3rem` (`base.css` lines 43 and 181). The authored widths the style guides set therefore fit only on wide windows:

> **Measured.** The block's rendered width (`getBoundingClientRect`), a 200-character code line, WebKit 26.6, 20 px article, viewport width as shown, columns = (width − 30 px padding) / 10.8 px.

| Window width (CSS px) | Block width (px) | Columns before wrapping |
| ---: | ---: | ---: |
| 800 | 657.6 | 58 |
| 960 | 737.6 | 65 |
| 1,280 | 897.6 | 80 |
| 1,440 | 977.6 | 87 |
| 1,512 | 1,013.6 | 91 |
| 1,728 and up | 1,110.0 | 100 |

79 columns (PEP 8) needs a window of at least about 1,250 px, 88 (Black) about 1,450 px, and 100 (rustfmt, Google Java) about 1,705 px; the line-length conventions are the sibling's ([Code](../reader-typography/06-code.md), "Line length, tabs and line height"). At an 800 px window a code block is only 58 columns, barely more than the prose column.

### The three positions

**ADR-0033 wraps** with a hung continuation and a 1 px rule, and never scrolls. **The sibling's spec scrolled** in a focusable container, wrapped only by choice, and said never to wrap indentation-sensitive languages silently ([Code](../reader-typography/06-code.md), "Wrap or scroll?"). The evidence for either is thin, and this is what exists:

- **WCAG 1.4.10 Reflow** exempts content that requires two-dimensional layout for usage or meaning. Its Understanding document names code specifically: indentation and unbroken lines can be important to understanding code, even necessary for it to function, and it suggests reducing indentation at narrow widths.[^wcag] That is permission to scroll, not a finding that scrolling is better, and the criterion concerns a 320 px-wide viewport, which a desktop reader window is not.
- **VS Code** ships with wrapping off and, when the reader turns it on, offers four `wrappingIndent` values (`none`, `same`, `indent`, `deepIndent`) with `same` the default in VS Code.[^vscode] Marxy's fixed two columns past the line's own indentation is the same idea, fixed instead of chosen.
- **GitHub** did not wrap code in its file view until late December 2022, when code began to wrap automatically; users called it hard to read (the thread is largely about mobile), and in January 2023 a GitHub staff member said the cause had been identified, a fix was coming for the existing view and the new code view would have a setting for wrapping.[^ghwrap] That is anecdote and a product reversal **[D]**; it says wrapping without continuation marks or a choice was unwelcome, not that wrapping with them is.
- **No study** comparing wrapped and scrolled code for comprehension, speed or errors was found. That is a finding.

So the choice is unsettled by evidence and is a design judgement **[D]**. ADR-0033 (accepted 2026-09-23) chose wrapping and already took the sibling's contrary spec into account; nothing above is new evidence against that decision, only a list of cases where its stated safeguard (hang plus rule) has not been tested on readers. ADR-0033's reason is the strongest in the file: a per-block scrollbar is chrome at rest and a focus stop, and most lines are short (median 37 columns in the corpus). Its cost falls on a minority of lines, and the question is which ones.

### What must not wrap silently

A wrapped continuation row hangs under its line and draws a 1 px rule, which is enough when the line is a statement. It misleads when position is the meaning:

- **Diffs and patches.** Column 1 is the marker (`+`, `-`, space); a wrapped row shows no marker and can read as context or as another change. Unified diffs are meant to be read as written ([Diffs and provenance](05-diffs-provenance.md)).
- **Logs and tables in `text` fences.** Each line is a record; columns align down the block. Wrapping breaks the alignment that a reader scans.
- **Indentation-sensitive languages** (Python, YAML, Makefile, Haskell). The hang preserves the indent, and Marxy's design (hang at the line's own indent + 2 columns, capped at 50 %) is meant for this, but a line wrapped in the middle of a nested block is still harder to scan than a scroll would be.
- **ASCII diagrams, box-drawing, hex dumps, minified one-liners.** A minified JSON of 10,000 characters would wrap into about 100 rows at 100 columns.

> **Proposal for an ADR amendment, not a default.** ADR-0033 point 5 stands ("wraps, never scrolls"); this is judgement, and the evidence in this chapter does not license overriding it. If the author opens an amendment, keep ADR-0033 for source code and prose-like blocks and add a narrow exception, defined by content class rather than a per-block toggle: for fences whose language is `diff`, `patch`, `text`, `log`, `console` or `ascii`, or whose longest line is more than 3 × the block's width (a minified line), do not wrap; set `white-space: pre`, keep the block within the same room, and let it scroll horizontally, focusable with a name (`tabindex="0"`), so the keyboard reaches it. The sibling's scrollable-region rule applies to exactly these blocks. Grade **[D]**. It contradicts ADR-0033 point 5 ("never scrolls") for a named class, adds a per-block scrollbar (chrome at rest, which ADR-0033 gives as its reason) and a focus stop, and is untested on readers; it needs an amendment and is a taste-and-policy decision, queued below.

> **Marxy today.** All `pre` wrap: `white-space: pre-wrap; overflow-wrap: anywhere` with `text-indent: 2ch hanging each-line` (`base.css` lines 189–191); `.marxy-line` sets `--marxy-hang: min(indent + 2ch, 50%)` and the 1 px rule (lines 199–206). Source mode wraps everything except files past the large-file threshold (`editor.ts` lines 73–74). 10 of 126 corpus code lines wrap at 100 columns; 7 are in `19-source-file`, 2 in `18-agent-transcript`, 1 in `06-math`.

## Line numbers

A line number does three jobs in a reader. It **locates**: compilers and agents report `file:line`, and GNU's standard for error messages is `sourcefile:lineno: message`, with an optional column.[^gnu] It **refers**: GitHub can link to a line or range of lines in a file.[^ghlink] And it **counts**, which a reader rarely needs. No study was found of whether line numbers help reading or comprehension. The case rests on task, not on evidence **[D]**.

By content type: a README's fenced snippets are read, not located in; nobody is told to look at line 4 of an install snippet. An agent's tool result or a compiler log is exactly where line references arrive, but they arrive as text (`src/main.rs:42:5`) that the reader wants to *go to*, which is a navigation feature, not a gutter. Source files (Source mode) are located in constantly.

> **Default.** Rendered mode at rest: no gutter, no numbers. Source mode of a non-markdown file: a gutter, summoned by default on because location is the task; markdown source: off. In both modes a palette command toggles it, and the choice persists. Grade **[D]**. Today Source mode is created with `lineNumbers: false` (`apps/desktop/src/app.ts` line 117), even for code files: a gap between the priority list (source files third) and a viewer that cannot say where a line is. A taste row: whether an on-by-default gutter in Source mode breaks the reading feel of the app.

### Rendered mode: numbers that copy cleanly

If a Rendered block carries numbers (summoned, per block or per document), the mechanism decides whether copied text stays byte-identical. The sibling's rule is "keep line numbers outside the copyable text (a separate column, or generated content)" and its ledger lists that as unverified.

> **Measured** (on a hand-written page loaded from a local `file://` URL, not the shipped app: no Marxy stylesheet beyond the shape of `.marxy-line`, no Shiki output, no Tauri webview, no Marxy operation code). Playwright 1.63.0, WebKit 26.6 (build 2359) and Chromium 153.0.8010.12, headless on macOS; the repository launches WebKit through `scripts/playwright-webkit.mjs`, and this run used Playwright directly with the same defaults. One three-line Python snippet with line numbers made five ways: (a) `::before { content: counter(n); counter-increment: n }` on a block `span` per line; (a2) the same on Marxy's own `.marxy-line` shape (inline-block, `width: 100%`); (b) a separate `<pre aria-hidden="true">` gutter column with `user-select: none` in a flex row beside the code; (c) an inline `<span aria-hidden="true">` per line with `user-select: none`; (d) a control, the same spans with no `user-select` rule; (e) a line wrapped onto a hanging indent (`text-indent: 6ch hanging`, 24ch block). Each was selected three ways: a range over the whole block, a mouse drag from the block's top-left corner to past its last line, and a drag starting on the fourth code character. `getSelection().toString()` was read; then Meta+C copied and Meta+V into a `<textarea>` captured both `text/plain` and `text/html` from the `paste` event. (The headless engines keep a private pasteboard: the system clipboard stayed empty, so the paste is the only way to read what was copied.)
>
> Results. For (a), (a2), (b), (c) and (e) the pasted plain text and the HTML flavour contained **no line numbers** in either engine, from any of the three selections. The control (d) copied its numbers (`1def f(x):`, `2    return x + 1`), including the numbers of lines 2 and 3 when the drag started in the code. Differences: in WebKit the selection string of a whole-block range over the span-per-line markup ended with a newline that the pasted text did not; and the two engines disagree over a `user-select: none` number: in **Chromium a drag that starts on a `user-select: none` inline number (c) selects nothing**, while WebKit starts the selection at the next selectable character. In the two-column layout (b), Chromium selected nothing when the drag started in the code column and selected the whole code when it started on the gutter; WebKit selected the code either way. In (e) the wrapped line came back as one source line in both engines: the soft wrap and the hanging indent put nothing into copied text.
>
> A further run with a real CodeMirror 6 view (`@codemirror/view` 6.43.12, `lineNumbers()` and `EditorView.lineWrapping`) bundled with esbuild: Cmd+A then Cmd+C pasted the document without numbers in both engines; a drag that started on the gutter copied `1\n2\n3` (numbers only), and a drag that started in the code copied the code without numbers.

What the measurement licenses: that in these two engines, for these constructions, `::before` counter content and `user-select: none` numbers stay out of `getSelection().toString()` and the pasted `text/plain` and `text/html`. It does not license a claim about the shipped Tauri webview's clipboard path, VoiceOver, find-in-page or Marxy's own copy code; the acceptance test in the gutter story must run in the shipped app. (The three-selection, five-construction run was repeated by the skeptic with the same results.) What the measurement supports: CSS counters on the line element (a, a2) are safe in both engines and in Marxy's exact line shape, because generated content is not text. A separate gutter column (b) works in WebKit, which is Marxy's engine, but behaves differently in Chromium, so it is a trap if the Rendered view is ever run in a Chromium-based shell. Per-line `user-select: none` spans (c) put the numbers in the DOM, where find, screen readers and any `textContent`-based operation see them unless marked; generated content avoids that, at the cost of not being addressable. Whether VoiceOver announces counter content was not tested.

> **Default.** Generated numbers on `.marxy-line::before`, absolutely positioned in the left margin (right-aligned, hanging outside the block so the 100-column count and the hang are unchanged), set in the secondary text colour at 4.5:1 or better and never selectable text. Number the first row of each source line only, so a wrapped line reads as one and the number is a second cue beside the 1 px rule. Grade **[D]** for placement; the copy property is measured. The gutter is a per-document view state, off at rest.

> **Trap.** A gutter built as a real column of text, or numbers written into the text nodes and hidden with `user-select`, works until a `textContent`-based feature (find, the clean-copy operation, a future "copy as plain text") reads the DOM. Generated content and the AST's own bytes are the only sources every feature agrees on.

> **Operation.** Two, both `string → clipboard` over the source bytes of the selected range and never touching the buffer. (1) *Copy without line numbers* needs no operation: numbers are never in the text. (2) *Copy as reference* (block or span): puts `path:L` for one line or `path:L-M` for a range on the clipboard, optionally followed by the fenced text, in the GNU `file:line` shape that terminals and editors already parse.[^gnu] `L` and `M` are counted from byte 0 of the file, so the operation needs the source text before `range.start`. `OperationInput` does not carry it today ([Diffs and provenance](05-diffs-provenance.md), Part C, records the same gap for `copy-with-reference`); the proposal there (an additive `source` field, by ADR) unblocks this too. For a range inside a fenced block the line numbers are the file's, not the fence's.

> **Marxy today.** `.marxy-line` wraps each source line already (`highlight.ts` lines 8–40; `base.css` lines 199–208), so a per-line counter needs one rule and no new markup. Nothing renders a gutter in Rendered mode. Source mode's gutter is constructed and off (`app.ts` line 117).

## Colour budget

Chapter [Colour, contrast and access](09-colour-access.md) does contrast and colour-vision deficiency; this section only budgets: how many hues a code block may carry, and who else may spend them. The sibling covers the evidence that highlighting helps less than its popularity suggests, and the case for fewer colours reliably applied ([Code](../reader-typography/06-code.md), "What the research says about colour in code").

**What a block spends today.** Four hues, on top of the code text colour. Converted to OKLCH (computed from the hex values in `tokens.css` lines 49–60):

| Role | Token (dark) | OKLCH L | C | hue° | Contrast on `#1d1c19` |
| --- | --- | ---: | ---: | ---: | ---: |
| Code text | `#e3dfd6` | 0.90 | 0.013 | 87 | 12.8 |
| Function, tag | `#8fb4dd` | 0.76 | 0.072 | 251 | 7.9 |
| String | `#a8c48a` | 0.78 | 0.085 | 129 | 8.9 |
| Comment | `#d4ad73` | 0.77 | 0.088 | 77 | 8.1 |
| Number, constant | `#c9a0dc` | 0.76 | 0.095 | 315 | 7.7 |

Three properties are worth keeping. The four hues sit at nearly one lightness (0.76–0.78) and similar chroma (0.07–0.10), so no token is louder than another; the hues are spaced 52°, 122°, 64° and 122° around the circle; and the code text is 0.12 L lighter than any of them, so the un-coloured majority (keywords, types, variables, operators, punctuation) reads as the brightest, not the dimmest, thing in the block. The sibling's rule that only what a reader looks for is coloured is met by construction.

**Who else wants colour in a code block.** Three things arrive in the same rectangle: diff add/delete, log severity, and alerts or callouts drawn beside code.

- **Diff.** Marxy today gives `markup.inserted` and `markup.deleted` no class ([Diffs and provenance](05-diffs-provenance.md)), so a diff fence is uncoloured except for punctuation, which is safe: nothing competes.
- **Logs.** A log's severity is a role. Its natural hue is amber for warnings and red for errors, and amber is 77°, the comment hue: in a fence that mixes prose comments and severity, one hue would mean two things.
- **Alerts** are outside the block (prose), so they compete for the page, not the block.

> **Default.** A block may carry at most the four token hues plus text; nothing else may put a hue on *foreground text inside a block*. Status meaning (diff add/delete, log severity, "changed since last read") is carried by three channels in this order: a character that is in the text (`+`, `-`, `ERROR`) first; a low-chroma background tint on the line second, at lightness within 0.05 of the block ground (L 0.23) so it cannot be confused with a token, whose L is 0.76 or higher; foreground hue never. A tint is added to the theme contract only by ADR (ADR-0033 holds the frozen token set; new tint tokens are additive). Grade **[D]**: this is the sibling's evidence for restraint, applied to a new competitor, and no study tests the combination.

> **Trap.** Reusing `string` green and `comment` amber for add and delete "because they already have colours". Green here means "the author's string literal" and amber "the author speaking"; meaning-bearing hues cannot double up (chapter 05 makes the same point for the diff scopes).

> **Marxy today.** Applied for tokens (`tokens.css` lines 49–60; `base.css` lines 210–221 map twelve classes, six of which fall back to the code text colour). Open for status hues: no diff, log or severity token exists.

## Inline code in a Knuth–Plass paragraph

Marxy's typesetter treats every code span as a single unbreakable piece, spaces included: `runs.ts` collects text inside `code`, `kbd` and math as one piece with its neighbours ("a code span never breaks inside itself"). `RESEARCH.md` explains the reason: a hyphen inside code may belong to a filename and must never end a line, and the engine's own behaviour is to break inside a code span at such hyphens.

**What the engines do with a long span.** The base article sets `overflow-wrap: break-word` (`base.css` line 58), so a span that cannot fit is broken at an arbitrary character.

> **Measured.** Playwright 1.63.0, WebKit 26.6 and Chromium 153, a 280 px serif paragraph holding an 18 px `<code>` span, with `overflow-wrap: normal` and then `break-word`; the lines of the span were read character by character (`Range.getBoundingClientRect().top`). With `normal`, the engines break after a hyphen and after `?`, and **do not break after `/`, `.` or `_` in either engine**: `/Users/reader/Dev/shelf/packages/index/src/scan/build-` then `row-from-file.ts` (a break at the hyphen, hyphen left at the end of the line), and `https://example.com/docs/reference/api/v2/endpoints/list-` then `things?` then `limit=50&cursor=abc`. A dotted identifier and a camel-case identifier were never broken and overflowed the box. With `break-word` the same spans break mid-segment: `/Users/reader/Dev/shelf/p` | `ackages/index/src/scan/bu` | `ild-row-from-file.ts`. Chromium and WebKit agree in all ten cases.

So in the fallback path a long path is broken inside a directory name or after a hyphen, and nothing marks either. Neither is a good outcome, and neither is a rule anyone chose.

**How often it happens.** In the corpus goldens, inline code (outside `pre`) appears 301 times: median 5 characters, 90th percentile 20, maximum 75. Only 2 spans exceed the 56 characters that fit in the prose column (`1ch` = 10.8 px in 611 px): both file paths, 70 and 75 characters, in `18-agent-transcript` (whose tool results are the agent artifacts the handbook ranks second in priority). Twenty-one spans contain a `/` and 32 contain a space. The typesetter's own corpus run (`node packages/typeset/scripts/measure-rendered.mjs`, read-only, 17 px on a 68 ch measure) sets 218 of 348 candidate paragraphs and leaves 19 to the engine: 8 with an inline object, 7 CJK, 4 for overflow after setting, none for a piece wider than the measure. Frequency is low; salience is high, since in an agent transcript the path is the datum.

**What the incumbents do.** TeX's `url.sty` makes breaks a per-character decision. `\UrlBreaks` permits them after a set that includes `/`, `.`, `_`, `?`, `&`, `=` and `#`, with penalties (`\UrlBreakPenalty`, defaulting to the binary-operator penalty; `\UrlBigBreakPenalty` for `:` and, by option, `-`), and marks nothing at the break.[^urlsty] The design is per-character penalties inside a verbatim box, which is Knuth–Plass with more break points and a cost, exactly what a typesetter with a cost model can do. Typst, as reported for v0.8 in its tracker, broke inline raw text only at spaces and overflowed a long unbroken string, and the issue was closed without a change; the tracker's own workaround is an explicit zero-width space (I did not re-test a current release).[^typst] In CSS, `overflow-wrap: anywhere` and `break-word` break at any character only when there is no other acceptable break, and the specification does not say where a break after a slash may go; `<wbr>` marks an optional break.[^csstext][^mdnwbr]

> **Measured** (with `<wbr>` as a stand-in; Marxy's own `marxy-lb` was not tested inside a `code` element, and the skeptic re-ran the `<wbr>` case with the same result). `<wbr>` after each `/` of an inline span: in both engines the selection string and the pasted `text/plain` carry no zero-width space (the path pasted as written); the `text/html` flavour contains the `<wbr>` element itself, so an operation that copies rich HTML must strip it. Marxy's existing break mechanism needs no new element, on the strength of its own documentation and not a slash-specific test: `apply.ts` inserts an empty `span.marxy-lb` whose `::before` is generated content, which is not text (its header comment states that), so selection, copy and find are unchanged.

**Recommended rule, three tiers.** First, a span that fits the measure stays unbreakable, as now. Second, a span wider than the measure (no arrangement of its neighbours helps) gains break points after `/` and after nothing else, at a penalty higher than a space's: a third pass, the analogue of TeX's `\emergencystretch`, run only when the breaker reports an overfull line (`ragged.ts` returns `overfull`; `index.ts` line 164 then calls `fallback('overfull')` and leaves the paragraph to the engine). No hyphen and no glyph is drawn, as with `url.sty`; a `/` at the end of a line is itself the continuation cue. Third, only if that fails: the engine's `overflow-wrap: anywhere`, as now, never a horizontal scrollbar in a paragraph. Hyphens, dots and underscores stay unbroken. The rule leaves the common case untouched and changes only what happens to 0.7 % of corpus spans, so it costs no rag anywhere else. Grade **[D]** (`url.sty` is the incumbent; nothing tests readers on where a path may break).

This does not settle the open taste question in the MARXY-23 queue row (`docs/taste-review/queue.md`, "should a path break at a slash?", recorded as "lean no-break, defer to incumbents, left open"). It changes the shape of the question: not "may a path break at a slash" but "when a path cannot fit at all, would you rather it broke at a slash or inside a directory name". That is a smaller and easier taste call, and the nearest incumbent, `url.sty`, answers the former (though it also permits breaks after `.`, `_` and other characters, which this rule deliberately does not).

> **Operation.** None. Break points are a rendering pass. Copied text stays as authored (measured above); copying a paragraph as rich HTML must not carry `span.marxy-lb`.

> **Gate.** An `overfull` gate that can fail: over the corpus in WebKit, the number of paragraphs whose furthest glyph paints past the measure after the typeset pass (`overflow()` in `apply.ts` already measures this, in px) must be 0; and the count of paragraphs left to the engine for `overfull` is reported per run, with a fixture holding a 75-character path in a paragraph at the default measure. Acceptance for the story below.

> **Marxy today.** `packages/typeset/src/runs.ts` lines 44–66 (code is one unbreakable piece); `ragged.ts` lines 51–145 (`overfull`); `index.ts` lines 122 and 164 (fallback); `apply.ts` lines 1–10 and 74–90 (`marxy-lb`, `overflow()`); `base.css` line 58 (`overflow-wrap: break-word`). Contradicted only where the engine's fallback breaks a directory name.

## Dark and light

The sibling's case for lighter weight on a dark ground rests on the irradiation illusion and on how rasterisation blends coverage (chapters 1 and 9 of the [typography handbook](../reader-typography/README.md)); it is convention with a mechanism, **[D]**, and the body text applies it (380 dark against 400 light, `tokens.css` line 23).

> **Measured.** In Marxy's rendering the computed `font-weight` of `pre` and of inline `code` is 380 in dark (WebKit 26.6): code inherits `--marxy-wght` from the article and sets no weight of its own. JetBrains Mono is a variable font (`wght` 100–800), so 380 is drawn exactly, not rounded to 400.

So code is already 5 % lighter than the face's regular in dark, and no separate decision was made about it. Three things the sibling does not say: no study of monospace weight on a dark ground was found; code strokes are thinner than a serif's at the same size, so the risk of light-on-dark thinning is if anything greater in code than in prose; and the brightness of code text (`#e3dfd6`, 12.8:1 on the code ground, against body text at 14.5:1 on the page) is already set below the body, which compensates in the same direction as the weight. The code block's ground is lighter than the page (`#1d1c19` on `#151412`), a raised island rather than a cut-out.

> **Default.** Keep code at the article's weight (380 dark, 400 light) so text and code share a single weight setting. No separate mono weight. Whether a mono weight axis of 360 or 340 reads better in dark is a taste row: render the same block at 340, 380 and 400 in dark and ask the reviewer which stroke reads as the same colour as the body. Grade **[D]**.

> **Marxy today.** Applied by inheritance (`tokens.css` line 23, `base.css` lines 33 and 51). Not a decision of its own.

## Alternative faces and the size that follows

Marxy uses JetBrains Mono. Its licence, read from the copy in the repository (`fonts/jetbrains-mono/LICENSE`): SIL Open Font License 1.1, copyright "The JetBrains Mono Project Authors", and the notice names no Reserved Font Name (ADR-0033 records the same). Nothing else is recommended here.

A face swap changes more than the letters. The size that matches Literata's x-height is `20 px × 0.507 / x-height`, and the column advance follows from it. From the sibling's measured x-heights, as prior art and not as a recommendation (licences of these faces were not re-verified in this chapter): JetBrains Mono 0.550 gives 18.4 px (Marxy uses 18); IBM Plex Mono 0.516 gives 19.7 px; Atkinson Hyperlegible Mono 0.496 gives 20.4 px; Intel One Mono 0.465 gives 21.8 px. At 21.8 px a 0.614 em advance is 13.4 px, so a 66-column prose measure holds only 45 code columns. A low-vision face is therefore a real trade against width, and the sibling's shortlist makes it available; because Marxy's themes may set `--marxy-font-mono`, the 18 px constant in `tokens.css` line 13 is the piece that would have to follow.

## What remains taste

- Whether the 1 px rule plus 2ch hang reads as a continuation in Python and YAML (queue row: before/after of a wrapped nested block, dark, 960 px).
- Whether a Source-mode line-number gutter on by default suits the app (before/after, one source file).
- Whether the diff/patch/log scroll exception looks like a break in the page's calm, against the small number of blocks it touches.
- Whether a path that cannot fit reads better broken at a slash than inside a directory name (queue: a transcript paragraph with a 75-character path, before and after).
- Mono weight 340/380/400 on dark.

## What would change these recommendations

- A reader study showing that wrapped code is misread more often than scrolled code (the exception list would widen to all code, and ADR-0033 point 5 would be reversed).
- A Marxy user report that a path was broken at a slash and mis-copied: the measurement above says copy is safe, so only a finding about *reading* would reverse the slash rule.
- Any Chromium-based Rendered shell: the gutter would have to be generated content, not a column.
- A confirmed replication of Miara (2–4 spaces): the default width would move from "no evidence" to a choice.

[^ec]: EditorConfig, "EditorConfig Specification" (indent_style, indent_size, tab_width) (docs page). [spec.editorconfig.org](https://spec.editorconfig.org/). Accessed 2026-09-25.
[^csstext]: W3C, "CSS Text Module Level 3": `tab-size` (initial value 8), `overflow-wrap: anywhere` and `break-word`, `word-break` (spec; read the sections named). [w3.org/TR/css-text-3](https://www.w3.org/TR/css-text-3/). Accessed 2026-09-25.
[^wcag]: W3C, "Understanding Success Criterion 1.4.10: Reflow", WCAG 2.2 (docs page; the section on nested lists and code, and the two-dimensional layout exception). [w3.org/WAI/WCAG22/Understanding/reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html). Accessed 2026-09-25.
[^ghtab]: GitHub, "Managing your tab size rendering preference" (docs page) and GitHub Changelog, "Tab size rendering preference", 21 September 2021 (docs page). [docs.github.com](https://docs.github.com/en/account-and-profile/how-tos/account-settings/managing-your-tab-size-rendering-preference); [github.blog/changelog/2021-09-21-tab-size-rendering-preference](https://github.blog/changelog/2021-09-21-tab-size-rendering-preference/). Accessed 2026-09-25.
[^ghtab2]: GitHub Community, "GitHub consistently maintains user-defined tab-width preferences [GA]", discussion 167417, 24 July 2025 (announcement, read in full). [github.com/orgs/community/discussions/167417](https://github.com/orgs/community/discussions/167417). Accessed 2026-09-25.
[^gh4893]: GitHub Community, "Tab size is too wide when viewing code", discussion 4893, staff reply of 23 September 2021 and a later comment of 13 March 2025 (thread, read for the two replies). [github.com/orgs/community/discussions/4893](https://github.com/orgs/community/discussions/4893). Accessed 2026-09-25.
[^ghwrap]: GitHub Community, "GitHub Wrapping off?", discussion 42298, December 2022 to April 2024, staff reply of 19 January 2023 (thread, read for the staff answer). [github.com/orgs/community/discussions/42298](https://github.com/orgs/community/discussions/42298). Accessed 2026-09-25.
[^vscode]: Microsoft, VS Code `src/vs/editor/common/config/editorOptions.ts` (source): `wordWrap` default off, `wrappingIndent` values and default, `lineHeight` computed from font size when 0, `EditorFontLigatures.OFF` as `"liga" off, "calt" off`. [github.com/microsoft/vscode](https://github.com/microsoft/vscode/blob/main/src/vs/editor/common/config/editorOptions.ts). Accessed 2026-09-25.
[^bauer]: Jennifer Bauer, Janet Siegmund, Norman Peitek, Johannes C. Hofmeister and Sven Apel, "Indentation: Simply a Matter of Style or Support for Program Comprehension?", *ICPC 2019* (IEEE/ACM 27th International Conference on Program Comprehension), pp. 154–164 (abstract and introduction read; it describes Miara et al., *Communications of the ACM* 26(11), 1983, which was not reachable in this session). [infosun.fim.uni-passau.de/publications/docs/Bauer19.pdf](https://www.infosun.fim.uni-passau.de/publications/docs/Bauer19.pdf). Accessed 2026-09-25.
[^gnu]: Free Software Foundation, "GNU Coding Standards", section "Formatting Error Messages" (docs page). [gnu.org/prep/standards/html_node/Errors.html](https://www.gnu.org/prep/standards/html_node/Errors.html). Accessed 2026-09-25.
[^ghlink]: GitHub, "Getting permanent links to files" (docs page; states that a permanent link can point to a line or range of lines, and refers to another article for the method). [docs.github.com](https://docs.github.com/en/repositories/working-with-files/using-files/getting-permanent-links-to-files). Accessed 2026-09-25.
[^primer]: GitHub, `primer/primitives`, `src/tokens/functional/typography/typography.json5` (codeBlock 13 px, line height token `normal`, codeInline 0.9285 em) and `src/tokens/base/typography/typography.json5` (line-height tokens: normal 1.5, relaxed 1.625 for 12–13 px) (source). [github.com/primer/primitives](https://github.com/primer/primitives). Accessed 2026-09-25.
[^urlsty]: Donald Arseneau, `url.sty` version 3.4, 16 September 2013 (source; `\UrlBreaks`, `\UrlBigBreaks`, penalties). [tug.ctan.org/macros/latex/contrib/url/url.sty](https://tug.ctan.org/macros/latex/contrib/url/url.sty). Accessed 2026-09-25.
[^typst]: Typst issue 2216, "Long lines (with no spaces) are not broken (text wrapping issues)", Typst 0.8, closed as not planned (issue thread). [github.com/typst/typst/issues/2216](https://github.com/typst/typst/issues/2216). Accessed 2026-09-25.
[^mdnwbr]: MDN Web Docs, "`<wbr>`: The Line Break Opportunity element" (docs page). [developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/wbr). Accessed 2026-09-25.
