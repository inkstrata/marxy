# Draft P09. A reading position may carry an anchor

**Status:** draft proposal, not an ADR and not accepted. It edits nothing. **Blocked by:** other. **Evidence:** [Diffs and provenance](../05-diffs-provenance.md).

## Context

ADR-0018 defines a position as `{path, byteOffset, fraction}`. `offsetThroughEdit` carries it through one edit site and drops it to the first differing byte when edits fall both above and below, which is what a regenerated plan does.

## Proposed decision

Amend ADR-0018 with an optional `anchor {exact, prefix, suffix}` (32-character context) resolved by offsets, then unique context, then unique quote, and failing visibly. Fuzzy matching stays off.

## Consequences

A field on a frozen record. Changed-since-last-read marks (a lens, P05) need a shell-held last-seen snapshot.

## What would falsify it

A measurement that offsets survive real regeneration.
