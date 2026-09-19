---
key: MARXY-95
design: [10-gates-and-testing, 09-app-shell]
depends: [MARXY-61]
verify: [pnpm precheck, pnpm done MARXY-95]
---
# MARXY-95 — Split startup into startApp(shell) and drive it in a browser with a memory shell

**Design:** [10-gates-and-testing](../../design/10-gates-and-testing.md) §The app harness entry, [09-app-shell](../../design/09-app-shell.md) §DOM skeleton · **Depends on:** MARXY-61 (main.ts on the core renderer).

**Widened 2026-09-19 (escalation-95 delta), attempt 2.** The reviewer escalated PR #82 rather than
returning it: the split is good work, but two existing checks are pinned to the *path*
`apps/desktop/src/main.ts` and this story moves the code they check into `app.ts`, so attempt 1 kept
both green without moving them — a comment block in `main.ts` that repeats the strings
`paint-signal.test.mjs` greps for, and `Reflect.set(el, 'innerHTML', html)` in `app.ts` so
`check-registry.mjs`'s `/\.innerHTML\s*=/` never matches. Both are now inside the boundary:
`apps/desktop/test/paint-signal.test.mjs` and `scripts/registry.json` are in `Paths`, and criteria 8
and 9 say what to do with them. Read `orchestration/results/MARXY-95.notes.md` in full before starting;
notes 3 and 4 are non-blocking and note 3 (return the handle before awaiting `boot()`) is worth taking.
PR #82 is CONFLICTING: rebase the branch on `main` in this attempt. Everything already merged in the
branch stands — do not redo the split.

**Re-sequenced 2026-09-19 (after-65 delta):** the dependency on MARXY-94 is dropped. `createMemoryShell`
implements `Shell` as frozen today — the same `Pick<Shell, …> & extras` shape `tauri.ts` already uses — and
MARXY-94 is a CODEOWNERS contract amendment waiting on Ian, which was holding this story and MARXY-26
behind a person for no structural reason. MARXY-97 keeps its MARXY-94 edge, because `fetchRemoteImage` is
genuinely a new member. When MARXY-94 lands, narrowing `memory.ts` to the full interface is a typecheck fix,
not a redesign.

**Outcome.** Every behaviour story from MARXY-87 on can be tested in Playwright through the real app code with no Tauri: `window.marxyApp.start(files, argv)` boots the app against an in-memory shell that records what it was asked to do. A reader sees nothing different.

## Files and signatures
- `apps/desktop/src/app.ts` — `startApp(shell: Shell, opts?): Promise<AppHandle>`: everything `main.ts` does after acquiring a shell (read argv, read file, parse, render, marks, smoke evidence). `AppHandle = { state, dispatch, commands, shell, ready }` — `state`/`dispatch`/`commands` may be minimal stubs today (§09 fills them); `ready` resolves after `first_text`.
- `apps/desktop/src/main.ts` — reduced to importing `tauri.ts` and calling `startApp`. Keep the frame counter and paint evidence behaviour exactly (the CLI smoke check depends on it); move code, do not rewrite it.
- `apps/desktop/src/shell/memory.ts` — `createMemoryShell(files: Record<string, Uint8Array>): Shell & { calls: Call[]; emit(events: WatchEvent[]): void; queueSaveDialog(path: string | null): void }`, per §10.
- `apps/desktop/src/harness/app-harness.ts` + `apps/desktop/app.html` — `window.marxyApp.start`.
- `apps/desktop/vite.config.ts` — the `app` entry; the production build excludes it (`memory.ts` must not be in `dist/assets/index-*.js`).
- `apps/desktop/test/app-harness.test.mjs` (Playwright WebKit).
- `apps/desktop/test/shell-boundary.test.mjs` — extend: `app.ts` never imports `shell/tauri.ts`; `memory.ts` never imported from `main.ts`.
- `apps/desktop/test/paint-signal.test.mjs` — criteria 4 and 5 read `apps/desktop/src/app.ts`, not `main.ts`, and read it through `stripComments` from `scripts/lib/repo.mjs` so a comment can never satisfy a pin. Change nothing else in that file: `measure-startup.mjs`, `smoke-cli-open.mjs`, `smoke-verdict.mjs` and `main.rs` assertions stay as they are.
- `scripts/registry.json` — add `apps/desktop/src/app.ts` to `innerHtmlAllowedIn`. Add nothing else: no mark, no event, no attribute.

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

## Attempt 2 — do these first, then rebase
1. Delete the comment block at the top of `main.ts` that repeats `await shell.mark('first_text', paintedAt);`, `waitForEnginePaint`, `signal=${signal}` and `frames=${frames}`. `main.ts` keeps one honest line saying startup lives in `app.ts`.
2. Re-point `paint-signal.test.mjs` criteria 4 and 5 at `app.ts`, reading through `stripComments`. Show the test red with the `first_text` mark deleted from `app.ts`, and paste command and output in the PR.
3. Replace `assignHtml` with `doc.innerHTML = html` at both call sites; delete the helper. Add `apps/desktop/src/app.ts` to `innerHtmlAllowedIn`. Show `check-registry.mjs` green, then red with that entry removed.
4. Rebase on `main` (PR #82 is CONFLICTING), re-run the gates, update the PR body: the "For the reviewer" section no longer defers these two — it reports them fixed, with the two red-then-green runs.

## Acceptance → check
1. `main.ts` ≤ 30 lines and only calls `startApp` → review + line count in the PR.
2. Harness boots the real app with a memory shell → `app-harness.test.mjs`.
3. Memory shell absent from the shipped bundle → bundle gate assertion.
8. The startup pins name the file the code lives in → `paint-signal.test.mjs` red when the mark is deleted from `app.ts`.
9. The render write is inside the allow-list → `check-registry.mjs` red when `app.ts` is removed from `innerHtmlAllowedIn`.

## Do not
Change what the app does. Add features to `AppHandle` beyond what is needed to observe startup. Use Chromium.
Keep a check green by making it match text instead of code: no comment written to satisfy a regex, no
`Reflect.set`, bracket access or `insertAdjacentHTML` to route a write around a gate. Widen
`innerHtmlAllowedIn` beyond `app.ts`, or add any other name to `scripts/registry.json`. Touch
`smoke-cli-open.mjs`, `smoke-verdict.mjs`, `measure-startup.mjs` or the Rust mark writer.
