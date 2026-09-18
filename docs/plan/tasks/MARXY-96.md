---
key: MARXY-96
design: [12-trust, 02-render]
depends: [MARXY-75]
verify: [pnpm precheck, pnpm done MARXY-96]
---
# MARXY-96 — The wide allow-list, reserved ids, deferred remote images and located removals (core only)

**Design:** [12-trust](../../design/12-trust.md) §The wide policy, §Rules every policy now carries · [02-render](../../design/02-render.md) §Two-pass sanitise · **Depends on:** MARXY-75 (two-pass pipeline, `withProvenance`) · **ADRs:** ADR-0009, ADR-0023, ADR-0027.

**Outcome.** `packages/core` can render a document under a wider but still sanitised allow-list, never lets an island claim a `marxy-` id, turns every remote `https:` image into an inert `data-marxy-remote` attribute, and says where in the file each island removal came from. Split out of MARXY-44 so the security-bearing half is reviewed on its own; no reader-visible change until MARXY-44 uses it.

## Files and signatures
- `packages/core/src/sanitize/policy.ts` — `WIDE_POLICY`, `policyFor({ html })`, `Policy.reservedIdPrefix?`, set to `'marxy-'` on both named policies; `withProvenance` clears it and adds `data-marxy-remote` on `img` (pattern in §12).
- `packages/core/src/sanitize/sanitize-html.ts` — the reserved-prefix check on `id`/`name`; the https-image deferral; `Removal.url?` (full parsed URL on every refused URL).
- `packages/core/src/sanitize/urls.ts` — `UrlDecision` gains `scheme?: string` so the caller can tell "refused because https in a subresource" from every other refusal without re-parsing.
- `packages/core/src/render/pipeline.ts` — `RenderRemoval`, island removals tagged with the island's `src`; `renderDocumentSafeHtml(document, policy)` unchanged in shape.
- `packages/core/src/sanitize/testing/vectors.ts` — new vectors (below); the suite runs under both policies.
- Tests: `policy.test.ts` (new), `sanitize.test.ts`, `vectors.test.ts`, `render/pipeline.test.ts`.

## Do this, in order
1. `WIDE_POLICY` as the §12 table, built from `DEFAULT_POLICY` by spreading, so a later change to the default flows into the wide one. `urlSchemes` must be the same object.
2. Reserved prefix: after an `id`/`name` passes its pattern, refuse it if it starts with `reservedIdPrefix` case-insensitively.
3. Deferral: in `attributeValue`, for element `img` and attribute `src`, when the decision is a refusal with `absolute && scheme === 'https'`, emit ` data-marxy-remote="<escaped parsed href>"` and push the §12 removal. `http` → plain refusal with `url` and the §12 reason.
4. `url` on every URL refusal: the parsed `href` when parsing succeeded, else the cleaned raw value.
5. Pipeline: tag island removals with `src`.
6. Vectors: `wide-still-no-script` (every existing vector under `WIDE_POLICY`), `wide-javascript-link` (`<details><a href="javascript:alert(1)">x</a></details>`), `reserved-id` (`<a id="marxy-fnref-1">`, `<a name="MARXY-x">`), `forged-remote` (island `<img data-marxy-remote="https://evil.example/x.png">`), `deferred-remote-inert` (no `src` attribute anywhere in the output for an https image).

## Tests → expected
| Check | Expect |
| --- | --- |
| `policy.test.ts` | every §12 table row admitted by wide, refused (or unwrapped) by default; `WIDE_POLICY.urlSchemes === DEFAULT_POLICY.urlSchemes` |
| vectors × 2 policies | all pass; each new vector shown failing once against a neutralised check (paste the run in the PR) |
| deferral | `![b](https://img.shields.io/x.svg)` and island `<img src="https://a/b.png">` both yield `data-marxy-remote`, no `src`, a removal whose `url` is the full URL |
| `pipeline.test.ts` | a removal from an island in `02-readme-real-world.md` carries that island's `src`; renderer-pass removals have none |
| `gate:no-network` | green under both policies (extend the gate to render each corpus file twice) |
| golden HTML | regenerated only where remote images now carry `data-marxy-remote`; the PR lists the changed goldens |

## Acceptance → check
1. Wide policy admits exactly the §12 table and nothing that fetches → `policy.test.ts`, gate.
2. `javascript:` stripped after opt-in → `wide-javascript-link`.
3. An island cannot take a `marxy-` id → `reserved-id` (this is the MARXY-12 leftover named in MARXY-44's CSV row).
4. Remote images are inert and reported with full URLs → deferral tests.

## Do not
Add any URL scheme to any policy. Allow `style`, `on*`, `srcset`, `<source>`. Touch `apps/`. Change the `Removal` fields that exist.
