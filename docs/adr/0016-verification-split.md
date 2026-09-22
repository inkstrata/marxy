# ADR-0016 — Machine gates for everything checkable; a scheduled taste-review queue for the rest

**Status:** accepted · **Source:** handoff §8–9

## Decision
Everything an agent could silently regress fails a build: build, typecheck, lint, format,
unit tests, golden AST+source-map files, screenshot diffs per shipped engine (WKWebView via
Playwright WebKit on macOS, WebKitGTK on a Linux runner), performance budgets, bundle size,
licence audit, byte-fidelity property test, no-network assertion, the mechanical aesthetics
tier. Whether the result is *beautiful* is decided by a person at a scheduled gate at the end
of each phase, from a queue of artifacts agents produce as they go
(`docs/taste-review/queue.md`), never by interrupting a task with "does this look right?".

## Consequences
- Every PR that changes anything visible attaches before/after screenshots and appends a queue
  entry. Reviews are batched, high-signal, and recorded with a decision.
- Drift is caught two ways: screenshot diffs (visual change without intent) and the design
  language stated as constraints, not vibes (`docs/design-language.md`).
