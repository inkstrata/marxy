# How other tools present artifacts

*This chapter looks at how twelve shipping tools show the things Marxy reads: READMEs, agent transcripts and tool output, source and diffs. It records what each tool's own documentation, source or issue tracker says, marks every gap "not documented", counts where the field agrees, and names the few things Marxy's architecture allows that none of the documentation read describes. It is evidence that something is expected, not that it helps a reader.*

Evidence grades: **[A]** replicated findings or a meta-analysis · **[B]** one well-designed study · **[C]** small, limited or mixed studies · **[D]** expert convention, or convergence of shipping tools, without a direct test · **[X]** contested or contradicted. Part of the [Reader Artifacts Handbook](README.md).

## Method

Every behavioural claim below cites a page, source file or issue fetched on 2026-09-25. Three limits apply throughout.

- **Summariser fetches.** Most docs pages were read through a fetch tool that returns a model-written summary of the page. Where a summary said a topic was absent, the tables say "not documented" (on that page), which is weaker than "the tool does not do it". Codex CLI and the Claude Code interactive-mode page were read from source and the saved page text, not from a summary.
- **Gaps are findings.** Where an obvious question (GitHub's code copy button, Zed's preview scroll sync, Warp's collapse) had no official page in reach, the cell says so instead of relying on third-party reports.
- **Design judgements** carry at most **[D]**. Engineering facts are ungraded. The tool set is what could be reached in one session, not a sample: counts are "of the tools surveyed".

Tools: Typora, Marked 2, Obsidian, GitHub, VS Code, Zed, Warp, Claude Code, Codex CLI, Claude.ai and ChatGPT web, JupyterLab. Earlier chapters already cite VS Code source, GitHub docs and Claude Code docs; those sources are reused, not refetched.[^vscode-nb][^vscode-md-src][^cc-interactive][^ghbidi][^vscode-uni]

## Profiles

### GitHub (markdown, code view, diffs)

- **Markdown.** Five alert types written as blockquotes with a bracketed keyword, rendered with colour and an icon; automatic heading anchors with a hover link icon; HTML comments hide content; `<picture>` is supported.[^gh-md] Mermaid renders from a fenced block; the page states no mechanism, network behaviour or limits.[^gh-mermaid] `<details>` content is collapsed unless the `open` attribute is given.[^gh-details] Front matter renders as a table of metadata in the page (a 2013 announcement, not re-checked against today's UI).[^gh-yaml]
- **Images.** GitHub proxies images and videos through its open-source Camo project, generating an anonymous URL for each; the docs say anyone who receives that URL can view the file.[^gh-camo] So, by the docs, remote images are rewritten to GitHub-hosted proxy URLs by default; that the fetch happens on GitHub's side is inferred from what Camo is, not stated on the page, and the page is silent on private repositories.
- **Code copy button.** Not mentioned on the code-blocks page (re-checked in the skeptic pass), which says syntax highlighting uses Linguist;[^gh-codeblocks] only third-party reports of a hover button surfaced, and they are not used here.
- **Hidden text.** Files with bidirectional Unicode carry a warning banner since October 2021,[^ghbidi] and the changelog of 2025-05-01 announces a warning for hidden Unicode text in the file view on github.com.[^gh-hidden]
- **Tabs and wrap.** A per-user tab-size preference exists;[^ghtab] the wrap default was answered by staff in a community thread.[^ghwrap]
- **Diffs.** The reviewer chooses unified or split, and the choice persists across pull requests; hiding whitespace is remembered per pull request; a "Viewed" tick collapses a file and un-ticks itself if the file changes; a file tree filters files.[^gh-review] Word-level highlighting and large-diff loading are not documented on that page. Colour-blind themes exist: a protanopia/deuteranopia theme (swaps red and green for orange and blue) and a tritanopia theme, each in light and dark.[^gh-cb]
- **Privacy.** The site privacy statement (effective 2026-04-27) says essential cookies are used and non-essential ones support analytics and advertising, with consent required in some jurisdictions.[^gh-priv]

**Gets right.** Per-file "Viewed" state that resets on change is a review-progress idea Marxy has no counterpart for **[D]**. Warning about hidden Unicode in the file view itself **[D]**. **Gets wrong for Marxy.** Fetching remote images by default is the opposite of Marxy's commitment; the proxy hides the reader from other GitHub users but the image is still requested (facts above). Hovering chrome on every code block (third-party reports only) is what chrome-at-rest forbids.

### VS Code (markdown preview, notebooks)

- **Preview.** Side-by-side preview updates as you edit; scrolling either pane scrolls the other, with two settings to disable each direction.[^vsc-md] Scroll sync and double-click-to-source rely on a `data-line` start-line attribute on non-inline tokens; there is no end position and no inline coverage.[^vscode-md-src]
- **Security.** Scripts disabled and only https resources allowed; the default level is "Strict", which also blocks http images; two looser levels exist, and the page says the setting applies to all files in the workspace, so it is not per document.[^vsc-md] Mermaid and KaTeX render in the preview.[^vsc-md]
- **Notebook output.** `notebook.output.textLineLimit` defaults to 30 lines; scrolling defaults on only in Insiders builds; the setting's own description was called confusing by a maintainer.[^vscode-nb][^vscode-issue] Word-wrap of output is not established in this session.
- **Code.** `wordWrap` is off and ligatures off by default in the editor options; the Unicode-highlight options for invisible and ambiguous characters default on.[^vscode-uni]
- **Telemetry.** On by default; `telemetry.telemetryLevel: off` silences it; extensions may collect their own.[^vsc-faq]

**Gets right.** Line-level source mapping in a rendered preview, with scroll sync in both directions and a documented off switch **[D]**; strict-by-default security with named levels **[D]**. **Gets wrong.** Telemetry on by default; markdown preview is subordinate to an editor, so the reader is always beside a caret.

### Typora

- Supports raw HTML "where pure Markdown does not provide support", YAML front matter, footnotes, task lists and a "Callouts / Github Style Alerts" section.[^typora-ref] Mermaid, details and remote-image handling are not documented on that page (re-checked); internal heading links are.[^typora-ref]
- Code fences: line numbers are a preference; the docs say lines should auto-wrap or scroll; "Copy Code Content" is in the context menu; the highlighting engine and language guessing are not documented.[^typora-fences]
- Copies as HTML by default, with a copy-as-Markdown command (from the quick-start page, read earlier).[^typora]

**Gets right.** Copy as Markdown as a distinct command from copy **[D]**. **Gets wrong.** It is an editor: the surface has a caret, so the reader never gets the read-only column. Telemetry, network and chrome-at-rest not documented on pages read.

### Marked 2

- Watches a file and updates the preview when it is saved.[^marked-help] Mermaid arrived in 2.6.46 (10 March 2025) behind an "Additional Scripts" panel that accepts local files, CDN URLs or raw text.[^marked-blog] Nine built-in styles plus custom styles, from the store listing summary.[^marked-search]
- Scroll position on reload, remote images, raw HTML, front matter and privacy: not documented on the Help index or its HTML Specific Settings page (header IDs, footnote IDs and Markdown-inside-HTML only).[^marked-help][^marked-html]

**Gets right.** A watcher that rerenders on save is the live-reload baseline **[D]**. **Gets wrong.** Loading scripts from a CDN is a network path Marxy forbids; here it is opt-in.

### Obsidian reading view

- Three views: Reading, Live Preview and Source, one shortcut (Cmd+E) cycling them; a view switcher icon and status-bar icon exist too.[^obs-view]
- Documented syntax page covers footnotes, `%%` comments (visible only when editing), code blocks and callouts; external images by URL are documented as syntax; collapsible callouts, embeds, mermaid, HTML and tables are not on that page, and it states no fetch policy for external images.[^obs-syntax]
- Privacy: the policy page says Obsidian collects no telemetry, with one exception, an update check that can be disabled in Settings.[^obs-priv]

**Gets right.** A dedicated Reading view separate from editing **[D]**. **Gets wrong.** A view switcher and status bar are permanent chrome. Remote-image behaviour not documented.

### Zed

- Agent panel: tool use shown as streaming indicators; edits summarised (files, lines) with a "Review Changes" multi-buffer where hunks can be accepted or rejected; "Copy as Markdown" and "Copy This Agent Response" exist; thinking display and collapsing are not documented.[^zed-agent]
- Markdown preview: the language page read does not cover it; issue titles show a preview exists and that an edit once scrolled it to the top, but no official page was read.[^zed-search]
- Telemetry: the page describes how to turn categories off and says events go out every five minutes or fifty events; it does not state the default.[^zed-tel]

**Gets right.** Copy the agent response as Markdown is a first-class action **[D]**. **Gets wrong.** Position loss on live reload (issue title only; not verified further).

### Warp

- A Block is the unit for a command and its output; single and multiple blocks can be selected by keyboard or mouse; a sticky command header helps in long output. The block-actions page lists copy (command, output or both), share, bookmark, find within a block and filter, and says nothing about collapsing long output or a truncation default.[^warp-blocks][^warp-basics][^warp-actions]

**Gets right.** A stable unit (command plus output) to select and act on **[D]**. **Gets wrong for Marxy.** Everything else not documented in what was read; AI-agent output not covered.

### Claude Code and Codex CLI terminal transcripts

- **Claude Code.** `Ctrl+O` toggles a transcript viewer that shows detailed tool use with a timestamp and model per message and expands lines collapsed by default, such as MCP calls shown as one "Called slack 3 times" line. `{` and `}` jump between user prompts; `[` writes the conversation to native scrollback; `v` opens it in `$EDITOR`. In the `/btw` side-question overlay, `c` copies the answer as raw Markdown, which the page recommends over mouse selection because selection captures the hard-wrapped rendering. `Option+T` toggles extended thinking.[^cc-interactive-full] On Enter it removes tag characters, bidirectional controls and zero-width spaces from pasted prompts before sending.[^cc-interactive-full] Metrics telemetry is on by default with the Claude API and off by default on Bedrock, Vertex and Foundry; error reports are on only for Pro/Max sign-ins on v2.1.198 or later.[^cc-data]
- **Codex CLI** (Apache-2.0, main at commit 0fbf0be, constants re-verified on 12de0e3). A tool call shows at most 5 lines of output (`TOOL_CALL_MAX_LINES`), a user shell command 50; the omitted middle becomes `… +N lines (ctrl+t to view transcript)` between a kept head and tail, N counting hidden logical lines; user-shell output is wrapped first, so the 50 counts screen rows; `ctrl+t` opens the transcript.[^codex-src] Telemetry defaults: not established.

**Gets right.** A single explicit expand key with the count of hidden lines in the marker **[D]**. **Gets wrong for Marxy.** Truncation by line count alone; and because terminal rendering is hard-wrapped, Claude Code's docs advise a copy key over selection, though only in the `/btw` overlay.

### Claude.ai and ChatGPT web

- **Claude.ai.** Artifacts open in a window beside the conversation; legacy artifacts have controls to view code, copy or download; templates export to Word, PDF, Markdown and other formats.[^claude-art] Extended thinking appears as a timer and an expandable "Thinking" section above the answer that the reader clicks to open; the page does not use the word "collapsed".[^claude-think]
- **ChatGPT.** Help-centre pages returned 403; search-result text says the (now replaced, per a third-party page) canvas opened on the right with restorable versions, and that reasoning collapses to a "Thought for" bar. Both are secondary and unverified.[^chatgpt-search]

**Gets right.** Thinking behind a click, expanded on demand **[D]** (one web UI documents it; the other is secondary text only). **Gets wrong.** Artifacts live in a panel beside the chat, adding chrome; not a document.

### JupyterLab and the notebook format

- Cell output can be collapsed with the blue collapser or the View menu; "Enable Scrolling for Outputs" is a per-cell option. Notebook trust: HTML and JavaScript from other machines are not trusted, so HTML is sanitised and interactive output not shown until trusted.[^jl-nb] The server docs say untrusted HTML is always sanitised and untrusted JavaScript is never executed.[^jl-sec]
- Format: stream outputs carry a name and multiline text; display data is a MIME bundle keyed by type; errors carry a traceback as a list of strings. ANSI handling is not stated on the pages read.[^nbformat]

**Gets right.** A trust state for content from elsewhere, default-untrusted **[D]**. **Gets wrong.** Scrolling boxes inside a page (per-cell) are the per-block scrollbars Marxy forbids.

## READMEs compared

| Tool | Raw HTML | Alerts | Details | Mermaid | Front matter | Remote images by default | Anchors |
|---|---|---|---|---|---|---|---|
| GitHub | `<picture>` supported; full HTML policy not read[^gh-md] | Yes, five types[^gh-md] | Collapsed unless `open`[^gh-details] | Yes[^gh-mermaid] | Rendered as a table (2013)[^gh-yaml] | Yes, rewritten to Camo proxy URLs[^gh-camo] | Hover link icon[^gh-md] |
| VS Code | not documented | not documented | not documented | Yes[^vsc-md] | not documented | https allowed, http blocked by default[^vsc-md] | not documented |
| Typora | Yes[^typora-ref] | Yes, section exists[^typora-ref] | not documented | not documented | Yes[^typora-ref] | not documented | not documented |
| Marked 2 | not documented | not documented | not documented | Opt-in script[^marked-blog] | not documented | not documented | not documented |
| Obsidian | not documented | Callouts, basic[^obs-syntax] | not documented | not documented | not documented | not documented | not documented |
| Zed | not documented | not documented | not documented | not documented | not documented | not documented | not documented |

Marxy today: `<details>` renders open, unknown elements are removed with their contents, remote images are blocked until opted in; Mermaid is out of scope for v1 (see the brief). In the docs read, no tool documents a per-document, per-host remote-image opt-in (see the synthesis for how hard that was looked for).

## Agent artifacts compared

| Tool | Tool call and result | Default collapse or truncation | Thinking | Copy | Live update |
|---|---|---|---|---|---|
| Claude Code | Transcript with detail on demand[^cc-interactive-full] | MCP calls collapse to one line; transcript expands them[^cc-interactive-full] | `Option+T` toggle[^cc-interactive-full] | `c` in the `/btw` overlay copies the answer as raw Markdown, instead of mouse selection[^cc-interactive-full] | Terminal |
| Codex CLI | Cell per call | 5 lines, user shell 50, `… +N lines`[^codex-src] | not documented | not documented | Terminal |
| Zed agent | Streaming tool indicators[^zed-agent] | not documented | not documented | Copy as Markdown, copy response[^zed-agent] | not documented |
| Claude.ai | not documented | not documented | Expandable "Thinking" section[^claude-think] | Artifact copy and download[^claude-art] | not documented |
| ChatGPT | not documented | "Thought for" bar (secondary; unverified)[^chatgpt-search] | see left | not documented | not documented |
| VS Code notebook | Output cell | 30 lines by default[^vscode-nb] | n/a | not documented | Editor |
| JupyterLab | Output cell | Collapsible; scrolling opt-in[^jl-nb] | n/a | not documented | Kernel |
| Warp | Block[^warp-blocks] | not documented on the three block pages read[^warp-actions] | not documented | Block command, output or both[^warp-actions] | Terminal |

## Code and diffs compared

| Tool | Highlighting engine | Ligatures default | Wrap or scroll default | Line numbers | Copy | Diff | Word diff | Colour-blind |
|---|---|---|---|---|---|---|---|---|
| GitHub | Linguist grammars[^gh-codeblocks] | not documented | staff answer in thread[^ghwrap] | not documented | not documented | Unified or split, persisted[^gh-review] | not documented | Yes, two themes[^gh-cb] |
| VS Code | TextMate (not read this session) | Off[^vscode-uni] | wrap off[^vscode-uni] | Editor setting | n/a | not read | not read | not read |
| Typora | not documented | not documented | Wrap or scroll[^typora-fences] | Preference[^typora-fences] | Context menu[^typora-fences] | n/a | n/a | not documented |
| Zed agent | not documented | not documented | not documented | not documented | Copy as Markdown[^zed-agent] | Review multibuffer, per-hunk accept[^zed-agent] | not documented | not documented |

Moved-code detection: not documented by any tool read. Language guessing: not documented (Typora states the language must be given or defaulted).[^typora-fences]

## Trust and chrome at rest

| Tool | Network by default | Telemetry by default | Hidden Unicode | Link destination display | Chrome at rest |
|---|---|---|---|---|---|
| GitHub | Images via Camo URLs[^gh-camo] | Site analytics cookies, consent varies[^gh-priv] | Warning banner[^gh-hidden] | not documented | not documented |
| VS Code | https allowed[^vsc-md] | On[^vsc-faq] | Highlighted by default[^vscode-uni] | not documented | not documented |
| Claude Code | Model API; hostname check on WebFetch[^cc-data] | Metrics on with Claude API[^cc-data] | Stripped from pasted prompts on Enter (input, not display)[^cc-interactive-full] | not documented | Terminal |
| Zed | not documented | Default not stated[^zed-tel] | not documented | not documented | not documented |
| Obsidian | Update check, can be disabled[^obs-priv] | None[^obs-priv] | not documented | not documented | Switcher icon and status bar[^obs-view] |
| Marked 2 | CDN scripts if configured[^marked-blog] | not documented | not documented | not documented | not documented |
| Jupyter | not documented | not documented | Untrusted HTML sanitised[^jl-sec] | not documented | not documented |

## Synthesis

**Where the field converged [D].** Counts are of tools whose documentation was read for that item.

- **Bound long tool or cell output by default: 2 of 5** surfaces with an output panel use a line-count bound in the docs or source read (Codex CLI 5 and 50, VS Code notebooks 30); Claude Code collapses MCP calls to one line, a grouping rather than a line bound; Jupyter documents scrolling as per-cell and opt-in, and Zed and Warp document no default (Warp's block-actions page re-checked). Chapter 02 should not cite this as 3 of 5.
- **Thinking hidden behind a click: 1 documented** web UI (Claude.ai, wording "click the section"); ChatGPT is secondary text only; Claude Code has a toggle.
- **Render Mermaid: 2 of 6** markdown tools by default (GitHub, VS Code), 1 more as an opt-in script (Marked 2).
- **Alert or callout syntax: 3 of 6** (GitHub, Typora, Obsidian).
- **Warn about or neutralise hidden Unicode: 3 of 12** tools in the docs or source read (GitHub warns in the file view, announced 2025-05-01; VS Code highlights by default in its editor options; Claude Code strips from pasted prompts, which protects input and does not show an artifact); none of Typora, Marked 2 or Obsidian documents it on the pages read.
- **Telemetry on by default: 2 of 4** where a default was found (VS Code, Claude Code with the Claude API); GitHub's site collects analytics with consent varying; Obsidian none (privacy page); Zed not stated (page re-read).

**Where it splits.** Unified versus split diff is a reader choice on GitHub, and no other tool's diff was read. Wrap versus scroll differs by tool and none documents a rule tied to content. Copy affordances range from none documented to a per-response Markdown copy (Zed, and Claude Code's `/btw` overlay), and no tool documented in the pages read offers copy at the level of a markdown section.

**What the surveyed documentation does not describe, and Marxy's architecture allows.** Each is a statement about documents read, not about every tool.

1. **Byte-exact provenance for every element.** VS Code's preview maps a start line for non-inline tokens.[^vscode-md-src] Marxy's DOM carries start and end bytes on every element, so a selection can resolve to an exact source span.
2. **Operations as pure `string → string` with one undo, applied from a rendered selection.** Zed offers copy-as-Markdown and Typora a copy-as-Markdown command, both as clipboard actions; neither doc describes a spliced edit from the rendered view with a single undo.
3. **No network at all, with a per-document, per-host opt-in for images.** The defaults documented are proxy (GitHub), https-allowed at workspace scope (VS Code) or script-from-CDN (Marked 2). Search effort: GitHub Camo, VS Code security levels, Typora reference, Marked 2 help and HTML settings and Obsidian syntax pages were opened; no Obsidian or Typora settings pages, and no changelogs, were read, so this is absence on those pages only.
4. **Chrome at rest of zero.** In the docs read, the tools expose a view switcher, status bar or block chrome; none documents an at-rest state with none (undocumented is not absent).

> **Trap.** Convergence is not endorsement. Line-count truncation converges (2 of 5) because it is easy to build in a terminal; no study read shows it helps a reader find the relevant lines.

> **Marxy today.** Provenance is in `packages/core/src/contracts/ast.ts`; the sanitiser keeps `<details>` open and strips remote `img src` (`packages/core/src/sanitize/policy.ts`), per the brief.

[^gh-md]: GitHub, "Basic writing and formatting syntax" (docs page; summary via fetch tool). [docs.github.com](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax). Accessed 2026-09-25.
[^gh-mermaid]: GitHub, "Creating diagrams" (docs page; summary via fetch tool). [docs.github.com](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams). Accessed 2026-09-25.
[^gh-details]: GitHub, "Organizing information with collapsed sections" (docs page; summary via fetch tool). [docs.github.com](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-collapsed-sections). Accessed 2026-09-25.
[^gh-yaml]: GitHub, "Viewing YAML Metadata in your Documents", *The GitHub Blog*, 2013 (read earlier via a fetch summary, see [Structured output](03-structured-output.md)). [github.blog](https://github.blog/2013-09-27-viewing-yaml-metadata-in-your-documents/). Accessed 2026-09-25.
[^gh-camo]: GitHub, "About anonymized URLs" (docs page; summary via fetch tool). [docs.github.com](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-anonymized-urls). Accessed 2026-09-25.
[^gh-hidden]: GitHub Changelog, "GitHub now provides a warning about hidden Unicode text", 2025-05-01 (page opened in the skeptic pass; file view on github.com). [github.blog](https://github.blog/changelog/2025-05-01-github-now-provides-a-warning-about-hidden-unicode-text/). Accessed 2026-09-25.
[^ghbidi]: GitHub, "Warning about bidirectional Unicode text", GitHub Changelog, 2021-10-31 (docs page, read earlier, see [Trust and safety](07-trust-safety.md)). [github.blog](https://github.blog/changelog/2021-10-31-warning-about-bidirectional-unicode-text/). Accessed 2026-09-25.
[^ghtab]: GitHub, "Managing your tab size rendering preference" (docs page, read earlier, see [Code typography](04-code-typography.md)). [docs.github.com](https://docs.github.com/en/account-and-profile/how-tos/account-settings/managing-your-tab-size-rendering-preference). Accessed 2026-09-25.
[^ghwrap]: GitHub Community, "GitHub Wrapping off?", discussion 42298 (thread, read earlier, see [Code typography](04-code-typography.md)). [github.com](https://github.com/orgs/community/discussions/42298). Accessed 2026-09-25.
[^gh-review]: GitHub, "Reviewing proposed changes in a pull request" (docs page; summary via fetch tool). [docs.github.com](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request). Accessed 2026-09-25.
[^gh-cb]: GitHub Changelog, "Protanopia & Deuteranopia Colorblind Themes Beta" and "Tritanopia Colorblind Theme Beta", 2022-04-19 (search-result text only; the docs page 404-ed on a guessed URL). [github.blog](https://github.blog/changelog/2022-04-19-protanopia-deuteranopia-colorblind-themes-beta/). Accessed 2026-09-25.
[^gh-priv]: GitHub, "GitHub General Privacy Statement", effective 2026-04-27 (docs page; summary via fetch tool). [docs.github.com](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement). Accessed 2026-09-25.
[^vsc-md]: Microsoft, "Markdown and Visual Studio Code" (docs page; summary via fetch tool). [code.visualstudio.com](https://code.visualstudio.com/docs/languages/markdown). Accessed 2026-09-25.
[^vscode-md-src]: Microsoft, VS Code `extensions/markdown-language-features/src/markdownEngine.ts` (source, read earlier, see [Diffs and provenance](05-diffs-provenance.md)). [github.com/microsoft/vscode](https://github.com/microsoft/vscode/issues/133376). Accessed 2026-09-25.
[^vscode-nb]: microsoft/vscode, `notebook.contribution.ts` and `notebookOptions.ts` (source, read earlier, see [Agent artifacts](02-agent-artifacts.md)). [github.com](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/notebook/browser/notebook.contribution.ts). Accessed 2026-09-25.
[^vscode-issue]: microsoft/vscode issue 177843 (issue page, read earlier). [github.com](https://github.com/microsoft/vscode/issues/177843). Accessed 2026-09-25.
[^vscode-uni]: Microsoft, VS Code `editorOptions.ts` (`wordWrap`, ligatures, `unicodeHighlight`), main branch (source, read earlier, see [Code typography](04-code-typography.md) and [Trust and safety](07-trust-safety.md)). [github.com/microsoft/vscode](https://github.com/microsoft/vscode). MIT. Accessed 2026-09-25.
[^vsc-faq]: Microsoft, "Visual Studio Code FAQ", telemetry (docs page; summary via fetch tool). [code.visualstudio.com](https://code.visualstudio.com/docs/supporting/FAQ). Accessed 2026-09-25.
[^typora-ref]: Typora Support, "Markdown Reference" (docs page; summary via fetch tool). [support.typora.io](https://support.typora.io/Markdown-Reference/). Accessed 2026-09-25.
[^typora-fences]: Typora Support, "Code Fences" (docs page; summary via fetch tool). [support.typora.io](https://support.typora.io/Code-Fences/). Accessed 2026-09-25.
[^typora]: Typora Support, "Quick Start" (docs page, read earlier, see [Diffs and provenance](05-diffs-provenance.md)). [support.typora.io](https://support.typora.io/Quick-Start/). Accessed 2026-09-25.
[^marked-help]: Marked, "Help" (docs page; summary via fetch tool). [marked2app.com/help](https://marked2app.com/help/). Accessed 2026-09-25.
[^marked-blog]: Brett Terpstra, "Marked 2.6.46 -- Mermaid, Highlighting, and More", 2025-03-10 (blog by the developer; summary via fetch tool). [brettterpstra.com](https://brettterpstra.com/2025/03/10/marked-2-dot-6-46/). Accessed 2026-09-25.
[^marked-search]: Mac App Store listing and marked2app.com/styles as returned in search-result text (secondary; not opened). [apps.apple.com](https://apps.apple.com/us/app/marked-2-markdown-preview/id890031187). Accessed 2026-09-25.
[^obs-view]: Obsidian, "Views and editing mode" (docs page; summary via fetch tool). [obsidian.md/help/edit-and-read](https://obsidian.md/help/edit-and-read). Accessed 2026-09-25.
[^obs-syntax]: Obsidian, "Basic formatting syntax" (docs page; summary via fetch tool). [obsidian.md/help/syntax](https://obsidian.md/help/syntax). Accessed 2026-09-25.
[^obs-priv]: Obsidian, "Privacy Policy" (page opened in the skeptic pass). [obsidian.md/privacy](https://obsidian.md/privacy). Accessed 2026-09-25.
[^zed-agent]: Zed, "Agent Panel" (docs page; summary via fetch tool). [zed.dev/docs/ai/agent-panel](https://zed.dev/docs/ai/agent-panel). Accessed 2026-09-25.
[^zed-search]: Zed issues #9208 and #56127 as listed in search results (titles only; not opened). [github.com/zed-industries/zed/issues/9208](https://github.com/zed-industries/zed/issues/9208). Accessed 2026-09-25.
[^zed-tel]: Zed, "Telemetry" (docs page; summary via fetch tool). [zed.dev/docs/telemetry](https://zed.dev/docs/telemetry). Accessed 2026-09-25.
[^warp-blocks]: Warp, "Blocks" (docs page; summary via fetch tool). [docs.warp.dev/terminal/blocks](https://docs.warp.dev/terminal/blocks). Accessed 2026-09-25.
[^warp-basics]: Warp, "Block basics" (docs page; summary via fetch tool). [docs.warp.dev](https://docs.warp.dev/terminal/blocks/block-basics). Accessed 2026-09-25.
[^cc-interactive]: Anthropic, Claude Code "Interactive mode" (docs page, read earlier, see [Agent artifacts](02-agent-artifacts.md)). [code.claude.com](https://code.claude.com/docs/en/interactive-mode). Accessed 2026-09-25.
[^cc-interactive-full]: Anthropic, Claude Code "Interactive mode", rows for `Ctrl+O`, `Option+T`, transcript viewer keys, the `/btw` overlay `c` key and pasted-text Unicode cleaning (docs page, saved text grepped). [code.claude.com](https://code.claude.com/docs/en/interactive-mode). Accessed 2026-09-25.
[^cc-data]: Anthropic, Claude Code "Data usage", telemetry services and defaults table (docs page, read in full). [code.claude.com](https://code.claude.com/docs/en/data-usage). Accessed 2026-09-25.
[^codex-src]: OpenAI, `openai/codex` `codex-rs/tui/src/exec_cell/render.rs` (`TOOL_CALL_MAX_LINES`, `USER_SHELL_TOOL_CALL_MAX_LINES`, ellipsis text), `ui_consts.rs` (`TRANSCRIPT_HINT`) and `keymap.rs` (`open_transcript` default `ctrl-t`), Apache-2.0 (GitHub licence API), main at commit 0fbf0be when written; re-read on raw main (12de0e3) in the skeptic pass, constants unchanged. [github.com/openai/codex](https://github.com/openai/codex). Accessed 2026-09-25.
[^gh-codeblocks]: GitHub, "Creating and highlighting code blocks" (docs page; summary via fetch tool). [docs.github.com](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-and-highlighting-code-blocks). Accessed 2026-09-26.
[^marked-html]: Marked, "HTML Specific Settings" (docs page; summary via fetch tool). [marked2app.com](https://marked2app.com/help/HTML_Specific_Settings.html). Accessed 2026-09-26.
[^warp-actions]: Warp, "Block actions" (docs page; summary via fetch tool). [docs.warp.dev](https://docs.warp.dev/terminal/blocks/block-actions.md). Accessed 2026-09-26.
[^claude-art]: Anthropic, "What are artifacts and how do I use them?" (help centre; summary via fetch tool). [support.claude.com](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them). Accessed 2026-09-25.
[^claude-think]: Anthropic, "Using extended thinking" (help centre; summary via fetch tool). [support.claude.com](https://support.claude.com/en/articles/10574485-using-extended-thinking). Accessed 2026-09-25.
[^chatgpt-search]: OpenAI Help Center canvas and release-notes pages as quoted in search-result text (secondary; help.openai.com returned 403 on fetch; the canvas-removal claim comes from a third-party page). [help.openai.com](https://help.openai.com/en/articles/9930697). Accessed 2026-09-25.
[^jl-nb]: Project Jupyter, JupyterLab "Working with notebooks" (docs page; summary via fetch tool). [jupyterlab.readthedocs.io](https://jupyterlab.readthedocs.io/en/stable/user/notebook.html). Accessed 2026-09-25.
[^jl-sec]: Project Jupyter, Jupyter Server "Security in the Jupyter Server" (docs page; summary via fetch tool). [jupyter-server.readthedocs.io](https://jupyter-server.readthedocs.io/en/latest/operators/security.html). Accessed 2026-09-25.
[^nbformat]: Project Jupyter, "The Jupyter Notebook Format" (docs page; summary via fetch tool). [nbformat.readthedocs.io](https://nbformat.readthedocs.io/en/latest/format_description.html). Accessed 2026-09-25.
