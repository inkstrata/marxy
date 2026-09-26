# Reader Artifacts Spec

*The recommendations of the whole handbook, stated as a specification: what a reader shows by default for each kind of non-prose content, the range a reader may change it within, the operations that follow from byte provenance, the rules that couple them, the decisions that were not obvious, and the checks that verify an implementation. Every line carries its evidence grade, links the chapter that argues for it, and says whether Marxy does it today. Where two chapters disagreed, the disagreement is settled here in the open.*

Evidence grades: **[A]** replicated findings or a meta-analysis · **[B]** one well-designed study · **[C]** small, limited or mixed studies · **[D]** expert convention, or convergence of shipping tools, without a direct test · **[X]** contested or contradicted. Part of the [Reader Artifacts Handbook](README.md).

**Read this first.** Almost every line below is **[D]**, and that is the finding, not a defect of the handbook. The empirical literature on reading code, logs and agent transcripts is narrow and mostly does not test a presentation choice ([Reading tasks](01-reading-tasks.md)). A **[D]** here means a reasoned default that follows from Marxy's commitments and from what shipping tools do; it is a claim about what readers expect, not proof that it helps them. The lines that rest on measurement (contrast, distinguishability, what Marxy renders today) say **Measured**. Numbers marked *judgement* are starting points for a taste review, not conclusions.

"Marxy today" uses three words. **Applied**: the code does it and a test or gate holds it. **Open**: it does not do it yet. **Contradicted**: it does something that this line says is wrong. All statements about the code were checked against commit `d373abc` (see [the orientation](00-orientation.md)).

## Defaults and ranges

### Content that must not vanish

| Setting | Default | User range | Grade | Why (chapter) | Marxy today |
|---|---|---|---|---|---|
| Front matter, YAML and TOML | A quiet key and value head above the first block: 15 px lines on the grid, key in the label voice with a 14ch column, values at the measure, nested lines verbatim in the code face, at most 12 lines then a text count of the rest. Never rewritten, unknown keys shown | Hidden by a summoned toggle | **[D]** (converged: 2 of 2 viewers checked) | Skills, rules and plans lead with it; the agent reads it ([Agent artifacts](02-agent-artifacts.md), [Structured output](03-structured-output.md)) | **Contradicted**: rendered as nothing (`render-html.ts`, `frontmatter` case) |
| XML-style prompt tags, e.g. `<instructions>` | Keep the children; show the tag name as a small inline label; never remove content | Fixed | **[D]** | A prompt file's meaning is inside its tags ([Agent artifacts](02-agent-artifacts.md)) | **Contradicted**: an unknown element is removed with its contents (measured, probe `prompt-xml-block`) |
| HTML comments and other removals | A notice in the existing notices region counts what was removed, and a summoned list jumps to each range in Source. Show the reader everything an agent would read | Dismissible | **[D]** | A human sees less than the agent does ([Trust and safety](07-trust-safety.md), [Agent artifacts](02-agent-artifacts.md)) | **Contradicted**: removals reach only `console.info` (`app.ts`) |
| Instruction-class files (`AGENTS.md`, `CLAUDE.md`, `SKILL.md`, rules) | The notice above appears at rest for these files when a comment or unknown tag was removed; for every other file it is a lens | Dismissible | **[D]** | The risk is asymmetric for files an agent obeys ([Trust and safety](07-trust-safety.md)) | **Open** |
| Fold state of authored `<details>` | Honour the author's open or closed state; summary as a bold run-in line with a text glyph; Find opens closed ancestors; "open all" is a view state | Reader may open all | **[D]** | Author's structure; find into hidden content is unreliable ([READMEs](06-readmes.md)) | **Contradicted**: transparent, always rendered open; under the wide policy a blank-line body renders outside it (measured) |
| Anything the author did not fold | Not folded. A fenced tool result stays a fence | Fixed | **[D]** | Chrome at rest is zero; hiding is a decision the reader makes ([Agent artifacts](02-agent-artifacts.md)) | **Applied** |

### Code, data and logs

| Setting | Default | User range | Grade | Why (chapter) | Marxy today |
|---|---|---|---|---|---|
| Code face, size and line box | JetBrains Mono 18 px on a 30 px line (two grid units); x-height 97.6 % of the text's. The typography handbook owns the number | Follows the reader's size setting | **[D]** | Sibling's spec; recomputed in [Code as read](04-code-typography.md) | **Applied** |
| Ligatures | Off in Rendered and in Source | Fixed | **[D]** | Verbatim text; sibling [`06-code.md`](../reader-typography/06-code.md), and [Code as read](04-code-typography.md) | **Applied** in Rendered; **Open** in Source (nothing disables them for the editor content; inferred from code, not measured in the app) |
| Wrap | Keep ADR-0033: wrap with a 2ch hang and a 1 px rule. A no-wrap scroller for diff, patch, log, console and ASCII-art fences is a **proposal for an amendment**, not a default | Fixed by content class | **[D]** | No study compares wrapped and scrolled code; scrolling costs a scrollbar and a focus stop per block ([Code as read](04-code-typography.md)) | **Applied** (wrap everywhere) |
| Tab width | 4 by default; in Source mode with a known path, `.editorconfig` `tab_width`, else numeric `indent_size`, bounded 1 to 8 | Reader setting 1 to 8 | **[D]** | `tab-size` defaults to 8; indentation-width evidence is contested ([Code as read](04-code-typography.md)) | **Open**: constant 4 |
| Line-number gutter | Off in Rendered at rest. On by default in Source for non-markdown files. Numbers are generated content, hung in the left margin, never selectable text | Reader toggle | **[D]** | Locating by `file:line` is the task; no study shows numbers help ([Reading tasks](01-reading-tasks.md)) | **Open**: Source passes `lineNumbers: false` |
| Line numbers in copied text | Never | Fixed | Measured | CSS counters, an `aria-hidden` column and `user-select: none` spans all stayed out of `text/plain` and `text/html` in WebKit 26.6 and Chromium 153 (headless, not the shipped app) ([Code as read](04-code-typography.md)) | **Applied** by construction |
| Colour budget of a block | Four token hues plus text; status meaning by an in-text character first, then a low-chroma line tint; never a foreground hue | Fixed | **[D]** | Sibling: colour aids navigation, not comprehension ([Code as read](04-code-typography.md)) | **Applied** for tokens |
| Long inline code (paths, URLs) | Fits the measure: unbreakable. Wider: allow a break after `/` only, at a higher cost than a space, as a third pass; last resort `overflow-wrap: anywhere`; never at a hyphen | Fixed | **[D]** | Engines never break after `/`, `.` or `_`; `url.sty` also breaks after `.` and `_` ([Code as read](04-code-typography.md)) | **Open**: the fallback reaches `break-word` |
| JSON, YAML and TOML | Verbatim, existing token classes; no type inference, no resolved values | Fixed | **[D]** | The reader shows what is there; YAML 1.1 and 1.2 disagree on types ([Structured output](03-structured-output.md)) | **Applied** |
| Data fence folding (Rendered) | None at rest. A summoned lens folds to depth 2 for a data fence over 60 lines (*judgement*); the placeholder is text with the omitted line count | Depth 1 to 4 from the keyboard | **[D]** | 60 items pretty-print to 544 lines, 64 at depth 2 ([Structured output](03-structured-output.md)) | **Open** |
| Source-mode folding | `codeFolding` with a text placeholder and a fold gutter where line numbers show; never persisted | Fixed | **[D]** (converged: 3 of 3 tools read) | View-only in CodeMirror 6, VS Code and Firefox ([Structured output](03-structured-output.md)) | **Open**: no folding installed |
| Very long lines | Lines over 1,000 characters are drawn as their first 200 plus a text marker with the count; copy takes every byte (*judgement*) | Threshold adjustable | **[D]** | Minified blobs defeat wrap and find ([Structured output](03-structured-output.md)) | **Open** |
| Log level | Carried by the level word in weight 700, not by hue; timestamps in the comment colour. A `log` grammar stays off until a weight class exists | Fixed | **[D]** | WCAG 1.4.1; the Shiki `log` grammar draws ERROR and every trace line as a string (measured) ([Structured output](03-structured-output.md), [Colour and access](09-colour-access.md)) | **Open**: no log grammar |
| Stack traces | Never folded at rest | Fixed | **[C]** | Traces help fixing bugs; no study of reading them ([Structured output](03-structured-output.md)) | **Open** |
| ANSI escapes | Rendered: show `␛` as a visible glyph in the comment colour and do not render SGR colour. Source: `highlightSpecialChars` | A clean-view lens may hide sequences for display | **[D]** | ECMA-48 SGR 8 conceals text; colour and concealment are separate parameters, so no-colour is a judgement ([Structured output](03-structured-output.md)) | **Contradicted**: ESC arrives invisible (probe `ansi-in-fence`) |
| Console fences | Allow-list a `shellsession` grammar (aliases `console`, `bash session`); the prompt takes the punctuation class; output stays plain | Fixed | **[D]** | An `sh` fence colours `$` as a function (measured) ([Structured output](03-structured-output.md)) | **Contradicted** |
| CSV and TSV fences | Verbatim plain; do not allow-list the `csv` grammar (it colours columns in rotation); a table only through a summoned lens | Fixed | **[D]** | ([Structured output](03-structured-output.md)) | **Applied** |

### Diffs and provenance

| Setting | Default | User range | Grade | Why (chapter) | Marxy today |
|---|---|---|---|---|---|
| Diff layout | Unified, one column, as authored; never converted to split | Fixed | **[C]** | One 12-participant study leans weakly to unified, not significant ([Diffs and provenance](05-diffs-provenance.md)) | **Applied** |
| Diff markers | `+`, `-` and space in column one stay in the text and in the clipboard. Colour is a second channel only | Fixed | **[D]** | WCAG 1.4.1; forced colours removes backgrounds ([Colour and access](09-colour-access.md)) | **Applied** |
| Diff colour | Tint `markup.inserted` and `markup.deleted` lines; hunk headers and the `\ No newline` line stay in plain code colour | The theme may set the two colours | **[D]** | Every published palette fails a token somewhere on word highlights (measured, 10 of 10) ([Colour and access](09-colour-access.md)) | **Open**: renders monochrome |
| Diff tints, dark on `#1d1c19` | Line added `#1b2f28`, removed `#2d140b`; word added `#1f4438`, removed `#4a1e0e`. Lowest Marxy token 4.91:1 | Fixed | **[D]** (contrast: Measured) | Distinguishable by lightness and marker under all three CVD simulations, tritan approximate ([Colour and access](09-colour-access.md)) | **Open** |
| Diff tints, light on `#f1eee8` | Line added `#cce3c6`, removed `#ffe7e6`; word added `#c0e2b8`, removed `#ffdcdb`. Lowest token 4.60:1. The removed tint is close to decoration; the `-` marker carries the cue | Fixed | **[D]** (contrast: Measured) | ([Colour and access](09-colour-access.md)) | **Open** |
| Diff continuation rows | Hang at least 2ch past the marker column with the rule; a row never starts in column one | Fixed | **[D]** | A wrapped line must not read as a new `+` or `-` ([Diffs and provenance](05-diffs-provenance.md)) | **Open**: unverified for diff fences |
| Diff computation | Render what was authored. When Marxy must compute one, a line-level histogram diff in core | Fixed | **[C]** | One Java study, contradicted by pathological cases ([Diffs and provenance](05-diffs-provenance.md)) | **Open** |
| Copy of a drag selection in prose | Rendered text, as design 03 says | Fixed | **[D]** | Convention: what you see is what you copy ([Diffs and provenance](05-diffs-provenance.md)) | **Applied** |
| Copy of code, `kbd` and inline code | Exact source bytes. The smart-typography pass never touches them | Fixed | **[D]** | `--frozen-lockfile` pastes with an en dash today ([Trust and safety](07-trust-safety.md)) | **Contradicted**: smart typography reaches `kbd` (measured) |
| Trailing newline on copy | A block copy ends with one newline only if the source did; a single command copies with none | Fixed | **[D]** | A pasted command must not execute on paste ([Trust and safety](07-trust-safety.md), [READMEs](06-readmes.md)) | **Contradicted**: `copy-code-clean` appends `\n` to any non-empty block |
| Jump to source | A summoned command opens Source at the element's `data-marxy-s`; nothing at rest | Palette or modified click | **[D]** | Provenance already carries the byte ([Diffs and provenance](05-diffs-provenance.md)) | **Open** |
| Anchor | `{path, start, end, exact, prefix, suffix}` over source bytes with 32-character context; resolve by offsets, then unique context, then unique quote, else fail visibly; no fuzzy match | Fixed | **[D]** | `offsetThroughEdit` survives one edit site; edits above and below defeat it (measured) ([Diffs and provenance](05-diffs-provenance.md)) | **Open** |
| Changed since last read | On external reload, diff the last-read snapshot against the new buffer and mark changed blocks with a summoned margin rule. Local snapshot only, never written | Dismissible | **[D]** | Regenerated agent files are the defining case (ADR-0018) ([Diffs and provenance](05-diffs-provenance.md), [Agent artifacts](02-agent-artifacts.md)) | **Open** |

### Agent artifacts and READMEs

| Setting | Default | User range | Grade | Why (chapter) | Marxy today |
|---|---|---|---|---|---|
| Speaker labels in a transcript | An outdented label per turn (you, agent, tool); message at the 66-character measure; 30 px between exchanges, 15 px within. Colour never carries the speaker | Label wording | **[D]** | Sibling `07-content-types.md`; no study of transcript formatting ([Agent artifacts](02-agent-artifacts.md)) | **Open** |
| Derived transcript view (JSONL) | Source stays the default for `.jsonl`. A summoned, read-only derived view keeps provenance to the JSONL line. A tool call is one line at rest | On or off | **[D]** | Only 503 of 941 lines in one session file were conversation ([Agent artifacts](02-agent-artifacts.md)) | **Open** (needs an AST decision) |
| Long tool output in the derived view | Bound it. A start of 30 lines, first 10 and last 10 with the omitted count as text, is a *judgement*: Codex shows 5 (50 for a user command), VS Code 30 as a scroll height. The two that document a number disagree six-fold | Threshold 10 to 100 | **[D]** (converged on *bounding by line count*: 2 of 5 surfaces; on *the number*: none) | ([Agent artifacts](02-agent-artifacts.md), [Teardown](08-teardown.md)) | **Open** |
| Thinking blocks | Behind a click in a derived view | Reader opens | **[D]** | Claude.ai's help page puts thinking behind a click (1 tool documented); the rest not documented ([Teardown](08-teardown.md)) | **Open** |
| Task items | Every task item is a checkbox, including one that starts with a code span | Fixed | **[D]** | Toggle-task is the checklist case ([Agent artifacts](02-agent-artifacts.md)) | **Contradicted**: code span, bold, italic and link openers lose the marker (measured) |
| Badge row | Two or more consecutive image-only links collapse to one muted line of alt texts joined by a middle dot, links kept; per-host consent loads them on the grid | Fixed | **[D]** | Badges signal reliably but correlationally ([READMEs](06-readmes.md)) | **Open** |
| Hero alignment and image size | Honour `align` on `div`, `p` and headings, and `width` and `height` on images, in the default policy; inline, never floated | Fixed | **[D]** | Inert attributes; needs a sanitiser decision ([READMEs](06-readmes.md)) | **Open**: wide policy only |
| Dark and light image variants | Resolve `<picture>` sources and `#gh-dark-mode-only` fragments to one image for the active theme; fetch only that one | Fixed | **[D]** | ([READMEs](06-readmes.md)) | **Contradicted**: `source` removed, both fragment images show |
| GitHub alerts | Label-first run-in head: the type word in semibold at body size, marker hidden, no box, fill or icon; the type is never carried by colour | Fixed | **[D]** | Habituation to warnings transfers by analogy only ([READMEs](06-readmes.md), [Colour and access](09-colour-access.md)) | **Contradicted**: a literal `[!NOTE]` in a plain blockquote |
| Table striping | None; group by whitespace; header by weight | Fixed in v1 | **[C]** | Two web experiments, one of which points to a peer-reviewed paper that was not read ([READMEs](06-readmes.md)) | **Applied** |
| Diagram fences (v1) | Source plus one muted caption (`mermaid · diagram source`) | Fixed | **[D]** | Mermaid 12.0.0 depends on `elkjs` EPL-2.0, which the licence gate classes as unknown ([READMEs](06-readmes.md)) | **Open** |
| Heading anchors | `id` by the `github-slugger` algorithm with a `-n` suffix for duplicates; no visible permalink | Fixed | **[D]** | Relative links and `#` links depend on them ([READMEs](06-readmes.md)) | **Open**: headings carry no `id` |
| Emoji shortcodes | Convert `:name:` in text nodes only from a bundled MIT table; buffer and copy keep the shortcode | Fixed | **[D]** | GitHub renders them; CommonMark does not ([READMEs](06-readmes.md)) | **Open** |

### Trust

| Setting | Default | User range | Grade | Why (chapter) | Marxy today |
|---|---|---|---|---|---|
| Invisible and bidirectional characters | A visible inline marker: a 1ch hairline box in the code face with the code point in hex, at least 4.5:1. A run of tag characters collapses to one `tag ×N` mark and decodes on summon. Each bidi control sits in its own `unicode-bidi: isolate` span. Bytes never change. Emoji ZWJ, Persian ZWNJ, LRM, RLM and NBSP are never flagged | Marker style theme-tunable; rule table fixed | **[D]** (converged: bidi flagged by 4 of 4 tools) | Hidden bytes are demonstrated attacks; no study shows a marker changes behaviour ([Trust and safety](07-trust-safety.md)) | **Open**: bytes reach the page unmarked (probe) |
| Injection-looking prose | Never flagged. Hidden bytes are flagged; sentences are not | Fixed | **[D]** | Detectors are unreliable; semantics is not the reader's job ([Trust and safety](07-trust-safety.md)) | **Applied** |
| Link text that names another host | Append the destination host after the link text when the text looks like a URL or host whose host differs, in both punycode and Unicode forms; show the destination on focus or hover only | Fixed | **[D]** | Passive URL cues are weak; active inspection helps ([Trust and safety](07-trust-safety.md)) | **Open** |
| Blocked-image details | Per host: count, punycode and Unicode forms, query-string count and length; per-host checkboxes | Fixed | **[D]** | Markdown-image exfiltration is the case for consent ([Trust and safety](07-trust-safety.md)) | **Open**: the fetch behind the opt-in is unbuilt |
| Reserved ids and classes from documents | Refuse `id` or `name` starting `marxy-` whatever attributes the tag carries; refuse the `marxy-` class prefix; refuse ids that shadow `window` or `document` | Fixed | Measured | Reproduced: `<h2 id="marxy-fn-1" data-marxy-s="0">` survives the full pipeline ([Trust and safety](07-trust-safety.md)) | **Contradicted** |

## Operations

Every operation is a pure `string → string` or `string → clipboard` function under the frozen contract, offered only when the selection matches, one undo step. Names below are proposals. An operation marked *view* changes no bytes and no clipboard, and is not an `Operation` at all (see the gap list).

| Operation | Applies to | Signature | Grade | Why (chapter) | Expressible now |
|---|---|---|---|---|---|
| `copy-source` | block, section, document | string → clipboard | **[D]** | Exact bytes of a rendered selection ([Diffs and provenance](05-diffs-provenance.md)) | Yes; `copy-section` already exists |
| `copy-command` | block (shell or console fence) | string → clipboard | **[D]** | Drops a leading `$ ` (and `% `, and `#` only in console languages), keeps continuations and here-documents, no trailing newline, refuses on terminal-affecting Unicode ([READMEs](06-readmes.md)) | Yes |
| `copy-diff-after` and `copy-diff-before` | block (single-file unified diff) | string → clipboard | **[D]** | Copy one side without markers; no trailing newline after `\ No newline` ([Diffs and provenance](05-diffs-provenance.md)) | Yes |
| `copy-with-reference` | block, section | string → clipboard | **[D]** | Adds a `path:L-M` line ([Diffs and provenance](05-diffs-provenance.md), [Code as read](04-code-typography.md)) | **No**: `OperationInput` lacks the whole source |
| `copy-anchor` | block, section | string → clipboard | **[D]** | ([Diffs and provenance](05-diffs-provenance.md)) | Partly: no prefix or suffix |
| `extract-code-blocks`, `extract-tasks`, `extract-links` | section, document | string → clipboard | **[D]** | v1.1 candidates already ([Reading tasks](01-reading-tasks.md), [Trust and safety](07-trust-safety.md)) | Yes |
| `copy-json-pretty`, then `format-json` and `minify-json` | span, block | string → clipboard, then string → string | **[D]** | A token-level reflow, never parse-then-stringify ([Structured output](03-structured-output.md)) | Yes (clipboard first) |
| `strip-ansi` | span, block | string → clipboard | **[D]** | ([Structured output](03-structured-output.md)) | Yes |
| `copy-front-matter` | block | string → clipboard | **[D]** | ([Structured output](03-structured-output.md), [Agent artifacts](02-agent-artifacts.md)) | Yes |
| `strip-invisible` and `escape-invisible` | span to document | string → string | **[D]** | The only splice the trust chapter proposes ([Trust and safety](07-trust-safety.md)) | Yes, once the fidelity property exists |
| `copy-without-invisible` and `copy-hidden-as-text` | span to document | string → clipboard | **[D]** | ([Trust and safety](07-trust-safety.md)) | Yes |
| `copy-turn`, `copy-tool-output`, `copy-user-prompts` | block, document (derived view) | string → clipboard | **[D]** | ([Agent artifacts](02-agent-artifacts.md), [Teardown](08-teardown.md)) | Only with a derived transcript |
| `toggle-task` | block (the marker) | string → string | **[D]** | Landed with MARXY-43; unavailable for task items that begin with a code span, strong, emphasis or a link, because no marker node exists ([Agent artifacts](02-agent-artifacts.md)) | Yes, for items that have a marker |
| `reveal-hidden`, jump to source, changed-since-last-read | document | *view* (no splice) | **[D]** | Lenses feed no splice ([Trust and safety](07-trust-safety.md), [Diffs and provenance](05-diffs-provenance.md)) | **No**: not an `Operation` |

## Coupling rules

1. **A tint never carries meaning alone.** Every tinted unit (diff line, log level, alert) also carries meaning in text: a marker, a word, a weight. Under `forced-colors: active` and `prefers-contrast: more` the backgrounds vanish or are replaced, so the text channel must be enough ([Colour and access](09-colour-access.md)).
2. **Every unit is a grid multiple.** A fold, a front matter head, a gutter, a notice and a label are islands the grid pass pads (ADR-0030); a unit that adds a line adds whole grid units.
3. **Folding is a view.** A fold, an elision and a lens never change what is copied, found or spliced. Copy takes every byte; Find opens what it must ([Structured output](03-structured-output.md), [READMEs](06-readmes.md)).
4. **A marker is display-only.** It is generated content or a span the reader can hide, never a byte in the buffer, never text a copy carries.
5. **Hidden content is never removed silently.** If the renderer drops something the author wrote, the reader is told, and the bytes remain one step away in Source ([Trust and safety](07-trust-safety.md)).
6. **Code inherits the article weight and never the reader's spacing.** 380 on dark and 400 on light; no letter or word spacing; no smart typography inside `code`, `kbd` or a fence ([Code as read](04-code-typography.md)).
7. **A token needs a reader and a check.** Nothing joins the theme contract unless a stylesheet reads it and a gate can fail on it ([Colour and access](09-colour-access.md)).

## Overrides by artifact type

| Artifact | Fold at rest | Wrap | Copy | Trust marker | Chapter |
|---|---|---|---|---|---|
| README | Honour authored `<details>` | Wrap | Prose as rendered; install command by `copy-command` | Blocked remote images by host; link mismatch label | [READMEs](06-readmes.md) |
| Plan or todo list | None | Wrap | `extract-tasks` | Hidden comments in instruction files | [Agent artifacts](02-agent-artifacts.md) |
| Transcript (markdown) | None | Wrap | By turn | As any file | [Agent artifacts](02-agent-artifacts.md) |
| Transcript (JSONL) | Derived view only, summoned | Source: as authored | By turn or tool output | Invisible characters | [Agent artifacts](02-agent-artifacts.md) |
| Instruction file | None | Wrap | Exact bytes | Notice at rest for removed content and hidden characters | [Trust and safety](07-trust-safety.md) |
| Data fence (JSON, YAML, TOML) | None; a summoned depth lens over 60 lines | Wrap | Exact bytes; `format-json` splices | None | [Structured output](03-structured-output.md) |
| Log or terminal output | None | Wrap; scroll is a proposal | `copy-command`, `strip-ansi` | `␛` glyph | [Structured output](03-structured-output.md) |
| Diff | None | Wrap with hang; scroll is a proposal | `copy-diff-after` and `-before` | As any file | [Diffs and provenance](05-diffs-provenance.md) |
| Source file | Fold gutter in Source | Wrap with hang | `copy-with-reference` (blocked) | Invisible characters, bidi | [Code as read](04-code-typography.md) |

## Decisions

Short records of the choices that were not obvious, in the style of architecture decision records.

### Copy: rendered text for prose, exact bytes for code

**Context.** Three chapters disagreed. [Reading tasks](01-reading-tasks.md) proposed that Rendered-mode copy return provenance-resolved source bytes. [Diffs and provenance](05-diffs-provenance.md) found that a click-selected node already runs a `copy-*` operation (a section copies source), and that only a drag selection copies DOM text. [Trust and safety](07-trust-safety.md) found the live bug: `--frozen-lockfile` pastes with an en dash.
**Decision.** A drag selection in prose copies rendered text, as design 03 says, because "what you see is what you copy" is the convention and a drag cannot honestly resolve to bytes (ADR-0004 and design 03). Text that is code, `kbd` or a fence copies exactly, and the smart-typography pass never runs on it. Source bytes are one named operation away.
**Consequences.** The en dash inside prose (a bare flag not written in backticks) remains a residual trap the reader may still hit; the mitigation is the named operation, not a heuristic that guesses what is code.

### No number for folding tool output is evidenced

**Context.** [Agent artifacts](02-agent-artifacts.md) proposed 30 lines and a 10 + 10 head and tail. [Teardown](08-teardown.md) found Codex at 5 lines per call and 50 for a user command, VS Code at 30 as a scroll height, and Claude Code and Jupyter without a documented number. [Structured output](03-structured-output.md) proposed 60 lines and depth 2 for data.
**Decision.** The spec bounds tool output in a derived view and lists every number as *judgement*, to be set by a taste review from a before-and-after artifact. It sets no fold for authored content at rest.
**Consequences.** Three chapters' numbers are defaults to argue with, not results.

### Front matter is shown

**Context.** Marxy renders front matter as nothing while skills, rules and plans lead with it, and GitHub and Obsidian both show it. [Agent artifacts](02-agent-artifacts.md) proposed a head in the label style; [Structured output](03-structured-output.md) gave the numbers.
**Decision.** A quiet key and value head with the numbers in the table above, hidden by a summoned toggle.
**Consequences.** A theme must style the head, which adds a class to the registry.

### Wrapping stays

**Context.** [Code as read](04-code-typography.md) argued for a scroller on diffs and logs. ADR-0033 point 5 decided wrapping to keep chrome at rest zero; the evidence does not favour either.
**Decision.** The scroller is recorded as a proposal for an amendment, with its cost stated. Nothing changes until the author accepts one.

### Colour follows the text channel

**Context.** All ten published diff palettes fail a token on word highlights, and red and green collapse under deutan simulation.
**Decision.** Tints are backgrounds only, the marker is the primary cue, added is the emphatic line and removed sits near the ground. The asymmetry is a choice, flagged for taste review, not a consequence of contrast headroom.

## A token sketch

Proposed names and defaults, **not in the contract**. Adding a token needs a registry entry and, per ADR-0031, a story with a queue row; the names and kinds need an ADR.

```css
:root {
  /* diff, dark ground #1d1c19 (Measured, chapter 9) */
  --marxy-diff-add-line: #1b2f28;   --marxy-diff-del-line: #2d140b;
  --marxy-diff-add-word: #1f4438;   --marxy-diff-del-word: #4a1e0e;
  /* front matter head */
  --marxy-size-meta: 15px;          /* already the caption token; read by nothing today */
  --marxy-meta-key-col: 14ch;
  --marxy-meta-max-lines: 12;
}
:root[data-marxy-variant="light"] {
  --marxy-diff-add-line: #cce3c6;   --marxy-diff-del-line: #ffe7e6;
  --marxy-diff-add-word: #c0e2b8;   --marxy-diff-del-word: #ffdcdb;
}
.marxy-diff-add { background: var(--marxy-diff-add-line); }
.marxy-diff-del { background: var(--marxy-diff-del-line); }
@media (prefers-contrast: more) {
  .marxy-diff-add { border-inline-start: 3px solid currentColor; }
  .marxy-diff-del { border-inline-start: 3px dashed currentColor; }
}
```

## Verification

Each check is one a machine can fail. The last group is what would need a person.

**Rendering probe.** Re-run `node docs/research/reader-artifacts/lab/probe.mjs`. Assert that every visible string the probe lists survives, that each removal is reported to the reader, and that no invisible code point reaches the page unmarked.

**Contrast.** Extend the aesthetics gate to every text-bearing computed style per fixture and variant, and to every text-on-tint pair (the four diff tints, the marker, the fold glyph, the focus ring), in both variants and for each user theme fixture. Fail below the threshold; do not round.

**Copy and edit fidelity.** Extend the property MARXY-43 added (each mutating operation spliced into the file bytes, prefix and suffix compared, over every task marker and table in the `.md` corpus) to every corpus file including non-markdown and to every node kind a mutating operation can apply to, with a negative control; keep `replacement === text` for copies. Assert that copying a `kbd` or code span yields its bytes, and that a one-line command copies with no trailing newline.

**Trust.** Vectors for a reserved `marxy-` id, an id that names a `window` member and an internal class, each with and without the public provenance attribute. A gate that parses the shipped `tauri.conf.json` CSP and fails on any `http(s):` source, `*`, `unsafe-eval` or a missing `base-uri`. `gate:no-network` unchanged.

**Grid.** Every new unit's top edge on a multiple of half a line box, ± 0.5 px, in the aesthetics gate's block walk.

**Forced colours, contrast preference, reduced motion, reflow.** Render the diff, log and alert fixtures under `forced-colors: active`, `prefers-contrast: more` and `prefers-reduced-motion: reduce`; assert the marker and word survive; run at 320 px and 400 % zoom and assert no page-level horizontal scroll.

**Keyboard.** Tab through a fixture with a fold, a table and a code block; every control is reachable with a visible focus ring; a fold is a real button with `aria-expanded`.

**Taste (a queue row, not a gate).** The diff tints, the alert label, the front matter head, the badge line, the invisible-character marker and the truncation numbers each need a before and after artifact ([stories](stories.md)).
