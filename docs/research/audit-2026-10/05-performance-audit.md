# 05 — Performance audit, measured

**Date:** 2026-10-01 · **Machine:** Apple M5, 10 cores, 24 GB, macOS 26.6.2 (build 25G83) ·
**Tree:** worktree `MARXY-346` at `4526b811` · **Toolchain:** Node 24.18.1, Vite 7.3.6, Tauri 2.11.5,
Playwright 1.63.0 (WebKit build 2359)

**Abstract.** Marxy is fast for the documents it is designed around and falls over on large ones.
On a quiet machine the packaged release binary reaches its `render` mark (the document is in the
DOM, laid out, fonts ready, on the baseline grid) in a median 292 ms for the 20 KB corpus document,
267 ms for a 1.5 KB README and 302 ms for 53 KB of prose. About 240 ms of that is fixed cost in the
shell and webview before Marxy reads a byte; Marxy's own work is 25–60 ms. The Knuth–Plass
typesetter is cheap (at most 27 ms for the viewport, and it runs after first text). Above about
256 KB, two synchronous whole-document passes before first text (a forced layout and the
baseline-grid pass) grow faster than linearly: first text takes 0.55 s at 256 KB, 4–5 s at 1 MB and
277 s at 5 MB. The CI perf machinery is 1,571 lines that record two numbers (start-up and parse) and
cannot fail on either; five of the seven named budgets are never measured anywhere CI reads. The
first-text mark itself could not be taken on this machine, because the screen was locked during
the session and the app correctly refuses to report a paint it did not see.

## Contents

1. Findings at a glance
2. Method and caveats
3. Build and bundle
4. Cold start
5. Parse and render in Node
6. Typeset and paint in WebKit
7. Palette and index
8. Live reload and opening a second document
9. Scaling: where Marxy falls over
10. Honesty of the perf gate
11. Ranked hot spots and recommendations
12. For the synthesis
13. Appendix: scripts and raw output

## 1. Findings at a glance

| # | Finding | Evidence |
| --- | --- | --- |
| F1 | Start-up to the `render` mark is 292 ms median (285–309) for `01-long-technical.md` on a quiet machine; it rose to 408 ms at load average 3–4 and 443 ms at load average 35. | §4, nine launches each |
| F2 | About 80 % of that is shell cost: 150 ms Tauri window and webview creation, 47 ms webview to first script, 38 ms stall on the first IPC call. | §4.2 |
| F3 | Critical-path JavaScript is 309 KB (101 KB gzipped) and compiles and evaluates in about 7 ms in WebKit. Splitting the bundle is not a start-up lever. | §3.3 |
| F4 | The typesetter costs 0–27 ms for the viewport and runs after first text; the kill switch does not change first text at all. Background setting of the rest costs about 300 ms of idle-time main thread for 53 KB of prose. | §6 |
| F5 | Above 256 KB, a forced whole-document layout plus the grid pass (a write-then-read loop over every block) dominate. 1 MB: 4.2–5.2 s to first text in WebKit, 766 MB WebContent memory. 5 MB: 277 s. | §9 |
| F6 | Parsing is micromark at roughly 1–2.6 MB/s on corpus files and 1.3–1.6 MB/s at 1–5 MB; the GFM table extension is the costliest extension. Run-to-run spread of the parse median on one idle machine is 2.7×. | §5 |
| F7 | Palette search is a linear scan: p95 1.6 ms at 5k entries, 5.7 ms at 20k, 12.4 ms at 50k, 24.9 ms at 100k. The in-browser palette test cannot measure under about 17–33 ms, because it waits two animation frames. | §7.1 |
| F8 | The Rust index module (`apps/desktop/src-tauri/src/index/mod.rs`) is not compiled into the app; it has no `mod` declaration. The live index is a TypeScript walk over IPC that makes 975 shell calls for this repository and re-runs on every document open. | §7.2 |
| F9 | CI measures only warm and cold start-up and parse, and fails on neither. Typeset viewport, live reload, find, open-indexed-document and palette keystroke never reach the gate. In-document find does not exist in Rendered mode, so its budget has nothing to measure. | §10 |
| F10 | `scripts/measure-startup.mjs` produces no sample at all when the display cannot paint (locked screen, dark wake); reference-tier measurement cannot run unattended. | §4.1 |

## 2. Method and caveats

Every number below comes from a command run in the worktree on 2026-10-01 between 22:15 and
22:55. Scratch scripts lived in the session scratchpad; their essential source is in the appendix so
each measurement can be re-run.

Three caveats apply throughout.

- **Machine load varied.** Several other audit agents ran tests in parallel. Load average ranged from
  35 (at 22:21) to 1.4 (at 22:53). Each table states the load at the time it was measured. The
  headline start-up numbers are from the quietest window.
- **The screen was locked.** `ioreg -n Root -d1 -a` reported `CGSSessionScreenIsLocked = true`. A
  window that cannot paint never produces the `painted` and `first_text` marks, and the shell's
  2.5 s deadline (`apps/desktop/src-tauri/src/main.rs:364`) ends the launch with `no_paint`. So the
  packaged app's `first_text` was not measurable. Everything up to the `render` mark was.
- **No cache purge was possible.** `sudo -n true` answered `a password is required`, so every
  "cold" launch here is process-cold only, as `scripts/measure-startup.mjs` itself would record.

Two harnesses stand in for what the locked screen prevented. The **app harness** loads
`apps/desktop/dist/app.html` in Playwright WebKit and boots the real `startApp` against the memory
shell (`apps/desktop/src/harness/app-harness.ts`, the same entry `apps/desktop/test/app-harness.test.mjs`
uses). It emits the same marks the shell prints, including `first_text`, `typeset_viewport` with its
`ms=` detail, and `live_reload`. It excludes process start, window creation and real IPC.

## 3. Build and bundle

### 3.1 Build times and binary

```sh
pnpm --filter @marxy/desktop build:web          # real 3.09 s; vite "built in 1.74s"
cd apps/desktop/src-tauri && cargo build --release --locked --features tauri/custom-protocol
#   Finished `release` profile [optimized] target(s) in 2m 28s
#   real 148.56  user 290.74  sys 23.45   (263 crates compiled, empty target dir)
ls -la target/release/marxy                      # 8969696 bytes, Mach-O 64-bit arm64
```

| Artefact | Value |
| --- | --- |
| Web build (Vite) | 3.1 s wall |
| Release build from an empty `target/` | 148.6 s wall, 263 crates, `lto = true`, `codegen-units = 1` |
| Release binary | 8,969,696 bytes (8.6 MiB), assets embedded and brotli-compressed by Tauri's default `compression` feature |
| `apps/desktop/dist` | 241 files, 8,923,531 bytes |
| Bundle budget (`fixtures/perf-budgets.json`) | 30 MB installed on macOS; far from binding |

The CI gates job builds the `ci` profile instead (thin LTO, 16 codegen units,
`apps/desktop/src-tauri/Cargo.toml:30`), so every start-up number CI has ever recorded is from a
different binary than the one a tag ships.

### 3.2 Composition

A sourcemapped copy of the build (`vite build --sourcemap --manifest`) attributes each chunk's bytes
to packages. Chunks are classed by walking imports from `index.html`: **critical** is the static
closure of the entry, **lazy** is anything reached by `import()`, **worker only** is reached only
from `highlight.worker`.

| Load class | Content | Files | Bytes | Gzip |
| --- | --- | ---: | ---: | ---: |
| Critical | `index-*.js` + `app-*.js` | 2 | 309,260 | 100,739 |
| Critical | `index.html` (theme CSS inlined) | 1 | 31,070 | 9,430 |
| Critical | Literata roman + JetBrains Mono (preloaded) | 2 | 1,255,276 | 673,500 |
| On first render | Literata italic (not preloaded; `fonts_ready` lists it) | 1 | 902,728 | 513,126 |
| Lazy (Source mode) | CodeMirror + Lezer | 14 | 680,321 | 247,065 |
| Lazy (math only) | KaTeX JS | 62 | 300,851 | 94,529 |
| Lazy (math only) | KaTeX fonts, all three formats | 59 | 1,072,948 | 869,213 |
| Lazy (after first text) | Hyphenation patterns en-us, en-gb | 2 | 62,559 | 31,055 |
| Lazy (main thread) | Shiki engine | 1 | 171,572 | 56,939 |
| Lazy (main thread) | Shiki grammars, 24 languages | 24 | 1,921,234 | 205,114 |
| Worker only | Shiki engine | 1 | 168,491 | 55,815 |
| Worker only | Shiki grammars, same 24 languages again | 24 | 1,921,360 | 205,227 |
| Lazy | Other app chunks (title, edits, …) | 44 | 92,761 | 46,906 |

What the critical `app` chunk holds, by source bytes: `@marxy/core` 222 K, micromark-core-commonmark
111 K, justif 71 K, `@marxy/typeset` 54 K, the app module 54 K, the palette 49 K, micromark 41 K,
smol-toml 37 K, mdast-util-from-markdown 28 K, the GFM table extension 28 K, `@marxy/theme` 26 K,
selection 25 K, commands 23 K. The typesetter, palette, selection, commands and TOML loader are not
needed for first text but ride the critical chunk.

Two pieces of installed weight do no work.

- **Every Shiki grammar ships twice** (1.92 MB each copy). `apps/desktop/src/render/highlight.ts:5`
  statically imports the main-thread highlighter, which exists only as a fallback for when the worker
  fails (`highlight.ts:84-91`).
- **KaTeX fonts ship in woff2, woff and ttf.** WebKit uses woff2; the other two formats are about two
  thirds of 1.07 MB.

Neither costs time at start-up. Both cost installed size.

### 3.3 What the critical path actually costs

The static-import guard (`apps/desktop/src/startup/static-import-graph.test.mjs`) holds: no
grammar, KaTeX or CodeMirror reaches the entry. So the critical path is small JavaScript plus large
fonts.

```sh
node webkit-load.mjs   # 9 fresh contexts per page, Playwright WebKit
# index.html DOMContentLoaded 12 ms; last JS chunk arrived 5 ms; compile+evaluate ≈ 7 ms; runs [10,9,10,7,8,7,7,7,7]
# app.html   DOMContentLoaded 12 ms; last JS chunk arrived 4 ms; compile+evaluate ≈ 7 ms; runs [7,8,7,8,7,7,8,6,7]
```

Compile and evaluate of the 309 KB critical JavaScript is about 7 ms. Moving the typesetter and
palette out of the entry chunk would save a few of those milliseconds at most.

Tauri decompresses each embedded asset on request. Brotli at quality 9 decompresses the three fonts,
the app chunk and the HTML in 3.40 + 3.33 + 0.72 + 0.46 + 0.04 ≈ 8 ms in Node. That is the upper
bound of what disabling compression or switching to woff2 could buy, and woff2 would add its own
decompression. Fonts are not a meaningful start-up lever on this machine.

## 4. Cold start

### 4.1 The official measurement could not produce a sample

`docs/hygiene.md` and the `gates` job in `.github/workflows/ci.yml` (lines 240-245) run
`node scripts/measure-startup.mjs` with `MARXY_PERF_REQUIRED=1`, `MARXY_PERF_ENV=ci` and
`MARXY_RUNNER_CLASS`. With `CI` unset the script defaults to reference mode. Both were run against
the release binary.

```text
$ MARXY_BIN=$PWD/apps/desktop/src-tauri/target/release/marxy node scripts/measure-startup.mjs
launch 1 (cold): no first_text mark, exit 1, webview start 638 ms
launch 2 (cold): no first_text mark, exit 1, webview start 328 ms
launch 3 (cold): no first_text mark, exit 1, webview start 277 ms
launch 4 (cold): no first_text mark, exit 1, webview start 191 ms
launch 5 (cold): no first_text mark, exit 1, webview start 509 ms
cold start (median of 5 cold launches) null ms (reference mode)
cold procedure: process-cold only
measure-startup failed:
 - 0 of 5 launches produced a first_text mark; ...

$ MARXY_BIN=... MARXY_PERF_REQUIRED=1 MARXY_PERF_ENV=ci MARXY_RUNNER_CLASS=macos-latest node scripts/measure-startup.mjs
launch 1 (cold): no first_text mark, exit 1, webview start 214 ms
... (launches 2-9 identical in shape, webview start 200-393 ms)
measure-startup failed:
 - 0 of 9 launches produced a first_text mark; ...      exit=1
```

A single launch by hand shows why: every mark up to `render` arrives, then the paint deadline fires.

```text
$ MARXY_QUIT_AFTER_PAINT=1 target/release/marxy fixtures/corpus/01-long-technical.md
MARK main_start 1790918450228
MARK window_shown 1790918450517
MARK script_start 1790918450612
...
MARK render 1790918450851 blocks=83 chars=16226 heading=Stack evaluation
MARK no_paint 1790918453354 deadline_ms=2500
```

This is correct behaviour by the app: it never reports a paint it did not observe
(`apps/desktop/src/app.ts:1268-1292`). It does mean the reference tier, which ADR-0022 assigns to
"the maintainer's macOS machine", silently depends on someone sitting at an unlocked screen, and that
a run under those conditions records nothing about the 95 % of start-up that did happen.

### 4.2 Start-up to the `render` mark, measured

A scratch launcher (`launch-marks.mjs`, appendix) spawns the binary exactly as `launchOnce` does
(`Date.now()` at spawn, `MARXY_QUIT_AFTER_PAINT=1`) and keeps every mark rather than only
`first_text`. Each run is nine launches two seconds apart; the 01 run kills any `marxy` process
before each launch.

**Quiet machine (load average 1.4–2.0), release binary:**

| Stage (mark → mark) | 02 README, 1.5 KB | 01 long technical, 20 KB | 15 prose, 53 KB | Waterfall target (cumulative) |
| --- | ---: | ---: | ---: | --- |
| spawn → `main_start` | 4–9 | 4–10 | 4–9 | — |
| `main_start` → `window_shown` | 151 | 150 | 153 | 60 |
| `window_shown` → `script_start` | 47 | 47 | 47 | 150–160 |
| `script_start` → `args` | 38 | 38 | 38 | 175 (with `readFile`) |
| `args` → `file_read` | 2 | 2 | 2 | |
| `file_read` → `parsed` | 7 | 18 | 25 | 185 |
| `parsed` → `rendered` | 3 | 6 | 8 | 200 |
| `rendered` → `fonts_ready` (forced layout + fonts) | 4 | 13 | 15 | 240 |
| `fonts_ready` → `render` (grid pass) | 2 | 7 | 1 | |
| **spawn → `render`, median** | **267** | **292** | **302** | `first_text` ≤ 300, budget 500 |
| spawn → `render`, range | 248–273 | 285–309 | 296–305 | |

Medians of nine launches. Source files: `launch-marks-lowload-02b.jsonl`, `-01b.jsonl`, `-15b.jsonl`.

**The same measurement under load (01 long technical):**

| Load average | spawn → `render` median | range | `main_start` → `window_shown` | `script_start` → `args` | parse |
| --- | ---: | --- | ---: | ---: | ---: |
| 1.4–2.0 (22:52) | 292 | 285–309 | 150 | 38 | 18 |
| 3.1–3.8 (22:46) | 408 | 377–435 | 185 | 61 | 30 |
| 24–40 (22:21) | 443 | 320–508 | 195 | 61 | 37 |

The spread is the machine, not the code: the same binary on the same file moved 40 % with the
load average.

`first_text` is `render` plus the wait for two engine frames. The WebKit harness (§6) measured that
wait at a median 4–22 ms per document. So `first_text` on this machine is expected around
300–330 ms for corpus documents, under the 500 ms figure and close to the waterfall's 300 ms target.
That is a derived figure from two measured parts, not a measurement of `first_text`.

### 4.3 Where the 292 ms goes

| Segment | ms | Share | Owner |
| --- | ---: | ---: | --- |
| Process to `main_start` | ~6 | 2 % | dyld, Rust runtime |
| Tauri builder, plugins, window + WKWebView creation | 150 | 51 % | shell (`main.rs:789-813`) |
| WebContent process, HTML load, JS compile and evaluate | 47 | 16 % | webview (JS itself ≈ 7 ms) |
| First IPC round trip(s) | 38 | 13 % | shell / IPC |
| Read, parse, render, layout, grid | 46 | 16 % | Marxy |
| **Total to `render`** | **~290** | | |

Two details in that table are worth a story each.

**The first-IPC stall.** `script_start` is taken at module evaluation (`apps/desktop/src/app.ts:165`)
and the next timestamps come after `await shell.mark('script_start')` and `await shell.args()`. A
later IPC (`readFile` of 20 KB) costs 2 ms and the `args` call itself costs 0–1 ms
(`weight_offset → args`). Yet one of the first two calls consistently waits 38–60 ms. In launch 2 of
the load-3 run the mark returned in 2 ms and `args` took 56 ms, so the stall is not module
evaluation; it is something occupying the shell before IPC is served. Commands like
`mark_from_webview` and `args` are synchronous Tauri commands, which run on the main thread, and
`setup` builds the macOS menu on the main thread right after `window_shown`
(`apps/desktop/src-tauri/src/main.rs:811-812`). The architecture's waterfall says "no menu
construction on the path". The attribution is a hypothesis; a mark after `set_menu` would settle it.

**Window creation is three times its target.** 150 ms against 60 ms. This is mostly WKWebView
start-up, which Marxy controls little of. In passing: `tauri_plugin_dialog::init()` is registered
twice on macOS (`main.rs:794` and `main.rs:802`).

### 4.4 Comparison with the numbers on record

| Source | Number | What it is |
| --- | --- | --- |
| ADR-0029, "honest numbers already on record" | 2,844 ms macOS | packaged, older build and hardware |
| `fixtures/perf-budgets.json`, `macos-latest` warm | 1,572–2,423 ms | GitHub runner, `ci` profile, `first_text` |
| `fixtures/perf-budgets.json`, `macos-latest` cold | 1,657–2,613 ms | same, launch 1 |
| This audit, M5, quiet | 292 ms to `render` | release profile, one paint short of `first_text` |

The 500 ms product figure is within reach on current Apple Silicon and has been for some time; the
GitHub macOS runner's warm first text (1,572–2,423 ms) is roughly 5–8× this machine's time to `render` and says little about a reader's experience.

## 5. Parse and render in Node

`parse-and-render.ts` (appendix) imports `parseMarkdown` from `packages/core/src/index.ts` and
`renderDocumentSafeHtml` from `packages/core/src/render/index.ts` (the pair `apps/desktop/src/app.ts:1095-1097`
calls), warms up 5 times, then takes 20 iterations per file.

```sh
node --expose-gc parse-and-render.ts fixtures/corpus/*.md     # load average 3.3
```

| File | Bytes | Parse ms (median) | Parse p90 | Render ms (median) | Render p90 | AST nodes | HTML bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 01-long-technical.md | 20,378 | 7.80 | 12.13 | 1.82 | 2.67 | 1,189 | 43,584 |
| 02-readme-real-world.md | 1,571 | 1.15 | 2.40 | 0.29 | 0.62 | 120 | 4,962 |
| 03-ai-plan.md | 1,911 | 0.93 | 1.22 | 0.23 | 0.37 | 131 | 5,689 |
| 05-pathological-table-and-nesting.md | 6,799 | 5.16 | 9.31 | 1.64 | 4.22 | 1,316 | 42,257 |
| 06-math.md | 1,031 | 0.29 | 0.42 | 0.06 | 0.09 | 26 | 1,983 |
| 07-cjk.md | 1,322 | 0.40 | 0.70 | 0.10 | 0.14 | 64 | 2,906 |
| 08-rtl.md | 1,163 | 0.30 | 0.39 | 0.07 | 0.09 | 32 | 1,877 |
| 09-gfm-everything.md | 1,843 | 1.86 | 3.57 | 0.44 | 0.72 | 201 | 7,306 |
| 10-hostile.md | 265,918 | 25.35 | 52.93 | 2.33 | 4.95 | 89 | 4,486 |
| 11-empty.md | 0 | 0.02 | 0.05 | 0.01 | 0.01 | 1 | 0 |
| 12-crlf-and-bom.md | 159 | 0.26 | 0.38 | 0.03 | 0.07 | 14 | 426 |
| 13-no-trailing-newline.md | 51 | 0.07 | 0.10 | 0.02 | 0.03 | 5 | 160 |
| 14-marxy-plan.md | 5,951 | 5.97 | 9.50 | 0.86 | 1.44 | 239 | 9,881 |
| 15-prose-volume.md | 52,907 | 36.51 | 47.61 | 5.24 | 6.68 | 1,635 | 62,962 |
| 16-api-reference.md | 3,975 | 3.73 | 7.36 | 0.89 | 1.36 | 337 | 13,964 |
| 17-changelog.md | 2,423 | 3.41 | 5.50 | 0.79 | 1.34 | 196 | 7,459 |
| 18-agent-transcript.md | 2,514 | 2.65 | 3.94 | 0.48 | 0.88 | 105 | 5,165 |
| 19-source-file.md | 3,472 | 0.79 | 1.68 | 0.06 | 0.11 | 3 | 3,519 |
| 23-task-openers.md | 373 | 0.73 | 1.37 | 0.14 | 0.23 | 63 | 2,228 |
| 26-skill-front-matter.md | 1,322 | 0.22 | 0.57 | 0.04 | 0.09 | 6 | 1,642 |
| 27-alerts.md | 275 | 0.69 | 1.71 | 0.08 | 0.14 | 40 | 1,337 |
| 29-hidden-characters.md | 552 | 0.61 | 1.24 | 0.13 | 0.26 | 27 | 1,474 |
| README.md | 1,007 | 0.99 | 1.56 | 0.13 | 0.50 | 39 | 1,414 |

The `04-source.*` files are not markdown; the app opens them in Source mode (CodeMirror), so they
were not parsed.

**Render is cheap; parse is the half that matters.** Render plus sanitise is 15–25 % of parse.

**The numbers are noisy even on a quiet machine.** Three repeats with 30 warm-up and 60 measured
iterations, and three runs of the CI script, on the same file within two minutes:

```text
ITER=60 WARM=30 node parse-and-render.ts ... (x3)      01-long-technical parse median: 13.84, 10.21, 18.43 ms
node scripts/measure-parse.mjs (x3)                     15.38, 8.44, 6.85 ms   (also 15.17 in a fourth run)
```

The CI parse metric (`parse_long_technical_ms`, product budget 10 ms) moved 2.7× between runs of
the same code on an idle machine. The variation is garbage collection and JIT state, not load. A
budget of 10 ms sits inside that band, which is why the numbers in `fixtures/perf-budgets.json`
could never have held as a gate.

**Where parse time goes** (`parse-split.mjs`, `parse-ext.mjs`, `parse-gfm.mjs`, appendix):

| 01-long-technical, ms (median) | Value |
| --- | ---: |
| UTF-8 decode with byte offsets | 0.08 |
| micromark + mdast, CommonMark only | 4.2–4.5 |
| micromark + mdast, with GFM, front matter and math | 10.7–12.0 |
| conversion to the Marxy AST (`documentFromMdast`) | 0.30 |

| Extension alone over CommonMark (01 / 15, ms) | 01 | 15 |
| --- | ---: | ---: |
| none | 4.22 | 10.05 |
| GFM (all of it) | 11.36 | 28.09 |
| front matter | 4.05 | 9.85 |
| math | 4.21 | 10.31 |

Within GFM, measured with micromark's syntax extensions alone, the table extension adds about
4 ms on both files (none 7.87 → table 12.27 on 01; 11.15 → 15.27 on 15); autolink, footnote,
strikethrough and task items each add under 0.5 ms. The rest of GFM's cost is in the mdast side
(`gfmFromMarkdown`). Byte-provenance conversion, the part Marxy wrote, is under 3 % of parse.

## 6. Typeset and paint in WebKit

### 6.1 Per corpus file

`webkit-app.mjs` (appendix) boots the real app per file, seven fresh pages each, viewport 1100×800,
and reads the app's own marks from the memory shell. It then polls until no new `.marxy-set`
paragraph has appeared for 300 ms ("all set") and until every code block with a language is
highlighted or given plain lines. The second run injects `:root { --marxy-typeset: none; }`, the
kill switch `packages/typeset/src/index.ts:132` reads. Load average 4.5–9.

No `performance.mark` exists anywhere in `apps/desktop/src` or `packages/typeset/src`; the marks are
the app's `shell.mark` calls. Times are milliseconds from `startApp`, medians of seven.

| File | Parse | Render | Layout + fonts | Grid | Paint wait | **first_text** | Typeset viewport (`ms=`) | Paragraphs set | All set | Highlight done | first_text, kill switch | All set, kill switch |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 01-long-technical | 17 | 7 | 23 | 2 | 6 | **58** | 13 | 54 | 171 | no code | 71 | 113 |
| 02-readme-real-world | 7 | 3 | 17 | 1 | 5 | **34** | 4 | 2 | 76 | 87 | 34 | 70 |
| 03-ai-plan | 7 | 2 | 6 | 1 | 10 | **28** | 7 | 3 | 74 | 85 | 26 | 63 |
| 05-pathological | 14 | 6 | 25 | 7 | 5 | **60** | 0 | 0 | 100 | — | 58 | 96 |
| 06-math | 4 | 2 | 3 | 1 | 11 | **24** | 0 | 0 | 167 | 178 | 23 | 144 |
| 07-cjk | 5 | 2 | 34 | 1 | 7 | **50** | 0 | 0 | 84 | — | 47 | 79 |
| 08-rtl | 4 | 2 | 23 | 1 | 4 | **34** | 15 | 1 | 82 | — | 35 | 66 |
| 09-gfm-everything | 10 | 4 | 25 | 1 | 14 | **57** | 4 | 0 | 168 | 179 | 51 | 153 |
| 10-hostile | 31 | 4 | 5 | 1 | 7 | **53** | 7 | 9 | 107 | 118 | 48 | 85 |
| 12-crlf-and-bom | 3 | 1 | 3 | 1 | 19 | **27** | 4 | 0 | 64 | — | 27 | 60 |
| 13-no-trailing-newline | 2 | 1 | 2 | 1 | 20 | **28** | 3 | 0 | 64 | — | 25 | 57 |
| 14-marxy-plan | 8 | 3 | 5 | 1 | 6 | **27** | 17 | 35 | 103 | — | 26 | 61 |
| 15-prose-volume | 25 | 8 | 23 | 1 | 4 | **65** | 27 | 80 | 438 | — | 84 | 143 |
| 16-api-reference | 9 | 4 | 18 | 1 | 5 | **38** | 8 | 12 | 90 | partial | 52 | 96 |
| 17-changelog | 7 | 3 | 4 | 1 | 7 | **24** | 8 | 12 | 69 | — | 25 | 62 |
| 18-agent-transcript | 7 | 2 | 7 | 2 | 21 | **42** | 10 | 7 | 90 | 101 | 37 | 77 |
| 19-source-file | 4 | 1 | 3 | 0 | 18 | **26** | 0 | 0 | 62 | 73 | 28 | 61 |
| 23-task-openers | 5 | 2 | 7 | 2 | 22 | **38** | 5 | 0 | 77 | — | 44 | 75 |
| 26-skill-front-matter | 3 | 1 | 2 | 1 | 18 | **27** | 4 | 0 | 63 | — | 26 | 57 |
| 27-alerts | 4 | 2 | 2 | 1 | 12 | **23** | 5 | 0 | 60 | 70 | 23 | 55 |
| 29-hidden-characters | 5 | 2 | 18 | 1 | 5 | **33** | 7 | 1 | 82 | 93 | 29 | 67 |
| README | 5 | 2 | 3 | 0 | 13 | **24** | 11 | 4 | 74 | — | 22 | 62 |

`11-empty.md` was skipped: it correctly produces `no_text` and no `first_text`.

Raw `first_text` runs show the spread is small, e.g. 01: `[85,54,58,60,57,58,52]`; 15:
`[63,63,67,65,65,66,75]`.

### 6.2 What this says about the typesetter

- **First text does not wait for it.** `typesetDocument` runs after `first_text`
  (`apps/desktop/src/app.ts:1292-1294`). With the kill switch, `first_text` is the same within noise
  (58 vs 71, 65 vs 84; the kill-switch run happened to be the noisier one).
- **The viewport pass is cheap.** 0–27 ms, against the 100 ms product budget; 27 ms for 53 KB of
  continuous prose is the worst case in the corpus. Loading the hyphenation patterns adds 2–4 ms
  once.
- **The rest of the document is not free.** Setting every paragraph of `15-prose-volume.md` ends
  438 ms after start against 143 ms with the kill switch: about 300 ms of main-thread work in
  idle chunks of eight paragraphs (`packages/typeset/src/index.ts:288-300`). Each background chunk
  also schedules a grid pass over the whole article (`apps/desktop/src/app.ts:956`).
- **Many paragraphs are never set.** Fallbacks for verse, inline objects, CJK, RTL and short
  paragraphs mean `05`, `06`, `07`, `09` and others set zero paragraphs; that is by design.

`Layout + fonts` (17–34 ms on some small files) is the forced `doc.offsetHeight` and
`document.fonts.ready` at `app.ts:1108-1110`; on files that use italics or code, the italic and mono
faces load there. It is the largest Marxy-owned stage for small documents.

Highlighting finishes 10–12 ms after the app reports ready for files with code, and only for blocks
within two screens of the viewport (`apps/desktop/src/render/highlight.ts:152-163`), so "partial"
for `16` and `0/5` highlighted for `18` are the observer working as designed, not failures.

### 6.3 What WebKit does not expose

Playwright's `page.metrics` and heap figures are Chromium-only, and WebKit implements no
`layout-shift` or `PerformanceObserver` paint entries Marxy could use (the harness says so at
`apps/desktop/src/render/headless.ts:83`). Layout and paint were therefore timed as stage
boundaries, and memory was sampled from the operating system (§9.3).

## 7. Palette and index

### 7.1 Palette keystroke

```text
$ node --test --experimental-strip-types src/palette/search-perf.test.ts      # load 3.1
searchPrepared p95 on 20000 entries: 5.45 ms, machine 1.40× the reference, budget 22.4 ms
✔ p95 keystroke-to-results is under 16 ms on a 20,000-entry index (511.51125ms)

$ node --test ... --test-name-pattern="keystroke to rows" test/palette.test.mjs   # in WebKit
palette keystroke p95 35.0 ms (16 ms product budget, 40.0 ms envelope here; recorded, ADR-0032)
```

`search-perf.test.ts` times the pure search function. `palette.test.mjs:300-348` times a real
keystroke in WebKit, but its sample waits for two `requestAnimationFrame` callbacks after each
input, so its floor is one to two frames (17–33 ms at 60 Hz) whatever the search costs. Its 35 ms is
mostly frame alignment; the method cannot show whether the 16 ms budget is met.

Scaling the same entry shape (`palette-scale.ts`, appendix, load 3.1):

| Entries | `prepareIndex` | Search median | Search p95 | Max | Slowest query (median) |
| ---: | ---: | ---: | ---: | ---: | --- |
| 5,000 | 2.1 ms | 1.01 ms | 1.58 ms | 1.96 ms | "detail", 1.47 ms |
| 20,000 | 15.2 ms | 4.03 ms | 5.70 ms | 6.57 ms | "detail", 5.35 ms |
| 50,000 | 25.8 ms | 9.23 ms | 12.36 ms | 14.77 ms | "detail", 12.16 ms |
| 100,000 | 39.6 ms | 18.63 ms | 24.87 ms | 28.70 ms | "detail", 24.18 ms |

Search is a linear scan of every prepared entry on every keystroke, about 0.2 µs per entry. It meets
16 ms comfortably at 20k entries, has a few milliseconds to spare at 50k (the index's per-root cap),
and misses at 100k. For the author's "tracked collection with a quick search bar" across several
roots, 100k is reachable.

`search-perf.test.ts` still asserts `p95 < 16 ms × machine factor` (line 103). That is a timing
assertion inside `pnpm test`, which the `ci` job runs, and it contradicts ADR-0032 ("no named
interaction time is a CI failure") and the cleanup recorded in `docs/hygiene.md` (MARXY-153).

### 7.2 The index

**The Rust index is not part of the app.** `apps/desktop/src-tauri/src/main.rs:3-8` declares
`atomic_write`, `commands`, `error`, `watch` and `watch_notify`; there is no `mod index`. So
`apps/desktop/src-tauri/src/index/mod.rs` (573 lines, with its own mtime cache) is never compiled,
and its eight tests never run in CI. Compiled on its own it builds and passes:

```text
$ rustc --edition 2021 --test -O index.rs -o index-tests && ./index-tests
test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

**The live index is TypeScript over IPC.** `loadIndex` (`apps/desktop/src/startup/idle-work.ts:145`)
walks with one `readDir` IPC per directory, probes `.gitignore` and `.ignore` with a `readFile` IPC
each per subdirectory (`idle-work.ts:245-255`), and reads up to 256 KB of every markdown file for its
headings (`idle-work.ts:163-185`). It runs inside `runDeferredStartup`, which `finishDocumentOpen`
calls on **every** open, not just at launch (`apps/desktop/src/app.ts:1120-1129`; the harness in §8
shows `index_loaded` after a palette open).

The same code path, run in Node with a synchronous reader (`index-bench.ts`, appendix), and the
dead Rust walk compiled standalone (`walk`, appendix):

| Root | Raw files after deny list | Entries | TS walk | TS heading reads | TS `buildIndex` | TS total | Entries/s (TS) | Shell calls the app would make | Rust `walk_root` (no headings) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| this repository | — | 1,207 | 35 ms | 55 ms | 39 ms | 128 ms | 9,398 | 975 (155 `readDir`, 312 ignore probes, 508 heading reads) | 10–12 ms (≈110k files/s) |
| `~/Dev` | 11,465 | 3,908 | 218 ms | 133 ms | 112 ms | 464 ms | 8,430 | 3,206 | 128–131 ms (≈30k files/s) |

```sh
find ~/Dev \( -name node_modules -o -name target -o -name .git -o -name dist -o -name build \
  -o -name .venv -o -name venv -o -name out -o -name __pycache__ -o -name .next -o -name .turbo \
  -o -name coverage \) -prune -o -type f -print | wc -l          # 11465
```

The Node figure is a floor: it has no IPC. In the app every one of those 975 calls is an `invoke`
through Tauri's custom protocol. A single `readFile` round trip measured 2 ms in the start-up marks
(§4.2), so the in-app walk is likely several times the Node time, but the `index_loaded` mark comes
after `first_text`, which a locked screen never reaches, so it was not measured here.

A 5k or 50k-entry index could not be built from a real tree on this machine; `~/Dev` yields 3,908
entries. The synthetic 20k-file tree in `packages/core/src/index-model/build-perf.test.ts` is the
closest existing probe.

## 8. Live reload and opening a second document

### 8.1 Live reload

`apps/desktop/test/live-reload.test.mjs` asserts that a `live_reload` mark with `ms=` exists but does
not print it. `webkit-reload.mjs` (appendix) uses the same mechanism: boot, scroll, write appended
bytes through the memory shell, emit a `modified` watch event, and read the mark. The mark's `ms=`
covers re-render, scroll restore and the viewport typeset (`apps/desktop/src/app.ts:803-820`); it
excludes the file-system watcher's own latency and the debounce in Rust.

| File | Bytes | `live_reload` ms (median of 5) | Event → mark wall ms | Runs |
| --- | ---: | ---: | ---: | --- |
| 02-readme-real-world | 1,571 | 7 | 11 | 7, 8, 6, 6, 7 |
| 01-long-technical | 20,378 | 29 | 49 | 29, 28, 29, 29, 28 |
| 15-prose-volume | 52,907 | 46 | 93 | 45, 46, 48, 46, 49 |
| big-256k (generated) | 264,940 | 354 | 477 | 325, 364, 361, 354, 349 |

The 100 ms budget holds for every corpus document and fails 3.5× at 256 KB. The reload re-parses and
re-renders the whole document and re-runs the grid pass; nothing is incremental. The end-to-end
figure a reader sees adds the watcher's debounce, which needs the real binary and a visible window.

### 8.2 Opening a second, already-indexed document

Same harness, open `README` first, then `handle.open('/docs/other.md')` (`webkit-open.mjs`):

| Document opened | Open → `render` mark | Open resolved | Marks emitted on the open |
| --- | ---: | ---: | --- |
| 02-readme-real-world | 9 ms | 12 ms | file_read, parsed, rendered, fonts_ready, render, typeset_viewport, highlight_ms, **index_loaded**, position_restored |
| 01-long-technical | 53 ms | 70 ms | same |
| 15-prose-volume | 66 ms | 113 ms | same |

The 50 ms "open indexed document" budget is met for small files and just missed for the 20 KB one.
`index_loaded` on every open confirms the index is rebuilt each time; the memory shell's tiny tree
hides what that costs on a real repository.

### 8.3 Find

There is no in-document find in Rendered mode. `#marxy-find` is an empty placeholder
(`apps/desktop/index.html:29`); only Source mode has CodeMirror's search keymap
(`apps/desktop/src/source/editor.ts:110`). The `find_first_match_ms` budget has no feature to
measure.

## 9. Scaling: where Marxy falls over

### 9.1 Generated documents

`01-long-technical.md` repeated to 256 KB (264,940 bytes), 1 MB (1,059,760) and 5 MB (5,258,040).

**Node (load 8.8):**

| File | Parse median | Render median | AST nodes | HTML bytes | Retained heap after GC | Peak RSS growth during one parse |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 01 (20 KB) | 7.8–18 ms | 1.8–3.8 ms | 1,189 | 43,584 | 1.7 MB | 15 MB |
| 256 KB | 147 ms | 31 ms | 15,445 | 582,340 | — | — |
| 1 MB | 664 ms | 128 ms | 61,777 | 2,350,153 | 21.9 MB | 373 MB |
| 5 MB | 4,008 ms | 527 ms | 306,505 | 11,888,387 | 102.7 MB | 1,400 MB |

Parse scales linearly at about 1.3–1.6 MB/s here. Its transient memory does not: a single 5 MB parse
grows the process by 1.4 GB before GC returns most of it, about 270 bytes of garbage per source
byte. That is micromark's event stream.

**WebKit app harness (load 2.7–4.8):**

| File | Parse | Render | Layout + fonts | Grid | Paint wait | **first_text** | Typeset viewport | Ready | All set |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 01 (20 KB) | 17 | 7 | 23 | 2 | 6 | **58 ms** | 13 | 131 | 171 |
| 256 KB | 113 | 39 | 370 | 8 | 24 | **0.55 s** | 20–23 | 0.69 s | 2.4 s |
| 1 MB | 385 | 156 | 2,354 | 2,251 | 41 | **4.2–5.2 s** | 40 | 5.5 s | 15.5 s |
| 5 MB | 2,229 | 509 | 63,100 | 64,224 | 146,593 | **277 s** | 2,057 | 752 s | not done in 120 s |

Size grew 4× from 256 KB to 1 MB and first text grew 9×; it grew 5× from 1 MB to 5 MB and first text
grew 55×. Parse and render stay linear. The two stages that explode are the forced layout and the grid
pass, both before `first_text`.

### 9.2 Isolating the two stages

`webkit-layout.mjs` (appendix) puts the rendered HTML into the themed `#doc`, forces one layout, then
runs the grid pass's step-2 shape: for each block child, write a padding, then read the next block's
top (`packages/typeset/src/grid.ts:46-55`).

| File | HTML bytes | Blocks | `innerHTML` | First forced layout | Write-then-read loop |
| --- | ---: | ---: | ---: | ---: | ---: |
| 01 (20 KB) | 43,389 | 91 | 1 ms | 17 ms | 5 ms |
| 256 KB | 579,805 | 1,183 | 8 ms | 151 ms | 313 ms |
| 1 MB | 2,340,013 | 4,732 | 31 ms | 1,817 ms | 4,684 ms |

The loop is quadratic: every write invalidates layout and every read forces a fresh one over the
whole article. The real grid pass only writes where a block is off the grid, so it does fewer
round trips than this worst case, but the shape is the same, and it runs again after font loads,
resizes and background typeset chunks (`apps/desktop/src/app.ts:741-760`, `app.ts:956`). The first
layout itself is WebKit's and grows faster than linearly at these sizes.

### 9.3 Memory in the real app

`app-mem.mjs` launches the release binary and samples the RSS of `marxy` and of the WebContent
process that appears during the launch (load 2.4). With the screen locked these runs end at the
paint deadline, so they show memory up to first render.

| Document | Peak `marxy` RSS | Peak WebContent RSS | spawn → `render` |
| --- | ---: | ---: | ---: |
| 01 (20 KB) | 98 MB | 89 MB | 287 ms |
| 256 KB | 98 MB | 288 MB | 599 ms |
| 1 MB | 101 MB | 766 MB | 13.2 s |

The 1 MB launch spent 12.3 s between `rendered` and `fonts_ready` in the real app against 2.35 s in
the harness. A window that cannot paint has its timers and promise callbacks throttled by WebKit
(the comment at `apps/desktop/src/app.ts:1276-1280` describes this), so large-document numbers from
the real binary under a locked screen overstate the cost; the harness numbers are the better guide.

### 9.4 The verdict on scale

| Size | Experience on this machine | Binding cost |
| --- | --- | --- |
| up to ~60 KB (every corpus file) | first text in ~300 ms from launch; reload under 50 ms | shell start-up |
| ~256 KB | 0.6 s to `render` in the release binary (0.55 s to first text in the harness); reload 354 ms; all set 2.4 s | layout + reload of the whole document |
| ~1 MB | 4–5 s blank window; 766 MB; 15 s until fully set | forced layout + grid pass (quadratic) |
| ~5 MB | minutes; effectively hung | same, plus 1.4 GB transient parse memory |

AI agent transcripts and logs, which `docs/brief.md` puts second in priority, routinely exceed 1 MB.
Marxy falls over between 256 KB and 1 MB.

## 10. Honesty of the perf gate

### 10.1 What CI measures

| Named quantity | Product budget | Produced by | Where it runs | Reaches `gate-perf`? | Can fail CI? |
| --- | ---: | --- | --- | --- | --- |
| `cold_start_first_text_ms` | 500 (withdrawn as a ceiling, ADR-0029) | `measure-startup.mjs`, launch 1 | `gates`, both OSes, `ci` profile | yes | no (ADR-0032) |
| `warm_start_first_text_ms` | — | `measure-startup.mjs`, launches 2–9 | `gates` | yes | no |
| `parse_long_technical_ms` | 10 | `measure-parse.mjs` | `gates` | yes (merged from `perf-parse.json`) | no |
| `palette_keystroke_ms` | 16 | `apps/desktop/test/palette.test.mjs:336-347` writes `results/perf.json` | `ci` job's browser suite, a different job | **no**: the `gates` job never sees that file, and `measure-startup.mjs` overwrites it | indirectly yes: `search-perf.test.ts` asserts a scaled 16 ms |
| `typeset_viewport_ms` | 100 | emitted as a mark only | nowhere | **no** | no |
| `live_reload_ms` | 100 | emitted as a mark only | nowhere | **no** | no |
| `open_indexed_document_ms` | 50 | nothing | nowhere | **no** | no |
| `find_first_match_ms` | 50 | nothing; the feature does not exist in Rendered mode | nowhere | **no** | no |

`scripts/gate-perf.mjs:18` lists all six product keys and prints whichever appear
(`gate-perf.mjs:291-298`), so the gate's output would look complete if they were ever written. In CI
they never are.

### 10.2 The product tier

The product numbers in `fixtures/perf-budgets.json` are compared only in reference mode
(`gate-perf.mjs:212-230`), which runs only in the release runbook (`docs/sdlc.md:280-281`) and
never in CI. Even there, ADR-0032 makes every comparison print-only. No product number is checked
by anything that can fail. ADR-0013's "hard CI failures from Phase 0" has been amended away in
three steps (ADR-0022, ADR-0029, ADR-0032), which matches the author's stated position, but the
machinery built for the original promise remains.

### 10.3 Cost of the apparatus

| Item | Size |
| --- | --- |
| `scripts/gate-perf.mjs` | 798 lines |
| `scripts/measure-startup.mjs` | 511 lines |
| `scripts/measure-parse.mjs` | 255 lines |
| `scripts/ci-summary.mjs` | 7 lines |
| Named self-test cases | 97 (`node scripts/gate-perf.mjs --selftest` → "82 named cases here, 15 in measure-startup, 97 together") |
| Commits touching the perf scripts and budgets file | 12: eleven between 2026-09-18 and 2026-09-20, one on 2026-09-29 |
| CI time per pull request (from `docs/hygiene.md:110-111`) | macOS: nine launches 36 s; Ubuntu: 31 s, plus the build that exists partly to measure |

That is about 1,570 lines and 97 self-tests guarding the integrity of two numbers that cannot fail,
measured on runners 5–8× slower than this machine, using a different Cargo profile than ships. The
integrity checks are well made (the record keeps launch order, refuses empty samples, names its
cold procedure). What they protect is not a speed commitment. What a reader feels (typeset, reload,
open, palette, large files) is not measured at all.

A small documentation drift: `docs/hygiene.md:178` says the `cold_warm_ratio` check "fails only below
0.8"; `gate-perf.mjs:242-245` now prints that case as INVALID and does not fail.

### 10.4 What an honest, cheap version would measure

The app harness used in this audit already produces every product quantity except cold start, in
under five minutes for the whole corpus, deterministic to a few milliseconds, with no Tauri build:
`first_text` from `startApp`, `typeset_viewport` (`ms=`), `live_reload` (`ms=`), and open-to-render
via `handle.open`. Pairing it with `searchPrepared` timings and one start-up sample that records
every mark (not only `first_text`, so a locked screen still yields the shell stages) would cover six
of the seven budgets. Recording them nightly rather than on every pull request matches ADR-0032.

## 11. Ranked hot spots and recommendations

Effort is in story-sized units: S (a day or less), M (two to four days), L (a week or more). "Buys"
is what the measurements above support, not a promise.

### 11.1 Cheap and sure

| Rank | Hot spot | Lever | Effort | Buys | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Grid pass is a write-then-read loop over every block, re-run after fonts, resizes and every background typeset chunk | Compute every block's new top in one read pass and write all paddings once; or derive offsets arithmetically from heights already read in step 1 (`grid.ts:46-55`). The MARXY-282 note about margin collapse is the constraint to respect | M | ~2.2 s at 1 MB, 64 s at 5 MB; ≈0 at corpus sizes; also shortens every background typeset chunk | §9.1, §9.2 |
| 2 | Index re-walks the whole root on every open, over hundreds of IPC calls | Build once per root per session, keep it in memory, update from the watcher; later wire the existing Rust module (`index/mod.rs` already has `walk_root`, `cache_is_current`, `write_cache`) so a walk is one IPC | M | 975 → 1 IPC per walk for this repository; Rust walk 10 ms vs TS 128 ms even without IPC; removes the walk from every open | §7.2, §8.2 |
| 3 | 38–60 ms stall on the first IPC call | Add a mark after `set_menu`; if confirmed, build the menu after `first_text` as the waterfall already requires | S | up to ~38 ms (13 % of start-up) | §4.3 |
| 4 | Dead Rust index module and its untested tests | Either `mod index;` and use it (rank 2) or delete it | S | Honesty; 8 tests start running | §7.2 |
| 5 | Measurement blind spots | Extend the start-up record with every mark; add a nightly harness run for typeset, reload, open and palette; remove the timing assert in `search-perf.test.ts` (or say in ADR-0032 that this one stays) | S–M | Six of seven budgets observed instead of two | §10 |
| 6 | Installed weight with no runtime role | Make the main-thread Shiki fallback a dynamic import so grammars ship once; ship KaTeX fonts as woff2 only | S | −1.9 MB grammars, about −0.7 MB KaTeX fonts; 0 ms | §3.2 |
| 7 | Palette linear scan | When a query extends the previous one, filter the previous result set instead of the whole index | S | 2–5× on typed-ahead queries; keeps 100k entries under 16 ms | §7.1 |

### 11.2 Larger, likely worth it

| Rank | Hot spot | Lever | Effort | Buys | Risk |
| --- | --- | --- | --- | --- | --- |
| 8 | Forced whole-document layout before `first_text` | Put the first two screens of blocks in the DOM, emit `first_text`, append the rest in idle chunks; or `content-visibility: auto` on top-level blocks (supported in current WebKit) | M–L | 1.8–2.3 s at 1 MB; the 256 KB case drops toward 200 ms | The grid pass and reading-position restore read every block's geometry; both need to work on a partial or skipped layout |
| 9 | Live reload re-renders the whole document | Diff the AST by top-level block provenance and replace only changed blocks; typeset only those | M | 354 ms → tens of ms at 256 KB; matters for agents appending to a log or transcript | Byte-provenance remapping after the splice |
| 10 | Shell start-up (150 ms window + 47 ms webview) | Resident mode, already sanctioned by ADR-0013 as opt-in; and measure the single-instance path, where a second `marxy file.md` reuses the running process | M | most of ~200 ms on second and later opens | A resident process is a policy choice the author has ruled on once |

### 11.3 Speculative

| Lever | Why it is tempting | Why it is speculative |
| --- | --- | --- |
| Parse in a web worker | Keeps the UI responsive during 0.4–4 s parses of large files | Does not shorten first text; the AST must be structured-cloned back (61k nodes at 1 MB); render and layout still run on the main thread |
| Rust-side parse (pulldown-cmark or comrak with byte offsets) | Native parsers are typically one to two orders of magnitude faster than micromark | Must reproduce the frozen AST contract, provenance, GFM, math and front-matter behaviour and the golden corpus; contradicts "core runs in Node and in a browser"; buys only 7–25 ms at corpus sizes |
| Trim the GFM table extension or replace mdast conversion | Tables are the largest single extension cost (~4 ms on 01) | Small absolute gain; parity risk |
| Font changes (woff2, subsetting, inlining) | Fonts are 2.2 MB of the critical path | Decompression is ~8 ms total and loads are local; subsetting Literata is blocked by the Reserved Font Name |
| Bundle splitting of the `app` chunk | It carries typesetter, palette and TOML parser not needed for first text | All critical JS compiles and evaluates in ~7 ms |

### 11.4 Against the author's feature direction

- **A tracked collection with a quick search bar.** This is ranks 2 and 7: a persistent, watched index
  rather than a per-open walk, and a search that stays under 16 ms past 50k entries. The Rust module
  that would do the walking already exists and is switched off.
- **Tiling split view.** Each document in view pays its own parse, layout, grid pass and background
  typeset, and WebContent memory rose from 89 MB for a 20 KB document to 766 MB for a 1 MB one.
  Rank 1 and rank 8 bound the per-pane cost; without them, parking one large log next to a README
  makes the whole window sluggish.
- **Clipboard and text operations.** Operations re-render through the same path as an open
  (`commitEdit`), so they inherit live reload's whole-document cost (rank 9).
- **Speed as a stated goal.** On current Apple Silicon, start-up for normal documents is already
  close to the original 300 ms target. The gap a reader would notice is large documents, not launch.

## 12. For the synthesis

1. Marxy starts fast on this machine: 292 ms median from spawn to a laid-out document for the 20 KB
   corpus file, about 80 % of it Tauri and WebKit start-up, and the 500 ms product figure is within
   reach without heroics.
2. Marxy falls over between 256 KB and 1 MB: first text takes 0.55 s at 256 KB, 4–5 s at 1 MB and
   277 s at 5 MB, because a forced whole-document layout and a quadratic grid pass run before first text.
3. Fixing the grid pass (one read pass, one write pass) and deferring off-screen blocks are the two
   levers that matter for speed a reader feels, and both are medium-sized stories.
4. The Knuth–Plass typesetter is not a performance problem: 0–27 ms for the viewport, after first
   text, and the kill switch does not change first text.
5. The Rust index module is not compiled into the app; the live index walks over hundreds of IPC calls
   and re-runs on every open, which the collection-and-search feature cannot be built on.
6. CI's perf apparatus (about 1,570 lines, 97 self-tests) records only start-up and parse, fails on
   neither, and never sees typeset, reload, open, find or palette; a nightly run of the existing app
   harness would observe six of the seven budgets for a fraction of the code.
7. The reference-tier start-up measurement produces nothing on a locked or sleeping display and
   should record every mark so it degrades to the shell stages instead of to an empty sample.
8. Palette search is a linear scan that stays under 16 ms to about 50k entries and misses at 100k;
   incremental filtering is a cheap fix before multi-root collections arrive.
9. Grammars ship twice and KaTeX fonts ship in three formats, about 2.6 MB of installed weight with
   no runtime role; bundle splitting and font changes are not start-up levers (JS compiles in ~7 ms,
   font decompression is ~8 ms).

## 13. Appendix: scripts and raw output

All scripts ran from the worktree root with paths into the worktree hard-coded as
`R = '/Users/ian/Dev/marxy-wt/MARXY-346/'`. They were kept in the session scratchpad, not the tree.

### 13.1 `parse-and-render.ts` (§5, §9.1)

```ts
import { readFileSync } from 'node:fs';
const R = '/Users/ian/Dev/marxy-wt/MARXY-346/';
const { parseMarkdown } = await import(R + 'packages/core/src/index.ts');
const { renderDocumentSafeHtml } = await import(R + 'packages/core/src/render/index.ts');
const ITER = Number(process.env.ITER ?? 20), WARM = Number(process.env.WARM ?? 5);
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const count = (n: any): number => !n || typeof n !== 'object' ? 0
  : (typeof n.type === 'string' ? 1 : 0) + (Array.isArray(n.children) ? n.children.reduce((a: number, c: any) => a + count(c), 0) : 0);
for (const f of process.argv.slice(2)) {
  const bytes = readFileSync(f);
  for (let i = 0; i < WARM; i++) renderDocumentSafeHtml(parseMarkdown(bytes, { file: f }));
  const pt: number[] = [], rt: number[] = []; let ast: any;
  for (let i = 0; i < ITER; i++) {
    const t0 = performance.now(); ast = parseMarkdown(bytes, { file: f }); const t1 = performance.now();
    renderDocumentSafeHtml(ast); const t2 = performance.now(); pt.push(t1 - t0); rt.push(t2 - t1);
  }
  console.log(f, bytes.length, med(pt).toFixed(2), med(rt).toFixed(2), count(ast));
}
```

Run: `node --expose-gc parse-and-render.ts fixtures/corpus/*.md`. Large files were generated by
repeating `fixtures/corpus/01-long-technical.md` with a blank line between copies until the target
size was reached.

### 13.2 `launch-marks.mjs` (§4.2)

```js
import { spawn, spawnSync } from 'node:child_process';
const [bin, doc, n = 9, settle = 2000] = process.argv.slice(2);
for (let i = 0; i < Number(n); i++) {
  if (process.argv.includes('--kill-before-each')) spawnSync('pkill', ['-x', 'marxy']);
  await new Promise(r => setTimeout(r, Number(settle)));
  const t0 = Date.now();
  const child = spawn(bin, [doc], { env: { ...process.env, MARXY_QUIT_AFTER_PAINT: '1' }, stdio: ['ignore', 'pipe', 'ignore'] });
  let out = ''; child.stdout.on('data', d => { out += d; });
  await new Promise(r => child.on('exit', r));
  const marks = {};
  for (const l of out.split('\n')) { const m = /^MARK (\S+) (\S+)/.exec(l); if (m && !(m[1] in marks)) marks[m[1]] = Number(m[2]) - t0; }
  console.log(JSON.stringify({ i: i + 1, marks }));
}
```

Run: `node launch-marks.mjs $PWD/apps/desktop/src-tauri/target/release/marxy $PWD/fixtures/corpus/01-long-technical.md 9 2000 --kill-before-each`.

Raw tail, quiet run, 01-long-technical:

```text
main_start→window_shown [164,153,155,151,149,150,149,148,148] median 150
window_shown→script_start [48,49,49,44,47,46,48,46,46] median 47
script_start→args [38,38,38,37,38,39,38,37,38] median 38
args→file_read [2,2,2,2,2,2,2,2,2] median 2
file_read→parsed [18,18,17,19,17,17,18,18,17] median 18
parsed→rendered [6,6,7,6,7,6,6,7,7] median 6
rendered→fonts_ready [12,11,13,13,18,18,18,12,12] median 13
fonts_ready→render [8,8,7,7,1,1,2,7,8] median 7
spawn→render [309,296,299,290,292,291,293,285,291] median 292 min 285 max 309
```

### 13.3 `webkit-app.mjs` (§6, §9.1), core loop

The script serves `apps/desktop/dist` over `127.0.0.1`, launches `webkit` from the repository's
Playwright, and for each file and run does:

```js
await page.goto(`${base}app.html`);
await page.waitForFunction(() => typeof window.marxyApp?.start === 'function');
const res = await page.evaluate(async ({ b64, kill }) => {
  if (kill) { const st = document.createElement('style'); st.textContent = ':root { --marxy-typeset: none; }'; document.head.append(st); }
  const t0 = Date.now(); const p0 = performance.now();
  const handle = await window.marxyApp.start({ '/docs/doc.md': b64 }, ['/docs/doc.md']);
  await handle.ready;
  // then poll: "all set" = no new .marxy-set for 300 ms; highlight done = every language block has data-marxy-done
  const marks = {};
  for (const c of handle.shell.calls) if (c.method === 'mark' && !(c.args[0] in marks)) marks[c.args[0]] = c.args[1] - t0;
  return { marks, ready_ms: performance.now() - p0 };
}, { b64: bytes.toString('base64'), kill });
```

Run: `node webkit-app.mjs 7 $(ls fixtures/corpus/*.md | grep -v 11-empty)` and again with `--kill`.
`webkit-reload.mjs` and `webkit-open.mjs` reuse the same boot and add, respectively, a
`writeFileAtomic` + `emit([{ kind: 'modified', path }])` and a `handle.open('/docs/other.md')`,
then read the `live_reload` and `render` marks.

### 13.4 Other scripts

| Script | What it does | Section |
| --- | --- | --- |
| `bundle.mjs`, `attribute.mjs` | Walk static and dynamic imports from `dist/index.html`; attribute chunk bytes to packages from sourcemaps (`vite build --sourcemap --manifest --outDir <scratch>`) | §3.2 |
| `webkit-load.mjs` | `DOMContentLoaded` minus last JS `responseEnd` for `index.html` and `app.html`, nine fresh contexts | §3.3 |
| `parse-split.mjs`, `parse-ext.mjs`, `parse-gfm.mjs` | Time `decodeWithOffsets`, `fromMarkdown` with and without each extension, and `documentFromMdast` | §5 |
| `node-mem.mjs` | One parse and render after `gc()`, retained heap and peak RSS sampled every 5 ms | §9.1 |
| `palette-scale.ts` | `prepareIndex` and 200 `searchPrepared` calls at 5k–100k entries, the shape of `search-perf.test.ts` | §7.1 |
| `index-bench.ts` | `collectFiles` + 256 KB heading reads + `buildIndex` with a sync reader that counts the shell calls `loadIndex` would make | §7.2 |
| `rust-index/main.rs` | `mod index;` (a copy of `index/mod.rs`) and three timed `walk_root` rounds; `rustc -O --edition 2021 main.rs` | §7.2 |
| `webkit-layout.mjs` | `innerHTML`, one forced layout, and a write-padding-then-read-top loop over block children | §9.2 |
| `app-mem.mjs` | Launch the release binary, sample `ps -o rss=` for `marxy` and the newly spawned WebContent process every 100 ms | §9.3 |
| brotli one-liner | `zlib.brotliCompressSync` at quality 9, then median of 15 `brotliDecompressSync` per asset | §3.3 |

### 13.5 Raw tails not shown above

```text
$ node webkit-app.mjs 1 big-5mb.md
{"file":"big-5mb.md","bytes":5258040,"parse":2229,"render":509,"fonts":63100,"grid":64224,"first_text":276694,
 "paint_wait":146593,"typeset_viewport_ms":2057,"hyphenation_load_ms":74748,"ready":751927,"typeset_done":null,...}
node webkit-app.mjs 1 big-5mb.md  1.81s user 0.97s system 0% cpu 14:33.79 total

$ node webkit-layout.mjs fixtures/corpus/01-long-technical.md big-256k.md big-1mb.md
{"file":"01-long-technical.md","html_bytes":43389,"innerHTML_ms":1,"first_layout_ms":17,"write_read_loop_ms":5,"blocks":91}
{"file":"big-256k.md","html_bytes":579805,"innerHTML_ms":8,"first_layout_ms":151,"write_read_loop_ms":313,"blocks":1183}
{"file":"big-1mb.md","html_bytes":2340013,"innerHTML_ms":31,"first_layout_ms":1817,"write_read_loop_ms":4684,"blocks":4732}

$ node app-mem.mjs target/release/marxy big-1mb.md
{"doc":"big-1mb.md","peak_app_rss_mb":101,"peak_webcontent_rss_mb":766,"marks":{"main_start":5,"window_shown":145,
 "script_start":191,"args":230,"file_read":240,"parsed":613,"rendered":756,"fonts_ready":13106,"render":13249,"no_paint":15760}}

$ node --expose-gc node-mem.mjs big-5mb.md
{"file":"big-5mb.md","bytes":5258040,"first_parse_ms":4491.2,"first_render_ms":587,"retained_heap_mb":102.7,
 "retained_per_source_byte":20.5,"rss_growth_peak_mb":1400,"html_len":11838077}
```
