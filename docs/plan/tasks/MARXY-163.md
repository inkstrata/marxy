---
key: MARXY-163
design: [02-render]
depends: []
verify: [pnpm precheck, pnpm done MARXY-163]
---
# MARXY-163 — bundle KaTeX OFL fonts after MARXY-28's merged glob miss

**Design:** [02-render](../../design/02-render.md) post-pass 4 (maths) · **Depends on:** nothing —
MARXY-28 is Done on `main`.

**Outcome.** MARXY-28 (PR #125) merged KaTeX rendering with a font glob that resolves to the
repo-root `node_modules` instead of `apps/desktop/node_modules`, where pnpm actually installs
`katex`. Vite therefore never emits hashed KaTeX font assets, and the injected CSS keeps the bare
`url(fonts/KaTeX_*)` KaTeX ships with — a 404 in the packaged app. MARXY-28 stays Done; PR #125 and
branch `feat/MARXY-28-katex-on-first-use-on-the-grid` are not reopened. A fix already exists as
commit `a07bb6f` on that branch (correct glob, bundle acceptance tests, a screenshot baseline,
THIRD_PARTY_NOTICES alignment) — cherry-pick it onto a fresh branch cut from `main` rather than
re-deriving the fix.

## Why this story exists in this shape
PR #135 (`chore/MARXY-NEW-katex-fonts-land`) tried to land this exact follow-up under a placeholder
key (`MARXY-NEW-katex-fonts`) and never ran `jira.mjs sync` before opening — it is `CONFLICTING`
against the CSV dedupe MARXY-161 landed, and `conventions` fails on it. This row replaces it under a
real key obtained with `node orchestration/jira.mjs task`, the supported out-of-plan path. PR #135
should be closed, not merged and not rewritten in place.

## Files and signatures
- `apps/desktop/src/render/math.ts` — one-line fix: the `import.meta.glob` path prefix changes from
  `../../../node_modules/katex/dist/fonts/` to `../../node_modules/katex/dist/fonts/`.
- `packages/core/src/render/math.acceptance.test.ts` — two new cases: a Node-only build/bundle
  assertion (no Playwright needed) and a `browserTest` asserting the injected CSS references bundled
  URLs, not the bare `fonts/KaTeX_*` path KaTeX ships with.
- `packages/core/src/render/math-inline-baseline.png` — new screenshot baseline for an inline-math
  paragraph, compared by a `browserTest` pixel diff.
- `apps/desktop/THIRD_PARTY_NOTICES.md` — KaTeX's OFL-1.1 entry gets a `fonts/` path consistent with
  the corrected bundle output.

## Do this, in order
1. `git fetch origin feat/MARXY-28-katex-on-first-use-on-the-grid` (or use the local ref if already
   fetched), confirm `a07bb6f` is the fix commit (`git show a07bb6f --stat`).
2. From a fresh branch cut off `main`, `git cherry-pick a07bb6f`. Resolve any conflict against the
   current `main` state of `math.ts` / `math.acceptance.test.ts` by hand rather than dropping either
   file's intent.
3. `pnpm --filter @marxy/desktop build:web` once locally and grep the output tree for `KaTeX_` font
   files to confirm the glob now resolves.
4. `node --test packages/core/src/render/math.acceptance.test.ts`.
5. `pnpm precheck`, `pnpm done MARXY-163` (or the resolved key if `jira.mjs sync` renamed it).

## Tests → expected
| Check | Expect |
| --- | --- |
| `import.meta.glob` prefix in `math.ts` | `../../node_modules/katex/dist/fonts/*.{woff2,woff,ttf}` |
| Node build/bundle test | finds ≥ 1 hashed `KaTeX_*.woff2\|woff\|ttf` under the Vite output tree |
| `browserTest` CSS-rewrite case | `#marxy-katex` text does not match `url(fonts/KaTeX_`; does match a bundled font URL |
| `browserTest` screenshot case | inline-math paragraph (`data-marxy-s="23"`) ≤ 0.1% pixels differ from `math-inline-baseline.png` when WebKit is available |
| `node --test packages/core/src/render/math.acceptance.test.ts` | exit 0 |
| `apps/desktop/THIRD_PARTY_NOTICES.md` | KaTeX OFL-1.1 entry, `fonts/` path matches bundled output |

## Acceptance → check
The eight criteria on the CSV row map onto the table above, in order, plus criterion 8 (the diff
boundary), checked by `git diff origin/main --name-only`.

## Do not
Reopen PR #125 or branch `feat/MARXY-28-katex-on-first-use-on-the-grid` as a live PR. Touch
`docs/plan/jira-issues.csv` or MARXY-28's own row. Re-derive the fix from scratch instead of
cherry-picking `a07bb6f`. Merge or comment "complete" on PR #135 — close it instead.
