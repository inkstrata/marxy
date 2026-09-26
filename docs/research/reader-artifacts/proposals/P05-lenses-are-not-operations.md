# Draft P05. View lenses are outside the operations contract, and the operation catalogue grows by registration

**Status:** draft proposal, not an ADR and not accepted. It edits nothing. **Blocked by:** operations-contract, scope. **Evidence:** [Structured output](../03-structured-output.md), [Trust and safety](../07-trust-safety.md), [Diffs and provenance](../05-diffs-provenance.md).

## Context

Several proposals change what is shown, not what is copied or spliced: reveal hidden content, fold a data fence to a depth, mark what changed since last read, compare two snapshots, jump to source. An `Operation` returns a splice or a clipboard, so none fits, and ADR-0004 says nothing about how the catalogue grows.

## Proposed decision

State that a lens is a palette-invoked view command, is pure over its inputs, feeds no splice and no clipboard, and is outside `contracts/operation.ts`. State that a new pure `string → string` or `string → clipboard` operation is an additive registration listed in `docs/operations.md`, not a contract change.

## Consequences

Two ideas the plan already carries (palette commands, operations) get a boundary. `changedRanges(before, after)` lives in core as a pure function.

## What would falsify it

A lens that needs to write, which would make it an operation.
