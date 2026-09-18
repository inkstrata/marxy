# ADR-0020 — `packages/core` and `packages/typeset` never depend on the desktop shell

**Status:** accepted · **Source:** brainstorm C6 (the parked publishing ambition), docs/00 "deliberately deferred"

## Decision
Parsing, the AST and source map, sanitising, the outline, operations and the index model live
in `packages/core`, which runs unchanged in Node (tests, CI gates) and in any browser.
Typesetting lives in `packages/typeset`, which needs a DOM and nothing else. Neither imports
from `apps/desktop`, `@tauri-apps/*`, or `packages/shell-api` implementations.

## Why
The sharing, hosting and publishing ambitions are out of scope and will stay out until v1
ships; the only thing they ask for now is that the render pipeline can later run in a browser
or on a server. That costs one module boundary. It also makes the gates cheap: golden files,
byte-fidelity and no-network tests run in Node without a shell.
