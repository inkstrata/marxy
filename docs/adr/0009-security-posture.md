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

## What the no-network gate can and cannot observe (MARXY-83)

The gate proves "no request" by intercepting the ones Playwright's network layer fires for: a
stylesheet, an image, a script, and `fetch()`. Three classes never reach that layer at all, because
each needs a `<script>` or a `<link>` element to exist before the browser would ever try: a
**WebSocket** handshake, a **`dns-prefetch`** hint, and a **service worker registration**. The gate
prints this list every run (`gate-observability.ts`, `formatObservabilityReport`) rather than being
silent about it, because a gate quiet about what it cannot see reads as a gate that saw everything.

Today all three are safe for the same reason: the default allow-list (`policy.ts`) does not name
`script` or `link`, so the element each one needs is refused before the capability is ever reached —
proved, not assumed, by `unobservable-classes.test.ts`. **Widening the allow-list to admit `script`
or `link` removes that proof and requires revisiting this record and the gate's observed/unobservable
split before it merges.**

The gate's own checks are named in `packages/core/scripts/gate-assertions.ts`
(`GATE_ASSERTION_IDS`): the interception control, the hostile-fixture control, both halves of the
live-DOM control (an un-allow-listed element, and a block inside a formatting element), the directory-
traversal control, the per-reference containment check, the empty-render check, the three final
aggregate checks (remote requests, escaped requests, live-DOM violations), and both halves of the
parity check (a resurrected element name, a resurrected URL on `PARITY_URL_ATTRIBUTES`). The gate
fails at the end of every run if the set of checks it actually executed is not exactly that list, and
`gate-assertions.test.ts` proves each one independently, so deleting a check — from the gate, from
the list, or from its test — is a change at least one of those three catches.
