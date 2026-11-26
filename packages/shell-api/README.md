# @marxy/shell-api

The `Shell` interface: every privileged operation the app may ask for (reading and writing files,
watching, dialogs, archives, decoders), as types only, in `src/index.ts`. It imports nothing.

The app has two implementations, `apps/desktop/src/shell/tauri.ts` (the Rust shell) and
`apps/desktop/src/shell/memory.ts` (in memory, for the browser build and the tests). An operation
added here is added to both; a new Tauri command also follows the steps in
[docs/development.md](../../docs/development.md#common-changes). The boundary is described in
[docs/architecture.md](../../docs/architecture.md#the-shell-boundary).

`pnpm --filter @marxy/shell-api typecheck` is its only check; it has no tests and no tools.
