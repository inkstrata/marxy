---
key: MARXY-75
design: [02-render]
depends: [MARXY-12, MARXY-61, MARXY-20, MARXY-23, MARXY-38, MARXY-41]
verify: [pnpm precheck, pnpm done MARXY-75]
---
# MARXY-75 — Carry byte provenance into the rendered DOM without letting a document spoof it

**Design:** [02-render](../../design/02-render.md) (DOM contract, two-pass sanitise), [ADR-0023](../../adr/0023-provenance-in-the-dom.md)
**Depends on:** MARXY-12, MARXY-61. **Blocks:** MARXY-20 (grid needs blocks), MARXY-23, MARXY-38, MARXY-41.

## Outcome
Every element the renderer creates for an AST node carries `data-marxy-s` and `data-marxy-e`; a raw-HTML island cannot carry them. The app builds the node map and block list.

## Do this, in order
1. `packages/core/src/sanitize/policy.ts`: export `withProvenance(policy: Policy): Policy` returning a copy whose `globalAttributes` adds `'data-marxy-s'` and `'data-marxy-e'` as `{ kind: 'pattern', pattern: /^[0-9]{1,9}$/ }`. `DEFAULT_POLICY` is unchanged.
2. `packages/core/src/render/render-html.ts`: `renderToUnsanitisedHtml(document, { island })` — a second parameter `{ island: (raw: string) => string }`; every `htmlBlock` / inline `html` value passes through `island()`. Add the provenance attributes to every element in the §02 table (helper `prov(node)` → `` ` data-marxy-s="${node.src.start}" data-marxy-e="${node.src.end}"` ``). The `document` element is not emitted by core (the app owns `<article>`).
3. `packages/core/src/render/pipeline.ts`: as in §02 — islands through `sanitizeHtml(raw, policy)`, whole output through `sanitizeHtml(html, withProvenance(policy))`; concatenate `removed`.
4. `packages/core/src/sanitize/testing/vectors.ts`: add vector `provenance-forgery` with probe `<p data-marxy-s="0" data-marxy-e="9999">x</p>` inside an island; check = no `data-marxy-*` on any element that came from an island (mark islands during the test by rendering a document whose only content is the island).
5. `packages/core/src/render/contract.test.ts`: for each corpus file, parse, render, scan the HTML for `data-marxy-s="(\d+)" data-marxy-e="(\d+)"` pairs; assert the multiset of pairs equals the multiset of `{start,end}` over the AST nodes that the §02 table says render to an element (write the list of node types once in the test).
6. `packages/core/goldens/<file>.html.txt`: generate with `scripts/golden.ts --html` (extend the script: `--html` writes/compares HTML goldens next to AST goldens); commit them; add a queue entry saying "HTML goldens created (no visible change)".
7. `apps/desktop/src/render/post.ts`: `buildNodeMap(article, ast): NodeMap` (`Map<string, Node>` keyed `"${s}-${e}"`, walking the AST once) and `buildBlocks(article): BlockList` (elements with `data-marxy-s` whose computed display is block/table/list-item, with `start`, `top`, `height`).

## Tests
| Test | Expect |
| --- | --- |
| `contract.test.ts` | pairs match for all 13 markdown corpus files |
| `vectors.test.ts` (new vector) | forged attributes absent; the probe fails against the unsanitised render |
| existing 27 vectors + sweep | pass; sweep includes the two new global attributes |
| `gate:no-network`, `gate:golden` | green; HTML goldens present |

## Do not
Put provenance on text nodes. Allow `data-*` generally. Make the renderer inspect URLs.
