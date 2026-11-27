---
corpus: large-files
title: Large files in a desktop reader
kind: brief
created: 2026-11-27
---

# Research fleet: shared brief

Corpus: **large-files**. You are one of 10 Sonnet agents researching in parallel. The lead (Opus) writes
the synthesis from your chapters and turns it into engineering work and into rules that coding agents
follow when they write new features, so write for a careful engineer who will act on what you say.
Research date: **2026-11-27**. Prefer sources from 2024–2026. Say when the newest source you found is older.

## The question behind the corpus

The reader app this serves (described in the context map) fails or slows badly on files of only 1–5 MB:
a 1 MB Markdown file once took about 78 s to open, a page stays busy for 15 s and more after a 1–5 MB file
opens, side panels re-parse the whole file on the main thread, a width change stalls a big page for up to
0.9 s, and a 100 KB unbroken paragraph takes 13 s to lay out. Each fix so far has been found one bug at a
time. The owner wants (1) the best practices for handling files of this size (and up to about 50 MB) in a
webview desktop app that reads, renders, searches and edits them, (2) how comparable apps solve the same
problems, with their numbers and thresholds, and (3) the rules and checks that stop new features from
re-introducing whole-document work. "Done" is a chapter per vector whose recommendations an engineer
could turn straight into tracker rows and lint rules.

**Your chapter is one input to that design. Recommend concrete choices for this setup (a Tauri 2 app,
TypeScript front end, micromark parser, CodeMirror 6 for source editing, a home-grown typesetter, Rust
shell), not generic advice.**

## Sub-questions

- **Q-01** · What are the best practices, overall, for keeping a webview reader fast and correct on 1–50 MB text files (open, render, scroll, edit, search, save)?
- **Q-02** · How do comparable apps (code editors, Markdown editors and readers, e-book readers, data and log viewers) handle big files, and what do they give up to do it?
- **Q-03** · What size and line-length thresholds do those apps use to switch to a degraded or "large file" mode, and what does that mode turn off?
- **Q-04** · How should work be scheduled so the main thread stays responsive (time budgets, yielding, workers, cancellation)?
- **Q-05** · How should a long, variable-height document be put on screen without the DOM growing with the file, while keeping find-in-page, selection, copy, anchors and accessibility?
- **Q-06** · How should parsing be made incremental, chunked or moved off the main thread, and which inputs make Markdown parsers super-linear?
- **Q-07** · How do typesetting, line breaking, hyphenation and text measurement stay fast on long documents and long unbroken runs?
- **Q-08** · How do JSON, CSV, log and hex viewers stay fast on big inputs (indexing, windowing, on-demand decoding)?
- **Q-09** · How should search, find, regex and syntax highlighting be bounded on big inputs (linear-time engines, line-length caps, cancellation)?
- **Q-10** · Which buffer, offset-map, undo, diff and save designs scale to big files, and what do they cost in memory?
- **Q-11** · How should bytes move between a Rust core and a webview (Tauri IPC, raw bodies, custom protocols, transferables) without copies that grow with the file?
- **Q-12** · How do projects keep scale from regressing: complexity tests, work-counting budgets, perf CI, fuzzing for pathological input, lint rules, and guidance for coding agents?

## Context map (read this instead of re-reading the files)

**The app.** A desktop reader for local files (Markdown, text, code, data, logs, diffs, notebooks, mail,
archives, PDFs, office documents, SQLite and more). Tauri 2: a Rust shell and a system webview (WKWebView on
macOS, WebView2 on Windows, WebKitGTK on Linux). TypeScript front end built by Vite. No network; local only.

**From bytes to page** (all on the main thread unless said otherwise):
1. The shell reads the file's bytes (raw IPC body). The front end keeps the bytes as the document; it derives the
   text and a UTF-16-to-byte offset map. Every edit is a byte splice; every rendered element carries its byte
   range in `data-*` attributes (provenance).
2. Markdown is parsed by micromark (GFM, front matter, maths) into an mdast-like tree with byte ranges. Big files
   are parsed in slices; an edit reparses the touched region only, unless link-reference or footnote definitions
   change (then the whole file).
3. The tree is rendered to an HTML string and passed through an allow-list sanitiser, then mounted: two screens
   at once, the rest of the page in idle slices (progressive mount). Afterwards, changed blocks are replaced
   when they can be proved equal; otherwise the page is set whole.
4. A home-grown typesetter (Knuth–Plass-style ragged right, hyphenation via `justif` patterns, hanging
   punctuation, a baseline grid) sets every paragraph in the DOM, in an idle queue that today covers the whole
   page. Then idle passes: Shiki syntax colouring in a worker, KaTeX maths, images, Mermaid diagrams.
5. Source view is CodeMirror 6 over the same bytes.
6. From 5 MB, Markdown, text, code and logs switch to a "lines" reading: a line index over the bytes and only the
   lines near the screen drawn (virtualised). Tables and records (CSV, JSON Lines) are row-indexed and windowed
   at any size. **So 1–5 MB Markdown gets the full page: whole parse, whole DOM, whole typesetting.**
7. Untrusted-input work budgets exist (`budget(limit)`, `take(n)`), applied per reader, not everywhere.

**Symptoms already measured** (for orientation, not to research): 1 MB Markdown about 78 s to open on Windows
before a fix; a page busy 15 s+ after a 1–5 MB open; panels (links, metadata, transforms) re-parse the whole
file on the main thread; relayout on a width change 0.3–0.9 s per step; a 100 KB unbroken paragraph lays out in
13 s with kerning on; exporting a long page was O(n²) over its blocks; a backtracking regex in a find field
froze the window; a 62,000-paragraph Word document overflowed the call stack (spreading children into one
`append(...)`). Work in flight: a geometry table (one record per top-level block: element, byte range, top,
height, measured or estimated) and bounding the typesetting queue to what is near the reader.

**Local files you may open** (read-only), all under `/Users/<user>/Dev/marxy-wt/large-files/`:
- `docs/architecture.md` — the full pipeline (the summary above is from it)
- `docs/file-kinds.md` — the size limits table (search for "Size limits")
- `packages/core/src/util/budget.ts` — the work-budget shape
- `docs/research/audit-2026-10/05-performance-audit.md` — an older perf audit (prior art; partly stale)
Open only the ones your vector needs. Do not read the rest of the repository; the hunt run beside this corpus
audits the code.

## Rules for every agent

1. **Use the web** (WebSearch, WebFetch) and the local files above. Prefer primary sources: source code and
   design docs of the apps themselves (GitHub repos, issue threads where maintainers explain a limit), official
   docs (MDN, WHATWG/W3C, web.dev, Chromium/WebKit blogs and bug trackers, Tauri docs, CodeMirror docs and
   forum posts by its author), engineering posts by the teams. Then practitioner writing. Label secondary
   sources as such. **A number from source code or a settings default beats a number from a blog.**
2. **Cite everything.** Every finding gets numbered sources with URL and access date. If a page is blocked or
   JS-only, say so; a 403 can sometimes be read with `curl -sL` in Bash under a plain descriptive User-Agent.
   **Keep every page you quote:** `node /Users/<user>/Dev/research-corpora/tools/save-source.mjs
   /Users/<user>/Dev/marxy-wt/large-files/docs/research/large-files <url>` keeps its text in `sources/`. Copy the
   quotation from that text, word for word, and put the citation in the same sentence. Before you finish,
   `node /Users/<user>/Dev/research-corpora/tools/check-corpora.mjs --web /Users/<user>/Dev/marxy-wt/large-files/docs/research/large-files`
   must show no FAIL for your chapter (other chapters may still be in progress; ignore their lines).
3. **Privacy.** Never put the owner's name, email, the app's name, repo names, device names, IP addresses or
   paths into a web search or fetch. Search generic terms only ("CodeMirror 6 large document performance", not
   anything identifying).
4. **Separate fact from inference.** Tag each finding `[confirmed]` (read in a primary source: code, docs, a
   maintainer's own words), `[measured]` (a number from a benchmark you can cite, with its setup), `[likely]`
   (strong secondary evidence or direct inference) or `[unverified]`. A claim that something does **not**
   exist or was **not** found is tagged `[absence]`, never `[confirmed]`, and lists at least two places you
   searched under `**Searched:**`.
5. **Version-date everything that changes fast:** app versions, settings keys and their defaults, browser and
   engine support (Chromium vs WebKit matters here: macOS ships WebKit), Tauri version.
6. **Read-only.** Do not install, run servers, change settings, commit or touch any file other than your own
   chapter and, through the save command, `sources/`. Read-only commands (`git show`, `ls`, `node -e`) are fine.
   You may clone nothing; read code on GitHub through the web or `gh api` (read-only).
7. **Budget:** about 30–40 tool calls. Go deep on the threads that change the recommendation; chase
   surprising leads. Prefer five well-sourced findings with numbers to fifteen thin ones.
8. **Write your chapter** to `/Users/<user>/Dev/marxy-wt/large-files/docs/research/large-files/<NN>-<slug>.md`
   using the template below. Write it once near the end, or overwrite as you go.
9. **End your chapter's Recommendation with a short list headed "Rules for new features"**: three to eight
   one-line rules, each testable (a reviewer or a lint could check it), that a coding agent writing a new
   feature in this app should follow. These feed the agent guidance the lead writes.
10. **Reply** to the lead in at most 10 lines: your recommendation in one or two sentences, the 3–5 headline
    findings with their IDs, and cross-leads for other vectors (by number).

## Chapter template

```markdown
---
corpus: large-files
id: <NN>
slug: <slug>
prefix: <PREFIX>
title: <Human title>
researched: 2026-11-27
confidence: <high | medium | low>
volatility: <fast | medium | slow>
status: active
keywords: [comma, separated, terms, someone would search for]
---

# <NN> · <Human title>

> One-paragraph abstract: the question, and the answer in brief.

## TL;DR
- 3–6 bullets: what the owner most needs to know.

## Recommendation for this setup
The concrete answer for this app: what to do, in what order, and why. Name APIs, versions, settings, data
structures and thresholds. Say what you would NOT do and why.

**Rules for new features**
- 3–8 one-line, checkable rules.

## Findings

### <PREFIX>-01 · Short title  `[confirmed|measured|likely|unverified]`
Two to eight sentences. Numbers with units. Citations like [1][3].

### <PREFIX>-02 · Nothing found for X  `[absence]`
What was looked for, and what came closest.
**Searched:** site and query; site and query

## Options compared
| Option | Fit for this app | Cost | Risk | Verdict |
|---|---|---|---|---|

## Open questions
- What you could not settle, and what would settle it.

## Cross-links
- Other vectors in this corpus that should read a finding (by number and ID).

## Sources
1. Title, author or org — https://example.org/page (accessed 2026-11-27) — what it gave, or that it was blocked
```

## The vectors

| NN | Slug | Prefix | Question | Sub-questions |
|---|---|---|---|---|
| 01 | code-editors | EDS | How VS Code/Monaco, CodeMirror 6, Zed, Sublime Text and others handle big files: document model, viewport rendering, large-file modes and their thresholds, what they turn off | Q-02, Q-03, Q-10 |
| 02 | markdown-apps | MDA | How Markdown editors, readers and previewers (Obsidian, Typora, VS Code's preview, MarkText, Zettlr, iA Writer, Marked, GitHub's renderer) and e-book readers (Readium, foliate-js, epub.js, Calibre's viewer) cope with long documents; limits and complaints | Q-02, Q-03 |
| 03 | parsing | PRS | Incremental, chunked and off-thread Markdown parsing; micromark and peers at scale; pathological inputs and CommonMark's known quadratic cases; reparse-on-edit designs (Lezer, tree-sitter) | Q-06 |
| 04 | dom-rendering | DOM | Putting a long variable-height document on screen: virtualisation, `content-visibility`, `contain-intrinsic-size`, DOM size costs, layout thrash, long text nodes, and how each keeps find-in-page, selection, copy, anchors and screen readers; WebKit vs Chromium | Q-05 |
| 05 | typesetting | TYP | Fast typesetting on long documents: Knuth–Plass cost, hyphenation, text measurement and caching (canvas `measureText`, DOM-free measurement libraries), kerning and shaping cost of long runs, viewport-bounded and incremental line setting, how paginating readers lay out lazily | Q-07 |
| 06 | main-thread | THR | Scheduling and data movement: long tasks, INP, `scheduler.yield`/`postTask`/`isInputPending` support in WebKit and Chromium, time-sliced work and cancellation, Web Workers and transferables, structured-clone cost of big strings, wasm parsers; Tauri 2 IPC for large payloads (raw bodies, `ipc::Response`, channels, custom protocols) | Q-04, Q-11 |
| 07 | data-viewers | DAT | JSON, CSV, log and hex viewers on big input: Firefox's JSON viewer, VS Code with huge JSON, fx/jless, Tad/Modern CSV/csvlens, lnav/klogg/glogg, Hex Fiend; line and record indexes, windowing, canvas grids, lazy decoding, size caps | Q-08 |
| 08 | search-highlight | SRC | Find, search, regex and colouring on big input: find over virtualised content, linear-time regex (RE2, Rust `regex`) vs backtracking JS, ReDoS defences (worker + terminate, timeouts), incremental search, Shiki/TextMate on long lines vs tree-sitter/Lezer, tokenisation caps (VS Code `maxTokenizationLineLength` and friends) | Q-09 |
| 09 | buffers-memory | BUF | Text buffers and their memory: piece table, rope, gap buffer; byte/UTF-16 offset maps; V8/JSC string internals (ropes, slices, max length) and their traps; undo history storage; diffing big files (Myers, histogram, limits); saving big files atomically | Q-10 |
| 10 | guardrails | GRD | Keeping scale from regressing: doubling/complexity tests that catch O(n²), counting work (layouts, DOM nodes, allocations) instead of wall time, perf CI noise, fuzzing for pathological input, lint rules for whole-document work, and how projects write performance guidance for contributors and coding agents (AGENTS.md, CONTRIBUTING, review checklists) | Q-12, Q-01 |

Every vector also contributes to **Q-01** through its "Rules for new features".
