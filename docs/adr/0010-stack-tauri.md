# ADR-0010 — Tauri, decided by a pre-committed rule; privileged work behind `shell-api`

**Status:** accepted 2026-09-18 · **Source:** `docs/spike/stack-decision-rule.md`, `docs/spike/outcome.md`

## Decision
The desktop shell is **Tauri 2** (WKWebView on macOS, WebKitGTK on Linux, WebView2 later on
Windows). Everything privileged — reading and atomically writing files, watching, dialogs,
clipboard, opening in an external editor, single-instance routing — goes through the
`packages/shell-api` interface, implemented once in `apps/desktop`. The index, matcher and
watcher are Rust (`ignore`, `nucleo`, `notify`) behind that interface.

## Why
Three weighted analyses produced three answers because the weights moved with the brief. A
rule was committed before measuring. The one measurement that could have forced Electron — a
WebKitGTK weight defect that a variable font cannot compensate — did not reproduce on
WebKitGTK 2.52: WebKitGTK is within ~12 units of Chromium on the same Linux machine at
reading size, and both are ~70 units lighter than macOS, which is a macOS property any shell
would have. Footprint (8.9 MB versus 289 MB), idle memory, the Rust toolkit for indexing and
watching, and a first-class CSP and capability model all favour Tauri and were excluded from
the rule so that they could not outrank the thesis.

## Consequences
- Cold start is a CI gate (ADR-0013) on the real bundle, not an assumption inherited from
  benchmarks; the one same-app benchmark in the literature found Electron 40 ms faster.
- Write the frontend against the WebKit baseline; treat Chromium-only CSS as unavailable;
  never rely on `-webkit-font-smoothing`; polyfill `requestIdleCallback`; do not UA-sniff.
- A per-platform weight adjustment token (`--marxy-weight-offset`) exists from Phase 1 and is
  measured by the weight harness on a real Linux desktop before v1.
- Switching shells later means reimplementing `shell-api`, nothing else. That is the escape
  route and it is cheap by construction.
