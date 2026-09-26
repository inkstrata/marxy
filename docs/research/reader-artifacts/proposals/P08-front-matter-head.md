# Draft P08. Front matter is a document head

**Status:** draft proposal, not an ADR and not accepted. It edits nothing. **Blocked by:** theme-contract, registry. **Evidence:** [Structured output](../03-structured-output.md), [Agent artifacts](../02-agent-artifacts.md).

## Context

`render-html.ts` returns an empty string for a `frontmatter` node with a comment saying the head is a later story. Skills, rules and plans lead with front matter, and GitHub and Obsidian both show it.

## Proposed decision

Render the node as a quiet key and value head with a registered class and three tokens (size, key column, line cap); YAML and TOML; the buffer is never touched.

## Consequences

One new unit on the grid. The outline also learns TOML titles.

## What would falsify it

Evidence that a head above the title distracts more than the information it carries.
