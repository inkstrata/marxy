---
corpus: large-files
id: 10
slug: guardrails
prefix: GRD
title: Keeping scale from regressing
researched: 2026-11-27
confidence: medium
volatility: medium
status: active
keywords: [complexity test, doubling test, work counters, Performance.getMetrics, LayoutCount, instruction count, cachegrind, perf CI, PerfFuzz, SlowFuzz, GritQL, ESLint no-restricted-syntax, ratchet, AGENTS.md, hooks]
---

# 10 · Keeping scale from regressing

> The question: how do projects stop O(n²) and whole-document work from coming back, and how should the rules be
> written so coding agents follow them. The answer in brief: assert on counted work, not wall time (layouts, style
> recalcs, DOM nodes, long tasks, and counters the code keeps itself), at three sizes in a doubling matrix, with a
> ratio bound; add a repository check with a ratchet baseline (the app already has the pattern) for the few syntactic
> shapes that cause whole-document work; and give agents a short list of rules that each map to a check that fails.
> Big projects use wall-clock bots plus human sheriffs, which this app cannot afford; the cheap, deterministic route
> is better for a one-owner repository.

## TL;DR
- Instruction counts (Cachegrind) are far more repeatable than wall time (SQLite reports counts repeatable to 7 or more digits against about one significant digit for wall-clock runs), but they do not apply to JavaScript in a webview. The equivalent here is work counters: Chromium's `Performance.getMetrics` (`LayoutCount`, `RecalcStyleCount`, `Nodes`), long-task counts, and counters the app itself increments (bytes scanned, nodes created, blocks typeset) [GRD-01, GRD-02].
- A doubling test runs the action at n, 2n, 4n and asserts that the counter ratio stays under a bound (about 2.5 for "linear", with slack). Run it on counters, so it is deterministic and does not flake on a shared runner [GRD-03].
- Wall-clock perf CI exists in big projects (Firefox, Chromium, VS Code) but costs dedicated hardware, sustained-regression rules and human sheriffs. Do not copy it; copy only its rules for who acts [GRD-04, GRD-05].
- Lint for whole-document work with a ratchet: the app's `check-listeners.mjs` is already the template. Biome 2.5.5 GritQL plugins match patterns and report diagnostics (they can also suggest rewrites) but have no semantic model or file kind; whether a loop-containment pattern works in Grit was not tested here, and "on a whole-document value" needs the TypeScript-AST scripts or a Biome JS plugin (developer preview in 2.6) [GRD-06, GRD-07].
- A published study found context files do not raise agents' success and add over 20% cost, but agents "tend to respect their instructions" (developer-written files raised success by about 4% on average, LLM-generated ones lowered it by about 3%, cost rose 20% and 23% for LLM files and up to 19% for developer files, GRD-09). So write few rules, each checkable, and back each with a failing check [GRD-09].

## Recommendation for this setup

Build three layers, in this order.

**1. Scale matrix test (`scripts/check-scale.mjs` or a Playwright test file, run in `pnpm verify --tier full`, not on every `changed` run).**
- Axes: sizes (for example 256 KB, 512 KB, 1 MB, 2 MB, 4 MB; a ladder with factor 2 so ratios read directly) x file kinds (Markdown prose, Markdown with 100 KB unbroken paragraph, Markdown with 60,000 blocks, long-line log, JSON, CSV, a big Word document) x actions (open, first screen, scroll to end, width change, edit one byte in the middle, find, open each side panel, export, save).
- Generate the inputs in the test (seeded generator), never commit big fixtures.
- Metrics per cell, all deterministic or near so: (a) `Performance.getMetrics` deltas: `LayoutCount`, `RecalcStyleCount`, `Nodes`, `JSHeapUsedSize` (opening a CDP session in Chromium; it is the same call `scripts/measure-interactions.mjs` already makes); (b) the app's own work counters (a `work.count('bytes-scanned', n)` style counter in `budget`/`take`), exposed on a test hook; (c) long-task count from a `PerformanceObserver` (informational at first); (d) wall time, recorded and shown but never gating.
- Assertions: (i) absolute caps on counters at the largest size independent of n for "first screen" actions (for example nodes mounted after open <= a constant plus a viewport-proportional term; `LayoutCount` after a width change <= k); (ii) doubling ratios for whole-file actions: counter(2n)/counter(n) <= 2.5 and counter(4n)/counter(2n) <= 2.5, so O(n²) (ratio 4) fails while O(n log n) passes; (iii) for "bounded" actions (edit, scroll, width change on a windowed page) the counter must be flat: ratio <= 1.3.
- Report in a table committed nowhere; fail with the cell, the counters and the ratio in the message.
- Chromium measures counts; WebKit (the macOS webview) has no CDP. Counts such as nodes and the app's own counters are engine independent; layout counts are Chromium only. Keep the matrix on Chromium and the app counters on every engine.

**2. A lint with a baseline.** Reuse the `check-listeners.mjs` shape: walk the TypeScript AST, count hits per folder, fail on growth against `scripts/allowlists/<name>.json`, `--write` to record. Rules to start with (each a call or syntactic shape; all are heuristics, so ratchet rather than ban):
- `.split('\n')` / `.split(/\r?\n/)` / `.split('')` on a value not marked bounded;
- `[...x]` or `f(...x)` / `push(...x)` / `append(...x)` where `x` is not a literal or a `take(n)` result (the 62,000-paragraph stack overflow);
- `querySelectorAll`, `getBoundingClientRect`, `offsetHeight`, `getComputedStyle` inside a `for`/`while`/`.map`/`.forEach` body (layout thrash);
- `innerHTML =` / `outerHTML =` / `insertAdjacentHTML` (already covered by `check-one-parse` for sanitising; add a size rule: not on a value whose size scales with the file unless the file is in an allow-list);
- `JSON.parse(` and `new RegExp(` on file-derived input outside a worker or budget;
- a `new RegExp` or regex literal passed a user string (backtracking).
Use TypeScript-AST in the existing script for inside a loop rules; use a GritQL plugin in Biome only for the single-node patterns (it shows in the editor and in `pnpm lint`). Do not wait for Biome's JS plugins (developer preview in 2.6 [6]); the repository checks already work and run in `pnpm check`.

**3. Agent guidance.** Put no performance essay in AGENTS.md. Add one short section "Scale" with the the rules below below, each naming the check that fails. Add a PostToolUse hook only if the checks prove to be too slow to run in `pnpm verify --tier changed`; a hook that runs the quick lint on edited files and returns its failure message (or `additionalContext`, capped at 10,000 characters [9]) puts the rule in front of the agent at the moment of the edit. Add a project skill "add-a-feature-at-scale" that is invoked when work touches a reader, panel or transform, listing the matrix row to add.

**What I would not do.** Not wall-clock gating on CI runners (noise is the size of the regression); not a Valgrind run of the webview; not a generic big-file mode switch as the only guard (the matrix should also run on 1-5 MB, where the full path still applies); not a rule list longer than about eight lines.

**Rules for new features**
- Every new action over a document ships a matrix row in the scale test; the test fails if its counters at 4n exceed 2.5x those at 2n.
- A feature may touch only the visible range plus a constant margin on open; work proportional to the file goes through `budget()`/`take(n)` and yields or runs in a worker.
- No `split`, `[...x]`, spread-call, `JSON.parse` or regex over a whole-document value outside a function marked with the work-budget helper; `check-scale-lint` fails when the per-folder count grows.
- No layout read (`getBoundingClientRect`, `offsetHeight`, `getComputedStyle`, `querySelectorAll`) inside a loop; batch reads, then writes.
- A side panel reads the shared index/geometry table; it does not re-parse the file.
- User-supplied patterns run in the linear-time engine or in a worker with a kill timeout.
- Counters, not timings, are asserted: add a `work.count()` call at the loop that scales with the input.
- An unavoidable hit is recorded in the baseline file with the reason in the PR; the baseline may shrink, never grow.

## Findings

### GRD-01 · Instruction counts beat wall time, and projects gate on them  `[confirmed]`
SQLite measures CPU with Cachegrind "because it gives answers that are repeatable to" 7 or more digits, where wall-clock runs are "scarcely repeatable beyond one significant digit" [1]. The Rust compiler's perf site defaults to `instructions:u`; a thread there says the instruction graphs "are basically straight lines" while wall-time graphs "bubble up and down significantly" [2]. The `tak` project measured Cachegrind counts varying about 0.008-0.027% quiet and 0.011-0.021% under heavy CPU contention, while wall-clock medians moved by roughly 150% [3]; its rule is "Gate on instruction counts. Report wall time without gating on it." [3]. CodSpeed packages the same idea as a "CPU Simulation" mode built on Valgrind [4]. Limits: instruction counts can miss "a change that allocates much more memory for little extra work" [3]; Valgrind needs a native binary, so this helps the Rust shell and `packages/core` under Node (not for the webview).

### GRD-02 · For a webview, the equivalent is counted work: CDP metrics and app counters  `[likely]`
`Performance.getMetrics` returns "current values of run-time metrics" [5], and the Puppeteer `metrics()` page lists `LayoutCount` and `RecalcStyleCount` among them [7]. VS Code's own chat-perf harness gates CI on `forcedReflowCount`, `layoutDurationMs` and `longTaskCount` as well as latency, and treats `longAnimationFrameCount` as informational because it is "noisy" [8]. That is a real example of counted-work gating in a webview app. The counts are inferred to be much less noisy than durations since they depend on code path, not machine speed (an inference; I found no source measuring their run-to-run variance). Use them with the app's own counters.
**Searched:** Chrome DevTools Protocol docs page (JS-only, the protocol JSON gives no metric names); pptr.dev `metrics`; search for variance of LayoutCount (none found).

### GRD-03 · Doubling (scaling) tests exist as a technique, not as a standard JS tool  `[absence]`
The doubling hypothesis (run at n and 2n; a ratio near 2^b means about O(n^b)) is textbook (Princeton), and pythonspeed's performance-testing series says "start by testing big-O scaling" [10]. A Ruby gem (`benchmark-trend`), a Rust crate (`benchkit` scaling module) and a MATLAB parameterised test do the same; all from a search summary, not read in full [likely]. I found no widely used JavaScript library, and none in a big editor's repository (CodeMirror's author said "No benchmarks have been done" and that the aim is "the absence of performance cliffs" by design [11]). So the test must be home-built; the novelty is to apply the ratio to counters instead of time, which removes the noise that makes time-based ratios flaky (the point of GRD-01).
**Searched:** web search "doubling test benchmark scaling ratio library JS/Rust"; CodeMirror forum "CM6 Performance Benchmarks"; npm registry searches by the verifier (doubling test complexity benchmark; big-o scaling test; empirical complexity assert), which returned only unrelated packages (graphql-query-complexity, scslre, code-complexity).

### GRD-04 · Firefox, Chromium and VS Code run wall-clock perf CI with humans acting on alerts  `[confirmed]`
Mozilla's Perfherder raises alerts when a test crosses a framework threshold, with listed values such as Talos, Browsertime and build metrics at 2% [12]; sheriffs triage, file the bug and, for stalled regressions, a backout is possible under the regression policy [12]. Chromium's doc says "If you make a change that regresses measured performance, you will be required to fix it or revert", and "It is your responsibility to justify the regression" [13]; bisect bots find the culprit. VS Code's perf bots use the "best of N runs" and post to Slack with a dashboard [14]. Takeaway for a one-owner repository: the rule "the author must fix, revert or justify" is worth copying; the infrastructure is not.

### GRD-05 · Noise handling: statistics when you must time, counts when you can  `[confirmed]`
VS Code's chat-perf tool flags a regression only when the value passes the threshold and is statistically significant (Welch's t-test, p below 0.05), uses medians with IQR outlier removal and says 5+ runs for CI [8]. It runs daily against a fixed baseline build, so the trend of `main` can be bisected [8]. Mozilla requires a sustained shift over future data points, and notes some tests are noisy enough to be removed [12]. The `pythonspeed` write-up gives the stock fix for shared runners: run under Cachegrind and use its instruction count [15]. A 1.5% noise floor hides a 0.5% slowdown [15], but a quadratic regression is a 2x-100x effect (the author's inference, not from a source), so for the doubling test even a loose bound is safe.

### GRD-06 · Lint: ESLint selectors and ast-grep rules express call shapes; inside a loop needs relational matching  `[likely]`
ESLint's `no-restricted-syntax` accepts "AST selectors" with a custom message, for example `CallExpression[callee.name='setTimeout'][arguments.length!=2]` [16]. ast-grep has `inside` with `stopBy: end` to express within a loop (its own `no-await-in-loop` example) [search result; not saved, so the ast-grep half is `[likely]`; the ESLint half is confirmed]. The app uses Biome, so these are alternatives, not additions; Biome (below) or the existing TS-AST scripts are the fit.

### GRD-07 · Biome 2.5.5 GritQL plugins match patterns and can suggest rewrites, without a semantic model; JS plugins arrive in 2.6  `[confirmed]`
Biome's plugin docs describe `.grit` files listed in `plugins` that report diagnostics, with `includes` to restrict paths, and v2.5 added "Code fix for plugins" [6][17]. Biome 2.6 announces JavaScript plugins "as a developer preview", designed "to mirror the architecture, shape, and APIs of Biome's Rust lint rules", with `defineRule`, `ast("JS_CALL_EXPRESSION")`, `registerDiagnostic` and an optional `{ semantic: true }` model for bindings and scopes [18]. Verification correction: the finding earlier called GritQL plugins diagnostic-only and said they cannot see loops; that was wrong in part. Plugins can also suggest fixable rewrites (`=>`, `fix_kind`, applied with `--write`, per the verifier's reading of the plugins page), and the "cannot see loops" claim had no source: the page says plugins do not have access to the semantic model or file kind, and its own example uses `contains`, so loop containment is untested here. The page also says the Developer Preview JS plugins may have breaking changes in patch releases, and that plugins run on every file. Without a semantic model GritQL cannot express data flow ("is this value the whole document?"), so any rule is heuristic: match shapes such as `$x.split("\n")` and let a baseline absorb existing hits.
**Searched:** biomejs.dev/linter/plugins, biomejs.dev/blog/biome-v2-5, biome-v2-6; no mention of a ratchet or baseline feature (I found none; hence keep the repo's own ratchet).

### GRD-08 · Ratchets with a baseline are the proven way to introduce a rule over existing violations  `[confirmed]`
The app already does it: `scripts/check-listeners.mjs` counts hits per folder, "fails when a folder has more than `scripts/allowlists/listeners.json` records, and `--write` records it as it is" (read in the local file). Per-folder counts avoid line-number churn. Extend with the same `lib/repo.mjs` helpers. Rust's perf triage follows the same social pattern: a perf-regression label means the author must justify it or open a follow-up issue [2 and search summary; the triage-process wording is [likely]].

### GRD-09 · Agent guidance: short, checkable rules; context files alone are not a free win  `[confirmed]`
The ICLR 2026 study of AGENTS.md ("Evaluating AGENTS.md", arXiv 2602.11988) found context files gave no consistent gain in task success and raised cost by over 20% on average (by the study's numbers: developer-written files raised success by about 4% on average and LLM-generated files lowered it by about 3%; cost rose 20% and 23% for LLM-generated files and by up to 19% for developer-written ones), while "coding agents tend to respect their instructions"; it concludes that unnecessary requirements make tasks harder and that human-written files should describe only minimal requirements [19][20]. Claude Code hooks can inject `additionalContext` (wrapped in a system reminder, capped at 10,000 characters) and PreToolUse hooks can control whether a tool call proceeds [9]. Inference [likely]: since agents follow rules they are given, the failure is rules that are unmeasurable ("keep it fast"); a rule that names a counter, a helper and a failing check is the form to use. I found no study comparing performance rules specifically; and no major project's AGENTS.md with a performance section (a search surfaced only skill files and one doubtful mirror).
**Searched:** web search "AGENTS.md performance section"; "AGENTS.md effectiveness study"; no primary source for performance-specific agent rules.

### GRD-10 · PerfFuzz and SlowFuzz find slow inputs; they need native targets  `[likely]`
SlowFuzz (CCS 2017) uses resource-usage-guided evolutionary search to find inputs that maximise resource use, including super-linear regex matching in PCRE; PerfFuzz (ISSTA 2018, AFL-based) maximises execution counts per program location and, per the abstract, generates inputs exercising the most-hit branch "5x to 69x" more than prior work and giving "1.9x to 24.7x" longer total paths (the abstract says "prior work"; that the comparison is with SlowFuzz is this chapter's reading) [the numbers are on the saved page [21]]. For this app: the Rust shell and decoders can be targeted by cargo-fuzz with a counter-based oracle; for TypeScript the practical equivalent is a generator of known-bad shapes (one 100 KB line; 60,000 tiny blocks; deeply nested lists and emphasis; many link-reference definitions; long runs of a single character) in the matrix, since a coverage-guided JS fuzzer is a heavy dependency [inference]. A ReDoS-specific tool survey was not completed (ReCheck, Regexploit not read).
**Searched:** search "PerfFuzz"; "SlowFuzz ReDoS fuzzer recheck regexploit" (nothing on recheck, regexploit).

### GRD-11 · CodeMirror's author avoids cliffs by design rather than by benchmark  `[confirmed]`
Asked about benchmarks, the maintainer replied "No benchmarks have been done... everything has been carefully written to avoid being linear to document size or even line length, so the main thing I can promise right now is the absence of performance cliffs" [11] (June 2020; old). Guard by construction (viewport-bounded work) is the strongest guard, and a test should assert the bounded property (flat counters), not speed. No later CodeMirror perf-CI source found.

## Options compared
| Option | Fit for this app | Cost | Risk | Verdict |
|---|---|---|---|---|
| Doubling matrix on counters (CDP + app counters) | High: catches O(n²) deterministically | Medium: generators, counters, 1-3 min in full tier | Engine differences (Chromium only for layout counts) | Do first |
| Wall-clock perf bots (Talos/Chromium style) | Low | High: dedicated hardware, sheriffs | Noise, ignored alerts | No |
| Cachegrind/iai-callgrind/CodSpeed on Rust and core | Medium: for `packages/core` parsers under Node, and Rust decoders | Medium | Not the webview; Linux/macOS only | Later, for parsers |
| TS-AST checks + ratchet baseline | High: existing pattern | Low | Heuristic false positives | Do second |
| Biome GritQL plugin | Medium: editor feedback for single-shape rules | Low | No semantic model or file kind (so no data flow); can suggest rewrites; loop matching untested; experimental | Optional |
| Biome JS plugin (2.6 preview) | Medium | Low-medium | Preview; app on 2.5.5 | Wait |
| PostToolUse hook with lint message | Medium: puts rule at edit time | Low | Context noise | Add if checks are slow |
| Long AGENTS.md performance chapter | Low | Low | Study: no consistent gain (about +4% developer-written, about -3% LLM-generated), cost up to +23% | No; eight lines only |
| Coverage-guided fuzzing of TS | Low | High | Setup | Use generators instead |

## Open questions
- Run-to-run variance of `LayoutCount`/`RecalcStyleCount` in headless Chromium: settle by running the matrix cell 20 times.
- Whether Chromium counts predict WebKit's cost on macOS: settle with a one-off WKWebView timing run (Tauri window) on the worst matrix cells.
- Which of the heuristics have tolerable false-positive rates: run the lint against the tree and count hits before choosing which to ratchet.
- Whether agents follow the eight rules: A/B a few features with and without the section (no published evidence found).

## Cross-links
- 03 (parsing): the pathological Markdown generators for the matrix; GRD-10.
- 04 (dom-rendering): the DOM node and layout-count caps; GRD-02.
- 05 (typesetting): the unbroken-paragraph cell and "typeset blocks" counter.
- 06 (main-thread): long-task counter and the work-budget/yield helper the lint should point to.
- 08 (search-highlight): ReDoS cell; user patterns in linear-time engine or worker.
- 09 (buffers-memory): `JSHeapUsedSize` and allocation counts as matrix metrics.

## Sources
1. SQLite, Measuring and Reducing CPU Usage in SQLite — https://sqlite.org/cpu.html (accessed 2026-11-27) — Cachegrind "repeatable to 7 or more significant digits"; wall-clock "scarcely repeatable".
2. Rust internals, What is perf.rust-lang.org measuring and why is "instructions:u" the default? — https://internals.rust-lang.org/t/what-is-perf-rust-lang-org-measuring-and-why-is-instructions-u-the-default/9815 (accessed 2026-11-27) — instruction vs wall graphs.
3. tak, methodology — https://tak.jdx.dev/guide/methodology (accessed 2026-11-27) — noise numbers; "Gate on instruction counts." (a small project; secondary).
4. CodSpeed, unrelated benchmark regression — https://codspeed.io/blog/unrelated-benchmark-regression (accessed 2026-11-27) — CPU Simulation mode with Valgrind; vendor blog.
5. Chrome DevTools Protocol, browser_protocol.json — https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/json/browser_protocol.json (accessed 2026-11-27) — `Performance.getMetrics`: "Retrieve current values of run-time metrics."
6. Biome, Linter Plugins — https://biomejs.dev/linter/plugins/ (accessed 2026-11-27) — GritQL plugins, `includes`, diagnostics.
7. Puppeteer, Page.metrics() — https://pptr.dev/api/puppeteer.metrics (accessed 2026-11-27) — lists LayoutCount, RecalcStyleCount, JSHeapUsedSize.
8. VS Code chat-perf SKILL — https://raw.githubusercontent.com/microsoft/vscode/main/.github/skills/chat-perf/SKILL.md (accessed 2026-11-27) — gating metrics, Welch's t-test, 5+ runs, daily CI.
9. Claude Code, Hooks reference — https://code.claude.com/docs/en/hooks (accessed 2026-11-27) — `additionalContext`, 10,000-character cap.
10. pythonspeed, Unit testing your code's performance, part 1: Big-O scaling — https://pythonspeed.com/articles/big-o-tests (accessed 2026-11-27) — "start by testing big-O scaling".
11. CodeMirror forum, CM6 Performance Benchmarks — https://discuss.codemirror.net/t/cm6-performance-benchmarks/2471 (accessed 2026-11-27) — maintainer, June 2020.
12. Mozilla, Performance Sheriffing — https://firefox-source-docs.mozilla.org/testing/perfdocs/perf-sheriffing.html (accessed 2026-11-27) — thresholds, sheriff workflow, backout.
13. Chromium, Addressing Performance Regressions — https://chromium.googlesource.com/chromium/src/+/main/docs/speed/addressing_performance_regressions.md (accessed 2026-11-27) — fix or revert; justify.
14. VS Code wiki, Perf Tools for VS Code Development — https://github.com/microsoft/vscode/wiki/%5BDEV%5D-Perf-Tools-for-VS-Code-Development (accessed 2026-11-27) — "best of N runs", Slack, dashboard.
15. pythonspeed, Reliable benchmarking in noisy environments — https://pythonspeed.com/articles/consistent-benchmarking-in-ci (accessed 2026-11-27) — noise 1.5%; Cachegrind fix.
16. ESLint, no-restricted-syntax — https://eslint.org/docs/latest/rules/no-restricted-syntax (accessed 2026-11-27) — AST selectors with messages.
17. Biome v2.5 release notes — https://biomejs.dev/blog/biome-v2-5/ (accessed 2026-11-27) — plugin code fix.
18. Biome v2.6 release notes — https://biomejs.dev/blog/biome-v2-6/ (accessed 2026-11-27) — JavaScript plugins, developer preview.
19. Gloaguen et al., Evaluating AGENTS.md (arXiv 2602.11988, html) — https://arxiv.org/html/2602.11988v1 (accessed 2026-11-27) — "coding agents tend to respect their instructions"; cost over 20%.
20. Same, abstract page — https://arxiv.org/abs/2602.11988 (accessed 2026-11-27).
21. PerfFuzz, ISSTA 2018 page — https://conf.researchr.org/event/issta-2018/issta-2018-technical-papers-perffuzz-automatically-generating-pathological-inputs (accessed 2026-11-27); the PDF could not be saved as text, so figures are from a search summary.
