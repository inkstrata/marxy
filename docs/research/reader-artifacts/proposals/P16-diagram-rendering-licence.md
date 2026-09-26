# Draft P16. Rendered diagrams wait on a licence decision

**Status:** draft proposal, not an ADR and not accepted. It edits nothing. **Blocked by:** scope. **Evidence:** [READMEs](../06-readmes.md).

## Context

Mermaid 12.0.0 declares `elkjs ^0.9.3` as a hard dependency, every elkjs 0.9.x is EPL-2.0, and `scripts/gate-licences.mjs` classes EPL-2.0 as unknown, which fails the gate.

## Proposed decision

Ship a muted caption on diagram fences in v1 and decide, before any rendering work, whether elkjs can be excluded from a bundle or the gate should admit EPL.

## Consequences

Keeps ADR-0006 intact.

## What would falsify it

A licence-clean renderer.
