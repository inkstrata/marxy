# @marxy/core

Everything Marxy knows about a file that needs no window: parsing with byte provenance, the file-type
registry and detection, readings, operations and transforms, the sanitiser, highlighting and search.
It imports no DOM globals, no Node built-ins and no Tauri (`check-boundaries`), so the same code runs
in the app, in a worker and under Node's test runner. The path from bytes to page is in
[docs/architecture.md](../../docs/architecture.md#from-bytes-to-page); kinds and readings are in
[docs/file-kinds.md](../../docs/file-kinds.md).

| Path | What it is |
| --- | --- |
| `src/index.ts` | the package's whole surface |
| `src/buffer/`, `src/encoding/`, `src/position/`, `src/sourcemap/` | the document as bytes: splices, encodings, places and their mapping |
| `src/parse/`, `src/render/`, `src/sanitize/` | Markdown to a tree with byte ranges, the tree to HTML, and the one sanitiser |
| `src/kind/`, `src/reading/`, `src/viewer/` | recognising a file, the ways it can be read, and readers for archives, pictures and other non-text files |
| `src/data/`, `src/log/`, `src/diff/`, `src/mail/`, `src/office/`, `src/book/`, `src/page/` | the readings of each family of file |
| `src/operations/`, `src/transforms/`, `src/source-edit/`, `src/paste/` | changes to a document, each a splice over a byte range |
| `src/highlight/`, `src/index-model/`, `src/outline/`, `src/derive/`, `src/notes/` | colouring, search, and what is derived from a document |
| `src/testing/` | helpers for tests (the CPU clock for time budgets) |
| `goldens/` | the parse tree and rendered HTML of every corpus file, as committed |

## Commands

| Command | Does |
| --- | --- |
| `pnpm --filter @marxy/core test` | the unit tests (`src/**/*.test.ts`) |
| `pnpm gate:golden` | the corpus against `goldens/`; `pnpm --filter @marxy/core test:golden -- --update` rewrites them |
| `pnpm gate:fidelity` | byte-exact saves (the gate is `scripts/gate-fidelity.mjs`, since it compiles part of the shell) |
| `pnpm --filter @marxy/core test:spec` | every CommonMark example; the spec file is downloaded by hand to the path `--print-dest` prints |
| `test:reparse-stress`, `test:invariant-stress` | the reparse and provenance tests over many more seeds |

## Tools in `scripts/`

| Script | Is |
| --- | --- |
| `golden.ts` | the golden gate |
| `commonmark-spec.ts` | the CommonMark check; holds the spec's version, address and digest |
| `gate-assertions.ts` | the list of things `scripts/gate-no-network.mjs` must assert before it may pass |
| `gate-checks.ts` | that gate's rulings on what a page did, apart from the browser so they can be unit-tested |
| `gate-observability.ts` | what that gate can and cannot see a document attempt |
| `gate-tree-depth.mjs`, `gate-tree-depth.ts`, `tree-depth-cases.ts` | compares the sanitiser's written tree with the browser's live one over a fixed set of shapes |
