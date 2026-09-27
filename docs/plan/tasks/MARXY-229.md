---
key: MARXY-229
design: [13-trust, 02-render]
depends: []
verify: [pnpm precheck, pnpm done MARXY-229]
---
# MARXY-229 — Refuse reserved and clobbering ids from documents, and catch concatenated registry names

**Design:** [13-trust](../../design/13-trust.md) · [02-render](../../design/02-render.md) · **Research:** [Reader Artifacts Handbook](../../research/reader-artifacts/10-spec.md) (ADR-0035) · **ADR:** [ADR-0036](../../adr/0036-artifact-units.md) · **Delta:** [2026-09-26-reader-artifacts](../deltas/2026-09-26-reader-artifacts.md) · **Depends on:** nothing.
**Handbook units closed by this story** (`docs/research/reader-artifacts/coverage.json`): `trust.reserved-ids`, `verify.trust-vectors`, `proposal.P02`, `proposal.P12`, `hs.reserved-id-bypass`, `hs.registry-hygiene`.

**Outcome.** A document can no longer take an id, name or class Marxy reserves, or shadow a global such as `document.cookie`, whatever attributes it adds. The registry gate can no longer be dodged by building a name from pieces.

## What is wrong today
Measured on `d373abc` (handbook [07 · Trust and safety](../../research/reader-artifacts/07-trust-safety.md)): the island pass skips the reserved-prefix rule for any tag that carries the public provenance attribute, so `<h2 id="marxy-fn-1" data-marxy-s="0">` keeps its id. `id="cookie"` and `class="marxy-katex"` also survive. In `policy.ts` the remote-image attribute is spelled `data-marxy-${'remote'}`, which `check-registry.mjs` does not see.

## Files and signatures
- `packages/core/src/sanitize/policy.ts` — the reserved-name rule applied to `id`, `name` and `class` on every element, before and independent of the provenance attribute; a frozen set of `window`/`document` property names (build it from a literal list in the file, not at runtime); spell `data-marxy-remote` literally.
- `packages/core/src/sanitize/vectors.test.ts` — the vectors in acceptance 1.
- `packages/core/src/render/pipeline.ts` — only if the island pass lives here: remove the provenance-attribute exemption.
- `scripts/check-registry.mjs` — flag `data-marxy-` and `marxy-` names assembled with `+`, `concat` or `${}`.
- `scripts/check-registry.test.mjs` — one failing and one passing case for the concatenation rule.
- `scripts/registry.json` — register `data-marxy-remote` if it is not already.
- `CHANGELOG.md` — one Unreleased line ending with this story's key.

## Do this, in order
1. Write the four vectors and watch them fail.
2. Fix the policy; the vectors pass; regenerate goldens.
3. Registry gate rule and its test; register `data-marxy-remote`.
4. CHANGELOG line.

## Tests → expected
| Check | Expect |
| --- | --- |
| `id="marxy-fn-1" data-marxy-s="0"` | id removed, element kept |
| `class="marxy-katex other"` | `class="other"` |
| `id="cookie"`, `name="forms"` | attribute removed |
| `id="install"` | kept (ordinary ids still work; heading anchors depend on it) |
| `pnpm check:registry` with a template-literal name in a test fixture string | fails |

## Acceptance → check
1. packages/core/src/sanitize/vectors.test.ts has one vector each for a marxy- id, a marxy- name, a marxy- class and an id equal to a window or document property (cookie, location, forms), each with and without data-marxy-s, and each fails on origin/main before the fix (the PR body names the failing run).
2. pnpm gate:golden regenerated; the diff is limited to the hostile fixture's golden or is empty, and pnpm gate:no-network is green.
3. scripts/check-registry.mjs fails on a data-marxy- or marxy- name built by concatenation or a template literal, shown by a case in scripts/check-registry.test.mjs, and data-marxy-remote is registered in scripts/registry.json so pnpm check:registry is green on main.
4. CHANGELOG.md has an Unreleased line for this key.

## Do not
- Prefix every document id instead of refusing the reserved ones: heading anchors (MARXY-240) need authored ids to survive unchanged.
- Touch the per-document grant or the notices (MARXY-44 owns them).
- Touch `packages/*/src/contracts/**`.
- Touch `packages/*/src/contracts/**`.
