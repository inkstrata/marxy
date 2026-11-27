# verify-lock: builder report (Sonnet)

verify-lock: done, 1 commit on agent/verify-lock.

Commit: edf2d31d feat(verify): heavy steps take one of N machine-wide places

What changed:
- `pnpm verify` takes one of N places for its heavy steps. N is `MARXY_VERIFY_SLOTS`, default 2.
- Heavy steps are the unit suites, lint-rust, browser, cargo and build. The place is held from the first to the last of them. The cheap steps and `tauri` (which has its own lock) run outside it.
- When all places are taken it prints the holders once and waits, up to `MARXY_VERIFY_SLOT_WAIT_SEC` (default 10800).
- `--no-lock` skips the turn. `--list` takes no place.
- A place whose owner pid is gone, or that is over 6 h old, is reclaimed.
- Code: new `takeSlot` in `scripts/lib/machine-lock.mjs`, built on `takeLock`. `takeLock` now throws an error with `code = 'HELD'` and the holder. Added a `MARXY_LOCK_DIR` override for the lock folder.
- Docs updated: `docs/testing.md`, `docs/working.md`, `scripts/README.md`.
- Nothing changes for the reader.

Tests:
- New tests in `scripts/lib/machine-lock.test.mjs` cover taken, released, reclaimed after the owner dies, the N+1th waiting, and the wait message. `scripts/verify.test.mjs` covers the heavy span, slot count and `--no-lock`.
- Together they pass: 31 in those two files, 6 in the lock file alone.
- Revert-and-fail proof: made `pidAlive` always true; the reclaim test and the existing takeover test failed; restored.
- typecheck, lint and `pnpm check` (10/10) green. `readme-index.test.mjs` passes 7.

Proof run, two `verify --tier quick --only unit-typeset` runs started together with `MARXY_VERIFY_SLOTS=1`:
- Run a took the place and ran 78.9 s.
- Run b printed "all 1 verify places are taken: pid ... waiting", then held the place after a finished (54.5 s).
- Outputs in `C:\Dev\reader\work\wave3\verify-lock-proof\`.
- Collision avoidance: `MARXY_LOCK_DIR` set to a fresh temp folder; no real verify slot or check:tauri lock touched. The outside script and `work\wave1\locks` untouched.

Verify turn: `--tier changed` 8/8, unit-scripts 269 pass; 0 browser files, no Rust. Log `C:\Dev\reader\work\wave3\verify-lock-verify.log`.

Interaction with the outside script: no deadlock or double wait (outside script allows 2, in-repo default 2). Builders on older bases are not counted by the in-repo places. Use `--no-lock` or a higher `MARXY_VERIFY_SLOTS` to avoid queue-on-queue. Once this lands, `work\wave1\verify-turn.sh` and `work\plan\verify-turn.sh` are no longer needed (orchestrator removes them).

Not done: no full-tier run, per the rules.

## Orchestrator notes

- Checked: one commit `edf2d31d` on `84a815dd`, tree clean, verify log ends 8/8 exit 0 (14:54).
- For the reviewer: a 6 h age reclaim can steal a live slot from a long full verify (about an hour, so fine today); check `takeLock`'s new throw does not change what `check:tauri`'s callers see.
