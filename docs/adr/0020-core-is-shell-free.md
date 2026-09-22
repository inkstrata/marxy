# ADR-0020 — `packages/core` and `packages/typeset` never depend on the desktop shell

**Status:** accepted, amended (Amendment 1 — how a gate may test shell-owned code, 2026-09-18)

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

**Amendment 1 — how a gate may test shell-owned code (2026-09-18, MARXY-77)**

The Decision stands: `packages/core` and `packages/typeset` never import from
`apps/desktop`, `@tauri-apps/*`, or `packages/shell-api` implementations.

The Why sentence that "golden files, byte-fidelity and no-network tests run in Node without
a shell" is no longer true of fidelity. Byte-fidelity is a property of the shipped save
path, which is Rust in `apps/desktop`. The gate that proves it lives at
`scripts/gate-fidelity.mjs`, beside the other gates: it may compile and drive
`apps/desktop` source, and it must not live under `packages/core` or import the shell from
there. Golden files and the no-network sanitiser path still run in Node without a shell.
