# Round 10: reds and proof

Base master `ee56607d`. Builders follow `builder-rules.md`; each branch gets a review by a different model before integration.

| Branch | Rows | Builder | Reviewer |
| --- | --- | --- | --- |
| `flakes` | F8, F10 | Opus | Sonnet |
| `work-args` | F9 | Sonnet | Opus |
| `guard-tests` | F11 | Sonnet | Opus |
| `read-head` | S8 | Opus | Sonnet |

## Log

- 2026-11-23: round 9 cleanup done (15 worktrees, 9 merged branches, `agent/find-in-buffer`); kept `bisect`, `exe`, `exe-round9`, `open-with` (another session's), `furniture`, `shortcuts` (H4). Four worktrees cut, builders started.
- `work-args` built: `57fa3721`, everything after `installer` goes to the script; work.test 11/0, check 10/10, verify changed 8/8. Opus review running.
- `work-args` Opus review: nothing must-fix; the new test fails on the old `work.mjs` ("unknown argument -Ref"); quoting reaches PowerShell intact. Nit applied in `5d9d7ad4` (`--base`/`--root` go before `installer`). Ready.
- `read-head` built: verdict cannot widen the served set; found and fixed a check-then-open race (folder swapped for a junction) in `read_head_in` and `detect_files`, `86a05f98`, via `read_head_judged`/`handle_is`. cargo 604/0/5 skip, verify changed 9/9. 8.3 test skipped (no short names on this volume). Left: sqlite `-wal`/`-shm` follow links (new row S12). Sonnet review running.
- `read-head` Sonnet review: nothing must-fix; disabling `handle_is` fails the swap test (outside file read); cargo 604/0/5. Left: `image_size_in` still checks then opens (S13); mapped/subst/network drive not tried (W9). Ready.
- `guard-tests` built: `d5f08bae`, tests only. Pane close after prompt (pane-set.test) and grant mid sliced render (new view-guards.test, also covers the policy-by-name fix) each fail without their guard. Resize burst cancel: no visible path, no test (bookkeeping only). verify changed 9/9. Opus review running, flake risk of the timing-based test first.
- `flakes` built: 6 commits. Real app bug: a left-panel draw between press and release lost the click (search result landing while pressing Aa/.*/word); fix defers the draw to the click end, `4f7a5094`, with a test failing on the old file. Test causes: links read before page flip; pdf find typed per key; split-narrow restore shows B both sides a moment; studio two reads; fence-copy waited for lines not highlight. 5 runs in a row x2 batches under --jobs 3 green; verify changed 9/9. Left: PDF find count shows previous query while reading (F13). Sonnet review running.
- `guard-tests` Opus review: nothing must-fix. Each test fails without its guard (pane-set: close fired for gone pane; view-guards 3/3 and 2/2 with `.html` compare), 5/5 alone and 5/5 under load green. Resize-burst: a narrow path exists (stale timer drops a new open-at-place anchor, relayouts new doc), untested (F14). `midRead` can pass vacuously on a slow parse; a hold at the first slice would make it deterministic. Ready.
- `flakes` Sonnet review: nothing must-fix; frame.ts deferral cannot stick (pointerup capture, cancel, blur), no cross-pane leak, keyboard unaffected; new test fails on old frame.ts. Nit taken: studio test now waits for room and canvas to agree, `fd8ca2ab` (7/7). Integration `agent/round10` (worktree `worktrees\round10`): work-args, read-head, guard-tests, flakes merged clean, `47513544`. Full verify running (`verify-full.log`).
- Full verify on `47513544`: 15/17. All of F10 green; tauri 117/117, cargo 604, core 4292, desktop 1314/1, browser 2466/1. Reds, each passing alone and outside the round's files: `startup/measure.test.ts` "a wait that saw frames but no paint entry" (first_text not the 128 ms frame) and `transform-sheet.test.mjs` whole-document sheet ("Module name, 'undefined' does not resolve"). Filed F15. Ready for master on Ian's word.
- 2026-11-23: master fast-forwarded to `47513544` on Ian's yes. Rows F8 to F11 and S8 removed from the tracker.
- 2026-11-23: round 10 worktrees and branches removed on Ian's yes (flakes, guard-tests, read-head, work-args, round10).
