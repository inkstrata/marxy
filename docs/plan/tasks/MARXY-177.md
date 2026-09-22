---
key: MARXY-177
design: [05-theme, 11-config-and-storage, 09-app-shell, 08-position-and-watching]
depends: [MARXY-47, MARXY-20, MARXY-37, MARXY-38, MARXY-95, MARXY-138]
verify: [pnpm precheck, pnpm done MARXY-177]
---
# MARXY-177 — Apply user theme in the shell; theme opens as a document

**Design:** [05-theme](../../design/05-theme.md) §App side · [11-config-and-storage](../../design/11-config-and-storage.md) ·
[09-app-shell](../../design/09-app-shell.md) §Source mode · [08-position-and-watching](../../design/08-position-and-watching.md) §Re-layout ·
**Split 2026-09-21** (`docs/plan/deltas/2026-09-21-marxy-47-split.md`) · **Depends on:** MARXY-47 (loader +
`rewriteUrls` in the theme package), MARXY-20, MARXY-37, MARXY-38, MARXY-95, MARXY-138 · **ADRs:** ADR-0008, ADR-0009.

**Outcome.** After MARXY-47 lands the package half, this story wires `startUserTheme`, the theme-as-document
notice, and the harness cases that prove launch/change apply, Source default for `theme.css`, and "Use this
theme". First reader-visible user theme — append a row to `docs/taste-review/queue.md`.

## Files and signatures
- `apps/desktop/src/theme/user-theme.ts` — `startUserTheme` (§05 App side).
- `apps/desktop/src/theme/theme-document.ts` — notice when the opened path is `theme.css`/`theme.toml`.
- `apps/desktop/src/app.ts` — call `startUserTheme` from the app seam (after `first_text`, idle).
- `apps/desktop/src/commands/view.ts` — only if the notice action needs a hook; no palette commands for themes.
- `apps/desktop/test/user-theme.test.mjs` — app harness acceptance from the old MARXY-47 row.
- `apps/desktop/test/app-harness.test.mjs` — extend only if the harness entry needs a registry touch for this story.
- `docs/taste-review/queue.md` — one row for user-applied theme in the real app.

## Do this, in order
1. Rebase onto `main` with MARXY-47 merged; keep only desktop + harness hunks from the old #164 branch.
2. `startUserTheme`: scope, load via package `loadTheme`, apply after `first_text`, relayout with position kept, watch.
3. Theme-as-document notice and "Use this theme" (`setTopLevelKey` from the package).
4. Harness cases + screenshot queue row.

## Tests → expected
| Check | Expect |
| --- | --- |
| harness: config `theme = "/t/quiet"` | `#marxy-theme` after `ready`; first text before theme; position preserved across relayout |
| harness: write new `theme.css` via `shell.emit` | re-applied within 200 ms |
| harness: open `/t/quiet/theme.css` | Source mode; notice; "Use this theme" writes `theme = "/t/quiet"` |
| `contract-2` fixture via shell | warning notice; theme still applied |
| `docs/taste-review/queue.md` | row present |

## Acceptance → check
CSV: launch apply + re-layout; file-change re-apply; contract notice in app; open `theme.css` → Source + action; queue row.

## Do not
Put user theme on the startup path before `first_text`. Re-implement `loadTheme` or `rewriteUrls` here (MARXY-47).
Add `fixtures/themes/hostile/` (MARXY-45). Edit `docs/plan/jira-issues.csv` on this branch.
