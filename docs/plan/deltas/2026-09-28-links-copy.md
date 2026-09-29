# Plan delta — 2026-09-28, links and copy

> The unread escalation is **MARXY-230** (returned red: browser, ci). The fleet also parked
> **MARXY-252** and **MARXY-314** after three conflict resolutions. Landing key **MARXY-318**,
> `no-dispatch`, cut from `origin/main` in `../marxy-wt/MARXY-318`.

## What changed since the last delta

Since [2026-09-28](2026-09-28.md) (MARXY-313), the path widens from that pass are on main.
MARXY-236, MARXY-239, MARXY-240 and MARXY-49 are in review. MARXY-230 was returned again, this
time for a real test. MARXY-235, MARXY-44, MARXY-195, MARXY-250, MARXY-282 and MARXY-311 are
still escalated and have not been retried since that delta. No story is dropped. No story is split.

## Why nothing is split

Each stuck story already has the change on its branch. The new failures are a test the board
did not list, a missing import after a rebase, or an agent that timed out before `pnpm done`.

| Key | On the branch | Ruling |
| --- | --- | --- |
| MARXY-230 | `a0e886e9`, copy is already `node.value`. PR #231 browser fails one assertion | **Retry, do not split.** The desktop test still appends a newline. That file was outside Paths |
| MARXY-240 | PR #277. Five ripple edits, one to four lines each, plus a self-widen of the CSV | **Keep in review.** Paths gained here. Drop the CSV hunk on rebase |
| MARXY-49 | PR #278. Save, close, and `Shell.onCloseRequested` / `confirmClose` are written. Ubuntu gates: `RunEvent` is not in scope | **Keep in review.** Paths gained here. Restore the import. Do not rewrite save |
| MARXY-236 | PR #276, commit `b809d158`. CI `fast` passed. `results/MARXY-236.json` still says `packages/core test` failed | **Do not split.** Re-run `pnpm done` so the result matches CI |
| MARXY-239 | PR #275. Paths from MARXY-313 already cover `package.json` and the lockfile. CI `fast` passed. The result file still says check-story rejected them | **Do not split.** Re-run `pnpm done` |
| MARXY-235 | `cbdd9de3` only. Three implementor attempts timed out. No pull request | **Do not split.** The escalation timed out while writing, not because the highlighter commit has to be redone. Open the pull request from that commit |
| MARXY-44, 195, 250, 282, 311 | unchanged since the last delta | **Retry, do not split.** Same rulings as [2026-09-28](2026-09-28.md) |
| MARXY-252, MARXY-314 | still conflict with main after three resolution runs | **Leave parked.** A fourth automatic rebase is the fleet's existing refusal |

If a retry of MARXY-235 rewrites `cbdd9de3` and times out again, the next planner splits it.
This pass does not.

## Path widens

The product branch drops its own CSV hunk on rebase. check-story on main is what has to pass.

| Key | Paths gained | Why |
| --- | --- | --- |
| MARXY-230 | `apps/desktop/test/operations-copy.test.mjs` | `Mod+C on a code block` expects `block.value` plus a newline when the value has none. The story's copy is `node.value`. The test was outside Paths, so the implementor could not change the assertion. Acceptance criterion 6 names it |
| MARXY-240 | `render.test.ts`, `contract.test.ts`, `operations.test.ts`, `main.rs`, `shell-boundary.test.mjs` | Heading ids change two existing assertions, copy-section's html match allows `class="marxy-external"`, and `open_external` is one invoke registration plus the handler-name scan |
| MARXY-49 | `close.ts`, `save.ts`, `packages/shell-api/src/index.ts`, ADR-0038 and its index line, `scripts/registry.json`, `buffer.test.ts` | Close and save are not shell implementations, so they sit beside `title.ts`. ADR-0026 requires an ADR for a new `Shell` member; 0038 is already on the branch. The registry gains `marxy:close-requested`. The fidelity exemption must recognise `save.test.mjs` |

`docs/design/03-selection-and-operations.md` no longer says a code copy ends with exactly one
newline. `docs/design/01-buffer.md` names `apps/desktop/src/save.ts` and `close.ts`.

## Re-sequencing

`orchestration/deps.json` is unchanged. MARXY-44, MARXY-48 and MARXY-49 still depend on
MARXY-195. Path holds do the rest:

- MARXY-240 and MARXY-49 both edit `main.rs`. Both are already in review. A rebase of either keeps `RunEvent` and `commands::os::open_external`.
- MARXY-240 and MARXY-230 both edit `operations.test.ts`, and MARXY-236 holds `packages/core/src/render`. Retry MARXY-230 after MARXY-240 and MARXY-236 have left those files. The retry's only new edit is the desktop assertion.
- MARXY-250 also edits `shell-boundary.test.mjs`. It waits while MARXY-240 is in review, then retries. The hunks are different (handler names, then the CSP test).

## Taste

No new row. Visual work that merged since the last delta already has a queue entry. Review #2's
decision form is still empty.

## Escalation risk

| Story | Risk | Why |
| --- | --- | --- |
| **MARXY-235** | **High** | Three timeouts, no pull request. The commit is done. The risk is a retry that rewrites the highlighter instead of opening the pull request |
| **MARXY-236** | **High** | In review, but the local result is still failed. Invisibles-plus-isolate has not shipped. A red core test on the re-run is a return, not a split, unless it is a second mechanism |
| **MARXY-230** | Medium | The copy change is committed. The remaining edit is one assertion. If the retry puts the newline back, return it |
| **MARXY-49** | Medium | New `Shell` members, first time this story touches `shell-api`. The ADR is on the branch. The red gate is a missing import, which is small; a retry that rewrites save is not |
| **MARXY-240** | Medium | The behaviour is written. The risk is a rebase of `main.rs` that drops either `RunEvent` or `open_external` |
| MARXY-44, 195, 250, 282 | as in the previous delta | not re-read as new failures. 195's CI on #227 is still green |
| MARXY-311 | Low | unchanged |

## Tripwires checked (`docs/roadmap.md`)

| Tripwire | Result |
| --- | --- |
| Ops > half of the last 10 merges | **Not fired.** `node orchestration/planner-trigger.mjs` reported only MARXY-230 and the two conflict parks |
| Weight harness residual > 25 on Linux | Not evaluated (MARXY-22 still deferred) |
| Cold-start inflation | No recorded number changed |
| `justif/core` cannot set ragged text | Not fired. MARXY-283 has landed |
| Reviewer fails the palette task at review #2 | Not evaluable. `docs/taste-review/2026-09-review-2/decisions.md` is still an empty form |
| A supported distro on WebKitGTK < 2.50 | Not evaluated |
| Authoring re-enters scope | No |
| A first-time user's first reaction is about a feature | No reviewer session this window |

## Scope pressure

**No cut.** Phase 2 is still MARXY-195 away from closed. Phase 3 is blocked on reviews, one
assertion, and conflict parks, not on the cut list in `docs/scope.md`. Light variant and
align-table have already shipped. Nothing on that list is proposed.

## Orchestrator — act on this

1. Land **MARXY-318** before any retry of MARXY-230, and before rebasing MARXY-240 or MARXY-49 onto a board that still lacks these paths.
2. On MARXY-236 and MARXY-239, re-run `pnpm done` so a stale `failed` result stops holding a pull request whose `fast` job passed. Do not retry them as new attempts.
3. When MARXY-240 or MARXY-49 is returned for the red gate or the CSV hunk, the fix is the import and dropping the hunk. Do not `--fresh`.
4. Retry **MARXY-230** (not `--fresh`) only after MARXY-240 and MARXY-236 have left `render-html.ts` and `operations.test.ts`. The card says the desktop assertion is the edit.
5. Retry **MARXY-235** to open the pull request from `cbdd9de3`. Then **MARXY-195**, **MARXY-44**, **MARXY-282**, **MARXY-311**. **MARXY-250** after MARXY-240 leaves `shell-boundary.test.mjs`.
6. Leave MARXY-252 and MARXY-314 parked. MARXY-299's macOS failure is a crates.io download of `imagesize`, not a plan change. MARXY-315, MARXY-316 and MARXY-317 are someone else's out-of-plan work; this pass does not touch their paths.
