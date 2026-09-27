---
key: MARXY-238
design: [13-trust, 09-app-shell]
depends: [MARXY-233, MARXY-239, MARXY-44, MARXY-97]
verify: [pnpm precheck, pnpm done MARXY-238]
---
# MARXY-238 — Tell the reader what the renderer removed or blocked, and jump to it in Source

**Design:** [13-trust](../../design/13-trust.md) · [09-app-shell](../../design/09-app-shell.md) · **Research:** [Reader Artifacts Handbook](../../research/reader-artifacts/10-spec.md) (ADR-0035) · **ADR:** [ADR-0036](../../adr/0036-artifact-units.md) · **Delta:** [2026-09-26-reader-artifacts](../deltas/2026-09-26-reader-artifacts.md) · **Depends on:** MARXY-233, MARXY-239, MARXY-44, MARXY-97.
**Handbook units closed by this story** (`docs/research/reader-artifacts/coverage.json`): `vanish.removals`, `vanish.instruction-class`, `trust.blocked-image-details`, `rule.5-never-silent`, `verify.taste`, `proposal.P01`, `taste.marker-quietness`, `hs.removal-notice`.

**Outcome.** When Marxy hides something from an instruction file, the reader is told what and how much, and can see it in one step. When it blocks images, the reader sees which hosts and what the URLs would send.

## What is wrong today
`app.ts` logs removals with `console.info`. Handbook [07](../../research/reader-artifacts/07-trust-safety.md) "Two tiers".

## Files and signatures
- `apps/desktop/src/notices/` — the removal notice using the records from `MARXY-233`; dismissible; grants nothing.
- `apps/desktop/src/trust/` — per-host blocked-image details (MARXY-44's module).
- `packages/theme/src/base.css` — notice list on the grid.
- `CHANGELOG.md` — one Unreleased line ending with this story's key.

## Do this, in order
1. Notice at rest for instruction-class and hidden-character files.
2. Summoned list and jump.
3. Blocked-image details.
4. Queue row.

## Tests → expected
| Check | Expect |
| --- | --- |
| AGENTS.md with 2 comments, 1 tag | one notice: `2 comments, 1 unknown tag` |
| README.md, same content | no notice at rest |

## Acceptance → check
1. apps/desktop/test/removal-notice.test.mjs asserts fixtures/corpus/24-instruction-file.md opened as AGENTS.md shows one notice at rest naming each removed kind with its count, and the same content in README.md shows none at rest.
2. A file containing any tag character or bidi override shows the notice at rest whatever its name, asserted in removal-notice.test.mjs.
3. The notice's summoned list jumps to each removed range in Source through the jump-to-source command, asserted in removal-notice.test.mjs.
4. apps/desktop/test/trust.test.mjs asserts the blocked-image notice lists each host with its count, punycode and Unicode forms, and query-string count and length, with a checkbox per host.
5. gate:no-network unchanged and green; pnpm check:registry green.
6. CHANGELOG.md has an Unreleased line for this key.

## Taste
**Taste, without a stop.** Ship the handbook's default exactly as written above; do not ask the reviewer to choose between options, and do not pause for a look mid-story. Add **one** row to `docs/taste-review/queue.md` with the before/after artifact below and a confirm-or-tune question. The value is already decided by the research; the row lets the author tune it at the end-of-phase review (AGENTS.md "Verification").

- Artifact: Notice on AGENTS.md at rest and expanded; blocked-image details on `02-readme-real-world.md`.
- Question: Confirm or tune: informative, not nagging. (Default: one line in the existing notices region, same pattern as the blocked-image notice.)

## Do not
- Build a reveal lens that shows content in place (v1.1, ADR-0036 clause 8).
- Grant anything from this notice.
- Touch `packages/*/src/contracts/**`.
