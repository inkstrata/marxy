# Reader Artifacts Handbook

*Groundwork for how a reader presents text that is not prose: the transcripts, tool output, plans, instruction files and prompts that AI agents produce; source code and diffs read rather than edited; logs and structured data; and READMEs, which mix all of these with prose. It asks the same three questions of every unit of content: what the evidence says a reader needs, what Marxy should do by default, and what the operation layer should expose. Every recommendation carries the grade of the evidence it rests on. Where the evidence is thin, the handbook says so.*

Evidence grades: **[A]** replicated findings or a meta-analysis · **[B]** one well-designed study · **[C]** small, limited or mixed studies · **[D]** expert convention, or convergence of shipping tools, without a direct test · **[X]** contested or contradicted. Part of the [Reader Artifacts Handbook](README.md).

## What this handbook is for

Marxy reads four kinds of content, in this order of priority: READMEs, AI and agent artifacts, source files, and prose. The [Reader Typography Handbook](../reader-typography/README.md) settles the fourth, and the typography of every other. It says how text is set: faces, sizes, leading, measure, line breaking, contrast. It says little about the other three as *structures*. What is a turn in a transcript, and how much of a tool's output should a reader see before asking? What should a diff look like when colour cannot carry it? What should happen to an HTML comment in `AGENTS.md`, which the agent reads and the reader's rendered view hides? What does byte provenance let a reader do with a regenerated plan that no other reader can?

Those are the questions here. The answers are written for the people who build Marxy: the engineer writing a render pass, the designer setting a default, the reviewer deciding whether a pull request did what the research asked.

It does not cover authoring, since Marxy writes nothing. It does not cover the typography the sibling handbook owns, except where a unit of content changes the answer (code blocks, which are both text and structure). It does not cover the palette, index or shell, except where they constrain a unit of content.

## Three ways to read it

If you want **the answers**, go to the [Reader Artifacts Spec](10-spec.md). It gives every default with a number where one exists, the grade behind it, the chapter that argues for it, and whether Marxy does it today.

If you are **building a feature**, start with the chapter that owns it, then read [the gap list](gaps.md): many recommendations need a decision before they can be built, and the gaps say which frozen file or policy stands in the way.

If you are **planning work**, read [the story list](stories.md), ordered by what a reader would notice first, and [the limits](limits.md): what would change these recommendations, and what no evidence can settle.

## The chapters

- **[1. Reading tasks and the evidence](01-reading-tasks.md)**: what readers do with non-prose content (skim, verify, locate, copy exactly, compare) and what code-reading, eye-tracking, log, diff and AI-assistance studies say about each.
- **[2. Agent artifacts](02-agent-artifacts.md)**: transcripts, turns and roles, tool calls and results, plans and todo lists, instruction files and prompts, as formats on disk and as things to read.
- **[3. Structured output, front matter and logs](03-structured-output.md)**: JSON, YAML, TOML, JSONL, front matter, logs, terminal sessions and ANSI escapes; folding and pretty-printing without touching a byte.
- **[4. Code as read](04-code-typography.md)**: monospace against the baseline grid, tabs, wrapping, line-number gutters, the colour budget, and code inside Knuth–Plass paragraphs.
- **[5. Diffs and provenance](05-diffs-provenance.md)**: how changes are reviewed and shown, and what `{file, start, end}` on every node makes possible: jump to source, exact-range copy, stable anchors, changed-since-last-read.
- **[6. READMEs as structured documents](06-readmes.md)**: badges, hero blocks, tables, alerts, collapsibles, diagrams, links and install commands.
- **[7. Trust and safety](07-trust-safety.md)**: untrusted agent output, hidden instructions, invisible and bidirectional characters, remote images as read receipts, and links, all under Marxy's four commitments.
- **[8. How other tools present artifacts](08-teardown.md)**: Typora, Marked 2, Obsidian, GitHub, VS Code, Zed, Warp, terminal agents, Claude and ChatGPT, and Jupyter, cited from their own documentation.
- **[9. Colour, contrast and access](09-colour-access.md)**: diff, alert and marker colours measured for contrast and colour-vision deficiency; forced colours; screen readers; keyboard.
- **[10. Reader Artifacts Spec](10-spec.md)**: the answers.
- **[11. Source ledger](11-sources.md)**: every source, graded, with what it shows and what it does not.

Beside the chapters: [gaps.md](gaps.md) and its [ADR drafts](proposals/), [stories.md](stories.md) with [stories.csv](stories.csv) in the board's format, and [limits.md](limits.md).

## How claims are graded

The grades are the sibling handbook's, letter for letter, so that a line in one spec can be weighed against a line in the other.

| Mark | Meaning | Example from this handbook |
|---|---|---|
| **[A]** | Replicated findings or a meta-analysis | Experts read code less linearly than prose |
| **[B]** | One well-designed study | A single large study of how the position of a file in a review affects the attention it gets |
| **[C]** | Small, limited or mixed studies | Effects of syntax colouring on program comprehension |
| **[D]** | Expert convention, or convergence of shipping tools, without a direct test | Collapsing long tool output behind a one-line summary |
| **[X]** | Contested or contradicted | Whether reviewers find more defects in split or unified diffs |

One departure in *emphasis*, not in scheme. The brief for this handbook asked that "strong convergence" of shipping tools count as [B]. It does not here, because a grade that means one thing in this handbook and another in the typography one cannot arbitrate between them (see [ADR-0035](../../adr/0035-artifact-presentation-follows-the-research.md)). Tools converge for engineering reasons as often as for readers' sake: a copy button is cheap, a fold is easy, a colour is the obvious second channel. So convergence stays **[D]**, and the text says how strong it is: "[D] (converged: 7 of 10 tools surveyed)". That is evidence that readers *expect* something, which matters for a reader, and not evidence that it *helps* them.

Engineering facts carry no grade: what a specification says, what a tool does, what Marxy's pipeline emits. They are cited to the specification, the source code, the implementer's documentation, or a measurement made for this handbook.

Most of this subject is **[D]**. The empirical literature on reading code is real but narrow: small samples, students more often than professionals, short snippets more often than files, and almost nothing on reading the artifacts agents produce, which did not exist in their present form before 2024. The handbook says so wherever it applies, rather than borrowing authority from studies of a different task.

## How sources were chosen

Primary sources wherever they exist: the paper, or its abstract on the publisher's page when the paper could not be read; the specification rather than an article about it; a tool's own documentation, changelog, source or issue tracker rather than a review of it; a project's LICENSE file for a licence. Recognised practitioner research (Nielsen Norman Group, for example) is used and labelled as such. Wikipedia, listicles, AI-generated summaries and vendor claims presented as evidence were excluded. Every source was fetched while the handbook was written, in September 2026, and carries its access date. None is cited from memory.

Every font, grammar or library the handbook recommends states its licence, read from the project itself. A copyleft or unknown licence disqualifies it from Marxy (ADR-0006); such projects may still appear as prior art.

The handbook was written as nine chapters researched in parallel, each followed by a separate skeptic pass that re-fetched the load-bearing sources, searched for counter-evidence, checked every claim about Marxy's own code, and downgraded, corrected or removed what did not survive. The skeptics' logs are kept in [data/](data/) beside each chapter's sources.

## What was measured for this handbook

Some questions have no published answer, and some claims about Marxy are only worth making if they are checked against the code. Three kinds of measurement were made. Each is reproducible from files in this folder.

**What Marxy renders today.** [`lab/probe.mjs`](lab/probe.mjs) runs 31 artifact cases through Marxy's real parse, render and sanitise pipeline and its highlighter, and records what reaches the page ([`lab/data/probe-results.json`](lab/data/probe-results.json)). The hostile characters are built from escapes in the script, never committed raw. Six findings recur through the chapters:

- **Content an agent reads, a reader does not see.** An XML-style prompt tag (`<instructions>…</instructions>`, as Anthropic's prompting guide recommends) is removed *with its contents*, block or inline. HTML comments are removed. Front matter, YAML or TOML, is rendered as nothing at all, so a skill's `name` and `description` and a rule file's `globs` and `alwaysApply` are invisible in Rendered mode. The removals are reported only to the developer console; no notice tells the reader.
- **Invisible characters reach the page unmarked.** Bidirectional overrides and isolates (the Trojan Source characters), zero-width characters, and Unicode tag characters (33 of them spelling a hidden sentence in the probe) are preserved byte for byte, which is right, and shown as nothing, which is not.
- **Diffs lose their second channel.** In a ` ```diff ` fence, `+` and `−` are classed as punctuation and the rest of each line as plain text. Added and removed lines are told apart only by their first character.
- **Machine-shaped fences get no structure.** There is no grammar for `console`, `shell-session`, `log`, `jsonl` or `suggestion`. An `sh` fence whose lines start with `$ ` colours the prompt as a function name. ANSI escape sequences arrive with an invisible ESC before each visible `[31m`.
- **README conventions fall back to plain markdown.** A GitHub alert renders as a blockquote beginning with a literal `[!NOTE]`. `<details>` renders open with its summary as a bare line of text with no provenance. A centred hero loses its `align`. A `<picture>` loses its dark-mode source, and a `#gh-dark-mode-only` image shows in both themes.
- **Links keep their deception.** A link whose visible text is one URL and whose destination is another renders with no mark. An internationalised homograph host is converted to punycode in the `href` and left in its confusable Unicode form in the text.

**Colour.** [Chapter 9](09-colour-access.md) measures the contrast and colour-vision-deficiency distinguishability of published diff palettes and proposes Marxy's own, with the method stated so the numbers can be recomputed.

**Engine behaviour.** [Chapter 4](04-code-typography.md) measures whether line numbers drawn by CSS stay out of copied text in WebKit and Chromium, which the sibling handbook listed as unverified.

These are measurements of one commit of Marxy and one version of each engine. Reproduce them before relying on them for another. They were taken at `d373abc` and re-checked at `7e0a280` after `main` moved (live reload, `toggle-task` and `align-table-pipes` landed): every finding above and in chapter 7 section 8 still reproduces, `lab/data/probe-results.json` was regenerated at `7e0a280`, and the one statement that changed is the fidelity-test finding in [chapter 5](05-diffs-provenance.md), which now says what MARXY-43 added.

## How this handbook relates to the typography handbook

They overlap on code blocks, on the measure (prose has one, code has its authored width), on the baseline grid (code and tables are islands the grid pass pads), and on colour. [ADR-0035](../../adr/0035-artifact-presentation-follows-the-research.md) states the rule: the typography handbook governs how any text is *set*; this one governs how a non-prose unit is *structured, marked, folded, trusted and operated on*; where both speak to the same property, the claim with the higher grade wins, and on equal grades the owner of the property wins. The overlap table in that ADR names every shared property and which handbook decides it.
