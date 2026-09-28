---
key: MARXY-302
design: [09-app-shell]
depends: []
verify: [pnpm precheck, pnpm done MARXY-302]
---
# MARXY-302 — Track the reading position while scrolling in Source mode, not only at entry/exit

**Design:** [09-app-shell](../../design/09-app-shell.md) · **Delta:** [2026-09-28-bugcatch-3](../deltas/2026-09-28-bugcatch-3.md) · **Depends on:** nothing.

**Outcome.** Leaving Source mode without edits returns to where the reader actually scrolled to, not where they entered Source.

## Why
`lastReadingByteOffset`/`lastReadingFraction` are only written in `showSource()` (on entering Source) and in `enterSourceFromRendered()`/`leaveSourceForRendered()` (on entry/exit) — nothing updates them while the reader scrolls inside CodeMirror. `leaveSourceForRendered()`, when no edits were made, restores Rendered to those stale values.

## Files and signatures
- `apps/desktop/src/app.ts`: update the tracked reading position from a scroll signal while in Source mode.
- `apps/desktop/src/source/editor-cm6.ts`: expose a scroll/viewport-change signal CM6 already has, debounced, for app.ts to read.

## Tests → expected
| Check | Expect |
| --- | --- |
| Scroll within Source, leave without editing | the Rendered view lands near the scrolled-to position, not the entry position |

## Acceptance → check
Row acceptance, checked as listed in the CSV row's acceptance text.
