# Draft P10. A JSONL transcript has a derived, read-only view

**Status:** draft proposal, not an ADR and not accepted. It edits nothing. **Blocked by:** ast-contract. **Evidence:** [Agent artifacts](../02-agent-artifacts.md).

## Context

A session JSONL opens in Source. Only 503 of 941 lines in one file were conversation. The AST has no turn, role or tool node and its ranges are into a markdown buffer.

## Proposed decision

A view-only turn structure that reuses the `{file, start, end}` range type keyed to JSONL line ranges, derived on summon, never written, with the source one keypress away.

## Consequences

The most invasive proposal; it should follow the cheaper ones and a taste review.

## What would falsify it

A finding that readers prefer Source for transcripts.
