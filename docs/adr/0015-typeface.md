# ADR-0015 — Literata for text and JetBrains Mono for code, confirmed by the first taste review

**Status:** accepted 2026-09-18 (taste review #0, Pair A) · **Source:** brainstorm Q6, docs/08; spike finding on axis ranges

## Decision
Default body face **Literata** (variable, `opsz` 7–72, `wght` 200–900, OFL 1.1). Default
monospace **JetBrains Mono** (variable, `wght` 100–800, OFL 1.1). Both bundled unmodified.
Headings at 600, body at 400, with a per-platform `--marxy-weight-offset` applied on Linux.

## Why
Literata was designed for extended screen reading and has an optical-size axis, which matters
across a 13–33 px scale. The spike found that iA Writer Quattro's variable axis is 400–700:
it cannot be adjusted below its regular weight, which removes it as a body face whose weight
must be tuned per platform. JetBrains Mono's axis is wide and its x-height suits code in body
text (design constraint 5). The fallback pair, if review #0 rejects this one, is Source Serif 4
and IBM Plex Mono.

## Consequences
- Taste review #0 sets the same 5,000-word corpus document in both pairs and records a choice.
- `fonts/literata/` and `fonts/jetbrains-mono/` carry their OFL licences; attribution in the
  about surface and the README.
