# Draft P02. A document may not claim a reserved or global-shadowing identifier

**Status:** draft proposal, not an ADR and not accepted. It edits nothing. **Blocked by:** sanitiser-policy. **Evidence:** [Trust and safety](../07-trust-safety.md).

## Context

ADR-0023 says an island cannot forge `marxy-` ids. Measured on `d373abc`: the island pass skips the reserved-prefix rule for any tag that carries the *public* provenance attribute, so `<h2 id="marxy-fn-1" data-marxy-s="0">` keeps its id through the full pipeline. `id="cookie"` and `class="marxy-katex"` also survive, which is DOM clobbering and component impersonation.

## Proposed decision

Refuse `id` and `name` beginning `marxy-` in the island pass whatever attributes the tag carries; refuse the `marxy-` class prefix from documents; refuse ids that name `window` or `document` members, or prefix every document id. Add a vector for each with and without the public provenance attribute.

## Consequences

No visible change for real documents. This is a security fix with a reproduction, so it should not wait for the rest of the handbook.

## What would falsify it

A document in the corpus that legitimately needs a `marxy-` class from raw HTML.
