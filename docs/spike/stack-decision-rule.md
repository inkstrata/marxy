# Stack decision rule — committed before any result exists

**Date:** 2026-09-18 · **Status:** frozen. The commit that introduces this
file predates every spike measurement; the git history is the proof.

The brainstorm ran three weighted stack analyses and got three answers,
because the weights moved with the brief while the frameworks stood still
(`marxy-brainstorm/docs/11-stack-evaluation.md`, A20). This file replaces a
fourth analysis with a measurement and a rule written down before the
measurement is taken, so that the outcome cannot be rationalised in either
direction.

## Candidates

- **Tauri 2** — system webview: WKWebView on macOS, WebKitGTK on Linux.
- **Electron** — bundled Chromium on both platforms.

Native Swift is out (D3). Nothing else is on the table.

## What the spike measures

The same throwaway frontend is built into both shells. Five measurements:

**M1 — WebKitGTK weight fidelity (attacks A1, the critical risk).**
A specimen page sets one serif text face (Literata, variable) and one sans
(iA Writer Quattro, variable) at requested weights 300–700 in 50-unit
steps, at 17px and 34px. It is rendered by:
(a) macOS WKWebView via Tauri — the reference;
(b) macOS Chromium via Electron — the cross-check;
(c) Linux WebKitGTK via Tauri, on an older and a current distribution;
(d) Linux Chromium via Electron on the same distributions.
Metric: ink coverage of each weight sample (mean darkness over its box),
converted to an *effective weight* by inverse interpolation against the
reference curve for the same face and size. **Offset = effective − requested.**

**M2 — Compensation.** Apply a per-platform weight offset on WebKitGTK
(request `requested − offset` on the variable axis), re-measure, and save
reading-size crops for human inspection of residual defects that a weight
offset cannot address: synthetic bold, broken hinting, uneven stems.

**M3 — Cold start on the target machine (attacks A17).** Packaged
applications, both frameworks, on the Apple M5 running macOS 26.6. Time
from process spawn to *first readable text*: a marker the renderer emits on
the first animation frame after the rendered document is in the DOM. Same
5,000-word document. Twelve launches each with three-second gaps, process
not running between launches. Report median and p90. Also record
time-to-webview-ready so framework cost and application cost are separable.

**M4 — CodeMirror 6 in plain-text mode.** Open a multi-megabyte text file;
measure time to interactive and frame times during a scripted scroll, on
macOS in both shells and on WebKitGTK.

**M5 — Index and fuzzy search.** Index a real local tree of tens of
thousands of files, respecting ignore rules, in Rust (`ignore` + `nucleo`)
behind Tauri IPC and in Node (`fdir` + `fuzzysort`) behind Electron IPC.
Measure index build time and per-keystroke query latency (p50, p95) over a
fixed script of 200 queries.

## Thresholds — defined now, not after

| Term | Definition |
| --- | --- |
| **T1 compensable** | After M2, WebKitGTK effective weight at requested 400 and 600 is within **±25 weight units** of the macOS reference at 17px, **and** inspection of the reading-size crops finds no defect a bundled variable font cannot address. A raw offset already under 25 units counts as compensable with nothing to compensate. |
| **T2 startup real** | Tauri median cold start **≤ 0.8×** Electron's. **Wash:** 0.8×–1.25×. **Electron faster:** Tauri > 1.25× Electron. |
| **T3 indexing disappoints** | In Tauri: p95 keystroke latency > 16 ms at the corpus size, or index build > 3× the Node time on the same corpus. |
| **T4 CM6 acceptable** | No scroll frame > 100 ms, time to interactive < 500 ms for the multi-megabyte file, on every engine tested. |

## The rule

| Outcome | Choose |
| --- | --- |
| T1 pass **and** T2 real | **Tauri.** Both objections dissolve. |
| T1 pass **and** T2 wash | **Tauri**, on footprint and the Rust index. The "very fast opener" claim is then delivered by a resident process (Q13 decided *yes*) or dropped as a claim. |
| T1 pass **and** Electron faster | **Tauri only if** its absolute median cold start is still under the 500 ms budget; otherwise **Electron**. The budget is the promise, not the ratio. (This row is new; the brainstorm's rule did not cover both being under budget.) |
| T1 **fail** | **Electron.** The typography thesis outranks everything else in the brief. A reader that sets text wrongly on a promised platform is not the product. |
| T1 pass, T2 Electron faster **and** T3 disappoints | **Electron**, and the speed claims are re-examined. |

T4 is a gate on both candidates, not a tie-breaker: if either engine fails
it, that is recorded as a risk against the plan, not used to choose.

## Deliberately excluded from the rule

Bundle size and idle memory. Both favour Tauri, both were known before the
spike, and neither may outrank the thesis. They appear in the write-up as
context only.

## Fallbacks pre-declared

- If macOS WKWebView screenshots cannot be captured in this session
  (screen-recording permission), the reference curve for M1 becomes macOS
  Chromium via Electron's `capturePage`, which rasterises through CoreText
  and is known to honour weight. The substitution is recorded if used.
- If a distribution's WebKitGTK cannot be built against in the time
  available, one distribution is enough for T1 and the second is recorded
  as untested.

## Prior, on the record

Expected before measuring: T1 passes with a raw offset somewhere between
50 and 100 units on the older WebKitGTK and smaller on the current one;
T2 is a wash or a mild Tauri advantage. Written down so a reader can judge
whether the results moved the decision or the decision moved the results.
