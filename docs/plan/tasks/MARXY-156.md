---
key: MARXY-156
design: []
depends: []
verify: [node --test orchestration/dispatch.test.mjs, node --test orchestration/*.test.mjs]
---
# MARXY-156 — stop an auth failure from spending an attempt

**Depends on:** nothing. **Touches no product surface** — `orchestration/` only.

**Outcome.** `orchestration/dispatch.mjs` cannot tell a real, failed implementor run from `cursor-agent`
never authenticating. Four stories have now burned real attempts this way with an identical one-line log
(`orchestration/results/{MARXY-132,MARXY-27,MARXY-84,MARXY-126}.log`, each exactly `Error: Authentication
required. Please run 'agent login' first, or set CURSOR_API_KEY environment variable.`, each worktree with
zero commits ahead of `origin/main`): MARXY-132 was caught and reset by a planner pass
(`docs/plan/deltas/2026-09-20.md`); MARXY-126 spent all nine of its recorded attempts this way and sits at
`escalate` having produced no diff ever; MARXY-27 and MARXY-84 are real phase-1 stories with genuine
uncommitted WIP from *other*, real attempts, now stalled on the same failure class. This story makes the
dispatcher recognise the pattern itself so the fleet stops paying a planner to audit `results/*.log` by
hand every pass.

## Files and signatures
- `orchestration/dispatch.mjs` — export a new pure function:
  ```js
  export function isAuthFailure({ code, log, resultExists }) {
    if (code === 0 || resultExists) return false;
    return log.toString('utf8').trim() ===
      "Error: Authentication required. Please run 'agent login' first, or set CURSOR_API_KEY environment variable.";
  }
  ```
  Call it right after `writeFileSync(log, ...)` and the `result` read, using the same `code`, the same
  buffer already written to `log`, and `existsSync(resultPath)` for `resultExists`. When it returns `true`
  for a key: re-read state fresh (`const s2 = state();`, same as the existing post-exit block), restore
  `s2.stories[key].attempts` to its value from *before* this call incremented it (capture that value in a
  local right before the existing `rec.attempts += 1;` line), set `status = 'todo'`, `saveState(s2)`,
  `jira(['move', key, 'todo'])`, print one line naming the key as an auth failure rather than a real
  attempt, call the new `noteAuthFailure(key)` helper below, and skip the rest of that key's normal
  done/blocked/todo branching entirely (the existing branch still runs for every key where
  `isAuthFailure` is false).
  - `noteAuthFailure(key)` appends to `orchestration/needs-human.md`: **at most one bullet per calendar
    day**, listing every key that hit an auth failure that day. If a bullet already exists for today's date
    (match a fixed prefix like `- [ ] YYYY-MM-DD — **Headless auth failure:**`), rewrite it in place to add
    the new key rather than appending a second bullet; otherwise append a new one. The bullet's text names
    the affected key(s) and says dispatch as an in-app subagent until credentials are fixed.
- `orchestration/dispatch.test.mjs` (new) — unit tests for `isAuthFailure` and `noteAuthFailure` only; do
  not spawn a real `cursor-agent` process in this file.
- `CHANGELOG.md` — one line.

## Do this, in order
1. Write `isAuthFailure` and its tests first: true for the exact auth-failure string with a non-zero code
   and no result file; false when the log contains that sentence plus any other line; false when `code`
   is 0; false when a result file exists even if the log also contains that sentence (a real run that
   happened to print it, however unlikely, must not be swallowed).
2. Write `noteAuthFailure` and its test: appending twice in one test run (same day) produces exactly one
   bullet naming both keys, not two bullets.
3. Wire both into `dispatch.mjs`'s post-exit block, capturing `attempts` before the increment as described
   above. Do not change the increment's location for the non-auth-failure path.
4. `node --test orchestration/dispatch.test.mjs`, then `node --test orchestration/*.test.mjs` for the
   whole suite, then `CHANGELOG.md`.

## Tests → expected
| Check | Expect |
| --- | --- |
| `isAuthFailure` on the exact known string, code 1, no result | `true` |
| `isAuthFailure` on that string plus extra output, code 1, no result | `false` |
| `isAuthFailure` on that string, code 0 | `false` |
| `isAuthFailure` on that string, code 1, result file exists | `false` |
| `noteAuthFailure('MARXY-1')` then `noteAuthFailure('MARXY-2')` same run | exactly one dated bullet, naming both keys |
| `node --test orchestration/dispatch.test.mjs` | green |
| `node --test orchestration/*.test.mjs` | green, no regression |

## Acceptance → check
The seven criteria on the CSV row map onto the table above in order; criterion 3 (attempts unchanged) is
covered by a fixture test that calls the state-patching logic directly (extract it to a small named
function if that is the only way to test it without spawning a process) rather than only asserting on
`isAuthFailure`'s return value.

## Do not
Change branch/worktree creation, model routing, or `implementorEscalation` selection. Touch
`orchestration/state.json` (gitignored; tests use a fixture state object, not the real file). Suppress a
*real* failure's attempt count — only the exact single-line auth string with no result file qualifies.
Add a retry loop or automatic re-dispatch; this story only stops the miscount, it does not redispatch
anything itself.
