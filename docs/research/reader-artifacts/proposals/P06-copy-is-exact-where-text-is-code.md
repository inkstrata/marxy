# Draft P06. Copy is exact where the text is code

**Status:** draft proposal, not an ADR and not accepted. It edits nothing. **Blocked by:** operations-contract, scope. **Evidence:** [Trust and safety](../07-trust-safety.md), [Diffs and provenance](../05-diffs-provenance.md), [Reading tasks](../01-reading-tasks.md).

## Context

A drag selection copies the smartened DOM text (design 03 says so on purpose). That is right for prose and wrong for a command: `--frozen-lockfile` pastes with an en dash, `<kbd>` content is smartened, and `copy-code-clean` appends a newline that makes a one-line command execute on paste. Chapters 1, 5 and 7 disagreed about the remedy.

## Proposed decision

(1) Smart typography never runs inside `code`, `kbd`, `samp` or a fence, including those opened by raw HTML. (2) A block copy ends with one newline only if the source did; `copy-command` adds none. (3) A drag inside one text node resolves to a byte span when the rendered and source text are identical, and snaps to the enclosing block otherwise (amends design 03). (4) A drag selection in prose still copies rendered text.

## Consequences

A bare flag in prose that is not in backticks remains a residual trap; the named `copy-source` operation is the mitigation.

## What would falsify it

A measurement that pasted en dashes are a rare failure, or a reader preference for source copy everywhere.
