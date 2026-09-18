# Design documents — the runway

These documents exist so that a fast, inexpensive model can implement a story without making a
design decision. Every choice an implementor would otherwise have to make is made here: module
boundaries, function signatures, data shapes, algorithms with their edge cases, the tests that
prove each one, and the order to build in. If a story needs a decision this set does not
contain, the story is not ready; the planner adds the decision here first.

They are written against the code as it is on `main` at the time of writing (the parser in
`packages/core/src/parse`, the renderer and sanitiser landing with MARXY-12, the shell in
`apps/desktop`). Where a document depends on something not yet merged, it says so.

| Doc | Governs | Stories |
| --- | --- | --- |
| [00-architecture](00-architecture.md) | data flow, module import rules, the startup waterfall, error policy | every story |
| [01-buffer](01-buffer.md) | the document buffer: bytes, text, splice, undo, dirty, save | MARXY-14, MARXY-41–43, MARXY-49 |
| [02-render](02-render.md) | AST → HTML → DOM, provenance attributes, the two-pass sanitise, images, code, math, smart typography | MARXY-61, MARXY-75, MARXY-26, MARXY-27, MARXY-28, MARXY-29 |
| [03-selection-and-operations](03-selection-and-operations.md) | selection model, byte-range resolution, the four operations, splice → reparse → re-render | MARXY-41, MARXY-42, MARXY-43 |
| [04-typeset](04-typeset.md) | ragged-right Knuth–Plass through justif/core, hanging punctuation, grid snapping, scheduling | MARXY-23, MARXY-24, MARXY-20 (grid half) |
| [05-theme](05-theme.md) | the base stylesheet derived from tokens, the theme loader, variants, the weight offset | MARXY-20, MARXY-21, MARXY-22, MARXY-46, MARXY-47 |
| [06-shell](06-shell.md) | every Tauri command, its Rust module, capability and error mapping; asset scoping; single instance | MARXY-14, MARXY-26, MARXY-34, MARXY-35, MARXY-45, MARXY-48 |
| [07-index-and-palette](07-index-and-palette.md) | root detection, walking, entries, persistence, fuzzy ranking, palette states, history | MARXY-35, MARXY-36 |
| [08-position-and-watching](08-position-and-watching.md) | reading position from the DOM and back, watch events, reload with position kept | MARXY-34, MARXY-38 |
| [09-app-shell](09-app-shell.md) | DOM skeleton, state machine, keyboard map, outline, find, notices, Source mode, mode switch | MARXY-37, MARXY-47, MARXY-48 |
| [10-gates-and-testing](10-gates-and-testing.md) | how to write tests per package, the headless render entry, grid and rag checks, screenshot diffs | MARXY-25, MARXY-30 |
| [11-config-and-storage](11-config-and-storage.md) | config file, app data files, versioning, corruption handling | MARXY-38, MARXY-46 |

Task cards exist for MARXY-16, 20–31, 33–39, 61, 64 and 75 (`../plan/tasks/`).

Task cards for individual stories live in `../plan/tasks/<KEY>.md` and point into these
documents by section. An implementor reads `AGENTS.md`, its task card, and the sections the
card names — nothing else is required.

## Conventions used in these documents

- **MUST / MUST NOT** are requirements a test or gate checks. **SHOULD** is a default an
  implementor may depart from only with a reason in the PR.
- Type signatures are TypeScript unless marked Rust. They are the intended public surface;
  private helpers are the implementor's.
- "Node-granular" means an operation or selection resolves to whole AST nodes, never to a
  byte range inside a text run. v1 is node-granular throughout (ADR-0004, §03).
- Byte offsets are UTF-8 byte offsets into the file, half-open `[start, end)`, as in the AST
  contract. Nothing in the app speaks in code units except at the two conversion points named
  in §01.
