# Draft P01. Content the renderer removes is reported to the reader, and unknown tags in instruction files are shown

**Status:** draft proposal, not an ADR and not accepted. It edits nothing. **Blocked by:** sanitiser-policy, registry. **Evidence:** [Trust and safety](../07-trust-safety.md), [Agent artifacts](../02-agent-artifacts.md).

## Context

ADR-0009 §1 and `docs/design/13-trust.md` treat comments as "never content" and remove unknown elements with their contents. That holds for a README on a website. It does not hold for `AGENTS.md`, `CLAUDE.md`, `SKILL.md` or a prompt file, which an agent reads with the comments and the XML tags intact, so the human sees less than the agent obeys. Measured: an `<instructions>` block and an HTML comment vanish, a `[//]: # (…)` definition leaves no removal record, and every removal reaches only `console.info`.

## Proposed decision

(1) Every removal the sanitiser makes is reported through the notices region the app already has, counted by kind. (2) For instruction-class files (a fixed list of names and directories), an unknown non-void element keeps its children and shows its tag name as a small inline label, and a comment is counted in the notice with a summoned list that jumps to each range in Source. `script`, `style` and everything that fetches stay removed. (3) A link reference definition whose label is never referenced is reported as a removal.

## Consequences

The default view of a README is unchanged. A file in the instruction class renders more than before; the risk that a label reads as authored prose is handled by its muted style. The sanitiser path is CODEOWNERS-gated (ADR-0028), so the amendment needs the author.

## What would falsify it

A reader study or field report in which readers of instruction files are misled by the labels; or evidence that agents do not read comments (chapter 7 cites two models that obeyed hidden comment instructions).
