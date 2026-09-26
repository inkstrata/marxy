# Draft P04. An operation receives the document's source text

**Status:** draft proposal, not an ADR and not accepted. It edits nothing. **Blocked by:** operations-contract. **Evidence:** [Diffs and provenance](../05-diffs-provenance.md), [Code as read](../04-code-typography.md).

## Context

`OperationInput` carries the AST, the node, the range and the range's text, but not the whole source. So `path:L-M` needs the line number and cannot be computed by a pure function, and anchors cannot carry context. ADR-0004 froze the contract.

## Proposed decision

Add a read-only `source: string` to `OperationInput`, in an ADR-only PR. No existing operation changes.

## Consequences

Enables `copy-with-reference` and the full anchor. Every operation still returns only a replacement and a clipboard.

## What would falsify it

A design in which line numbers are derived elsewhere without breaking purity.
