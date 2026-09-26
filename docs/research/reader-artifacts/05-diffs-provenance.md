# Diffs and provenance

*A diff is the one kind of code whose meaning lives in its first column, and an agent artifact is the one kind of document that is rewritten while you read it. This chapter settles how Marxy presents a diff someone else computed, when (if ever) Marxy should compute one itself, and what byte provenance on every rendered element lets a reader do that most markdown viewers do not: jump to the exact source byte, copy the source rather than the rendering, cite a passage in a form that survives the file being regenerated, and see what changed since they last read it. It ends by testing each candidate operation against the frozen operation contract and naming, for each thing the contract cannot express, the smallest decision that would unblock it.*

Evidence grades: **[A]** replicated findings or a meta-analysis · **[B]** one well-designed study · **[C]** small, limited or mixed studies · **[D]** expert convention, or convergence of shipping tools, without a direct test · **[X]** contested or contradicted. Part of the [Reader Artifacts Handbook](README.md).

## Part A. Diffs as read

### What a reader of a change needs

The research on reading changes is almost all research on *code review*. It is about what reviewers attend to and understand, not about how a diff should look.

- **Understanding is the work.** Bacchelli and Bird observed, interviewed and surveyed developers at Microsoft: finding defects is the stated motive, but the outcomes are as much knowledge transfer and awareness, and understanding the change is the reviewers' main challenge **[B]**.[^bacchelli-bird]
- **Small changes are reviewed better.** In Baum, Schneider and Bacchelli's experiment with 50 mostly professional developers, review effectiveness was significantly higher for small changes; working-memory capacity was moderately associated with finding delocalised defects; the order in which change parts were shown tended to affect efficiency but the authors could not conclude it reliably **[C]**.[^baum-wm]
- **Position biases attention.** Fregnan and colleagues found, over 219,476 pull requests in 138 Java projects, that files shown earlier receive more review comments; in a 106-participant experiment one of two seeded defect types had 64% lower odds of being found when its file was last rather than first **[B]**.[^fregnan]
- **Eye movement has a pattern.** Uwano and colleagues recorded reviewers' gaze over 30 review processes (6 programs, 5 subjects) and identified a "scan" pattern, a first pass over the whole listing **[C]**.[^uwano] It says how a reviewer reads a listing, not how a diff should be drawn.

**Unified against split.** The one direct test found is small. Alcocer and colleagues put 12 participants on two commits with GitHub's split and unified views under an eye tracker: unified needed less visual effort, but the differences in the measured variables were not statistically significant **[C]**.[^alcocer] I found no test of intra-line (word) highlighting, of moved-code colouring, of markers against colour alone, or of line background against coloured text. Searches for such studies returned only the study above and the review-comprehension work already cited. That absence is a finding.

> **Default.** Present a diff the way its author wrote it: unified, one column, markers in place. Marxy has no evidence-backed reason to convert it to split, and the only direct test leans, weakly, the other way. Every rule below on markers, colour and wrapping is convention **[D]** (converged: git's own output verified in this session; the tool survey belongs to [Teardown](08-teardown.md), not repeated here).

### Diff algorithms are a reading issue

A diff is not unique. The classic algorithm, Myers's O(ND) shortest-edit-script search, is a shortest-path problem on an edit graph and is fast when differences are small.[^myers] Git exposes four choices: `myers` (default), `minimal`, `patience` and `histogram`, the last extending patience to handle common elements of low occurrence.[^gitdiff] They can describe the same edit differently. Nugroho, Hata and Matsumoto compared Myers with Histogram for repository mining: code-churn metrics differed in 1.7% to 8.2% of commits (14 Java projects), bug-introducing-change identification in 6.0% to 13.3% of bug-fix commits (10 Java projects), and their manual analysis judged Histogram the better description of changes **[C]**. It is Java only, its judge and audience are researchers mining archives, and no reader was tested.[^nugroho] A 2025 bachelor's thesis reports pathological cases where a single-line change makes the rest of a file appear changed under histogram **[C]**, so the evidence conflicts on robustness.[^glodny]

Two further git presentations show what a reader of someone else's diff cannot get from the text alone: `--word-diff` (changed words as `[-old-]{+new+}`, or a machine form with `~` for newlines) and `--color-moved` (moved blocks of at least 20 alphanumeric characters coloured in place of add/delete).[^gitdiff]

> **Measured.** With git 2.55.0, swapping two functions in a seven-line file gives `-`/`+` blocks under Myers and under `--diff-algorithm=histogram` alike, while `--color-moved=zebra --color=always` recolours the same lines with different escape codes (35/36 instead of red/green). Reproduce with two small files and `git diff --no-index`. A `--word-diff=porcelain` run on `the quick brown fox` against `the slow brown fox` emitted `-quick`, `+slow`, and a `~` line-end marker.

Structural diff exists too. difftastic compares syntax trees rather than lines and is MIT-licensed;[^difftastic] GumTree, the research tool for the same idea, is LGPL-3.0 and so disqualified from Marxy by ADR-0006, prior art only.[^gumtree] Neither is a reader's library: difftastic is a command-line program that Marxy could not embed without a per-language tree-sitter stack.

> **Default.** Marxy renders a diff; it does not compute one, except for the changed-since-last-read lens below. When it must compute one, use a line-level **histogram** diff over source lines, implemented in `packages/core` with no dependency, or Apache-2.0 diff-match-patch if a word-level pass is wanted (licence in the sources).[^dmp] Histogram over Myers rests on one Java mining study whose finding is a preference among researchers, not readers, and a thesis reports pathological histogram output; git's default is still Myers. Grade the choice **[C]** and treat it as a taste-neutral engineering default, not a reading result.

### Presenting a diff someone else computed

**Markers stay in the text.** A `+`, `-` or space in column one is the diff's information; colour is a second channel, never the only one (chapter [Colour, contrast and access](09-colour-access.md) measures contrast and is not repeated here). Selecting and copying the block gives the diff, markers included, because the block is code and copy-verbatim applies ([Code](../reader-typography/06-code.md)).

**Hunk headers and file headers are metadata.** `@@ -1,3 +1,3 @@`, `diff --git`, `index`, `---`, `+++` are for machines and patch tools; they should be legible but not shout, set in the code colour with no background. Colouring them the way add and delete are coloured makes a reader see six "changes" per file that are not changes.

**The no-newline marker is not a change.** A backslash line `\ No newline at end of file` follows the affected line. Measured below, an edit that differs only by the final newline appears as a removed and an added copy of the same text, which looks like a change to the line. The marker is what explains it.

> **Measured.** `git diff --no-index` on `a\nb\nc\n` against `a\nB\nc` (no final newline) prints `-b`, `-c`, `+B`, `+c` and then `\ No newline at end of file` under the last `+c`. `c` is unchanged in content and marked changed only because its terminator went.

**Whitespace-only changes** appear as `-`/`+` pairs that look identical. Git hides them with `-w` (all whitespace) and `-b` (changes in amount).[^gitdiff] A reader cannot re-run git on a fenced diff, and Marxy must not hide bytes, so the text stays verbatim. A summoned view that draws trailing whitespace on changed lines only is a possibility, untested **[D]**.

**Long lines.** Marxy wraps code beyond 100 columns with continuation rows hung 2ch past the line's own indent and a 1px rule (see [Code as read](04-code-typography.md)). In a diff a continuation must never read as a new `+`/`-` line. A diff line's own indent is the marker column, so a hang of 2ch places the continuation under the content, never in column one, and the rule beside it marks it as the same line. The trap is a wrap point that lands a literal `-` or `+` from the content at the start of a row.

**GitHub suggestion fences.** A reviewer's suggested change is a fenced block whose info string is `suggestion`; GitHub documents the feature and its batching into commits.[^ghsuggest] The fence holds only the replacement; the old lines are in the pull request, not in the file, so a reader that has just the markdown has no "before" to diff against. (I could not retrieve the syntax page; I rely on the fixture lab, `lab/data/probe-results.json`, whose `suggestion-fence` case is a fence with that info string.)

> **Default.** A `suggestion` fence is plain code and is labelled by nothing at rest. Do not fabricate a diff. Diff and patch fences get: markers verbatim; `markup.inserted` and `markup.deleted` tinted as a second channel; headers and the no-newline line in the plain code colour; continuation hang of at least 2ch. Grade **[D]**.

> **Marxy today.** A ```` ```diff ```` fence is tokenised by Shiki's diff grammar, but `packages/core/src/highlight/scopes.ts` maps none of the diff scopes: only the `punctuation.definition.*` markers match, and they map to `punctuation`, which `packages/theme/src/tokens.css` paints in the code text colour. The probe records exactly that: the two `@@` and each leading `-`/`+` are `punctuation`, everything else, including the no-newline line, unclassed (`lab/data/probe-results.json`, case `diff-fence`). A diff is therefore monochrome with markers intact, which passes the "markers stay" rule and fails the "second channel" one. `.diff` and `.patch` files open in Source mode with no language (`apps/desktop/src/source/language.ts`). The fixture corpus has no diff.

> **Trap.** Reusing the `string`/`comment` classes for add/delete because they already have colours. Green here means "the reader's string literal", and the chapter on colour shows why meaning-bearing hues cannot double up. The taste-neutral fix needs two new classes; see the gaps.

## Part B. Provenance as a capability

### What competitors actually map

Provenance from rendered element to source is not new; its resolution is what differs. Verified in this session:

| Tool | What it maps | Evidence |
| --- | --- | --- |
| VS Code Markdown preview | start **line** on every non-inline markdown-it token that has a map, as `data-line`, for scroll sync and double-click-to-source; no end, no bytes, no inline elements | source, `markdownEngine.ts`;[^vscode] an issue records that coverage was earlier limited to seven token types |
| cmark-gfm | a `--sourcepos` option adds a source-position attribute to output | man page;[^cmark] format not read |
| Obsidian | plugins may ask `getSectionInfo(el)` for `{text, lineStart, lineEnd}` of a rendered element, or `null` | type definitions;[^obsidian] section granularity, and "may return null in many circumstances" per its own comment |
| Typora | no source map exposed; default Copy is HTML, with an explicit **Copy as Markdown** (Shift+Cmd+C) and a preference to copy source by default | docs page[^typora] |
| GitHub | line and range permalinks tied to a commit SHA for files | docs page;[^ghperma] behaviour on rendered markdown not verified |

Marxy's difference is a byte range, on every element including inline ones, that a hostile document cannot forge (ADR-0023). Whether that is unique I did not establish: I found nothing else that does both, and I did not survey Marked 2, iA Writer or Typora's internals beyond the above. Do not claim novelty in the product copy; claim the capability.

### Jump to source

With a range on every element, "show this in source" is a command, not an operation: it changes view state and writes nothing. It is already expressible with the frozen `ReadingPosition` (`mode: 'source'`, `byteOffset`) and, in the app, `showSource(byteOffset)` in `apps/desktop/src/app.ts`.

> **Default.** Summoned only (palette, or a modified click): open Source mode with the element's `data-marxy-s` at the top, and return to Rendered on the same block. No per-block affordance at rest. Grade **[D]** (VS Code and Obsidian both give a way from rendered to source; the mechanism is convergent, the affordance is not).

> **Marxy today.** ADR-0018 and `app.ts` already preserve the byte offset across mode switches; jumping from a specific element is not wired to a command.

### Copy: source bytes or rendered text

No study of what readers expect from Cmd+C in a rendered view was found. The convention: browsers put the rendered text on the clipboard (and HTML with it), and an editor that renders, Typora, follows suit by default and makes source copy a separate command with a preference to flip it.[^typora] Marxy's design says the same for a drag selection: it is `text`, copies the DOM text with smart typography as seen, and never resolves to bytes in v1 (`docs/design/03-selection-and-operations.md`); `runCopyShortcut` in `apps/desktop/src/selection/apply.ts` does that. A click-selected node differs: Cmd+C runs the first applicable `copy-` operation, so a selected section already copies source bytes (`copy-section`). The trap below is about drag selections.

That is fine for prose and unsafe for one class of thing: text that will be pasted into a program. Code is never typographically transformed ([Code](../reader-typography/06-code.md)), so a selection inside a code block already yields the source bytes, whichever way it is copied.

> **Default.** Cmd+C on a drag selection copies rendered text, as designed. Any *node* or *section* selection offers, in the palette, both `copy-source` (exact bytes, `replacement` unchanged) and the existing clean variants; a source-preserving copy is one keystroke away and named so. Grade **[D]** (one tool's documented behaviour plus the design).

> **Trap.** Making Cmd+C on prose copy Markdown bytes to be "faithful". Pasting `**bold**` into an email or chat is a surprise; the reader who wants source has the palette.

### Anchors that survive regeneration

A byte offset stops naming the same passage the moment something is inserted above it, which is what happens to agent artifacts on regeneration. ADR-0018 records the reading position as `{path, byteOffset, fraction}` and says it survives external writes. Marxy does not use the raw offset: `offsetThroughEdit` carries it through the single differing run between the longest common prefix and suffix of the old and new bytes (`packages/core/src/position/restore.ts`). That is exact for one edit and wrong for two.

Prior art anchors by content, with position as a hint:

- W3C Web Annotation defines a TextQuoteSelector (`exact`, optional `prefix` and `suffix`) and a TextPositionSelector (`start`, `end` in code points), and lets a description carry several so the consumer can choose.[^w3c]
- URL text fragments encode `#:~:text=[prefix-,]start[,end][,-suffix]` and match on the first occurrence, with restrictions to prevent probing a page's content.[^textfrag]
- Hypothesis stores range, position and quote selectors (32-character prefix and suffix) and re-attaches in order: range, position, context-first fuzzy match, quote-only fuzzy match, using a modified diff-match-patch (Bitap for matching, Myers for comparison).[^hypfuzzy] Its client is BSD-2-Clause,[^hyplic] diff-match-patch is Apache-2.0.[^dmp]
- Phelps and Wilensky proposed a short lexical signature to re-find moved web content; I confirmed the bibliographic record only, not the intra-document abstract, so it is cited as prior art without a claim.[^phelps]

None of these is a test of whether readers keep a place better; they are engineering designs, and Hypothesis reports no accuracy in the source read here.

> **Default.** An anchor is `{path, start, end, exact, prefix, suffix}` over **source** bytes (never rendered text, which differs by smart typography), with `prefix` and `suffix` up to 32 characters each. Resolve in this order: same offsets if `exact` still sits there; else the unique occurrence of `prefix+exact+suffix`; else a unique occurrence of `exact`; else fail visibly (never "nearest guess"). Fuzzy matching (edit-distance tolerant) is a later refinement and is off by default, because a wrong anchor is worse than a lost one. Grade **[D]** (three shipping designs converge on quote plus context plus position).
> Human form for references out: `path:L12-L14`, derived from the byte range. Lines drift; the byte-and-quote form is the durable one. Grade **[D]**.

> **Measured.** With Node 24, `offsetThroughEdit` on `fixtures/corpus/03-ai-plan.md` (1,911 bytes) tracking the line `POST /v2/webauthn/register/options` (byte 1012): inserting a section at the top, or one line at line 3, moved it to the right byte (1033, 1028). Inserting a section at the top and appending a line at the bottom returned byte 2; changing the status line and the last lines returned 42; a trailing space on every fifth line returned 42. The last three do not land on the passage: whenever the changes are on both sides of the position, the offset falls to the start of the first difference. A regenerated agent artifact usually changes in several places (that fixture has a `Generated:` date and a `draft 3` counter in its header), so the raw-offset approach fails on exactly the case anchors are for. Reproduce by importing `offsetThroughEdit` and encoding the edited text with `TextEncoder`.

> **Operation.** `copy-anchor` and `copy-reference` (Part C).

> **Marxy today.** ADR-0018's `ReadingPosition` is frozen and has no place for `exact`/`prefix`/`suffix`; restoration across a regeneration goes through `offsetThroughEdit` in `packages/core/src/position/restore.ts` (single-run edits only, measured above), then `byteOffset` and `fraction`. Reading position could use the same resolver without changing the persisted record only if the record can carry a quote. That is an ADR (see the gaps table, anchors in `ReadingPosition`).

### Changed since last read

For a regenerated agent artifact the question "what changed since I last read this" is the natural one, and no source I found tests changed-content marking on rewritten documents, so nothing here is graded above **[D]**. The mechanism is not an operation: it needs the *old* text as well as the new.

> **Default.** When a watched file changes on disk and the reader has read it before, compute a line-level histogram diff between the last-read snapshot and the new text (in core, pure), map changed byte ranges to the blocks containing them, and mark those blocks with the existing rule idiom of the page: a rule in the margin, summoned by the reload and dismissed on the next scroll-past or by a command; nothing at rest. The snapshot is view state held by the shell, local only, never sent anywhere, and deleted with the document's history. Grade **[D]**, and taste-reviewed.

> **Marxy today.** Live-reload preserves reading position (ADR-0018, MARXY-194); there is no snapshot, no diff and no mark. A new data attribute and any new token need entries in `scripts/registry.json` first, and the frozen token set may need an ADR (see the gaps table, diff colour classes).

## Part C. Operations under the frozen contract

The contract (`packages/core/src/contracts/operation.ts`) gives an operation the `document` (AST, path in `document.path`), the resolved `node`, the byte `range` (with `file`), and `text`, the exact UTF-8 bytes of that range. It returns `replacement` (equal to `text` for a copy), optional `clipboard: {text, html?}` and `summary`. **The document's source text is not passed**, only its AST, so anything that needs bytes outside the range (line numbers, surrounding context) is not expressible as a pure function today; see the gaps table (line numbers and context).

| Id | Applies to | Signature | Expressible now | Notes |
| --- | --- | --- | --- | --- |
| `copy-source` | block, section, document | string → clipboard | yes | `clipboard.text = text`; the section variant exists as `copy-section` |
| `copy-plain-text` | block, section | string → clipboard | yes (from AST) | inline text values joined, straight quotes, no markup; differs from Cmd+C, which carries typography |
| `copy-with-reference` | block, section | string → clipboard | **no** | `text` plus a `path:L-M` line needs the line number, which needs the bytes before `range.start` |
| `copy-anchor` | block, section | string → clipboard | partly | `{path, start, end, exact}` yes; `prefix`/`suffix` no |
| `copy-diff-after` | block (code block, lang diff or patch) | string → clipboard | yes | context and `+` lines with the first character removed; drops `diff`/`index`/`---`/`+++`/`@@` and `\ No newline` lines |
| `copy-diff-before` | block (same) | string → clipboard | yes | context and `-` lines |
| `strip-diff-markers` | block | string → clipboard | yes | a fence that is one hunk of an added or deleted file: same as after or before; otherwise not offered |
| `copy-command` | block (shell or console fence) | string → clipboard | yes | drop a leading `$ ` and lines that are output; only offered when at least one prompt line exists |
| `extract-code-blocks` | section, document | string → clipboard | yes | fence bodies joined by one blank line; a v1.1 candidate already |

Rules that make them safe:

- `copy-diff-after`/`-before` are offered only for a **single-file, non-combined** unified diff (no `@@@` lines, at most one `+++`). Copying a multi-file diff's "after" as one blob would concatenate unrelated files. When the final `+` or context line is followed by `\ No newline at end of file`, the copied side has no trailing newline; the clean-copy rule of `copy-code-clean`, which ends with exactly one `\n`, would add one that the file does not have (a trap).
- `copy-command` is a heuristic, [D] with no study behind it. Only lines beginning `$ ` (or `> ` in console fences) are prompts; `#` is ambiguous with a comment and is left alone, and the operation says what it removed in `summary`.
- All are one undo step trivially, since `replacement === text`; the fidelity property (`gate:fidelity`) applies unchanged.

### What the contract cannot express

| Need | Why not | Smallest unblock |
| --- | --- | --- |
| Two inputs (old snapshot against new; two documents) | `OperationInput` carries one document | Not an Operation: a pure `changedRanges(before, after)` function in core plus view-state lens; needs an ADR saying lenses are view-only, feed no splice, and are outside the operations contract |
| Navigation (jump to source) | An operation returns a splice or clipboard, not a view change | Already a command using `ReadingPosition`; no contract change |
| Line numbers and context | `OperationInput` has no whole-source text | Additive `source: string` on `OperationInput`, in an ADR-only PR (ADR-0004 freeze) |
| Cross-document references | one `Document` | v2 per `docs/operations.md`; keep signature |
| A drag selection as a byte span | design 03 defers it | amend design 03: resolve a drag inside one text node to a span when rendered and source text are identical, else snap to the enclosing block |
| Diff colour classes | twelve frozen token classes; no `inserted`/`deleted` | ADR adding two classes and two theme tokens, after `scripts/registry.json` entries |
| Anchors in `ReadingPosition` | frozen record | ADR amending ADR-0018 with an optional `anchor` field |

### What the code does today under these operations

An independent read of `packages/core` (2026-09-25) raised a set of defects in the machinery this chapter builds on. Each was re-run against the same commit as the probes in [the orientation](00-orientation.md) before it was kept here; where the reading and the run disagreed, the run is what is written.

> **Measured.** Node 24, `packages/core` from source, commit `d373abc`. (1) `copy-section` rewrites text in its clipboard HTML: for the source `` `a data-marxy-k="9" b` `` the clipboard flavour is `<code>a b</code>`, and a fenced html block holding `<div class="x" data-marxy-s="3">` copies as `<div class="x">`. The plain-text flavour is exact. The cause is two regular expressions over rendered HTML in `copy-section.ts` that strip `data-marxy-*` attributes and `<script>`, run over text the renderer escaped without escaping `"` (`sanitize/escape.ts`). (2) `sectionRange` reads only top-level children: for `# A`, then `> ## Q`, then a body line inside the quote, then `## After`, the range for the nested heading is bytes 7 to 22, which starts after the `> ` and ends past the quote's own bytes. The outline lists such headings, and `copySection.canApply` accepts them. (3) `splice` checks nothing: an inverted range `{start:2, end:1}` on `abc` yields `abZbc`, and a range past the end throws `Invalid typed array length: -94`. (4) A file whose lines end in bare CR is reported as `eol: 'none'`, so an edit would write LF into it. (5) A `[a]: https://…` link reference definition is dropped from the AST: no node owns its bytes. (6) A task item whose first inline is a code span has `task: 'checked'` and no `taskMarker` node, so it cannot be toggled; a plain first inline works.

The consequences for this chapter:

- **The fidelity property was weaker than `docs/operations.md` says, and MARXY-43 has half closed it.** The document promises that for every corpus file and every operation at every applicable node, the bytes outside the range are identical. At `d373abc`, `operations.test.ts` asserted only `replacement === text` (trivially true of a copy), walked headings, the document and code blocks, and read `.md` files only, so it would have passed an operation that returned the wrong range. Main has since landed `toggle-task` and `align-table-pipes` and a second test, *mutations change only their range over the corpus*, which splices each mutating operation's replacement into the file bytes and asserts the prefix and suffix are identical, for every task marker and table in the `.md` corpus (re-checked on `7e0a280`). What remains: the non-markdown corpus files are still skipped, no node kind other than a task marker and a table is exercised by a mutating operation, and `splice` itself still validates nothing. Every operation proposed in [Part C](#part-c-operations-under-the-frozen-contract) that mutates (`strip-invisible`, `escape-invisible`, `format-json`) needs the property extended to its own node kinds before it ships.
- **A clean-copy operation must not regex rendered HTML.** The remedy is to render without provenance, or to remove the renamed secret attributes before publication, so no pattern is run over document text. This is the same rule as `copy-command`: an operation that changes what a reader copies must say so in `summary`, and here it changed it silently.
- **Section operations need a nesting-aware source map.** `copy-anchor` and `copy-with-reference` on a heading inside a blockquote or list resolve to a range that cuts the container. `nodeAt` returns blocks only, so a `taskMarker`, the toggle target, cannot be reached by byte.
- **Nothing owns definition bytes.** A `path:L-M` reference or a stable anchor that lands on a reference definition finds no node; the anchor's resolution order (offsets, then context) still works, and the chapter's fallback to a text quote is what covers it.

> **Operation.** No new operation follows from this; three preconditions do. A `provenance: none` rendering option, or an attribute strip keyed to the secret names, before any HTML clipboard flavour is trusted. A `splice` that refuses inverted, out-of-range and mid-character ranges. The existing mutation property extended to non-markdown corpus files and to every node kind a mutating operation can apply to. All three are core-only and touch no frozen contract.

## What remains taste

Whether add/delete are a line tint, a coloured marker or coloured text; how loud a changed-since-last-read margin rule may be; whether a wrapped continuation's rule is enough. Each needs a before/after artifact for the taste queue.

## Sources not read in full

Abstract only: Bacchelli and Bird, Baum et al., Fregnan et al., Nugroho et al., Glodny, Myers. Abstract or search-result summary only: Alcocer et al., Uwano et al., Phelps and Wilensky (full texts not read). The GitHub suggestion-syntax page and the GitHub behaviour on rendered markdown were not retrieved.

[^bacchelli-bird]: Alberto Bacchelli and Christian Bird, "Expectations, outcomes, and challenges of modern code review", *ICSE 2013*, pp. 712–721, 2013 (abstract only). [doi.org/10.1109/ICSE.2013.6606617](https://doi.org/10.1109/ICSE.2013.6606617). Accessed 2026-09-25.
[^baum-wm]: Tobias Baum, Kurt Schneider and Alberto Bacchelli, "Associating working memory capacity and code change ordering with code review performance", *Empirical Software Engineering* 24(4):1762–1798, 2019 (abstract only). [zenodo.org/records/2001923](https://zenodo.org/records/2001923). Accessed 2026-09-25.
[^fregnan]: Enrico Fregnan, Larissa Braz, Marco D'Ambros, Gül Çalikli and Alberto Bacchelli, "First come first served: the impact of file position on code review", *ESEC/FSE 2022*, pp. 483–494 (abstract only). [arxiv.org/abs/2208.04259](https://arxiv.org/abs/2208.04259). Accessed 2026-09-25.
[^uwano]: Hidetake Uwano, Masahide Nakamura, Akito Monden and Ken-ichi Matsumoto, "Analyzing individual performance of source code review using reviewers' eye movement", *ETRA 2006*, pp. 133–140 (search-result summary of the abstract only). [okayama.elsevierpure.com](https://okayama.elsevierpure.com/en/publications/analyzing-individual-performance-of-source-code-review-using-revi/). Accessed 2026-09-25.
[^alcocer]: Juan Pablo Sandoval Alcocer, Alejandra Cossio Chavalier, Tiara Rojas-Stambuk and Leonel Merino, "An Eye-Tracking Study on the Use of Split/Unified Code Change Views for Bug Detection", *IEEE Access* 11:136195–136205, 2023 (search-result summary of the abstract only; publisher page not retrievable). [ieeexplore.ieee.org/document/10328768](https://ieeexplore.ieee.org/document/10328768/). Accessed 2026-09-25.
[^glodny]: Niels Glodny, "Analyzing and Evaluating the Behavior of Git Diff and Merge", bachelor's thesis, 2025 (abstract only). [arxiv.org/abs/2507.22071](https://arxiv.org/abs/2507.22071). Accessed 2026-09-25.
[^myers]: Eugene W. Myers, "An O(ND) difference algorithm and its variations", *Algorithmica* 1:251–266, 1986 (abstract only). [link.springer.com/article/10.1007/BF01840446](https://link.springer.com/article/10.1007/BF01840446). Accessed 2026-09-25.
[^nugroho]: Yusuf Sulistyo Nugroho, Hideaki Hata and Kenichi Matsumoto, "How different are different diff algorithms in Git?", *Empirical Software Engineering* 25:790–823, 2020 (abstract only). [arxiv.org/abs/1902.02467](https://arxiv.org/abs/1902.02467). Accessed 2026-09-25.
[^gitdiff]: Git project, "git-diff" documentation: `--diff-algorithm`, `--color-moved`, `--word-diff`, `-w`/`-b` (docs page). [git-scm.com/docs/git-diff](https://git-scm.com/docs/git-diff). Accessed 2026-09-25; outputs also measured with git 2.55.0.
[^difftastic]: Wilfred Hughes, difftastic, LICENSE: MIT (source). [github.com/Wilfred/difftastic](https://raw.githubusercontent.com/Wilfred/difftastic/master/LICENSE). Accessed 2026-09-25. The description "syntax-tree diff, CLI" is not verified from its README in this session.
[^gumtree]: GumTree, LICENSE: GNU LGPL v3 (source). [github.com/GumTreeDiff/gumtree](https://raw.githubusercontent.com/GumTreeDiff/gumtree/main/LICENSE). Accessed 2026-09-25.
[^dmp]: Google, diff-match-patch, LICENSE: Apache-2.0 (source). [github.com/google/diff-match-patch](https://raw.githubusercontent.com/google/diff-match-patch/master/LICENSE). Accessed 2026-09-25.
[^ghsuggest]: GitHub Docs, "Incorporating feedback in your pull request": suggested changes and batching (docs page; syntax not shown in the excerpt retrieved). [docs.github.com](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/incorporating-feedback-in-your-pull-request). Accessed 2026-09-25.
[^vscode]: Microsoft, VS Code `extensions/markdown-language-features/src/markdownEngine.ts` (source read), MIT; and issue #133376 on source-map coverage (docs page). [github.com/microsoft/vscode/issues/133376](https://github.com/microsoft/vscode/issues/133376). Accessed 2026-09-25.
[^cmark]: GitHub, cmark-gfm man page, `--sourcepos` (docs page). [github.com/github/cmark-gfm](https://github.com/github/cmark-gfm/blob/master/man/man1/cmark-gfm.1). Accessed 2026-09-25.
[^obsidian]: Obsidian, API type definitions, `MarkdownSectionInformation` and `getSectionInfo` (source). [github.com/obsidianmd/obsidian-api](https://raw.githubusercontent.com/obsidianmd/obsidian-api/master/obsidian.d.ts). Accessed 2026-09-25.
[^typora]: Typora Support, "Quick Start": copy as HTML by default, Copy as Markdown, source-copy preference (docs page). [support.typora.io/Quick-Start](https://support.typora.io/Quick-Start/). Accessed 2026-09-25.
[^ghperma]: GitHub Docs, "Getting permanent links to files" (docs page). [docs.github.com](https://docs.github.com/en/repositories/working-with-files/using-files/getting-permanent-links-to-files). Accessed 2026-09-25.
[^w3c]: W3C, "Web Annotation Data Model", Recommendation 23 February 2017, TextQuoteSelector and TextPositionSelector (docs page). [w3.org/TR/annotation-model](https://www.w3.org/TR/annotation-model/). Accessed 2026-09-25.
[^textfrag]: WICG, "URL Fragment Text Directives" (draft; docs page). [wicg.github.io/scroll-to-text-fragment](https://wicg.github.io/scroll-to-text-fragment/). Accessed 2026-09-25.
[^hypfuzzy]: csillag, "Fuzzy Anchoring", Hypothesis blog, 22 April 2013 (docs page). [web.hypothes.is/blog/fuzzy-anchoring](https://web.hypothes.is/blog/fuzzy-anchoring/). Accessed 2026-09-25.
[^hyplic]: Hypothesis client, LICENSE: BSD-2-Clause, with the annotator subcomponent MIT (source). [github.com/hypothesis/client](https://raw.githubusercontent.com/hypothesis/client/main/LICENSE). Accessed 2026-09-25.
[^phelps]: Thomas A. Phelps and Robert Wilensky, "Robust intra-document locations", *Computer Networks* 33:105–118, 2000 (bibliographic record via search only; abstract not read). [semanticscholar.org](https://www.semanticscholar.org/paper/Robust-intra-document-locations-Phelps-Wilensky/bf3a9da17f9dbeb2d2d09f4d562c903e4e9b2f2e). Accessed 2026-09-25.
