# Draft P15. Links and heading anchors work

**Status:** draft proposal, not an ADR and not accepted. It edits nothing. **Blocked by:** shell-api. **Evidence:** [READMEs](../06-readmes.md), [Trust and safety](../07-trust-safety.md).

## Context

`openExternal` is optional and unimplemented in the real shell, so a click on any link does nothing. Headings carry no `id`, so relative and `#` links cannot resolve.

## Proposed decision

Implement heading ids by the `github-slugger` algorithm, route relative markdown links through the index (ADR-0012), and implement `openExternal` with a scheme allow-list.

## Consequences

A prerequisite for the link-mismatch label and for READMEs at all.

## What would falsify it

None.
