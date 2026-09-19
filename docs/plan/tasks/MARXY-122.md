---
key: MARXY-122
design: [10-gates-and-testing]
depends: [MARXY-106, MARXY-117, MARXY-118]
verify: [node --test orchestration/merge-bar.test.mjs, node scripts/gate-protection.mjs --selftest]
---
# MARXY-122 — Land pull requests through the GitHub merge queue

**Human-gated.** Ian decides whether to turn on the merge queue for `main` (a ruleset change). Until
then this story is not dispatched. Remove the `human-gated` label to release it; the ruleset change
itself stays Ian's. **CODEOWNERS:** `.github/`, `cycle.mjs`, `merge-bar.mjs`.

**Outcome.** No branch is ever updated to catch up with `main`. The cycle enqueues an approved PR
pinned to its head, and GitHub tests it on top of the PRs ahead of it. The one-at-a-time refresh
from MARXY-106 remains as the fallback, selected by `mergeQueue` in `models.json`.

## Files and signatures
- `.github/workflows/ci.yml` — add `merge_group:` to `on:`; the `ci` job name is unchanged.
- `orchestration/merge-bar.mjs` — `mergeArgs(n, head, { auto, queue })`; `chooseUpdate` returns null when `queue` is on.
- `orchestration/cycle.mjs` — read `models().mergeQueue`.
- `scripts/gate-protection.mjs` and a fixture under `scripts/fixtures/protection/`.
- `docs/sdlc.md` — the merge bar paragraph.

## Do not
Change the ruleset or branch protection from code. Remove the MARXY-106 path.
