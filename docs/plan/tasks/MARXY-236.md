---
key: MARXY-236
design: [13-trust, 02-render]
depends: [MARXY-229]
verify: [pnpm precheck, pnpm done MARXY-236]
---
# MARXY-236 — Mark invisible and bidirectional characters, and show where a link that names another host really goes

**Design:** [13-trust](../../design/13-trust.md) · [02-render](../../design/02-render.md) · **Research:** [Reader Artifacts Handbook](../../research/reader-artifacts/10-spec.md) (ADR-0035) · **ADR:** [ADR-0036](../../adr/0036-artifact-units.md) · **Delta:** [2026-09-26-reader-artifacts](../deltas/2026-09-26-reader-artifacts.md) · **Depends on:** MARXY-229.
**Handbook units closed by this story** (`docs/research/reader-artifacts/coverage.json`): `trust.invisibles`, `trust.link-mismatch`, `rule.4-marker-display-only`, `verify.taste`, `taste.marker-quietness`, `hs.invisible-char-marker`, `hs.link-mismatch-label`.

**Outcome.** Characters a reader cannot see but an agent or compiler obeys are marked where they sit; a link that says one site and goes to another says so.

## What is wrong today
Probe case `bidi-and-tags` (handbook [07](../../research/reader-artifacts/07-trust-safety.md)).

## Files and signatures
- `packages/core/src/render/invisibles.ts` — new: the rule table as data; marker spans with `unicode-bidi: isolate` per bidi control.
- `packages/core/src/render/link-host.ts` — new: host comparison with IDNA both ways.
- `apps/desktop/src/selection/` — copy ignores markers.
- `packages/theme/src/base.css` — 1ch hairline box in the code face, hex code point, ≥ 4.5:1.
- `fixtures/corpus/29-hidden-characters.md` — new: a Trojan Source snippet, a tag-smuggled instruction, the five never-flagged cases, a mismatched link and a homograph link.
- `CHANGELOG.md` — one Unreleased line ending with this story's key.

## Do this, in order
1. Rule table test.
2. Markers and copy.
3. WebKit isolate probe.
4. Link host label.
5. Goldens, queue row.

## Tests → expected
| Check | Expect |
| --- | --- |
| U+202E in a code span | marked `202E`, isolated |
| 👩‍💻 | unmarked |
| `[https://a.com](https://b.com)` | label `b.com` |

## Acceptance → check
1. A new packages/core/src/render/invisibles.test.ts asserts the rule table: tag runs (one `tag ×N` mark), bidi controls, ZWSP, ZWJ outside an emoji sequence and BOM are marked; emoji ZWJ, Persian ZWNJ, LRM, RLM and NBSP are not.
2. operations tests assert copying a marked selection yields the exact bytes, markers included in nothing.
3. apps/desktop/test/invisibles.test.mjs asserts a bidi override inside a highlighted span is isolated in WebKit, and gate:aesthetics contrast is at least 4.5:1 for the marker on every ground.
4. A render test asserts the host label appears only when link text looks like a URL or host whose host differs from the destination, and shows punycode and Unicode forms; apps/desktop/test/link-host.test.mjs asserts the destination shows on focus only and gate:aesthetics chrome-at-rest stays green.
5. pnpm gate:golden regenerated with fixtures/corpus/29-hidden-characters.md; pnpm check:registry green.
6. CHANGELOG.md has an Unreleased line for this key.

## Taste
**Taste, without a stop.** Ship the handbook's default exactly as written above; do not ask the reviewer to choose between options, and do not pause for a look mid-story. Add **one** row to `docs/taste-review/queue.md` with the before/after artifact below and a confirm-or-tune question. The value is already decided by the research; the row lets the author tune it at the end-of-phase review (AGENTS.md "Verification").

- Artifact: `29-hidden-characters.md`, dark and light, before/after.
- Question: Confirm or tune: visible without shouting. (Default: 1ch hairline box, hex, marker colour at 4.5:1.)

## Do not
- Change a byte of the buffer.
- Flag prose that looks like an injection.
- Build strip/escape operations (v1.1).
- Touch `packages/*/src/contracts/**`.
