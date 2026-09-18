# ADR-0009 — Always sanitise; block remote content; no telemetry; strict CSP

**Status:** accepted · **Source:** brainstorm A7, Q5 (refined), docs/09 problem 2, C4

## Decision
1. Raw HTML from a file never reaches the DOM unsanitised. The parser is not the boundary:
   parse → sanitise (DOMPurify in the frontend; the same allow-list in `packages/core` for
   tests) → render. `javascript:` and `data:` link targets are dropped.
2. The default allow-list is markdown-equivalent tags only. A visible per-document opt-in
   *widens* the allow-list to a sanitised HTML subset (`<img>`, `<details>`, `<div align>`);
   sanitising is never off.
3. Remote images and any `url()` a theme could fetch are blocked by a strict CSP
   (`default-src 'none'; img-src asset: data:; font-src asset:; style-src 'self' 'unsafe-inline'`
   shape, finalised in the shell). Per-document opt-in for remote images shows a notice where
   the image would be and names what was blocked.
4. No telemetry, crash reporting, update pings or version checks by default. The updater, if
   ever added, is opt-in and documented.

## Why
"Empower those that dare speak" means some readers are at risk; a reader that reports what
they read betrays them. This is the ethos enforced, and no incumbent promises it.

## Consequences
- `scripts/gate-no-network.mjs` renders every corpus file with network denied and asserts
  zero attempted requests, including the hostile fixture.
- Stripping breaks badge-heavy READMEs visibly; the opt-in must be discoverable or users will
  think marxy renders their files wrong (story in Phase 3).
