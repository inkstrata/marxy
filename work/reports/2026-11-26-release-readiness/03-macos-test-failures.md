# 03 macOS test failures (partial: the M4 batch was cut off)

> Note added the same day, after this report: the runs here were made on a laptop that was cycling through
> Maintenance Sleep and DarkWake (`pmset -g log`). The overruns of several minutes (the 320 s cases, the 780 s
> `frame.test.mjs` run) match those sleeps, so they are not evidence that Playwright ignores its timeouts (MT-01). The
> CI failure of `frame.test.mjs` has a separate cause: a cold Vite cache re-bundling mid-run (see `README.md`, "CI").

**Bottom line.** No failure I could attribute to a bug a Mac reader would see: 0 confirmed REAL bugs. Of 13 distinct failing cases in the M4 batch, 9 are layout/metric/capability expectations or assertions that are only wrong on WebKit (TEST-ONLY or UNKNOWN), 4 are timing or hang (`large-open-panel` x2, `markdown-lines`, and the ~320 s hangs). Two cases need a human look before tagging because the assertion could hide a real defect: `leave-split` (reading place 2021 became 0 after leaving Split) and `source-fold-stale`/`paste-source` (rendered markup differs from a fresh render; see MT-02, MT-03). `frame.test.mjs` is a flake that hangs: 2 of 3 local runs passed in 47-48 s; run 2 hung 780 s in the first test. The batch never finished (I stopped it after about 35 min): `tail-follow`, `splice-all`, `source-structure` and the `source-fold-stale` re-run alone were not reached. Re-run-alone of failures was NOT done. Treat the classes below as read from assertions plus the 2026-11-26 logs, not as proven.

## frame.test.mjs verdict

Three runs, `node --test --experimental-strip-types --test-concurrency=1 src/source/frame.test.mjs`: pass (47.4 s), **hang** (the first test, "the top bar says what the bytes are", ran 780 s despite a 120 s test timeout, then cancelled; the other 16 passed), pass (48.5 s). On a good run that test takes about 11 s. It boots a fresh WebKit page 8 times in a loop (`withPage` -> `boot`), each waiting up to 90 s for `#marxy-source .cm-line` (frame.test.mjs:59). A single stuck boot or `browser.close()` blocks the loop; the test's `timeout: 120_000` does not stop an awaited Playwright call, so the run overshoots. Verdict: runner/load flake, not an app bug, but the test is the most boot-heavy in the file (8 boots in one test). Fix: split the 8 cases into 8 tests (own timeouts), or boot once and reload.

## Table

| File | Case | Class | Reason | Evidence |
|---|---|---|---|---|
| frame-fonts | face the webview will not draw is tables only | (b)/(d) | Passed this run (1.9 s); failed earlier: after "show the file card" the tier stayed "Its tables only" (race on `.marxy-fcard`) | frame-fonts.test.mjs:223; import log 18-alone |
| frame-media | codec the webview cannot play (ProRes) | (a) | macOS WebKit can play ProRes, so the "facts only" card never appears; test expects Windows | m4-batch.log (33 s); frame-media.test.mjs:221-229 (foot text itself says macOS plays ProRes) |
| frame-media | WMA with no facts | (a)/(d) | 327 s hang; the "webview says no" branch is a codec probe that differs on macOS | m4-batch.log |
| frame-viewers | WebP/HEIC/PNG source; `i.marxy-hex-magic` count 0 vs 16 | (d) | Hex page drew no signature marks; may be a race or a real marking bug | frame-viewers.test.mjs:313 |
| frame-viewers | patch marks changed words | (b)/(d) | 323 s hang | m4-batch.log |
| frame-pdf | outline-shown opens at page 1 | (b) | 323 s hang | m4-batch.log |
| frame-pdf | new query never shows last count | (b)/(c?) | `counts seen` contains "1 of 1 · still counting": the old count shows while counting. 60-90 s budgets are fine; the observer catches a transient | frame-pdf.test.mjs:172 |
| page-states | wide table: no cell cut through | (a)/(c?) | 1 column is cut at the table edge; depends on font metrics at 760 px width. A reader sees a half column at the fade | page-states.test.mjs:65 |
| paste-source | page outside editor byte-identical | (a)/(d) | Body HTML differs after pastes (likely style attr or focus-state attribute) | paste-source.test.mjs:280 |
| source-fold-stale | page is a whole render of current bytes | (d) | Rendered markup differs from a fresh render, with `marxy-set`/`marxy-hang` (hanging punctuation) spans only in one | source-fold-stale.test.mjs:116 |
| leave-split | reading place survives leaving Split | (c?) | Offset 2021 became 0 after Split->Read | leave-split.test.mjs:184 |
| demo-tour | session fence has 2 `.marxy-term-prompt` | (d) | 0 found vs 2 | demo-tour.test.mjs:89 |
| large-open-panel | "Reading N MB…" | (b) | 203-232 s wait; log shows the 200 s `waitForFunction` expiring | large-open-panel.test.mjs:30 |
| large-open-panel | 1.1 MB page painted first | (b) | same file, same budget | m4-batch.log |
| markdown-lines | 6 MB file as lines | (b) | 30 s `waitForFunction` expired (212 s in batch) | markdown-lines.test.mjs:132 |
| tail-follow, splice-all, source-structure | not reached | (d) | batch stopped | n/a |

## Findings

- **MT-01 [BLOCKER for CI] Playwright WebKit calls hang past their timeout.** Three separate cases ran about 320 s with 30-60 s waits, and frame.test.mjs ran 780 s once. A macOS CI job that runs the browser suite will time out or burn minutes. Smallest fix: wrap each case in a hard `Promise.race` deadline in `launchWebkit` users (close the browser on expiry), and split `frame.test.mjs` case 1 into 8 tests. About half a day.
- **MT-02 [SHOULD] `leave-split` place loss (2021 -> 0).** Scroll position after leaving Split is the thing a reader notices. Run it alone, add a settle wait; if it still reports 0, it is REAL. Under 1 hour to decide.
- **MT-03 [SHOULD] Rendered-vs-fresh-render mismatches** (`source-fold-stale`, `paste-source`): the diff shows hanging-punctuation spans (`marxy-set`, `marxy-hang`) present in one render and not the other. If typesetting is async and the test compares too early, it is TEST-ONLY; confirm with a settle wait. About 1 hour.
- **MT-04 [SHOULD] `frame-media` ProRes case and `frame-fonts` tier case encode Windows capability.** Skip or branch on `navigator.platform` (the test already does this once, frame-viewers.test.mjs:301). Small, under 1 hour each.
- **MT-05 [LATER] `page-states` wide-table cut, `frame-viewers` hex-magic count, `demo-tour` prompt count.** Metric/engine dependent; reproduce alone and either relax to the engine's rounding or file a bug.
- **MT-06 [LATER] Timing budgets** (`large-open-panel` 200 s, `markdown-lines` 30 s): scale by a `MARXY_TIME_SCALE` env, or run them alone in CI.

## Fix size and CI gate

- Must fix before macOS CI runs the browser suite: MT-01 (the hangs), because it makes the job unbounded. About 0.5 day.
- Capability and layout groups (MT-04, MT-05): 1-2 days together.
- Timing (MT-06): under 1 day.
- Playwright WebKit is not the system WKWebView: ProRes, HEIC and codec capability, font metrics and hanging-punctuation rendering can differ in the real app; none of the above was checked in the real window.

## Not run

Per-file re-run alone for each failure; `tail-follow`, `splice-all`, `source-structure` (never reported); real WKWebView. Logs: `logs-macos-tests/frame-test-run{1,2,3}.log`, `m4-batch.log` (partial, stopped at 83 cases).
