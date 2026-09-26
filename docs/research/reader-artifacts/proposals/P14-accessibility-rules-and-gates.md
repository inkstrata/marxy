# Draft P14. Accessibility has rules and gates

**Status:** draft proposal, not an ADR and not accepted. It edits nothing. **Blocked by:** other. **Evidence:** [Colour and access](../09-colour-access.md).

## Context

No stylesheet or app file contains `forced-colors`, `prefers-contrast` or `prefers-reduced-motion`, the contrast check samples one element per class, and the width matrix has no 320 px pass.

## Proposed decision

Add the three media-query rules, a contrast check over every text-bearing style and every text-on-tint pair, a 320 px and 400 % zoom pass, and a rule that a token joins the contract only with a reader and a check.

## Consequences

Every unit in this handbook depends on it.

## What would falsify it

None.
