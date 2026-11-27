# Round 10 builder rules

Read this before you start. It applies to every round 10 branch.

## Where you work
- Your worktree: `C:\Dev\reader\worktrees\<name>`, on branch `agent/<name>`, cut from master `ee56607d` (rounds 1 to 9 merged), unless your brief names another base.
- Read `AGENTS.md` and `docs/` in the worktree first. Its rules are enforced by `pnpm check`:
  - Bytes are the document. Every change is a splice over a byte range, every rendered element carries `data-marxy-s` and `data-marxy-e`, and nothing normalises line endings, BOMs or encodings.
  - Boundaries: core has no DOM and no Node built-ins, and `invoke(` appears only under `shell/`.
  - A shell call goes in both `shell/tauri.ts` and `shell/memory.ts`. A Tauri command also goes in `build.rs`, `generate_handler!` and `capabilities/main.json`, and in `settings/privacy.ts` (`LOCAL_ONLY_CALLS` or `LEAVES_THIS_MAC`).
  - New names go in `scripts/registry.json`. A new browser test file goes in `scripts/verify-map.json`.
  - One scrollbar: no `scrollbar-color`, and no `scrollbar-width` other than none. Theme sheets are generated. Dependencies are allow-listed. No network.
- Marxy's fences: nothing records what was read or reports what changed; no network, updater or crash report; nothing a file holds is run; no grid of tiles; no stacked chrome, tinted tags or pill rows.

## Commands
- Run pnpm from inside the worktree, with `Push-Location <worktree>; ...; Pop-Location` in one PowerShell call. `pnpm -C` from another folder fails with ERR_PNPM_BAD_PM_VERSION. Never `cd` stickily.
- Checks: `pnpm typecheck`, `pnpm lint`, `pnpm check` (9 checks), `pnpm verify --tier changed`.
- One unit test file: `node --test --experimental-strip-types <file>`. Desktop files run from `apps/desktop` with `--test-concurrency=1`.
- Browser tests: `node scripts/browser-tests.mjs --jobs 1 test/<file>` (paths relative to `apps/desktop`). Run at most 2 browser test files at a time and never the whole suite. The runner finds its own server; a dev server you start by hand to look at the page uses the port in your brief (`pnpm --filter @marxy/desktop exec vite --port <port> --strictPort`), and you stop it when done.
- Rust: `cargo test` in `apps/desktop/src-tauri`, then `pnpm lint:rust`. Never run `check:tauri` or `bundle`: the real window is the orchestrator's.
- RAM is tight on this machine (four builders at once). Close any browser or server you start.

## How to finish
- Comments say why only, never plan or ticket IDs. Keep `docs/` true for what you changed. Commit subjects are `type(scope): what`. Commit on your branch; do not merge, push or touch master.
- Prove a repair by the key or the open, not the code: a test that opens the file or presses the key and checks what the reader sees.
- Before you report: `pnpm typecheck`, `pnpm lint`, `pnpm check`, your new and touched tests, and `pnpm verify --tier changed` are green.
- Report in under 300 words: commits, what changed for the reader, tests run with counts, anything not done or not verified, and any call you made that the orchestrator should know about.
