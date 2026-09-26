# Draft P12. Names for artifact units are registered together

**Status:** draft proposal, not an ADR and not accepted. It edits nothing. **Blocked by:** registry. **Evidence:** [Trust and safety](../07-trust-safety.md), [READMEs](../06-readmes.md), [Structured output](../03-structured-output.md).

## Context

New marks, data attributes and classes must enter `scripts/registry.json` first (AGENTS.md). Artifact units need: an invisible-character marker and its data attributes, the reveal lens, a removal notice, a control-character glyph and an elision marker, an alert label, a badge line, a front matter head, and the diff classes.

## Proposed decision

One registry PR listing them, and a fix to the registry gate so `data-marxy-${'remote'}` (which evades it today) and other concatenations are caught.

## Consequences

Removes a class of drift. It is a hygiene prerequisite for every rendering story.

## What would falsify it

None.
