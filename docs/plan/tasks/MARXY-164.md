---
key: MARXY-164
design: [02-render, 05-theme]
depends: [MARXY-27]
verify: [pnpm precheck, pnpm done MARXY-164]
---
# MARXY-164 — wire highlighted code into the desktop render pipeline and theme

**Design:** [02-render](../../design/02-render.md) post-pass 5 (D-A11), [05-theme](../../design/05-theme.md)
`--marxy-tok-*` contract · **Depends on:** MARXY-27 (Done — the core tokeniser).

**Outcome.** MARXY-27 (PR #124) shipped only `packages/core/src/highlight/` — a tokeniser that
returns scope classes with no colours — and its own PR body says the desktop wiring and theme
colours are "follow-on work", leaving the taste-review queue checklist item unchecked. MARXY-27
stays Done; this is that follow-on, not a reopening. Today `apps/desktop/src/app.ts` never calls
`highlight()`, so no reader has ever seen a highlighted code block, even though
`packages/theme/default/theme.css` already defines the twelve `--marxy-tok-*` custom properties
(a contract with no consumer). `docs/scope.md` lists highlighting under v1's shipped Rendering
requirements, so Phase 1 is not actually finished until this lands — which is why it stays a
phase-1 row rather than moving to the `ops` lane.

## Files and signatures
- `apps/desktop/src/render/highlight.ts` (new) — walks `pre > code[class^=language-]` elements in
  visibility order via `IntersectionObserver` (mirrors `apps/desktop/src/render/images.ts`'s
  lazy-apply pattern), calls `highlight(code.textContent, lang)` from `@marxy/core`, and replaces
  each `<code>`'s children with trusted-DOM `<span class="marxy-tok-<scope>">` runs built from the
  returned tokens — never `innerHTML` with untrusted content. `null` (unknown language) leaves the
  element untouched.
- `apps/desktop/src/app.ts` — one wiring call after render, scheduled the same way `applyImages` /
  `applyMath` already defer (idle/after `typeset_viewport`, never before `first_text` — see
  MARXY-33's `idle-work.ts` if it has landed first).
- `packages/theme/src/base.css` — twelve rules mapping `.marxy-tok-<scope>` classes (keyword,
  string, comment, number, function, type, variable, operator, punctuation, constant, tag,
  attribute) to the twelve `--marxy-tok-*` custom properties `packages/theme/default/theme.css`
  already defines. `tokens.css` itself is frozen and not touched; `theme.css`'s values are not
  touched either — only `base.css`'s class-to-variable mapping is new.
- `apps/desktop/test/highlight.test.mjs` (new) — Playwright, headless via
  `scripts/playwright-webkit.mjs` (MARXY-149).
- `docs/taste-review/2026-09-marxy-164/` — a before (plain code, current `main`) / after
  (highlighted) PNG pair for `03-ai-plan.md`.

## Do this, in order
1. `highlight.ts` first, unit-testable against a static DOM fragment before wiring anything live.
2. Wire the single call site in `app.ts`. Confirm with a manual `pnpm --filter @marxy/desktop dev`
   pass that `03-ai-plan.md`'s code fences pick up colour.
3. `base.css`'s twelve-rule mapping. Confirm computed style resolves each class to its themed
   colour (no fallback/none).
4. `highlight.test.mjs`: one case for a known language producing coloured spans, one for an unknown
   language leaving the DOM untouched, one asserting no highlighted `<pre>` gains a horizontal
   scrollbar at the 68ch column.
5. Render the before/after PNG pair (reuse `apps/desktop/test/render-taste138.mjs`'s `after` boot
   pattern for "after"; a plain `git stash`/pre-highlight checkout, or the `packages/theme/test/`
   render path MARXY-27 predates, for "before"). Add the `docs/taste-review/queue.md` row.
6. `pnpm precheck`, `pnpm done MARXY-164` (or the resolved key if renamed).

## Tests → expected
| Check | Expect |
| --- | --- |
| `highlight.ts` on a known-language fence | `<code>` children replaced with `marxy-tok-*` spans, no `innerHTML` call on untrusted content |
| `highlight.ts` on an unknown language | DOM untouched, no `marxy-tok-*` spans |
| `highlight.test.mjs` — coloured spans | `03-ai-plan.md` fence renders with per-scope colours (Playwright, headless) |
| `highlight.test.mjs` — no scrollbar | highlighted `<pre>` at 68ch has no horizontal scrollbar |
| timing | highlighting `03-ai-plan.md` stays under MARXY-27's existing < 30 ms budget |
| `docs/taste-review/2026-09-marxy-164/` | before/after PNG pair present, linked from a new `queue.md` row |

## Acceptance → check
The eight criteria on the CSV row map onto the table above, in order, plus criterion 8 (the diff
boundary), checked by `git diff origin/main --name-only`.

## Do not
Touch `packages/core/src/highlight/` or `scripts/allowlists/` — those are MARXY-27's own paths and
are Done. Add the `copy-code-clean` operation itself (MARXY-42's job). Touch `tokens.css` or
`theme.css`'s colour values. Dispatch alongside MARXY-33 while PR #137 (also editing
`apps/desktop/src/app.ts`) is open and unreconciled in `orchestration/state.json` — confirm it has
landed, or that `state.json` correctly shows it `in_progress`/`in_review` with a path lock, before
starting this branch.
