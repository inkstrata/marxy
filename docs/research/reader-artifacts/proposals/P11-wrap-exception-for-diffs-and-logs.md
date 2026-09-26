# Draft P11. Diff, patch, log and ASCII-art fences may scroll instead of wrap

**Status:** draft proposal, not an ADR and not accepted. It edits nothing. **Blocked by:** other. **Evidence:** [Code as read](../04-code-typography.md).

## Context

ADR-0033 point 5 decided that a code block wraps and never scrolls, to keep chrome at rest zero. No study compares the two. Wrapped diffs and logs risk a continuation that reads as a new record.

## Proposed decision

Recorded as a proposal only: a no-wrap scroller for those fence classes, with a focus stop and an accessible name, and the cost stated.

## Consequences

Nothing changes unless the author accepts it. The default recommendation is to keep wrapping and mark diff continuations.

## What would falsify it

Any evidence either way.
