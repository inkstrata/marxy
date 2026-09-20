# Plan delta — 2026-09-20-katex-fonts (MARXY-28 merged with a font-bundle defect)

> Narrow planner pass after MARXY-28 (#125) merged to `main` (`8d5e4b8` / `766afb9`).
> **Worktree:** `/home/ubuntu/marxy-wt/planner-katex-fonts`, cut from `origin/main` at `8fb6ce4`
> (includes MARXY-27 #124). Primary orchestrator checkout (`/workspace`) was not edited.

## What changed on main

MARXY-28 landed KaTeX-on-first-use, but `apps/desktop/src/render/math.ts` uses
`import.meta.glob('../../../node_modules/katex/dist/fonts/*.{woff2,woff,ttf}')`, which resolves
from `apps/desktop/src/render/` to the **repo root** `node_modules`, not
`apps/desktop/node_modules` where pnpm installs the `katex` dependency for the desktop app.
Vite therefore emits **zero** hashed font assets; injected `#marxy-katex` CSS still references
`url(fonts/…)` paths that 404 at runtime.

An implementor already fixed this on the **merged** feature branch
`feat/MARXY-28-katex-on-first-use-on-the-grid` at commit **`a07bb6f`** (glob
`../../node_modules/katex/dist/fonts/*.{woff2,woff,ttf}`, acceptance tests for bundle output and
rewritten CSS URLs, `math-inline-baseline.png`, `THIRD_PARTY_NOTICES` alignment). PR #125 is
**merged** and must **not** be reopened; no second PR on that branch.

## Re-sequencing (unchanged from after-154)

- **MARXY-15** and **MARXY-78** stay **parked** — do not dispatch, do not edit their rows this pass.
- **MARXY-138 / #115** stays **Done** — do not reopen.
- **MARXY-28** stays **Done** — the defect is paid by a new out-of-plan story, not a reopen.

## Story changes

| Key | Lane | Summary |
| --- | --- | --- |
| `MARXY-NEW-katex-fonts` | phase 1 (`out-of-plan`) | Cherry-pick or re-apply `a07bb6f` onto a fresh branch; bundle KaTeX fonts and lock acceptance |
| `MARXY-NEW-katex-fonts-land` | ops | Land this delta, the new row, card, `deps.json` and `jira-map.json` (placeholder keys until Jira sync) |

## Escalation risk

**MARXY-NEW-katex-fonts** — low: the fix is already proven on `a07bb6f`; risk is only if the
implementor rewrites tests instead of carrying the commit. Card names the cherry-pick source
explicitly.

## Risks / tripwires

- `docs/roadmap.md` ops-heavy window continues; this pass adds one ops landing row and one small
  phase-1 follow-up, not a replan.
- Do not widen MARXY-28's row — it is Done.

## Ten-line summary (orchestrator)

1. MARXY-28 merged with a KaTeX font glob pointing at repo-root `node_modules`; fonts are not bundled.
2. Known-good fix exists at **`a07bb6f`** on `feat/MARXY-28-katex-on-first-use-on-the-grid`.
3. New story **`MARXY-NEW-katex-fonts`** (out-of-plan, phase 1) pays the defect on its own PR.
4. Landing story **`MARXY-NEW-katex-fonts-land`** commits board files only; placeholders stay until Jira sync.
5. **Park MARXY-15 and MARXY-78** — no CSV edits for them.
6. **Do not reopen #115 or #125** or the old MARXY-28 branch.
7. Dispatch **`MARXY-NEW-katex-fonts-land`** first (ops, no deps), then **`MARXY-NEW-katex-fonts`** once the row is on main.
8. `jira.mjs sync` will fail without credentials — merge the landing PR with `MARXY-NEW-*` keys; sync later replaces placeholders.
9. After the product PR merges, run math acceptance (`node --test packages/core/src/render/math.acceptance.test.ts`) in CI gates.
10. No change to `orchestration/state.json` from this pass.
