# MARXY-87 — commit the search.test.ts one-liner

MARXY-87 adds `apps/desktop/src/palette/view.ts`. The MARXY-86 test in
`apps/desktop/src/palette/search.test.ts` still asserts that file must not
exist; CI fails until the check is removed.

**Before the follow-up commit:** add `apps/desktop/src/palette/search.test.ts` to
the MARXY-87 `Paths` cell in `docs/plan/jira-issues.csv`, then commit the test
edit (drop the `existsSync(…view.ts…)` line only).
