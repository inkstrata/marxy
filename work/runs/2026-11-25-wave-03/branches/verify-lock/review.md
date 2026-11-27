# verify-lock: review (Opus)

**Verdict: ready.** Tip `edf2d31d`, tree clean, no fixes committed.

## What was checked

- `takeLock`'s changed throw: same message, adds `code = 'HELD'` and `holder`. `tauri-check.mjs` prints `e.message`; `shots --exe` propagates. Neither reads the new fields: no behaviour change.
- Heavy span: heavy steps (`unit-core` to `build`) are contiguous in the catalog; `--only`/`--from` compute the span from planned steps; `--tier quick` covers the unit suites; no heavy step means no place. `--list` and `--check-map` return before the lock. The only verify a test spawns uses `--list`: no self-deadlock.
- Steal risk: the slot stores the verify node pid, alive for the whole run; children keep the place. A full run (about 1 h) is far under the 6 h age.
- Crash: in a fresh `MARXY_LOCK_DIR`, `taskkill /F` during `unit-theme` left the lock file; the next run took it over at once (dead pid), passed, released on exit.
- typecheck, lint, `pnpm check` 10/10; the two test files 31/31; builder's verify turn 8/8 on this tip; docs match.

## Mutations (each restored)

- `takeSlot` never waits: 2 tests fail.
- Span's last step = its first: heavy-span test fails.
- `HELD` rethrown instead of trying the next place: 3 tests fail.

## For later (none blocking)

1. Ctrl+C: no SIGINT handler, so the exit hook that deletes the lock does not run; the place waits for dead-pid takeover, and pid reuse could block it up to 6 h. `process.once('SIGINT', () => process.exit(130))` would fix it (not testable here).
2. Killing verify leaves its running step going; the place is taken over while that load remains. Pre-existing.
3. A non-numeric `MARXY_VERIFY_SLOT_WAIT_SEC` gives NaN: never times out, polls about every millisecond. Validate as `slotCount` does.
4. Takeover race already in `takeLock`: two waiters on the same stale lock can both unlink and both hold.
5. The proof run used `--only unit-typeset`, not plain `--tier quick`.

## Orchestrator notes

Items 1 and 3 are small and cheap: sent back to the builder to fix on the branch, with the same reviewer to read only the delta. 2 and 4 are older than this branch; left.

## Delta review of `11d83ffb` (same reviewer)

**Verdict: ready.** Tree clean, no fixes committed.

- Ctrl+C and the running step: unchanged by reading. On Windows steps share verify's console and still get Ctrl+C; verify used to die at once and now exits at once. On POSIX steps run in their own group, orphaned before and still. The handler only lets the exit hook remove the lock.
- Installed only when verify reaches its first heavy step, right before taking a place (so also while waiting). Never for `--no-lock`, `--list`, or a run with no heavy step.
- Mutations: emptying `exitOnSignals` fails the interrupt test (exit 0, not 130); removing the `slotWaitSec` check fails its test. Both restored.
- Bad `MARXY_VERIFY_SLOT_WAIT_SEC` exits 2 with a message. Tests 33/33; typecheck, lint, `pnpm check` 10/10.

For later: the handler could also stop the step's process tree (`killTree`) so nothing is left running.
