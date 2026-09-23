---
key: MARXY-197
design: [10-gates-and-testing]
depends: []
verify: [pnpm precheck, pnpm done MARXY-197]
---
# MARXY-197 — A deferral in product code must name work that is still coming

**Design:** [10-gates-and-testing](../../design/10-gates-and-testing.md) · **Delta:**
[2026-09-22-broad-review](../deltas/2026-09-22-broad-review.md) · **Lane:** ops.

**Outcome.** A comment such as "placeholder until MARXY-34" or "a later story registers this" can no
longer outlive the story it names. MARXY-34, 35, 38 and 87 each left integration for "a later story",
all four went Done, and the later story was never written. The reader got none of the features.
After this gate, that pattern is red in CI.

## The rule
A **deferral marker** is a comment in `apps/**` or `packages/**` source (not tests, fixtures, goldens
or `testing/`) matching, case-insensitively:
`placeholder until`, `until MARXY-\d+`, `a later story`, `later story (adds|registers|wires)`,
`lights up when`, `not yet (wired|registered|called)`.

The gate fails when a marker:
1. names no `MARXY-\d+` key, or
2. names a key that has already landed: a squash commit whose subject contains `(KEY)` is an
   ancestor of `HEAD`. The check runs on git history alone, with no Jira and no `state.json`, so it
   works in CI.

## Files and signatures
- `scripts/check-deferrals.mjs`: `findDeferrals(files) → { file, line, text, keys[] }[]`,
  `landedKeys(git) → Set<string>`, `main()`. Exit 1 on violations, printing `file:line` and the fix
  ("name the story that removes this, or remove it"). Output style matches the other `check-*` scripts
  (`fail`, `fix` from `scripts/lib/repo.mjs`).
- `scripts/allowlists/deferrals.json`: the violations on `main` when this lands, each as
  `{ file, marker, removedBy }`, where `removedBy` is the board key of the story that deletes it:
  - `apps/desktop/src-tauri/src/main.rs` "Phase 0 placeholder until MARXY-34" → `MARXY-194`
  - `apps/desktop/src-tauri/src/watch/mod.rs` "A later story registers" → `MARXY-194`
  - `apps/desktop/src/startup/idle-work.ts` "Placeholder until MARXY-34/MARXY-38" → `MARXY-196`
  - anything else the scan finds, each with a key, or the PR says why it is not a deferral and
    narrows the pattern for that case only.

  An allow-list entry whose marker is no longer in its file **fails as stale**, so the list only
  shrinks. When `jira.mjs sync` renames `MARXY-NEW-*` keys, update `removedBy` to the real keys.
- `scripts/check-deferrals.test.mjs`: the cases below.
- `package.json`: `check:deferrals`. `scripts/precheck.mjs`: runs it when `apps/` or `packages/`
  paths change. `.github/workflows/ci.yml`: runs it in the fast job.
- `docs/ci-contract.md`: one row with the local command. `docs/hygiene.md`: one row with the failure
  mode it answers.
- `docs/sdlc.md` definition of done, one bullet: *a story whose Paths exclude the file that makes its
  behaviour reachable by a reader names, in its PR body, the board key of the story that wires it.
  If none exists it files one (`jira.mjs task`) before merge.*
- `orchestration/prompts/reviewer.md`: one line to check that bullet.

## Tests → expected
| Check | Expect |
| --- | --- |
| a fixture file with `// placeholder until MARXY-1` where history has `feat: x (MARXY-1) (#1)` | violation (landed key) |
| `// a later story registers this` with no key | violation (no key) |
| `// placeholder until MARXY-999` with no such commit | passes |
| a marker in `*.test.ts` or under `testing/` | ignored |
| allow-listed marker removed from its file, entry left in the list | fails as stale |
| `node scripts/check-deferrals.mjs` on the branch | green (allow-list covers today's sites) |
| named mutation: add `// placeholder until MARXY-34` to `apps/desktop/src/app.ts` | red |

## Do not
Consult Jira or `state.json` (CI has neither). Widen exclusions until today's tree is clean: the
allow-list is the only escape, and each entry names a story. Touch any product file. Removing the
markers is the other stories' job.
