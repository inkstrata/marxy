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
- `apps/desktop/src-tauri/src/main.rs` — register `commands::os::open_external` in the invoke handler list. One line. Do not rewrite the rest of the file.
- `apps/desktop/test/shell-boundary.test.mjs` — the handler-name scan must accept `commands::os::` as well as `commands::fs::`, so `open_external` is seen.
- `packages/core/src/render/render.test.ts` — the heading assertion gains `id="title"`.
- `packages/core/src/render/contract.test.ts` — the heading assertion gains `id="a"`.
- `packages/core/src/operations/operations.test.ts` — the copy-section html match allows `class="marxy-external"` on the anchor.
- `CHANGELOG.md` — one Unreleased line ending with this story's key.

## Do this, in order
The branch already has the link behaviour. PR #277's local result failed check-story because the five ripple files above were outside Paths. They are on the board now. Drop this branch's edit of `docs/plan/jira-issues.csv`. Do not widen Paths again in the product pull request.

1. Keep the heading ids, the click routing and `open_external`.
2. Keep the one-line ripples in the five files above. Do not edit them further.
3. Rebase onto main. `main.rs` is also on MARXY-49; keep both the `open_external` registration and the `RunEvent` import.
4. HTML goldens also conflict with MARXY-230. Keep the heading ids and keep raw `kbd`, `code`, `samp` and `pre` text unsmartered.

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
- Edit `docs/plan/jira-issues.csv` in this story's pull request.
