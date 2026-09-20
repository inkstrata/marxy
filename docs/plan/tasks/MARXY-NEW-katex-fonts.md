---
key: MARXY-NEW-katex-fonts
design: [02-render]
depends: []
verify: [pnpm precheck, pnpm done MARXY-NEW-katex-fonts]
---
# Bundle KaTeX OFL fonts after MARXY-28 (cherry-pick a07bb6f)

**Design:** [02-render](../../design/02-render.md) post-pass 6 · **Depends on:** nothing (MARXY-28 is Done).

**Outcome.** KaTeX CSS injection rewrites `url(fonts/…)` to hashed asset URLs that exist in the Vite
build output, so inline and display math render with real fonts offline. MARXY-28's merged code used
the wrong glob depth; do not reopen PR #125 or branch `feat/MARXY-28-katex-on-first-use-on-the-grid`.

**Cherry-pick source.** Commit **`a07bb6f`** on `feat/MARXY-28-katex-on-first-use-on-the-grid`
(`fix(desktop): bundle KaTeX fonts and screenshot inline math (MARXY-28)`). Prefer
`git cherry-pick a07bb6f` onto `feat/MARXY-NEW-katex-fonts-*` from current `origin/main`; resolve
only if main moved unrelated lines in the same files.

## Files
- `apps/desktop/src/render/math.ts` — glob must be `../../node_modules/katex/dist/fonts/*.{woff2,woff,ttf}` (from `src/render/`, not `../../../`).
- `packages/core/src/render/math.acceptance.test.ts` — bundle/font assertions split from WebKit-only tests; inline paragraph screenshot diff.
- `packages/core/src/render/math-inline-baseline.png` — committed baseline bytes for the inline-math paragraph crop.
- `apps/desktop/THIRD_PARTY_NOTICES.md` — KaTeX OFL entry matches bundled fonts.
- `CHANGELOG.md` — one Unreleased line naming this key (real key after Jira sync).

## Do this, in order
1. Branch `fix/MARXY-NEW-katex-fonts-*` off `origin/main` **after** the landing story merges.
2. Cherry-pick **`a07bb6f`** or apply the same diff by hand; do not change unrelated MARXY-28 behaviour.
3. `pnpm exec vite build` from `apps/desktop` and confirm `dist/` contains at least one `.woff2` (or `.woff`/`.ttf`) asset referenced from the built JS.
4. `node --test packages/core/src/render/math.acceptance.test.ts` — green (WebKit tests skip when Playwright is absent unless `MARXY_BROWSER_TESTS_REQUIRED=1`).
5. `pnpm precheck`, then `pnpm done <real-key>` once Jira sync assigned one.

## Tests → expected
| Check | Expect |
| --- | --- |
| `node --test packages/core/src/render/math.acceptance.test.ts` | green; bundle tests run without WebKit |
| Vite build output | ≥1 KaTeX font file under `dist/assets/` (or equivalent hashed path) |
| Injected `#marxy-katex` | `url(...)` targets hashed assets, not bare `url(fonts/` |
| Inline screenshot test | pixel diff ≤ gate threshold vs `math-inline-baseline.png` when WebKit present |

## Acceptance → check
Matches the CSV row criteria 1–8 in order.

## Do not
Reopen or force-push PR #125. Open a second PR on `feat/MARXY-28-katex-on-first-use-on-the-grid`.
Edit MARXY-28's board row. Touch `docs/plan/jira-issues.csv` in the product PR (row must already be on main from the landing story).
