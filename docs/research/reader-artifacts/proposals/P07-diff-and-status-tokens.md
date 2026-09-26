# Draft P07. Diff and status colours are theme tokens

**Status:** draft proposal, not an ADR and not accepted. It edits nothing. **Blocked by:** theme-contract, registry. **Evidence:** [Colour and access](../09-colour-access.md), [Diffs and provenance](../05-diffs-provenance.md), [Structured output](../03-structured-output.md).

## Context

The token set has no colour for an added or deleted line, and `markup.inserted`/`markup.deleted` map to no class, so diffs render monochrome. Chapter 9 measured all ten published palettes and found each fails a token on word highlights; it designed four tints for Marxy.

## Proposed decision

Add four tokens (`--marxy-color-diff-add`, `-diff-del`, `-diff-add-word`, `-diff-del-word`) with the dark and light defaults in the spec, line classes (`marxy-diff-add`, `marxy-diff-del`) and a line-prefix pass on `.marxy-line`, all registered first. Add one weight class for log levels. The `+`/`-` marker stays text in the code colour.

## Consequences

A theme that omits them renders the defaults (ADR-0031). The aesthetics gate must read every new token (P15).

## What would falsify it

A reader study in which tints lower comprehension, or a theme that cannot meet 4.5:1 on the tints.
