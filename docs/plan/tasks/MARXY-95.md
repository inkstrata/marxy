---
key: MARXY-95
design: [10-gates-and-testing, 09-app-shell]
depends: [MARXY-61, MARXY-94]
verify: [pnpm precheck, pnpm done MARXY-95]
---
# MARXY-95 — Split startup into startApp(shell) and drive it in a browser with a memory shell

**Design:** [10-gates-and-testing](../../design/10-gates-and-testing.md) §The app harness entry, [09-app-shell](../../design/09-app-shell.md) §DOM skeleton · **Depends on:** MARXY-61 (main.ts on the core renderer), MARXY-94.

**Outcome.** Every behaviour story from MARXY-87 on can be tested in Playwright through the real app code with no Tauri: `window.marxyApp.start(files, argv)` boots the app against an in-memory shell that records what it was asked to do. A reader sees nothing different.

## Files and signatures
- `apps/desktop/src/app.ts` — `startApp(shell: Shell, opts?): Promise<AppHandle>`: everything `main.ts` does after acquiring a shell (read argv, read file, parse, render, marks, smoke evidence). `AppHandle = { state, dispatch, commands, shell, ready }` — `state`/`dispatch`/`commands` may be minimal stubs today (§09 fills them); `ready` resolves after `first_text`.
- `apps/desktop/src/main.ts` — reduced to importing `tauri.ts` and calling `startApp`. Keep the frame counter and paint evidence behaviour exactly (the CLI smoke check depends on it); move code, do not rewrite it.
- `apps/desktop/src/shell/memory.ts` — `createMemoryShell(files: Record<string, Uint8Array>): Shell & { calls: Call[]; emit(events: WatchEvent[]): void; queueSaveDialog(path: string | null): void }`, per §10.
- `apps/desktop/src/harness/app-harness.ts` + `apps/desktop/app.html` — `window.marxyApp.start`.
- `apps/desktop/vite.config.ts` — the `app` entry; the production build excludes it (`memory.ts` must not be in `dist/assets/index-*.js`).
- `apps/desktop/test/app-harness.test.mjs` (Playwright WebKit).
- `apps/desktop/test/shell-boundary.test.mjs` — extend: `app.ts` never imports `shell/tauri.ts`; `memory.ts` never imported from `main.ts`.

## Do this, in order
1. Move code from `main.ts` into `app.ts` behind `startApp(shell)`. Run the existing smoke/startup checks; they must be unchanged.
2. `memory.ts` with the recorder. Paths are POSIX absolute; `readFile` of a missing path rejects `{ code: 'not-found' }`.
3. Harness entry + Vite entry. `pnpm build` produces `dist/app.html`.
4. Playwright: start with `{ '/docs/README.md': <02-readme-real-world.md bytes> }` and argv `['/docs/README.md']`; await `ready`; assert the article's first heading text and that `calls` holds exactly one `readFile`.
5. Bundle gate: add an assertion that the production JS does not contain the string `createMemoryShell`.

## Tests → expected
| Check | Expect |
| --- | --- |
| `pnpm gate:perf` / startup smoke | unchanged numbers within noise; `first_text` still two frames after the mutation |
| `app-harness.test.mjs` | heading present; one `readFile` recorded |
| neutralise `startApp`'s render call | the Playwright test fails |
| `pnpm gate:bundle` | green; fails if `memory.ts` is imported from `main.ts` |

## Acceptance → check
1. `main.ts` ≤ 30 lines and only calls `startApp` → review + line count in the PR.
2. Harness boots the real app with a memory shell → `app-harness.test.mjs`.
3. Memory shell absent from the shipped bundle → bundle gate assertion.

## Do not
Change what the app does. Add features to `AppHandle` beyond what is needed to observe startup. Use Chromium.
