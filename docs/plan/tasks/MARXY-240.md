---
key: MARXY-240
design: [06-shell, 07-index-and-palette]
depends: [MARXY-229]
verify: [pnpm precheck, pnpm done MARXY-240]
---
# MARXY-240 — Make links work: heading ids, in-document and relative links, and external links through the shell

**Design:** [06-shell](../../design/06-shell.md) · [07-index-and-palette](../../design/07-index-and-palette.md) · **Research:** [Reader Artifacts Handbook](../../research/reader-artifacts/10-spec.md) (ADR-0035) · **ADR:** [ADR-0036](../../adr/0036-artifact-units.md) · **Delta:** [2026-09-26-reader-artifacts](../deltas/2026-09-26-reader-artifacts.md) · **Depends on:** MARXY-229.
**Handbook units closed by this story** (`docs/research/reader-artifacts/coverage.json`): `readme.heading-anchors`, `proposal.P15`, `hs.heading-ids-links`.

**Outcome.** Clicking a link does what the reader expects: a table-of-contents entry scrolls, a link to `docs/setup.md` opens it in Marxy, and a web link opens in the browser.

## What is wrong today
Handbook [06](../../research/reader-artifacts/06-readmes.md), [07](../../research/reader-artifacts/07-trust-safety.md).

## Files and signatures
- `packages/core/src/render/heading-ids.ts` — new: github-slugger algorithm (MIT; vendor the algorithm, not a GPL port).
- `apps/desktop/src/selection/view.ts` — link click routing.
- `apps/desktop/src/shell/tauri.ts` — `openExternal`.
- `apps/desktop/src-tauri/src/commands/` — `open_external` with the scheme allow-list.
- `CHANGELOG.md` — one Unreleased line ending with this story's key.

## Do this, in order
1. Heading ids and goldens.
2. `#` links.
3. Relative links.
4. External open.

## Tests → expected
| Check | Expect |
| --- | --- |
| two `## Install` headings | `install`, `install-1` |
| `javascript:alert(1)` passed to open_external | refused |

## Acceptance → check
1. heading-ids.test.ts asserts ids by the github-slugger algorithm with -1, -2 suffixes for duplicates, and that an authored id is kept.
2. apps/desktop/test/links.test.mjs asserts a #anchor link scrolls to its heading, a relative markdown link opens its document through the index, and an external https link calls openExternal.
3. cargo test in apps/desktop/src-tauri asserts open_external refuses every scheme outside http, https and mailto.
4. pnpm gate:golden regenerated (ids only) and gate:no-network green.
5. CHANGELOG.md has an Unreleased line for this key.

## Do not
- Show a visible permalink glyph.
- Open a relative link outside the indexed root.
- Edit `app.ts`.
- Touch `packages/*/src/contracts/**`.
