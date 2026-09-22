# ADR-0004 — Editing is transformation over byte ranges; no plugin or scripting API

**Status:** accepted

## Decision
An edit in Rendered mode is: a selection (span, block, section or document) resolves through
the source map to a byte range; a pure `string → string` operation runs on that range; the
buffer is spliced; the view re-renders. Operations are built in and curated. There is no
operations plugin API and no shell-pipe or scripting surface, now or in v1.1.

## Why
Every example the user gave — quick format buttons, minification, pretty-printing, moving
snippets — transforms text that already exists. Pure functions are testable without UI, undo
is a splice, and an operation physically cannot touch bytes outside its range. A scripting
surface would break the no-execution security posture (ADR-0009). A theme cannot corrupt a
document; an operation can — that is the line between first-class theming and no operations API.

## Consequences
- Operation signature is frozen in `packages/core/src/contracts/operation.ts`.
- Every operation ships with table-driven tests and a byte-fidelity property test asserting
  nothing outside the target range changed.
- The catalogue is bounded per release (ADR-0019); each new operation is a feature request.
