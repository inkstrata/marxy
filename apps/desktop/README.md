# @marxy/desktop

The app: a TypeScript front end built by Vite (`src/`) and its Rust shell under Tauri 2 (`src-tauri/`).
How it fits together is in [docs/architecture.md](../../docs/architecture.md) and
[docs/desktop-shell.md](../../docs/desktop-shell.md); running and building it are in
[docs/development.md](../../docs/development.md).

| Path | What it is |
| --- | --- |
| `src/` | the app: boot, the window and its panes, panels, the rendered page, Source, commands and keys, viewers, the Studio |
| `src/shell/` | the only code that talks to Tauri (`src/shell/tauri.ts`), and the in-memory shell the browser build and the tests use (`src/shell/memory.ts`) |
| `src/harness/` | the browser build's boot over the demo files |
| `src-tauri/` | the Rust shell: commands, file access, watching, archives and decoders; `src-tauri/capabilities/`, `src-tauri/tauri.conf.json` |
| `test/` | browser and integration tests, one concern per file; helpers in `test/support/` |
| `scripts/` | this package's tools, below |
| `index.html`, `app.html`, `gate.html` | the shipped entry, the harness entry the tests boot, and the aesthetics gate's page |

## Commands

Run with `pnpm --filter @marxy/desktop <script>` from anywhere in the repository.

| Script | Does |
| --- | --- |
| `dev` | the desktop app over a Vite dev server on port 1420 |
| `exec vite --port 1420 --strictPort` | the app in a browser over the demo files |
| `build` | the front end, the release binary, then the smoke check |
| `bundle` | the front end, the release binary and the installer |
| `build:demo`, `preview:demo`, `tour:demo` | the demo build, a server for it, and a drive through it |
| `check:tauri` | drives the built window on Windows |
| `shots <scenario.mjs>` | pictures of the app from source, or of the built window with `--exe` |
| `test` | every test of the package, one file at a time (over an hour; day to day, run the files that cover the change) |
| `test:mutations` | proves named tests fail when one change is patched in |
| `sign:self-cert` | makes or reuses the self-signed code-signing certificate |
| `verify:cli` | the smoke check with skips counted as failures |

## Tools in `scripts/`

| Script | Is |
| --- | --- |
| `tauri-check.mjs` | `check:tauri`: launches the release binary with WebView2's debugging port open and checks the real window ([docs/testing.md](../../docs/testing.md#the-real-window)) |
| `real-window-fixtures.mjs` | the samples `tauri-check.mjs` builds for its save, encoding, Lines and program-card cases: BOM encoders, a minimal PE, a 20 MB log, the process tree's memory |
| `smoke-cli-open.mjs`, `smoke-verdict.mjs` | the smoke check at the end of `build`, and its pass, skip or fail ruling |
| `shots.mjs`, `shots/window.mjs` | the picture tool and a scenario to copy ([docs/working.md](../../docs/working.md#verify-and-look)) |
| `demo-tour.mjs` | `tour:demo`: drives the demo build in Chromium, one PASS or FAIL per step |
| `sign-windows.mjs` | Tauri's sign command; `MARXY_SIGN` picks unsigned, self-signed or Azure ([docs/development.md](../../docs/development.md#signing-windows)) |
| `self-signed-cert.mjs` | `sign:self-cert` |
| `mutations.mjs`, `mutation-hooks.mjs`, `mutation-register.mjs` | `test:mutations` and the loader hooks that patch one module as it loads |
| `data-folder.mjs` | a data folder of its own for a launch of the built app, and its removal once WebView2 lets go |
| `pdf-fixture.mjs` | writes the demo's PDF, and builds long ones for the checks |
| `large-video.mjs` | a sparse MP4 past 2 GB for `check:tauri`'s seek |

Checks, gates and measurements that take the corpus or the whole repository are in
[scripts/](../../scripts/README.md).
