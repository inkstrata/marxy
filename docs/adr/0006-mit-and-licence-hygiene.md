# ADR-0006 — MIT for the whole tree; OFL fonts isolated; grammar and pattern allow-lists

**Status:** accepted · **Source:** brainstorm D18 (overriding D12), docs/17-licensing

## Decision
Code is MIT, inbound = outbound, no CLA. Bundled typefaces are SIL OFL 1.1 in `fonts/<family>/`
with their licence verbatim, never modified. Syntax grammars and hyphenation patterns are
shipped from explicit allow-lists of MIT/Apache/BSD/MPL-licensed files; a GPL grammar
(Shiki's default pack contains several) or LPPL-quirky pattern fails the licence gate.

## Consequences
- `scripts/gate-licences.mjs` runs in CI over `pnpm licenses` output, the Shiki language
  allow-list, and the hyphenation pattern list; it fails on GPL/AGPL/LGPL-static anywhere.
- `THIRD_PARTY_NOTICES.md` is generated, not hand-written.
- Linux packaging must not vendor `libwebkit2gtk`; use the distribution library.
- Relicensing later would need every contributor's grant; this decision is the cheap one now.
